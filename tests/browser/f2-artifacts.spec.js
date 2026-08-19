import { expect, test } from '@playwright/test';

const MOCK = 'http://127.0.0.1:8832';

async function reset(request, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario: 'resource-workflow', seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByLabel('邮箱').fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

test('F2-001..005 频道挂载目录上传、附加到消息并保留可追溯引用', async ({ page, request }) => {
  await reset(request, 1201); await login(page);
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  const view = page.getByRole('tabpanel', { name: '文件' });
  const fileGeometry = await page.evaluate(() => {
    const workspace = document.querySelector('.workspace').getBoundingClientRect();
    const toolbar = document.querySelector('.finder-toolbar').getBoundingClientRect();
    const list = document.querySelector('.channel-file-list').getBoundingClientRect();
    const header = document.querySelector('.finder-list-header').getBoundingClientRect();
    return { workspaceLeft: workspace.left, workspaceRight: workspace.right, toolbarBottom: toolbar.bottom, listLeft: list.left, listRight: list.right, headerTop: header.top, radius: getComputedStyle(document.querySelector('.channel-file-list')).borderRadius };
  });
  expect(fileGeometry.listLeft).toBe(fileGeometry.workspaceLeft);
  expect(fileGeometry.listRight).toBe(fileGeometry.workspaceRight);
  expect(fileGeometry.headerTop).toBe(fileGeometry.toolbarBottom);
  expect(fileGeometry.radius).toBe('0px');
  await expect(view).toContainText('当前目录为空');
  await expect(view).toContainText('Mock local device');
  await expect(view).not.toContainText('daemon://local-device/c0/');
  await view.getByLabel('选择要上传到当前目录的文件').setInputFiles({ name: '研究交付物.txt', mimeType: 'text/plain', buffer: Buffer.from('可信的预览内容') });
  await expect(view.getByText('研究交付物.txt', { exact: true })).toBeVisible();
  const mountedFile = view.locator('.channel-file-row').filter({ hasText: '研究交付物.txt' });
  await mountedFile.getByRole('button', { name: '预览', exact: true }).click();
  const mountedPreview = page.getByRole('dialog', { name: /文件预览：研究交付物.txt/ });
  await expect(mountedPreview).toContainText('可信的预览内容');
  await expect(mountedPreview).toContainText('text/plain');
  await mountedPreview.getByRole('button', { name: '关闭文件预览' }).click();
  await mountedFile.getByRole('button', { name: '附加' }).click();
  await expect(page.getByLabel('待发送附件')).toContainText('研究交付物.txt');
  await expect(page.getByRole('tab', { name: '动态' })).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('消息').fill('交付研究结果');
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.getByRole('tab', { name: '动态' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('交付研究结果', { exact: true })).toBeVisible();
  const messageAttachment = page.getByRole('button', { name: '预览 研究交付物.txt' });
  await expect(messageAttachment).toContainText('文本');
  await expect(messageAttachment).not.toContainText('resource:');
  await messageAttachment.click();
  await expect(page.getByRole('dialog', { name: /文件预览：研究交付物.txt/ })).toContainText('可信的预览内容');
});

test('F2-006 长文件名与不支持预览安全降级，窄屏无横向溢出', async ({ page, request }) => {
  await reset(request, 1202); await login(page);
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  const longName = `${'非常长的交付文件名称'.repeat(12)}.bin`;
  await page.getByLabel('选择要上传到当前目录的文件').setInputFiles({ name: longName, mimeType: 'application/octet-stream', buffer: Buffer.from([1, 2, 3]) });
  await page.locator('.channel-file-row').filter({ hasText: longName }).getByRole('button', { name: '附加' }).click();
  await page.getByRole('button', { name: /发送/ }).click();
  const messageAttachment = page.getByRole('button', { name: new RegExp(`预览 ${longName.slice(0, 12)}`) });
  await messageAttachment.click();
  const preview = page.getByRole('dialog', { name: new RegExp(`文件预览：${longName.slice(0, 12)}`) });
  await expect(preview).toContainText('此文件暂不支持站内预览');
  await page.setViewportSize({ width: 320, height: 720 });
  const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
  await expect(preview.getByRole('button', { name: '下载' })).toBeVisible();
});
