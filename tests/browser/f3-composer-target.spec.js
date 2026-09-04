import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request, scenario = 'multi-channel', seed = 81) {
  expect((await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed } })).ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号' }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.getByRole('navigation', { name: '频道' })).toBeVisible();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
}

const banner = (page) => page.getByRole('status', { name: '收件人' });

// 这条测的是"发错人"这一类错误本身，不是某个像素：横幅恒常显、恒说清凭什么是他，
// 而过滤条一旦收窄到一个 agent，默认收件人就跟着走——屏幕上只剩「我和他」的时候，
// 回车发给别人是这个界面最容易犯也最难自己发现的错。
test('F3-CT-01 收件人横幅常显在输入框外，并报出判据来源', async ({ page, request }) => {
  await reset(request); await login(page);
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toHaveClass(/is-direct/);
  await expect(banner(page)).toContainText('@');
  // 屏幕上恒只有一个名字：理由和名单挂 title，恒不摊进正文。
  await expect(banner(page).locator('.composer-target-pill')).toHaveCount(1);
  await expect(banner(page)).toHaveAttribute('title', /·/);
  // "在框外"和"不占一行"是几何事实，恒不是 DOM 位置：判它挂在哪个节点下面，会在
  // 改成贴边浮层时误报，而人看到的东西一点没变。所以量三件——
  //   ① 下边落在输入框上边沿之上（渲染在框外，恒不挤进编辑区）
  //   ② 它恒不给 composer 加高（加高就是在输入框上面多堆一行，等候区被顶起来）
  //   ③ 左边跟输入框对齐，恒不飘到轨道外面
  const box = await page.evaluate(() => {
    const wrap = document.querySelector('.composer-wrap').getBoundingClientRect();
    const surface = document.querySelector('.composer-surface').getBoundingClientRect();
    const pill = document.querySelector('.composer-target-pill').getBoundingClientRect();
    return { wrapTop: wrap.top, surfaceTop: surface.top, surfaceLeft: surface.left, pillBottom: pill.bottom, pillLeft: pill.left, pillHeight: pill.height };
  });
  expect(box.pillHeight).toBeGreaterThan(0);
  expect(box.pillBottom).toBeLessThanOrEqual(box.surfaceTop + 2);
  expect(box.surfaceTop - box.wrapTop).toBeLessThanOrEqual(12);
  expect(box.pillLeft).toBeGreaterThanOrEqual(box.surfaceLeft);
  expect(box.pillLeft - box.surfaceLeft).toBeLessThanOrEqual(24);
});

test('F3-CT-02 过滤条收窄到一个 agent 时，默认收件人跟着它走', async ({ page, request }) => {
  await reset(request); await login(page);
  const chips = page.getByRole('group', { name: '按成员过滤' }).getByRole('button');
  await expect(chips).toHaveCount(2);
  const before = await banner(page).innerText();

  const picked = (await chips.nth(1).innerText()).trim();
  await chips.nth(1).click();
  await expect(banner(page)).toHaveText(`@${picked}`);
  await expect(banner(page)).toHaveAttribute('title', /跟随筛选/);
  expect(await banner(page).innerText()).not.toBe(before);

  // 取消筛选 → 判据链回到筛选之前那一环，恒不把筛选的选择黏住。
  await chips.nth(1).click();
  await expect(banner(page)).not.toHaveAttribute('title', /跟随筛选/);
});

test('F3-CT-03 编辑框里的 @ 压过筛选', async ({ page, request }) => {
  await reset(request); await login(page);
  const chips = page.getByRole('group', { name: '按成员过滤' }).getByRole('button');
  await chips.nth(1).click();
  await expect(banner(page)).toHaveAttribute('title', /跟随筛选/);

  await page.getByLabel('消息').click();
  await page.keyboard.type('@');
  const option = page.getByRole('listbox').getByRole('option').first();
  const mentioned = (await option.locator('strong').innerText()).trim();
  await option.click();
  await expect(banner(page)).toHaveText(`@${mentioned}`);
  await expect(banner(page)).toHaveAttribute('title', /由 @ 指定/);
  // 名字仍恒只有一个：@ 生效后横幅换的是名字，恒不多长出一格。
  await expect(banner(page).locator('.composer-target-pill')).toHaveCount(1);
});

test('F3-CT-04 无收件人是警告格，不是留白；且横幅恒不整块进出', async ({ page, request }) => {
  await reset(request); await login(page);
  await page.getByRole('navigation', { name: '频道' }).getByText('c0.public', { exact: true }).click();
  await expect(page.locator('.composer-disabled-reason')).toBeVisible();
  // 横幅恒在：它一进一出就是一次 --composer-overlay-height 变化，整条时间线会跟着
  // 跳，而"没收件人"恰是它最该在场的时刻。发不出去时只压暗、并收掉那句在这一格
  // 帮不上忙的指令（"@ 一位成员"救不了未入群），真正的原因由 disabled 文案说。
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toHaveClass(/is-none/);
  await expect(banner(page)).toHaveClass(/is-muted/);
  await expect(banner(page)).toHaveText('⚠ 无收件人');
  // 那句"@ 一位成员"在未入群的频道里帮不上忙，只留在 title 里，恒不占正文。
  await expect(banner(page)).toHaveAttribute('title', /@ 一位成员/);
});
