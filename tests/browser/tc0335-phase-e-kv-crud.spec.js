import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'resource-workflow', seed: 305 },
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

async function openKvResources(page) {
  await page.getByRole('button', { name: '频道操作' }).click();
  await page.getByRole('menuitem', { name: '高级资源工具', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '频道资源' });
  await expect(panel).toBeVisible();
  await panel.getByRole('tab', { name: 'KV', exact: true }).click();
  return panel;
}

test('TC-0335 E-BR-07 KV 资源 create/read/write/stat/list/delete 用户闭环', async ({ page, request }) => {
  await reset(request);
  await login(page);
  const panel = await openKvResources(page);
  const result = panel.locator('.resource-result');

  await panel.getByRole('button', { name: '列出', exact: true }).click();
  await expect(result).toContainText('"items": []');

  await panel.getByLabel('KV 资源 ID').fill('kv:browser');
  await panel.getByLabel('KV Args JSON').fill('{"value":1}');
  await panel.getByRole('button', { name: '创建', exact: true }).click();
  await expect(result).toContainText('"resource_id": "kv:browser"');
  await expect(result).toContainText('"value": 1');

  await panel.getByLabel('KV Args JSON').fill('{"value":2}');
  await panel.getByRole('button', { name: '写入', exact: true }).click();
  await expect(result).toContainText('"value": 2');

  await panel.getByRole('button', { name: '读取', exact: true }).click();
  await expect(result).toContainText('"resource_id": "kv:browser"');
  await expect(result).toContainText('"value": 2');

  await panel.getByRole('button', { name: '状态', exact: true }).click();
  await expect(result).toContainText('"exists": true');

  await panel.getByRole('button', { name: '列出', exact: true }).click();
  await expect(result).toContainText('"resource_id": "kv:browser"');
  await expect(result).toContainText('"kind": "kv"');

  await panel.getByRole('button', { name: '删除', exact: true }).click();
  await expect(result).toContainText('"deleted": true');

  await panel.getByRole('button', { name: '状态', exact: true }).click();
  await expect(result).toContainText('"exists": false');
});
