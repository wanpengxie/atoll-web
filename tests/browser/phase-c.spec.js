import { expect, test } from '@playwright/test';

const MOCK = 'http://127.0.0.1:8832';

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
  await page.getByLabel('邮箱').fill('root@atoll.local');
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

async function openSteward(page) {
  if (!await page.locator('.roster-panel').count()) {
    await page.getByRole('button', { name: '成员', exact: true }).click();
    await page.getByRole('complementary', { name: /频道管理/ }).getByRole('button', { name: '查看 steward' }).click();
  }
  const details = page.getByRole('region', { name: 'Actor 详情 steward' });
  await expect(details).toBeVisible();
  await expect(details.getByText(/^\d+ 项能力$/)).toBeVisible();
  return details;
}

function capability(details, type) {
  return details.locator('.capability-row').filter({ hasText: type });
}

async function sendTask(page, text) {
  const contextClose = page.getByRole('button', { name: '关闭上下文' });
  if (await contextClose.isVisible().catch(() => false)) await contextClose.click();
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
  const restored = await openSteward(page);
  await expect(restored.getByText(/^\d+ 项能力$/)).toBeVisible();
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

  const turn = page.locator('.turn-card').filter({ hasText: 'mock.order.create' }).last();
  const result = turn.locator('.structured-result').last();
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
  await expect(controls.getByRole('button', { name: '停止' })).toBeVisible();
  await expect(controls.getByRole('button', { name: '取消任务' })).toHaveCount(0);
  await controls.getByRole('button', { name: '停止' }).click();
  await expect(turn.getByText('✗ 已停止 · 发消息即继续', { exact: true })).toBeVisible();
  await expect(turn.getByRole('region', { name: '任务控制' })).toHaveCount(0);
});

test('C-BR-04 interrupt 冻结只在 Agent 气泡呈现，恒无继续按钮', async ({ page, request }) => {
  await reset(request, 'long-running', 104);
  await login(page);
  const turn = await sendTask(page, '阶段C停止并冻结');
  await page.getByLabel('消息').fill('等待中的后续任务');
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.getByRole('region', { name: '等待区' })).toContainText('等待中的后续任务');
  await turn.getByRole('button', { name: '停止' }).click();
  await expect(page.getByRole('region', { name: '等待区' })).not.toContainText('已暂停');
  await expect(page.getByRole('button', { name: '继续' })).toHaveCount(0);
  await page.getByLabel('消息').fill('直接发消息恢复');
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.getByRole('region', { name: '等待区' })).not.toContainText('已暂停');
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
  await waiting.getByRole('button', { name: '插入' }).click();
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
  await original.getByRole('button', { name: '停止' }).click();
  await expect(original).toContainText('✗ 已停止 · 发消息即继续');
  await expect(waiting).not.toContainText('已暂停');
  await expect(page.getByRole('button', { name: '继续' })).toHaveCount(0);
});

test('C-BR-07/09/10 生命周期高风险控制只能从 Actor 详情确认后提交', async ({ page, request }) => {
  await reset(request, 'actor-lifecycle', 108);
  await login(page);
  const details = await openSteward(page);

  await capability(details, 'agent.restart').getByRole('button', { name: '调用' }).click();
  let form = details.getByRole('region', { name: '重启 Agent 运行时 参数' });
  await expect(form.getByRole('button', { name: '提交操作' })).toBeDisabled();
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: '提交操作' }).click();
  await expect(page.locator('.turn-card[data-request-type="agent.restart"]').getByText('restarted', { exact: true })).toBeVisible();

  await capability(details, 'agent.terminate').getByRole('button', { name: '调用' }).click();
  form = details.getByRole('region', { name: '终止 Agent 运行时 参数' });
  const submit = form.getByRole('button', { name: '提交操作' });
  await form.getByRole('textbox').fill('wrong-id');
  await expect(submit).toBeDisabled();
  await form.getByRole('textbox').fill('steward');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.locator('.turn-card[data-request-type="agent.terminate"]').getByText('terminated', { exact: true })).toBeVisible();
});

test('C-BR-08/11 Schema 审批携带结构化 payload 并由终态恢复处理者', async ({ page, request }) => {
  await reset(request, 'approval-schema', 109);
  await login(page);
  const approval = page.locator('.approval-card').first();
  await expect(approval.getByText(/影响：/)).toBeVisible();
  await approval.getByRole('textbox', { name: /note/ }).fill('同意按灰度方案执行');
  await approval.getByRole('combobox', { name: /severity/ }).click();
  await approval.getByRole('option', { name: 'high' }).click();
  await approval.getByRole('checkbox', { name: /notify/ }).check();
  await approval.getByRole('button', { name: '批准' }).click();
  await expect(approval.getByText(/处理者：root.*approved/)).toBeVisible();
  await expect(approval.getByText('同意按灰度方案执行', { exact: true })).toBeVisible();
  await expect(approval.locator('.structured-result dd').filter({ hasText: /^high$/ })).toBeVisible();
  await page.reload();
  await expect(page.locator('.approval-card').first().getByText(/处理者：root.*approved/)).toBeVisible();
});

test('C-BR-09/12 过期、并发错误和外部处理均保留审批事实', async ({ page, request }) => {
  await reset(request, 'approval-expired', 110);
  await login(page);
  let approval = page.locator('.approval-card').first();
  await expect(approval.getByText('已过期，不能再处理', { exact: true })).toBeVisible();
  await expect(approval.getByRole('button', { name: '批准' })).toBeDisabled();

  await switchScenario(page, request, 'approval-conflict', 111);
  approval = page.locator('.approval-card').first();
  await approval.getByRole('textbox', { name: /note/ }).fill('冲突验收');
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
  await action(request, { type: 'resolve_approval', decision: 'rejected', actor_id: 'external-reviewer' });
  await expect(approval.getByText(/处理者：external-reviewer.*rejected/)).toBeVisible();
  await expect(approval.getByText('已回执', { exact: true })).toBeVisible();
});

test('C-BR-10/13 刷新重放后处理气泡与控制资格只保留一份', async ({ page, request }) => {
  await reset(request, 'long-running', 112);
  await login(page);
  await openSteward(page);
  const taskText = '阶段C刷新恢复长任务';
  let turn = await sendTask(page, taskText);
  await expect(turn.getByRole('button', { name: '停止' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  turn = page.locator('.turn-card').filter({ hasText: taskText });
  await expect(turn).toHaveCount(1);
  await expect(turn.locator('.agent-turn-bubble')).toHaveCount(1);
  await expect(turn.locator('.agent-turn-bubble button')).toHaveCount(0);
  await expect(turn.getByRole('button', { name: '停止' })).toBeVisible();
  await expect(turn.getByRole('button', { name: '编辑' })).toBeVisible();
});
