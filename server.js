const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { Server } = require('socket.io');
const webpush = require('web-push');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 10 * 1024 * 1024 });

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'buddha-dev-secret-' + crypto.randomBytes(8).toString('hex');
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({
      users: [],
      chats: [],
      messages: [],
      pushSubscriptions: [],
      files: [],
      meta: { nextChatId: 1, nextMessageId: 1 }
    }, null, 2));
  }
}
ensureDb();

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

let vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
if (!vapidPublicKey || !vapidPrivateKey) {
  const keys = webpush.generateVAPIDKeys();
  vapidPublicKey = keys.publicKey;
  vapidPrivateKey = keys.privateKey;
  console.log('Generated temporary VAPID keys for this session.');
}
webpush.setVapidDetails('mailto:buddha@example.com', vapidPublicKey, vapidPrivateKey);

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets')));
app.use(express.static(PUBLIC_DIR));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const safe = Date.now() + '-' + file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, safe);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }
});

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email || '',
    createdAt: user.createdAt
  };
}

function authRequired(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function getUserById(db, id) {
  return db.users.find(u => u.id === id);
}
function getChatForUsers(db, a, b) {
  const key = [a, b].sort().join(':');
  return db.chats.find(c => c.type === 'direct' && c.key === key);
}
function createDirectChat(db, a, b) {
  const chat = {
    id: db.meta.nextChatId++,
    type: 'direct',
    members: [a, b],
    key: [a, b].sort().join(':'),
    createdAt: new Date().toISOString()
  };
  db.chats.push(chat);
  return chat;
}
function getOrCreateDirectChat(db, a, b) {
  return getChatForUsers(db, a, b) || createDirectChat(db, a, b);
}

async function ensureAdmin() {
  const db = readDb();
  if (!db.users.find(u => u.username.toLowerCase() === 'buddha')) {
    const passwordHash = await bcrypt.hash('61', 10);
    db.users.push({
      id: uuidv4(),
      username: 'Buddha',
      usernameLower: 'buddha',
      email: '',
      passwordHash,
      role: 'admin',
      createdAt: new Date().toISOString()
    });
    writeDb(db);
  }
}
ensureAdmin();

app.get('/api/config', (req, res) => {
  res.json({ vapidPublicKey });
});

app.get('/api/me', (req, res) => {
  const db = readDb();
  const user = db.users.find(u => u.id === req.session.userId);
  res.json({ user: user ? sanitizeUser(user) : null });
});

app.post('/api/register', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Нужны username и пароль' });
    const db = readDb();
    if (db.users.find(u => u.usernameLower === String(username).trim().toLowerCase())) {
      return res.status(400).json({ error: 'Username уже занят' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: uuidv4(),
      username: String(username).trim(),
      usernameLower: String(username).trim().toLowerCase(),
      email: String(email || '').trim(),
      passwordHash,
      role: 'user',
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
    writeDb(db);
    req.session.userId = user.id;
    res.json({ ok: true, user: sanitizeUser(user) });
  } catch (e) {
    res.status(500).json({ error: 'registration_failed' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const db = readDb();
    const user = db.users.find(u => u.usernameLower === String(username || '').trim().toLowerCase());
    if (!user) return res.status(400).json({ error: 'Неверный логин или пароль' });
    const ok = await bcrypt.compare(password || '', user.passwordHash);
    if (!ok) return res.status(400).json({ error: 'Неверный логин или пароль' });
    req.session.userId = user.id;
    res.json({ ok: true, user: sanitizeUser(user) });
  } catch (e) {
    res.status(500).json({ error: 'login_failed' });
  }
});

app.post('/api/logout', authRequired, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/users/search', authRequired, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const db = readDb();
  const list = db.users
    .filter(u => u.id !== req.session.userId)
    .filter(u => !q || u.usernameLower.includes(q))
    .slice(0, 20)
    .map(sanitizeUser);
  res.json({ users: list });
});

app.get('/api/chats', authRequired, (req, res) => {
  const db = readDb();
  const chats = db.chats
    .filter(c => c.members.includes(req.session.userId))
    .map(chat => {
      const otherId = chat.members.find(id => id !== req.session.userId);
      const other = getUserById(db, otherId);
      const lastMessage = [...db.messages]
        .filter(m => m.chatId === chat.id && !m.deletedForAll)
        .sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt))[0];
      return {
        id: chat.id,
        otherUser: other ? sanitizeUser(other) : null,
        lastMessage: lastMessage ? {
          id: lastMessage.id,
          text: lastMessage.type === 'text' ? lastMessage.text : lastMessage.fileName || lastMessage.type,
          createdAt: lastMessage.createdAt,
          senderId: lastMessage.senderId
        } : null
      };
    })
    .sort((a,b) => new Date(b.lastMessage?.createdAt || 0) - new Date(a.lastMessage?.createdAt || 0));
  res.json({ chats });
});

app.post('/api/chats/open', authRequired, (req, res) => {
  const { username } = req.body;
  const db = readDb();
  const other = db.users.find(u => u.usernameLower === String(username || '').trim().toLowerCase());
  if (!other) return res.status(404).json({ error: 'Пользователь не найден' });
  const chat = getOrCreateDirectChat(db, req.session.userId, other.id);
  writeDb(db);
  res.json({ ok: true, chatId: chat.id, otherUser: sanitizeUser(other) });
});

app.get('/api/chats/:chatId/messages', authRequired, (req, res) => {
  const chatId = Number(req.params.chatId);
  const db = readDb();
  const chat = db.chats.find(c => c.id === chatId && c.members.includes(req.session.userId));
  if (!chat) return res.status(404).json({ error: 'chat_not_found' });
  const messages = db.messages
    .filter(m => m.chatId === chatId && !m.deletedForAll)
    .sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map(m => ({
      id: m.id,
      chatId: m.chatId,
      senderId: m.senderId,
      type: m.type,
      text: m.text || '',
      fileUrl: m.fileUrl || '',
      fileName: m.fileName || '',
      createdAt: m.createdAt
    }));
  res.json({ messages });
});

app.post('/api/chats/:chatId/messages', authRequired, upload.single('file'), async (req, res) => {
  const chatId = Number(req.params.chatId);
  const db = readDb();
  const chat = db.chats.find(c => c.id === chatId && c.members.includes(req.session.userId));
  if (!chat) return res.status(404).json({ error: 'chat_not_found' });

  let type = 'text';
  let text = String(req.body.text || '').trim();
  let fileUrl = '';
  let fileName = '';
  if (req.file) {
    fileName = req.file.originalname;
    fileUrl = '/uploads/' + req.file.filename;
    const mime = req.file.mimetype || '';
    if (mime.startsWith('image/')) type = 'image';
    else if (mime.startsWith('video/')) type = 'video';
    else type = 'file';
  }
  if (!text && !fileUrl) return res.status(400).json({ error: 'empty_message' });

  const message = {
    id: db.meta.nextMessageId++,
    chatId,
    senderId: req.session.userId,
    type,
    text,
    fileUrl,
    fileName,
    createdAt: new Date().toISOString(),
    deletedForAll: false
  };
  db.messages.push(message);
  writeDb(db);

  io.to('chat:' + chatId).emit('message:new', message);

  const recipientId = chat.members.find(id => id !== req.session.userId);
  const sender = getUserById(db, req.session.userId);
  const subs = db.pushSubscriptions.filter(s => s.userId === recipientId);
  const payload = JSON.stringify({
    title: 'Buddha Chat',
    body: `Новое сообщение от ${sender ? sender.username : 'пользователя'}`,
    url: `/chat/${chatId}`,
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png'
  });
  for (const sub of subs) {
    webpush.sendNotification(sub.subscription, payload).catch(() => {});
  }

  res.json({ ok: true, message });
});

app.delete('/api/messages/:id', authRequired, (req, res) => {
  const id = Number(req.params.id);
  const db = readDb();
  const m = db.messages.find(x => x.id === id);
  if (!m || m.senderId !== req.session.userId) return res.status(404).json({ error: 'message_not_found' });
  m.deletedForAll = true;
  writeDb(db);
  io.to('chat:' + m.chatId).emit('message:deleted', { id: m.id });
  res.json({ ok: true });
});

app.post('/api/push/subscribe', authRequired, (req, res) => {
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'bad_subscription' });
  const db = readDb();
  db.pushSubscriptions = db.pushSubscriptions.filter(s => !(s.userId === req.session.userId && s.subscription.endpoint === subscription.endpoint));
  db.pushSubscriptions.push({ userId: req.session.userId, subscription });
  writeDb(db);
  res.json({ ok: true });
});

app.post('/api/push/test', authRequired, (req, res) => {
  const db = readDb();
  const subs = db.pushSubscriptions.filter(s => s.userId === req.session.userId);
  const payload = JSON.stringify({
    title: 'Buddha Chat',
    body: 'Тестовый push работает.',
    url: '/',
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png'
  });
  Promise.allSettled(subs.map(s => webpush.sendNotification(s.subscription, payload))).then(results => {
    const ok = results.some(r => r.status === 'fulfilled');
    res.json({ ok, count: results.length });
  });
});

app.get('*', (_, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));

const online = new Map(); // userId => socket.id
io.on('connection', socket => {
  const session = socket.request.session;
  const userId = session && session.userId;
  if (!userId) return;

  online.set(userId, socket.id);
  socket.join('user:' + userId);

  socket.on('chat:join', chatId => {
    socket.join('chat:' + chatId);
  });

  socket.on('call:offer', ({ toUserId, offer, chatId }) => {
    io.to('user:' + toUserId).emit('call:offer', { fromUserId: userId, offer, chatId });
  });
  socket.on('call:answer', ({ toUserId, answer }) => {
    io.to('user:' + toUserId).emit('call:answer', { fromUserId: userId, answer });
  });
  socket.on('call:ice', ({ toUserId, candidate }) => {
    io.to('user:' + toUserId).emit('call:ice', { fromUserId: userId, candidate });
  });
  socket.on('call:end', ({ toUserId }) => {
    io.to('user:' + toUserId).emit('call:end', { fromUserId: userId });
  });

  socket.on('disconnect', () => {
    if (online.get(userId) === socket.id) online.delete(userId);
  });
});

server.listen(PORT, () => {
  console.log('Buddha Chat listening on ' + PORT);
});