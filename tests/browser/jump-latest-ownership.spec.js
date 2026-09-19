import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Migrated from the fae8b70 baseline onto the current production timeline.
// The old test also asserted on retired authorization-typed reading trace
// events.  The user-visible contract remains observable through the real
// list's geometry, jump affordance, and current generic scroll writer probe.

async function attachJSON(testInfo, name, value) {
  const path = testInfo.outputPath(name);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

async function chooseSteward(page) {
  const choose = page.getByRole('button', { name: '选择 Agent' });
  if (!await choose.isVisible().catch(() => false)) return;
  await choose.click();
  await page.getByRole('menu', { name: '选择目标 Agent' })
    .getByRole('menuitem', { name: 'steward' }).click();
}

async function installProbe(page) {
  await page.evaluate(() => {
    window.__JUMP_LATEST_SCROLL_WRITES__ = [];
    const root = document.querySelector('.timeline-message-list');
    const nativeScrollTo = root?.scrollTo?.bind(root);
    if (root && nativeScrollTo) {
      root.scrollTo = (...args) => {
        window.__JUMP_LATEST_SCROLL_WRITES__.push({
          at: performance.now(), args,
          scrollTop: root.scrollTop, scrollHeight: root.scrollHeight, clientHeight: root.clientHeight,
        });
        return nativeScrollTo(...args);
      };
    }
  });
}

async function sampleFrames(page, count = 45) {
  return page.evaluate(async (total) => {
    const frames = [];
    for (let index = 0; index < total; index += 1) {
      await new Promise(requestAnimationFrame);
      const viewport = document.querySelector('.timeline-message-list');
      const lastRow = [...(viewport?.querySelectorAll('[data-presentation-row-id]') || [])].at(-1);
      const viewportRect = viewport?.getBoundingClientRect();
      const lastRect = lastRow?.getBoundingClientRect();
      frames.push({
        index,
        gap: viewport ? viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop : null,
        maxScrollTop: viewport ? viewport.scrollHeight - viewport.clientHeight : null,
        scrollTop: Number(viewport?.scrollTop || 0),
        scrollHeight: Number(viewport?.scrollHeight || 0),
        clientHeight: Number(viewport?.clientHeight || 0),
        lastRowBottom: Number(lastRect?.bottom || 0),
        viewportBottom: Number(viewportRect?.bottom || 0),
        lastRowVisible: Boolean(lastRect && viewportRect && lastRect.bottom <= viewportRect.bottom + 1),
        mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
        jump: document.querySelector('.timeline-jump-latest')?.textContent || '',
        lastInstalledID: [...(viewport?.querySelectorAll('[data-presentation-row-id]') || [])]
          .at(-1)?.dataset.presentationRowId || '',
      });
    }
    return frames;
  }, count);
}

test('browsing reader jump-latest writes once, reaches the installed tail, then acknowledges unseen', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1797 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  const viewport = page.locator('.timeline-message-list');
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  await viewport.hover();
  await page.mouse.wheel(0, -2_000);
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeGreaterThan(24);
  await installProbe(page);
  const pulse = await request.post('/mock/control/action', { data: { type: 'pulse' } });
  expect(pulse.ok()).toBe(true);
  const jump = page.getByRole('button', { name: /条新动态/ });
  const jumpVisible = await jump.isVisible().catch(() => false);
  const before = await viewport.evaluate((node) => ({
    gap: Math.round(node.scrollHeight - node.clientHeight - node.scrollTop),
    scrollTop: node.scrollTop,
    scrollHeight: node.scrollHeight,
  }));
  if (jumpVisible) await jump.click();
  const frames = await sampleFrames(page);
  const evidence = await page.evaluate(() => ({
    scrollWrites: window.__JUMP_LATEST_SCROLL_WRITES__ || [],
    jumpText: document.querySelector('.timeline-jump-latest')?.textContent || '',
  }));
  await attachJSON(testInfo, 'jump-latest-browsing.json', { before, frames, jumpVisible, ...evidence });

  // Substitutes the deleted issuer-write/authorization instrumentation: the
  // sole DOM write funnel (executeReadingDOMCommand) should still fire
  // exactly once for this one jump-latest click, not on every frame.
  expect(jumpVisible).toBe(true);
  expect(evidence.scrollWrites.length).toBe(1);
  expect(frames.some((frame) => frame.gap <= 1)).toBe(true);
  expect(frames.at(-1)?.gap).toBeLessThanOrEqual(1);
  expect(Math.abs(frames.at(-1)?.scrollTop - frames.at(-1)?.maxScrollTop)).toBeLessThanOrEqual(1);
  expect(frames.at(-1)?.lastRowVisible).toBe(true);
  expect(frames.at(-1)?.jump).toBe('');
  expect(frames.at(-1)?.mode).toBe('following');
});

test('a visible reader already at tail acknowledges append and resize without publishing unseen', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1798 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  const viewport = page.locator('.timeline-message-list');
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(24);
  await installProbe(page);

  const pulse = await request.post('/mock/control/action', { data: { type: 'pulse' } });
  expect(pulse.ok()).toBe(true);
  const frames = await sampleFrames(page);
  const evidence = await page.evaluate(() => ({
    scrollWrites: window.__JUMP_LATEST_SCROLL_WRITES__ || [],
    rows: [...document.querySelectorAll('.timeline-message-list [data-presentation-row-id]')]
      .map((node) => node.dataset.presentationRowId || ''),
  }));
  await attachJSON(testInfo, 'jump-latest-following.json', { frames, ...evidence });

  // A reader already following the tail must consume the append in place:
  // there is no unseen affordance and the list remains physically at bottom.
  expect(frames.every((frame) => frame.jump === '')).toBe(true);
  expect(frames.every((frame) => frame.gap <= 1)).toBe(true);
  expect(frames.at(-1)?.mode).toBe('following');
  expect(evidence.rows.length).toBeGreaterThan(0);
});

test('same-turn terminal arrival joins the committed tail without a resize callback', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'long-running', seed: 1799 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await chooseSteward(page);

  const editor = page.getByTestId('composer-input');
  const text = 'jump latest same-turn terminal ownership';
  await editor.fill(text);
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.getByText(text, { exact: true })).toBeVisible();
  const requestIDReady = () => page.evaluate((value) => {
    const entry = [...document.querySelectorAll('[data-presentation-row-id]')]
      .reverse().find((node) => node.textContent?.includes(value));
    return entry?.getAttribute('data-presentation-row-id') || '';
  }, text);
  await expect.poll(requestIDReady, { timeout: 15_000 }).toMatch(/[A-Za-z0-9]/);
  const requestID = await requestIDReady();

  await installProbe(page);
  const beforeTerminalHeight = await page.locator('.timeline-message-list').evaluate((node) => node.scrollHeight);
  const terminal = await request.post('/mock/control/action', {
    data: { type: 'push_terminal', channel_id: 'c0', request_id: requestID, status: 'completed' },
  });
  expect(terminal.ok()).toBe(true);
  await page.waitForTimeout(250);
  const jump = page.getByRole('button', { name: /条新动态/ });
  if (await jump.isVisible().catch(() => false)) await jump.click();
  const frames = await sampleFrames(page, 60);
  const evidence = await page.evaluate(() => ({
    scrollWrites: window.__JUMP_LATEST_SCROLL_WRITES__ || [],
    requestRows: [...document.querySelectorAll('[data-presentation-row-id]')]
      .map((node) => node.getAttribute('data-presentation-row-id') || '')
      .filter(Boolean),
  }));
  await attachJSON(testInfo, 'jump-latest-progress.json', {
    requestID, beforeTerminalHeight, frames, ...evidence,
  });

  expect(evidence.requestRows.filter((id) => id === requestID)).toHaveLength(1);
  expect(frames.at(-1)?.gap).toBeLessThanOrEqual(1);
  expect(frames.at(-1)?.jump).toBe('');
  expect(frames.at(-1)?.mode).toBe('following');
});
