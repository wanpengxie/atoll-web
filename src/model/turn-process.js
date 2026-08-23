// RequestTurn 的过程只有一个事实源：所属 request 的 provisional response。
// 这里负责从 wire payload 中取出 process，并保留 envelope/seq 供所有 UI
// 组件使用；组件不得再从 event type 或 Tool output 猜过程语义。
export function processObservations(turn) {
  return (turn?.provisional || [])
    .map((item) => ({
      seq: Number(item.seq),
      envelope: item.envelope,
      process: item.envelope?.payload?.process,
    }))
    .filter((item) => Number.isFinite(item.seq) && item.process && typeof item.process === 'object')
    .sort((left, right) => left.seq - right.seq);
}

export function processCount(turn) {
  const keys = new Set();
  for (const item of processObservations(turn)) {
    if (item.process.kind === 'tool') keys.add(`tool:${item.process.tool_call_id || item.seq}`);
    if (item.process.kind === 'stage') keys.add(`stage:${item.seq}`);
  }
  return keys.size;
}

export function turnStartObservation(turn) {
  return processObservations(turn).find((item) => item.process.kind === 'turn' && item.process.phase === 'started') || null;
}
