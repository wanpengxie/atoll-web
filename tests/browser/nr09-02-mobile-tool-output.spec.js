import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

async function reset(request, seed = 90202) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'progress-demo', seed },
  });
  expect(response.ok()).toBe(true);
}

async function loginMobile(page) {
  await page.goto('/?perf=mobile');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

for (const width of [320, 390]) {
test(`NR09-02 mobile ${width}px bounds tool output and returns focus`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 844 });
  await reset(request);
  await loginMobile(page);

  const marker = 'NR09-02 mobile tool presentation';
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
  const requestId = await turn.getAttribute('data-request-id');
  const head = 'NR09-02-BROWSER-HEAD-';
  const tail = '-NR09-02-BROWSER-DURABLE-TAIL';
  const output = `${head}${'x'.repeat(200_000)}${tail}`;
  const response = await request.post(`${MOCK}/mock/control/action`, {
    data: {
      type: 'push_provisional',
      channel_id: 'c0',
      request_id: requestId,
      status: 'processing',
      payload: {
        process: {
          kind: 'tool',
          phase: 'ended',
          tool_call_id: 'nr09-02-browser-call',
          tool: 'cat',
          outcome: 'completed',
          detail: '移动端过程结果已返回。',
          output,
        },
      },
    },
  });
  expect(response.ok()).toBe(true);

  await trail.getByRole('button', { name: /展开过程详情/ }).click();
  const row = trail.locator('.progress-row').filter({ hasText: 'tool: cat 完成' });
  await expect(row).toBeVisible();
  const detailTrigger = row.locator('button[title="查看完整内容"]');
  await detailTrigger.click();
  const drawer = page.getByRole('dialog', { name: /过程详情/ });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText(head);
  await expect(drawer).toContainText('省略');
  await expect(drawer).not.toContainText(tail);
  const visible = await drawer.locator('.progress-drawer-body').textContent();
  expect(visible.length).toBeLessThan(4_700);
  const geometry = await drawer.locator('.progress-drawer-body').evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);

  await drawer.getByRole('button', { name: '关闭详情' }).click();
  await expect(drawer).toHaveCount(0);
  await expect.poll(() => detailTrigger.evaluate((node) => document.activeElement === node)).toBe(true);

  const nonToolHead = `NR09-02-NON-TOOL-${width}-HEAD-`;
  const nonToolTail = `-NR09-02-NON-TOOL-${width}-TAIL`;
  const nonToolResponse = await request.post(`${MOCK}/mock/control/action`, {
    data: {
      type: 'push_provisional',
      channel_id: 'c0',
      request_id: requestId,
      status: 'processing',
      payload: {
        process: {
          kind: 'stage',
          stage: 'text',
          text: `${nonToolHead}${'n'.repeat(8_000)}${nonToolTail}`,
        },
      },
    },
  });
  expect(nonToolResponse.ok()).toBe(true);
  const answer = turn.locator('.agent-progress-text').last();
  await expect(answer).toContainText(nonToolHead);
  await expect(answer).toContainText(nonToolTail);
  await expect(answer).not.toContainText('省略');
});
}
