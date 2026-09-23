import { expect, test } from '@playwright/test';

// The former reveal fixture modelled a private dual-list widget.  These cases
// keep its user contracts on the real App -> ConversationSurface -> reading
// container: rows stay painted, trusted input owns the viewport, and a channel
// activation cannot replay a stale history token.

async function reset(request, scenario, seed) {
  const response = await request.post('/mock/control/reset', { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.timeline-message-list')).toBeVisible();
}

function viewport(page) {
  return page.locator('.timeline-message-list');
}

async function visibleEvidence(page) {
  return page.evaluate(() => {
    const list = document.querySelector('.timeline-message-list');
    const root = list?.getBoundingClientRect();
    const rows = [...(list?.querySelectorAll('[data-presentation-row-id]') || [])].map((node) => {
      const rect = node.getBoundingClientRect();
      return { id: node.dataset.presentationRowId || '', top: rect.top, bottom: rect.bottom };
    });
    return {
      activeLayers: document.querySelectorAll('.timeline-reading-layer.is-active').length,
      activeLists: document.querySelectorAll('.timeline-reading-layer.is-active .timeline-message-list').length,
      connected: Boolean(list?.isConnected),
      rowCount: rows.length,
      visibleRows: rows.filter((row) => row.bottom > (root?.top || 0) + 1 && row.top < (root?.bottom || 0)).length,
      scrollTop: Number(list?.scrollTop || 0),
      scrollHeight: Number(list?.scrollHeight || 0),
      clientHeight: Number(list?.clientHeight || 0),
      mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
    };
  });
}



test('history status identity and reduced-motion tail stay readable during background activity', async ({ page, request }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1120, height: 620 });
  await reset(request, 'history-boundary', 0x92_41_23);
  await login(page);
  const list = viewport(page);
  await list.hover();
  for (let index = 0; index < 14; index += 1) {
    await page.mouse.wheel(0, -5_000);
    await page.waitForTimeout(120);
  }
  const status = page.locator('.timeline-history-boundary[data-phase="exhausted"]');
  await expect(status).toBeVisible();
  await page.evaluate(() => {
    window.__historyBoundaryNode = document.querySelector('.timeline-history-boundary[data-phase="exhausted"]');
  });
  const initial = await visibleEvidence(page);
  const pulse = await request.post('/mock/control/action', { data: { type: 'pulse' } });
  expect(pulse.ok()).toBe(true);
  await page.waitForTimeout(500);
  const final = await visibleEvidence(page);
  const identity = await status.evaluate((node) => ({ same: node === window.__historyBoundaryNode }));
  await testInfo.attach('history-reveal-status.json', {
    body: JSON.stringify({ initial, final, identity }, null, 2), contentType: 'application/json',
  });
  expect(initial.visibleRows).toBeGreaterThan(0);
  expect(final.visibleRows).toBeGreaterThan(0);
  expect(final.activeLayers).toBe(1);
  expect(identity.same).toBe(true);
});

