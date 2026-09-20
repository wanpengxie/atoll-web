import { afterEach, describe, expect, it } from 'vitest';
import { topVisibleBookmark } from '../src/ui/timeline/reading-geometry.js';

const previousDocument = globalThis.document;

afterEach(() => {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
});

function node(id, rect) {
  const value = {
    dataset: { presentationRowId: id },
    getBoundingClientRect: () => rect,
    contains: (candidate) => candidate === value,
  };
  return value;
}

describe('public Reading geometry bookmark', () => {
  it('skips a virtualizer sliver and returns the hit-tested anchor offset', () => {
    const sliver = node('sliver', {
      top: 99, bottom: 101, left: 0, right: 800,
    });
    const anchor = node('anchor', {
      top: 150, bottom: 260, left: 0, right: 800,
    });
    const root = {
      getBoundingClientRect: () => ({ top: 100, bottom: 700, left: 0, right: 800 }),
      querySelectorAll: () => [sliver, anchor],
    };
    globalThis.document = { elementFromPoint: () => anchor };

    expect(topVisibleBookmark(root, [
      { id: 'sliver', seqLow: 8 },
      { id: 'anchor', seqLow: 9 },
    ])).toEqual({
      messageID: 'anchor',
      rowViewportOffset: 50,
      viewportOffset: 50,
      seq: 9,
      predecessorID: 'sliver',
      successorID: '',
    });
  });
});
