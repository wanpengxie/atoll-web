import { describe, expect, it } from 'vitest';
import { buildFormSpec, resolveFormSpec, valuesToPayload } from '../src/model/dynamic-form.js';

describe('dynamic capability form', () => {
  it('builds and validates JSON Schema fields with typed values', () => {
    const spec = buildFormSpec('order.create', { inputSchema: { type: 'object', required: ['name', 'count'], properties: {
      name: { type: 'string' }, count: { type: 'integer' }, urgent: { type: 'boolean' }, tags: { type: 'array' }, level: { type: 'string', enum: ['low', 'high'] },
    } } });
    expect(spec.mode).toBe('fields');
    expect(valuesToPayload(spec, { name: 'A', count: '2', urgent: true, tags: '["x"]', level: 'high' })).toEqual({ name: 'A', count: 2, urgent: true, tags: ['x'], level: 'high' });
    expect(() => valuesToPayload(spec, { name: '', count: '2' })).toThrow('name 为必填项');
    expect(() => valuesToPayload(spec, { name: 'A', count: '2.5' })).toThrow('count 必须是整数');
  });

  it('uses standard control payloads for the agent words the base advertises', () => {
    const steer = buildFormSpec('agent.steer', {});
    expect(valuesToPayload(steer, { text: '换个方向' })).toEqual({ text: '换个方向' });
    expect(valuesToPayload(steer, { text: '换个方向', expected_turn_id: 't1' })).toEqual({ text: '换个方向', expected_turn_id: 't1' });
    expect(() => valuesToPayload(steer, { text: '' })).toThrow('text 为必填项');
  });

  it('resolve 帧的字段闭集由后端定死，没有动态表单空间', () => {
    expect(resolveFormSpec('human.ask')).toMatchObject({ mode: 'text', field: 'text', required: true });
    expect(resolveFormSpec('human.approve')).toMatchObject({ mode: 'decision', field: 'note', required: false });
  });
});
