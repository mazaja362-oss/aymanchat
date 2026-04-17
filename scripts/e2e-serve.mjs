/**
 * يبني الواجهة ثم يشغّل الخادم مع CLIENT_DIST — لاستخدامه مع Playwright webServer.
 */
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const port = process.env.E2E_PORT || '3456';
const base = `http://127.0.0.1:${port}`;

execSync('npm run build --prefix client', { cwd: root, stdio: 'inherit' });

const dist = path.join(root, 'client', 'dist');
const serverDir = path.join(root, 'server');

const child = spawn(process.execPath, ['src/index.js'], {
  cwd: serverDir,
  env: {
    ...process.env,
    PORT: String(port),
    CLIENT_ORIGIN: base,
    CLIENT_DIST: dist,
    JWT_SECRET: process.env.JWT_SECRET || 'e2e-jwt-secret-change-me',
  },
  stdio: 'inherit',
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
