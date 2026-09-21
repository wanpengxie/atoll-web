import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request, seed = 1204) {
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

test('TC-0163 F2-008 Composer 粘贴与拖入本机文件各加入当前草稿', async ({ page, request }) => {
  await reset(request);
  await login(page);

  const input = page.getByRole('textbox', { name: '消息', exact: true });
  const drafts = page.getByLabel('待发送附件');

  // Public paste route: a local file is materialized into this channel's
  // draft, without opening Files or inventing a second attachment store.
  await input.evaluate((node) => {
    const transfer = {
      files: [new File(['clipboard image'], '剪贴板截图.png', { type: 'image/png' })],
      types: ['Files'],
      getData: () => '',
    };
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: transfer });
    node.dispatchEvent(event);
  });
  await expect(drafts).toContainText('剪贴板截图.png');
  await expect(drafts.locator('article')).toHaveCount(1);

  // Public drag/drop route: the visible drop affordance is transient, and
  // release adds exactly one second local attachment to the same draft.
  const surface = page.locator('.composer-surface');
  await surface.evaluate((node) => {
    const transfer = {
      files: [new File(['dragged report'], '拖入报告.pdf', { type: 'application/pdf' })],
      types: ['Files'],
      dropEffect: 'none',
    };
    const dragEnter = new Event('dragenter', { bubbles: true, cancelable: true });
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(dragEnter, 'dataTransfer', { value: transfer });
    Object.defineProperty(dragOver, 'dataTransfer', { value: transfer });
    node.dispatchEvent(dragEnter);
    node.dispatchEvent(dragOver);
    window.__tc0163DragTransfer = transfer;
  });
  await expect(page.getByText('松开以上传到当前频道')).toBeVisible();

  await surface.evaluate((node) => {
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: window.__tc0163DragTransfer });
    node.dispatchEvent(drop);
    delete window.__tc0163DragTransfer;
  });

  await expect(drafts).toContainText('拖入报告.pdf');
  await expect(drafts.locator('article')).toHaveCount(2);
  await expect(page.getByText('松开以上传到当前频道')).toHaveCount(0);
});
