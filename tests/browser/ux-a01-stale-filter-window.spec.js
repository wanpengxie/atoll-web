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

const EXPECTED_ROW_IDS = [
  'c0-history-request-1',
  'c0-history-request-2',
  'c0-history-request-3',
  'c0-approval-1',
  'c0-summary',
];

async function installPublicPaintFence(page) {
  await page.evaluate((expectedRowIDs) => {
    const state = {
      done: false,
      outcome: 'pending',
      firstVisibleRowsAt: 0,
      admissionAt: 0,
      stableFrames: 0,
      postAdmissionFrames: 0,
      maxPositionDriftPx: 0,
      maxAnchorDriftPx: 0,
      expectedRowIDs,
      events: [],
    };
    let lastKey = '';
    let stableKey = '';
    let postAdmissionKey = '';
    let frameID = 0;
    let observer;
    const startedAt = performance.now();

    const rounded = (value) => Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
    const publicVisible = (node) => {
      if (!node?.isConnected) return false;
      for (let current = node; current && current.nodeType === 1; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0'
          || style.pointerEvents === 'none' || current.hasAttribute('inert')
          || current.getAttribute('aria-hidden') === 'true') return false;
      }
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const hitTested = (node) => {
      if (!publicVisible(node)) return false;
      const rect = node.getBoundingClientRect();
      const left = Math.max(0, rect.left);
      const right = Math.min(window.innerWidth, rect.right);
      const top = Math.max(0, rect.top);
      const bottom = Math.min(window.innerHeight, rect.bottom);
      if (right <= left || bottom <= top) return false;
      const target = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      return Boolean(target && (target === node || node.contains(target)));
    };
    const rowEvidence = (node, isHitTested = false) => {
      const rect = node.getBoundingClientRect();
      return {
        id: node.dataset.presentationRowId || '',
        top: rounded(rect.top),
        bottom: rounded(rect.bottom),
        height: rounded(rect.height),
        hitTested: isHitTested,
      };
    };
    const focusEvidence = () => {
      const active = document.activeElement;
      if (!active) return { key: '', visible: false };
      const key = [
        active.tagName || '',
        active.id || '',
        active.className || '',
        active.getAttribute?.('role') || '',
        active.getAttribute?.('aria-label') || '',
        active.textContent?.trim().slice(0, 80) || '',
      ].join('|');
      return {
        key,
        tag: active.tagName || '',
        id: active.id || '',
        className: typeof active.className === 'string' ? active.className : '',
        role: active.getAttribute?.('role') || '',
        ariaLabel: active.getAttribute?.('aria-label') || '',
        visible: active === document.body || active === document.documentElement || publicVisible(active),
      };
    };
    const stop = () => {
      observer?.disconnect();
      if (frameID) cancelAnimationFrame(frameID);
    };
    const finish = (outcome) => {
      state.outcome = outcome;
      state.done = true;
      stop();
    };
    const inspect = (source) => {
      const pane = document.querySelector('.dynamic-message-pane');
      const surface = pane?.querySelector('.conversation-surface');
      const slot = surface?.querySelector('.conversation-reading-slot');
      const candidates = [...document.querySelectorAll(
        '.timeline-reading-layer.is-active .timeline-message-list',
      )];
      const root = candidates.find((node) => publicVisible(node))
        || candidates[0]
        || document.querySelector('.timeline-message-list');
      const surfaceVisible = Boolean(
        pane?.getAttribute('data-surface-visible') === 'true'
        && publicVisible(pane)
        && publicVisible(surface)
        && publicVisible(slot),
      );
      const listVisible = publicVisible(root);
      const allRows = root ? [...root.querySelectorAll('[data-presentation-row-id]')] : [];
      const renderedRows = allRows.filter((node) => publicVisible(node));
      const hitRows = renderedRows.filter((node) => hitTested(node));
      const rendered = renderedRows.map((node) => rowEvidence(node));
      const hit = hitRows.map((node) => rowEvidence(node, true));
      const focus = focusEvidence();
      const scrollTop = root && Number.isFinite(root.scrollTop) ? rounded(root.scrollTop) : null;
      const revision = root?.getAttribute('data-reading-presentation-revision') || '';
      const rootIdentity = root?.getAttribute('data-reading-root-identity') || '';
      const empty = root?.getAttribute('data-empty') || '';
      const stale = Boolean(document.querySelector('.timeline-actor-filter .is-stale'));
      const key = JSON.stringify({
        surfaceVisible,
        listVisible,
        revision,
        rootIdentity,
        empty,
        rendered,
        hit,
        scrollTop,
        focus: focus.key,
      });
      const snapshot = {
        source,
        t: Math.round(performance.now() - startedAt),
        surfaceVisible,
        listVisible,
        revision,
        rootIdentity,
        empty,
        stale,
        renderedRows: rendered,
        hitTestedRows: hit,
        scrollTop,
        focus,
      };
      if (key !== lastKey) {
        state.events.push(snapshot);
        lastKey = key;
      }
      if (state.done || stale) return;

      // Rows in Virtuoso's aria-hidden/visibility:hidden preparing layer are
      // deliberately excluded above. Admission starts only once a row is in
      // the visible, hit-tested surface for ten actual RAF paints.
      if (!surfaceVisible || !listVisible || !hit.length) {
        if (state.admitted) finish('visible-empty-after-admission');
        return;
      }
      const visibleKey = JSON.stringify({
        surfaceVisible,
        listVisible,
        revision,
        rootIdentity,
        rendered,
        hit,
        scrollTop,
        focus: focus.key,
      });
      if (!state.admitted) {
        if (!state.firstVisibleRowsAt) {
          state.firstVisibleRowsAt = snapshot.t;
          stableKey = visibleKey;
          state.stableFrames = 0;
          return;
        }
        if (source === 'raf' && visibleKey === stableKey) state.stableFrames += 1;
        else if (visibleKey !== stableKey) {
          stableKey = visibleKey;
          state.stableFrames = 0;
        }
        if (state.stableFrames >= 10) {
          state.admitted = {
            rowIDs: rendered.map((row) => row.id),
            anchor: hit[0] || null,
            scrollTop,
            focusKey: focus.key,
          };
          state.admissionAt = snapshot.t;
          postAdmissionKey = visibleKey;
          state.postAdmissionFrames = 0;
        }
        return;
      }

      const admitted = state.admitted;
      if (typeof admitted.scrollTop === 'number' && typeof scrollTop === 'number') {
        state.maxPositionDriftPx = Math.max(
          state.maxPositionDriftPx,
          Math.abs(scrollTop - admitted.scrollTop),
        );
      }
      const currentAnchor = hit.find((row) => row.id === admitted.anchor?.id);
      const anchorDrift = currentAnchor && admitted.anchor
        ? Math.abs(currentAnchor.top - admitted.anchor.top)
        : Infinity;
      state.maxAnchorDriftPx = Math.max(state.maxAnchorDriftPx, anchorDrift);
      if (state.maxPositionDriftPx > 1 || state.maxAnchorDriftPx > 1) {
        finish('post-admission-position-drift');
        return;
      }
      if (focus.key !== admitted.focusKey) {
        finish('post-admission-focus-change');
        return;
      }
      if (source === 'raf' && visibleKey === postAdmissionKey) state.postAdmissionFrames += 1;
      else if (visibleKey !== postAdmissionKey) {
        postAdmissionKey = visibleKey;
        state.postAdmissionFrames = 0;
      }
      // Keep observing a second paint fence after admission. This catches a
      // later public empty or geometry/focus change without fixed sleeps.
      if (state.postAdmissionFrames >= 10) {
        state.final = snapshot;
        finish('settled');
      }
    };
    const tick = () => {
      inspect('raf');
      if (!state.done) frameID = requestAnimationFrame(tick);
    };
    observer = new MutationObserver(() => inspect('mutation'));
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'class',
        'style',
        'aria-hidden',
        'data-empty',
        'data-surface-visible',
        'data-reading-presentation-revision',
        'data-reading-root-identity',
      ],
    });
    window.__UX_A01_PUBLIC_PAINT_FENCE__ = state;
    inspect('before-click');
    frameID = requestAnimationFrame(tick);
  }, EXPECTED_ROW_IDS);
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
  }).catch(() => {});
  const evidence = await page.evaluate(() => {
    const value = window.__UX_A01_PUBLIC_PAINT_FENCE__;
    if (value && !value.done) {
      value.done = true;
      value.outcome = 'visible-presentation-timeout';
    }
    return value;
  });
  const evidencePath = testInfo.outputPath('ux-a01-public-paint-fence.json');
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  await testInfo.attach('ux-a01-public-paint-fence.json', {
    path: evidencePath,
    contentType: 'application/json',
  });

  expect(evidence.outcome, JSON.stringify(evidence, null, 2)).toBe('settled');
  expect(evidence.final.stale, JSON.stringify(evidence, null, 2)).toBe(false);
  expect(evidence.final.renderedRows.map((row) => row.id)).toEqual(EXPECTED_ROW_IDS);
  expect(evidence.final.hitTestedRows.length).toBeGreaterThan(0);
  expect(evidence.maxPositionDriftPx).toBeLessThanOrEqual(1);
  expect(evidence.maxAnchorDriftPx).toBeLessThanOrEqual(1);
  expect(evidence.final.focus.visible).toBe(true);
});
