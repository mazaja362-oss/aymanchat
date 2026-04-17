import { defineConfig, createLogger } from 'vite';
import react from '@vitejs/plugin-react';
import type { LogErrorOptions, LogOptions } from 'vite';

/** نفس منفذ خادم API (مثل $env:PORT="3001" على PowerShell) */
const apiPortNum = Number(process.env.PORT) || 3000;
const apiTarget = `http://127.0.0.1:${apiPortNum}`;

/**
 * أثناء `npm run dev` مع `node --watch`: Vite يطبع `http proxy error` عبر `logger.error`
 * عند ECONNRESET / ECONNREFUSED أثناء إعادة تشغيل الخادم أو قطع long-polling.
 * عطّل التصفية: VITE_SILENT_DEV_PROXY=0
 */
function isBenignDevProxyLog(msg: string, opts?: LogErrorOptions): boolean {
  if (process.env.VITE_SILENT_DEV_PROXY === '0') return false;
  const m = String(msg);
  if (!m.includes('http proxy error') && !m.includes('ws proxy error')) return false;
  const err = opts?.error as NodeJS.ErrnoException | undefined;
  const benignCodes = ['ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE'];
  if (err?.code && benignCodes.includes(err.code)) return true;
  const em = String(err?.message || '');
  return benignCodes.some((c) => em.includes(c));
}

const baseLogger = createLogger();
const quietProxyLogger = {
  ...baseLogger,
  warn(msg: string, options?: LogOptions) {
    if (isBenignDevProxyLog(msg, options)) return;
    baseLogger.warn(msg, options);
  },
  error(msg: string, options?: LogErrorOptions) {
    if (isBenignDevProxyLog(msg, options)) return;
    baseLogger.error(msg, options);
  },
};

/** تنبيه مرة واحدة إذا شغّلت Vite وحده دون الخادم */
function backendReachableHint(): import('vite').Plugin {
  return {
    name: 'ayman-chat-backend-hint',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        void (async () => {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 2000);
            const res = await fetch(`http://127.0.0.1:${apiPortNum}/api/health`, { signal: ctrl.signal });
            clearTimeout(t);
            if (!res.ok) throw new Error(String(res.status));
          } catch {
            server.config.logger.warn(
              `\n[ayman-chat] لا يوجد خادم API على http://127.0.0.1:${apiPortNum} (الوكيل يوجّه /api و /socket.io إليه).\n` +
                `  • من جذر المشروع:  npm run dev\n` +
                `  • أو نافذتين:  npm run dev --prefix server   ثم بنفس PORT:  npm run dev --prefix client\n`
            );
          }
        })();
      });
    },
  };
}

function proxyErrorHandler(): NonNullable<import('vite').ProxyOptions['configure']> {
  return (proxy) => {
    proxy.on('error', (err: NodeJS.ErrnoException) => {
      if (
        err?.code === 'ECONNRESET' ||
        err?.code === 'ECONNREFUSED' ||
        err?.code === 'ECONNABORTED' ||
        err?.code === 'ETIMEDOUT' ||
        err?.code === 'EPIPE'
      ) {
        return;
      }
      console.error('[vite proxy]', err);
    });
  };
}

export default defineConfig({
  customLogger: quietProxyLogger,
  plugins: [react(), backendReachableHint()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        configure: proxyErrorHandler(),
      },
      '/uploads': {
        target: apiTarget,
        changeOrigin: true,
        configure: proxyErrorHandler(),
      },
      '/socket.io': {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
        configure: proxyErrorHandler(),
      },
    },
  },
});
