/**
 * تخزين KV في sql.js (WASM — بدون تجميع أصلي) مع ملف ثنائي على القرص.
 * عند أول تشغيل مع قاعدة فارغة: نسخ من ملفات *.json القديمة إن وُجدت.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
const STATUSES_FILE = path.join(DATA_DIR, 'statuses.json');
const READ_STATE_FILE = path.join(DATA_DIR, 'read_state.json');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

const wasmDir = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist');
const SQL = await initSqlJs({
  locateFile: (file) => path.join(wasmDir, file),
});

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

const dbPath = process.env.SQLITE_PATH
  ? String(process.env.SQLITE_PATH).trim()
  : path.join(DATA_DIR, 'ayman.sqljs.db');

ensureDataDir();

function loadDb() {
  if (fs.existsSync(dbPath)) {
    const filebuffer = fs.readFileSync(dbPath);
    return new SQL.Database(filebuffer);
  }
  return new SQL.Database();
}

let db = loadDb();

db.run(`CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
)`);

function persist() {
  const data = db.export();
  const buf = Buffer.from(data);
  const tmp = `${dbPath}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dbPath);
}

function importFromLegacyJsonIfEmpty() {
  const cnt = db.exec('SELECT COUNT(*) AS c FROM kv');
  const n = cnt.length && cnt[0].values.length ? Number(cnt[0].values[0][0]) : 0;
  if (n > 0) return;
  const pairs = [
    ['users', USERS_FILE, '[]'],
    ['messages', MESSAGES_FILE, '[]'],
    ['groups', GROUPS_FILE, '[]'],
    ['statuses', STATUSES_FILE, '[]'],
    ['read_state', READ_STATE_FILE, '{}'],
  ];
  for (const [key, file, fallback] of pairs) {
    let raw = fallback;
    if (fs.existsSync(file)) {
      try {
        const t = fs.readFileSync(file, 'utf8');
        JSON.parse(t);
        raw = t;
      } catch {
        /* keep fallback */
      }
    }
    db.run('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [key, raw]);
  }
  persist();
}

importFromLegacyJsonIfEmpty();

function kvGet(key, fallbackJson) {
  const stmt = db.prepare('SELECT value FROM kv WHERE key = ?');
  stmt.bind([key]);
  if (!stmt.step()) {
    stmt.free();
    return JSON.parse(fallbackJson);
  }
  const row = stmt.get();
  stmt.free();
  const val = row && row[0] != null ? String(row[0]) : null;
  if (val == null) return JSON.parse(fallbackJson);
  try {
    return JSON.parse(val);
  } catch {
    return JSON.parse(fallbackJson);
  }
}

function kvSet(key, value) {
  db.run('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
  persist();
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
  if (changed) kvSet('users', users);
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
  if (changed) kvSet('messages', messages);
  return messages;
}

export function loadUsers() {
  return migrateUsers(kvGet('users', '[]'));
}

export function saveUsers(users) {
  kvSet('users', users);
}

export function loadMessages() {
  return migrateMessages(kvGet('messages', '[]'));
}

export function saveMessages(messages) {
  kvSet('messages', messages);
}

export function loadGroups() {
  return kvGet('groups', '[]');
}

export function saveGroups(groups) {
  kvSet('groups', groups);
}

export function loadStatuses() {
  return kvGet('statuses', '[]');
}

export function saveStatuses(statuses) {
  kvSet('statuses', statuses);
}

export function loadReadState() {
  return kvGet('read_state', '{}');
}

export function saveReadState(state) {
  kvSet('read_state', state);
}
