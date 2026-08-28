import { describe, expect, it } from 'vitest';
import { describeClient } from './client-label.js';

// 这个名字只给人看,从不用于寻址——寻址靠服务端铸的 id。所以它猜错了是不好看,
// 不是不安全,断言也只该断言"人认得出",不该断言某个精确字符串。
describe('客户端自称', () => {
  it('说出平台和浏览器,好让人在几块屏里认出哪块是哪块', () => {
    expect(describeClient('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'))
      .toBe('Mac Chrome');
    expect(describeClient('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'))
      .toBe('iOS Safari');
  });

  // Chrome 的 UA 里带着 Safari,Edge 的里带着 Chrome。认错了不至于出事,但"我的
  // Edge"被叫成 Chrome 会让人在选屏幕时犹豫,而犹豫正是这个字段要消除的东西。
  it('不把 Edge 认成 Chrome,也不把 Chrome 认成 Safari', () => {
    expect(describeClient('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120')).toBe('Windows Edge');
    expect(describeClient('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36')).toBe('Linux Chrome');
  });

  it('认不出来也要给个人话,不能是空的', () => {
    expect(describeClient('')).toBe('网页');
    expect(describeClient('SomeBotUA/1.0')).toBe('网页');
  });
});
