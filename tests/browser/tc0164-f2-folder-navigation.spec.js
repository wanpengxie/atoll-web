import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'multi-channel', seed },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号' }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

async function createFolder(files, name) {
  await files.getByRole('button', { name: /新建文件夹/ }).click();
  await files.getByLabel('新文件夹名称').fill(name);
  await files.getByRole('button', { name: '创建', exact: true }).click();
  const row = files.getByRole('row', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  return row;
}

test('TC-0164 folder rows navigate by node type without opening preview', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 1205);
  await login(page);

  await page.locator('#workspace-files-toggle').click();
  const files = page.getByRole('region', { name: '频道文件' });
  await expect(files).toBeVisible();

  const parent = await createFolder(files, '研究资料');
  await expect(parent).toContainText('文件夹');
  await expect(parent.getByRole('button', { name: '打开' })).toHaveCount(0);
  await parent.click();

  // A directory click changes the public path and must never enter the
  // ArtifactPreviewPanel path used by regular file rows.
  await expect(page.getByRole('dialog', { name: /文件预览/ })).toHaveCount(0);
  await expect(files.getByRole('button', { name: '研究资料', exact: true }))
    .toHaveAttribute('aria-current', 'page');
  await expect(files).toContainText('当前目录为空');

  const nested = await createFolder(files, '设计');
  await expect(nested).toContainText('文件夹');
  await expect(nested.getByRole('button', { name: '打开' })).toHaveCount(0);

  page.once('dialog', (dialog) => dialog.accept());
  await nested.getByRole('button', { name: '删除' }).click();
  await expect(nested).toHaveCount(0);

  await files.getByRole('button', { name: '返回上一级', exact: true }).click();
  await expect(files.getByRole('row', { name: /研究资料/ })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await files.getByRole('row', { name: /研究资料/ })
    .getByRole('button', { name: '删除' }).click();
  await expect(files.getByRole('row', { name: /研究资料/ })).toHaveCount(0);
});
