import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Server } from 'socket.io';
import bcrypt from 'bcryptjs';
import { signToken, verifyToken } from './auth.js';
import {
  loadUsers,
  saveUsers,
  loadMessages,
  saveMessages,
  loadGroups,
  saveGroups,
  loadStatuses,
  saveStatuses,
  loadReadState,
  saveReadState,
  UPLOADS_DIR,
  ensureUploadsDir,
} from './store.js';

const PORT = Number(process.env.PORT) || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const onlineUsers = new Set();
/** يُعيَّن بعد إنشاء Socket.io لمزامنة غرف المجموعات من REST */
let ioInstance = null;

function syncSocketsToGroup(group) {
  if (!ioInstance || !group) return;
  for (const s of ioInstance.sockets.sockets.values()) {
    if (typeof s.userId === 'number' && group.memberIds.includes(s.userId)) {
      s.join(`group:${group.id}`);
    }
  }
}

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '8mb' }));

/** يحدّ من محاولات التسجيل/الدخول لكل عنوان IP */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: 'طلبات كثيرة من هذا العنوان، حاول بعد قليل' });
  },
});

ensureUploadsDir();
app.use('/uploads', express.static(UPLOADS_DIR));

function safeUser(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    about: typeof u.about === 'string' ? u.about : '',
    lastSeen: u.lastSeen || u.createdAt,
    createdAt: u.createdAt,
  };
}

function publicMessage(m) {
  return {
    id: m.id,
    createdAt: m.createdAt,
    kind: m.kind || 'text',
    text: m.text || '',
    imageUrl: m.imageUrl || null,
    fromUserId: m.fromUserId,
    toUserId: m.toUserId,
    groupId: m.groupId || null,
  };
}

function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const decoded = verifyToken(token);
  if (!decoded?.sub) {
    return res.status(401).json({ error: 'غير مصرح' });
  }
  req.userId = Number(decoded.sub);
  next();
}

function getReadMap(userId) {
  const st = loadReadState();
  const key = String(userId);
  if (!st[key]) st[key] = { direct: {}, groups: {} };
  return st[key];
}

function persistReadMap(userId, map) {
  const st = loadReadState();
  st[String(userId)] = map;
  saveReadState(st);
}

function buildInbox(userId) {
  const allUsers = loadUsers();
  const messages = loadMessages();
  const groups = loadGroups();
  const rs = getReadMap(userId);

  const directs = allUsers
    .filter((u) => u.id !== userId)
    .map((peer) => {
      const thread = messages.filter(
        (m) =>
          !m.groupId &&
          ((m.fromUserId === userId && m.toUserId === peer.id) ||
            (m.fromUserId === peer.id && m.toUserId === userId))
      );
      thread.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const last = thread.length ? thread[thread.length - 1] : null;
      const cursor = Number(rs.direct[String(peer.id)] || 0);
      const unread = thread.filter((m) => m.fromUserId !== userId && m.id > cursor).length;
      const updatedAt = last ? last.createdAt : peer.createdAt;
      return {
        kind: 'direct',
        peer: safeUser(peer),
        lastMessage: last ? publicMessage(last) : null,
        unread,
        updatedAt,
      };
    })
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  const groupRows = groups.filter((g) => g.memberIds.includes(userId));
  const groupItems = groupRows
    .map((g) => {
      const thread = messages.filter((m) => m.groupId === g.id);
      thread.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const last = thread.length ? thread[thread.length - 1] : null;
      const cursor = Number(rs.groups[String(g.id)] || 0);
      const unread = thread.filter((m) => m.fromUserId !== userId && m.id > cursor).length;
      const updatedAt = last ? last.createdAt : g.createdAt;
      return {
        kind: 'group',
        group: { id: g.id, name: g.name, memberIds: g.memberIds },
        lastMessage: last ? publicMessage(last) : null,
        unread,
        updatedAt,
      };
    })
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  return { directs, groups: groupItems };
}

app.post('/api/register', authLimiter, (req, res) => {
  const { username, password, displayName } = req.body || {};
  const u = String(username || '').trim().toLowerCase();
  const p = String(password || '');
  const d = String(displayName || '').trim() || u;

  if (u.length < 3 || u.length > 32) {
    return res.status(400).json({ error: 'اسم المستخدم يجب أن يكون بين 3 و 32 حرفاً' });
  }
  if (!/^[a-z0-9_]+$/.test(u)) {
    return res.status(400).json({ error: 'اسم المستخدم: أحرف إنجليزية صغيرة وأرقام و _ فقط' });
  }
  if (p.length < 6) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
  }

  const users = loadUsers();
  if (users.some((x) => x.username === u)) {
    return res.status(409).json({ error: 'اسم المستخدم مستخدم' });
  }

  const id = users.length ? Math.max(...users.map((x) => x.id)) + 1 : 1;
  const passwordHash = bcrypt.hashSync(p, 10);
  const now = new Date().toISOString();
  const row = {
    id,
    username: u,
    displayName: d.slice(0, 64),
    about: '',
    passwordHash,
    createdAt: now,
    lastSeen: now,
  };
  users.push(row);
  saveUsers(users);

  const token = signToken({ sub: String(id) });
  return res.json({ token, user: safeUser(row) });
});

app.post('/api/login', authLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const u = String(username || '').trim().toLowerCase();
  const p = String(password || '');
  const users = loadUsers();
  const row = users.find((x) => x.username === u);
  if (!row || !bcrypt.compareSync(p, row.passwordHash)) {
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  }
  const token = signToken({ sub: String(row.id) });
  return res.json({ token, user: safeUser(row) });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const users = loadUsers();
  const row = users.find((x) => x.id === req.userId);
  if (!row) return res.status(401).json({ error: 'المستخدم غير موجود' });
  return res.json({ user: safeUser(row) });
});

app.patch('/api/me', authMiddleware, (req, res) => {
  const { displayName, about } = req.body || {};
  const users = loadUsers();
  const row = users.find((x) => x.id === req.userId);
  if (!row) return res.status(404).json({ error: 'غير موجود' });
  if (displayName !== undefined) {
    const d = String(displayName).trim();
    if (d.length < 1 || d.length > 64) {
      return res.status(400).json({ error: 'الاسم الظاهر بين 1 و 64 حرفاً' });
    }
    row.displayName = d;
  }
  if (about !== undefined) {
    row.about = String(about).trim().slice(0, 139);
  }
  saveUsers(users);
  return res.json({ user: safeUser(row) });
});

app.get('/api/users', authMiddleware, (req, res) => {
  const users = loadUsers();
  const list = users.filter((x) => x.id !== req.userId).map(safeUser);
  return res.json({ users: list });
});

app.get('/api/inbox', authMiddleware, (req, res) => {
  return res.json(buildInbox(req.userId));
});

app.get('/api/presence', authMiddleware, (_req, res) => {
  const users = loadUsers();
  const lastSeen = {};
  for (const u of users) {
    lastSeen[String(u.id)] = u.lastSeen || u.createdAt;
  }
  return res.json({
    online: Array.from(onlineUsers.values()),
    lastSeen,
  });
});

app.post('/api/read/direct/:peerId', authMiddleware, (req, res) => {
  const peerId = Number(req.params.peerId);
  if (!Number.isFinite(peerId)) return res.status(400).json({ error: 'معرف غير صالح' });
  const me = req.userId;
  const messages = loadMessages().filter(
    (m) =>
      !m.groupId &&
      ((m.fromUserId === me && m.toUserId === peerId) || (m.fromUserId === peerId && m.toUserId === me))
  );
  const maxId = messages.length ? Math.max(...messages.map((m) => m.id)) : 0;
  const map = getReadMap(me);
  map.direct[String(peerId)] = maxId;
  persistReadMap(me, map);
  return res.json({ ok: true });
});

app.post('/api/read/group/:groupId', authMiddleware, (req, res) => {
  const gid = Number(req.params.groupId);
  if (!Number.isFinite(gid)) return res.status(400).json({ error: 'معرف غير صالح' });
  const groups = loadGroups();
  const g = groups.find((x) => x.id === gid);
  if (!g || !g.memberIds.includes(req.userId)) {
    return res.status(403).json({ error: 'لست عضواً في هذه المجموعة' });
  }
  const messages = loadMessages().filter((m) => m.groupId === gid);
  const maxId = messages.length ? Math.max(...messages.map((m) => m.id)) : 0;
  const map = getReadMap(req.userId);
  map.groups[String(gid)] = maxId;
  persistReadMap(req.userId, map);
  return res.json({ ok: true });
});

app.get('/api/messages/:peerId', authMiddleware, (req, res) => {
  const peerId = Number(req.params.peerId);
  if (!Number.isFinite(peerId)) {
    return res.status(400).json({ error: 'معرف غير صالح' });
  }
  const me = req.userId;
  const messages = loadMessages().filter(
    (m) =>
      !m.groupId &&
      ((m.fromUserId === me && m.toUserId === peerId) || (m.fromUserId === peerId && m.toUserId === me))
  );
  messages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return res.json({ messages: messages.map(publicMessage) });
});

app.get('/api/groups', authMiddleware, (req, res) => {
  const groups = loadGroups().filter((g) => g.memberIds.includes(req.userId));
  return res.json({ groups });
});

app.post('/api/groups', authMiddleware, (req, res) => {
  const { name, memberIds } = req.body || {};
  const n = String(name || '').trim();
  if (n.length < 2 || n.length > 64) {
    return res.status(400).json({ error: 'اسم المجموعة بين 2 و 64 حرفاً' });
  }
  const ids = Array.isArray(memberIds) ? memberIds.map(Number).filter(Number.isFinite) : [];
  const uniq = [...new Set([req.userId, ...ids])];
  const users = loadUsers();
  const valid = uniq.every((id) => users.some((u) => u.id === id));
  if (!valid) return res.status(400).json({ error: 'أحد الأعضاء غير موجود' });
  if (uniq.length < 2) {
    return res.status(400).json({ error: 'أضف عضواً واحداً على الأقل معك' });
  }

  const groups = loadGroups();
  const id = groups.length ? Math.max(...groups.map((g) => g.id)) + 1 : 1;
  const row = {
    id,
    name: n,
    memberIds: uniq,
    createdBy: req.userId,
    createdAt: new Date().toISOString(),
  };
  groups.push(row);
  saveGroups(groups);
  syncSocketsToGroup(row);
  return res.json({ group: row });
});

app.get('/api/groups/:id/messages', authMiddleware, (req, res) => {
  const gid = Number(req.params.id);
  const groups = loadGroups();
  const g = groups.find((x) => x.id === gid);
  if (!g || !g.memberIds.includes(req.userId)) {
    return res.status(403).json({ error: 'غير مسموح' });
  }
  const messages = loadMessages()
    .filter((m) => m.groupId === gid)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return res.json({ messages: messages.map(publicMessage) });
});

app.get('/api/statuses', authMiddleware, (_req, res) => {
  const now = Date.now();
  const users = loadUsers();
  const list = loadStatuses()
    .filter((s) => new Date(s.expiresAt).getTime() > now)
    .map((s) => {
      const u = users.find((x) => x.id === s.userId);
      return {
        userId: s.userId,
        text: s.text,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        author: u ? safeUser(u) : null,
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return res.json({ statuses: list });
});

app.post('/api/status', authMiddleware, (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (text.length < 1 || text.length > 300) {
    return res.status(400).json({ error: 'الحالة بين 1 و 300 حرفاً' });
  }
  const statuses = loadStatuses().filter((s) => s.userId !== req.userId);
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const row = {
    userId: req.userId,
    text,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };
  statuses.push(row);
  saveStatuses(statuses);
  return res.json({ status: row });
});

app.delete('/api/status', authMiddleware, (req, res) => {
  const statuses = loadStatuses().filter((s) => s.userId !== req.userId);
  saveStatuses(statuses);
  return res.json({ ok: true });
});

app.post('/api/media', authMiddleware, (req, res) => {
  const dataUrl = String(req.body?.dataUrl || '');
  const m = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,(.+)$/i);
  if (!m) {
    return res.status(400).json({ error: 'أرسل صورة (PNG/JPEG/GIF/WebP) بصيغة data URL' });
  }
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 4 * 1024 * 1024) {
    return res.status(400).json({ error: 'الصورة أكبر من 4 ميجابايت' });
  }
  ensureUploadsDir();
  const ext = m[1].includes('png')
    ? 'png'
    : m[1].includes('gif')
      ? 'gif'
      : m[1].includes('webp')
        ? 'webp'
        : 'jpg';
  const name = `${Date.now()}_${req.userId}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const fp = path.join(UPLOADS_DIR, name);
  fs.writeFileSync(fp, buf);
  const url = `/uploads/${name}`;
  return res.json({ url });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'Ayman Chat API' });
});

/** واجهة الإنتاج: مسار مجلد `dist` بعد `npm run build` في `client/` */
const CLIENT_DIST_RAW = process.env.CLIENT_DIST ? String(process.env.CLIENT_DIST).trim() : '';
const CLIENT_DIST_ABS =
  CLIENT_DIST_RAW && fs.existsSync(CLIENT_DIST_RAW)
    ? path.resolve(CLIENT_DIST_RAW)
    : '';
if (CLIENT_DIST_ABS) {
  app.use(express.static(CLIENT_DIST_ABS));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/uploads') ||
      req.path.startsWith('/socket.io')
    ) {
      return next();
    }
    res.sendFile(path.join(CLIENT_DIST_ABS, 'index.html'));
  });
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] },
});
ioInstance = io;

function joinAllGroupRooms(socket, userId) {
  loadGroups()
    .filter((g) => g.memberIds.includes(userId))
    .forEach((g) => {
      socket.join(`group:${g.id}`);
    });
}

function touchLastSeen(userId) {
  const users = loadUsers();
  const row = users.find((u) => u.id === userId);
  if (!row) return;
  row.lastSeen = new Date().toISOString();
  saveUsers(users);
}

function broadcastPresence(userId, online, lastSeen) {
  io.emit('presence:update', { userId, online, lastSeen: lastSeen || null });
}

io.use((socket, next) => {
  const token =
    socket.handshake.auth?.token ||
    (socket.handshake.headers.authorization || '').replace('Bearer ', '');
  const decoded = verifyToken(token);
  if (!decoded?.sub) {
    return next(new Error('unauthorized'));
  }
  socket.userId = Number(decoded.sub);
  next();
});

io.on('connection', (socket) => {
  const uid = socket.userId;
  socket.join(`user:${uid}`);
  joinAllGroupRooms(socket, uid);
  onlineUsers.add(uid);
  broadcastPresence(uid, true, null);

  socket.on('typing', (payload) => {
    const toUserId = Number(payload?.toUserId);
    const groupId = Number(payload?.groupId);
    const typing = Boolean(payload?.typing);
    if (Number.isFinite(groupId) && groupId > 0) {
      const g = loadGroups().find((x) => x.id === groupId);
      if (!g || !g.memberIds.includes(uid)) return;
      socket.to(`group:${groupId}`).emit('typing', { groupId, fromUserId: uid, typing });
      return;
    }
    if (!Number.isFinite(toUserId) || toUserId === uid) return;
    io.to(`user:${toUserId}`).emit('typing', { toUserId, fromUserId: uid, typing });
  });

  socket.on('message:send', (payload, ack) => {
    const groupId = payload?.groupId != null ? Number(payload.groupId) : null;
    const text = String(payload?.text || '').trim();
    const imageUrl = payload?.imageUrl ? String(payload.imageUrl) : '';
    const kind = payload?.kind === 'image' || imageUrl ? 'image' : 'text';

    if (kind === 'image') {
      if (!imageUrl.startsWith('/uploads/')) {
        if (typeof ack === 'function') ack({ ok: false, error: 'رابط صورة غير صالح' });
        return;
      }
    }

    if (!text && !imageUrl) {
      if (typeof ack === 'function') ack({ ok: false, error: 'الرسالة فارغة' });
      return;
    }
    if (text.length > 4000) {
      if (typeof ack === 'function') ack({ ok: false, error: 'النص طويل جداً' });
      return;
    }

    const messages = loadMessages();
    const id = messages.length ? Math.max(...messages.map((m) => m.id)) + 1 : 1;
    const createdAt = new Date().toISOString();

    if (groupId && Number.isFinite(groupId)) {
      const groups = loadGroups();
      const g = groups.find((x) => x.id === groupId);
      if (!g || !g.memberIds.includes(uid)) {
        if (typeof ack === 'function') ack({ ok: false, error: 'مجموعة غير صالحة' });
        return;
      }
      const msg = {
        id,
        groupId,
        fromUserId: uid,
        toUserId: 0,
        kind,
        text: text || (kind === 'image' ? '' : ''),
        imageUrl: kind === 'image' ? imageUrl : null,
        createdAt,
      };
      messages.push(msg);
      saveMessages(messages);
      const out = publicMessage(msg);
      io.to(`group:${groupId}`).emit('message:new', out);
      if (typeof ack === 'function') ack({ ok: true, message: out });
      return;
    }

    const toUserId = Number(payload?.toUserId);
    if (!Number.isFinite(toUserId) || toUserId === uid) {
      if (typeof ack === 'function') ack({ ok: false, error: 'مستلم غير صالح' });
      return;
    }
    const users = loadUsers();
    if (!users.some((x) => x.id === toUserId)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'المستخدم غير موجود' });
      return;
    }

    const msg = {
      id,
      groupId: null,
      fromUserId: uid,
      toUserId,
      kind,
      text: text || (kind === 'image' ? '' : ''),
      imageUrl: kind === 'image' ? imageUrl : null,
      createdAt,
    };
    messages.push(msg);
    saveMessages(messages);
    const out = publicMessage(msg);
    io.to(`user:${uid}`).emit('message:new', out);
    io.to(`user:${toUserId}`).emit('message:new', out);
    if (typeof ack === 'function') ack({ ok: true, message: out });
  });

  socket.on('disconnect', () => {
    socket.leave(`user:${uid}`);
    onlineUsers.delete(uid);
    touchLastSeen(uid);
    const users = loadUsers();
    const row = users.find((u) => u.id === uid);
    const ls = row?.lastSeen || new Date().toISOString();
    broadcastPresence(uid, false, ls);
  });
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `[Ayman Chat] المنفذ ${PORT} مستخدم مسبقاً (EADDRINUSE).\n` +
        `  • جرّب منفذاً آخر مع إعادة تشغيل dev من جذر المشروع:\n` +
        `      $env:PORT="3001"; npm run dev\n` +
        `    (وكيل Vite يقرأ نفس PORT تلقائياً.)\n` +
        `  • أو أوقف العملية على ${PORT}، مثلاً:\n` +
        `      netstat -ano | findstr :${PORT}\n` +
        `      taskkill /PID <رقم_العمود_PID> /F`
    );
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Ayman Chat server http://localhost:${PORT}`);
});
