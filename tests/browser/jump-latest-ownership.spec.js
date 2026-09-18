import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

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
    window.__JUMP_LATEST_EVENTS__ = [];
    window.__JUMP_LATEST_SCROLL_WRITES__ = [];
    window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'jump-latest-ownership' });
    window.__ATOLL_READING_TRACE__ = (event) => window.__JUMP_LATEST_EVENTS__.push(event);
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
  await expect(jump).toBeVisible();
  const before = await viewport.evaluate((node) => ({
    gap: Math.round(node.scrollHeight - node.clientHeight - node.scrollTop),
    scrollTop: node.scrollTop,
    scrollHeight: node.scrollHeight,
  }));
  await jump.click();
  const frames = await sampleFrames(page);
  const evidence = await page.evaluate(() => ({
    events: window.__JUMP_LATEST_EVENTS__ || [],
    scrollWrites: window.__JUMP_LATEST_SCROLL_WRITES__ || [],
    reading: window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.() || [],
    diagnostics: window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || [],
  }));
  await attachJSON(testInfo, 'jump-latest-browsing.json', { before, frames, ...evidence });

  const writes = evidence.events.filter((entry) => entry.stage === 'issuer-write');
  expect(writes.filter((entry) => entry.authorization === 'intent')).toHaveLength(1);
  expect(writes.filter((entry) => entry.authorization === 'presentation-height')).toHaveLength(1);
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
    events: window.__JUMP_LATEST_EVENTS__ || [],
    scrollWrites: window.__JUMP_LATEST_SCROLL_WRITES__ || [],
    reading: window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.() || [],
    diagnostics: window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || [],
  }));
  await attachJSON(testInfo, 'jump-latest-following.json', { frames, ...evidence });
  expect(frames.every((frame) => frame.jump === '')).toBe(true);
  expect(frames.every((frame) => frame.gap <= 1)).toBe(true);
});

test('same-turn terminal arrival joins committed tail evidence without a resize callback', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'long-running', seed: 1799 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await chooseSteward(page);
  await installProbe(page);
  await page.getByLabel('消息').fill('verify progress unseen ownership');
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.getByLabel('消息')).toHaveText('');

  await page.waitForTimeout(250);
  const requestID = await page.locator('[data-presentation-row-id]').last().getAttribute('data-presentation-row-id');
  expect(requestID).toBeTruthy();
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
    events: window.__JUMP_LATEST_EVENTS__ || [],
    scrollWrites: window.__JUMP_LATEST_SCROLL_WRITES__ || [],
    reading: window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.() || [],
    diagnostics: window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || [],
  }));
  const afterTerminalHeight = frames[0]?.scrollHeight;
  await attachJSON(testInfo, 'jump-latest-progress.json', {
    requestID, beforeTerminalHeight, afterTerminalHeight, frames, ...evidence,
  });

  expect(frames.at(-1)?.gap).toBeLessThanOrEqual(1);
  expect(frames.at(-1)?.jump).toBe('');
  const entries = evidence.reading.entries || [];
  const arrivals = entries.filter((entry) => entry.event === 'reading.unseen-arrival');
  const acks = entries.filter((entry) => entry.event === 'reading.visible-tail-ack');
  expect(arrivals.length).toBeGreaterThan(0);
  expect(acks.at(-1)?.detail?.remaining || 0).toBe(0);
  expect(arrivals.every((entry) => entry.detail.records.every((record) => Number.isSafeInteger(record.seq) && record.seq > 0))).toBe(true);
});
