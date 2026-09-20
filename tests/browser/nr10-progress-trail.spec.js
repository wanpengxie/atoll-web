import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request, seed = 10010) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'progress-demo', seed },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

test('NR10-01/04 public process detail and live timing', async ({ page, request }) => {
  await reset(request);
  await login(page);

  const marker = 'NR10 public process timing';
  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  await editor.fill('@st');
  await page.getByRole('option', { name: /steward/ }).click();
  await editor.press('End');
  await editor.pressSequentially(marker);
  await page.getByRole('button', { name: '发送', exact: true }).click();

  const turn = page.locator('.agent-conversation-turn').filter({ hasText: marker }).first();
  await expect(turn).toBeVisible();
  const trail = turn.locator('.progress-trail.running');
  await expect(trail).toBeVisible();
  await expect(trail.locator('.progress-row')).toHaveCount(1);
  await expect(trail.locator('.progress-row time')).toHaveCount(1);
  await expect(trail.locator('.progress-row-duration')).toHaveCount(1);
  // The fixture's first tool observation has no typed detail: the public
  // turn-level process action must not advertise an empty panel.
  await expect(turn.getByRole('button', { name: '查看过程' })).toHaveCount(0);
  const before = await trail.locator('.progress-row-duration').textContent();
  await expect.poll(
    () => trail.locator('.progress-row-duration').textContent(),
    { timeout: 4_000, intervals: [100, 250, 500] },
  ).not.toBe(before);

  await trail.getByRole('button', { name: /展开过程详情/ }).click();
  const requestId = await turn.getAttribute('data-request-id');
  const detailText = '浏览器可见的过程正文，不是 wire JSON。';
  const response = await request.post(`${MOCK}/mock/control/action`, {
    data: {
      type: 'push_provisional',
      channel_id: 'c0',
      request_id: requestId,
      status: 'processing',
      payload: {
        process: {
          kind: 'stage',
          stage: 'thinking',
          text: detailText,
          input: { secret: 'nr10-wire-input' },
          output: { secret: 'nr10-wire-output' },
        },
      },
    },
  });
  expect(response.ok()).toBe(true);

  await expect(trail.locator('.progress-row-line', { hasText: detailText })).toBeVisible();
  await expect(turn.getByRole('button', { name: '查看过程' })).toHaveCount(2);
  const stageDetailTrigger = trail.locator('button[title="查看完整内容"]').filter({ hasText: detailText });
  await stageDetailTrigger.click();
  const drawer = page.getByRole('dialog', { name: /过程详情/ });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText(detailText);
  await expect(drawer.locator('pre')).toHaveCount(0);
  await expect(drawer).not.toContainText('nr10-wire-input');
  await expect(drawer).not.toContainText('nr10-wire-output');
  await drawer.getByRole('button', { name: '关闭详情' }).click();
  await expect(drawer).toHaveCount(0);
  await expect.poll(() => stageDetailTrigger.evaluate((node) => document.activeElement === node)).toBe(true);

  const liveToolCallID = 'nr10-live-tool-sync';
  const liveToolStart = await request.post(`${MOCK}/mock/control/action`, {
    data: {
      type: 'push_provisional',
      channel_id: 'c0',
      request_id: requestId,
      status: 'processing',
      payload: {
        process: {
          kind: 'tool', phase: 'started', tool_call_id: liveToolCallID,
          tool: 'search', input: { secret: 'nr10-live-input' },
        },
      },
    },
  });
  expect(liveToolStart.ok()).toBe(true);
  // The row keeps its React key/DOM identity while its status text changes
  // from started to ended; locate it by stable trail position, not mutable
  // status text.
  const liveToolRow = trail.locator('.progress-row').last();
  await expect(liveToolRow).toBeVisible();
  await expect(liveToolRow).toContainText('tool: search …');
  await expect(liveToolRow.locator('button[title="查看完整内容"]')).toHaveCount(0);

  const liveToolEnd = await request.post(`${MOCK}/mock/control/action`, {
    data: {
      type: 'push_provisional',
      channel_id: 'c0',
      request_id: requestId,
      status: 'processing',
      payload: {
        process: {
          kind: 'tool', phase: 'ended', tool_call_id: liveToolCallID,
          tool: 'search', outcome: 'completed', detail: '同一调用的公开结果。',
          input: { secret: 'nr10-live-input' }, output: { secret: 'nr10-live-output' },
        },
      },
    },
  });
  expect(liveToolEnd.ok()).toBe(true);
  await expect(liveToolRow.locator('button[title="查看完整内容"]')).toHaveCount(1);
  await liveToolRow.locator('button[title="查看完整内容"]').click();
  const liveDrawer = page.getByRole('dialog', { name: /过程详情/ });
  await expect(liveDrawer).toContainText('同一调用的公开结果。');
  await expect(liveDrawer).not.toContainText('nr10-live-input');
  await expect(liveDrawer).not.toContainText('nr10-live-output');
  await liveDrawer.getByRole('button', { name: '关闭详情' }).click();
  await expect(liveDrawer).toHaveCount(0);
});
