import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Migrated from the fae8b70 baseline onto the current production timeline.
// The old test drove mock.channel.pulse, whose transient payload is explicitly
// not a person-readable Timeline item.  J therefore uses the canonical
// q_tail_append fixture: a real request+readable terminal append, while keeping
// the old user contract (browsing does not follow, a notice appears, and the
// explicit click paints exactly that appended row).

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

async function appendCanonicalTail(request, { ask, text }) {
  const response = await request.post('/mock/control/action', {
    data: { type: 'q_tail_append', channel_id: 'c0', ask, text },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.request_id).toBeTruthy();
  return body;
}

async function timelineSnapshot(page, targetID = '') {
  return page.evaluate((targetID) => {
    const viewport = document.querySelector('.timeline-message-list');
    const viewportRect = viewport?.getBoundingClientRect() || null;
    const rows = [...(viewport?.querySelectorAll('[data-presentation-row-id]') || [])];
    const target = targetID
      ? rows.find((node) => node.dataset.presentationRowId === targetID) || null
      : null;
    const targetRect = target?.getBoundingClientRect() || null;
    let hitTested = false;
    if (target && targetRect && viewportRect) {
      const left = Math.max(viewportRect.left, targetRect.left);
      const right = Math.min(viewportRect.right, targetRect.right);
      const top = Math.max(viewportRect.top, targetRect.top);
      const bottom = Math.min(viewportRect.bottom, targetRect.bottom);
      if (right - left > 1 && bottom - top > 1) {
        const x = (left + right) / 2;
        hitTested = [top + 1, (top + bottom) / 2, bottom - 1].some((y) => {
          const hit = document.elementFromPoint(x, y);
          return Boolean(hit && (hit === target || target.contains(hit)));
        });
      }
    }
    const scrollTop = Number(viewport?.scrollTop || 0);
    const scrollHeight = Number(viewport?.scrollHeight || 0);
    const clientHeight = Number(viewport?.clientHeight || 0);
    return {
      mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
      gap: scrollHeight - clientHeight - scrollTop,
      maxScrollTop: scrollHeight - clientHeight,
      scrollTop,
      jump: document.querySelector('.timeline-jump-latest')?.textContent || '',
      rowIDs: rows.map((node) => node.dataset.presentationRowId || ''),
      target: target ? {
        rowID: target.dataset.presentationRowId || '',
        rowCount: rows.filter((node) => node.dataset.presentationRowId === targetID).length,
        painted: Boolean(target.getClientRects().length),
        intersectsViewport: Boolean(targetRect && viewportRect
          && targetRect.bottom > viewportRect.top + 0.5
          && targetRect.top < viewportRect.bottom - 0.5),
        hitTested,
      } : null,
    };
  }, targetID);
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
  const marker = 'J canonical q_tail_append jump target';
  const appended = await appendCanonicalTail(request, {
    ask: 'J canonical passive append',
    text: marker,
  });
  const targetID = appended.request_id;
  const jump = page.getByRole('button', { name: /条新动态/ });
  await expect(jump).toBeVisible();
  const beforeClick = await timelineSnapshot(page, targetID);
  const writesBeforeClick = await page.evaluate(() => window.__JUMP_LATEST_SCROLL_WRITES__?.length || 0);
  expect(beforeClick.mode, JSON.stringify(beforeClick)).toBe('browsing');
  expect(beforeClick.gap, JSON.stringify(beforeClick)).toBeGreaterThan(24);
  expect(beforeClick.jump, JSON.stringify(beforeClick)).toContain('条新动态');
  expect(writesBeforeClick, JSON.stringify(beforeClick)).toBe(0);

  await jump.click();
  await expect(page.locator(`[data-presentation-row-id="${targetID}"]`)).toHaveCount(1);
  await expect.poll(async () => (await timelineSnapshot(page, targetID)).target?.hitTested || false).toBe(true);
  const frames = await sampleFrames(page);
  const evidence = await page.evaluate(() => ({
    scrollWrites: window.__JUMP_LATEST_SCROLL_WRITES__ || [],
    jumpText: document.querySelector('.timeline-jump-latest')?.textContent || '',
  }));
  const afterClick = await timelineSnapshot(page, targetID);
  await attachJSON(testInfo, 'jump-latest-browsing.json', {
    appended,
    targetID,
    beforeClick,
    afterClick,
    writesBeforeClick,
    frames,
    ...evidence,
  });

  // The passive append must not authorize a bottom write. Only the explicit
  // button click may write the current reading owner once.
  expect(evidence.scrollWrites.length).toBe(1);
  expect(afterClick.mode, JSON.stringify(afterClick)).toBe('following');
  expect(afterClick.gap, JSON.stringify(afterClick)).toBeLessThanOrEqual(1);
  expect(Math.abs(afterClick.scrollTop - afterClick.maxScrollTop), JSON.stringify(afterClick)).toBeLessThanOrEqual(1);
  expect(afterClick.jump, JSON.stringify(afterClick)).toBe('');
  expect(afterClick.target, JSON.stringify(afterClick)).toMatchObject({
    rowID: targetID,
    rowCount: 1,
    painted: true,
    intersectsViewport: true,
    hitTested: true,
  });
  expect(frames.some((frame) => frame.gap <= 1)).toBe(true);
  expect(frames.at(-1)?.gap).toBeLessThanOrEqual(1);
  expect(Math.abs(frames.at(-1)?.scrollTop - frames.at(-1)?.maxScrollTop)).toBeLessThanOrEqual(1);
  expect(frames.at(-1)?.lastRowVisible).toBe(true);
  expect(frames.at(-1)?.jump).toBe('');
  expect(frames.at(-1)?.mode).toBe('following');
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
