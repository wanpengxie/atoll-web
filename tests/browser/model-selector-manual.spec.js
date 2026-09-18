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

// 2026-09-18 "又不能切换了"：面板已开，再点一次触发手动刷新，刷新那一瞬旧证据被
// 清空、view 变 null，随后同一 actor 的新值域回来。旧实现把这当成"换目标"把面板关了。
test('面板已开时手动刷新：值域短暂缺席也不关面板，回来后仍可选', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/model-selector-manual.html?blank=1');
  const trigger = page.getByRole('button', { name: 'Claude，点击读取可用模型' });
  await trigger.click();
  await expect(page.getByRole('menu')).toBeVisible({ timeout: 4000 });

  // 收起再展开 = 第二次 onOpen = 手动刷新；夹具会先把 view 清空 80ms。
  const openTrigger = page.getByRole('button', { name: /^Claude，模型未知/ });
  await openTrigger.click();            // 收起
  await expect(page.getByRole('menu')).toHaveCount(0);
  await openTrigger.click();            // 展开 + 刷新
  await expect(page.getByTestId('probe-count')).toHaveText('2');
  // 关键断言：整个刷新期间面板都在，包括 view 为 null 的那 80ms。
  await expect(page.getByRole('menu')).toBeVisible();
  await page.waitForTimeout(150);
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /模型/ })).toBeVisible();
});
