import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

async function reset(request, seed) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'multi-channel', seed },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

async function installPublicPaintFence(page) {
  await page.evaluate(() => {
    const state = {
      done: false,
      outcome: 'pending',
      firstRowsAt: 0,
      stableFrames: 0,
      events: [],
    };
    let lastKey = '';
    let frameID = 0;
    const startedAt = performance.now();
    const stop = () => {
      observer.disconnect();
      if (frameID) cancelAnimationFrame(frameID);
    };
    const inspect = (source) => {
      const root = document.querySelector('.timeline-message-list');
      const rows = [...document.querySelectorAll('.timeline-message-list [data-presentation-row-id]')]
        .map((node) => node.dataset.presentationRowId);
      const stale = Boolean(document.querySelector('.timeline-actor-filter .is-stale'));
      const revision = root?.getAttribute('data-reading-presentation-revision') || '';
      const rootIdentity = root?.getAttribute('data-reading-root-identity') || '';
      const empty = root?.getAttribute('data-empty') || '';
      const key = JSON.stringify({ stale, revision, rootIdentity, empty, rows });
      if (key !== lastKey) {
        state.events.push({
          source,
          t: Math.round(performance.now() - startedAt),
          stale,
          revision,
          rootIdentity,
          empty,
          rows,
        });
        lastKey = key;
      }
      if (state.done || stale) return;
      if (!rows.length) {
        if (state.firstRowsAt > 0) {
          state.outcome = 'empty-after-first-visible-row';
          state.done = true;
          stop();
        }
        return;
      }
      if (!state.firstRowsAt) {
        state.firstRowsAt = Math.round(performance.now() - startedAt);
        state.stableFrames = 0;
        state.stableKey = key;
        return;
      }
      if (state.stableKey === key && source === 'raf') state.stableFrames += 1;
      else if (state.stableKey !== key) {
        state.stableKey = key;
        state.stableFrames = 0;
      }
      // This is a public paint fence, not a fixed sleep: the same visible row
      // identity/revision must survive ten consecutive browser paint callbacks.
      if (state.stableFrames >= 10) {
        state.outcome = 'settled';
        state.done = true;
        stop();
      }
    };
    const tick = () => {
      inspect('raf');
      if (!state.done) frameID = requestAnimationFrame(tick);
    };
    const observer = new MutationObserver(() => inspect('mutation'));
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'class',
        'data-empty',
        'data-reading-presentation-revision',
        'data-reading-root-identity',
      ],
    });
    window.__UX_A01_PUBLIC_PAINT_FENCE__ = state;
    inspect('before-click');
    frameID = requestAnimationFrame(tick);
  });
}

test('UX-A01 removing stale filter never clears the public list before the new view settles', async ({ page, request }, testInfo) => {
  await reset(request, 29102);
  await login(page);
  await page.evaluate(() => {
    const key = 'atoll.view-session.v3.root';
    const value = JSON.parse(localStorage.getItem(key) || '{"schema":3,"preferences":{},"readings":{}}');
    value.schema = 3;
    value.preferences ||= {};
    value.readings ||= {};
    value.preferences.c0 = {
      ...(value.preferences.c0 || {}),
      scope: 'mine',
      actorFilter: ['agent:steward:old-incarnation'],
    };
    localStorage.setItem(key, JSON.stringify(value));
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.connection-state')?.classList.contains('state-open')
    && document.querySelector('.timeline-actor-filter .is-stale'));

  await installPublicPaintFence(page);
  await page.locator('.timeline-actor-filter .is-stale').click();
  await page.waitForFunction(() => window.__UX_A01_PUBLIC_PAINT_FENCE__?.done === true, null, {
    timeout: 10_000,
  });
  const evidence = await page.evaluate(() => window.__UX_A01_PUBLIC_PAINT_FENCE__);
  const evidencePath = testInfo.outputPath('ux-a01-public-paint-fence.json');
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  await testInfo.attach('ux-a01-public-paint-fence.json', {
    path: evidencePath,
    contentType: 'application/json',
  });

  expect(evidence.outcome).toBe('settled');
  expect(evidence.events.some((event) => event.rows.length === 0 && event.t > evidence.firstRowsAt))
    .toBe(false);
});
