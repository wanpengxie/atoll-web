import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'approval-schema', seed },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

function decodeSentFrame(frame) {
  try {
    const outer = typeof frame === 'string' ? JSON.parse(frame) : frame;
    return typeof outer?.payload === 'string' ? JSON.parse(outer.payload) : outer?.payload || null;
  } catch {
    return null;
  }
}

function watchBrowserErrors(page) {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
  return {
    pageErrors,
    async unhandledRejections() {
      return page.evaluate(() => window.__AD257_UNHANDLED_REJECTIONS__ || []);
    },
  };
}

async function installUnhandledRejectionProbe(page) {
  await page.addInitScript(() => {
    window.__AD257_UNHANDLED_REJECTIONS__ = [];
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason || {};
      window.__AD257_UNHANDLED_REJECTIONS__.push({
        name: reason.name || typeof reason,
        message: reason.message || String(reason),
      });
    });
  });
}

async function waitForApproval(page) {
  const approval = page.locator('.approval-card[data-request-id="c0-approval-1"]');
  await expect(approval).toBeVisible();
  return approval;
}

test('AD257 resolve rejection is a bounded UI error with no browser unhandled rejection', async ({ page, request }) => {
  const frames = [];
  const errors = watchBrowserErrors(page);
  await installUnhandledRejectionProbe(page);
  page.on('websocket', (socket) => socket.on('framesent', (frame) => frames.push(decodeSentFrame(frame))));

  await reset(request, 25701);
  await login(page);
  const approval = await waitForApproval(page);
  const fault = await request.post(`${MOCK}/mock/control/fault`, {
    data: { target: 'resolve', mode: 'reject', code: 'resolve_denied', count: 1 },
  });
  expect(fault.ok()).toBe(true);

  await approval.getByRole('button', { name: '批准', exact: true }).click();
  await expect(approval).toContainText('操作失败');
  await approval.locator('.wire-error details summary').click();
  await expect(approval).toContainText('resolve_denied');
  await expect.poll(() => frames.filter((frame) => frame?.frame_type === 'resolve')).toHaveLength(1);
  expect(frames.filter((frame) => frame?.frame_type === 'resolve')[0]?.payload).toMatchObject({
    req_id: 'c0-approval-1',
    decision: 'approve',
  });

  // Public contract: an ApprovalCard action must consume its rejected Promise;
  // a bounded control error may remain visible, but must not escape as either
  // a pageerror or a window unhandledrejection.
  expect(errors.pageErrors).toEqual([]);
  await expect.poll(() => errors.unhandledRejections()).toEqual([]);
});

test('AD257 resolve connection closure is consumed without pageerror or unhandled rejection', async ({ page, request }) => {
  const frames = [];
  const errors = watchBrowserErrors(page);
  await installUnhandledRejectionProbe(page);
  page.on('websocket', (socket) => socket.on('framesent', (frame) => frames.push(decodeSentFrame(frame))));

  await reset(request, 25702);
  await login(page);
  const approval = await waitForApproval(page);
  const fault = await request.post(`${MOCK}/mock/control/fault`, {
    data: { target: 'resolve', mode: 'drop', count: 1 },
  });
  expect(fault.ok()).toBe(true);

  await approval.getByRole('button', { name: '批准', exact: true }).click();
  await expect.poll(() => frames.filter((frame) => frame?.frame_type === 'resolve')).toHaveLength(1);
  await page.waitForTimeout(1000);

  // The pending resolve is a public action Promise. Transport closure must be
  // represented in its bounded state, never as an unhandled browser error.
  expect(errors.pageErrors).toEqual([]);
  await expect.poll(() => errors.unhandledRejections()).toEqual([]);
});
