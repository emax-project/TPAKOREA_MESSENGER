import { prisma } from './db.js';
import * as onlineUsers from './onlineUsers.js';
import { sendPushToRoom } from './push.js';
import { parseClientMessageId, isUniqueViolation } from './lib/clientMessageId.js';

// viewing_room: userId -> Set<roomId> (사용자가 현재 보고 있는 방)
const viewingRooms = new Map();

function setViewingRoom(userId, roomId) {
  if (!viewingRooms.has(userId)) viewingRooms.set(userId, new Set());
  viewingRooms.get(userId).clear();
  if (roomId) viewingRooms.get(userId).add(roomId);
}

function clearViewingRoom(userId) {
  viewingRooms.delete(userId);
}

function getUsersViewingRoom(roomId) {
  const result = [];
  for (const [uid, rooms] of viewingRooms) {
    if (rooms.has(roomId)) result.push(uid);
  }
  return result;
}

export function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    if (socket.userId) {
      const uid = String(socket.userId);
      const device = socket.device === 'mobile' ? 'mobile' : 'desktop';
      socket.join(`user:${uid}`);
      const wasOnline = onlineUsers.has(uid);
      onlineUsers.add(uid, device);
      const presencePayload = () => ({
        userIds: onlineUsers.getAll(),
        presence: onlineUsers.getPresenceMap(),
      });
      socket.emit('online_list', presencePayload());
      if (!wasOnline) {
        (async () => {
          let userName = null;
          try {
            const user = await prisma.user.findUnique({ where: { id: uid }, select: { name: true } });
            userName = user?.name ?? null;
          } catch (err) {
            console.error(`[socket] user_online: name lookup failed for ${uid}, retrying`, err);
            try {
              const user = await prisma.user.findUnique({ where: { id: uid }, select: { name: true } });
              userName = user?.name ?? null;
            } catch (err2) {
              console.error(`[socket] user_online: name lookup retry failed for ${uid}`, err2);
            }
          }
          io.emit('user_online', {
            userId: uid,
            userName,
            device,
            devices: onlineUsers.getDevices(uid),
          });
        })();
      } else {
        io.emit('user_presence', {
          userId: uid,
          device,
          devices: onlineUsers.getDevices(uid),
        });
      }
    }
    socket.on('get_online_list', () => {
      socket.emit('online_list', {
        userIds: onlineUsers.getAll(),
        presence: onlineUsers.getPresenceMap(),
      });
    });
    socket.on('disconnect', () => {
      if (socket.userId) {
        const uid = String(socket.userId);
        const device = socket.device === 'mobile' ? 'mobile' : 'desktop';
        clearViewingRoom(uid);
        onlineUsers.remove(uid, device);
        if (!onlineUsers.has(uid)) {
          io.emit('user_offline', { userId: uid, device });
        } else {
          io.emit('user_presence', {
            userId: uid,
            device,
            devices: onlineUsers.getDevices(uid),
          });
        }
      }
    });

    socket.on('viewing_room', ({ roomId }) => {
      if (!socket.userId) return;
      setViewingRoom(String(socket.userId), roomId || null);
    });
    async function isRoomMember(roomId, userId) {
      if (!roomId || !userId) return false;
      const member = await prisma.roomMember.findFirst({
        where: { roomId: String(roomId), userId: String(userId), leftAt: null },
        select: { id: true },
      });
      return !!member;
    }

    socket.on('join_room', async (roomId) => {
      try {
        if (await isRoomMember(roomId, socket.userId)) {
          socket.join(roomId);
        }
      } catch (e) {
        console.error('[socket] join_room error:', e);
      }
    });

    // 전송 확인(ack): 클라이언트가 응답 콜백을 넘기면 저장 결과를 돌려준다.
    //   { ok: true, id, createdAt, duplicate } | { ok: false, code }
    // 콜백이 없는 구버전 클라이언트는 예전처럼 응답 없이 동작한다.
    socket.on('message', async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const { roomId, content, sharedEvent, replyToId, context, clientMessageId } = payload || {};
      const text = typeof content === 'string' ? content : '';
      const hasEvent = sharedEvent && typeof sharedEvent === 'object' && sharedEvent.title != null && sharedEvent.startAt != null && sharedEvent.endAt != null;
      const cid = parseClientMessageId(clientMessageId);
      if (!roomId || (text === '' && !hasEvent) || socket.userId == null || !cid.ok) {
        reply({ ok: false, code: 'INVALID' });
        return;
      }
      /** 이미 저장된 같은 키의 메시지가 있으면 그 결과를 돌려준다(재전송 중복 방지) */
      const findDuplicate = async () => {
        if (!cid.value) return null;
        return prisma.message.findUnique({
          where: { senderId_clientMessageId: { senderId: socket.userId, clientMessageId: cid.value } },
          select: { id: true, createdAt: true },
        });
      };
      try {
        if (!(await isRoomMember(roomId, socket.userId))) {
          reply({ ok: false, code: 'NOT_MEMBER' });
          return;
        }
        const duplicate = await findDuplicate();
        if (duplicate) {
          reply({ ok: true, id: duplicate.id, createdAt: duplicate.createdAt, duplicate: true });
          return;
        }
        const data = {
          roomId,
          senderId: socket.userId,
          content: text || (hasEvent ? '[일정 공유]' : ''),
        };
        if (cid.value) data.clientMessageId = cid.value;
        if (hasEvent) {
          data.eventTitle = String(sharedEvent.title);
          data.eventStartAt = new Date(sharedEvent.startAt);
          data.eventEndAt = new Date(sharedEvent.endAt);
          data.eventDescription = sharedEvent.description != null ? String(sharedEvent.description) : null;
        }
        if (replyToId) {
          // replyToId가 실제로 이 roomId에 속한 메시지인지 확인 —
          // 그렇지 않으면 다른 방의 메시지 내용/작성자가 replyTo로 유출될 수 있음
          const replyTarget = await prisma.message.findUnique({
            where: { id: String(replyToId) },
            select: { roomId: true },
          });
          if (replyTarget && replyTarget.roomId === roomId) {
            data.replyToId = String(replyToId);
          }
        }
        if (context && typeof context === 'object' && (context.filePath || context.branch)) {
          if (context.filePath && typeof context.filePath === 'string' && context.filePath.trim()) {
            data.contextFilePath = context.filePath.trim().slice(0, 500);
          }
          if (typeof context.line === 'number' && context.line > 0) {
            data.contextLine = context.line;
          } else if (typeof context.line === 'string' && /^\d+$/.test(context.line)) {
            data.contextLine = parseInt(context.line, 10);
          }
          if (context.branch && typeof context.branch === 'string' && context.branch.trim()) {
            data.contextBranch = context.branch.trim().slice(0, 200);
          }
        }
        let message;
        try {
          message = await prisma.message.create({
            data,
            include: {
              sender: { select: { id: true, name: true, email: true, avatarUrl: true, updatedAt: true } },
              replyTo: {
                select: {
                  id: true,
                  content: true,
                  deletedAt: true,
                  sender: { select: { id: true, name: true } },
                },
              },
            },
          });
        } catch (createErr) {
          // 같은 키의 재전송이 동시에 도착해 다른 요청이 먼저 저장한 경우 — 새로 만들지 않고 기존 결과를 돌려준다
          if (cid.value && isUniqueViolation(createErr)) {
            const existing = await findDuplicate();
            if (existing) {
              reply({ ok: true, id: existing.id, createdAt: existing.createdAt, duplicate: true });
              return;
            }
          }
          throw createErr;
        }
        const sVer = message.sender?.updatedAt ? `?v=${new Date(message.sender.updatedAt).getTime()}` : '';
        const senderForClient = message.sender ? {
          id: message.sender.id,
          name: message.sender.name,
          email: message.sender.email,
          avatarUrl: message.sender.avatarUrl ? `/users/${message.sender.id}/avatar${sVer}` : null,
        } : message.sender;
        const replyToData = message.replyTo
          ? {
              id: message.replyTo.id,
              content: message.replyTo.deletedAt ? '[삭제된 메시지]' : message.replyTo.content,
              sender: message.replyTo.sender,
            }
          : null;

        // 송신자 소켓이 아직 room에 없어도 즉시 보이도록 join 후 브로드캐스트
        socket.join(roomId);
        io.to(roomId).emit('message', {
          ...message,
          sender: senderForClient,
          readCount: 0,
          replyTo: replyToData,
          reactions: [],
          poll: null,
        });
        // 저장·브로드캐스트까지 끝났음을 보낸 사람에게 확인(ack)
        reply({ ok: true, id: message.id, createdAt: message.createdAt, duplicate: false });

        // room/mention/푸시는 백그라운드에서 처리 (다음 메시지 처리 블로킹 안 함)
        (async () => {
          try {
            const now = new Date();
            await prisma.room.update({
              where: { id: roomId },
              data: { updatedAt: now },
            });
            await prisma.roomMember.updateMany({
              where: { roomId, userId: socket.userId },
              data: { lastReadAt: now },
            });
            const mentionRegex = /@(\S+)/g;
            let match;
            const mentionNames = [];
            while ((match = mentionRegex.exec(text)) !== null) {
              mentionNames.push(match[1]);
            }
            if (mentionNames.length > 0) {
              const roomMembers = await prisma.roomMember.findMany({
                where: { roomId, leftAt: null },
                include: { user: { select: { id: true, name: true } } },
              });
              for (const rm of roomMembers) {
                if (mentionNames.includes(rm.user.name)) {
                  await prisma.mention.create({
                    data: { messageId: message.id, userId: rm.userId },
                  });
                  io.to(`user:${rm.userId}`).emit('mention', {
                    roomId,
                    messageId: message.id,
                    senderName: message.sender.name,
                    content: text,
                  });
                }
              }
            }
            const viewingUsers = getUsersViewingRoom(roomId);
            const excludeIds = [...new Set([socket.userId, ...viewingUsers])];
            const room = await prisma.room.findUnique({ where: { id: roomId }, select: { name: true } });
            const roomName = room?.name || '채팅';
            const bodyText = text.length > 100 ? text.slice(0, 100) + '...' : text;
            sendPushToRoom(roomId, excludeIds, {
              title: `${message.sender.name} (${roomName})`,
              body: bodyText || '[파일/일정]',
              data: { roomId, roomName, messageId: message.id },
            });
          } catch (e) {
            console.error('[socket] post-message background error:', e);
          }
        })();
      } catch (e) {
        reply({ ok: false, code: 'SERVER' });
        socket.emit('error', { code: 'MESSAGE_CREATE', message: e.message });
      }
    });

    socket.on('typing', ({ roomId, isTyping }) => {
      if (!roomId) return;
      isRoomMember(roomId, socket.userId).then((ok) => {
        if (ok) {
          socket.to(roomId).emit('typing', { userId: socket.userId, isTyping });
        }
      }).catch((e) => {
        console.error('[socket] typing error:', e);
      });
    });

    socket.on('read_receipt', async ({ messageId }) => {
      if (!messageId || socket.userId == null) return;
      try {
        const msg = await prisma.message.findUnique({
          where: { id: messageId },
          select: { roomId: true },
        });
        if (!msg) return;
        if (!(await isRoomMember(msg.roomId, socket.userId))) return;
        const receipt = await prisma.readReceipt.upsert({
          where: {
            messageId_userId: { messageId, userId: socket.userId },
          },
          create: { messageId, userId: socket.userId },
          update: {},
          include: { message: { select: { roomId: true } } },
        });
        io.to(receipt.message.roomId).emit('read_receipt', receipt);
      } catch (e) {
        socket.emit('error', { code: 'READ_RECEIPT', message: e.message });
      }
    });
  });
}
