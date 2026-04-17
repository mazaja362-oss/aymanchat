/**
 * تسجيل بسيط بوقت ISO — عطّل الطباعة: LOG_LEVEL=silent
 */
const level = (process.env.LOG_LEVEL || 'info').toLowerCase();

const order = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

function ok(l) {
  return order[l] <= order[level] && order[level] > 0;
}

function ts() {
  return new Date().toISOString();
}

export function logDebug(msg, meta) {
  if (!ok('debug')) return;
  if (meta !== undefined) console.debug(ts(), '[debug]', msg, meta);
  else console.debug(ts(), '[debug]', msg);
}

export function logInfo(msg, meta) {
  if (!ok('info')) return;
  if (meta !== undefined) console.log(ts(), '[info]', msg, meta);
  else console.log(ts(), '[info]', msg);
}

export function logWarn(msg, meta) {
  if (!ok('warn')) return;
  if (meta !== undefined) console.warn(ts(), '[warn]', msg, meta);
  else console.warn(ts(), '[warn]', msg);
}

export function logError(msg, err) {
  if (!ok('error')) return;
  console.error(ts(), '[error]', msg, err || '');
}
