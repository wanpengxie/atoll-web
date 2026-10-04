import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// 频道模板、recipe、decl_id、initial_actor_ids、default_storage_device_id 都退役了：
// 新频道从三种起点之一开始（空白、复制一个频道、从本频道挑成员），线上只发一条
// system.channel.create {name, parent, humans, description | copy_from}。这里守
// 这三种起点各自发出的线上形状，以及复制出来的频道成员条目和源频道一致。

async function reset(request, scenario = 'channel-governance', seed = 3501) {
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

function decodeSentFrame(frame) {
  try {
    const outer = typeof frame === 'string' ? JSON.parse(frame) : frame;
    return typeof outer?.payload === 'string' ? JSON.parse(outer.payload) : outer?.payload || null;
  } catch {
    return null;
  }
}

function captureSubmits(page) {
  const frames = [];
  page.on('websocket', (socket) => socket.on('framesent', (frame) => frames.push(frame)));
  return () => frames.map(decodeSentFrame)
    .filter((frame) => frame?.frame_type === 'submit' && frame.payload?.msg_type)
    .map((frame) => frame.payload);
}

const RETIRED_WORDS = /template|recipe|decl_id|declarations|initial_actor_ids|default_storage_device_id/;

async function openCreate(page) {
  await page.getByRole('button', { name: '新建频道', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '新建频道' });
  await expect(modal).toBeVisible();
  return modal;
}

async function expectReady(modal) {
  const progress = modal.getByRole('region', { name: '频道创建进度' });
  await expect(progress.getByText('已确认', { exact: true })).toHaveCount(4);
  await expect(modal.getByRole('button', { name: '进入新频道', exact: true })).toBeVisible();
}

test('blank start sends one channel.create with humans and a description, no template read', async ({ page, request }) => {
  const submits = captureSubmits(page);
  await reset(request);
  await login(page);
  const modal = await openCreate(page);

  // 打开新建框不发任何请求（没有模板列表要读）。
  await expect(modal.getByRole('radio', { name: '起点 空白', exact: true })).toBeChecked();
  await expect(modal.getByRole('combobox', { name: '频道模板' })).toHaveCount(0);
  await modal.getByLabel('新频道名称').fill('blank-room');
  await modal.getByLabel('频道用途').fill('从空白开始');
  // The node lists the lobby's guest among people; it is never offered.
  await expect(modal.getByRole('checkbox', { name: '带上用户 Bob', exact: true })).toHaveCount(1);
  await expect(modal.getByRole('checkbox', { name: '带上用户 Guest', exact: true })).toHaveCount(0);
  await modal.getByRole('checkbox', { name: '带上用户 Alice', exact: true }).check();
  await modal.getByRole('button', { name: '创建频道', exact: true }).click();
  await expectReady(modal);

  const creates = submits().filter((payload) => payload.msg_type === 'system.channel.create');
  expect(creates).toHaveLength(1);
  expect(creates[0].channel_id).toBe('c0');
  expect(creates[0].payload).toEqual({
    name: 'blank-room',
    parent: 'c0',
    humans: ['root', 'alice'],
    description: { description: '从空白开始', members: [] },
  });
  expect(submits().some((payload) => RETIRED_WORDS.test(JSON.stringify(payload)))).toBe(false);

  const state = await mockState(request);
  // 带进来的人就是新描述里的人的条目（BATCH3 §5）；每个频道都有的 svcactor 条目由 registrar 写上。
  expect(state.descriptions['c0.blank-room']).toMatchObject({ revision: 1, body: {
    members: [{ name: 'svcactor', body: { actor: 'svcactor' } }, { name: 'root', body: { human: true }, principal: 'root' }, { name: 'alice', body: { human: true }, principal: 'alice' }],
    description: '从空白开始',
  } });
  expect(state.memberships.filter((row) => row.channel_id === 'c0.blank-room' && row.status === 'active').map((row) => row.principal_id).sort())
    .toEqual(['alice', 'root']);
});

test('picking members reads this channel\'s description and copies the chosen entries only', async ({ page, request }) => {
  const submits = captureSubmits(page);
  await reset(request, 'actor-config', 3502);
  await login(page);
  await page.getByRole('button', { name: /c0\.project/ }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await page.getByRole('button', { name: '频道操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建子频道', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '新建频道' });
  await expect(modal).toBeVisible();

  await modal.getByLabel('新频道名称').fill('picked-room');
  await modal.getByRole('radio', { name: '起点 从本频道挑成员', exact: true }).check();
  // 没挑成员条目之前不能提交。
  await expect(modal.getByRole('button', { name: '创建频道', exact: true })).toBeDisabled();
  // 条目按需读：一次点击一条 system.channel.description.get。
  expect(submits().filter((payload) => payload.msg_type === 'system.channel.description.get')).toHaveLength(0);
  await modal.getByRole('button', { name: '读取 c0.project 的成员条目' }).click();
  await expect(modal.getByRole('checkbox', { name: '抄成员条目 deepseek' })).toBeVisible();
  const reads = submits().filter((payload) => payload.msg_type === 'system.channel.description.get');
  expect(reads).toHaveLength(1);
  expect(reads[0].payload).toEqual({ channel: 'c0.project' });
  for (const name of ['project-agent', 'deepseek', 'search-tool', 'writer']) {
    await expect(modal.getByRole('checkbox', { name: `抄成员条目 ${name}`, exact: true })).toBeVisible();
  }
  await expect(modal.getByText('actor d-deepseek@1', { exact: true })).toBeVisible();
  await modal.getByRole('checkbox', { name: '抄成员条目 project-agent', exact: true }).check();
  await modal.getByRole('checkbox', { name: '抄成员条目 search-tool', exact: true }).check();
  await modal.getByLabel('频道用途').fill('挑两个成员');
  await modal.getByRole('button', { name: '创建频道', exact: true }).click();
  await expectReady(modal);

  const create = submits().find((payload) => payload.msg_type === 'system.channel.create');
  expect(create.channel_id).toBe('c0.project');
  expect(create.payload).toEqual({
    name: 'picked-room',
    parent: 'c0.project',
    humans: ['root'],
    description: {
      description: '挑两个成员',
      members: [
        // 抄过去的条目不带 id：新频道的条目 id 由 registrar 重新铸。
        { name: 'project-agent', body: { class: 'codex' } },
        { name: 'search-tool', body: { actor: 'd-search@1' }, params: { endpoint: 'http://127.0.0.1:9000/mcp' } },
      ],
    },
  });
  const state = await mockState(request);
  const picked = state.descriptions['c0.project.picked-room'].body.members;
  // 挑的两条，加上 registrar 写的 svcactor 条目和到父频道的 peer（group 子频道和 group 父频道互相写一个），再是带进来的人。
  expect(picked.map((entry) => entry.name)).toEqual(['project-agent', 'search-tool', 'svcactor', 'c0.project', 'root']);
  expect(picked.every((entry) => entry.id)).toBe(true);
  expect(state.descriptions['c0.project'].body.members.some((entry) => entry.body?.class === 'peeractor' && entry.params?.channel === 'c0.project.picked-room')).toBe(true);
});

test('复制频道: copy_from creates a channel whose member entries match the source', async ({ page, request }) => {
  const submits = captureSubmits(page);
  await reset(request, 'actor-config', 3503);
  await login(page);
  const modal = await openCreate(page);
  await modal.getByLabel('新频道名称').fill('copy-room');
  await modal.getByRole('radio', { name: '起点 复制一个频道', exact: true }).check();
  // 复制时说明随源频道的描述一起过来，不单独填。
  await expect(modal.getByLabel('频道用途')).toHaveCount(0);
  await expect(modal.getByRole('button', { name: '创建频道', exact: true })).toBeDisabled();
  await modal.getByRole('combobox', { name: '复制的频道' }).click();
  // 只能复制自己是成员的频道；内核频道 c0 不复制，c0.public（不是成员）也不在里面。
  const options = modal.getByRole('listbox', { name: '复制的频道选项' });
  await expect(options.getByRole('option', { name: 'c0.project', exact: true })).toBeVisible();
  await expect(options.getByRole('option', { name: 'c0', exact: true })).toHaveCount(0);
  await expect(options.getByRole('option', { name: 'c0.public', exact: true })).toHaveCount(0);
  await options.getByRole('option', { name: 'c0.project', exact: true }).click();
  await modal.getByRole('button', { name: '创建频道', exact: true }).click();
  await expectReady(modal);

  const create = submits().find((payload) => payload.msg_type === 'system.channel.create');
  expect(create.payload).toEqual({ name: 'copy-room', parent: 'c0', humans: ['root'], copy_from: 'c0.project' });

  // 源频道和新频道的成员条目逐条一致；源频道成员自己的配置不跟过来。
  const state = await mockState(request);
  const source = state.descriptions['c0.project'].body.members;
  expect(source.map((entry) => entry.name)).toEqual(['svcactor', 'project-agent', 'root', 'deepseek', 'search-tool', 'writer']);
  expect(state.descriptions['c0.copy-room'].body.members).toEqual(source);
  // 新频道给每个条目建了自己的配置，全是空值：源频道的配置没跟过来。
  expect(state.member_configs.filter((row) => row.channel_id === 'c0.copy-room').every((row) => Object.keys(row.values).length === 0)).toBe(true);

  // 进入新频道：名册上是按同样条目造出来的成员（writer 占位没填，构建失败，不在名册上）。
  await modal.getByRole('button', { name: '进入新频道', exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('c0.copy-room');
  await page.getByRole('button', { name: '成员', exact: true }).first().click();
  const roster = page.getByRole('complementary', { name: '频道成员' });
  await expect(roster.getByRole('button', { name: /project-agent/ })).toBeVisible();
  // 起不来的成员对外只是没建好（owner 09-30：外面只有一个状态）。
  await expect(roster.getByRole('button', { name: /deepseek/i })).toContainText('未绑定');
  await expect(roster.getByRole('button', { name: /search-tool/ })).toContainText('未绑定');
  await expect(roster.getByRole('button', { name: /writer/i })).toHaveCount(0);
});
