export type User = {
  id: number;
  username: string;
  displayName: string;
  about: string;
  lastSeen: string;
  createdAt: string;
};

export type ChatMessage = {
  id: number;
  createdAt: string;
  kind: 'text' | 'image';
  text: string;
  imageUrl: string | null;
  fromUserId: number;
  toUserId: number;
  groupId: number | null;
};

export type GroupRow = {
  id: number;
  name: string;
  memberIds: number[];
  createdBy?: number;
  createdAt?: string;
};

export type InboxDirect = {
  kind: 'direct';
  peer: User;
  lastMessage: ChatMessage | null;
  unread: number;
  updatedAt: string;
};

export type InboxGroup = {
  kind: 'group';
  group: { id: number; name: string; memberIds: number[] };
  lastMessage: ChatMessage | null;
  unread: number;
  updatedAt: string;
};

export type InboxPayload = {
  directs: InboxDirect[];
  groups: InboxGroup[];
};

export type StatusRow = {
  userId: number;
  text: string;
  createdAt: string;
  expiresAt: string;
  author: User | null;
};
