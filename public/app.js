
let state = {
  me: null,
  currentChatId: null,
  currentPeer: null,
  socket: null,
  publicVapidKey: null,
  deviceChoice: localStorage.getItem('deviceChoice') || '',
  pc: null,
  pendingOffer: null,
  sending: false
};

const el = id => document.getElementById(id);
const deviceGate = el('deviceGate');
const installGuide = el('installGuide');
const authScreen = el('authScreen');
const mainScreen = el('mainScreen');
const sidebar = el('sidebar');
const chatPanel = el('chatPanel');
const settingsPanel = el('settingsPanel');
const messagesEl = el('messages');
const chatListEl = el('chatList');
const searchResultsEl = el('searchResults');
const profileInfo = el('profileInfo');
const userSearch = el('userSearch');
const pushStatus = el('pushStatus');
const guideList = el('guideList');
const guideTitle = el('guideTitle');
const messageInput = el('messageInput');
const fileInput = el('fileInput');

const iphoneGuide = [
  'Нажми кнопку «Поделиться» в Safari.',
  'Выбери «На экран Домой».',
  'Открой Buddha Chat с экрана Домой.',
  'Нажми «Включить уведомления» и разреши их.'
];
const androidGuide = [
  'Открой меню браузера.',
  'Нажми «Установить приложение» или «Добавить на главный экран».',
  'Запусти Buddha Chat с главного экрана.',
  'Нажми «Включить уведомления» и разреши их.'
];

document.querySelectorAll('[data-device]').forEach(btn => btn.addEventListener('click', () => {
  state.deviceChoice = btn.dataset.device;
  localStorage.setItem('deviceChoice', state.deviceChoice);
  showGuide();
}));

el('backToGate').onclick = () => showDeviceGate();
el('continueToAuth').onclick = () => {
  installGuide.classList.add('hidden');
  authScreen.classList.remove('hidden');
};
el('requestNotifications').onclick = async () => {
  const ok = await setupPush();
  pushStatus.textContent = ok ? 'Уведомления включены.' : 'Не удалось включить уведомления.';
};

function showGuide() {
  deviceGate.classList.add('hidden');
  installGuide.classList.remove('hidden');
  guideTitle.textContent = state.deviceChoice === 'iphone' ? 'iPhone' : 'Android';
  guideList.innerHTML = (state.deviceChoice === 'iphone' ? iphoneGuide : androidGuide).map(x => `<li>${x}</li>`).join('');
}
function showDeviceGate() {
  deviceGate.classList.remove('hidden');
  installGuide.classList.add('hidden');
  authScreen.classList.add('hidden');
}
if (state.deviceChoice) showGuide();

el('tabLogin').onclick = () => toggleAuth('login');
el('tabRegister').onclick = () => toggleAuth('register');
function toggleAuth(tab) {
  el('tabLogin').classList.toggle('active', tab === 'login');
  el('tabRegister').classList.toggle('active', tab === 'register');
  el('loginForm').classList.toggle('active', tab === 'login');
  el('registerForm').classList.toggle('active', tab === 'register');
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : {'Content-Type': 'application/json'}),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'request_failed');
  return data;
}

el('registerForm').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const data = await api('/api/register', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
    state.me = data.user;
    afterAuth();
  } catch (err) {
    el('authError').textContent = 'Регистрация не удалась: ' + err.message;
  }
});
el('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const data = await api('/api/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
    state.me = data.user;
    afterAuth();
  } catch (err) {
    el('authError').textContent = 'Вход не удался: ' + err.message;
  }
});

async function afterAuth() {
  authScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
  profileInfo.innerHTML = `<p><strong>${state.me.username}</strong></p><p class="muted">${state.me.email || 'Без email'}</p>`;
  await loadChats();
  await setupPush();
  initSocket();
}

async function loadMe() {
  try {
    const { user } = await api('/api/me');
    if (user) {
      state.me = user;
      mainScreen.classList.remove('hidden');
      deviceGate.classList.add('hidden');
      installGuide.classList.add('hidden');
      authScreen.classList.add('hidden');
      profileInfo.innerHTML = `<p><strong>${state.me.username}</strong></p><p class="muted">${state.me.email || 'Без email'}</p>`;
      await loadChats();
      await setupPush();
      initSocket();
    } else if (state.deviceChoice) {
      installGuide.classList.remove('hidden');
      deviceGate.classList.add('hidden');
    } else {
      showDeviceGate();
    }
  } catch {
    showDeviceGate();
  }
}

async function loadChats() {
  const { chats } = await api('/api/chats');
  chatListEl.innerHTML = chats.map(c => `
    <div class="chat-card ${state.currentChatId === c.id ? 'active' : ''}" data-chat-id="${c.id}" data-peer-id="${c.otherUser?.id || ''}" data-peer-name="${c.otherUser?.username || ''}">
      <div><strong>${c.otherUser?.username || 'Чат'}</strong></div>
      <div class="muted">${c.lastMessage?.text || 'Нет сообщений'}</div>
    </div>
  `).join('');
  chatListEl.querySelectorAll('.chat-card').forEach(card => card.onclick = () => openChat(Number(card.dataset.chatId), {id: card.dataset.peerId, username: card.dataset.peerName}));
}

userSearch.addEventListener('input', async () => {
  const q = userSearch.value.trim();
  if (!q) return searchResultsEl.innerHTML = '';
  const { users } = await api('/api/users/search?q=' + encodeURIComponent(q));
  searchResultsEl.innerHTML = users.map(u => `<div class="result-card" data-username="${u.username}" data-user-id="${u.id}">${u.username}</div>`).join('');
  searchResultsEl.querySelectorAll('.result-card').forEach(card => card.onclick = async () => {
    const { chatId, otherUser } = await api('/api/chats/open', { method: 'POST', body: JSON.stringify({ username: card.dataset.username }) });
    await loadChats();
    openChat(chatId, otherUser);
    userSearch.value = '';
    searchResultsEl.innerHTML = '';
  });
});

async function openChat(chatId, peer) {
  state.currentChatId = chatId;
  state.currentPeer = peer;
  el('chatTitle').textContent = peer.username || 'Чат';
  chatPanel.classList.add('open');
  settingsPanel.classList.remove('open');
  await loadMessages();
  if (state.socket) state.socket.emit('chat:join', chatId);
}

async function loadMessages() {
  if (!state.currentChatId) return;
  const { messages } = await api(`/api/chats/${state.currentChatId}/messages`);
  renderMessages(messages);
}

function renderMessages(list) {
  messagesEl.innerHTML = list.map(m => {
    const mine = m.senderId === state.me.id;
    let extra = '';
    if (m.fileUrl) extra = `<a class="file-link" target="_blank" href="${m.fileUrl}">${m.fileName || 'Файл'}</a>`;
    return `<div class="bubble ${mine ? 'me' : 'them'}" data-id="${m.id}">
      <div>${escapeHtml(m.text || '')}</div>${extra}
      <span class="meta">${new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} ${mine ? `<button class="ghost deleteBtn" data-id="${m.id}">удалить</button>` : ''}</span>
    </div>`;
  }).join('');
  messagesEl.querySelectorAll('.deleteBtn').forEach(btn => btn.onclick = async () => {
    await api('/api/messages/' + btn.dataset.id, { method: 'DELETE' });
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'": '&#39;'}[m]));
}

el('composer').addEventListener('submit', async e => {
  e.preventDefault();
  if (state.sending || !state.currentChatId) return;
  state.sending = true;
  const fd = new FormData();
  fd.append('text', messageInput.value.trim());
  if (fileInput.files[0]) fd.append('file', fileInput.files[0]);
  messageInput.value = '';
  fileInput.value = '';
  try {
    await fetch(`/api/chats/${state.currentChatId}/messages`, { method: 'POST', body: fd, credentials: 'include' });
    await loadMessages();
    await loadChats();
  } finally {
    setTimeout(() => state.sending = false, 300);
  }
});

el('logoutBtn').onclick = async () => {
  await api('/api/logout', { method: 'POST' });
  location.reload();
};

document.querySelectorAll('.nav-btn').forEach(btn => btn.onclick = () => {
  const target = btn.dataset.nav;
  document.querySelectorAll('.nav-btn').forEach(x => x.classList.toggle('active', x === btn));
  if (target === 'settings') {
    settingsPanel.classList.add('open');
    chatPanel.classList.remove('open');
  } else {
    settingsPanel.classList.remove('open');
  }
});
el('mobileBack').onclick = () => chatPanel.classList.remove('open');

async function setupPush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const cfg = await api('/api/config');
    state.publicVapidKey = cfg.vapidPublicKey;
    const reg = await navigator.serviceWorker.register('/sw.js');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(state.publicVapidKey)
      });
    }
    await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub }) });
    return true;
  } catch (e) {
    console.warn(e);
    return false;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

el('testPushBtn').onclick = async () => {
  try {
    const data = await api('/api/push/test', { method: 'POST' });
    alert(data.ok ? 'Тестовый push отправлен' : 'Тестовый push не отправился');
  } catch {
    alert('Тестовый push не отправился');
  }
};

function initSocket() {
  if (state.socket) return;
  state.socket = io({ withCredentials: true });
  state.socket.on('message:new', msg => {
    if (msg.chatId === state.currentChatId) loadMessages();
    loadChats();
  });
  state.socket.on('message:deleted', () => {
    if (state.currentChatId) loadMessages();
    loadChats();
  });
  state.socket.on('call:offer', async ({ fromUserId, offer }) => {
    state.pendingOffer = { fromUserId, offer };
    el('callOverlay').classList.remove('hidden');
    el('acceptCallBtn').classList.remove('hidden');
    el('callStatus').textContent = 'Входящий звонок';
    el('callPeer').textContent = 'Пользователь хочет позвонить';
  });
  state.socket.on('call:answer', async ({ answer }) => {
    if (state.pc) await state.pc.setRemoteDescription(answer);
    el('callStatus').textContent = 'На связи';
  });
  state.socket.on('call:ice', async ({ candidate }) => {
    if (state.pc && candidate) await state.pc.addIceCandidate(candidate);
  });
  state.socket.on('call:end', () => endCall(false));
}

async function preparePeerConnection(toUserId) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  state.pc = pc;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  el('localAudio').srcObject = stream;
  stream.getTracks().forEach(track => pc.addTrack(track, stream));
  pc.ontrack = e => el('remoteAudio').srcObject = e.streams[0];
  pc.onicecandidate = e => {
    if (e.candidate) state.socket.emit('call:ice', { toUserId, candidate: e.candidate });
  };
  return pc;
}

el('callBtn').onclick = async () => {
  if (!state.currentPeer?.id) return;
  el('callOverlay').classList.remove('hidden');
  el('acceptCallBtn').classList.add('hidden');
  el('callStatus').textContent = 'Исходящий звонок';
  el('callPeer').textContent = state.currentPeer.username;
  const pc = await preparePeerConnection(state.currentPeer.id);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  state.socket.emit('call:offer', { toUserId: state.currentPeer.id, offer, chatId: state.currentChatId });
};

el('acceptCallBtn').onclick = async () => {
  if (!state.pendingOffer) return;
  const pc = await preparePeerConnection(state.pendingOffer.fromUserId);
  await pc.setRemoteDescription(state.pendingOffer.offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  state.socket.emit('call:answer', { toUserId: state.pendingOffer.fromUserId, answer });
  el('acceptCallBtn').classList.add('hidden');
  el('callStatus').textContent = 'На связи';
};

el('endCallBtn').onclick = () => endCall(true);
function endCall(emit = true) {
  if (state.pc) {
    state.pc.getSenders().forEach(s => s.track && s.track.stop());
    state.pc.close();
    state.pc = null;
  }
  el('remoteAudio').srcObject = null;
  el('localAudio').srcObject = null;
  el('callOverlay').classList.add('hidden');
  if (emit && state.currentPeer?.id && state.socket) state.socket.emit('call:end', { toUserId: state.currentPeer.id });
}

loadMe();
