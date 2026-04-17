import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
const STATUSES_FILE = path.join(DATA_DIR, 'statuses.json');
const READ_STATE_FILE = path.join(DATA_DIR, 'read_state.json');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function ensureUploadsDir() {
  ensureDataDir();
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

function readJson(file, fallback) {
  ensureDataDir();
  if (!fs.existsSync(file)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDataDir();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function migrateUsers(users) {
  let changed = false;
  for (const u of users) {
    if (typeof u.about !== 'string') {
      u.about = '';
      changed = true;
    }
    if (!u.lastSeen) {
      u.lastSeen = u.createdAt || new Date().toISOString();
      changed = true;
    }
  }
  if (changed) writeJson(USERS_FILE, users);
  return users;
}

function migrateMessages(messages) {
  let changed = false;
  for (const m of messages) {
    if (!m.kind) {
      m.kind = 'text';
      changed = true;
    }
    if (m.groupId === undefined) {
      m.groupId = null;
      changed = true;
    }
    if (m.imageUrl === undefined) {
      m.imageUrl = null;
      changed = true;
    }
    if (m.groupId && (m.toUserId === undefined || m.toUserId === null)) {
      m.toUserId = 0;
      changed = true;
    }
  }
  if (changed) writeJson(MESSAGES_FILE, messages);
  return messages;
}

export function loadUsers() {
  const users = readJson(USERS_FILE, []);
  return migrateUsers(users);
}

export function saveUsers(users) {
  writeJson(USERS_FILE, users);
}

export function loadMessages() {
  const messages = readJson(MESSAGES_FILE, []);
  return migrateMessages(messages);
}

export function saveMessages(messages) {
  writeJson(MESSAGES_FILE, messages);
}

export function loadGroups() {
  return readJson(GROUPS_FILE, []);
}

export function saveGroups(groups) {
  writeJson(GROUPS_FILE, groups);
}

export function loadStatuses() {
  return readJson(STATUSES_FILE, []);
}

export function saveStatuses(statuses) {
  writeJson(STATUSES_FILE, statuses);
}

/** { [userId: string]: { direct: { [peerId: string]: number }, groups: { [groupId: string]: number } } } */
export function loadReadState() {
  return readJson(READ_STATE_FILE, {});
}

export function saveReadState(state) {
  writeJson(READ_STATE_FILE, state);
}
