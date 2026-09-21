import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// Successor for fae8b70:tests/browser/phase-d.spec.js:204 (TC-0330/D-BR-11).
// The adjacent F5/NR07 specs cover the public route and pane persistence, but
// do not cover this baseline's 850/600x720 member-panel geometry contract.

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'actor-governance', seed: 207 },
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

test('TC-0330 D-BR-11 narrow channel member management stays inside the viewport', async ({ page, request }) => {
  await reset(request);
  await page.setViewportSize({ width: 850, height: 720 });
  await login(page);
  await page.getByRole('button', { name: '频道操作' }).click();
  await page.getByRole('menuitem', { name: '频道详情' }).click();

  const panel = page.getByRole('complementary', { name: /频道治理/ });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('tab', { name: '成员', exact: true })).toHaveAttribute('aria-selected', 'true');
  const assertPanelInsideViewport = async () => {
    const geometry = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const form = element.querySelector('.side-panel-scroll > div:not([hidden]) .governance-form, .side-panel-scroll > .governance-form')?.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        panel: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        form: form ? { left: form.left, right: form.right } : null,
      };
    });

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.panel.left).toBeGreaterThanOrEqual(0);
    expect(geometry.panel.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.panel.top).toBeGreaterThanOrEqual(0);
    expect(geometry.panel.bottom).toBeLessThanOrEqual(720);
    expect(geometry.form).not.toBeNull();
    expect(geometry.form.left).toBeGreaterThanOrEqual(geometry.panel.left);
    expect(geometry.form.right).toBeLessThanOrEqual(geometry.panel.right);
  };

  await assertPanelInsideViewport();
  await page.setViewportSize({ width: 600, height: 720 });
  await assertPanelInsideViewport();

  const principal = panel.getByRole('combobox', { name: '选择参与者' });
  const submit = panel.getByRole('button', { name: '添加到频道' });
  await expect(principal).toBeVisible();
  const submitTopBefore = (await submit.boundingBox()).y;
  const controlGeometry = await principal.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const panelRect = element.closest('.side-panel').getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      panelLeft: panelRect.left,
      panelRight: panelRect.right,
      panelTop: panelRect.top,
      panelBottom: panelRect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(controlGeometry.left).toBeGreaterThanOrEqual(controlGeometry.panelLeft);
  expect(controlGeometry.right).toBeLessThanOrEqual(controlGeometry.panelRight);
  expect(controlGeometry.right).toBeLessThanOrEqual(controlGeometry.viewportWidth);
  expect(controlGeometry.top).toBeGreaterThanOrEqual(controlGeometry.panelTop);
  expect(controlGeometry.bottom).toBeLessThanOrEqual(controlGeometry.panelBottom);
  expect(controlGeometry.bottom).toBeLessThanOrEqual(controlGeometry.viewportHeight);

  await principal.click();
  const menu = panel.getByRole('listbox', { name: '选择参与者选项' });
  await expect(menu).toBeVisible();
  const menuGeometry = await menu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const panelRect = element.closest('.side-panel').getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      panelLeft: panelRect.left,
      panelRight: panelRect.right,
      panelTop: panelRect.top,
      panelBottom: panelRect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(menuGeometry.left).toBeGreaterThanOrEqual(menuGeometry.panelLeft);
  expect(menuGeometry.right).toBeLessThanOrEqual(menuGeometry.panelRight);
  expect(menuGeometry.right).toBeLessThanOrEqual(menuGeometry.viewportWidth);
  expect(menuGeometry.top).toBeGreaterThanOrEqual(menuGeometry.panelTop);
  expect(menuGeometry.bottom).toBeLessThanOrEqual(menuGeometry.panelBottom);
  expect(menuGeometry.bottom).toBeLessThanOrEqual(menuGeometry.viewportHeight);
  expect((await submit.boundingBox()).y).toBe(submitTopBefore);
  await expect(submit).toBeVisible();
});
