/**
 * مقاييس Prometheus — تُفعَّل بـ ENABLE_METRICS=1
 * احمِ /metrics في الإنتاج (شبكة داخلية أو وسيط يقيّد الوصول).
 */
import { Registry, collectDefaultMetrics, Counter } from 'prom-client';

const enabled =
  process.env.ENABLE_METRICS === '1' || process.env.ENABLE_METRICS === 'true';

let register = null;
let httpRequestsTotal = null;

if (enabled) {
  register = new Registry();
  collectDefaultMetrics({ register });
  httpRequestsTotal = new Counter({
    name: 'ayman_http_requests_total',
    help: 'عدد طلبات HTTP',
    labelNames: ['method', 'path_group'],
    registers: [register],
  });
}

export function isMetricsEnabled() {
  return enabled;
}

/** تبسيط المسار لتقليل بطاقات المقاييس */
export function pathGroup(urlPath) {
  const p = urlPath.split('?')[0] || '';
  if (p.startsWith('/socket.io')) return 'socket_io';
  if (p === '/api/register' || p.startsWith('/api/register')) return 'api_auth';
  if (p === '/api/login' || p.startsWith('/api/login')) return 'api_auth';
  if (p.startsWith('/api/')) return 'api';
  if (p.startsWith('/uploads')) return 'uploads';
  if (p === '/metrics') return 'metrics';
  return 'other';
}

export function recordHttpRequest(method, urlPath) {
  if (httpRequestsTotal) {
    httpRequestsTotal.inc({ method, path_group: pathGroup(urlPath) });
  }
}

export async function renderMetrics() {
  if (!register) return null;
  return register.metrics();
}

export function metricsContentType() {
  return register ? register.contentType : 'text/plain';
}
