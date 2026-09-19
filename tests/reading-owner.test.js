// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  currentReadingOwner,
  readingOwnerNodes,
  tailDistance,
} from './browser/reading-owner.js';

function stack(markup, attributes = '') {
  document.body.innerHTML = `<div class="timeline-reading-stack" ${attributes}>${markup}</div>`;
}

const following = '<div class="timeline-reading-layer is-active"><div class="timeline-message-list" data-reading-container="following-tail"></div></div>';
const outgoing = '<div class="timeline-reading-layer is-outgoing"><div class="timeline-message-list" data-reading-container="following-tail"></div></div>';
const incoming = '<div class="timeline-reading-layer is-incoming is-active"><div class="timeline-message-list" data-reading-container="virtuoso"></div></div>';

describe('browser reading owner helper', () => {
  it('selects exactly the outgoing owner while handoff is pending', () => {
    stack(`${outgoing}${incoming}`, 'data-handoff-pending="true"');
    expect(readingOwnerNodes()).toHaveLength(1);
    expect(currentReadingOwner().dataset.readingContainer).toBe('following-tail');
  });

  it('selects exactly the incoming owner after handoff even if outgoing DOM lingers', () => {
    stack(`${outgoing}${incoming}`, 'data-handoff-ready="true"');
    expect(readingOwnerNodes()).toHaveLength(1);
    expect(currentReadingOwner().dataset.readingContainer).toBe('virtuoso');
  });

  it('selects one owner in stable following and restored browsing modes', () => {
    stack(following);
    expect(readingOwnerNodes()).toHaveLength(1);
    expect(currentReadingOwner().dataset.readingContainer).toBe('following-tail');

    stack(incoming);
    expect(readingOwnerNodes()).toHaveLength(1);
    expect(currentReadingOwner().dataset.readingContainer).toBe('virtuoso');
  });

  it('uses reverse-tail and ordinary scroller geometry intentionally', () => {
    expect(tailDistance({
      dataset: { readingContainer: 'following-tail' }, scrollTop: -48,
      scrollHeight: 1_200, clientHeight: 400,
    })).toBe(48);
    expect(tailDistance({
      dataset: { readingContainer: 'virtuoso' }, scrollTop: 775,
      scrollHeight: 1_200, clientHeight: 400,
    })).toBe(25);
  });
});
