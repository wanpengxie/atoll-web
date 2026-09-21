import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// TC-0234 public contract: TimelineRowRenderer owns the visible ThreadCall
// projection and reuses the same ProgressTrail owner for each child turn.
// The browser path deliberately scopes every assertion to one public row; it
// never inspects the normalized thread store or a private renderer helper.

async function reset(request, seed = 1701) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario: 'agent-tree', seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

test('TC-0234 ThreadCall 只显示被展开子回合自己的过程轨迹', async ({ page, request }) => {
  await reset(request);
  await login(page);

  const editor = page.getByLabel('消息');
  await editor.fill('@st');
  await page.getByRole('option', { name: /steward/ }).click();
  await editor.press('End');
  await editor.pressSequentially('请协作完成协议验收');
  await page.getByRole('button', { name: /发送/ }).click();

  const root = page.locator('.agent-conversation-turn').filter({ hasText: '请协作完成协议验收' }).first();
  await expect(root).toContainText('A 已汇总 B 与 C 的结果。');
  const rootBubble = root.locator('.agent-turn-bubble');
  const rootTrail = rootBubble.locator('.progress-trail.settled');
  await expect(rootTrail.locator('.progress-trail-toggle')).toContainText('2 条过程记录');
  await expect(rootTrail).not.toContainText('B 正在整理资料');
  await expect(rootTrail).not.toContainText('C 正在复核');

  const threadToggle = root.locator('.turn-thread-toggle');
  await expect(threadToggle).toContainText('3 次关联调用');
  await threadToggle.click();
  const items = root.locator('.turn-thread-item');
  await expect(items).toHaveCount(3);
  const rows = items.locator('.turn-thread-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('aria-expanded', 'false');
  await expect(rows.nth(1)).toHaveAttribute('aria-expanded', 'false');
  await expect(rows.nth(2)).toHaveAttribute('aria-expanded', 'false');

  const child = items.filter({ hasText: 'B 负责资料分析' }).first();
  await child.locator('.turn-thread-row').click();
  const childTrail = child.locator('.progress-trail.settled');
  await expect(childTrail.locator('.progress-trail-toggle')).toContainText('2 条过程记录');
  await childTrail.locator('.progress-trail-toggle').click();
  await expect(childTrail.locator('.progress-row')).toHaveCount(2);
  await expect(childTrail).toContainText('B 正在整理资料');
  await expect(childTrail).not.toContainText('C 正在复核');
  await expect(childTrail).not.toContainText('D 正在核验');

  const grandchild = items.filter({ hasText: 'D 负责核验关键事实' }).first();
  await grandchild.locator('.turn-thread-row').click();
  const grandchildTrail = grandchild.locator('.progress-trail.settled');
  await expect(grandchildTrail.locator('.progress-trail-toggle')).toContainText('1 条过程记录');
  await grandchildTrail.locator('.progress-trail-toggle').click();
  await expect(grandchildTrail.locator('.progress-row')).toHaveCount(1);
  await expect(grandchildTrail).toContainText('D 正在核验');
  await expect(grandchildTrail).not.toContainText('B 正在整理资料');
  await expect(grandchildTrail).not.toContainText('C 正在复核');

  const sibling = items.filter({ hasText: 'C 负责独立复核' }).first();
  await sibling.locator('.turn-thread-row').click();
  const siblingTrail = sibling.locator('.progress-trail.settled');
  await expect(siblingTrail.locator('.progress-trail-toggle')).toContainText('1 条过程记录');
  await siblingTrail.locator('.progress-trail-toggle').click();
  await expect(siblingTrail.locator('.progress-row')).toHaveCount(1);
  await expect(siblingTrail).toContainText('C 正在复核');
  await expect(siblingTrail).not.toContainText('B 正在整理资料');
  await expect(siblingTrail).not.toContainText('D 正在核验');
});
