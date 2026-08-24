// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { adjacentChannelId, channelShortcutDirection, channelShortcutIndex, channelSwipeDirection, channelSwipeStart } from '../src/model/channel-navigation.js';

const channels = [{ id: 'c0' }, { id: 'design' }, { id: 'dev' }];

describe('channel navigation shortcuts', () => {
  it('cycles next and previous channels with wraparound', () => {
    expect(adjacentChannelId(channels, 'design', 1)).toBe('dev');
    expect(adjacentChannelId(channels, 'c0', -1)).toBe('dev');
    expect(adjacentChannelId(channels, 'dev', 1)).toBe('c0');
    expect(adjacentChannelId(channels, 'outside', 1)).toBe('c0');
    expect(adjacentChannelId(channels, 'outside', -1)).toBe('dev');
    expect(adjacentChannelId([{ id: 'only' }], 'only', 1)).toBe('');
    expect(adjacentChannelId([{ id: 'only' }], 'outside', 1)).toBe('only');
  });

  it('maps Ctrl+N/P but leaves editors, modifiers and dialogs alone', () => {
    const plain = document.createElement('div');
    expect(channelShortcutDirection({ key: 'n', ctrlKey: true, target: plain })).toBe(1);
    expect(channelShortcutDirection({ key: 'P', ctrlKey: true, target: plain })).toBe(-1);
    expect(channelShortcutDirection({ key: 'n', ctrlKey: true, metaKey: true, target: plain })).toBe(0);

    const input = document.createElement('input');
    expect(channelShortcutDirection({ key: 'n', ctrlKey: true, target: input })).toBe(0);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    expect(channelShortcutDirection({ key: 'n', ctrlKey: true, target: plain })).toBe(0);
    dialog.remove();
  });

  it('maps Ctrl+1…9 to a one-based channel position', () => {
    const plain = document.createElement('div');
    expect(channelShortcutIndex({ key: '1', ctrlKey: true, target: plain })).toBe(0);
    expect(channelShortcutIndex({ key: '4', ctrlKey: true, target: plain })).toBe(3);
    expect(channelShortcutIndex({ key: '9', ctrlKey: true, target: plain })).toBe(8);
    expect(channelShortcutIndex({ key: '0', ctrlKey: true, target: plain })).toBe(-1);
    expect(channelShortcutIndex({ key: '2', ctrlKey: true, shiftKey: true, target: plain })).toBe(-1);
  });

  it('recognizes deliberate horizontal swipes and rejects scrolls or controls', () => {
    const surface = document.createElement('div');
    const left = channelSwipeStart({ clientX: 180, clientY: 100 }, surface, 1_000);
    expect(channelSwipeDirection(left, { clientX: 90, clientY: 108 }, 1_400)).toBe(1);
    const right = channelSwipeStart({ clientX: 80, clientY: 100 }, surface, 2_000);
    expect(channelSwipeDirection(right, { clientX: 160, clientY: 95 }, 2_400)).toBe(-1);
    expect(channelSwipeDirection(left, { clientX: 130, clientY: 180 }, 1_400)).toBe(0);
    expect(channelSwipeDirection(left, { clientX: 80, clientY: 100 }, 2_000)).toBe(0);

    const button = document.createElement('button');
    expect(channelSwipeStart({ clientX: 100, clientY: 100 }, button, 1_000)).toBeNull();
  });
});
