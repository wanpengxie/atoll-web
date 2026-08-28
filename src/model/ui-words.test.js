import { describe, expect, it, vi } from 'vitest';
import { execute, openFromPreview, requestBody, snapshot } from './ui-words.js';
import { TYPES } from '../protocol/vocab.js';

const HERE = { id: 's-here', label: 'MacBook 网页' };
const req = (type, body, id = 'req-1') => ({
  id,
  channel_id: 'c0.dev',
  type,
  audience: ['human:root:1'],
  payload: { body },
});

const baseSnapshot = () => snapshot({
  session: HERE,
  channelId: 'c0.dev',
  view: 'dynamic',
  channels: [{ id: 'c0.dev', name: 'Dev' }, { id: 'c0', name: 'c0' }],
  open: { kind: 'none' },
  viewport: { width: 390 },
});

describe('ui.* 是客户端自己受理的词', () => {
  it('ui.state 什么都不改，只回快照', async () => {
    const actions = { navigate: vi.fn(), open: vi.fn() };
    const frame = await execute(req(TYPES.uiState, {}), { session: HERE, actions, readSnapshot: baseSnapshot });
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
    const frame = await execute(req(TYPES.uiNavigate, { channel_id: 'c0', view: 'artifacts', session: HERE.id }), { session: HERE, actions, readSnapshot: read });
    expect(actions.navigate).toHaveBeenCalledWith('c0', 'artifacts');
    // 回执就是操作后的状态，调用方不需要再读一次。
    expect(frame.result.route).toEqual({ channel_id: 'c0', view: 'artifacts' });
    expect(frame.error).toBeUndefined();
  });

  // 这条链路存在的全部意义：前端第一次能说"我没做成"，而不是让人用眼睛发现。
  it('切到一个不存在的频道会失败，而且点名有哪些可选', async () => {
    const actions = { navigate: vi.fn(), open: vi.fn() };
    const frame = await execute(req(TYPES.uiNavigate, { channel_id: 'c0.nope', session: HERE.id }), { session: HERE, actions, readSnapshot: baseSnapshot });
    expect(actions.navigate).not.toHaveBeenCalled();
    expect(frame.result).toBeUndefined();
    expect(frame.error.code).toBe('unknown_channel');
    expect(frame.error.message).toContain('c0.dev');
  });

  it('ui.open 打开文件并带行号', async () => {
    const actions = { navigate: vi.fn(), open: vi.fn() };
    await execute(req(TYPES.uiOpen, { path: '/tmp/a.go', line: 42, session: HERE.id }), { session: HERE, actions, readSnapshot: baseSnapshot });
    expect(actions.open).toHaveBeenCalledWith(expect.objectContaining({ resource_id: '/tmp/a.go', line: 42 }));
  });

  it('相对路径不作数——文件门要的是宿主绝对路径', async () => {
    const actions = { navigate: vi.fn(), open: vi.fn() };
    const frame = await execute(req(TYPES.uiOpen, { path: 'a.go', session: HERE.id }), { session: HERE, actions, readSnapshot: baseSnapshot });
    expect(actions.open).not.toHaveBeenCalled();
    expect(frame.error.code).toBe('invalid_args');
  });

  // 界面抛异常也必须变成账本上的一条失败，而不是一条永远开着的请求。
  it('动作抛异常会如实变成失败，不会静默挂着', async () => {
    const actions = { navigate: vi.fn(() => { throw new Error('boom'); }), open: vi.fn() };
    const frame = await execute(req(TYPES.uiNavigate, { channel_id: 'c0', session: HERE.id }), { session: HERE, actions, readSnapshot: baseSnapshot });
    expect(frame.error).toEqual({ code: 'ui_error', message: 'boom' });
  });

  // 一个人的手机和网页同时连着,两条都在,谁也不顶掉谁。所以"操作这个人的屏幕"
  // 不点名的话,每一块都会动——一次 navigate 把所有标签页一起切走,没人想要。
  it('点名了别的屏幕,这块什么都不做也不回帧', async () => {
    const actions = { navigate: vi.fn(), open: vi.fn() };
    const frame = await execute(
      req(TYPES.uiNavigate, { channel_id: 'c0', session: 's-phone' }),
      { session: HERE, actions, readSnapshot: baseSnapshot },
    );
    expect(actions.navigate).not.toHaveBeenCalled();
    expect(frame).toBeNull();
  });

  it('会改东西的词不点名就拒绝,而且把自己的 id 说出来', async () => {
    const actions = { navigate: vi.fn(), open: vi.fn() };
    const frame = await execute(
      req(TYPES.uiNavigate, { channel_id: 'c0' }),
      { session: HERE, actions, readSnapshot: baseSnapshot },
    );
    expect(actions.navigate).not.toHaveBeenCalled();
    expect(frame.error.code).toBe('session_required');
    // 拒绝要有收获:一次没点名的尝试之后,调用方知道该怎么点名了。
    expect(frame.error.message).toContain('s-here');
    expect(frame.error.message).toContain('MacBook 网页');
  });

  // ui.state 是发现的入口,所以不点名也答;它改不了任何东西,多答几次只是浪费。
  it('只读的 ui.state 不点名也答,而且答里说出自己是谁', async () => {
    const actions = { navigate: vi.fn(), open: vi.fn() };
    const frame = await execute(req(TYPES.uiState, {}), { session: HERE, actions, readSnapshot: baseSnapshot });
    expect(frame.error).toBeUndefined();
    expect(frame.result.session).toEqual(HERE);
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
