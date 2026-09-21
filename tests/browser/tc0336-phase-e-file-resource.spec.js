import path from 'node:path';
import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

const UPLOAD = path.resolve('tests/fixtures/phase-e-upload.txt');

async function reset(request, seed = 336) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'resource-workflow', seed },
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
  return { resources, files };
}

async function chooseRecipientIfNeeded(page) {
  const chooser = page.getByRole('button', { name: '选择 Agent', exact: true });
  if (await chooser.isVisible().catch(() => false)) {
    await chooser.click();
    const menu = page.getByRole('menu', { name: '选择目标 Agent' });
    const steward = menu.getByRole('menuitem', { name: 'steward', exact: true });
    if (await steward.count()) await steward.click();
    else await menu.getByRole('menuitem').first().click();
  }
}

test('TC-0336 E-BR-08/E-BR-10 文件上传、附加、发送和下载用户闭环', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request);
  await login(page);

  const { resources, files } = await openFileResources(page);
  await expect(files.getByText('当前目录为空', { exact: true })).toBeVisible();
  await expect(files.getByText('local-device', { exact: true })).toBeVisible();

  await files.getByLabel('选择要上传到当前目录的文件').setInputFiles(UPLOAD);
  const row = files.getByRole('row').filter({ hasText: 'phase-e-upload.txt' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: '附加', exact: true }).click();
  await resources.getByRole('button', { name: '关闭频道资源', exact: true }).click();

  const drafts = page.getByLabel('待发送附件');
  await expect(drafts).toContainText('phase-e-upload.txt');
  await chooseRecipientIfNeeded(page);
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('TC0336 file resource attachment');
  await page.getByRole('button', { name: /发送/ }).click();

  const message = page.locator('.message-attachments').last();
  await expect(message).toContainText('phase-e-upload.txt');
  const download = page.waitForEvent('download');
  await message.getByRole('button', { name: '下载 phase-e-upload.txt', exact: true }).click();
  const downloaded = await download;
  expect(downloaded.suggestedFilename()).toBe('phase-e-upload.txt');
  expect(await downloaded.failure()).toBeNull();
});

