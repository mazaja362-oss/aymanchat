import { test, expect } from '@playwright/test';

test('GET /api/health', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.uptimeMs).toBeGreaterThanOrEqual(0);
  expect(['json', 'sqlite']).toContain(body.store);
});

test('GET /api/webrtc/ice', async ({ request }) => {
  const res = await request.get('/api/webrtc/ice');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(Array.isArray(body.iceServers)).toBe(true);
  expect(body.iceServers.length).toBeGreaterThan(0);
});
