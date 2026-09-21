import { expect, test } from '@playwright/test';

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
  await expect(page.locator('main h1')).toHaveText('c0');
}

async function append(request, ask, text, agent_id) {
  const data = { type: 'q_tail_append', channel_id: 'c0', ask, text };
  if (agent_id) data.agent_id = agent_id;
  const response = await request.post('/mock/control/action', { data });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.request_id).toBeTruthy();
  return body;
}

async function chooseSteward(page) {
  const choose = page.getByRole('button', { name: '选择 Agent' });
  if (!await choose.isVisible().catch(() => false)) return;
  await choose.click();
  await page.getByRole('menu', { name: '选择目标 Agent' })
    .getByRole('menuitem', { name: 'steward' }).click();
}

function watchPageErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error?.stack || error)));
  return errors;
}

async function installProbe(page, { hold = false } = {}) {
  await page.evaluate((holdWriter) => {
    const root = document.querySelector('.timeline-message-list');
    if (!root) throw new Error('timeline root is not mounted');
    const ownDescriptor = Object.getOwnPropertyDescriptor(root, 'scrollTo');
    const nativeScrollTo = root.scrollTo?.bind(root);
    const calls = [];
    root.scrollTo = (...args) => {
      const beforeTop = Number(root.scrollTop || 0);
      const requestedTop = Number(args?.[0]?.top ?? args?.[1]);
      const tail = Number.isFinite(requestedTop) && requestedTop > beforeTop + 1;
      calls.push({
        at: performance.now(),
        beforeTop,
        requestedTop,
        scrollHeight: Number(root.scrollHeight || 0),
        clientHeight: Number(root.clientHeight || 0),
        tail,
        mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
      });
      if (!holdWriter) return nativeScrollTo?.(...args);
      window.__TC0259_STRICT__?.notify?.();
      window.__TC0259_STRICT__.notify = null;
      return undefined;
    };
    window.__TC0259_STRICT__ = {
      calls,
      restore() {
        if (ownDescriptor) Object.defineProperty(root, 'scrollTo', ownDescriptor);
        else delete root.scrollTo;
      },
    };
  }, hold);
}

async function waitForTailCall(page) {
  await page.evaluate(() => new Promise((resolve) => {
    const state = window.__TC0259_STRICT__;
    if (!state) throw new Error('strict probe is not installed');
    if (state.calls.some((call) => call.tail)) { resolve(); return; }
    state.notify = resolve;
  }));
}

async function evidence(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.timeline-message-list');
    return {
      calls: window.__TC0259_STRICT__?.calls || [],
      mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
      jump: document.querySelector('.timeline-jump-latest')?.textContent || '',
      gap: root ? root.scrollHeight - root.clientHeight - root.scrollTop : null,
    };
  });
}

test('TC0259 strict wheel-before-paint has exactly one tail writer', async ({ page, request }) => {
  const pageErrors = watchPageErrors(page);
  await reset(request, 'deep-history', 1801);
  await login(page);
  const viewport = page.locator('.timeline-message-list');
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  await viewport.hover();
  await page.mouse.wheel(0, -2_000);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeGreaterThan(24);
  await append(request, 'TC0259 strict first unseen', 'TC0259 strict first unseen answer');
  const jump = page.getByRole('button', { name: /1 条新动态/ });
  await expect(jump).toBeVisible();
  await installProbe(page, { hold: true });
  const jumpClick = jump.click();
  await waitForTailCall(page);
  await viewport.hover();
  await page.mouse.wheel(0, -240);
  await jumpClick;
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  await expect(page.getByRole('button', { name: /1 条新动态/ })).toBeVisible();
  await append(request, 'TC0259 strict second unseen', 'TC0259 strict second unseen answer');
  await expect(page.getByRole('button', { name: /2 条新动态/ })).toBeVisible();
  const result = await evidence(page);
  console.log(`TC0259_STRICT_WHEEL ${JSON.stringify({ result, pageErrors })}`);
  expect(result.calls.filter((call) => call.tail)).toHaveLength(1);
  expect(result.mode).toBe('browsing');
  expect(result.jump).toContain('2 条新动态');
  expect(result.gap).toBeGreaterThan(24);
  expect(pageErrors).toEqual([]);
  await page.evaluate(() => window.__TC0259_STRICT__?.restore?.());
});

test('TC0259 inside jump has exactly one writer', async ({ page, request }) => {
  const pageErrors = watchPageErrors(page);
  await reset(request, 'deep-history', 1797);
  await login(page);
  const viewport = page.locator('.timeline-message-list');
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  await viewport.hover();
  await page.mouse.wheel(0, -2_000);
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeGreaterThan(24);
  await installProbe(page);
  const appended = await append(request, 'TC0259 strict inside', 'TC0259 strict inside answer');
  const jump = page.getByRole('button', { name: /条新动态/ });
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(page.locator(`[data-presentation-row-id="${appended.request_id}"]`)).toHaveCount(1);
  await expect.poll(() => page.evaluate((id) => {
    const root = document.querySelector('.timeline-message-list');
    const node = root?.querySelector(`[data-presentation-row-id="${id}"]`);
    const vr = root?.getBoundingClientRect(); const rr = node?.getBoundingClientRect();
    return Boolean(vr && rr && rr.bottom > vr.top && rr.top < vr.bottom);
  }, appended.request_id)).toBe(true);
  const result = await evidence(page);
  console.log(`TC0259_STRICT_INSIDE ${JSON.stringify({ result, pageErrors })}`);
  expect(result.calls.filter((call) => call.tail)).toHaveLength(1);
  expect(result.mode).toBe('following');
  expect(result.gap).toBeLessThanOrEqual(1);
  expect(pageErrors).toEqual([]);
  await page.evaluate(() => window.__TC0259_STRICT__?.restore?.());
});

test('TC0259 following append has one geometry writer', async ({ page, request }) => {
  const pageErrors = watchPageErrors(page);
  await reset(request, 'deep-history', 1798);
  await login(page);
  const viewport = page.locator('.timeline-message-list');
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(24);
  await installProbe(page);
  const appended = await append(request, 'TC0259 strict following', 'TC0259 strict following answer');
  await expect(page.locator(`[data-presentation-row-id="${appended.request_id}"]`)).toHaveCount(1);
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
  const result = await evidence(page);
  console.log(`TC0259_STRICT_FOLLOWING ${JSON.stringify({ result, pageErrors })}`);
  expect(result.calls.filter((call) => call.tail)).toHaveLength(1);
  expect(result.mode).toBe('following');
  expect(pageErrors).toEqual([]);
  await page.evaluate(() => window.__TC0259_STRICT__?.restore?.());
});
