// @vitest-environment jsdom
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createContentPlan, createContentPlanStore } from '../src/model/content-plan.js';
import {
  ContentPlanBlocks,
  describeContentTextPoint,
  resolveContentTextPoint,
} from '../src/ui/ContentPlanBlocks.jsx';

describe('ContentPlanBlocks', () => {
  it('keeps sealed DOM nodes and an in-block native selection while only the active tail rerenders', () => {
    const renderBlock = vi.fn((block) => <p>{block.source}</p>);
    const first = createContentPlan({ contentKey: 'message:stream:body', source: 'first sealed\n\nsecond sealed\n\nactive' });
    const view = render(<div className="markdown-content"><ContentPlanBlocks plan={first} renderBlock={renderBlock} /></div>);
    const sealed = view.container.querySelector(`[data-reading-block-id="${first.blocks[0].blockID}"]`);
    const sealedText = sealed.querySelector('p').firstChild;
    const selection = getSelection();
    const range = document.createRange();
    range.setStart(sealedText, 1);
    range.setEnd(sealedText, 6);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selection.toString()).toBe('irst ');
    expect(renderBlock).toHaveBeenCalledTimes(3);

    const next = createContentPlan({
      contentKey: 'message:stream:body',
      source: 'first sealed\n\nsecond sealed\n\nactive continues',
      previous: first,
    });
    view.rerender(<div className="markdown-content"><ContentPlanBlocks plan={next} renderBlock={renderBlock} /></div>);

    const surviving = view.container.querySelector(`[data-reading-block-id="${first.blocks[0].blockID}"]`);
    expect(surviving.isSameNode(sealed)).toBe(true);
    expect(surviving.querySelector('p').firstChild.isSameNode(sealedText)).toBe(true);
    expect(selection.anchorNode?.isSameNode(sealedText)).toBe(true);
    expect(selection.toString()).toBe('irst ');
    expect(renderBlock).toHaveBeenCalledTimes(4);
  });

  it('[TC-0518][AD-224] seals a completed tail without rerendering or remounting that unchanged block', () => {
    const renderBlock = vi.fn((block) => <p>{block.source}</p>);
    const first = createContentPlan({ contentKey: 'message:seal:body', source: 'first\n\nfinishing' });
    const view = render(<ContentPlanBlocks plan={first} renderBlock={renderBlock} />);
    const tail = view.container.querySelector(`[data-reading-block-id="${first.blocks[1].blockID}"]`);
    const tailText = tail.querySelector('p').firstChild;
    expect(renderBlock).toHaveBeenCalledTimes(2);

    const next = createContentPlan({
      contentKey: 'message:seal:body',
      source: 'first\n\nfinishing\n\nnew active',
      previous: first,
    });
    expect(next.blocks[1].state).toBe('sealed');
    expect(next.blocks[1].renderRevision).toBe(first.blocks[1].renderRevision);
    view.rerender(<ContentPlanBlocks plan={next} renderBlock={renderBlock} />);

    const sealed = view.container.querySelector(`[data-reading-block-id="${first.blocks[1].blockID}"]`);
    expect(sealed.isSameNode(tail)).toBe(true);
    expect(sealed.querySelector('p').firstChild.isSameNode(tailText)).toBe(true);
    expect(renderBlock).toHaveBeenCalledTimes(3);
  });

  it('[TC-0519][AD-225] restores the same block ids after component unmount while never claiming DOM survival', () => {
    const store = createContentPlanStore({ limit: 4 });
    const renderBlock = (block) => <p>{block.source}</p>;
    const plan = store.plan('message:remount:body', 'one\n\ntwo');
    const first = render(<ContentPlanBlocks plan={plan} renderBlock={renderBlock} />);
    const original = [...first.container.querySelectorAll('[data-reading-block-id]')];
    const ids = original.map((node) => node.dataset.readingBlockId);
    first.unmount();

    const restoredPlan = store.plan('message:remount:body', 'one\n\ntwo');
    const second = render(<ContentPlanBlocks plan={restoredPlan} renderBlock={renderBlock} />);
    const restored = [...second.container.querySelectorAll('[data-reading-block-id]')];
    expect(restored.map((node) => node.dataset.readingBlockId)).toEqual(ids);
    expect(restored[0].isSameNode(original[0])).toBe(false);
  });

  it('keeps selected unchanged siblings mounted when a new prefix block is inserted', () => {
    const renderBlock = (block) => <p>{block.source}</p>;
    const first = createContentPlan({ contentKey: 'message:prefix:body', source: 'selected text\n\ntail' });
    const view = render(<ContentPlanBlocks plan={first} renderBlock={renderBlock} />);
    const selectedBlock = view.container.querySelector(`[data-reading-block-id="${first.blocks[0].blockID}"]`);
    const selectedText = selectedBlock.querySelector('p').firstChild;
    const range = document.createRange();
    range.setStart(selectedText, 0);
    range.setEnd(selectedText, 8);
    getSelection().removeAllRanges();
    getSelection().addRange(range);

    const next = createContentPlan({
      contentKey: 'message:prefix:body',
      source: 'new prefix\n\nselected text\n\ntail grows',
      previous: first,
    });
    view.rerender(<ContentPlanBlocks plan={next} renderBlock={renderBlock} />);

    const surviving = view.container.querySelector(`[data-reading-block-id="${first.blocks[0].blockID}"]`);
    expect(surviving.isSameNode(selectedBlock)).toBe(true);
    expect(surviving.querySelector('p').firstChild.isSameNode(selectedText)).toBe(true);
    expect(getSelection().anchorNode?.isSameNode(selectedText)).toBe(true);
    expect(getSelection().toString()).toBe('selected');
  });

  it('describes a DOM text point and resolves it after a local edit or remount', () => {
    const renderBlock = (block) => <p>{block.source}</p>;
    const source = 'alpha beta target gamma omega';
    const first = createContentPlan({ contentKey: 'message:bookmark:body', source });
    const view = render(<ContentPlanBlocks plan={first} renderBlock={renderBlock} />);
    const originalBlock = view.container.querySelector('[data-reading-block-id]');
    const point = describeContentTextPoint(originalBlock, source.indexOf('target'));

    const changed = `new prefix ${source}`;
    const next = createContentPlan({
      contentKey: 'message:bookmark:body',
      source: changed,
      previous: first,
    });
    view.rerender(<ContentPlanBlocks plan={next} renderBlock={renderBlock} />);
    const resolved = resolveContentTextPoint(view.container, point);
    expect(resolved.block.dataset.readingBlockId).toBe(first.blocks[0].blockID);
    expect(resolved.textOffset).toBe(changed.indexOf('target'));
    expect(resolved.textMatch).toBe('context');
    expect(resolved.node.textContent.slice(resolved.offset)).toMatch(/^target/);

    view.unmount();
    const remounted = render(<ContentPlanBlocks plan={next} renderBlock={renderBlock} />);
    const afterRemount = resolveContentTextPoint(remounted.container, point);
    expect(afterRemount.block.isSameNode(originalBlock)).toBe(false);
    expect(afterRemount.textOffset).toBe(changed.indexOf('target'));
  });

  it('does not guess a deleted block from ambiguous duplicate fingerprints', () => {
    const renderBlock = (block) => <p>{block.source}</p>;
    const plan = createContentPlan({ contentKey: 'message:deleted:body', source: 'same text\n\nsame text' });
    const view = render(<ContentPlanBlocks plan={plan} renderBlock={renderBlock} />);
    const point = describeContentTextPoint(view.container.querySelector('[data-reading-block-id]'), 4);
    const replacement = createContentPlan({ contentKey: 'message:other:body', source: 'same text\n\nsame text' });
    view.rerender(<ContentPlanBlocks plan={replacement} renderBlock={renderBlock} />);
    expect(resolveContentTextPoint(view.container, point)).toBeNull();
  });

  it('rejects an ordinal id reused for different text after plan history is unavailable', () => {
    const renderBlock = (block) => <p>{block.source}</p>;
    const oldPlan = createContentPlan({ contentKey: 'message:evicted:body', source: 'first\n\ntarget passage' });
    const oldView = render(<ContentPlanBlocks plan={oldPlan} renderBlock={renderBlock} />);
    const target = [...oldView.container.querySelectorAll('[data-reading-block-id]')][1];
    const point = describeContentTextPoint(target, 7);
    oldView.unmount();

    const rebuiltWithoutPrevious = createContentPlan({
      contentKey: 'message:evicted:body',
      source: 'inserted\n\nfirst\n\ntarget passage',
    });
    const nextView = render(<ContentPlanBlocks plan={rebuiltWithoutPrevious} renderBlock={renderBlock} />);
    const ordinalCollision = [...nextView.container.querySelectorAll('[data-reading-block-id]')][1];
    expect(ordinalCollision.dataset.readingBlockId).toBe(point.blockID);
    expect(ordinalCollision.textContent).toBe('first');

    const resolved = resolveContentTextPoint(nextView.container, point);
    expect(resolved.block.textContent).toBe('target passage');
    expect(resolved.blockMatch).toBe('unique-fingerprint');
    expect(resolved.textOffset).toBe(7);
  });
});
