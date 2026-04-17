import type { ChatMessage, GroupRow, InboxPayload, StatusRow, User } from './types';

const headers = (token: string) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
});

export async function apiRegister(body: {
  username: string;
  password: string;
  displayName: string;
}): Promise<{ token: string; user: User }> {
  const r = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'فشل التسجيل');
  return data;
}

export async function apiLogin(body: {
  username: string;
  password: string;
}): Promise<{ token: string; user: User }> {
  const r = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'فشل الدخول');
  return data;
}

export async function apiMe(token: string): Promise<{ user: User }> {
  const r = await fetch('/api/me', { headers: headers(token) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'انتهت الجلسة');
  return data;
}

export async function apiPatchMe(
  token: string,
  body: { displayName?: string; about?: string }
): Promise<{ user: User }> {
  const r = await fetch('/api/me', {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'تعذر الحفظ');
  return data;
}

export async function apiUsers(token: string): Promise<{ users: User[] }> {
  const r = await fetch('/api/users', { headers: headers(token) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'تعذر جلب المستخدمين');
  return data;
}

export async function apiInbox(token: string): Promise<InboxPayload> {
  const r = await fetch('/api/inbox', { headers: headers(token) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'تعذر جلب المحادثات');
  return data;
}

export async function apiPresence(
  token: string
): Promise<{ online: number[]; lastSeen: Record<string, string> }> {
  const r = await fetch('/api/presence', { headers: headers(token) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'تعذر جلب الحالة');
  return data;
}

export async function apiMessages(
  token: string,
  peerId: number
): Promise<{ messages: ChatMessage[] }> {
  const r = await fetch(`/api/messages/${peerId}`, { headers: headers(token) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'تعذر جلب الرسائل');
  return data;
}

export async function apiGroupMessages(
  token: string,
  groupId: number
): Promise<{ messages: ChatMessage[] }> {
  const r = await fetch(`/api/groups/${groupId}/messages`, { headers: headers(token) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'تعذر جلب رسائل المجموعة');
  return data;
}

export async function apiCreateGroup(
  token: string,
  body: { name: string; memberIds: number[] }
): Promise<{ group: GroupRow }> {
  const r = await fetch('/api/groups', {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'تعذر إنشاء المجموعة');
  return data;
}

export async function apiMarkDirectRead(token: string, peerId: number): Promise<void> {
  const r = await fetch(`/api/read/direct/${peerId}`, {
    method: 'POST',
    headers: headers(token),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'تعذر التحديث');
}

export async function apiMarkGroupRead(token: string, groupId: number): Promise<void> {
  const r = await fetch(`/api/read/group/${groupId}`, {
    method: 'POST',
    headers: headers(token),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'تعذر التحديث');
}

export async function apiStatuses(token: string): Promise<{ statuses: StatusRow[] }> {
  const r = await fetch('/api/statuses', { headers: headers(token) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'تعذر جلب الحالات');
  return data;
}

export async function apiPostStatus(token: string, text: string): Promise<void> {
  const r = await fetch('/api/status', {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ text }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'تعذر النشر');
}

export async function apiDeleteStatus(token: string): Promise<void> {
  const r = await fetch('/api/status', { method: 'DELETE', headers: headers(token) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'تعذر الحذف');
}

export async function apiUploadMedia(token: string, dataUrl: string): Promise<{ url: string }> {
  const r = await fetch('/api/media', {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ dataUrl }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'تعذر رفع الصورة');
  return data;
}
