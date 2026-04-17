/**
 * ينتظر حتى يستجيب الخادم على /api/health ثم يشغّل واجهة Vite.
 * يقلّل أخطاء ECONNREFUSED و ECONNRESET من وكيل WebSocket في التطوير.
 *
 * على Windows + Node 24، spawn('npm.cmd', ...) بدون shell قد يعطي EINVAL؛
 * لذلك نستدعي Vite عبر node مباشرة (نفس عمل npm run dev في client).
 */
import http from 'http';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const port = Number(process.env.PORT) || 3000;
const host = '127.0.0.1';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const clientDir = path.join(rootDir, 'client');
const viteBin = path.join(clientDir, 'node_modules', 'vite', 'bin', 'vite.js');

function pingOnce() {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}/api/health`, { timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer() {
  const maxAttempts = 120;
  for (let i = 0; i < maxAttempts; i++) {
    if (await pingOnce()) {
      if (i > 0) console.log(`[dev] الخادم جاهز على ${host}:${port}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  console.error(`[dev] انتهى الانتظار: الخادم لم يرد على http://${host}:${port}/api/health`);
  process.exit(1);
}

await waitForServer();

if (!existsSync(viteBin)) {
  console.error('[dev] لم يُعثر على Vite. من جذر المشروع نفّذ: npm run install:all');
  process.exit(1);
}

const child = spawn(process.execPath, [viteBin], {
  cwd: clientDir,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => process.exit(code ?? 0));
