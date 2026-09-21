import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'space-administration', seed },
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

async function openChannelDetails(page) {
  await page.getByRole('button', { name: '频道操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '频道详情', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '频道治理' });
  await expect(panel).toBeVisible();
  return panel;
}

for (const viewport of [
  { name: 'desktop', width: 1280, height: 720, seed: 15021 },
  { name: 'mobile', width: 320, height: 720, seed: 15022 },
]) {
  test(`TC-1502 ${viewport.name} channel details is one Context history entry`, async ({ page, request }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await reset(request, viewport.seed);
    await login(page);

    const ordinaryLength = await page.evaluate(() => history.length);
    await page.getByRole('tab', { name: '任务', exact: true }).click();
    await expect(page).toHaveURL(/channels\/c0\/tasks$/);
    expect(await page.evaluate(() => history.length)).toBe(ordinaryLength);

    const contextLength = await page.evaluate(() => history.length);
    const panel = await openChannelDetails(page);
    await expect(page).toHaveURL(/channels\/c0\/tasks\?focus=channel%3Ac0$/);
    expect(await page.evaluate(() => history.length)).toBe(contextLength + 1);
    expect(await page.evaluate(() => history.state.atollContextEntry)).toBe(true);

    await page.goBack();
    await expect(page).toHaveURL(/channels\/c0\/tasks$/);
    await expect(panel).toHaveCount(0);
    expect(await page.evaluate(() => history.state.atollContextEntry)).toBe(false);

    await page.goForward();
    await expect(page).toHaveURL(/channels\/c0\/tasks\?focus=channel%3Ac0$/);
    await expect(page.getByRole('complementary', { name: '频道治理' })).toBeVisible();

    await page.getByRole('button', { name: '关闭频道详情' }).click();
    await expect(page.getByRole('button', { name: '频道操作', exact: true })).toBeFocused();
    await expect(page).toHaveURL(/channels\/c0\/tasks$/);
  });
}
