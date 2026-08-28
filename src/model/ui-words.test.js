import { describe, expect, it, vi } from 'vitest';
import { execute, openFromPreview, requestBody, snapshot } from './ui-words.js';
import { TYPES } from '../protocol/vocab.js';

const req = (type, body, id = 'req-1') => ({
  id,
  channel_id: 'c0.dev',
  type,
  audience: ['human:root:1'],
  payload: { body },
});

const baseSnapshot = () => snapshot({
  channelId: 'c0.dev',
  view: 'dynamic',
  channels: [{ id: 'c0.dev', name: 'Dev' }, { id: 'c0', name: 'c0' }],
  open: { kind: 'none' },
  viewport: { width: 390 },
});

describe('ui.* 是客户端自己受理的词', () => {
  it('ui.state 什么都不改，只回快照', async () => {
    const actions = { navigate: vi.fn(), open: vi.fn() };
    const frame = await execute(req(TYPES.uiState, {}), { actions, readSnapshot: baseSnapshot });
    expect(actions.navigate).not.toHaveBeenCalled();
    expect(actions.open).not.toHaveBeenCalled();
    expect(frame.result.route).toEqual({ channel_id: 'c0.dev', view: 'dynamic' });
  });

  // available 存在的理由：只报当前状态而不报可选项，调用方就只能猜
  // ui.navigate 该填什么。
  it('快照带上可以去哪，不只是现在在哪', () => {
    expect(baseSnapshot().available.channels.map((row) => row.id)).toEqual(['c0.dev', 'c0']);
  });

  it('ui.navigate 切过去，并回操作之后的状态', async () => {
    let view = 'dynamic';
    const actions = {
      navigate: vi.fn((_id, next) => { if (next) view = next; }),
      open: vi.fn(),
    };
    const read = () => snapshot({ channelId: 'c0', view, channels: [{ id: 'c0' }], open: { kind: 'none' } });
    const frame = await execute(req(TYPES.uiNavigate, { channel_id: 'c0', view: 'artifacts' }), { actions, readSnapshot: read });
    expect(actions.navigate).toHaveBeenCalledWith('c0', 'artifacts');
    // 回执就是操作后的状态，调用方不需要再读一次。
    expect(frame.result.route).toEqual({ channel_id: 'c0', view: 'artifacts' });
    expect(frame.error).toBeUndefined();
  });

  // 这条链路存在的全部意义：前端第一次能说"我没做成"，而不是让人用眼睛发现。
  it('切到一个不存在的频道会失败，而且点名有哪些可选', async () => {
    const actions = { navigate: vi.fn(), open: vi.fn() };
    const frame = await execute(req(TYPES.uiNavigate, { channel_id: 'c0.nope' }), { actions, readSnapshot: baseSnapshot });
    expect(actions.navigate).not.toHaveBeenCalled();
    expect(frame.result).toBeUndefined();
    expect(frame.error.code).toBe('unknown_channel');
    expect(frame.error.message).toContain('c0.dev');
  });

  it('ui.open 打开文件并带行号', async () => {
    const actions = { navigate: vi.fn(), open: vi.fn() };
    await execute(req(TYPES.uiOpen, { path: '/tmp/a.go', line: 42 }), { actions, readSnapshot: baseSnapshot });
    expect(actions.open).toHaveBeenCalledWith(expect.objectContaining({ resource_id: '/tmp/a.go', line: 42 }));
  });

  it('相对路径不作数——文件门要的是宿主绝对路径', async () => {
    const actions = { navigate: vi.fn(), open: vi.fn() };
    const frame = await execute(req(TYPES.uiOpen, { path: 'a.go' }), { actions, readSnapshot: baseSnapshot });
    expect(actions.open).not.toHaveBeenCalled();
    expect(frame.error.code).toBe('invalid_args');
  });

  // 界面抛异常也必须变成账本上的一条失败，而不是一条永远开着的请求。
  it('动作抛异常会如实变成失败，不会静默挂着', async () => {
    const actions = { navigate: vi.fn(() => { throw new Error('boom'); }), open: vi.fn() };
    const frame = await execute(req(TYPES.uiNavigate, { channel_id: 'c0' }), { actions, readSnapshot: baseSnapshot });
    expect(frame.error).toEqual({ code: 'ui_error', message: 'boom' });
  });

  it('body 从 {_context, body} 里取，_context 是底座的，不是词的参数', () => {
    expect(requestBody({ payload: { _context: { caller: {} }, body: { path: '/x' } } })).toEqual({ path: '/x' });
    expect(requestBody({ payload: null })).toEqual({});
  });

  it('open 段如实区分文件预览和 artifact，没开就是 none', () => {
    expect(openFromPreview(null)).toEqual({ kind: 'none' });
    expect(openFromPreview({ resource_id: '/a.go', name: 'a.go', file_reference: true, line: 7 }))
      .toEqual({ kind: 'file', path: '/a.go', name: 'a.go', line: 7 });
    expect(openFromPreview({ resource_id: 'res-1', name: 'x.png' }).kind).toBe('artifact');
  });
});
