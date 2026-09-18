import React from 'react';
import { createContentTextPoint, resolveContentTextOffset } from '../model/content-plan.js';

function readingBlocks(root) {
  if (!root) return [];
  const blocks = [...root.querySelectorAll?.('[data-reading-block-id]') || []];
  if (root.matches?.('[data-reading-block-id]')) blocks.unshift(root);
  return blocks;
}

function textNodesOf(block) {
  if (!block?.ownerDocument) return [];
  const walker = block.ownerDocument.createTreeWalker(
    block,
    globalThis.NodeFilter?.SHOW_TEXT || 4,
  );
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
  return nodes;
}

function domBoundaryAt(block, textOffset) {
  const nodes = textNodesOf(block);
  let remaining = Math.max(0, Number(textOffset) || 0);
  for (const node of nodes) {
    const length = node.textContent?.length || 0;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
  }
  const last = nodes.at(-1);
  return last
    ? { node: last, offset: last.textContent?.length || 0 }
    : { node: block, offset: 0 };
}

// These helpers describe and resolve semantic text evidence only. They do not
// scroll, measure a list, retain DOM after unmount, or claim that a native
// Selection can survive virtualization removing either endpoint.
export function describeContentTextPoint(block, textOffset) {
  const blockID = String(block?.dataset?.readingBlockId || '');
  if (!blockID) return null;
  return createContentTextPoint({ blockID, text: block.textContent || '', textOffset });
}

export function resolveContentTextPoint(root, value = {}) {
  const blocks = readingBlocks(root);
  const requestedID = String(value.blockID || '');
  const before = String(value.textBefore || '');
  const after = String(value.textAfter || '');
  const start = String(value.blockTextStart || '');
  const end = String(value.blockTextEnd || '');
  const context = `${before}${after}`;
  const hasEvidence = Boolean(start || end || context);
  const matchesEvidence = (candidate) => {
    const text = candidate.textContent || '';
    const fingerprint = Boolean(start || end)
      && (!start || text.startsWith(start))
      && (!end || text.endsWith(end));
    const contextual = Boolean(context) && text.includes(context);
    return fingerprint || contextual;
  };
  let block = blocks.find((candidate) => candidate.dataset.readingBlockId === requestedID) || null;
  let blockMatch = 'id';
  // A bounded plan cache can legitimately forget an old plan. A later fresh
  // plan may reuse an ordinal-looking ID for different text, so an ID whose
  // saved text evidence contradicts the current block is not trusted blindly.
  if (block && hasEvidence && !matchesEvidence(block)) block = null;
  if (!block) {
    const candidates = blocks.filter(matchesEvidence);
    if (candidates.length !== 1) return null;
    [block] = candidates;
    blockMatch = 'unique-fingerprint';
  }
  const resolved = resolveContentTextOffset(block.textContent || '', value);
  if (blockMatch !== 'id' && resolved.match === 'block-offset') return null;
  const boundary = domBoundaryAt(block, resolved.textOffset);
  return Object.freeze({
    block,
    node: boundary.node,
    offset: boundary.offset,
    textOffset: resolved.textOffset,
    blockMatch,
    textMatch: resolved.match,
  });
}

// Content remains inside its existing message row. This component owns only
// React sibling identity; it neither measures nor scrolls nor introduces a
// second virtualizer.
const ContentPlanBlock = React.memo(function ContentPlanBlock({ block, renderBlock }) {
  return (
    <div
      className="markdown-content-block"
      data-reading-block-id={block.blockID}
      data-reading-render-revision={block.renderRevision}
    >
      {renderBlock(block)}
    </div>
  );
}, (previous, next) => (
  previous.renderBlock === next.renderBlock
  && previous.block.blockID === next.block.blockID
  && previous.block.renderRevision === next.block.renderRevision
));

export function ContentPlanBlocks({ plan, renderBlock }) {
  if (!plan?.blocks?.length) return null;
  if (typeof renderBlock !== 'function') throw new TypeError('ContentPlanBlocks requires renderBlock');
  return plan.blocks.map((block) => (
    <ContentPlanBlock key={block.blockID} block={block} renderBlock={renderBlock} />
  ));
}
