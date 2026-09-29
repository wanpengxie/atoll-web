import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request, seed) {
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
}

test('TC-0161 F2-006 长文件名与不支持预览安全降级，窄屏无横向溢出', async ({ page, request }) => {
  await reset(request, 1202);
  await login(page);
  await page.locator('#workspace-files-toggle').click();

  const longName = `${'非常长的交付文件名称'.repeat(12)}.bin`;
  await page.getByLabel('选择要上传到当前目录的文件').setInputFiles({
    name: longName,
    mimeType: 'application/octet-stream',
    buffer: Buffer.from([0, 1, 2, 3]),
  });
  await page.locator('.channel-file-row').filter({ hasText: longName }).getByRole('button', { name: '附加' }).click();
  if (await page.getByRole('button', { name: '选择 Agent' }).isVisible()) {
    await page.getByRole('button', { name: '选择 Agent' }).click();
    await page.getByRole('menuitem').first().click();
  }
  await page.getByRole('button', { name: /发送/ }).click();

  const messageAttachment = page.getByRole('region', { name: '附件列表' }).getByRole('button').filter({ hasText: longName.slice(0, 12) }).first();
  await messageAttachment.click();
  const preview = page.getByRole('complementary', { name: '文件详情' });
  await expect(preview).toContainText('此文件暂不支持站内预览');

  // The preview is the channel's pane, not a modal: it fills the content area
  // beside the channel list (which stays usable) and never overflows.
  const readGeometry = () => page.evaluate(() => {
    const pane = document.querySelector('.preview-layer[data-active="true"]').getBoundingClientRect();
    const rail = document.querySelector('.channel-rail')?.getBoundingClientRect();
    return {
      viewportWidth: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      railRight: rail && rail.width > 0 && getComputedStyle(document.querySelector('.channel-rail')).visibility !== 'hidden' ? rail.right : 0,
      paneLeft: pane.left,
      paneRight: pane.right,
      backdrop: document.querySelectorAll('.context-backdrop').length,
    };
  });
  await page.setViewportSize({ width: 800, height: 720 });
  await expect.poll(async () => { const g = await readGeometry(); return g.paneLeft === g.railRight; }).toBe(true);
  const tabletGeometry = await readGeometry();
  expect(tabletGeometry.paneRight).toBe(tabletGeometry.viewportWidth);
  expect(tabletGeometry.backdrop).toBe(0);
  expect(tabletGeometry.scrollWidth).toBeLessThanOrEqual(tabletGeometry.viewportWidth);

  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(async () => (await readGeometry()).paneLeft).toBe(0);
  const geometry = await readGeometry();
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.paneRight).toBe(geometry.viewportWidth);
  await expect(preview.getByRole('button', { name: `下载 ${longName}`, exact: true })).toBeVisible();
  await expect(preview.getByRole('button', { name: '关闭文件详情' })).toBeVisible();
});
