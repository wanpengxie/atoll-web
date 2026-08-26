import { expect, test } from '@playwright/test';

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

test('F7 channel notifications baseline history, count root turns, and clear only at the visible tail', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'multi-channel', seed: 2608 } });
  expect(reset.ok()).toBe(true);
  await login(page);

  const channel = page.locator('.channel-item').filter({ hasText: 'c0.project' });
  const related = channel.locator('.unread-related');
  const other = channel.locator('.unread-total');
  await expect(related).toHaveCount(0);
  await expect(other).toHaveCount(0);

  const terminal = async (index) => {
    const response = await request.post('/mock/control/action', {
      data: { type: 'push_terminal', channel_id: 'c0.project', request_id: `c0.project-history-request-${index}` },
    });
    expect(response.ok()).toBe(true);
  };

  await terminal(1);
  await expect(related).toHaveText('1');
  await expect(other).toHaveCount(0);

  // Several settled frames in one root turn remain one notification.
  await terminal(1);
  await expect(related).toHaveText('1');
  await terminal(2);
  await expect(related).toHaveText('2');

  await channel.click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(related).toHaveCount(0);

  const viewport = page.locator('.timeline-message-list');
  await viewport.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await terminal(3);
  await expect(related).toHaveText('1');

  await viewport.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
    node.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect(related).toHaveCount(0);
});
