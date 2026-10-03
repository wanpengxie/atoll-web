import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// Actor 描述是不可变的 名字@版本：同名再建就是下一个版本，退役只让它不能再被新
// 成员引用。频道设置里读频道状态、改说明与服务、挂卸设备（设备不再在空间管理里挂）。

async function reset(request, scenario, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed } });
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

async function mockState(request) {
  const response = await request.get(`${MOCK}/mock/control/state`);
  expect(response.ok()).toBe(true);
  return response.json();
}

function captureSubmits(page) {
  const submits = [];
  page.on('websocket', (socket) => socket.on('framesent', (event) => {
    try {
      const frame = JSON.parse(String(event.payload));
      if (frame?.frame_type === 'submit' && frame.payload?.msg_type) submits.push(frame.payload);
    } catch { /* not a protocol frame */ }
  }));
  return submits;
}

async function openChannelPanel(page, tab) {
  await page.getByRole('button', { name: '频道操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '频道详情', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '频道治理' });
  await expect(panel).toBeVisible();
  await panel.getByRole('tab', { name: tab, exact: true }).click();
  return panel;
}

test('Actor 描述新建与版本: a new one gets an id; a new version names that id; retiring @1 shows it retired', async ({ page, request }) => {
  const submits = captureSubmits(page);
  await reset(request, 'space-administration', 4101);
  await login(page);
  await page.getByRole('button', { name: '空间管理', exact: true }).click();
  const space = page.getByRole('complementary', { name: '空间管理' });
  await expect(space.getByRole('tab', { name: 'Actor 描述', exact: true })).toHaveAttribute('aria-selected', 'true');
  // 场景自带的四个描述都在目录里。
  for (const name of ['steward', 'claude', 'analyst', 'search']) {
    await expect(space.getByRole('region', { name: `Actor 描述 ${name}`, exact: true })).toBeVisible();
  }

  await space.getByLabel('Actor 描述名字').fill('research-claude');
  await space.getByLabel('Actor 描述 Class').fill('claude');
  await space.getByLabel('Actor 描述说明').fill('研究助手');
  await space.getByLabel('Actor 描述参数 JSON').fill('{"model":"claude-opus","api_key":"$required:研究服务的 key"}');
  await space.getByRole('button', { name: '新建', exact: true }).click();
  await expect(space.getByText('Actor 描述已新建。')).toBeVisible();
  const group = space.getByRole('region', { name: 'Actor 描述 research-claude', exact: true });
  await expect(group).toContainText('1 个版本');
  const id = await group.getAttribute('data-description-id');
  expect(id).toBeTruthy();
  await expect(group.locator(`[data-ref="${id}@1"]`)).toContainText('class claude · 可用');
  await expect(group.locator(`[data-ref="${id}@1"]`)).toContainText('研究助手');

  // 给这条描述出新版本：带它的 id；已有版本不变，多出下一个版本。
  await space.getByRole('combobox', { name: '新建还是出新版本' }).click();
  await space.getByRole('option', { name: 'research-claude 的新版本（现为 @1）' }).click();
  await expect(space.getByText('将建成 research-claude @2')).toBeVisible();
  await space.getByLabel('Actor 描述参数 JSON').fill('{"model":"claude-sonnet"}');
  await space.getByRole('button', { name: '出新版本', exact: true }).click();
  await expect(group).toContainText('2 个版本');
  // 新版本排在前面。
  await expect(group.locator('[data-ref]')).toHaveCount(2);
  expect(await group.locator('[data-ref]').evaluateAll((rows) => rows.map((row) => row.dataset.ref))).toEqual([`${id}@2`, `${id}@1`]);

  const creates = submits.filter((payload) => payload.msg_type === 'system.actor.description.create');
  expect(creates.map((payload) => payload.payload)).toEqual([
    { name: 'research-claude', class: 'claude', params: { model: 'claude-opus', api_key: '$required:研究服务的 key' }, description: '研究助手' },
    { id, name: 'research-claude', class: 'claude', params: { model: 'claude-sonnet' }, description: '研究助手' },
  ]);

  // 退役 @1：它显示已退役、不能再退役；@2 照旧可用。
  const first = group.locator(`[data-ref="${id}@1"]`);
  await first.getByRole('button', { name: '退役', exact: true }).click();
  await expect(space.getByRole('heading', { name: '退役 research-claude @1？' })).toBeVisible();
  await space.getByRole('button', { name: '确认操作', exact: true }).click();
  await expect(space.getByText('research-claude @1 已退役。')).toBeVisible();
  await expect(first).toContainText('已退役');
  await expect(first).toHaveClass(/status-retired/);
  await expect(first.getByRole('button', { name: '退役' })).toHaveCount(0);
  await expect(group.locator(`[data-ref="${id}@2"]`)).toContainText('可用');
  expect(submits.find((payload) => payload.msg_type === 'system.actor.description.retire')?.payload).toEqual({ id, version: 1 });

  const state = await mockState(request);
  expect(state.actor_descriptions.filter((row) => row.id === id).map((row) => [row.ref, row.status])).toEqual([
    [`${id}@1`, 'retired'],
    [`${id}@2`, 'present'],
  ]);

  // 加成员时每条描述只能挑最新的、没退役的版本。
  await space.getByRole('button', { name: '关闭空间管理' }).click();
  await page.getByRole('button', { name: /c0\.project/ }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  const panel = await openChannelPanel(page, '成员');
  await panel.getByRole('combobox', { name: '选择参与者' }).click();
  const options = panel.getByRole('listbox', { name: '选择参与者选项' });
  await expect(options.getByRole('option', { name: /^research-claude @2 · Actor 描述（class claude）/ })).toHaveCount(1);
  await expect(options.getByRole('option', { name: /research-claude @1/ })).toHaveCount(0);
});

test('频道设置: status is read on demand, description and serving are saved, devices attach here', async ({ page, request }) => {
  const submits = captureSubmits(page);
  await reset(request, 'device-governance', 4102);
  await login(page);

  // 空间管理的设备页只建、退役设备；挂载在频道设置里做。
  await page.getByRole('button', { name: '空间管理', exact: true }).click();
  const space = page.getByRole('complementary', { name: '空间管理' });
  await space.getByRole('tab', { name: '设备', exact: true }).click();
  await space.getByLabel('设备名称').fill('gpu-box');
  await space.getByRole('button', { name: '创建设备', exact: true }).click();
  await expect(space.getByText('设备已创建。')).toBeVisible();
  await expect(space.locator('.device-row').filter({ hasText: 'gpu-box' })).toBeVisible();
  await expect(space.getByRole('button', { name: /挂到/ })).toHaveCount(0);
  await space.getByRole('button', { name: '关闭空间管理' }).click();

  await page.getByRole('button', { name: /c0\.project/ }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  const panel = await openChannelPanel(page, '设置');
  // 打开面板不发请求；点「读取」发一条 system.channel.get。
  await expect(panel.getByText(/按需读取：点「读取」发一条 system.channel.get/)).toBeVisible();
  expect(submits.filter((payload) => payload.msg_type === 'system.channel.get')).toHaveLength(0);
  await panel.getByRole('button', { name: '读取', exact: true }).click();
  const facts = panel.locator('.channel-description-facts');
  await expect(facts).toContainText('第 1 版');
  // 频道状态只有注册库里的事实：没有健康、没有频道自身和成员的构建。
  const runtime = panel.locator('.channel-runtime');
  await expect(runtime).not.toContainText('健康');
  await expect(runtime).not.toContainText('频道自身');
  await expect(runtime.locator('.build-line')).toHaveCount(0);
  await expect(panel.getByLabel('成员构建摘要')).toHaveCount(0);
  expect(submits.filter((payload) => payload.msg_type === 'system.channel.get').map((payload) => payload.payload)).toEqual([{ channel_id: 'c0.project' }]);

  // 说明与服务：写进频道描述（channel.set），描述版本加一。
  await panel.getByLabel('频道说明').fill('项目协作');
  await panel.getByLabel('对外服务').check();
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await expect(facts).toContainText('第 2 版');
  await expect(facts).toContainText('项目协作');
  expect(submits.find((payload) => payload.msg_type === 'system.channel.set')?.payload).toEqual({ channel_id: 'c0.project', description: '项目协作', serving: 1 });

  // 设备：local-device 恒在、不用挂；别的设备挂到本频道写进描述的 devices。
  const devices = panel.locator('.channel-devices');
  await expect(devices).toContainText('local-device');
  const gpu = devices.locator('.device-row').filter({ hasText: 'gpu-box' });
  await expect(gpu).toContainText('未挂载');
  await gpu.getByRole('button', { name: '挂到本频道', exact: true }).click();
  // 写进描述后，要等本频道的设备投影（OBS）再读到它才算"已挂载"；前端不自己去探。
  await expect(gpu).toContainText(/已写入描述|已挂载/);
  await expect(gpu.getByRole('button', { name: '卸载', exact: true })).toBeVisible();
  await expect(facts).toContainText('第 3 版');
  const attach = submits.find((payload) => payload.msg_type === 'system.device.attach');
  expect(attach?.payload).toEqual({ channel_id: 'c0.project', device_id: expect.stringMatching(/^device-/) });
  let state = await mockState(request);
  expect(state.descriptions['c0.project'].body.devices).toEqual([attach.payload.device_id]);

  await gpu.getByRole('button', { name: '卸载', exact: true }).click();
  await expect(gpu).toContainText('未挂载');
  expect(submits.find((payload) => payload.msg_type === 'system.device.detach')?.payload).toEqual({ channel_id: 'c0.project', device_id: attach.payload.device_id });
  state = await mockState(request);
  expect(state.descriptions['c0.project'].body.devices).toBeUndefined();
});

test('频道设置 on c0: its description is read-only and offers no form to change it', async ({ page, request }) => {
  await reset(request, 'channel-governance', 4103);
  await login(page);
  const panel = await openChannelPanel(page, '设置');
  await panel.getByRole('button', { name: '读取', exact: true }).click();
  await expect(panel.getByText('这份描述是只读的（内核写的）：能读、能复制成新频道的描述，不能改。')).toBeVisible();
  await expect(panel.locator('.channel-runtime .build-line')).toHaveCount(0);
  // 只读，就没有说明与服务、设备两块。
  await expect(panel.getByRole('heading', { name: '说明与服务' })).toHaveCount(0);
  await expect(panel.locator('.channel-devices')).toHaveCount(0);
});
