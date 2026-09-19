import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

async function attachJSON(testInfo, name, payload) {
  const path = testInfo.outputPath(name);
  await writeFile(path, `${JSON.stringify({
    capturedAt: new Date().toISOString(),
    ...payload,
  }, null, 2)}\n`, 'utf8');
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

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

async function startFrameCapture(page) {
  await page.evaluate(() => {
    const state = { active: true, startedAt: performance.now(), frames: [] };
    window.__UNSEEN_FOLLOWING_CAPTURE__ = state;
    const tick = () => {
      if (!state.active) return;
      const viewport = document.querySelector('.timeline-message-list');
      const jump = document.querySelector('.timeline-jump-latest')?.textContent || '';
      const rows = [...(viewport?.querySelectorAll('[data-presentation-row-id]') || [])];
      const viewportRect = viewport?.getBoundingClientRect();
      const visibleRowIDs = rows.filter((row) => {
        const rect = row.getBoundingClientRect();
        if (!viewportRect || rect.bottom <= viewportRect.top + 1 || rect.top >= viewportRect.bottom - 1) return false;
        const x = Math.min(viewportRect.right - 1, Math.max(viewportRect.left + 1, (rect.left + rect.right) / 2));
        const y = Math.min(viewportRect.bottom - 1, Math.max(viewportRect.top + 1, (Math.max(rect.top, viewportRect.top) + Math.min(rect.bottom, viewportRect.bottom)) / 2));
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && (hit === row || row.contains(hit)));
      }).map((row) => row.dataset.presentationRowId || '');
      state.frames.push({
        elapsedMs: performance.now() - state.startedAt,
        jump,
        mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
        gap: viewport ? viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop : null,
        lastMountedRowID: rows.at(-1)?.dataset.presentationRowId || '',
        visibleRowIDs,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopFrameCapture(page) {
  return page.evaluate(() => {
    const capture = window.__UNSEEN_FOLLOWING_CAPTURE__;
    if (!capture) return [];
    capture.active = false;
    return capture.frames;
  });
}

async function sendToSteward(page) {
  const editor = page.getByLabel('消息');
  await editor.fill('@st');
  const option = page.getByRole('option', { name: /steward/ });
  if (await option.isVisible().catch(() => false)) await option.click();
  await editor.press('End');
  await editor.pressSequentially(' stationary bottom trigger probe');
  await page.getByRole('button', { name: /发送/ }).click();
}

test('following physical tail keeps a committed arrival visible without an unseen prompt', async ({ page, request }, testInfo) => {
  await reset(request, 'deep-history', 0x92_28_01);
  await login(page);
  const viewport = page.locator('.timeline-message-list');
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'following');
  await expect(page.locator('.timeline-jump-latest')).toHaveCount(0);

  await startFrameCapture(page);
  await sendToSteward(page);
  await expect(page.getByText('stationary bottom trigger probe', { exact: false })).toBeVisible();
  await page.waitForTimeout(1_500);
  const frames = await stopFrameCapture(page);
  const violatingFrames = frames.filter((frame) => frame.gap <= 1 && frame.jump);

  await attachJSON(testInfo, 'unseen-following-timeline.json', {
    frameTransitions: frames.filter((frame, index) => (
      index === 0
      || frame.jump !== frames[index - 1].jump
      || frame.lastMountedRowID !== frames[index - 1].lastMountedRowID
      || frame.visibleRowIDs.join('\0') !== frames[index - 1].visibleRowIDs.join('\0')
    )),
    violatingFrames,
    final: frames.at(-1) || null,
  });

  // The current arrival-receipt owner consumes a following-tail arrival as it
  // commits. Evidence is sampled from the rendered surface rather than an
  // implementation journal.
  expect(frames.at(-1)?.visibleRowIDs.length).toBeGreaterThan(0);
  expect(frames.at(-1)?.jump).toBe('');
  expect(violatingFrames).toEqual([]);
});
