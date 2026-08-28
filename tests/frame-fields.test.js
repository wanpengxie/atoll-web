import { describe, expect, it } from 'vitest';
import { UP, upstreamPayloadFields, validateUpstreamPayload } from '../src/protocol/frame.js';

// 这个白名单是**客户端拒绝自己发出去的帧**的地方。给某个帧加了字段却忘了同步
// 这里,后果不是"那个字段被忽略",而是整条帧被拒——attach 被拒就等于连不上,
// 而且报的是一个跟功能毫无关系的 wire 错误。
//
// 2026-08-28 就这么坏过一次:给 attach 加了 label、给 resolve 加了 result/error,
// 三条全被自己的白名单拒掉。所以这里按"实际会发出去的形状"逐条断言,而不是
// 断言白名单的内容——后者只是把同一份清单抄两遍,抄错了两边一起错。

describe('上行帧白名单跟真正发出去的帧对得上', () => {
  const accepts = (type, payload) => {
    expect(() => validateUpstreamPayload(type, payload)).not.toThrow();
  };

  it('attach 带着这条连接的自称', () => {
    accepts(UP.attach, { since: {}, focus: '', history_protocol: 5, generation: 1, label: 'Mac Chrome' });
    // 没有自称也得能连:label 是可选的,不该变成连接的前提。
    accepts(UP.attach, { since: {}, focus: '', history_protocol: 5, generation: 1 });
  });

  // resolve 现在关两族词:人答的(text/decision/note)和客户端答的(result/error)。
  // 两组都得过白名单;它们不该混用,但那是服务端的判断,不是这一层的。
  it('resolve 同时容得下人给的答复和客户端给的结果', () => {
    accepts(UP.resolve, { channel_id: 'c0', req_id: 'r1', text: '好' });
    accepts(UP.resolve, { channel_id: 'c0', req_id: 'r1', decision: 'approve', note: '看过了' });
    accepts(UP.resolve, { channel_id: 'c0', req_id: 'r1', result: { route: { channel_id: 'c0' } } });
    accepts(UP.resolve, { channel_id: 'c0', req_id: 'r1', error: { code: 'ui_error', message: 'boom' } });
  });

  // 人发的消息上盖的 origin 藏在 payload 这一整块里,不是 submit 的顶层字段——
  // 所以它不需要白名单,也正因如此它当初没被拒。记下来是为了说明这两者不同。
  it('submit 的 body 是不透明的一块,盖在里面的 origin 不受白名单管', () => {
    accepts(UP.submit, {
      channel_id: 'c0', msg_type: 'agent.ask', kind: 'request',
      payload: { text: 'hi', origin: { session: 's-1', label: 'Mac Chrome' } },
    });
  });

  // 白名单还得**继续拦**没见过的字段,否则上面几条就只是把它拆了。
  it('仍然拒绝真正未知的字段', () => {
    for (const [type, payload] of [
      [UP.attach, { focus: '', history_protocol: 5, generation: 1, bogus: 1 }],
      [UP.resolve, { channel_id: 'c0', req_id: 'r1', bogus: 1 }],
      [UP.submit, { channel_id: 'c0', msg_type: 'agent.ask', bogus: 1 }],
    ]) {
      expect(() => validateUpstreamPayload(type, payload)).toThrow(/unknown field/);
    }
  });

  // upstreamPayloadFields 是对外暴露的那份清单;它必须跟真正生效的白名单是同一份,
  // 否则读它的人会照着一份不生效的清单写代码。
  it('对外暴露的清单就是生效的那一份', () => {
    expect(upstreamPayloadFields(UP.attach)).toContain('label');
    expect(upstreamPayloadFields(UP.resolve)).toEqual(expect.arrayContaining(['result', 'error']));
  });
});
