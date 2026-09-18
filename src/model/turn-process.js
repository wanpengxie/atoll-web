import { argsOf } from '../protocol/envelope.js';
// RequestTurn 的过程只有一个事实源：所属 request 的 provisional response。
// 这里负责从 wire payload 中取出 process，并保留 envelope/seq 供所有 UI
// 组件使用；组件不得再从 event type 或 Tool output 猜过程语义。
export function processObservations(turn) {
  return (turn?.provisional || [])
    .map((item) => ({
      seq: Number(item.seq),
      envelope: item.envelope,
      process: argsOf(item.envelope)?.process,
    }))
    .filter((item) => Number.isFinite(item.seq) && item.process && typeof item.process === 'object')
    .sort((left, right) => left.seq - right.seq);
}

// stage:text 是 agent 已经发给对话参与者的正文，只是在线协议把它挂在
// provisional response 上。它不是思考草稿，也不属于执行过程。
export function conversationTextObservations(turn) {
  return processObservations(turn).filter(({ process }) => (
    process.kind === 'stage'
    && process.stage === 'text'
    && typeof process.text === 'string'
    && process.text.trim().length > 0
  ));
}

export function executionProcessObservations(turn) {
  return processObservations(turn).filter(({ process }) => !(process.kind === 'stage' && process.stage === 'text'));
}

export function processCount(turn) {
  const keys = new Set();
  for (const item of executionProcessObservations(turn)) {
    if (item.process.kind === 'tool') keys.add(`tool:${item.process.tool_call_id || item.seq}`);
    if (item.process.kind === 'stage') keys.add(`stage:${item.seq}`);
  }
  return keys.size;
}

export function turnStartObservation(turn) {
  return processObservations(turn).find((item) => item.process.kind === 'turn' && item.process.phase === 'started') || null;
}

// claude 的最后一个 text 块与终稿同文——这是 provider 有意的选择（见
// provider/claude/output.go："过程是过程，回答是回答，各自完整，恒不为了去重而猜
// '这块是不是最后一块'"）。它猜不了：发那一块的时候它还不知道终稿长什么样。
//
// 但渲染的时候两份都在手上，就不用猜了：**末条过程文本如果就是答案本身，只是
// 答案提前到了一次，不是又说了一遍。** 只看末条——中间那些是真正的过程正文，一个
// 都不能少。
//
// 过程记录是截断过的（provider 侧 4096 字），所以"是答案本身"包含"是答案的前缀"。
const TRUNCATION_MARK = '…[truncated]';

// Return the one provisional observation which is the early delivery of the
// terminal answer. Callers that render content can use this as a logical slot
// hand-off instead of deleting one keyed tree and mounting another. Only the
// last stage is eligible: earlier stages remain distinct conversation records.
export function finalEchoObservation(observations, terminalText) {
  const answer = String(terminalText || '').trim();
  if (!answer || !observations.length) return null;
  const observation = observations.at(-1);
  const last = String(observation?.process?.text || '').trim();
  if (!last) return null;
  const body = last.endsWith(TRUNCATION_MARK) ? last.slice(0, -TRUNCATION_MARK.length) : last;
  if (!body) return null;
  return answer.startsWith(body) ? observation : null;
}

export function withoutFinalEcho(observations, terminalText) {
  return finalEchoObservation(observations, terminalText)
    ? observations.slice(0, -1)
    : observations;
}
