import { describe, expect, it } from 'vitest';
import { redactSensitive, terminalPresentation } from '../src/ui/StructuredResult.jsx';

describe('structured terminal presentation', () => {
  it('以 cancelled 事实优先解释取消终态', () => {
    expect(terminalPresentation('agent.ask', {
      status: 'failed', reason: 'unanswered_timeout', cancelled: true, detail: 'cancelled by caller',
    })).toMatchObject({ kind: 'failed', title: '任务已取消', code: 'cancelled' });
  });

  it('never renders successful non-text results as an empty answer', () => {
    expect(terminalPresentation('agent.ask', { status: 'completed' })).toEqual({ kind: 'ack', title: '已完成' });
    expect(terminalPresentation('agent.ask', { status: 'completed', text: '' })).toMatchObject({ kind: 'text', empty: true });
    expect(terminalPresentation('system.channel.list', { status: 'completed', value: [{ id: 'c0' }] })).toMatchObject({ kind: 'registrar', title: 'system.channel.list' });
    expect(terminalPresentation('actor.describe', { status: 'completed', class: 'codex', interfaces: ['actor'], capabilities: {}, words: { 'agent.ask': { description: 'ask' } } }))
      .toMatchObject({ kind: 'describe', title: 'codex 的能力', value: { class: 'codex', words: { 'agent.ask': { description: 'ask' } } } });
  });

  it('keeps failure facts and redacts sensitive fields recursively', () => {
    const failure = terminalPresentation('agent.ask', { status: 'failed', reason: 'receiver_internal_error', error_code: 'type_unsupported', detail: 'nope', diagnostic: { attempt: 1 } });
    expect(failure).toMatchObject({ kind: 'failed', title: '接收方不支持这个操作', code: 'type_unsupported', detail: 'nope', value: { diagnostic: { attempt: 1 } } });
    expect(redactSensitive({ token: 'x', nested: { password: 'y', name: 'ok' } })).toEqual({ token: '已隐藏', nested: { password: '已隐藏', name: 'ok' } });
  });

  it('redacts registrar value secrets before rendering', () => {
    expect(terminalPresentation('system.device.create', { status: 'completed', value: { device_id: 'd1', key: 'secret-value' } }).value)
      .toEqual({ device_id: 'd1', key: '已隐藏' });
  });
});
