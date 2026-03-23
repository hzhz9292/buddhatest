(() => {
  const socket = window.io ? window.io() : null;

  const state = {
    authMode: "login",
    currentUser: null,
    chats: [],
    currentChatId: null,
    currentPeer: null,
    messages: {},
    pushEnabled: false,
    activeView: "chats",
    incomingCall: null,
    outgoingCall: null
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    app: $("app"),
    authScreen: $("authScreen"),
    messengerScreen: $("messengerScreen"),
    authForm: $("authForm"),
    authUsername: $("authUsername"),
    authPassword: $("authPassword"),
    authSubmit: $("authSubmit"),
    authError: $("authError"),
    tabLogin: $("tabLogin"),
    tabRegister: $("tabRegister"),
    chatList: $("chatList"),
    emptyState: $("emptyState"),
    chatView: $("chatView"),
    messages: $("messages"),
    messageInput: $("messageInput"),
    composer: $("composer"),
    chatTitle: $("chatTitle"),
    chatStatus: $("chatStatus"),
    openSearchBtn: $("openSearchBtn"),
    closeSearchBtn: $("closeSearchBtn"),
    searchSheet: $("searchSheet"),
    searchSheetBackdrop: $("searchSheetBackdrop"),
    searchInput: $("searchInput"),
    searchBtn: $("searchBtn"),
    searchResult: $("searchResult"),
    navChats: $("navChats"),
    navSearch: $("navSearch"),
    navProfile: $("navProfile"),
    bottomNav: $("bottomNav"),
    profileSheet: $("profileSheet"),
    profileSheetBackdrop: $("profileSheetBackdrop"),
    closeProfileBtn: $("closeProfileBtn"),
    profileUsername: $("profileUsername"),
    enablePushBtn: $("enablePushBtn"),
    btnLogout: $("btnLogout"),
    backToChatsBtn: $("backToChatsBtn"),
    callBtn: $("callBtn"),
    callOverlay: $("callOverlay"),
    callOverlayTitle: $("callOverlayTitle"),
    callOverlaySubtitle: $("callOverlaySubtitle"),
    acceptCallBtn: $("acceptCallBtn"),
    declineCallBtn: $("declineCallBtn")
  };

  function setActiveAuthTab(mode) {
    state.authMode = mode;
    els.tabLogin.classList.toggle("segmented__item--active", mode === "login");
    els.tabRegister.classList.toggle("segmented__item--active", mode === "register");
    els.authSubmit.textContent = mode === "login" ? "Войти" : "Создать аккаунт";
    els.authError.textContent = "";
  }

  function formatTime(dateValue) {
    try {
      const d = new Date(dateValue);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text ?? "";
    return div.innerHTML;
  }

  function showAuth() {
    els.authScreen.classList.remove("hidden");
    els.messengerScreen.classList.add("hidden");
    els.bottomNav.classList.add("hidden");
  }

  function showMessenger() {
    els.authScreen.classList.add("hidden");
    els.messengerScreen.classList.remove("hidden");
    els.bottomNav.classList.remove("hidden");
    els.profileUsername.textContent = state.currentUser?.username || "—";
    renderChats();
    updateMobileView();
  }

  function updateMobileView() {
    const isChatOpen = window.innerWidth <= 900 && !!state.currentChatId;
    els.app.classList.toggle("chat-open", isChatOpen);
  }

  function setBottomNav(view) {
    state.activeView = view;
    els.navChats.classList.toggle("bottom-nav__item--active", view === "chats");
    els.navSearch.classList.toggle("bottom-nav__item--active", view === "search");
    els.navProfile.classList.toggle("bottom-nav__item--active", view === "profile");
  }

  function openSearchSheet() {
    els.searchSheet.classList.remove("hidden");
    setBottomNav("search");
    setTimeout(() => els.searchInput.focus(), 40);
  }

  function closeSearchSheet() {
    els.searchSheet.classList.add("hidden");
    setBottomNav("chats");
  }

  function openProfileSheet() {
    els.profileSheet.classList.remove("hidden");
    setBottomNav("profile");
  }

  function closeProfileSheet() {
    els.profileSheet.classList.add("hidden");
    setBottomNav("chats");
  }

  function renderChats() {
    const chats = Array.isArray(state.chats) ? state.chats : [];
    els.chatList.innerHTML = "";

    if (!chats.length) {
      els.chatList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">🫧</div>
          <div class="empty-state__title">Пока пусто</div>
          <div class="empty-state__text">Нажми “Новый чат” и найди пользователя.</div>
        </div>
      `;
      return;
    }

    chats.forEach((chat) => {
      const isActive = chat.id === state.currentChatId;
      const item = document.createElement("button");
      item.className = `chat-item ${isActive ? "chat-item--active" : ""}`;
      item.innerHTML = `
        <div class="chat-item__top">
          <div class="chat-item__name">${escapeHtml(chat.title || "Диалог")}</div>
          <div class="chat-item__time">${chat.updatedAt ? formatTime(chat.updatedAt) : ""}</div>
        </div>
        <div class="chat-item__last">${escapeHtml(chat.lastMessage || "Нет сообщений")}</div>
      `;
      item.addEventListener("click", () => openChat(chat));
      els.chatList.appendChild(item);
    });
  }

  function renderMessages() {
    const list = state.messages[state.currentChatId] || [];
    els.messages.innerHTML = "";

    list.forEach((msg) => {
      const mine = msg.senderUsername === state.currentUser?.username || msg.senderId === state.currentUser?.id;
      const node = document.createElement("div");
      node.className = `msg ${mine ? "msg--out" : "msg--in"}`;
      node.innerHTML = `
        <div class="msg__text">${escapeHtml(msg.text || "")}</div>
        <div class="msg__meta">${formatTime(msg.createdAt || Date.now())}</div>
      `;
      els.messages.appendChild(node);
    });

    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function openChat(chat) {
    state.currentChatId = chat.id;
    state.currentPeer = {
      id: chat.peerId,
      username: chat.title
    };

    els.chatTitle.textContent = chat.title || "Диалог";
    els.chatStatus.textContent = "online";
    els.emptyState.classList.add("hidden");
    els.chatView.classList.remove("hidden");

    renderChats();
    fetchMessages(chat.id);
    updateMobileView();
    closeSearchSheet();
    closeProfileSheet();
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });

    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      throw new Error(data.error || "Request failed");
    }

    return data;
  }

  async function restoreSession() {
    try {
      const me = await api("/api/me");
      if (me?.user) {
        state.currentUser = me.user;
        await refreshChats();
        showMessenger();
        bindSocketUser();
      } else {
        showAuth();
      }
    } catch {
      showAuth();
    }
  }

  async function refreshChats() {
    try {
      const data = await api("/api/chats");
      state.chats = Array.isArray(data.chats) ? data.chats : [];
      renderChats();

      if (state.currentChatId) {
        const actual = state.chats.find((c) => c.id === state.currentChatId);
        if (actual) {
          els.chatTitle.textContent = actual.title || "Диалог";
        }
      }
    } catch (e) {
      console.error("refreshChats error", e);
    }
  }

  async function fetchMessages(chatId) {
    try {
      const data = await api(`/api/chats/${chatId}/messages`);
      state.messages[chatId] = Array.isArray(data.messages) ? data.messages : [];
      renderMessages();
    } catch (e) {
      console.error("fetchMessages error", e);
    }
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    els.authError.textContent = "";

    const username = els.authUsername.value.trim();
    const password = els.authPassword.value.trim();

    if (!username || !password) {
      els.authError.textContent = "Заполни username и пароль.";
      return;
    }

    try {
      const path = state.authMode === "login" ? "/api/login" : "/api/register";
      const data = await api(path, {
        method: "POST",
        body: JSON.stringify({ username, password })
      });

      state.currentUser = data.user;
      els.authUsername.value = "";
      els.authPassword.value = "";
      await refreshChats();
      showMessenger();
      bindSocketUser();
    } catch (err) {
      els.authError.textContent = err.message || "Ошибка авторизации";
    }
  }

  async function handleSearch() {
    const username = els.searchInput.value.trim();
    els.searchResult.innerHTML = "";

    if (!username) return;

    try {
      const data = await api(`/api/users/search?username=${encodeURIComponent(username)}`);
      if (!data.user) {
        els.searchResult.innerHTML = `
          <div class="empty-state">
            <div class="empty-state__icon">🙃</div>
            <div class="empty-state__text">Пользователь не найден</div>
          </div>
        `;
        return;
      }

      const sameUser = data.user.username === state.currentUser?.username;
      const wrapper = document.createElement("div");
      wrapper.className = "search-user";
      wrapper.innerHTML = `
        <div class="search-user__meta">
          <div class="search-user__name">${escapeHtml(data.user.username)}</div>
          <div class="search-user__sub">${sameUser ? "Это ты" : "Нажми, чтобы начать диалог"}</div>
        </div>
      `;

      if (!sameUser) {
        const btn = document.createElement("button");
        btn.className = "primary-btn primary-btn--small";
        btn.textContent = "Написать";
        btn.addEventListener("click", async () => {
          try {
            const created = await api("/api/chats/start", {
              method: "POST",
              body: JSON.stringify({ username: data.user.username })
            });
            await refreshChats();

            const chat = (state.chats || []).find((c) => c.id === created.chat?.id) || created.chat;
            if (chat) openChat(chat);
          } catch (e) {
            console.error(e);
          }
        });
        wrapper.appendChild(btn);
      }

      els.searchResult.appendChild(wrapper);
    } catch (err) {
      els.searchResult.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__text">Ошибка поиска</div>
        </div>
      `;
    }
  }

  async function handleSendMessage(e) {
    e.preventDefault();

    const text = els.messageInput.value.trim();
    if (!text || !state.currentChatId) return;

    try {
      const sent = await api(`/api/chats/${state.currentChatId}/messages`, {
        method: "POST",
        body: JSON.stringify({ text })
      });

      els.messageInput.value = "";

      if (!state.messages[state.currentChatId]) state.messages[state.currentChatId] = [];
      if (sent.message) {
        state.messages[state.currentChatId].push(sent.message);
      }

      renderMessages();
      await refreshChats();

      if (socket) {
        socket.emit("chat:message", {
          chatId: state.currentChatId,
          message: sent.message
        });
      }
    } catch (e) {
      console.error("send message error", e);
    }
  }

  async function enablePush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return;
    }

    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const vapidData = await api("/api/push/public-key");
      const key = urlBase64ToUint8Array(vapidData.publicKey);

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key
        });
      }

      await api("/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify({ subscription: sub })
      });

      state.pushEnabled = true;
      els.enablePushBtn.textContent = "Уведомления включены";
    } catch (e) {
      console.error("enablePush error", e);
    }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/\-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  }

  async function logout() {
    try {
      await api("/api/logout", { method: "POST" });
    } catch {}
    location.reload();
  }

  function bindSocketUser() {
    if (!socket || !state.currentUser) return;
    socket.emit("auth", { userId: state.currentUser.id, username: state.currentUser.username });
  }

  function setupSocket() {
    if (!socket) return;

    socket.on("connect", () => {
      bindSocketUser();
    });

    socket.on("message:new", async (payload) => {
      if (!payload?.message || !payload?.chatId) return;

      if (!state.messages[payload.chatId]) state.messages[payload.chatId] = [];
      const alreadyExists = state.messages[payload.chatId].some((m) => m.id && payload.message.id && m.id === payload.message.id);
      if (!alreadyExists) {
        state.messages[payload.chatId].push(payload.message);
      }

      await refreshChats();

      if (state.currentChatId === payload.chatId) {
        renderMessages();
      }
    });

    socket.on("chat:refresh", async () => {
      await refreshChats();
    });

    socket.on("call:incoming", (payload) => {
      state.incomingCall = payload;
      els.callOverlay.classList.remove("hidden");
      els.callOverlayTitle.textContent = `Звонит ${payload?.fromUsername || "пользователь"}`;
      els.callOverlaySubtitle.textContent = "Входящий вызов";
      els.acceptCallBtn.classList.remove("hidden");
    });

    socket.on("call:ended", () => {
      state.incomingCall = null;
      state.outgoingCall = null;
      els.callOverlay.classList.add("hidden");
      els.acceptCallBtn.classList.add("hidden");
    });

    socket.on("call:accepted", () => {
      els.callOverlay.classList.remove("hidden");
      els.callOverlayTitle.textContent = "Звонок";
      els.callOverlaySubtitle.textContent = "Соединение установлено";
      els.acceptCallBtn.classList.add("hidden");
    });
  }

  async function startCall() {
    if (!state.currentPeer?.username) return;

    try {
      await api("/api/call/start", {
        method: "POST",
        body: JSON.stringify({ username: state.currentPeer.username })
      });

      els.callOverlay.classList.remove("hidden");
      els.callOverlayTitle.textContent = `Звоним ${state.currentPeer.username}`;
      els.callOverlaySubtitle.textContent = "Ожидание ответа...";
      els.acceptCallBtn.classList.add("hidden");
    } catch (e) {
      console.error("startCall error", e);
    }
  }

  async function acceptCall() {
    if (!state.incomingCall) return;
    try {
      await api("/api/call/accept", {
        method: "POST",
        body: JSON.stringify({ callId: state.incomingCall.callId })
      });

      els.callOverlayTitle.textContent = "Звонок";
      els.callOverlaySubtitle.textContent = "Соединение установлено";
      els.acceptCallBtn.classList.add("hidden");
    } catch (e) {
      console.error("acceptCall error", e);
    }
  }

  async function declineCall() {
    try {
      await api("/api/call/decline", {
        method: "POST",
        body: JSON.stringify({ callId: state.incomingCall?.callId || state.outgoingCall?.callId || null })
      });
    } catch {}
    els.callOverlay.classList.add("hidden");
    els.acceptCallBtn.classList.add("hidden");
    state.incomingCall = null;
    state.outgoingCall = null;
  }

  function bindEvents() {
    els.tabLogin.addEventListener("click", () => setActiveAuthTab("login"));
    els.tabRegister.addEventListener("click", () => setActiveAuthTab("register"));
    els.authForm.addEventListener("submit", handleAuthSubmit);

    els.openSearchBtn.addEventListener("click", openSearchSheet);
    els.closeSearchBtn.addEventListener("click", closeSearchSheet);
    els.searchSheetBackdrop.addEventListener("click", closeSearchSheet);
    els.searchBtn.addEventListener("click", handleSearch);

    els.navChats.addEventListener("click", () => {
      closeSearchSheet();
      closeProfileSheet();
      setBottomNav("chats");
    });

    els.navSearch.addEventListener("click", openSearchSheet);
    els.navProfile.addEventListener("click", openProfileSheet);

    els.closeProfileBtn.addEventListener("click", closeProfileSheet);
    els.profileSheetBackdrop.addEventListener("click", closeProfileSheet);
    els.enablePushBtn.addEventListener("click", enablePush);

    els.composer.addEventListener("submit", handleSendMessage);
    els.btnLogout.addEventListener("click", logout);
    els.backToChatsBtn.addEventListener("click", () => {
      state.currentChatId = null;
      els.chatView.classList.add("hidden");
      els.emptyState.classList.remove("hidden");
      updateMobileView();
      renderChats();
    });

    els.callBtn.addEventListener("click", startCall);
    els.acceptCallBtn.addEventListener("click", acceptCall);
    els.declineCallBtn.addEventListener("click", declineCall);

    window.addEventListener("resize", updateMobileView);
  }

  async function init() {
    setActiveAuthTab("login");
    bindEvents();
    setupSocket();
    await restoreSession();

    setInterval(async () => {
      if (state.currentUser) {
        await refreshChats();
        if (state.currentChatId) {
          await fetchMessages(state.currentChatId);
        }
      }
    }, 4000);
  }

  init();
})();
