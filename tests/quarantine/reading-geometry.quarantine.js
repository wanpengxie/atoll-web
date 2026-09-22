import { afterEach, describe, expect, it } from 'vitest';
import { topVisibleBookmark, visibleRowEvidence } from '../src/ui/timeline/reading-geometry.js';

const previousDocument = globalThis.document;
const previousComputedStyle = globalThis.getComputedStyle;

afterEach(() => {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
  if (previousComputedStyle === undefined) delete globalThis.getComputedStyle;
  else globalThis.getComputedStyle = previousComputedStyle;
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

  it('does not report a row whose painted pixels are hit-tested under the waiting dock', () => {
    const row = node('arrival', {
      top: 300, bottom: 500, left: 0, right: 800,
    });
    const waiting = {
      getBoundingClientRect: () => ({ top: 450, bottom: 550, left: 0, right: 800, width: 800, height: 100 }),
      contains: (candidate) => candidate === waiting,
    };
    const root = {
      getBoundingClientRect: () => ({ top: 100, bottom: 600, left: 0, right: 800 }),
      querySelectorAll: () => [row],
    };
    const style = {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      getPropertyValue: () => '0',
    };
    globalThis.getComputedStyle = () => style;
    globalThis.document = {
      querySelectorAll: () => [waiting],
      elementFromPoint: (_x, y) => y >= 450 ? waiting : row,
    };

    expect(visibleRowEvidence(root, [{ id: 'arrival', seqHigh: 12 }])).toEqual([]);
  });
});
