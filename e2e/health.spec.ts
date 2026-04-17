import { test, expect } from '@playwright/test';

test('GET /api/health', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.uptimeMs).toBeGreaterThanOrEqual(0);
  expect(['json', 'sqlite']).toContain(body.store);
});
