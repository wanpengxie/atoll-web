import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

function wideTable(marker) {
  const headers = [marker, 'alpha', 'beta', 'gamma', 'delta', 'epsilon'];
  const cells = headers.map((header, index) => `${header}-${String(index).repeat(28)}`);
  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, `| ${cells.join(' | ')} |`].join('\n');
}

async function publishWideTable(request, marker) {
  const dense = await request.post(`${MOCK}/mock/control/action`, { data: { type: 'dense_progress', channel_id: 'c0', count: 1 } });
  expect(dense.ok()).toBe(true);
  const { request_id: requestId } = await dense.json();
  const terminal = await request.post(`${MOCK}/mock/control/action`, {
    data: { type: 'push_terminal', channel_id: 'c0', request_id: requestId, payload: { text: wideTable(marker) } },
  });
  expect(terminal.ok()).toBe(true);
}

test('wide Markdown table keeps native horizontal position through background updates', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1120, height: 760 });
  const reset = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario: 'long-running-canonical', seed: 0x92_19_01 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  const marker = 'horizontal-table-marker';
  await publishWideTable(request, marker);
  const table = page.locator('.markdown-table-scroll').filter({ hasText: marker });
  await expect(table).toBeVisible();
  await expect.poll(() => table.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeGreaterThan(300);

  await table.evaluate((node) => {
    const writes = [];
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'scrollLeft');
    if (descriptor?.get && descriptor?.set) Object.defineProperty(node, 'scrollLeft', {
      configurable: true,
      get() { return descriptor.get.call(this); },
      set(value) { writes.push({ value: Number(value), at: performance.now() }); return descriptor.set.call(this, value); },
    });
    window.__horizontalTableProbe = { node, writes, events: [] };
    node.addEventListener('scroll', (event) => window.__horizontalTableProbe.events.push({ trusted: event.isTrusted, left: node.scrollLeft }), { passive: true });
  });
  await table.hover();
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 760);
  await page.keyboard.up('Shift');
  await expect.poll(() => table.evaluate((node) => node.scrollLeft)).toBeGreaterThan(100);
  const before = await table.evaluate((node) => ({ left: node.scrollLeft, width: node.scrollWidth }));

  const pulse = await request.post(`${MOCK}/mock/control/action`, { data: { type: 'pulse' } });
  expect(pulse.ok()).toBe(true);
  await page.waitForTimeout(300);
  const dense = await request.post(`${MOCK}/mock/control/action`, { data: { type: 'dense_progress', channel_id: 'c0', count: 2 } });
  expect(dense.ok()).toBe(true);
  await page.waitForTimeout(300);
  const after = await table.evaluate((node) => ({ left: node.scrollLeft, width: node.scrollWidth }));
  const evidence = await page.evaluate(() => ({
    writes: window.__horizontalTableProbe.writes,
    events: window.__horizontalTableProbe.events,
    nodeConnected: window.__horizontalTableProbe.node.isConnected,
  }));
  await testInfo.attach('horizontal-table-scroll.json', {
    body: JSON.stringify({ before, after, evidence }, null, 2), contentType: 'application/json',
  });
  expect(evidence.nodeConnected).toBe(true);
  expect(evidence.events.some((event) => event.trusted)).toBe(true);
  expect(evidence.writes).toEqual([]);
  expect(after.left).toBeGreaterThanOrEqual(before.left - 1);
});
