import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  apiCreateGroup,
  apiDeleteStatus,
  apiGroupMessages,
  apiInbox,
  apiLogin,
  apiMarkDirectRead,
  apiMarkGroupRead,
  apiMe,
  apiMessages,
  apiPatchMe,
  apiPostStatus,
  apiPresence,
  apiRegister,
  apiStatuses,
  apiUploadMedia,
  apiUsers,
} from './api';
import type { ChatMessage, InboxGroup, InboxPayload, StatusRow, User } from './types';
import { useWebRtcCall } from './useWebRtcCall';

const TOKEN_KEY = 'ayman_chat_token';

function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** وقت في قائمة المحادثات — مثل واتساب */
function formatChatListTime(iso: string) {
  try {
    const d = new Date(iso);
    const now = new Date();
    if (startOfDay(d) === startOfDay(now)) {
      return d.toLocaleTimeString('ar-SA', { hour: 'numeric', minute: '2-digit' });
    }
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    if (startOfDay(d) === startOfDay(y)) return 'أمس';
    return d.toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

function formatTimeShort(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('ar-SA', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

/** سطر الحالة تحت الاسم — بصياغة قريبة من واتساب */
function formatLastSeenWa(iso: string | undefined, online: boolean) {
  if (online) return 'متصل';
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const now = new Date();
    const t = formatTimeShort(iso);
    if (startOfDay(d) === startOfDay(now)) return `آخر ظهور اليوم ${t}`;
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    if (startOfDay(d) === startOfDay(y)) return `آخر ظهور أمس ${t}`;
    return `آخر ظهور ${d.toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' })} ${t}`;
  } catch {
    return '';
  }
}

/** معاينة آخر رسالة — أنت: / اسم: في المجموعة */
function inboxPreviewLast(
  m: ChatMessage | null,
  meId: number,
  userById: Record<number, User | undefined>,
  isGroup: boolean
) {
  if (!m) return 'اضغط للمحادثة';
  const raw =
    m.kind === 'image'
      ? m.text
        ? `📷 ${m.text}`
        : 'صورة'
      : (m.text || '').slice(0, 72) + ((m.text || '').length > 72 ? '…' : '');
  if (isGroup) {
    const who =
      m.fromUserId === meId ? 'أنت' : userById[m.fromUserId]?.displayName || 'عضو';
    return `${who}: ${raw}`;
  }
  if (m.fromUserId === meId) return `أنت: ${raw}`;
  return raw;
}

function daySeparatorLabel(d: Date) {
  const now = new Date();
  if (startOfDay(d) === startOfDay(now)) return 'اليوم';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (startOfDay(d) === startOfDay(y)) return 'أمس';
  return d.toLocaleDateString('ar-SA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

type TimelineItem =
  | { kind: 'sep'; key: string; label: string }
  | { kind: 'msg'; msg: ChatMessage };

function buildMessageTimeline(messages: ChatMessage[]): TimelineItem[] {
  const sorted = [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const out: TimelineItem[] = [];
  let lastDay = '';
  for (const m of sorted) {
    const d = new Date(m.createdAt);
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (dayKey !== lastDay) {
      lastDay = dayKey;
      out.push({ kind: 'sep', key: `sep-${m.id}-${dayKey}`, label: daySeparatorLabel(d) });
    }
    out.push({ kind: 'msg', msg: m });
  }
  return out;
}

/** ترتيب واتساب: محادثات ← تحديثات ← مجتمعات ← مكالمات */
type MainTab = 'chats' | 'updates' | 'communities' | 'calls';

export default function App() {
  const [token, setToken] = useState<string | null>(() => loadToken());
  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [inbox, setInbox] = useState<InboxPayload | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>('chats');
  const [activePeer, setActivePeer] = useState<User | null>(null);
  const [activeGroup, setActiveGroup] = useState<InboxGroup['group'] | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [onlineMap, setOnlineMap] = useState<Record<number, boolean>>({});
  const [lastSeenMap, setLastSeenMap] = useState<Record<string, string>>({});
  const [typingLabel, setTypingLabel] = useState<string | null>(null);

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  const [profileOpen, setProfileOpen] = useState(false);
  const [pName, setPName] = useState('');
  const [pAbout, setPAbout] = useState('');

  const [groupOpen, setGroupOpen] = useState(false);
  const [gName, setGName] = useState('');
  const [gPick, setGPick] = useState<Record<number, boolean>>({});

  const [statuses, setStatuses] = useState<StatusRow[]>([]);
  const [statusDraft, setStatusDraft] = useState('');
  const [chatFilter, setChatFilter] = useState('');
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadSearchQuery, setThreadSearchQuery] = useState('');
  const [socketConn, setSocketConn] = useState<
    'connecting' | 'connected' | 'reconnecting' | 'disconnected' | null
  >(null);

  const meRef = useRef<User | null>(null);
  const activePeerRef = useRef<User | null>(null);
  const activeGroupRef = useRef<InboxGroup['group'] | null>(null);
  useEffect(() => {
    meRef.current = me;
  }, [me]);
  useEffect(() => {
    activePeerRef.current = activePeer;
  }, [activePeer]);
  useEffect(() => {
    activeGroupRef.current = activeGroup;
  }, [activeGroup]);

  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, []);

  const socket: Socket | null = useMemo(() => {
    if (!token) return null;
    return io({
      path: '/socket.io',
      auth: { token },
      autoConnect: true,
      /* polling أولاً يمر عبر وكيل Vite بثبات ثم الترقية لـ websocket */
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
      timeout: 25000,
    });
  }, [token]);

  const call = useWebRtcCall({
    socket,
    selfId: me?.id ?? null,
    isGroup: Boolean(activeGroup),
    onError: (msg) => setError(msg),
  });

  const refreshInbox = useCallback(async (t: string) => {
    const data = await apiInbox(t);
    setInbox(data);
  }, []);

  const refreshPresence = useCallback(async (t: string) => {
    const p = await apiPresence(t);
    const on: Record<number, boolean> = {};
    for (const id of p.online) on[id] = true;
    setOnlineMap(on);
    setLastSeenMap(p.lastSeen || {});
  }, []);

  const refreshUsers = useCallback(async (t: string) => {
    const { users: list } = await apiUsers(t);
    setUsers(list);
  }, []);

  const refreshStatuses = useCallback(async (t: string) => {
    const { statuses: s } = await apiStatuses(t);
    setStatuses(s);
  }, []);

  useEffect(() => {
    if (!token) {
      setMe(null);
      setUsers([]);
      setInbox(null);
      setActivePeer(null);
      setActiveGroup(null);
      setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { user } = await apiMe(token);
        if (cancelled) return;
        setMe(user);
        await Promise.all([refreshUsers(token), refreshInbox(token), refreshPresence(token)]);
      } catch {
        if (cancelled) return;
        saveToken(null);
        setToken(null);
        setError('انتهت الجلسة، سجّل الدخول من جديد');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, refreshUsers, refreshInbox, refreshPresence]);

  useEffect(() => {
    if (!token || mainTab !== 'updates') return;
    let cancelled = false;
    (async () => {
      try {
        await refreshStatuses(token);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'خطأ');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, mainTab, refreshStatuses]);

  useEffect(() => {
    if (!socket) {
      setSocketConn(null);
      return;
    }
    setSocketConn(socket.connected ? 'connected' : 'connecting');
    const onConnect = () => setSocketConn('connected');
    const onDisconnect = () => setSocketConn('disconnected');
    const onReconnectAttempt = () => setSocketConn('reconnecting');
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
    };
  }, [socket]);

  useEffect(() => {
    setThreadSearchQuery('');
    setThreadSearchOpen(false);
  }, [activePeer?.id, activeGroup?.id]);

  useEffect(() => {
    if (!socket) return;

    const onNew = (msg: ChatMessage) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        const self = meRef.current;
        const peer = activePeerRef.current;
        const grp = activeGroupRef.current;
        if (grp && msg.groupId === grp.id) {
          return [...prev, msg].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
        }
        if (peer && !msg.groupId && self) {
          const involves =
            (msg.fromUserId === self.id && msg.toUserId === peer.id) ||
            (msg.fromUserId === peer.id && msg.toUserId === self.id);
          if (!involves) return prev;
          return [...prev, msg].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
        }
        return prev;
      });
      const t = token;
      if (t) void refreshInbox(t);
    };

    const onPresence = (p: { userId: number; online: boolean; lastSeen: string | null }) => {
      setOnlineMap((prev) => ({ ...prev, [p.userId]: p.online }));
      if (!p.online && p.lastSeen) {
        setLastSeenMap((prev) => ({ ...prev, [String(p.userId)]: p.lastSeen! }));
      }
    };

    const onTyping = (payload: {
      fromUserId: number;
      typing: boolean;
      toUserId?: number;
      groupId?: number;
    }) => {
      const self = meRef.current;
      const peer = activePeerRef.current;
      const grp = activeGroupRef.current;
      if (!self || payload.fromUserId === self.id) return;
      if (grp && payload.groupId === grp.id) {
        setTypingLabel(payload.typing ? 'أحد الأعضاء يكتب…' : null);
        return;
      }
      if (peer && !payload.groupId && peer.id === payload.fromUserId) {
        setTypingLabel(payload.typing ? `${peer.displayName} يكتب…` : null);
      }
    };

    socket.on('message:new', onNew);
    socket.on('presence:update', onPresence);
    socket.on('typing', onTyping);
    return () => {
      socket.off('message:new', onNew);
      socket.off('presence:update', onPresence);
      socket.off('typing', onTyping);
      socket.disconnect();
    };
  }, [socket, token, refreshInbox]);

  useEffect(() => {
    if (!token || !activePeer) {
      if (!activeGroup) setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { messages: list } = await apiMessages(token, activePeer.id);
        if (cancelled) return;
        setMessages(list);
        await apiMarkDirectRead(token, activePeer.id);
        await refreshInbox(token);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'تعذر تحميل الرسائل');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, activePeer, refreshInbox]);

  useEffect(() => {
    if (!token || !activeGroup) {
      if (!activePeer) setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { messages: list } = await apiGroupMessages(token, activeGroup.id);
        if (cancelled) return;
        setMessages(list);
        await apiMarkGroupRead(token, activeGroup.id);
        await refreshInbox(token);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'تعذر تحميل المجموعة');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, activeGroup, refreshInbox]);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { token: t, user } = await apiLogin({ username, password });
      saveToken(t);
      setToken(t);
      setMe(user);
      await Promise.all([refreshUsers(t), refreshInbox(t), refreshPresence(t)]);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ');
    } finally {
      setBusy(false);
    }
  }

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { token: t, user } = await apiRegister({
        username,
        password,
        displayName: displayName || username,
      });
      saveToken(t);
      setToken(t);
      setMe(user);
      await Promise.all([refreshUsers(t), refreshInbox(t), refreshPresence(t)]);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ');
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    saveToken(null);
    setToken(null);
    setMe(null);
    setUsers([]);
    setInbox(null);
    setActivePeer(null);
    setActiveGroup(null);
    setMessages([]);
    setError(null);
    setMainTab('chats');
  }

  function emitTyping(typing: boolean) {
    if (!socket || !me) return;
    if (activeGroup) {
      socket.emit('typing', { groupId: activeGroup.id, typing });
      return;
    }
    if (activePeer) {
      socket.emit('typing', { toUserId: activePeer.id, typing });
    }
  }

  function scheduleTypingPing() {
    emitTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => emitTyping(false), 1600);
  }

  function openDirect(peer: User) {
    setActiveGroup(null);
    setActivePeer(peer);
    setTypingLabel(null);
    setMainTab('chats');
  }

  function openGroup(g: InboxGroup['group']) {
    setActivePeer(null);
    setActiveGroup(g);
    setTypingLabel(null);
    setMainTab('chats');
  }

  function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!socket || !me) return;
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    emitTyping(false);
    if (activeGroup) {
      socket.emit('message:send', { groupId: activeGroup.id, text }, ackHandler);
      return;
    }
    if (activePeer) {
      socket.emit('message:send', { toUserId: activePeer.id, text }, ackHandler);
    }
  }

  function ackHandler(ack: { ok?: boolean; error?: string }) {
    if (ack && ack.ok === false) setError(ack.error || 'تعذر الإرسال');
  }

  async function onPickImage(file: File | null) {
    if (!file || !token || !socket) return;
    if (!file.type.startsWith('image/')) {
      setError('اختر ملف صورة');
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('قراءة الملف فشلت'));
        r.readAsDataURL(file);
      });
      const { url } = await apiUploadMedia(token, dataUrl);
      if (activeGroup) {
        socket.emit(
          'message:send',
          { groupId: activeGroup.id, kind: 'image', imageUrl: url, text: draft.trim() },
          ackHandler
        );
      } else if (activePeer) {
        socket.emit(
          'message:send',
          { toUserId: activePeer.id, kind: 'image', imageUrl: url, text: draft.trim() },
          ackHandler
        );
      }
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل الرفع');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    try {
      const { user } = await apiPatchMe(token, { displayName: pName, about: pAbout });
      setMe(user);
      setProfileOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ');
    } finally {
      setBusy(false);
    }
  }

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    const memberIds = Object.entries(gPick)
      .filter(([, v]) => v)
      .map(([k]) => Number(k));
    setBusy(true);
    try {
      await apiCreateGroup(token, { name: gName, memberIds });
      setGroupOpen(false);
      setGName('');
      setGPick({});
      await refreshInbox(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ');
    } finally {
      setBusy(false);
    }
  }

  async function publishStatus(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    try {
      await apiPostStatus(token, statusDraft.trim());
      setStatusDraft('');
      await refreshStatuses(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ');
    } finally {
      setBusy(false);
    }
  }

  async function clearMyStatus() {
    if (!token) return;
    setBusy(true);
    try {
      await apiDeleteStatus(token);
      await refreshStatuses(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ');
    } finally {
      setBusy(false);
    }
  }

  const mergedChats = useMemo(() => {
    if (!inbox) return [];
    const rows: Array<
      | { kind: 'direct'; updatedAt: string; row: InboxPayload['directs'][number] }
      | { kind: 'group'; updatedAt: string; row: InboxPayload['groups'][number] }
    > = [];
    for (const d of inbox.directs) rows.push({ kind: 'direct', updatedAt: d.updatedAt, row: d });
    for (const g of inbox.groups) rows.push({ kind: 'group', updatedAt: g.updatedAt, row: g });
    rows.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return rows;
  }, [inbox]);

  const userById = useMemo(() => {
    const m: Record<number, User | undefined> = {};
    if (me) m[me.id] = me;
    for (const u of users) m[u.id] = u;
    return m;
  }, [me, users]);

  const filteredMergedChats = useMemo(() => {
    const q = chatFilter.trim().toLowerCase();
    if (!q) return mergedChats;
    return mergedChats.filter((item) => {
      if (item.kind === 'direct') {
        const p = item.row.peer;
        return p.displayName.toLowerCase().includes(q) || p.username.toLowerCase().includes(q);
      }
      return item.row.group.name.toLowerCase().includes(q);
    });
  }, [mergedChats, chatFilter]);

  const filteredThreadMessages = useMemo(() => {
    const q = threadSearchQuery.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => (m.text || '').toLowerCase().includes(q));
  }, [messages, threadSearchQuery]);

  const messageTimeline = useMemo(
    () => buildMessageTimeline(filteredThreadMessages),
    [filteredThreadMessages]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messageTimeline, activePeer?.id, activeGroup?.id]);

  const threadTitle = activeGroup
    ? activeGroup.name
    : activePeer
      ? activePeer.displayName
      : '';

  const threadSubtitle = (() => {
    if (typingLabel) return typingLabel;
    if (activeGroup) return `${activeGroup.memberIds.length} مشاركين`;
    if (!activePeer) return '';
    const ls = lastSeenMap[String(activePeer.id)] || activePeer.lastSeen;
    return formatLastSeenWa(ls, Boolean(onlineMap[activePeer.id]));
  })();

  if (!token || !me) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="brand">
            <div className="logo" aria-hidden>
              AC
            </div>
            <div>
              <h1>Ayman Chat</h1>
              <p className="muted">محادثات، مجموعات، حالة — نسخة ويب</p>
            </div>
          </div>

          <div className="tabs">
            <button
              type="button"
              className={mode === 'login' ? 'tab active' : 'tab'}
              onClick={() => setMode('login')}
            >
              دخول
            </button>
            <button
              type="button"
              className={mode === 'register' ? 'tab active' : 'tab'}
              onClick={() => setMode('register')}
            >
              حساب جديد
            </button>
          </div>

          {mode === 'login' ? (
            <form className="form" onSubmit={onLogin}>
              <label>
                اسم المستخدم
                <input
                  data-testid="auth-username"
                  value={username}
                  onChange={(ev) => setUsername(ev.target.value)}
                  autoComplete="username"
                  dir="ltr"
                />
              </label>
              <label>
                كلمة المرور
                <input
                  data-testid="auth-password"
                  type="password"
                  value={password}
                  onChange={(ev) => setPassword(ev.target.value)}
                  autoComplete="current-password"
                  dir="ltr"
                />
              </label>
              <button className="primary" type="submit" disabled={busy} data-testid="auth-submit-login">
                {busy ? 'جاري الدخول…' : 'دخول'}
              </button>
            </form>
          ) : (
            <form className="form" onSubmit={onRegister}>
              <label>
                اسم المستخدم (إنجليزي صغير، أرقام، _)
                <input
                  data-testid="auth-username"
                  value={username}
                  onChange={(ev) => setUsername(ev.target.value)}
                  autoComplete="username"
                  dir="ltr"
                />
              </label>
              <label>
                الاسم الظاهر
                <input
                  data-testid="auth-display"
                  value={displayName}
                  onChange={(ev) => setDisplayName(ev.target.value)}
                  autoComplete="name"
                />
              </label>
              <label>
                كلمة المرور (6 أحرف فأكثر)
                <input
                  data-testid="auth-password"
                  type="password"
                  value={password}
                  onChange={(ev) => setPassword(ev.target.value)}
                  autoComplete="new-password"
                  dir="ltr"
                />
              </label>
              <button className="primary" type="submit" disabled={busy} data-testid="auth-submit-register">
                {busy ? 'جاري إنشاء الحساب…' : 'إنشاء حساب'}
              </button>
            </form>
          )}

          {error ? <div className="alert">{error}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="app wa-app">
      {socketConn && socketConn !== 'connected' ? (
        <div className={`wa-socket-banner wa-socket-${socketConn}`} role="status" aria-live="polite">
          {socketConn === 'connecting' ? 'جاري الاتصال بالخادم…' : null}
          {socketConn === 'disconnected'
            ? 'انقطع الاتصال — سيتم إعادة المحاولة تلقائياً'
            : null}
          {socketConn === 'reconnecting' ? 'جاري إعادة الاتصال…' : null}
        </div>
      ) : null}
      <div className="wa-shell">
        <main className="layout wa-layout">
          <aside className="sidebar wa-sidebar">
            <div className="wa-sidebar-top">
              <div className="wa-sidebar-brand-row">
                <button
                  type="button"
                  className="wa-me-avatar"
                  title="الملف الشخصي"
                  onClick={() => {
                    setPName(me.displayName);
                    setPAbout(me.about || '');
                    setProfileOpen(true);
                  }}
                >
                  {me.displayName.slice(0, 1)}
                </button>
                <div className="wa-brand-block">
                  <div className="wa-brand-title">Ayman Chat</div>
                  <div className="wa-brand-sub muted tiny" dir="ltr">
                    @{me.username}
                  </div>
                </div>
                <span className="wa-brand-spacer" />
                <button type="button" className="wa-sidebar-ic" title="مجموعة جديدة" onClick={() => setGroupOpen(true)}>
                  👥
                </button>
                <button
                  type="button"
                  className="wa-sidebar-ic"
                  title="الإعدادات"
                  onClick={() => {
                    setPName(me.displayName);
                    setPAbout(me.about || '');
                    setProfileOpen(true);
                  }}
                >
                  ⚙
                </button>
                <button type="button" className="wa-sidebar-ic wa-sidebar-ic-out" title="خروج" onClick={logout}>
                  ⎋
                </button>
              </div>
              {mainTab === 'chats' ? (
                <div className="wa-search-row">
                  <label className="wa-search-label">
                    <span className="wa-sr-only">بحث</span>
                    <span className="wa-search-lead" aria-hidden>
                      🔍
                    </span>
                    <input
                      className="wa-search-field"
                      value={chatFilter}
                      onChange={(e) => setChatFilter(e.target.value)}
                      placeholder="ابدأ محادثة أو ابحث…"
                      dir="auto"
                    />
                  </label>
                </div>
              ) : null}
            </div>

            <div className="wa-sidebar-body">
          {mainTab === 'chats' ? (
            <>
              <div className="user-list wa-chat-list">
                {!inbox ? (
                  <div className="muted pad">جاري التحميل…</div>
                ) : filteredMergedChats.length === 0 ? (
                  <div className="muted pad">
                    {mergedChats.length === 0
                      ? 'لا محادثات بعد. أنشئ حساباً ثانياً أو مجموعة للبدء.'
                      : 'لا نتائج للبحث.'}
                  </div>
                ) : (
                  filteredMergedChats.map((item) => {
                    if (item.kind === 'direct') {
                      const d = item.row;
                      const active = activePeer?.id === d.peer.id && !activeGroup;
                      const t = d.lastMessage ? formatChatListTime(d.lastMessage.createdAt) : formatChatListTime(d.updatedAt);
                      return (
                        <button
                          key={`d-${d.peer.id}`}
                          type="button"
                          className={active ? 'wa-chat-row active' : 'wa-chat-row'}
                          onClick={() => openDirect(d.peer)}
                        >
                          <div className="wa-chat-avatar avatar">{d.peer.displayName.slice(0, 1)}</div>
                          <div className="wa-chat-main">
                            <div className="wa-chat-line1">
                              <span className="user-name wa-chat-name">{d.peer.displayName}</span>
                            </div>
                            <div className="wa-chat-line2">
                              <span className="wa-chat-preview muted small">
                                {inboxPreviewLast(d.lastMessage, me.id, userById, false)}
                              </span>
                            </div>
                          </div>
                          <div className="wa-chat-meta">
                            <span className="wa-chat-time muted tiny">{t}</span>
                            {d.unread > 0 ? <span className="badge wa-chat-badge">{d.unread}</span> : <span className="wa-meta-spacer" />}
                          </div>
                        </button>
                      );
                    }
                    const g = item.row;
                    const active = activeGroup?.id === g.group.id && !activePeer;
                    const t = g.lastMessage ? formatChatListTime(g.lastMessage.createdAt) : formatChatListTime(g.updatedAt);
                    return (
                      <button
                        key={`g-${g.group.id}`}
                        type="button"
                        className={active ? 'wa-chat-row active' : 'wa-chat-row'}
                        onClick={() => openGroup(g.group)}
                      >
                        <div className="wa-chat-avatar avatar group">👥</div>
                        <div className="wa-chat-main">
                          <div className="wa-chat-line1">
                            <span className="user-name wa-chat-name">{g.group.name}</span>
                          </div>
                          <div className="wa-chat-line2">
                            <span className="wa-chat-preview muted small">
                              {inboxPreviewLast(g.lastMessage, me.id, userById, true)}
                            </span>
                          </div>
                        </div>
                        <div className="wa-chat-meta">
                          <span className="wa-chat-time muted tiny">{t}</span>
                          {g.unread > 0 ? <span className="badge wa-chat-badge">{g.unread}</span> : <span className="wa-meta-spacer" />}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          ) : null}

          {mainTab === 'updates' ? (
            <div className="status-aside wa-updates">
              <div className="sidebar-head wa-list-toolbar">
                <span className="wa-toolbar-title">التحديثات</span>
              </div>
              <div className="pad wa-updates-inner">
                <div className="wa-updates-my-row">
                  <div className="wa-status-ring avatar">{me.displayName.slice(0, 1)}</div>
                  <div className="grow">
                    <div className="user-name">حالتي</div>
                    <div className="muted small">اضغط لإضافة تحديث</div>
                  </div>
                </div>
                <form className="stack wa-status-form" onSubmit={publishStatus}>
                  <label className="muted small">نص التحديث (يختفي بعد 24 ساعة)</label>
                  <textarea
                    rows={3}
                    value={statusDraft}
                    onChange={(ev) => setStatusDraft(ev.target.value)}
                    maxLength={300}
                    placeholder="ماذا تفكر؟"
                  />
                  <div className="row gap">
                    <button className="primary wa-pill-btn" type="submit" disabled={busy || !statusDraft.trim()}>
                      نشر
                    </button>
                    <button type="button" className="ghost wa-pill-btn" onClick={clearMyStatus} disabled={busy}>
                      حذف تحديثي
                    </button>
                  </div>
                </form>
                <div className="divider" />
                <div className="wa-section-label muted small">آخر التحديثات</div>
                <div className="status-list wa-status-feed">
                  {statuses.length === 0 ? (
                    <div className="muted pad">لا توجد تحديثات بعد.</div>
                  ) : (
                    statuses.map((s) => (
                      <div key={`${s.userId}-${s.createdAt}`} className="status-card wa-status-card">
                        <div className="wa-status-card-head">
                          <div className="avatar wa-status-avatar">{s.author?.displayName.slice(0, 1) || '؟'}</div>
                          <div className="grow">
                            <strong>{s.author?.displayName || 'مستخدم'}</strong>
                            <div className="muted tiny">{formatChatListTime(s.createdAt)}</div>
                          </div>
                        </div>
                        <div className="wa-status-text">{s.text}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {mainTab === 'communities' ? (
            <div className="wa-communities">
              <div className="sidebar-head wa-list-toolbar row">
                <span className="wa-toolbar-title">المجتمعات</span>
                <button type="button" className="wa-toolbar-ic" title="مجموعة جديدة" onClick={() => setGroupOpen(true)}>
                  +
                </button>
              </div>
              <div className="muted small pad">المجموعات التي أنت فيها</div>
              <div className="user-list wa-chat-list">
                {!inbox || inbox.groups.length === 0 ? (
                  <div className="muted pad">لا مجتمعات بعد. أنشئ مجموعة من زر +</div>
                ) : (
                  inbox.groups.map((g) => {
                    const active = activeGroup?.id === g.group.id && !activePeer;
                    const t = g.lastMessage ? formatChatListTime(g.lastMessage.createdAt) : formatChatListTime(g.updatedAt);
                    return (
                      <button
                        key={`gc-${g.group.id}`}
                        type="button"
                        className={active ? 'wa-chat-row active' : 'wa-chat-row'}
                        onClick={() => {
                          openGroup(g.group);
                        }}
                      >
                        <div className="wa-chat-avatar avatar group">👥</div>
                        <div className="wa-chat-main">
                          <div className="wa-chat-line1">
                            <span className="user-name wa-chat-name">{g.group.name}</span>
                          </div>
                          <div className="wa-chat-line2">
                            <span className="wa-chat-preview muted small">
                              {inboxPreviewLast(g.lastMessage, me.id, userById, true)}
                            </span>
                          </div>
                        </div>
                        <div className="wa-chat-meta">
                          <span className="wa-chat-time muted tiny">{t}</span>
                          {g.unread > 0 ? <span className="badge wa-chat-badge">{g.unread}</span> : <span className="wa-meta-spacer" />}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}

          {mainTab === 'calls' ? (
            <div className="pad wa-calls">
              <div className="sidebar-head wa-list-toolbar">
                <span className="wa-toolbar-title">المكالمات</span>
              </div>
              <div className="wa-calls-empty">
                <div className="wa-calls-icon" aria-hidden>
                  📞
                </div>
                <p className="wa-calls-title">ابدأ مكالمة صوتية أو بالفيديو</p>
                <p className="muted small">
                  للمكالمة: افتح محادثة خاصة ثم استخدم أزرار الصوت أو الفيديو أعلى المحادثة (WebRTC + إشارات عبر
                  الخادم). يحتاج المتصفح إذن الميكروفون/الكاميرا.
                </p>
              </div>
            </div>
          ) : null}
            </div>
        </aside>

        <section className="thread wa-thread">
          {!activePeer && !activeGroup ? (
            <div className="empty-thread wa-empty-thread">
              <div className="wa-empty-logo" aria-hidden>
                AC
              </div>
              <h2 className="wa-empty-title">Ayman Chat على الويب</h2>
              <p className="muted wa-empty-hint">
                اختر محادثة من القائمة لعرضها هنا. احرص على بقاء الخادم يعمل أثناء التطوير.
              </p>
            </div>
          ) : (
            <>
              <div className="thread-head wa-thread-head">
                <button
                  type="button"
                  className="wa-thread-back"
                  title="رجوع"
                  aria-label="رجوع"
                  onClick={() => {
                    setActivePeer(null);
                    setActiveGroup(null);
                  }}
                >
                  ←
                </button>
                <div className="avatar wa-thread-avatar">{activeGroup ? '👥' : activePeer!.displayName.slice(0, 1)}</div>
                <div className="grow wa-thread-titles">
                  <div className="user-name wa-thread-title">{threadTitle}</div>
                  <div className="muted small wa-subtitle">{threadSubtitle}</div>
                </div>
                <div className="wa-thread-actions">
                  <button
                    type="button"
                    className="wa-thread-ic-btn"
                    title="مكالمة فيديو"
                    disabled={
                      !activePeer ||
                      Boolean(activeGroup) ||
                      call.phase !== 'idle' ||
                      Boolean(call.incoming)
                    }
                    onClick={() => activePeer && void call.startOutgoing(activePeer.id, 'video')}
                  >
                    📹
                  </button>
                  <button
                    type="button"
                    className="wa-thread-ic-btn"
                    title="مكالمة صوت"
                    disabled={
                      !activePeer ||
                      Boolean(activeGroup) ||
                      call.phase !== 'idle' ||
                      Boolean(call.incoming)
                    }
                    onClick={() => activePeer && void call.startOutgoing(activePeer.id, 'audio')}
                  >
                    📞
                  </button>
                  <button
                    type="button"
                    className="wa-thread-ic-btn"
                    title="بحث في المحادثة"
                    aria-expanded={threadSearchOpen}
                    aria-controls="thread-message-search"
                    onClick={() => setThreadSearchOpen((v) => !v)}
                  >
                    🔍
                  </button>
                  <button type="button" className="wa-thread-ic-btn" title="قائمة" disabled>
                    ⋮
                  </button>
                </div>
              </div>

              {threadSearchOpen ? (
                <div id="thread-message-search" className="wa-thread-search">
                  <label className="wa-thread-search-label">
                    <span className="wa-sr-only">بحث في رسائل هذه المحادثة</span>
                    <input
                      className="wa-thread-search-input"
                      value={threadSearchQuery}
                      onChange={(e) => setThreadSearchQuery(e.target.value)}
                      placeholder="ابحث في نص الرسائل…"
                      dir="auto"
                      autoFocus
                    />
                  </label>
                  <button
                    type="button"
                    className="wa-thread-search-close"
                    onClick={() => {
                      setThreadSearchOpen(false);
                      setThreadSearchQuery('');
                    }}
                  >
                    إغلاق
                  </button>
                </div>
              ) : null}

              <div className="messages wa-messages">
                {filteredThreadMessages.length === 0 &&
                messages.length > 0 &&
                threadSearchQuery.trim() ? (
                  <div className="muted pad wa-thread-empty-search">لا رسائل تطابق البحث.</div>
                ) : (
                  messageTimeline.map((item) => {
                    if (item.kind === 'sep') {
                      return (
                        <div key={item.key} className="wa-day-sep" role="separator">
                          <span>{item.label}</span>
                        </div>
                      );
                    }
                    const m = item.msg;
                    const mine = m.fromUserId === me.id;
                    const tick = mine ? '✓✓' : '';
                    return (
                      <div key={m.id} className={mine ? 'bubble mine wa-bubble' : 'bubble wa-bubble'}>
                        {activeGroup && !mine ? (
                          <div className="who muted tiny wa-bubble-sender">
                            {userById[m.fromUserId]?.displayName || 'عضو'}
                          </div>
                        ) : null}
                        {m.kind === 'image' && m.imageUrl ? (
                          <img className="bubble-img" src={m.imageUrl} alt="" loading="lazy" />
                        ) : null}
                        {m.text ? <div className="bubble-text">{m.text}</div> : null}
                        <div className="bubble-meta wa-bubble-foot">
                          <span className="wa-bubble-time">{formatTimeShort(m.createdAt)}</span>
                          {mine ? <span className="wa-tick">{tick}</span> : null}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} className="wa-messages-end" aria-hidden />
              </div>

              <form className="composer wa-composer" onSubmit={sendMessage}>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  ref={fileRef}
                  onChange={(e) => onPickImage(e.target.files?.[0] || null)}
                />
                <button type="button" className="wa-composer-mic" title="رسالة صوتية" disabled aria-hidden>
                  🎤
                </button>
                <button
                  type="button"
                  className="wa-composer-plus"
                  title="مرفقات"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                >
                  +
                </button>
                <input
                  className="wa-composer-input"
                  value={draft}
                  onChange={(ev) => {
                    setDraft(ev.target.value);
                    scheduleTypingPing();
                  }}
                  placeholder="اكتب رسالة"
                  dir="auto"
                />
                <button className="wa-send-btn" type="submit" disabled={!draft.trim()} title="إرسال" aria-label="إرسال">
                  ➤
                </button>
              </form>
            </>
          )}
        </section>
      </main>
      </div>

      <nav className="bottom-nav wa-bottom-nav" aria-label="التنقل الرئيسي">
        <button type="button" className={mainTab === 'chats' ? 'bn wa-bn active' : 'bn wa-bn'} onClick={() => setMainTab('chats')}>
          <span className="wa-bn-ic" aria-hidden>
            💬
          </span>
          <span className="wa-bn-label">المحادثات</span>
        </button>
        <button type="button" className={mainTab === 'updates' ? 'bn wa-bn active' : 'bn wa-bn'} onClick={() => setMainTab('updates')}>
          <span className="wa-bn-ic" aria-hidden>
            ○
          </span>
          <span className="wa-bn-label">التحديثات</span>
        </button>
        <button
          type="button"
          className={mainTab === 'communities' ? 'bn wa-bn active' : 'bn wa-bn'}
          onClick={() => setMainTab('communities')}
        >
          <span className="wa-bn-ic" aria-hidden>
            👥
          </span>
          <span className="wa-bn-label">المجتمعات</span>
        </button>
        <button type="button" className={mainTab === 'calls' ? 'bn wa-bn active' : 'bn wa-bn'} onClick={() => setMainTab('calls')}>
          <span className="wa-bn-ic" aria-hidden>
            📞
          </span>
          <span className="wa-bn-label">المكالمات</span>
        </button>
      </nav>

      {profileOpen ? (
        <div className="modal-back" role="presentation" onClick={() => setProfileOpen(false)}>
          <div className="modal wa-profile-modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="wa-profile-hero">
              <div className="avatar wa-profile-big">{me.displayName.slice(0, 1)}</div>
              <div className="wa-profile-hero-name">{me.displayName}</div>
              <div className="muted small wa-profile-hero-sub" dir="ltr">
                @{me.username}
              </div>
            </div>
            <h3 className="wa-profile-h3">تعديل الملف</h3>
            <form className="stack" onSubmit={saveProfile}>
              <label>
                <span className="wa-field-label">الاسم</span>
                <input value={pName} onChange={(ev) => setPName(ev.target.value)} />
              </label>
              <label>
                <span className="wa-field-label">النبذة التعريفية</span>
                <textarea rows={3} maxLength={139} value={pAbout} onChange={(ev) => setPAbout(ev.target.value)} />
              </label>
              <p className="muted tiny">يظهر الاسم والنبذة للآخرين كما في واتساب.</p>
              <div className="row gap">
                <button className="primary" type="submit" disabled={busy}>
                  حفظ
                </button>
                <button type="button" className="ghost" onClick={() => setProfileOpen(false)}>
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {groupOpen ? (
        <div className="modal-back" role="presentation" onClick={() => setGroupOpen(false)}>
          <div className="modal wide" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>مجموعة جديدة</h3>
            <form className="stack" onSubmit={createGroup}>
              <label>
                اسم المجموعة
                <input value={gName} onChange={(ev) => setGName(ev.target.value)} required minLength={2} />
              </label>
              <div className="muted small">اختر الأعضاء (أنت تُضاف تلقائياً)</div>
              <div className="pick-list">
                {users.map((u) => (
                  <label key={u.id} className="pick-row">
                    <input
                      type="checkbox"
                      checked={Boolean(gPick[u.id])}
                      onChange={(ev) => setGPick((p) => ({ ...p, [u.id]: ev.target.checked }))}
                    />
                    <span>
                      {u.displayName} <span className="muted tiny">@{u.username}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="row gap">
                <button className="primary" type="submit" disabled={busy || gName.trim().length < 2}>
                  إنشاء
                </button>
                <button type="button" className="ghost" onClick={() => setGroupOpen(false)}>
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="toast">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            إغلاق
          </button>
        </div>
      ) : null}

      <audio ref={call.remoteAudioRef} className="hidden" playsInline autoPlay />

      {call.incoming ? (
        <div className="wa-call-overlay" role="presentation">
          <div className="wa-call-card" role="dialog" aria-labelledby="wa-call-incoming-title">
            <h3 id="wa-call-incoming-title">مكالمة واردة</h3>
            <p className="muted small">
              من {userById[call.incoming.fromUserId]?.displayName || 'مستخدم'} —{' '}
              {call.incoming.media === 'video' ? 'فيديو' : 'صوت فقط'}
            </p>
            <div className="wa-call-actions">
              <button type="button" className="primary" onClick={() => void call.acceptIncoming()}>
                رد
              </button>
              <button type="button" className="ghost" onClick={call.declineIncoming}>
                رفض
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {call.phase === 'outgoing' ? (
        <div className="wa-call-overlay" role="presentation">
          <div className="wa-call-card" role="status">
            <h3>جاري الاتصال…</h3>
            <p className="muted small">في انتظار رد الطرف الآخر</p>
            <button type="button" className="ghost wa-call-full" onClick={call.endCall}>
              إنهاء
            </button>
          </div>
        </div>
      ) : null}

      {call.phase === 'connected' ? (
        <div className="wa-call-overlay" role="presentation">
          <div className="wa-call-card wa-call-active" role="dialog" aria-label="مكالمة جارية">
            <div className="wa-call-videos">
              <video ref={call.remoteVideoRef} className="wa-call-remote" playsInline autoPlay />
              <video ref={call.localVideoRef} className="wa-call-local" muted playsInline autoPlay />
            </div>
            <button type="button" className="primary wa-call-full" onClick={call.endCall}>
              إنهاء المكالمة
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
