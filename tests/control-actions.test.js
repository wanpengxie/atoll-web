import { describe, expect, it } from 'vitest';
import { createControlState, restoreControlStates, saveControlStates } from '../src/model/control-actions.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe('控制动作恢复', () => {
  it('按 principal 隔离，并把刷新前发送中恢复为不确定', () => {
    const storage = memoryStorage();
    saveControlStates('p1', {
      'c1:r1:cancel': createControlState('sending', null, 10),
      'c1:r2:cancel': createControlState('accepted', null, 11),
    }, storage);

    expect(restoreControlStates('p2', storage)).toEqual({});
    expect(restoreControlStates('p1', storage)).toEqual({
      'c1:r1:cancel': { status: 'uncertain', error: null, updatedAt: 10 },
      'c1:r2:cancel': { status: 'accepted', error: null, updatedAt: 11 },
    });
  });

  it('只保存可解释的活动状态并把 Error 转成可序列化错误', () => {
    const storage = memoryStorage();
    const error = new Error('连接关闭');
    error.code = 'closed';
    saveControlStates('p1', {
      keep: createControlState('uncertain', error, 20),
      discard: { status: 'resolved', error: null },
    }, storage);

    expect(restoreControlStates('p1', storage)).toEqual({
      keep: { status: 'uncertain', error: { code: 'closed', detail: '连接关闭' }, updatedAt: 20 },
    });
  });
});
