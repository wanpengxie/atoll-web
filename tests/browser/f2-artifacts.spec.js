import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';


async function reset(request, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario: 'resource-workflow', seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

test('F2-001..005 频道挂载目录上传、附加到消息并保留可追溯引用', async ({ page, request }) => {
  await reset(request, 1201); await login(page);
  await page.locator('#workspace-files-toggle').click();
  const view = page.getByRole('region', { name: '频道文件' });
  await expect(view).toBeVisible();
  // 列表吃满的是**它那一格**，不再是整个工作区——文件区已经是与动态并排的分屏。
  // 判据没变（列表恒不自己留白、恒无圆角、表头恒贴着工具条），只是量的对象换了。
  const fileGeometry = await page.evaluate(() => {
    const paneNode = document.querySelector('.artifacts-view');
    // 量的是内容盒：分屏那条 1px 分隔线是边框，恒不算列表的留白。
    const paneBox = paneNode.getBoundingClientRect();
    const pane = { left: paneBox.left + paneNode.clientLeft, right: paneBox.right - (paneBox.width - paneNode.clientLeft - paneNode.clientWidth) };
    const toolbar = document.querySelector('.finder-toolbar').getBoundingClientRect();
    const list = document.querySelector('.channel-file-list').getBoundingClientRect();
    const header = document.querySelector('.finder-list-header').getBoundingClientRect();
    return { paneLeft: pane.left, paneRight: pane.right, toolbarBottom: toolbar.bottom, listLeft: list.left, listRight: list.right, headerTop: header.top, radius: getComputedStyle(document.querySelector('.channel-file-list')).borderRadius };
  });
  expect(fileGeometry.listLeft).toBe(fileGeometry.paneLeft);
  expect(fileGeometry.listRight).toBe(fileGeometry.paneRight);
  expect(fileGeometry.headerTop).toBe(fileGeometry.toolbarBottom);
  expect(fileGeometry.radius).toBe('0px');
  await expect(view).toContainText('当前目录为空');
  await expect(view).toContainText('local-device');
  await expect(view).not.toContainText('daemon://local-device/c0/');
  await view.getByLabel('选择要上传到当前目录的文件').setInputFiles({ name: '研究交付物.txt', mimeType: 'text/plain', buffer: Buffer.from('可信的预览内容') });
  await expect(view.getByText('研究交付物.txt', { exact: true })).toBeVisible();
  const mountedFile = view.locator('.channel-file-row').filter({ hasText: '研究交付物.txt' });
  await expect(mountedFile.getByRole('button', { name: '下载', exact: true })).toHaveText('');
  await expect(mountedFile.getByRole('button', { name: '附加', exact: true })).toHaveText('');
  const rowDownload = page.waitForEvent('download');
  await mountedFile.getByRole('button', { name: '下载', exact: true }).click();
  expect((await rowDownload).suggestedFilename()).toBe('研究交付物.txt');
  await mountedFile.locator('.finder-name-cell').click();
  const mountedPreview = page.getByRole('complementary', { name: '文件详情' });
  await expect(mountedPreview).toContainText('可信的预览内容');
  await expect(mountedPreview).not.toContainText('text/plain');
  await expect(mountedPreview.locator('.artifact-metadata')).toHaveCount(0);
  await expect(mountedPreview.locator('.artifact-context-actions')).toHaveCount(0);
  await expect(page.locator('.context-host')).toHaveAttribute('data-context-type', 'artifact');
  const previewWidth = await page.locator('.context-pane').evaluate((node) => node.getBoundingClientRect().width);
  expect(previewWidth).toBeGreaterThan(520);
  await mountedPreview.getByRole('button', { name: '关闭文件详情' }).click();
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
  await expect(page.getByRole('complementary', { name: '文件详情' })).toContainText('可信的预览内容');
});

test('F2-006 长文件名与不支持预览安全降级，窄屏无横向溢出', async ({ page, request }) => {
  await reset(request, 1202); await login(page);
  await page.locator('#workspace-files-toggle').click();
  const longName = `${'非常长的交付文件名称'.repeat(12)}.bin`;
  await page.getByLabel('选择要上传到当前目录的文件').setInputFiles({ name: longName, mimeType: 'application/octet-stream', buffer: Buffer.from([0, 1, 2, 3]) });
  await page.locator('.channel-file-row').filter({ hasText: longName }).getByRole('button', { name: '附加' }).click();
  await page.getByRole('button', { name: /发送/ }).click();
  const messageAttachment = page.getByRole('button', { name: new RegExp(`预览 ${longName.slice(0, 12)}`) });
  await messageAttachment.click();
  const preview = page.getByRole('complementary', { name: '文件详情' });
  await expect(preview).toContainText('此文件暂不支持站内预览');
  await page.setViewportSize({ width: 800, height: 720 });
  const tabletGeometry = await page.evaluate(() => {
    const pane = document.querySelector('.context-pane').getBoundingClientRect();
    return { viewportWidth: innerWidth, paneLeft: pane.left, paneRight: pane.right, paneWidth: pane.width };
  });
  expect(tabletGeometry.paneLeft).toBe(0);
  expect(tabletGeometry.paneRight).toBe(tabletGeometry.viewportWidth);
  expect(tabletGeometry.paneWidth).toBe(tabletGeometry.viewportWidth);
  await page.setViewportSize({ width: 320, height: 720 });
  const geometry = await page.evaluate(() => {
    const pane = document.querySelector('.context-pane').getBoundingClientRect();
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, paneLeft: pane.left, paneRight: pane.right };
  });
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
  expect(geometry.paneLeft).toBe(0);
  expect(geometry.paneRight).toBe(geometry.width);
  await expect(preview.getByRole('button', { name: '下载' })).toHaveCount(0);
  await expect(preview.getByRole('button', { name: '关闭文件详情' })).toBeVisible();
});

test('Composer 直接区分本机上传与 daemon 频道文件选择', async ({ page, request }) => {
  await reset(request, 1203); await login(page);
  await expect(page.getByLabel('上传本机文件到频道')).toBeVisible();
  await expect(page.getByRole('button', { name: '从频道文件选择' })).toBeVisible();

  await page.getByLabel('上传本机文件到频道').setInputFiles({ name: '直接上传.txt', mimeType: 'text/plain', buffer: Buffer.from('由当前用户上传') });
  await expect(page.getByLabel('待发送附件')).toContainText('直接上传.txt');
  await page.getByRole('button', { name: '预览文件 直接上传.txt' }).click();
  const draftPreview = page.getByRole('complementary', { name: '文件详情' });
  await expect(draftPreview).toContainText('由当前用户上传');
  await draftPreview.getByRole('button', { name: '关闭文件详情' }).click();
  await expect(page.getByLabel('待发送附件')).toContainText('直接上传.txt');
  await page.getByRole('button', { name: '移除附件 直接上传.txt' }).click();

  await page.getByRole('button', { name: '从频道文件选择' }).click();
  const picker = page.getByRole('dialog', { name: '从频道文件选择' });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: /直接上传.txt/ }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByLabel('待发送附件')).toContainText('直接上传.txt');
  await expect(page.getByRole('tab', { name: '动态' })).toHaveAttribute('aria-selected', 'true');

  await page.setViewportSize({ width: 360, height: 760 });
  const uploadBounds = await page.getByLabel('上传本机文件到频道').boundingBox();
  const daemonPickerBounds = await page.getByRole('button', { name: '从频道文件选择' }).boundingBox();
  expect(uploadBounds?.width).toBeGreaterThanOrEqual(44);
  expect(uploadBounds?.height).toBeGreaterThanOrEqual(44);
  expect(daemonPickerBounds?.width).toBeGreaterThanOrEqual(44);
  expect(daemonPickerBounds?.height).toBeGreaterThanOrEqual(44);

  await page.getByRole('button', { name: '频道操作' }).click();
  await page.getByRole('menuitem', { name: '打开文件分屏' }).click();
  const mountedUploadBounds = await page.getByLabel('选择要上传到当前目录的文件').boundingBox();
  expect(mountedUploadBounds?.width).toBeGreaterThanOrEqual(44);
  expect(mountedUploadBounds?.height).toBeGreaterThanOrEqual(44);
});

test('Composer 支持粘贴与鼠标拖入本机文件', async ({ page, request }) => {
  await reset(request, 1204); await login(page);
  const input = page.getByRole('textbox', { name: '消息' });
  await input.evaluate((node) => {
    const transfer = { files: [new File(['clipboard image'], '剪贴板截图.png', { type: 'image/png' })], types: ['Files'], getData: () => '' };
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: transfer });
    node.dispatchEvent(event);
  });
  await expect(page.getByLabel('待发送附件')).toContainText('剪贴板截图.png');

  const surface = page.locator('.composer-surface');
  await surface.evaluate((node) => {
    const transfer = { files: [new File(['dragged report'], '拖入报告.pdf', { type: 'application/pdf' })], types: ['Files'], dropEffect: 'none' };
    const dragEnter = new Event('dragenter', { bubbles: true, cancelable: true });
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(dragEnter, 'dataTransfer', { value: transfer });
    Object.defineProperty(dragOver, 'dataTransfer', { value: transfer });
    node.dispatchEvent(dragEnter);
    node.dispatchEvent(dragOver);
    window.__composerDragTransfer = transfer;
  });
  await expect(page.getByText('松开以上传到当前频道')).toBeVisible();
  await surface.evaluate((node) => {
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: window.__composerDragTransfer });
    node.dispatchEvent(drop);
    delete window.__composerDragTransfer;
  });
  await expect(page.getByLabel('待发送附件')).toContainText('拖入报告.pdf');
  await expect(page.getByText('松开以上传到当前频道')).toBeHidden();
});

test('文件夹按物理 node_type 导航，不会被当成文件预览', async ({ page, request }) => {
  await reset(request, 1205); await login(page);
  await page.locator('#workspace-files-toggle').click();
  const view = page.getByRole('region', { name: '频道文件' });
  await view.getByRole('button', { name: /新建文件夹/ }).click();
  await view.getByLabel('新文件夹名称').fill('研究资料');
  await view.getByRole('button', { name: '创建', exact: true }).click();
  const folder = view.locator('.channel-file-row').filter({ hasText: '研究资料' });
  await expect(folder).toContainText('文件夹');
  await expect(folder.getByRole('button', { name: '打开' })).toHaveCount(0);
  await folder.click();
  await expect(page.getByRole('dialog', { name: /文件预览/ })).toHaveCount(0);
  await expect(view.getByRole('button', { name: '研究资料', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(view).toContainText('当前目录为空');
  await view.getByRole('button', { name: /新建文件夹/ }).click();
  await view.getByLabel('新文件夹名称').fill('设计');
  await view.getByRole('button', { name: '创建', exact: true }).click();
  const nested = view.locator('.channel-file-row').filter({ hasText: '设计' });
  await expect(nested).toContainText('文件夹');
  page.once('dialog', (dialog) => dialog.accept());
  await nested.getByRole('button', { name: '删除' }).click();
  await expect(nested).toHaveCount(0);
  await view.getByRole('button', { name: '返回上一级' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await view.locator('.channel-file-row').filter({ hasText: '研究资料' }).getByRole('button', { name: '删除' }).click();
  await expect(view.locator('.channel-file-row').filter({ hasText: '研究资料' })).toHaveCount(0);
});
