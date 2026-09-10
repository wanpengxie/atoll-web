import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 这条门禁治的是一个真实事故:App 在早返回(booting / 未登录)之后加了两个 useMemo,
// 于是登录前后两次渲染的 hook 条数不一样,整页白屏报
// "Rendered more hooks than during the previous render"。
//
// 515 条单测全绿也没拦住——没有任何一条测试真的渲染 <App/> 走完那段过渡,而把 App
// 的全套依赖 mock 起来的夹具会比被测的东西还长。
//
// App 是仓里唯一一个"早返回夹在千行组件体中间"的组件,所以这里就钉它:早返回之后,
// 组件体那一层(缩进 ≤2)恒不再出现 hook 调用。派生值缓存请用 App 里的 derived()
// ——它是普通函数,恒不新增 hook。
// 真正的答案是 eslint 的 react-hooks/rules-of-hooks;仓里还没有 eslint,有了就删这条。
const APP = new URL('../src/App.jsx', import.meta.url);
const HOOK_AT_BODY_LEVEL = /^ {0,2}(const|let|var)?\s*.*\buse[A-Z]\w*\s*\(/;

describe('App 的 hook 顺序', () => {
  it('早返回之后,组件体里恒不再调 hook', () => {
    const lines = readFileSync(APP, 'utf8').split('\n');
    // 锚在 App 自己那两条早返回上(booting / 未登录),恒不去猜别的函数里的 return。
    const firstEarlyReturn = lines.findIndex((line) => /^\s*if \(booting\) return /.test(line));
    expect(firstEarlyReturn).toBeGreaterThan(0);
    const offenders = lines
      .slice(firstEarlyReturn)
      .map((line, index) => ({ line, at: firstEarlyReturn + index + 1 }))
      .filter(({ line }) => HOOK_AT_BODY_LEVEL.test(line))
      .map(({ at, line }) => `App.jsx:${at} ${line.trim()}`);
    expect(offenders).toEqual([]);
  });
});
