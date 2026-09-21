import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// Exact public successor for fae8b70:tests/browser/f2-artifacts.spec.js:105
// (TC-0162).  The two attachment sources remain separate Composer actions:
// local bytes enter through the native file control, while a daemon resource
// enters through the channel-file picker.  This test intentionally keeps the
// historical sequence and assertions instead of replacing it with a generic
// "an attachment exists" smoke test.

async function reset(request, seed = 1203) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'multi-channel', seed },
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

test('TC-0162 Composer 直接区分本机上传与 daemon 频道文件选择', async ({ page, request }) => {
  await reset(request);
  await login(page);

  const localUpload = page.getByLabel('上传本机文件到频道');
  const daemonPicker = page.getByRole('button', { name: '从频道文件选择', exact: true });
  await expect(localUpload).toBeVisible();
  await expect(daemonPicker).toBeVisible();

  await localUpload.setInputFiles({
    name: '直接上传.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('由当前用户上传'),
  });
  const drafts = page.getByLabel('待发送附件');
  await expect(drafts).toContainText('直接上传.txt');

  // Preview/remove is part of the old public sequence: local upload is a
  // draft attachment before the daemon picker is opened, not an implicit
  // channel-file selection.
  await page.getByRole('button', { name: '预览文件 直接上传.txt' }).click();
  const draftPreview = page.getByRole('complementary', { name: '文件详情' });
  await expect(draftPreview).toContainText('由当前用户上传');
  await draftPreview.getByRole('button', { name: '关闭文件详情' }).click();
  await expect(drafts).toContainText('直接上传.txt');
  await page.getByRole('button', { name: '移除附件 直接上传.txt' }).click();

  await daemonPicker.click();
  const picker = page.getByRole('dialog', { name: '从频道文件选择' });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: /直接上传\.txt/ }).click();
  await expect(picker).toBeHidden();
  await expect(drafts).toContainText('直接上传.txt');
  await expect(page.getByRole('tab', { name: '动态' })).toHaveAttribute('aria-selected', 'true');

  // On a compact viewport both public actions remain coarse-pointer targets,
  // keyboard reachable, and inside the Composer surface without horizontal
  // overflow.  No private component state is used as an oracle here.
  await page.setViewportSize({ width: 360, height: 760 });
  const uploadBounds = await localUpload.boundingBox();
  const daemonPickerBounds = await daemonPicker.boundingBox();
  expect(uploadBounds?.width).toBeGreaterThanOrEqual(44);
  expect(uploadBounds?.height).toBeGreaterThanOrEqual(44);
  expect(daemonPickerBounds?.width).toBeGreaterThanOrEqual(44);
  expect(daemonPickerBounds?.height).toBeGreaterThanOrEqual(44);

  const readingBeforeFocus = await page.locator('.conversation-reading-slot').boundingBox();
  await localUpload.focus();
  await expect(localUpload).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(daemonPicker).toBeFocused();
  const compactGeometry = await page.evaluate(() => {
    const reading = document.querySelector('.conversation-reading-slot').getBoundingClientRect();
    const toolbar = document.querySelector('.composer-toolbar').getBoundingClientRect();
    const surface = document.querySelector('.composer-surface').getBoundingClientRect();
    return {
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      reading: { top: reading.top, bottom: reading.bottom },
      toolbar: { left: toolbar.left, right: toolbar.right },
      surface: { left: surface.left, right: surface.right },
    };
  });
  expect(compactGeometry.documentWidth).toBeLessThanOrEqual(compactGeometry.viewportWidth);
  expect(compactGeometry.toolbar.left).toBeGreaterThanOrEqual(compactGeometry.surface.left);
  expect(compactGeometry.toolbar.right).toBeLessThanOrEqual(compactGeometry.surface.right);
  expect(readingBeforeFocus).not.toBeNull();
  expect(compactGeometry.reading.top).toBeCloseTo(readingBeforeFocus.y, 2);
  expect(compactGeometry.reading.bottom).toBeCloseTo(readingBeforeFocus.y + readingBeforeFocus.height, 2);

  await page.getByRole('button', { name: '频道操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '打开文件', exact: true }).click();
  const mountedUploadBounds = await page.getByLabel('选择要上传到当前目录的文件').boundingBox();
  expect(mountedUploadBounds?.width).toBeGreaterThanOrEqual(44);
  expect(mountedUploadBounds?.height).toBeGreaterThanOrEqual(44);
});
