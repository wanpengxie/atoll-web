// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { buildWorkspaceHash, parseWorkspaceFocus, parseWorkspaceHash, writeWorkspaceRoute } from '../src/model/workspace-route.js';

describe('workspace hash route', () => {
  it('编码并恢复频道、主视图和稳定 focus', () => {
    const hash = buildWorkspaceHash({
      channelId: 'team/研发',
      view: 'artifacts',
      focus: { type: 'artifact', key: 'artifact:team/研发:res 1' },
    });
    expect(parseWorkspaceHash(hash)).toEqual({
      channelId: 'team/研发',
      view: 'artifacts',
      focus: { type: 'artifact', key: 'artifact:team/研发:res 1' },
      valid: true,
    });
  });

  it('拒绝未知视图和未知 focus，不猜测目标', () => {
    expect(parseWorkspaceHash('#/channels/c1/debug?focus=resource:secret')).toEqual({
      channelId: 'c1', view: 'dynamic', focus: null, valid: false,
    });
    expect(parseWorkspaceFocus('participant:')).toBeNull();
    expect(parseWorkspaceHash('#/broken')).toEqual({ channelId: '', view: 'dynamic', focus: null, valid: false });
  });

  it('写入 history 时区分普通导航与 Context 入口', () => {
    const pushState = vi.spyOn(window.history, 'pushState');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    writeWorkspaceRoute({ channelId: 'c1', view: 'tasks' }, { replace: true });
    writeWorkspaceRoute({ channelId: 'c1', view: 'tasks', focus: { type: 'channel', key: 'c1' } }, { contextEntry: true });
    expect(replaceState).toHaveBeenCalledWith(expect.objectContaining({ atollContextEntry: false }), '', '#/channels/c1/tasks');
    expect(pushState).toHaveBeenCalledWith(expect.objectContaining({ atollContextEntry: true }), '', '#/channels/c1/tasks?focus=channel%3Ac1');
    pushState.mockRestore(); replaceState.mockRestore();
  });
});
