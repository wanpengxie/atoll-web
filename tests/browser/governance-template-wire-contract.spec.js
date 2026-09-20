import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'channel-governance', seed: 3501 },
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

function decodeSentFrame(frame) {
  try {
    const outer = typeof frame === 'string' ? JSON.parse(frame) : frame;
    return typeof outer?.payload === 'string' ? JSON.parse(outer.payload) : outer?.payload || null;
  } catch {
    return null;
  }
}

function submitPayloads(frames) {
  return frames.map(decodeSentFrame)
    .filter((frame) => frame?.frame_type === 'submit' && frame.payload?.msg_type)
    .map((frame) => frame.payload);
}

async function openOverview(page) {
  await page.getByRole('button', { name: '频道操作' }).click();
  await page.getByRole('menuitem', { name: '频道详情' }).click();
  const panel = page.getByRole('complementary', { name: /频道治理/ });
  await expect(panel).toBeVisible();
  await panel.getByRole('tab', { name: '概览', exact: true }).click();
  return panel;
}

test('Registrar list/get receipts hydrate canonical templates before channel recipe create', async ({ page, request }) => {
  const frames = [];
  page.on('websocket', (socket) => socket.on('framesent', (frame) => frames.push(frame)));
  await reset(request);
  await login(page);
  const panel = await openOverview(page);

  // The old fae8b70 flow read Registrar facts first. A directory refresh must
  // therefore issue a list receipt and only then publish canonical rows to
  // the channel Governance port; a pre-seeded mock row is not a substitute.
  await panel.getByRole('button', { name: '刷新目录事实' }).click();
  await expect.poll(() => submitPayloads(frames)
    .filter((payload) => payload.msg_type === 'system.channel.template.list')).toHaveLength(1);
  await panel.getByRole('combobox', { name: '频道模板' }).click();
  await expect(panel.getByRole('option', { name: /Team channel/ })).toBeVisible();

  await panel.getByRole('option', { name: /Team channel/ }).click();
  await panel.getByLabel('名称').fill('templated-room');
  await panel.getByLabel('用途').fill('from Registrar recipe');
  await panel.getByRole('button', { name: '创建子频道' }).click();

  // Compact list rows are not a recipe. Creation must wait for the matching
  // get receipt/body and then send that body as the canonical recipe.
  await expect.poll(() => submitPayloads(frames)
    .filter((payload) => payload.msg_type === 'system.channel.template.get'
      && payload.payload?.id === 'mock:team')).toHaveLength(1);
  await expect.poll(() => submitPayloads(frames)
    .filter((payload) => payload.msg_type === 'system.channel.create'
      && payload.payload?.name === 'templated-room')).toHaveLength(1);
  const sequence = submitPayloads(frames);
  const listIndex = sequence.findIndex((payload) => payload.msg_type === 'system.channel.template.list');
  const getIndex = sequence.findIndex((payload) => payload.msg_type === 'system.channel.template.get' && payload.payload?.id === 'mock:team');
  const createIndex = sequence.findIndex((payload) => payload.msg_type === 'system.channel.create' && payload.payload?.name === 'templated-room');
  expect(listIndex).toBeLessThan(getIndex);
  expect(getIndex).toBeLessThan(createIndex);
  const create = sequence[createIndex];
  expect(create.channel_id).toBe('c0');
  expect(create.payload.name).toBe('templated-room');
  expect(create.payload.recipe).toEqual(expect.objectContaining({
    declarations: [{ decl_id: 'mock:steward' }],
    profile: expect.objectContaining({
      default_storage_device_id: 'local-device',
      description: 'from Registrar recipe',
    }),
  }));
  expect(create.payload.templateId).toBeUndefined();
});

test('ChannelCreateModal reads a template body before sending the public recipe', async ({ page, request }) => {
  const frames = [];
  page.on('websocket', (socket) => socket.on('framesent', (frame) => frames.push(frame)));
  await reset(request);
  await login(page);

  await page.getByRole('button', { name: '新建频道' }).click();
  const modal = page.getByRole('dialog', { name: '新建频道' });
  await expect(modal).toBeVisible();
  await expect.poll(() => submitPayloads(frames)
    .filter((payload) => payload.msg_type === 'system.channel.template.list')).toHaveLength(1);

  await modal.getByRole('combobox', { name: '频道模板' }).click();
  await expect(modal.getByRole('option', { name: /Team channel/ })).toBeVisible();
  await modal.getByRole('option', { name: /Team channel/ }).click();
  await modal.getByLabel('新频道名称').fill('modal-templated-room');
  await modal.getByLabel('频道用途').fill('from modal Registrar recipe');
  await modal.getByRole('button', { name: '创建频道' }).click();

  await expect.poll(() => submitPayloads(frames)
    .filter((payload) => payload.msg_type === 'system.channel.template.get'
      && payload.payload?.id === 'mock:team')).toHaveLength(1);
  await expect.poll(() => submitPayloads(frames)
    .filter((payload) => payload.msg_type === 'system.channel.create'
      && payload.payload?.name === 'modal-templated-room')).toHaveLength(1);

  const sequence = submitPayloads(frames);
  const getIndex = sequence.findIndex((payload) => payload.msg_type === 'system.channel.template.get'
    && payload.payload?.id === 'mock:team');
  const createIndex = sequence.findIndex((payload) => payload.msg_type === 'system.channel.create'
    && payload.payload?.name === 'modal-templated-room');
  expect(getIndex).toBeGreaterThanOrEqual(0);
  expect(getIndex).toBeLessThan(createIndex);
  const create = sequence[createIndex];
  expect(create.channel_id).toBe('c0');
  expect(create.payload.recipe).toEqual(expect.objectContaining({
    declarations: [{ decl_id: 'mock:steward' }],
    profile: expect.objectContaining({
      default_storage_device_id: 'local-device',
      description: 'from modal Registrar recipe',
    }),
  }));
  expect(create.payload.templateId).toBeUndefined();
});
