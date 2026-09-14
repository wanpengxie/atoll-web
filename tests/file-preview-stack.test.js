import { describe, expect, it } from 'vitest';
import { popFilePreview, pushFilePreview } from '../src/model/file-preview-stack.js';

const file = (name, line) => ({ channelId: 'c0', resourceId: `/work/${name}`, name, ...(line ? { line } : {}) });

describe('右侧文件预览栈', () => {
  it('文件 A 内打开 B 后，关闭 B 回到 A', () => {
    const a = file('a.md');
    const b = file('b.md');
    const opened = pushFilePreview([], b, a);
    expect(opened.map((row) => row.name)).toEqual(['a.md', 'b.md']);
    expect(popFilePreview(opened).at(-1)).toEqual(a);
  });

  it('重复打开同一位置只更新当前项，不制造假的返回层', () => {
    const a = file('a.md', 20);
    const updated = { ...a, mediaType: 'text/markdown' };
    expect(pushFilePreview([a], updated)).toEqual([updated]);
  });
});
