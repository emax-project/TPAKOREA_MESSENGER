import path from 'path';
import { Router } from 'express';
import { prisma } from '../db.js';
import { authMiddleware } from '../auth.js';

export const roomsRouter = Router();

roomsRouter.use(authMiddleware);

const MESSAGE_EDIT_LIMIT_MS = 5 * 60 * 1000; // 5 minutes

function aggregateReactions(reactions) {
  const map = {};
  for (const r of reactions) {
    if (!map[r.emoji]) {
      map[r.emoji] = { emoji: r.emoji, count: 0, userIds: [] };
    }
    map[r.emoji].count += 1;
    map[r.emoji].userIds.push(r.userId);
  }
  return Object.values(map);
}

// List public rooms (must be before /:id routes)
roomsRouter.get('/public', async (req, res) => {
  try {
    const rooms = await prisma.room.findMany({
      where: { isPublic: true },
      include: {
        members: {
          where: { leftAt: null },
          include: { user: { select: { id: true, name: true } } },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: { sender: { select: { id: true, name: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const result = rooms.map((r) => {
      const isMember = r.members.some((m) => m.userId === req.userId);
      const last = r.messages[0];
      return {
        id: r.id,
        name: r.name || '채팅방',
        memberCount: r.members.length,
        isMember,
        lastMessage: last
          ? { content: last.deletedAt ? '[삭제된 메시지]' : last.content, createdAt: last.createdAt, senderName: last.sender.name }
          : null,
        updatedAt: r.updatedAt,
      };
    });

    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch public rooms' });
  }
});

// List rooms I'm in, with last message and unread count
roomsRouter.get('/', async (req, res) => {
  try {
    const [memberships, unreadRows] = await Promise.all([
      prisma.roomMember.findMany({
        where: { userId: req.userId, leftAt: null },
        include: {
          room: {
            include: {
              messages: {
                take: 1,
                orderBy: { createdAt: 'desc' },
                include: { sender: { select: { id: true, name: true } } },
              },
              members: {
                where: { leftAt: null },
                include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, updatedAt: true } } },
              },
            },
          },
        },
      }),
      // N+1 방지: 단일 쿼리로 모든 방의 미읽음 수를 한꺼번에 집계
      prisma.$queryRaw`
        SELECT m."roomId", COUNT(*)::int AS "unreadCount"
        FROM "Message" m
        INNER JOIN "RoomMember" rm
          ON rm."roomId" = m."roomId" AND rm."userId" = ${req.userId} AND rm."leftAt" IS NULL
        WHERE m."deletedAt" IS NULL
          AND m."senderId" != ${req.userId}
          AND m."createdAt" > COALESCE(rm."lastReadAt", rm."joinedAt")
        GROUP BY m."roomId"
      `,
    ]);

    const unreadMap = new Map(unreadRows.map((row) => [row.roomId, row.unreadCount]));

    const rooms = memberships.map((m) => {
      const last = m.room.messages[0];
      const otherMembers = m.room.members.filter((mb) => mb.userId !== req.userId);
      const displayName = m.room.name || otherMembers.map((mb) => mb.user.name).join(', ') || '채팅방';
      const lastAt = last ? new Date(last.createdAt) : new Date(m.room.updatedAt);
      return {
        id: m.room.id,
        name: displayName,
        avatarUrl: null,
        initials: m.room.initials || null,
        isGroup: m.room.isGroup,
        isTopic: m.room.isTopic ?? !!(m.room.description || m.room.initials),
        viewMode: m.room.viewMode || 'chat',
        folderId: m.folderId || null,
        createdBy: m.room.createdBy || null,
        members: m.room.members.map((mb) => { const ver = mb.user.updatedAt ? `?v=${new Date(mb.user.updatedAt).getTime()}` : ''; return { id: mb.user.id, name: mb.user.name, email: mb.user.email, avatarUrl: mb.user.avatarUrl ? `/users/${mb.user.id}/avatar${ver}` : null }; }),
        lastMessage: last
          ? { id: last.id, content: last.deletedAt ? '[삭제된 메시지]' : last.content, createdAt: last.createdAt, senderName: last.sender.name }
          : null,
        updatedAt: m.room.updatedAt,
        _sortAt: lastAt.getTime(),
        unreadCount: unreadMap.get(m.room.id) ?? 0,
        isFavorite: m.isFavorite,
      };
    });

    rooms.sort((a, b) => {
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      return (b._sortAt || 0) - (a._sortAt || 0);
    });
    const cleaned = rooms.map(({ _sortAt, ...r }) => r);
    return res.json(cleaned);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// Create a topic (named group room) directly
roomsRouter.post('/topic', async (req, res) => {
  try {
    const { name, description, isPublic, viewMode: viewModeRaw, memberIds, folderId: folderIdRaw, initials: initialsRaw } = req.body;
    if (process.env.NODE_ENV !== 'production') {
      console.log('[createTopic] received:', JSON.stringify({ viewMode: viewModeRaw, folderId: folderIdRaw }));
    }
    const folderId = folderIdRaw && typeof folderIdRaw === 'string' ? folderIdRaw.trim() : null;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: '아젠다 이름을 입력해주세요' });
    }
    if (name.trim().length > 60) {
      return res.status(400).json({ error: '아젠다 이름은 60자 이내로 입력해주세요' });
    }
    if (description && description.length > 300) {
      return res.status(400).json({ error: '아젠다 설명은 300자 이내로 입력해주세요' });
    }
    const validViewModes = ['chat', 'board'];
    const roomViewMode = (typeof viewModeRaw === 'string' && validViewModes.includes(viewModeRaw)) ? viewModeRaw : 'chat';
    const roomInitials = (typeof initialsRaw === 'string' && initialsRaw.trim().length > 0)
      ? initialsRaw.trim().slice(0, 2).toUpperCase()
      : null;

    const allMemberIds = new Set([req.userId]);
    if (Array.isArray(memberIds)) {
      for (const id of memberIds) allMemberIds.add(id);
    }

    // Validate folderId if provided
    if (folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: folderId, userId: req.userId },
      });
      if (!folder) return res.status(400).json({ error: '폴더를 찾을 수 없습니다' });
    }

    const requester = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, name: true },
    });

    const newRoom = await prisma.$transaction(async (tx) => {
      const room = await tx.room.create({
        data: {
          isGroup: true,
          isTopic: true,
          name: name.trim(),
          description: description?.trim() || null,
          viewMode: roomViewMode,
          isPublic: !!isPublic,
          initials: roomInitials,
          createdBy: req.userId,
          members: {
            create: [...allMemberIds].map((uid) => ({ userId: uid })),
          },
        },
        include: {
          members: { include: { user: { select: { id: true, name: true, email: true } } } },
        },
      });

      // Assign folder to creator's membership if folderId provided
      if (folderId) {
        const creatorMembership = room.members.find((m) => String(m.userId) === String(req.userId));
        if (creatorMembership) {
          await tx.roomMember.update({
            where: { id: creatorMembership.id },
            data: { folderId },
          });
        }
      }

      await tx.message.create({
        data: {
          roomId: room.id,
          senderId: req.userId,
          content: `${requester.name}님이 아젠다를 만들었습니다`,
        },
      });

      return room;
    });

    const io = req.app.get('io');
    if (io) {
      for (const uid of allMemberIds) {
        const sockets = await io.in(`user:${uid}`).fetchSockets();
        for (const s of sockets) s.join(newRoom.id);
      }
      // 시스템 메시지 브로드캐스트 → 초대된 멤버에게 알림
      const systemMsg = await prisma.message.findFirst({
        where: { roomId: newRoom.id },
        orderBy: { createdAt: 'desc' },
        include: { sender: { select: { id: true, name: true, email: true } } },
      });
      if (systemMsg) {
        io.to(newRoom.id).emit('message', { ...systemMsg, readCount: 0 });
      }
      io.to(newRoom.id).emit('members_added', { roomId: newRoom.id, newRoom: true });
    }

    return res.status(201).json({
      id: newRoom.id,
      name: newRoom.name,
      avatarUrl: null,
      initials: newRoom.initials || null,
      description: newRoom.description,
      viewMode: newRoom.viewMode,
      isGroup: true,
      isTopic: true,
      isPublic: newRoom.isPublic,
      createdBy: newRoom.createdBy || null,
      members: newRoom.members.map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email })),
      updatedAt: newRoom.updatedAt,
      folderId: folderId || null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create topic' });
  }
});

// Create a group chat (isGroup, not topic) with name + members
roomsRouter.post('/group', async (req, res) => {
  try {
    const { name, memberIds } = req.body;
    const roomName = typeof name === 'string' ? name.trim() : '';
    if (!roomName) {
      return res.status(400).json({ error: '그룹 채팅 이름을 입력해주세요' });
    }
    if (roomName.length > 60) {
      return res.status(400).json({ error: '그룹 채팅 이름은 60자 이내로 입력해주세요' });
    }

    const allMemberIds = new Set([req.userId]);
    if (Array.isArray(memberIds)) {
      for (const id of memberIds) {
        if (typeof id === 'string' && id.trim()) allMemberIds.add(id.trim());
      }
    }
    if (allMemberIds.size < 2) {
      return res.status(400).json({ error: '나 외에 멤버가 1명 이상 필요합니다' });
    }

    const requester = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, name: true },
    });

    const newRoom = await prisma.$transaction(async (tx) => {
      const room = await tx.room.create({
        data: {
          isGroup: true,
          isTopic: false,
          name: roomName,
          createdBy: req.userId,
          members: {
            create: [...allMemberIds].map((uid) => ({ userId: uid })),
          },
        },
        include: {
          members: {
            include: {
              user: { select: { id: true, name: true, email: true, avatarUrl: true, updatedAt: true } },
            },
          },
        },
      });

      await tx.message.create({
        data: {
          roomId: room.id,
          senderId: req.userId,
          content: `${requester?.name ?? '사용자'}님이 그룹 채팅을 만들었습니다`,
        },
      });

      return room;
    });

    const io = req.app.get('io');
    if (io) {
      for (const uid of allMemberIds) {
        const sockets = await io.in(`user:${uid}`).fetchSockets();
        for (const s of sockets) s.join(newRoom.id);
      }
      io.to(newRoom.id).emit('members_added', { roomId: newRoom.id, newRoom: true });
    }

    const members = (newRoom.members ?? []).map((m) => {
      const ver = m.user?.updatedAt ? `?v=${new Date(m.user.updatedAt).getTime()}` : '';
      return {
        id: m.user?.id ?? m.userId,
        name: m.user?.name ?? '',
        email: m.user?.email ?? '',
        avatarUrl: m.user?.avatarUrl ? `/users/${m.user.id}/avatar${ver}` : null,
      };
    });

    return res.status(201).json({
      id: newRoom.id,
      name: newRoom.name,
      avatarUrl: null,
      initials: newRoom.initials || null,
      isGroup: true,
      isTopic: false,
      viewMode: newRoom.viewMode || 'chat',
      isPublic: newRoom.isPublic,
      createdBy: newRoom.createdBy || null,
      members,
      updatedAt: newRoom.updatedAt,
      lastMessage: null,
      unreadCount: 0,
      isFavorite: false,
    });
  } catch (err) {
    console.error('[createGroup]', err);
    return res.status(500).json({ error: 'Failed to create group chat' });
  }
});

// Create 1:1 room (or return existing)
roomsRouter.post('/', async (req, res) => {
  try {
    const { otherUserId } = req.body;
    if (!otherUserId) {
      return res.status(400).json({ error: 'otherUserId required' });
    }
    const other = await prisma.user.findUnique({ where: { id: otherUserId } });
    if (!other) return res.status(404).json({ error: 'User not found' });

    const myRooms = await prisma.room.findMany({
      where: { isGroup: false, members: { some: { userId: req.userId } } },
      include: {
        members: { where: { leftAt: null }, include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } } },
      },
    });
    const existing = myRooms.find((r) => {
      const ids = r.members.map((m) => m.userId);
      if (ids.length !== 2) return false;
      if (otherUserId === req.userId) {
        return ids.every((id) => id === req.userId);
      }
      return ids.includes(req.userId) && ids.includes(otherUserId);
    });
    if (existing) {
      const myMember = existing.members.find((m) => m.userId === req.userId);
      if (myMember && myMember.leftAt) {
        await prisma.roomMember.update({
          where: { id: myMember.id },
          data: { leftAt: null },
        });
      }
      const toRoomResponse = (r) => ({
        id: r.id,
        name: r.name || r.members.filter((m) => m.userId !== req.userId).map((m) => m.user.name).filter(Boolean).join(', ') || '채팅방',
        avatarUrl: null,
        initials: r.initials || null,
        isGroup: r.isGroup,
        isTopic: r.isTopic ?? false,
        viewMode: r.viewMode || 'chat',
        members: r.members.map((m) => { const ver = m.user.updatedAt ? `?v=${new Date(m.user.updatedAt).getTime()}` : ''; return { id: m.user.id, name: m.user.name, email: m.user.email, avatarUrl: m.user.avatarUrl ? `/users/${m.user.id}/avatar${ver}` : null }; }),
        lastMessage: null,
        updatedAt: r.updatedAt,
      });
      return res.json(toRoomResponse(existing));
    }

    const room = await prisma.room.create({
      data: {
        isGroup: false,
        members: {
          create: [{ userId: req.userId }, { userId: otherUserId }],
        },
      },
      include: {
        members: { where: { leftAt: null }, include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } } },
      },
    });
    const toRoomResponse = (r) => ({
      id: r.id,
      name: r.name || r.members.filter((m) => m.userId !== req.userId).map((m) => m.user.name).filter(Boolean).join(', ') || '채팅방',
      avatarUrl: null,
      initials: r.initials || null,
      isGroup: r.isGroup,
      isTopic: r.isTopic ?? false,
      viewMode: r.viewMode || 'chat',
      members: r.members.map((m) => { const ver = m.user.updatedAt ? `?v=${new Date(m.user.updatedAt).getTime()}` : ''; return { id: m.user.id, name: m.user.name, email: m.user.email, avatarUrl: m.user.avatarUrl ? `/users/${m.user.id}/avatar${ver}` : null }; }),
      lastMessage: null,
      updatedAt: r.updatedAt,
    });
    return res.status(201).json(toRoomResponse(room));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create room' });
  }
});

// Get single room (check membership)
roomsRouter.get('/:id', async (req, res) => {
  try {
    const member = await prisma.roomMember.findFirst({
      where: { roomId: req.params.id, userId: req.userId, leftAt: null },
      include: {
        room: {
          include: {
            members: {
              where: { leftAt: null },
              include: { user: { select: { id: true, name: true, email: true } } },
            },
          },
        },
      },
    });
    if (!member) return res.status(404).json({ error: 'Room not found' });
    const room = member.room;
    const otherMembers = room.members.filter((m) => m.userId !== req.userId);
    const displayName = room.name || otherMembers.map((m) => m.user?.name ?? '').filter(Boolean).join(', ') || '채팅방';

    const readSince = member.lastReadAt ?? member.joinedAt;
    const [unreadRow] = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS "unreadCount"
      FROM "Message" m
      WHERE m."roomId" = ${req.params.id} AND m."deletedAt" IS NULL
        AND m."senderId" != ${req.userId}
        AND m."createdAt" > ${readSince}
    `;
    const unreadCount = unreadRow?.unreadCount ?? 0;

    return res.json({
      id: room.id,
      name: displayName,
      avatarUrl: null,
      initials: room.initials || null,
      isGroup: room.isGroup,
      isTopic: room.isTopic ?? !!(room.description || room.initials),
      viewMode: room.viewMode || 'chat',
      createdBy: room.createdBy || null,
      members: room.members.map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email })),
      updatedAt: room.updatedAt,
      lastReadAt: member.lastReadAt ? member.lastReadAt.toISOString() : null,
      unreadCount,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch room' });
  }
});

// Update room viewMode (chat/board) - DB에 저장, 아젠다는 생성자만
roomsRouter.put('/:id', async (req, res) => {
  try {
    const { viewMode } = req.body;
    const validViewModes = ['chat', 'board'];
    if (!viewMode || !validViewModes.includes(viewMode)) {
      return res.status(400).json({ error: 'viewMode는 chat 또는 board여야 합니다' });
    }
    const member = await prisma.roomMember.findFirst({
      where: { roomId: req.params.id, userId: req.userId, leftAt: null },
      include: { room: { select: { isTopic: true, createdBy: true } } },
    });
    if (!member) return res.status(404).json({ error: 'Room not found' });
    if (member.room.isTopic && member.room.createdBy && member.room.createdBy !== req.userId) {
      return res.status(403).json({ error: '아젠다 방 설정은 생성자만 변경할 수 있습니다' });
    }

    const updated = await prisma.room.update({
      where: { id: req.params.id },
      data: { viewMode },
    });
    return res.json({ viewMode: updated.viewMode });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update viewMode' });
  }
});

// Mark room as read
roomsRouter.post('/:id/read', async (req, res) => {
  try {
    const member = await prisma.roomMember.findFirst({
      where: { roomId: req.params.id, userId: req.userId, leftAt: null },
    });
    if (!member) return res.status(404).json({ error: 'Room not found' });

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.roomMember.update({
        where: { id: member.id },
        data: { lastReadAt: now },
      });
      const msgs = await tx.message.findMany({
        where: { roomId: req.params.id, senderId: { not: req.userId } },
        select: { id: true },
      });
      if (msgs.length > 0) {
        await tx.readReceipt.createMany({
          data: msgs.map((m) => ({ messageId: m.id, userId: req.userId })),
          skipDuplicates: true,
        });
      }
    });
    const io = req.app.get('io');
    if (io) io.to(req.params.id).emit('room_read', { roomId: req.params.id, userId: req.userId });
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to mark read' });
  }
});

// Invite members → create a NEW group room (아젠다는 생성자만 초대 가능)
roomsRouter.post('/:id/members', async (req, res) => {
  try {
    const { userIds, isPublic } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds array required' });
    }

    const sourceRoomId = req.params.id;
    const member = await prisma.roomMember.findFirst({
      where: { roomId: sourceRoomId, userId: req.userId, leftAt: null },
      include: { room: { select: { isTopic: true, createdBy: true } } },
    });
    if (!member) return res.status(403).json({ error: 'Not a member of this room' });
    if (member.room.isTopic && member.room.createdBy && member.room.createdBy !== req.userId) {
      return res.status(403).json({ error: '아젠다 멤버 초대는 생성자만 할 수 있습니다' });
    }

    const requester = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, name: true },
    });

    const existingMembers = await prisma.roomMember.findMany({
      where: { roomId: sourceRoomId, leftAt: null },
      include: { user: { select: { id: true, name: true } } },
    });
    const existingIds = new Set(existingMembers.map((m) => m.userId));

    const newUserIds = userIds.filter((id) => !existingIds.has(id));
    if (newUserIds.length === 0) {
      return res.status(400).json({ error: 'All users are already members' });
    }

    const newUsers = await prisma.user.findMany({
      where: { id: { in: newUserIds } },
      select: { id: true, name: true, email: true },
    });
    if (newUsers.length === 0) {
      return res.status(400).json({ error: 'No valid users found' });
    }

    const allMemberIds = [...existingIds, ...newUsers.map((u) => u.id)];
    // 이름은 DB에 저장하지 않는다(null). 저장하면 모든 참여자에게 같은 이름(본인 포함)이 보이므로,
    // 방 목록·상세에서 "보는 사람 본인을 뺀 참여자 이름"으로 만들어 보여 준다.
    // 아래 응답의 name도 요청자 기준으로 같은 방식으로 만든다.
    const otherMemberNames = [
      ...existingMembers.filter((m) => m.userId !== req.userId).map((m) => m.user?.name ?? ''),
      ...newUsers.filter((u) => u.id !== req.userId).map((u) => u.name ?? ''),
    ].filter(Boolean);
    const groupName = otherMemberNames.length > 0 ? otherMemberNames.join(', ') : '그룹 채팅';
    const invitedNames = newUsers.map((u) => u.name).join(', ');

    const newRoom = await prisma.$transaction(async (tx) => {
      const room = await tx.room.create({
        data: {
          isGroup: true,
          isTopic: false,
          name: null,
          isPublic: !!isPublic,
          members: {
            create: allMemberIds.map((uid) => ({ userId: uid })),
          },
        },
        include: {
          members: { include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, updatedAt: true } } } },
        },
      });

      await tx.message.create({
        data: {
          roomId: room.id,
          senderId: req.userId,
          content: `${requester.name}님이 ${invitedNames}님을 초대했습니다`,
        },
      });

      return room;
    });

    const roomWithMsg = await prisma.room.findUnique({
      where: { id: newRoom.id },
      include: {
        members: { include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, updatedAt: true } } } },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: { sender: { select: { id: true, name: true, email: true } } },
        },
      },
    });

    const io = req.app.get('io');
    if (io) {
      for (const uid of allMemberIds) {
        const sockets = await io.in(`user:${uid}`).fetchSockets();
        for (const s of sockets) s.join(newRoom.id);
      }

      const systemMsg = roomWithMsg.messages[0];
      if (systemMsg) {
        io.to(newRoom.id).emit('message', { ...systemMsg, readCount: 0 });
      }

      io.to(newRoom.id).emit('members_added', {
        roomId: newRoom.id,
        newRoom: true,
      });
    }

    const members = (newRoom.members ?? []).map((m) => {
      const ver = m.user?.updatedAt ? `?v=${new Date(m.user.updatedAt).getTime()}` : '';
      return {
        id: m.user?.id ?? m.userId,
        name: m.user?.name ?? '',
        email: m.user?.email ?? '',
        avatarUrl: m.user?.avatarUrl ? `/users/${m.user.id}/avatar${ver}` : null,
      };
    });
    return res.json({
      id: newRoom.id,
      name: groupName,
      avatarUrl: null,
      initials: null,
      isGroup: true,
      isTopic: false,
      viewMode: 'chat',
      folderId: null,
      members,
      lastMessage: null,
      updatedAt: newRoom.updatedAt,
      unreadCount: 0,
      isFavorite: false,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create group room' });
  }
});

// Get messages (paginated, with read count, reactions, replies, polls)
roomsRouter.get('/:id/messages', async (req, res) => {
  try {
    const member = await prisma.roomMember.findFirst({
      where: { roomId: req.params.id, userId: req.userId, leftAt: null },
    });
    if (!member) return res.status(404).json({ error: 'Room not found' });

    const cursor = req.query.cursor;
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const messages = await prisma.message.findMany({
      where: { roomId: req.params.id },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        sender: { select: { id: true, name: true, email: true, avatarUrl: true, updatedAt: true } },
        readReceipts: { select: { userId: true } },
        replyTo: {
          select: {
            id: true,
            content: true,
            deletedAt: true,
            sender: { select: { id: true, name: true } },
          },
        },
        reactions: true,
        poll: {
          include: {
            options: { include: { votes: true } },
          },
        },
      },
    });
    const hasMore = messages.length > limit;
    const list = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor = hasMore ? list[list.length - 1].id : null;
    const normalized = list.map(({ readReceipts, reactions, ...m }) => {
      const senderVer = m.sender?.updatedAt ? `?v=${new Date(m.sender.updatedAt).getTime()}` : '';
      const senderWithAvatar = m.sender ? {
        id: m.sender.id,
        name: m.sender.name,
        email: m.sender.email,
        avatarUrl: m.sender.avatarUrl ? `/users/${m.sender.id}/avatar${senderVer}` : null,
      } : m.sender;
      return {
      ...m,
      sender: senderWithAvatar,
      content: m.deletedAt ? '[삭제된 메시지]' : m.content,
      fileSize: m.fileSize != null ? Number(m.fileSize) : null,
      readCount: readReceipts.filter((r) => String(r.userId) !== String(m.senderId)).length,
      replyTo: m.replyTo
        ? {
            id: m.replyTo.id,
            content: m.replyTo.deletedAt ? '[삭제된 메시지]' : m.replyTo.content,
            sender: m.replyTo.sender,
          }
        : null,
      reactions: aggregateReactions(reactions),
      poll: m.poll
        ? {
            id: m.poll.id,
            question: m.poll.question,
            isMultiple: m.poll.isMultiple,
            options: m.poll.options.map((o) => ({
              id: o.id,
              text: o.text,
              voteCount: o.votes.length,
              voterIds: o.votes.map((v) => v.userId),
            })),
          }
        : null,
    };});
    return res.json({ messages: normalized, nextCursor, hasMore });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Search messages in room
roomsRouter.get('/:id/messages/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q || typeof q !== 'string') return res.json({ messages: [] });

    const member = await prisma.roomMember.findFirst({
      where: { roomId: req.params.id, userId: req.userId, leftAt: null },
    });
    if (!member) return res.status(404).json({ error: 'Room not found' });

    const messages = await prisma.message.findMany({
      where: {
        roomId: req.params.id,
        content: { contains: q, mode: 'insensitive' },
        deletedAt: null,
      },
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: {
        sender: { select: { id: true, name: true, email: true } },
      },
    });

    return res.json({ messages });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to search messages' });
  }
});

// Edit message (5 min limit)
roomsRouter.put('/:roomId/messages/:messageId', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content required' });
    }

    const message = await prisma.message.findUnique({
      where: { id: req.params.messageId },
    });
    if (!message || message.roomId !== req.params.roomId) {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (message.senderId !== req.userId) {
      return res.status(403).json({ error: 'Not your message' });
    }
    if (message.deletedAt) {
      return res.status(400).json({ error: 'Message already deleted' });
    }
    if (Date.now() - message.createdAt.getTime() > MESSAGE_EDIT_LIMIT_MS) {
      return res.status(400).json({ error: '5분이 지나 수정할 수 없습니다' });
    }

    const updated = await prisma.message.update({
      where: { id: message.id },
      data: { content: content.trim(), editedAt: new Date() },
      include: { sender: { select: { id: true, name: true, email: true } } },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(message.roomId).emit('message_updated', {
        id: updated.id,
        roomId: updated.roomId,
        content: updated.content,
        editedAt: updated.editedAt,
      });
    }

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to edit message' });
  }
});

// Delete message (5 min limit, soft delete)
roomsRouter.delete('/:roomId/messages/:messageId', async (req, res) => {
  try {
    const message = await prisma.message.findUnique({
      where: { id: req.params.messageId },
    });
    if (!message || message.roomId !== req.params.roomId) {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (message.senderId !== req.userId) {
      return res.status(403).json({ error: 'Not your message' });
    }
    if (message.deletedAt) {
      return res.status(400).json({ error: 'Already deleted' });
    }
    if (Date.now() - message.createdAt.getTime() > MESSAGE_EDIT_LIMIT_MS) {
      return res.status(400).json({ error: '5분이 지나 삭제할 수 없습니다' });
    }

    await prisma.message.update({
      where: { id: message.id },
      data: { deletedAt: new Date(), content: '[삭제된 메시지]' },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(message.roomId).emit('message_deleted', {
        id: message.id,
        roomId: message.roomId,
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Leave room
roomsRouter.post('/:id/leave', async (req, res) => {
  try {
    const member = await prisma.roomMember.findFirst({
      where: { roomId: req.params.id, userId: req.userId, leftAt: null },
    });
    if (!member) return res.status(404).json({ error: 'Not a member' });

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { name: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.roomMember.update({
        where: { id: member.id },
        data: { leftAt: new Date() },
      });

      await tx.message.create({
        data: {
          roomId: req.params.id,
          senderId: req.userId,
          content: `${user.name}님이 채팅방을 나갔습니다`,
        },
      });
    });

    const io = req.app.get('io');
    if (io) {
      io.to(req.params.id).emit('member_left', {
        roomId: req.params.id,
        userId: req.userId,
        userName: user.name,
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to leave room' });
  }
});

// Toggle favorite
roomsRouter.put('/:id/favorite', async (req, res) => {
  try {
    const { isFavorite } = req.body;
    const member = await prisma.roomMember.findFirst({
      where: { roomId: req.params.id, userId: req.userId, leftAt: null },
    });
    if (!member) return res.status(404).json({ error: 'Not a member' });

    await prisma.roomMember.update({
      where: { id: member.id },
      data: { isFavorite: !!isFavorite },
    });

    return res.json({ ok: true, isFavorite: !!isFavorite });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to toggle favorite' });
  }
});

// Forward message to another room
roomsRouter.post('/:targetRoomId/forward', async (req, res) => {
  try {
    const { messageId } = req.body;
    if (!messageId) return res.status(400).json({ error: 'messageId required' });

    const targetMember = await prisma.roomMember.findFirst({
      where: { roomId: req.params.targetRoomId, userId: req.userId, leftAt: null },
    });
    if (!targetMember) return res.status(403).json({ error: 'Not a member of target room' });

    const original = await prisma.message.findUnique({
      where: { id: messageId },
      include: { sender: { select: { name: true } } },
    });
    if (!original) return res.status(404).json({ error: 'Original message not found' });
    if (original.deletedAt) return res.status(400).json({ error: 'Cannot forward deleted message' });

    const sourceMember = await prisma.roomMember.findFirst({
      where: { roomId: original.roomId, userId: req.userId, leftAt: null },
    });
    if (!sourceMember) return res.status(403).json({ error: 'Not a member of source room' });

    const forwardedContent = `[전달됨] ${original.sender.name}: ${original.content}`;
    const message = await prisma.message.create({
      data: {
        roomId: req.params.targetRoomId,
        senderId: req.userId,
        content: forwardedContent,
      },
      include: { sender: { select: { id: true, name: true, email: true } } },
    });

    await prisma.room.update({
      where: { id: req.params.targetRoomId },
      data: { updatedAt: new Date() },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(req.params.targetRoomId).emit('message', { ...message, readCount: 0 });
    }

    return res.json(message);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to forward message' });
  }
});

// Toggle reaction on message
roomsRouter.post('/:roomId/messages/:messageId/reactions', async (req, res) => {
  try {
    const { emoji } = req.body;
    if (!emoji) return res.status(400).json({ error: 'emoji required' });

    const message = await prisma.message.findUnique({
      where: { id: req.params.messageId },
    });
    if (!message || message.roomId !== req.params.roomId) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const member = await prisma.roomMember.findFirst({
      where: { roomId: req.params.roomId, userId: req.userId, leftAt: null },
    });
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const existing = await prisma.reaction.findUnique({
      where: {
        messageId_userId_emoji: {
          messageId: req.params.messageId,
          userId: req.userId,
          emoji,
        },
      },
    });

    if (existing) {
      await prisma.reaction.delete({ where: { id: existing.id } });
    } else {
      await prisma.reaction.create({
        data: {
          messageId: req.params.messageId,
          userId: req.userId,
          emoji,
        },
      });
    }

    const reactions = await prisma.reaction.findMany({
      where: { messageId: req.params.messageId },
    });

    const aggregated = aggregateReactions(reactions);

    const io = req.app.get('io');
    if (io) {
      io.to(req.params.roomId).emit('reaction_updated', {
        messageId: req.params.messageId,
        reactions: aggregated,
      });
    }

    return res.json({ reactions: aggregated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to toggle reaction' });
  }
});

// Pin message
roomsRouter.post('/:id/pin', async (req, res) => {
  try {
    const { messageId } = req.body;
    if (!messageId) return res.status(400).json({ error: 'messageId required' });

    const member = await prisma.roomMember.findFirst({
      where: { roomId: req.params.id, userId: req.userId, leftAt: null },
    });
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.roomId !== req.params.id) {
      return res.status(404).json({ error: 'Message not found in this room' });
    }

    await prisma.pinnedMessage.upsert({
      where: { roomId_messageId: { roomId: req.params.id, messageId } },
      create: { roomId: req.params.id, messageId, pinnedBy: req.userId },
      update: {},
    });

    const io = req.app.get('io');
    if (io) {
      io.to(req.params.id).emit('message_pinned', { roomId: req.params.id, messageId });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to pin message' });
  }
});

// Unpin message
roomsRouter.delete('/:id/pin/:messageId', async (req, res) => {
  try {
    const member = await prisma.roomMember.findFirst({
      where: { roomId: req.params.id, userId: req.userId, leftAt: null },
    });
    if (!member) return res.status(403).json({ error: 'Not a member' });

    await prisma.pinnedMessage.deleteMany({
      where: { roomId: req.params.id, messageId: req.params.messageId },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(req.params.id).emit('message_unpinned', { roomId: req.params.id, messageId: req.params.messageId });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to unpin message' });
  }
});

// Get pinned messages
roomsRouter.get('/:id/pins', async (req, res) => {
  try {
    const member = await prisma.roomMember.findFirst({
      where: { roomId: req.params.id, userId: req.userId, leftAt: null },
    });
    if (!member) return res.status(404).json({ error: 'Room not found' });

    const pins = await prisma.pinnedMessage.findMany({
      where: { roomId: req.params.id },
      orderBy: { pinnedAt: 'desc' },
      include: {
        message: {
          include: {
            sender: { select: { id: true, name: true } },
          },
        },
      },
    });

    return res.json({
      pins: pins.map((p) => ({
        id: p.id,
        pinnedAt: p.pinnedAt,
        message: {
          id: p.message.id,
          content: p.message.deletedAt ? '[삭제된 메시지]' : p.message.content,
          sender: p.message.sender,
          createdAt: p.message.createdAt,
        },
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch pins' });
  }
});

// Get files in room
roomsRouter.get('/:id/files', async (req, res) => {
  try {
    const member = await prisma.roomMember.findFirst({
      where: { roomId: req.params.id, userId: req.userId, leftAt: null },
    });
    if (!member) return res.status(404).json({ error: 'Room not found' });

    const cursor = req.query.cursor;
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const messages = await prisma.message.findMany({
      where: {
        roomId: req.params.id,
        fileUrl: { not: null },
        deletedAt: null,
      },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        sender: { select: { id: true, name: true } },
      },
    });

    const hasMore = messages.length > limit;
    const list = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor = hasMore ? list[list.length - 1].id : null;

    return res.json({
      files: list.map((m) => ({
        id: m.id,
        fileName: m.fileName,
        fileSize: m.fileSize != null ? Number(m.fileSize) : null,
        fileMimeType: m.fileMimeType,
        fileExpiresAt: m.fileExpiresAt,
        createdAt: m.createdAt,
        sender: m.sender,
      })),
      nextCursor,
      hasMore,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// Get message readers (detailed read receipts)
roomsRouter.get('/:roomId/messages/:messageId/readers', async (req, res) => {
  try {
    const member = await prisma.roomMember.findFirst({
      where: { roomId: req.params.roomId, userId: req.userId, leftAt: null },
    });
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const targetMessage = await prisma.message.findUnique({
      where: { id: req.params.messageId },
      select: { roomId: true },
    });
    if (!targetMessage || targetMessage.roomId !== req.params.roomId) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const receipts = await prisma.readReceipt.findMany({
      where: { messageId: req.params.messageId },
      include: {
        user: { select: { id: true, name: true } },
      },
      orderBy: { readAt: 'desc' },
    });

    return res.json({
      readers: receipts.map((r) => ({
        userId: r.user.id,
        userName: r.user.name,
        readAt: r.readAt,
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch readers' });
  }
});

// Get thread replies for a message
roomsRouter.get('/:roomId/messages/:messageId/thread', async (req, res) => {
  try {
    const member = await prisma.roomMember.findFirst({
      where: { roomId: req.params.roomId, userId: req.userId, leftAt: null },
    });
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const parent = await prisma.message.findUnique({
      where: { id: req.params.messageId },
      include: {
        sender: { select: { id: true, name: true } },
        readReceipts: { select: { userId: true } },
        reactions: true,
      },
    });
    if (!parent || parent.roomId !== req.params.roomId) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const replies = await prisma.message.findMany({
      where: { replyToId: req.params.messageId },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: { select: { id: true, name: true } },
        readReceipts: { select: { userId: true } },
        reactions: true,
      },
    });

    const normalize = (m) => ({
      ...m,
      content: m.deletedAt ? '[삭제된 메시지]' : m.content,
      fileSize: m.fileSize != null ? Number(m.fileSize) : null,
      readCount: m.readReceipts.filter((r) => String(r.userId) !== String(m.senderId)).length,
      reactions: aggregateReactions(m.reactions),
      readReceipts: undefined,
    });

    return res.json({
      parent: normalize(parent),
      replies: replies.map(normalize),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch thread' });
  }
});

// Join a public room
roomsRouter.post('/:id/join', async (req, res) => {
  try {
    const room = await prisma.room.findUnique({
      where: { id: req.params.id },
      include: {
        members: {
          where: { leftAt: null },
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (!room.isPublic) return res.status(403).json({ error: 'Room is not public' });

    const existingMember = room.members.find((m) => m.userId === req.userId);
    if (existingMember) {
      return res.json({
        id: room.id,
        name: room.name || '채팅방',
        isGroup: room.isGroup,
        members: room.members.map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email })),
      });
    }

    // Check if user had left previously
    const leftMember = await prisma.roomMember.findFirst({
      where: { roomId: req.params.id, userId: req.userId, leftAt: { not: null } },
    });

    if (leftMember) {
      await prisma.roomMember.update({
        where: { id: leftMember.id },
        data: { leftAt: null },
      });
    } else {
      await prisma.roomMember.create({
        data: { roomId: req.params.id, userId: req.userId },
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { name: true },
    });

    const systemMsg = await prisma.message.create({
      data: {
        roomId: req.params.id,
        senderId: req.userId,
        content: `${user.name}님이 채널에 참가했습니다`,
      },
      include: { sender: { select: { id: true, name: true, email: true } } },
    });

    const io = req.app.get('io');
    if (io) {
      const sockets = await io.in(`user:${req.userId}`).fetchSockets();
      for (const s of sockets) s.join(req.params.id);
      io.to(req.params.id).emit('message', { ...systemMsg, readCount: 0 });
      io.to(req.params.id).emit('members_added', { roomId: req.params.id });
    }

    const updatedRoom = await prisma.room.findUnique({
      where: { id: req.params.id },
      include: {
        members: {
          where: { leftAt: null },
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });

    return res.json({
      id: updatedRoom.id,
      name: updatedRoom.name || '채팅방',
      isGroup: updatedRoom.isGroup,
      members: updatedRoom.members.map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to join room' });
  }
});
