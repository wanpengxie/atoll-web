import { expect, test } from '@playwright/test';

const MOCK = `http://127.0.0.1:${process.env.ATOLL_TEST_MOCK_PORT || 8832}`;

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

test('F7 RequestTurn：父过程、子消息和子过程严格隔离', async ({ page, request }) => {
  await reset(request); await login(page);
  const editor = page.getByLabel('消息');
  await editor.fill('@st');
  await page.getByRole('option', { name: /steward/ }).click();
  await editor.press('End');
  await editor.pressSequentially('请协作完成协议验收');
  await page.getByRole('button', { name: /发送/ }).click();

  const root = page.locator('.agent-conversation-turn').filter({ hasText: '请协作完成协议验收' });
  await expect(root).toContainText('A 已汇总 B 与 C 的结果。');
  const nodes = root.locator('.agent-thread-node');
  await expect(nodes).toHaveCount(3);
  await expect(nodes.nth(0)).toHaveAttribute('aria-level', '2');
  await expect(nodes.nth(1)).toHaveAttribute('aria-level', '3');
  await expect(nodes.nth(2)).toHaveAttribute('aria-level', '2');
  await expect(nodes.nth(0)).toContainText('B 负责资料分析');
  await expect(nodes.nth(1)).toContainText('D 负责核验关键事实');
  await expect(nodes.nth(1)).toContainText('Reviewer');
  await expect(nodes.nth(2)).toContainText('C 负责独立复核');
  const nodeToggles = nodes.getByRole('button', { name: /协作消息/ });
  await expect(nodeToggles).toHaveCount(3);
  await expect(nodeToggles.nth(0)).toHaveAttribute('aria-expanded', 'false');
  const collapsedContent = nodes.nth(1).locator('.agent-thread-content');
  await expect(collapsedContent).toHaveAttribute('aria-hidden', 'true');
  const collapsedStyle = await collapsedContent.evaluate((node) => {
    const style = getComputedStyle(node);
    return { maxHeight: style.maxHeight, overflow: style.overflow };
  });
  expect(collapsedStyle.maxHeight).not.toBe('none');
  expect(collapsedStyle.overflow).toBe('hidden');
  await nodeToggles.nth(0).click();
  await expect(nodeToggles.nth(0)).toHaveAttribute('aria-expanded', 'true');
  await expect(nodeToggles.nth(1)).toHaveAttribute('aria-expanded', 'false');

  const rootBubble = root.locator(':scope > .agent-turn-bubble');
  await expect(rootBubble.locator('.progress-trail-toggle')).toContainText('2 条过程记录');
  await rootBubble.locator('.progress-trail-toggle').click();
  await expect(rootBubble.locator('.progress-row')).toHaveCount(2);

  const bBubble = nodes.nth(0).locator('.agent-thread-response > .agent-turn-bubble');
  await expect(bBubble.locator('.progress-trail-toggle')).toContainText('2 条过程记录');
  const dBubble = nodes.nth(1).locator('.agent-thread-response > .agent-turn-bubble');
  await expect(dBubble.locator('.progress-trail-toggle')).toContainText('1 条过程记录');

  await rootBubble.locator('.progress-row button').first().click();
  const detail = page.getByRole('dialog', { name: /过程详情/ });
  await expect(detail.locator('.progress-json-tree')).toContainText('B 汇总完成');
  await expect(detail).not.toContainText('B 正在整理资料');
  await expect(detail).not.toContainText('D 正在核验');
  await expect(detail).not.toContainText('progress_events');
  await detail.getByRole('button', { name: '关闭详情' }).click();

  await page.setViewportSize({ width: 320, height: 720 });
  await nodes.nth(1).locator('.response-content').evaluate((content) => {
    const pre = document.createElement('pre');
    pre.textContent = 'mobile-width-regression-'.repeat(80);
    content.append(pre);
  });
  const geometry = await page.evaluate(() => {
    const timeline = document.querySelector('.timeline-message-list');
    const root = document.querySelector('.agent-conversation-turn');
    const childNodes = [...document.querySelectorAll('.agent-thread-node')];
    const rootRect = root.getBoundingClientRect();
    return {
      viewport: innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      timelineClientWidth: timeline.clientWidth,
      timelineScrollWidth: timeline.scrollWidth,
      rootRight: rootRect.right,
      children: childNodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      }),
    };
  });
  expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.timelineScrollWidth).toBeLessThanOrEqual(geometry.timelineClientWidth);
  expect(geometry.children.every((child) => child.right <= geometry.rootRight + 1)).toBe(true);
  expect(geometry.children[1].left).toBeGreaterThan(geometry.children[0].left);
  expect(geometry.children[1].width).toBeLessThan(geometry.children[0].width);
  expect(Math.max(...geometry.children.map((child) => child.right)) - Math.min(...geometry.children.map((child) => child.right))).toBeLessThanOrEqual(1);
});
