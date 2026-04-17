/**
 * اختبار دخان: يشغّل الخادم على منفذ مؤقت، يتحقق من /api/health والتسجيل و /api/me ثم يوقفه.
 * التشغيل من جذر المشروع: npm run test:smoke
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const serverDir = path.join(root, 'server');
const port = Number(process.env.SMOKE_PORT) || 3049;
const base = `http://127.0.0.1:${port}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth(timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) {
        const j = await r.json();
        if (j && j.ok) return;
      }
    } catch {
      /* ignore */
    }
    await sleep(150);
  }
  throw new Error(`انتهت مهلة انتظار /api/health على ${base}`);
}

async function main() {
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      CLIENT_ORIGIN: base,
      JWT_SECRET: process.env.JWT_SECRET || 'smoke-test-jwt-secret-do-not-use',
    },
    stdio: 'ignore',
  });

  const kill = () => {
    try {
      if (process.platform === 'win32') {
        child.kill();
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      /* ignore */
    }
  };

  try {
    await waitHealth();
    const u = `smoke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const reg = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: u,
        password: 'smoke12',
        displayName: 'Smoke User',
      }),
    });
    const regBody = await reg.json().catch(() => ({}));
    if (!reg.ok) {
      throw new Error(regBody.error || `فشل التسجيل: ${reg.status}`);
    }
    const { token } = regBody;
    if (!token) throw new Error('لا يوجد token في رد التسجيل');

    const me = await fetch(`${base}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meBody = await me.json().catch(() => ({}));
    if (!me.ok) throw new Error(meBody.error || `فشل /api/me: ${me.status}`);
    if (!meBody.user || meBody.user.username !== u) {
      throw new Error('رد /api/me غير متوقع');
    }

    console.log('smoke-test: ok (health + register + /api/me)');
  } finally {
    kill();
    await new Promise((resolve) => {
      child.on('close', resolve);
      setTimeout(resolve, 3000);
    });
  }
}

main().catch((e) => {
  console.error('smoke-test:', e.message || e);
  process.exit(1);
});
