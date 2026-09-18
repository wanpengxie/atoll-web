import { expect, test } from '@playwright/test';

// 手动挡：点一下就要能用。2026-09-18 交付过一次"已修"，用户实际点下去面板仍打不开
// （第一次点击只取数），所以这条用真实 Chromium 按下去验收，不靠 jsdom。
test('手动挡下点一次模型选择器：只取数一次，数据到达后面板自己展开', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  await page.goto('/tests/browser/fixtures/model-selector-manual.html');

  const trigger = page.getByRole('button', { name: 'Claude，点击读取可用模型' });
  await expect(trigger).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(0);

  await trigger.click();

  // 一次点击只发起一轮取数。
  await expect(page.getByTestId('probe-count')).toHaveText('1');

  // 数据回来后面板必须自己打开，用户不需要点第二次。
  await expect(page.getByRole('menu')).toBeVisible({ timeout: 4000 });
  await expect(page.getByTestId('probe-count')).toHaveText('1');

  // 面板里确实能选：模型项可见。
  await expect(page.getByRole('menuitem', { name: /模型/ })).toBeVisible();

  // 渲染期 setState 会被 React 报成 console.error，并吞掉交互——不允许出现。
  const bad = consoleErrors.filter((line) => /Cannot update a component/.test(line));
  expect(bad, `React 渲染期 setState：${bad.join(' | ')}`).toHaveLength(0);
});
