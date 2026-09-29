import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// AD-195/197 successor: the round-26 unit contracts are retained for the
// compact terminal boundary, while this file exercises the actual
// AppShell/Workspace public owners.  No React state, diagnostics, wire
// internals, or private callbacks are used as a verdict.

const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 },
};

async function reset(request, scenario, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario, seed },
  });
  expect(response.ok()).toBe(true);
}

async function login(page, profile) {
  await page.goto(profile === 'mobile' ? '/?perf=mobile' : '/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

async function openCreate(page) {
  const railCreate = page.getByRole('button', { name: '新建频道', exact: true });
  if (await railCreate.isVisible()) {
    await railCreate.click();
  } else {
    // The compact shell keeps the same public action in the channel menu;
    // the hidden rail is not a valid mobile oracle.
    await page.getByRole('button', { name: '频道操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '新建子频道', exact: true }).click();
  }
  const modal = page.getByRole('dialog', { name: '新建频道' });
  await expect(modal).toBeVisible();
  await expect(modal.getByLabel('新频道名称')).toBeVisible();
  return modal;
}

async function submitCreate(modal, name) {
  await modal.getByLabel('新频道名称').fill(name);
  await modal.getByLabel('频道用途').fill('AD-195/197 four-state public owner');
  await modal.getByRole('button', { name: '创建频道', exact: true }).click();
}

async function expectReady(modal, childName) {
  const progress = modal.getByRole('region', { name: '频道创建进度' });
  await expect(progress).toBeVisible();
  // 就绪句后面还跟着一句"成员的构建结果在频道设置和时间线上"，只认开头。
  await expect(progress.getByText(/^频道已经可以打开和协作。/)).toBeVisible();
  await expect(progress.getByText('已确认', { exact: true })).toHaveCount(4);
  await expect(modal.getByRole('button', { name: '进入新频道', exact: true })).toBeVisible();
  await expect(modal.locator('header').getByText('已就绪', { exact: true })).toBeVisible();
  // The compact rail is intentionally hidden until the public channel-list
  // toggle opens it.  Desktop callers additionally see the rail inline.
  await expect(modal.page().locator('.channel-rail').getByText(childName, { exact: true })).toHaveCount(1);
}

async function expectMobileRail(page, childName) {
  await page.getByRole('button', { name: '打开频道列表', exact: true }).click();
  const rail = page.locator('.channel-rail');
  await expect(rail.getByText(childName, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭频道列表', exact: true }).click();
}

async function expectError(modal) {
  await expect(modal.getByRole('alert').first()).toBeVisible();
  await expect(modal.getByRole('alert').first()).toContainText(/失败|拒绝|unauthorized|active channel member/i);
  await expect(modal.getByText(/^频道已经可以打开和协作。/)).toHaveCount(0);
  await expect(modal.getByRole('button', { name: '进入新频道', exact: true })).toHaveCount(0);
}

function describeViewport(profile) {
  return test.describe(`${profile} AppShell/Workspace`, () => {
    test.use({ viewport: VIEWPORTS[profile] });

    test(`${profile} ready state converges through the public channel-create rail`, async ({ page, request }) => {
      await reset(request, 'channel-governance', profile === 'mobile' ? 19501 : 19500);
      await login(page, profile);
      const modal = await openCreate(page);
      await submitCreate(modal, `ad195-ready-${profile}`);
      await expectReady(modal, `c0.ad195-ready-${profile}`);
      if (profile === 'mobile') {
        await modal.getByRole('button', { name: '关闭新建频道', exact: true }).click();
        await expectMobileRail(page, `c0.ad195-ready-${profile}`);
      }
    });

    test(`${profile} running state is observable while delayed convergence settles`, async ({ page, request }) => {
      await reset(request, 'channel-governance-delay', profile === 'mobile' ? 19511 : 19510);
      await login(page, profile);
      const modal = await openCreate(page);
      await submitCreate(modal, `ad195-running-${profile}`);
      // This is the only running oracle: the public submit control is bounded
      // and disabled while the command/ledger/directory projection settles.
      await expect(modal.getByRole('button', { name: /正在提交…|等待频道就绪…/ })).toBeVisible();
      await expectReady(modal, `c0.ad195-running-${profile}`);
      if (profile === 'mobile') {
        await modal.getByRole('button', { name: '关闭新建频道', exact: true }).click();
        await expectMobileRail(page, `c0.ad195-running-${profile}`);
      }
    });

    test(`${profile} server rejection is a bounded public error`, async ({ page, request }) => {
      await reset(request, 'channel-governance-denied', profile === 'mobile' ? 19521 : 19520);
      await login(page, profile);
      const modal = await openCreate(page);
      await submitCreate(modal, `ad197-error-${profile}`);
      await expectError(modal);
    });
  });
}

describeViewport('desktop');
describeViewport('mobile');

test.describe('mobile denied space owner boundary', () => {
  test.use({ viewport: VIEWPORTS.mobile });

  // 空间管理现在真能写了（Actor 描述、设备），原来那条"没有空间治理结果投影"
  // 的不可用说明随之退役。这里守它的后继：服务端拒绝一个空间命令时，面板给出
  // 一条有边界的公开错误，不伪造成功，列表里也不多出那一行。
  test('AD-195/197 successor keeps a denied space command a bounded public error', async ({ page, request }) => {
    await reset(request, 'space-administration-denied', 19530);
    await login(page, 'mobile');
    await page.getByRole('button', { name: '打开频道列表', exact: true }).click();
    await page.getByRole('button', { name: '空间管理', exact: true }).click();
    const panel = page.getByRole('complementary', { name: '空间管理' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('tab', { name: 'Actor 描述', exact: true })).toHaveAttribute('aria-selected', 'true');
    await panel.getByLabel('Actor 描述名字').fill('denied-writer');
    await panel.getByLabel('Actor 描述 Class').fill('claude');
    await panel.getByRole('button', { name: '新建', exact: true }).click();
    await expect(panel.getByRole('alert').first()).toContainText(/unauthorized_sender|active channel member/);
    await expect(panel.getByRole('region', { name: 'Actor 描述 denied-writer' })).toHaveCount(0);
    await expect(panel.getByText('Actor 描述已新建。')).toHaveCount(0);
  });
});
