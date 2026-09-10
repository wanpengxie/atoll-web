import { describe, expect, it } from 'vitest';
import { abbreviateToolRow, MOBILE_TOOL_OUTPUT } from '../src/model/payload-abbreviate.js';

function toolRow(output) {
  return {
    channel_id: 'c',
    seq: 7,
    envelope: { id: 'm-7', kind: 'response', payload: { process: { kind: 'tool', tool: 'Bash', tool_call_id: 't1', input: { command: 'grep -r x .' }, output } } },
  };
}

const big = 'x'.repeat(200_000);

describe('工具输出在手机上只进头部', () => {
  it('超过阈值就切,留下的是开头,并说清省了多少', () => {
    const row = abbreviateToolRow(toolRow(big));
    const output = row.envelope.payload.process.output;
    expect(output.startsWith('x'.repeat(100))).toBe(true);
    expect(output.length).toBeLessThan(MOBILE_TOOL_OUTPUT.head + 200);
    expect(output).toContain('省略');
    expect(row.envelope.payload.process.output_abbreviated).toBe(true);
  });

  // 原行是要落 IndexedDB 的那一份:缩略恒不能就地改它,否则本机就再也拿不回全文。
  it('恒不就地修改原行', () => {
    const original = toolRow(big);
    const row = abbreviateToolRow(original);
    expect(row).not.toBe(original);
    expect(original.envelope.payload.process.output).toBe(big);
    expect(row.envelope.payload.process.input).toEqual(original.envelope.payload.process.input);
  });

  it('没超阈值的原样返回,连复制都不做', () => {
    const original = toolRow('short output');
    expect(abbreviateToolRow(original)).toBe(original);
  });

  it('输出是对象时逐字段切', () => {
    const row = abbreviateToolRow(toolRow({ stdout: big, exit_code: '0' }));
    expect(row.envelope.payload.process.output.stdout).toContain('省略');
    expect(row.envelope.payload.process.output.exit_code).toBe('0');
  });

  // 人写的话和 agent 的正文一个字都不能动——那些正是要读的东西。
  it('不是 tool 过程的行一律不动', () => {
    const message = { channel_id: 'c', seq: 8, envelope: { id: 'm-8', kind: 'request', type: 'agent.ask', payload: { text: big } } };
    expect(abbreviateToolRow(message)).toBe(message);
    const note = { channel_id: 'c', seq: 9, envelope: { id: 'm-9', kind: 'response', payload: { process: { kind: 'stage', stage: 'text', text: big } } } };
    expect(abbreviateToolRow(note)).toBe(note);
  });
});
