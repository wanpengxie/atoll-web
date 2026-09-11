import { argsOf } from '../protocol/envelope.js';
// 工具输出在手机上缩略。
//
// 一次 grep 或者一次文件读取的返回可以是几百 KB,而它在屏幕上永远只露出前几行
// ——要看全的时候人会去展开那一条,而不是把它一直扛在内存里。这条是移动端窗口
// (memory-window.js)的补充:那条管"留多少行",这条管"一行能有多大"。
//
// 只动**进内存的那一份**:落 IndexedDB 的仍是原样(缓存有自己的字节预算,该收的
// 它自己收),所以这里恒不是"把内容删了",是"手机上先只拿头部"。
//
// 只认 process.kind === 'tool' 的那一支——它是账本明说的过程语义,恒不从消息类型
// 或者文本长相去猜谁是工具输出。人写的话、agent 的正文一个字都不动:那些正是要
// 读的东西。
export const MOBILE_TOOL_OUTPUT = Object.freeze({ head: 4096, threshold: 6144 });

function abbreviateText(value, { head, threshold }) {
  if (typeof value !== 'string' || value.length <= threshold) return value;
  return `${value.slice(0, head)}\n…（手机上只保留了开头，此处省略 ${value.length - head} 字符）`;
}

function abbreviateOutput(output, limits) {
  if (typeof output === 'string') {
    const cut = abbreviateText(output, limits);
    return cut === output ? output : cut;
  }
  if (!output || typeof output !== 'object' || Array.isArray(output)) return output;
  let changed = false;
  const next = {};
  for (const [key, value] of Object.entries(output)) {
    const cut = abbreviateText(value, limits);
    if (cut !== value) changed = true;
    next[key] = cut;
  }
  return changed ? next : output;
}

// 没有可缩的东西就原样返回(连一次复制都不做):绝大多数行走的是这条路。
export function abbreviateToolRow(row, limits = MOBILE_TOOL_OUTPUT) {
  const body = argsOf(row?.envelope);
  const process = body.process;
  if (!process || process.kind !== 'tool') return row;
  const output = abbreviateOutput(process.output, limits);
  if (output === process.output) return row;
  return {
    ...row,
    envelope: {
      ...row.envelope,
      payload: Object.prototype.hasOwnProperty.call(row.envelope.payload, 'body')
        ? { ...row.envelope.payload, body: { ...body, process: { ...process, output, output_abbreviated: true } } }
        : { ...body, process: { ...process, output, output_abbreviated: true } },
    },
  };
}
