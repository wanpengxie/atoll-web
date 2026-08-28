import { describe, expect, it } from 'vitest';
import { createRoster } from '../src/model/roster.js';

// attach 回执自带"我在每个频道是哪个 actor"。在此之前 self() 只有两条慢路——
// 把那个频道的 roster 拉下来(只有当前活跃频道会拉),或者你自己在那儿发过言。
//
// 而 fold 用 selfId 判断"这条是不是发给我的",selfId 为空就整条丢掉,**而且之后
// 没人再捡回来**。于是一个你还没打开、也没说过话的频道里,别人 @ 你的 human.ask、
// agent 发来的 ui.*,都会无声消失。答案连上那一刻就在手里,不该等那两条慢路。
describe('连上就知道我在每个频道是谁', () => {
  const roster = () => createRoster({ me: 'root', request: async () => [] });

  it('noteSelf 之后 self() 立刻有值,不用先拉 roster 也不用先发言', () => {
    const r = roster();
    expect(r.self('c0')).toBe('');
    expect(r.noteSelf('c0', 'human:root:1')).toBe('human:root:1');
    expect(r.self('c0')).toBe('human:root:1');
  });

  it('重复记同一个不算变化——重连每次都会带这份清单过来', () => {
    const r = roster();
    expect(r.noteSelf('c0', 'human:root:1')).toBe('human:root:1');
    expect(r.noteSelf('c0', 'human:root:1')).toBe('');
  });

  it('缺频道或缺 actor 一律不记,空值比错值好', () => {
    const r = roster();
    expect(r.noteSelf('', 'human:root:1')).toBe('');
    expect(r.noteSelf('c0', '')).toBe('');
    expect(r.self('c0')).toBe('');
  });

  it('被踢出频道时清掉,不留一个已经不成立的身份', () => {
    const r = roster();
    r.noteSelf('c0', 'human:root:1');
    r.clearSelf('c0');
    expect(r.self('c0')).toBe('');
  });
});
