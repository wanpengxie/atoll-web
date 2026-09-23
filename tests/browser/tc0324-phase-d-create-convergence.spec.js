import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// Successor for fae8b70:tests/browser/phase-d.spec.js:72 (TC-0324 /
// D-BR-01/02/04).  The old operation-card/detail buttons were retired with
// the old Channel Context owner.  This keeps the user contract on the current
// public owners: ChannelCreateModal convergence, Shell rail projection,
// Activity operation source, and ChannelAdministrationPanel facts.

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'channel-governance', seed: 324 },
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

async function openGovernanceOverview(page) {
  await page.getByRole('button', { name: '频道操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '频道详情', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '频道治理' });
  await expect(panel).toBeVisible();
  await panel.getByRole('tab', { name: '概览', exact: true }).click();
  return panel;
}

test('TC-0324 D-BR-01/02/04 c0 child creation converges and exposes detail', async ({ page, request }) => {
  await reset(request);
  await login(page);

  await page.getByRole('button', { name: '新建频道', exact: true }).click();
  const creation = page.getByRole('dialog', { name: '新建频道' });
  await expect(creation).toBeVisible();
  await expect(creation.getByText(/在.*c0.*下创建子频道/)).toBeVisible();
  await creation.getByLabel('新频道名称').fill('design-room');
  await creation.getByLabel('频道用途').fill('集中讨论产品设计');
  await expect(creation.getByRole('combobox', { name: '频道模板', exact: true })).toBeVisible();
  await creation.getByRole('button', { name: '创建频道', exact: true }).click();

  const progress = creation.getByRole('region', { name: '频道创建进度' });
  for (const label of ['账本确认', '频道可观察', '成员关系', '服务就绪']) {
    await expect(progress.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(progress.getByText('已确认', { exact: true })).toHaveCount(4);
  await expect(progress.getByText('频道已经可以打开和协作。', { exact: true })).toBeVisible();
  await expect(page.locator('.channel-rail').getByText('c0.design-room', { exact: true })).toBeVisible();

  await creation.getByRole('button', { name: '关闭新建频道', exact: true }).click();
  await expect(creation).toHaveCount(0);

  // The create receipt remains user-observable through the canonical Activity
  // operation source, and opening it returns to the originating c0 turn.
  await page.getByRole('button', { name: '打开活动中心', exact: true }).click();
  const activity = page.getByRole('complementary', { name: '全局活动' });
  await expect(activity).toBeVisible();
  await activity.getByRole('tab', { name: '操作', exact: true }).click();
  const operation = activity.getByRole('button', { name: /创建频道 design-room/ });
  await expect(operation).toHaveCount(1);
  await operation.click();
  await expect(page.locator('.turn-card').filter({ hasText: '创建子频道' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '回合详情' })).toContainText('design-room');
  await page.getByRole('complementary', { name: '回合详情' }).getByRole('button', { name: '关闭过程' }).click();

  // Current Governance is the canonical detail projection.  It must expose
  // the created child and its serving status under the c0 parent, not invent a
  // second channel-get surface or rely on the retired operation button.
  const governance = await openGovernanceOverview(page);
  const child = governance.locator('.child-channel').filter({ hasText: 'design-room' });
  await expect(child).toHaveCount(1);
  await expect(child).toContainText('服务中');
  await expect(governance.getByRole('heading', { name: /^子频道/ })).toBeVisible();
  await expect(governance.locator('.channel-facts')).toContainText('c0');
  await expect(governance.getByRole('heading', { name: '创建子频道', exact: true })).toBeVisible();
});
