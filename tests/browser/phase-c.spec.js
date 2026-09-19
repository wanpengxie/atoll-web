import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';


async function reset(request, scenario, seed = 101) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function action(request, data) {
  const response = await request.post(`${MOCK}/mock/control/action`, { data });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function fault(request, target, code, mode = 'reject') {
  const response = await request.post(`${MOCK}/mock/control/fault`, { data: { target, mode, code, count: 1 } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号' }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  await expect(page.locator('main h1')).toHaveText('c0');
}

async function clearProductCache(page) {
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key !== 'atoll.principal') localStorage.removeItem(key);
    }
  });
}

async function switchScenario(page, request, scenario, seed = 101) {
  await reset(request, scenario, seed);
  await clearProductCache(page);
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  await expect(page.locator('main h1')).toHaveText('c0');
}

async function openStewardPanel(page) {
  const host = page.locator('.context-host');
  let restoredContext = false;
  try {
    await host.waitFor({ state: 'attached', timeout: 750 });
    restoredContext = true;
  } catch { /* no route-restored context: open it through the header */ }
  if (restoredContext) {
    await expect(host.locator('.roster-panel')).toBeVisible();
  } else {
    await page.getByRole('button', { name: '成员', exact: true }).click();
    await page.getByRole('complementary', { name: /频道管理/ }).getByRole('button', { name: '查看 steward' }).click();
  }
  const details = page.getByRole('region', { name: 'Actor 详情 steward' });
  await expect(details).toBeVisible();
  return details;
}

async function readStewardCapabilities(details) {
  const read = details.getByRole('button', { name: '读取能力' });
  if (await read.isVisible().catch(() => false)) await read.click();
  await expect(details.getByText(/^\d+ 项能力$/)).toBeVisible();
}

async function openSteward(page) {
  const details = await openStewardPanel(page);
  // Clicking the roster row is itself the explicit human action that authorizes
  // the live Describe. Do not race that in-flight probe with a second click.
  await expect(details.getByText(/^\d+ 项能力$/)).toBeVisible();
  return details;
}

function capability(details, type) {
  return details.locator('.capability-row').filter({ hasText: type });
}

async function closeContextAndRevealLatest(page) {
  const host = page.locator('.context-host');
  const close = page.getByRole('button', { name: '关闭上下文' });
  for (let depth = 0; depth < 4 && await close.isVisible().catch(() => false); depth += 1) {
    await close.click();
    await page.waitForTimeout(50);
  }
  await expect(host).toHaveCount(0);
  const latest = page.getByRole('button', { name: /条新动态/ });
  if (await latest.isVisible().catch(() => false)) await latest.click();
}

async function sendTask(page, text) {
  const contextClose = page.getByRole('button', { name: '关闭上下文' });
  for (let depth = 0; depth < 4 && await contextClose.isVisible().catch(() => false); depth += 1) {
    await contextClose.click();
    await page.waitForTimeout(50);
  }
  await expect(contextClose).toBeHidden();
  const chooseAgent = page.getByRole('button', { name: '选择 Agent' });
  if (await chooseAgent.isVisible().catch(() => false)) {
    await chooseAgent.click();
    await page.getByRole('menu', { name: '选择目标 Agent' }).getByRole('menuitem', { name: 'steward' }).click();
  }
  await page.getByLabel('消息').fill(text);
  await page.getByRole('button', { name: /发送/ }).click();
  const turn = page.locator('.turn-card').filter({ hasText: text });
  await expect(turn).toHaveCount(1);
  return turn;
}

test('C-BR-01/02 Actor Describe 从账本加载并展示能力元数据', async ({ page, request }) => {
  await reset(request, 'actor-capability');
  await login(page);
  const details = await openSteward(page);
  await expect(details.getByText('Mock collaboration agent', { exact: true })).toBeVisible();
  const textCapability = capability(details, 'agent.ask');
  await expect(textCapability.getByText('执行普通文本任务', { exact: true })).toBeVisible();
  await textCapability.getByText('可能的错误', { exact: true }).click();
  await expect(textCapability.getByText('provider_timeout', { exact: true })).toBeVisible();
  await expect(capability(details, 'mock.order.create').getByText('创建一个 Mock 订单', { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  const restored = await openStewardPanel(page);
  // Describe 是当前连接的活能力，不从历史账本恢复。刷新后先明确显示未知，
  // 再由真人点击重新读取；禁止把 route restoration 变回自动探测入口。
  await expect(restored.getByText('能力未知', { exact: true })).toBeVisible();
  await expect(restored.getByRole('button', { name: '读取能力' })).toBeVisible();
  await readStewardCapabilities(restored);
});

test('C-BR-02/03/04 Schema 表单跨 OBS 刷新保留输入并原样调用', async ({ page, request }) => {
  await reset(request, 'actor-capability', 102);
  await login(page);
  const details = await openSteward(page);
  await capability(details, 'mock.order.create').getByRole('button', { name: '调用' }).click();
  const form = details.getByRole('region', { name: 'mock.order.create 参数' });
  await form.getByRole('textbox', { name: /name/ }).fill('阶段C结构化订单');
  await form.getByRole('spinbutton', { name: /count/ }).fill('7');
  await page.getByRole('button', { name: '刷新名册' }).click();
  await expect(form.getByRole('textbox', { name: /name/ })).toHaveValue('阶段C结构化订单');
  await expect(form.getByRole('spinbutton', { name: /count/ })).toHaveValue('7');
  await form.getByRole('combobox', { name: /priority/ }).click();
  await form.getByRole('option', { name: 'urgent' }).click();
  await form.getByRole('checkbox', { name: /notify/ }).check();
  await form.getByRole('button', { name: '提交操作' }).click();
  await closeContextAndRevealLatest(page);

  const turn = page.locator('.turn-card').filter({ hasText: 'mock.order.create' }).last();
  const result = turn.locator('.structured-result').last();
  await result.locator('summary').click();
  await expect(result.getByText('name', { exact: true })).toBeVisible();
  await expect(result.getByText('阶段C结构化订单', { exact: true })).toBeVisible();
  await expect(result.getByText('count', { exact: true })).toBeVisible();
  await expect(result.getByText('7', { exact: true })).toBeVisible();
  await expect(turn.getByText('order_id', { exact: true })).toBeVisible();
  await expect(turn.getByText('是', { exact: true }).first()).toBeVisible();
});

test('C-BR-03/05 处理中只暴露编辑与停止，停止后按钮随 turn 消失', async ({ page, request }) => {
  await reset(request, 'long-running', 103);
  await login(page);
  await openSteward(page);
  const turn = await sendTask(page, '阶段C取消长任务');
  const controls = turn.getByRole('region', { name: '任务控制' });
  await expect(controls.getByRole('button', { name: '编辑' })).toBeVisible();
  await expect(controls.getByRole('button', { name: '停止', exact: true })).toBeVisible();
  await expect(controls.getByRole('button', { name: '取消任务' })).toHaveCount(0);
  await controls.getByRole('button', { name: '停止', exact: true }).click();
  await expect(turn.getByText('✗ 已停止 · 发消息即继续', { exact: true })).toBeVisible();
  await expect(turn.getByRole('region', { name: '任务控制' })).toHaveCount(0);
});

test('C-BR-03a processing edit 保持 Reading DOM，并完整交接焦点与普通草稿', async ({ page, request }) => {
  await reset(request, 'long-running', 139);
  await login(page);
  await openSteward(page);
  const taskText = 'processing edit keeps its reading adapter';
  const turn = await sendTask(page, taskText);
  const editor = page.getByLabel('消息');
  const normalDraft = 'ordinary draft survives processing edit';
  await editor.fill(normalDraft);
  const following = page.locator('[data-reading-container="following-tail"]');
  await expect(following).toHaveCount(1);
  await following.evaluate((node) => { node.dataset.processingEditProbe = 'same'; });

  await turn.getByRole('button', { name: '编辑' }).click();

  await expect(page.getByRole('button', { name: '取消编辑' })).toBeVisible();
  await expect(editor).toContainText(taskText);
  await expect(editor).toBeFocused();
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'following');
  await expect(page.locator('[data-processing-edit-probe="same"]')).toHaveCount(1);
  await editor.fill('replacement text remains an edit-only draft');

  await page.getByRole('button', { name: '取消编辑' }).click();

  await expect(page.getByRole('button', { name: '取消编辑' })).toHaveCount(0);
  await expect(editor).toContainText(normalDraft);
  await expect(editor).toBeFocused();
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'following');
  await expect(page.locator('[data-processing-edit-probe="same"]')).toHaveCount(1);
});

test('C-BR-04 interrupt 冻结只在 Agent 气泡呈现，恒无继续按钮', async ({ page, request }) => {
  await reset(request, 'long-running', 104);
  await login(page);
  const turn = await sendTask(page, '阶段C停止并冻结');
  await page.getByLabel('消息').fill('等待中的后续任务');
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.getByRole('region', { name: '等待区' })).toContainText('等待中的后续任务');
  await turn.getByRole('button', { name: '停止', exact: true }).click();
  await expect(page.getByRole('region', { name: '等待区' })).not.toContainText('已暂停');
  await expect(page.getByRole('button', { name: '继续' })).toHaveCount(0);
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('直接发消息恢复');
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.getByRole('region', { name: '等待区' })).not.toContainText('已暂停');
});

test('C-BR-04a 编辑等待消息时停止当前任务会退出编辑，下一条消息仍可发送', async ({ page, request }) => {
  await reset(request, 'long-running', 140);
  await login(page);
  await openSteward(page);
  const running = await sendTask(page, '编辑冲突中的当前任务');
  await page.getByLabel('消息').fill('准备编辑的等待消息');
  await page.getByRole('button', { name: /发送/ }).click();
  const waiting = page.getByRole('region', { name: '等待区' });
  await expect(waiting).toContainText('准备编辑的等待消息');
  await waiting.getByRole('button', { name: '编辑' }).click();
  await expect(page.getByRole('button', { name: '取消编辑' })).toBeVisible();

  await running.getByRole('button', { name: '停止', exact: true }).click();
  await expect(running.getByText('✗ 已停止 · 发消息即继续', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '取消编辑' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('编辑已被另一项控制终止');

  await page.getByLabel('消息').fill('停止后仍能正常发送');
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.getByText('停止后仍能正常发送', { exact: true })).toBeVisible();
});

test('C-BR-05/07 等待行用 target 形插入当前 turn', async ({ page, request }) => {
  await reset(request, 'long-running', 106);
  await login(page);
  await openSteward(page);
  const original = await sendTask(page, '阶段C待调整长任务');
  await page.getByLabel('消息').fill('只输出风险清单');
  await page.getByRole('button', { name: /发送/ }).click();
  const waiting = page.getByRole('region', { name: '等待区' });
  await expect(waiting).toContainText('只输出风险清单');
  await waiting.getByRole('button', { name: '插入', exact: true }).click();
  const inserted = page.locator('.turn-card').filter({ hasText: '只输出风险清单' });
  await expect(inserted).toBeVisible();
  await expect(waiting).toHaveCount(0);
  await expect(original.getByRole('region', { name: '任务控制' })).toHaveCount(0);
});

test('C-BR-06/08 queued 恒住等待浮层，interrupt 定格 Agent 气泡', async ({ page, request }) => {
  await reset(request, 'long-running', 107);
  await login(page);
  const original = await sendTask(page, '阶段C待打断长任务');
  await page.getByLabel('消息').fill('队列中的后续任务');
  await page.getByRole('button', { name: /发送/ }).click();
  const waiting = page.getByRole('region', { name: '等待区' });
  await expect(waiting).toContainText('队列中的后续任务');
  await expect(page.locator('.timeline')).not.toContainText('队列中的后续任务');
  await original.getByRole('button', { name: '停止', exact: true }).click();
  await expect(original).toContainText('✗ 已停止 · 发消息即继续');
  await expect(waiting).not.toContainText('已暂停');
  await expect(page.getByRole('button', { name: '继续' })).toHaveCount(0);
});

test('C-BR-07/09/10 Actor 详情不伪造未公开的运行时生命周期能力', async ({ page, request }) => {
  await reset(request, 'actor-lifecycle', 108);
  await login(page);
  const details = await openSteward(page);
  await expect(capability(details, 'agent.restart')).toHaveCount(0);
  await expect(capability(details, 'agent.terminate')).toHaveCount(0);
  await expect(capability(details, 'agent.interrupt')).toHaveCount(1);
  // Member restart/removal are system.member.* operations and remain covered
  // through the channel-governance confirmation flow (D-BR-07/08/09).
});

test('C-BR-08/11 审批按公开闭集提交备注并由终态恢复处理者', async ({ page, request }) => {
  await reset(request, 'approval-schema', 109);
  await login(page);
  const approval = page.locator('.approval-card').first();
  await expect(approval.getByText(/影响：/)).toBeVisible();
  await approval.getByRole('textbox', { name: '备注（可选）' }).fill('同意按灰度方案执行');
  await approval.getByRole('button', { name: '批准' }).click();
  await expect(approval.getByText(/处理者：root.*approve/)).toBeVisible();
  await approval.locator('.structured-result-details > summary').click();
  await expect(approval.locator('dl').getByText('同意按灰度方案执行', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.approval-card').first().getByText(/处理者：root.*approve/)).toBeVisible();
});

test('C-BR-09/12 过期、并发错误和外部处理均保留审批事实', async ({ page, request }) => {
  await reset(request, 'approval-expired', 110);
  await login(page);
  let approval = page.locator('.approval-card').first();
  await expect(approval.getByText('已过期，不能再处理', { exact: true })).toBeVisible();
  await expect(approval.getByRole('button', { name: '批准' })).toBeDisabled();

  await switchScenario(page, request, 'approval-conflict', 111);
  approval = page.locator('.approval-card').first();
  await approval.getByRole('textbox', { name: '备注（可选）' }).fill('冲突验收');
  const errors = [
    ['not_in_audience', '收件人不在频道'],
    ['request_not_found', '找不到请求'],
    ['already_closed', '请求已经结束'],
    ['forbidden', '无权在此发言'],
  ];
  for (const [code, label] of errors) {
    await fault(request, 'resolve', code);
    await approval.getByRole('button', { name: '批准' }).click();
    await expect(approval.getByRole('alert')).toContainText(label);
    await expect(approval.getByRole('alert')).toContainText(code);
  }
  await action(request, { type: 'resolve_approval', decision: 'reject', actor_id: 'external-reviewer' });
  await expect(approval.getByText(/处理者：external-reviewer.*reject/)).toBeVisible();
  await expect(approval.getByText('已回执', { exact: true })).toBeVisible();
});

test('C-BR-10/13 刷新重放后处理气泡与控制资格只保留一份', async ({ page, request }) => {
  await reset(request, 'long-running', 112);
  await login(page);
  await openSteward(page);
  const taskText = '阶段C刷新恢复长任务';
  let turn = await sendTask(page, taskText);
  await expect(turn.getByRole('button', { name: '停止', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  turn = page.locator('.turn-card').filter({ hasText: taskText });
  await expect(turn).toHaveCount(1);
  await expect(turn.locator('.agent-turn-bubble')).toHaveCount(1);
  await expect(turn.locator('.agent-turn-bubble').getByRole('button', { name: '继续' })).toHaveCount(0);
  await expect(turn.getByRole('button', { name: '停止', exact: true })).toBeVisible();
  await expect(turn.getByText('Agent 版本不支持安全编辑', { exact: true })).toBeVisible();
  await expect(turn.getByRole('button', { name: '编辑' })).toHaveCount(0);

  // 当前连接尚无 Describe 时不能把历史能力当真。真人打开目标 Actor 是显式
  // 取数动作；canonical live probe 落账后，原 processing turn 才恢复安全编辑。
  const details = await openSteward(page);
  await expect(details.getByText(/^\d+ 项能力$/)).toBeVisible();
  await page.getByRole('button', { name: '关闭上下文' }).click();
  await expect(turn.getByRole('button', { name: '编辑' })).toBeVisible();
});
