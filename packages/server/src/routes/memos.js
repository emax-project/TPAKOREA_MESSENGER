import { Router } from 'express';
import { prisma } from '../db.js';
import { authMiddleware } from '../auth.js';
import { sendPushToUser } from '../push.js';

export const memosRouter = Router();

memosRouter.use(authMiddleware);

const senderSelect = { id: true, name: true, email: true, avatarUrl: true };
const recipientUserSelect = { id: true, name: true, email: true };

function formatMemo(memo, { recipientRow, viewerId }) {
  const isSender = memo.senderId === viewerId;
  const myRecipient = recipientRow ?? memo.recipients?.find((r) => r.userId === viewerId);
  return {
    id: memo.id,
    subject: memo.subject,
    body: memo.body,
    createdAt: memo.createdAt,
    sender: memo.sender,
    scheduledAt: memo.scheduledAt,
    favorite: isSender ? memo.senderFavorite : myRecipient?.favorite,
    recipients: memo.recipients.map((r) => ({
      id: r.id,
      userId: r.userId,
      readAt: r.readAt,
      user: r.user,
    })),
    readAt: isSender ? null : (myRecipient?.readAt ?? null),
    recipientId: myRecipient?.id ?? null,
  };
}

function notifyMemoRecipients(io, memo) {
  const senderName = memo.sender.name;
  for (const { userId } of memo.recipients) {
    io?.to(`user:${userId}`).emit('memo', {
      memoId: memo.id,
      subject: memo.subject,
      senderName,
      senderId: memo.senderId,
    });
    sendPushToUser(userId, {
      title: `쪽지: ${senderName}`,
      body: memo.subject,
      data: { type: 'memo', memoId: memo.id },
    }).catch(() => {});
  }
}

export function startScheduledMemos(io) {
  let running = false;
  async function deliver() {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const due = await prisma.memo.findMany({
        where: { scheduledAt: { lte: now }, senderDeletedAt: null },
        orderBy: { scheduledAt: 'asc' },
        take: 100,
        include: { sender: { select: senderSelect }, recipients: { select: { userId: true } } },
      });
      for (const memo of due) {
        const claimed = await prisma.memo.updateMany({
          where: { id: memo.id, scheduledAt: memo.scheduledAt, senderDeletedAt: null },
          data: { scheduledAt: null, createdAt: now },
        });
        if (claimed.count) notifyMemoRecipients(io, memo);
      }
    } catch (error) {
      console.error('[scheduled memos]', error);
    } finally {
      running = false;
    }
  }
  void deliver();
  setInterval(deliver, 15_000).unref();
}

memosRouter.put('/:id/favorite', async (req, res) => {
  if (typeof req.body?.favorite !== 'boolean') return res.status(400).json({ error: 'favorite must be a boolean' });
  try {
    const sender = await prisma.memo.updateMany({
      where: { id: req.params.id, senderId: req.userId, senderDeletedAt: null },
      data: { senderFavorite: req.body.favorite },
    });
    if (sender.count) return res.json({ ok: true });
    const recipient = await prisma.memoRecipient.updateMany({
      where: { memoId: req.params.id, userId: req.userId, deletedAt: null, memo: { scheduledAt: null } },
      data: { favorite: req.body.favorite },
    });
    if (!recipient.count) return res.status(404).json({ error: 'Memo not found' });
    return res.json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update favorite' });
  }
});

// 받은 쪽지
memosRouter.get('/inbox', async (req, res) => {
  try {
    const rows = await prisma.memoRecipient.findMany({
      where: { userId: req.userId, deletedAt: null, memo: { scheduledAt: null } },
      orderBy: { memo: { createdAt: 'desc' } },
      take: 100,
      include: {
        memo: {
          include: {
            sender: { select: senderSelect },
            recipients: { include: { user: { select: recipientUserSelect } } },
          },
        },
      },
    });

    return res.json(rows.map((row) => formatMemo(row.memo, { recipientRow: row, viewerId: req.userId })));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch inbox' });
  }
});

// 보낸 쪽지
memosRouter.get('/sent', async (req, res) => {
  try {
    const memos = await prisma.memo.findMany({
      where: { senderId: req.userId, senderDeletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        sender: { select: senderSelect },
        recipients: { include: { user: { select: recipientUserSelect } } },
      },
    });

    return res.json(memos.map((m) => formatMemo(m, { viewerId: req.userId })));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch sent memos' });
  }
});

// 읽지 않은 쪽지 수
memosRouter.get('/unread-count', async (req, res) => {
  try {
    const count = await prisma.memoRecipient.count({
      where: { userId: req.userId, readAt: null, deletedAt: null, memo: { scheduledAt: null } },
    });
    return res.json({ count });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// 쪽지 상세
memosRouter.get('/:id', async (req, res) => {
  try {
    const memo = await prisma.memo.findUnique({
      where: { id: req.params.id },
      include: {
        sender: { select: senderSelect },
        recipients: { include: { user: { select: recipientUserSelect } } },
      },
    });
    if (!memo) return res.status(404).json({ error: 'Memo not found' });

    const isSender = memo.senderId === req.userId && !memo.senderDeletedAt;
    const isRecipient = !memo.scheduledAt && memo.recipients.some((r) => r.userId === req.userId && !r.deletedAt);
    if (!isSender && !isRecipient) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.json(formatMemo(memo, { viewerId: req.userId }));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch memo' });
  }
});

// 쪽지 발송
memosRouter.post('/', async (req, res) => {
  try {
    const { recipientIds, subject, body, scheduledAt: schedule } = req.body;
    if (schedule != null && typeof schedule !== 'string') return res.status(400).json({ error: '잘못된 예약 시간입니다.' });
    const scheduledAt = schedule == null ? null : new Date(schedule);
    if (scheduledAt && (!Number.isFinite(scheduledAt.getTime()) || scheduledAt <= new Date())) {
      return res.status(400).json({ error: '예약 시간을 미래로 설정해 주세요.' });
    }
    const trimmedSubject = String(subject ?? '').trim();
    const trimmedBody = String(body ?? '').trim();
    if (!trimmedSubject) return res.status(400).json({ error: 'subject is required' });
    if (!trimmedBody) return res.status(400).json({ error: 'body is required' });

    const ids = [...new Set((Array.isArray(recipientIds) ? recipientIds : []).map(String))].filter(
      (id) => id && id !== req.userId,
    );
    if (ids.length === 0) {
      return res.status(400).json({ error: 'At least one recipient is required' });
    }

    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (users.length !== ids.length) {
      return res.status(400).json({ error: 'Invalid recipient' });
    }

    const memo = await prisma.memo.create({
      data: {
        senderId: req.userId,
        scheduledAt,
        subject: trimmedSubject,
        body: trimmedBody,
        recipients: {
          create: ids.map((userId) => ({ userId })),
        },
      },
      include: {
        sender: { select: senderSelect },
        recipients: { include: { user: { select: recipientUserSelect } } },
      },
    });

    if (!scheduledAt) notifyMemoRecipients(req.app.get('io'), memo);

    return res.status(201).json(formatMemo(memo, { viewerId: req.userId }));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to send memo' });
  }
});

// 읽음 처리 (수신자)
memosRouter.post('/:id/read', async (req, res) => {
  try {
    const row = await prisma.memoRecipient.findFirst({
      where: { memoId: req.params.id, userId: req.userId, deletedAt: null, memo: { scheduledAt: null } },
    });
    if (!row) return res.status(404).json({ error: 'Memo not found' });

    if (!row.readAt) {
      await prisma.memoRecipient.update({
        where: { id: row.id },
        data: { readAt: new Date() },
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to mark memo as read' });
  }
});

// 쪽지 삭제 (사용자별 soft delete)
memosRouter.delete('/:id', async (req, res) => {
  try {
    const sender = await prisma.memo.updateMany({
      where: { id: req.params.id, senderId: req.userId, senderDeletedAt: null },
      data: { senderDeletedAt: new Date() },
    });
    if (sender.count) return res.json({ ok: true });

    const row = await prisma.memoRecipient.findFirst({
      where: { memoId: req.params.id, userId: req.userId, deletedAt: null, memo: { scheduledAt: null } },
    });
    if (!row) return res.status(404).json({ error: 'Memo not found' });

    await prisma.memoRecipient.update({
      where: { id: row.id },
      data: { deletedAt: new Date() },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete memo' });
  }
});
