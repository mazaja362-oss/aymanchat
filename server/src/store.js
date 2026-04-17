const useSqlite =
  process.env.USE_SQLITE === '1' ||
  process.env.USE_SQLITE === 'true' ||
  process.env.USE_SQLITE === 'yes';

const mod = useSqlite ? await import('./storeSqlite.js') : await import('./storeFs.js');

export const DATA_DIR = mod.DATA_DIR;
export const UPLOADS_DIR = mod.UPLOADS_DIR;
export const ensureUploadsDir = mod.ensureUploadsDir;
export const loadUsers = mod.loadUsers;
export const saveUsers = mod.saveUsers;
export const loadMessages = mod.loadMessages;
export const saveMessages = mod.saveMessages;
export const loadGroups = mod.loadGroups;
export const saveGroups = mod.saveGroups;
export const loadStatuses = mod.loadStatuses;
export const saveStatuses = mod.saveStatuses;
export const loadReadState = mod.loadReadState;
export const saveReadState = mod.saveReadState;
