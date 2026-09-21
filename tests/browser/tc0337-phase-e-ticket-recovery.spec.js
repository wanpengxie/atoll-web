import path from 'node:path';
import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

const UPLOAD = path.resolve('tests/fixtures/phase-e-upload.txt');

async function reset(request, seed = 337) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'resource-ticket-expired', seed },
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

async function openFileResources(page) {
  await page.getByRole('button', { name: '频道操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '高级资源工具', exact: true }).click();
  const resources = page.getByRole('complementary', { name: '频道资源' });
  await expect(resources).toBeVisible();
  await resources.getByRole('tab', { name: '文件', exact: true }).click();
  const files = resources.getByRole('region', { name: '频道文件' });
  await expect(files).toBeVisible();
  return { files };
}

test('TC-0337 expired upload ticket keeps Files context and allows a fresh retry', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request);
  await login(page);

  const putResponses = [];
  let firstPut = true;
  page.on('response', (response) => {
    if (response.request().method() === 'PUT' && new URL(response.url()).pathname === '/files') putResponses.push(response.status());
  });
  await page.route(/\/files(?:\?|$)/, async (route) => {
    if (route.request().method() === 'PUT' && firstPut) {
      firstPut = false;
      const advanced = await request.post(`${MOCK}/mock/control/advance`, { data: { ms: 60_000 } });
      expect(advanced.ok()).toBe(true);
    }
    await route.continue();
  });

  const { files } = await openFileResources(page);
  await expect(files.getByText('当前目录为空', { exact: true })).toBeVisible();
  await expect(files.getByText('local-device', { exact: true })).toBeVisible();

  const upload = files.getByLabel('选择要上传到当前目录的文件');
  await upload.setInputFiles(UPLOAD);
  const alert = files.getByRole('alert');
  await expect(alert).toContainText('ticket expired');
  await expect(alert).toContainText('上传失败，可重新获取票据');
  await expect(files.getByText('local-device', { exact: true })).toBeVisible();

  await upload.setInputFiles(UPLOAD);
  const row = files.getByRole('row').filter({ hasText: 'phase-e-upload.txt' });
  await expect(row).toBeVisible();
  await expect(files.getByRole('alert')).toHaveCount(0);
  expect(putResponses).toEqual([403, 200]);
});
