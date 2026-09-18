import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

export const CONTENT_PARSER_REVISION = 'commonmark-gfm-math-breaks@1';
export const CONTENT_TEXT_CONTEXT = 48;

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkBreaks);

function sourceOf(source, node) {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return Number.isInteger(start) && Number.isInteger(end) ? source.slice(start, end) : '';
}

function semanticTextOf(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'image') return String(node.alt || '');
  if (typeof node.value === 'string') return node.value;
  if (!Array.isArray(node.children)) return '';
  return node.children.map(semanticTextOf).join('');
}

function preparedNodeBytes(node) {
  if (!node || typeof node !== 'object') return 0;
  // Include a conservative allowance for the node, its position points, and
  // object/GC bookkeeping; string payloads and child references are added
  // below. This is a retention weight, not a claim about engine heap layout.
  let bytes = 256;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'children' || key === 'position') continue;
    if (typeof value === 'string') bytes += value.length * 2;
  }
  if (Array.isArray(node.children)) {
    bytes += node.children.length * 8;
    for (const child of node.children) bytes += preparedNodeBytes(child);
  }
  return bytes;
}

function hasFootnoteNode(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'footnoteDefinition' || node.type === 'footnoteReference') return true;
  return Array.isArray(node.children) && node.children.some(hasFootnoteNode);
}

function signatureOf(block) {
  return `${block.kind}\u001f${block.source}`;
}

function neighborKey(signatures, index) {
  return `${signatures[index - 1] || '^'}\u001e${signatures[index]}\u001e${signatures[index + 1] || '$'}`;
}

function occurrences(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return counts;
}

function exactMatches(previous, next) {
  const previousSignatures = previous.map(signatureOf);
  const nextSignatures = next.map(signatureOf);
  const previousCounts = occurrences(previousSignatures);
  const nextCounts = occurrences(nextSignatures);
  const previousBySignature = new Map();
  previousSignatures.forEach((signature, index) => {
    const rows = previousBySignature.get(signature) || [];
    rows.push(index);
    previousBySignature.set(signature, rows);
  });
  const matched = new Map();
  const claimed = new Set();

  nextSignatures.forEach((signature, nextIndex) => {
    if (previousCounts.get(signature) !== 1 || nextCounts.get(signature) !== 1) return;
    const previousIndex = previousBySignature.get(signature)[0];
    matched.set(nextIndex, previousIndex);
    claimed.add(previousIndex);
  });

  // Repeated equal blocks are not identified by occurrence number: inserting
  // another equal block would silently transfer choices/selection. Preserve a
  // duplicate only when its immediate structural neighborhood is itself a
  // unique anchor in both plans; otherwise replacement is the honest result.
  const previousNeighborKeys = previousSignatures.map((_, index) => neighborKey(previousSignatures, index));
  const nextNeighborKeys = nextSignatures.map((_, index) => neighborKey(nextSignatures, index));
  const previousNeighborCounts = occurrences(previousNeighborKeys);
  const nextNeighborCounts = occurrences(nextNeighborKeys);
  const previousByNeighbor = new Map(previousNeighborKeys.map((key, index) => [key, index]));
  nextSignatures.forEach((signature, nextIndex) => {
    if (matched.has(nextIndex) || previousCounts.get(signature) !== nextCounts.get(signature)) return;
    const key = nextNeighborKeys[nextIndex];
    if (nextNeighborCounts.get(key) !== 1 || previousNeighborCounts.get(key) !== 1) return;
    const previousIndex = previousByNeighbor.get(key);
    if (previousIndex >= 0 && !claimed.has(previousIndex)) {
      matched.set(nextIndex, previousIndex);
      claimed.add(previousIndex);
    }
  });
  return { matched, claimed };
}

function matchGrowingTail(previous, next, matches) {
  const nextIndex = next.length - 1;
  if (nextIndex < 0 || matches.matched.has(nextIndex)) return;
  const candidates = previous
    .map((block, index) => ({ block, index }))
    .filter(({ block, index }) => (
      !matches.claimed.has(index)
      && block.state === 'active'
      && block.kind === next[nextIndex].kind
      && block.source
      && block.source !== next[nextIndex].source
      && next[nextIndex].source.startsWith(block.source)
    ));
  if (candidates.length !== 1) return;
  matches.matched.set(nextIndex, candidates[0].index);
  matches.claimed.add(candidates[0].index);
}

function sharedEdgeLength(left = '', right = '') {
  const length = Math.min(left.length, right.length);
  let prefix = 0;
  while (prefix < length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < length - prefix
    && left[left.length - suffix - 1] === right[right.length - suffix - 1]) suffix += 1;
  return prefix + suffix;
}

function editAffinity(previous, next) {
  if (previous.kind !== next.kind) return false;
  if (previous.semanticText && previous.semanticText === next.semanticText) return true;
  const shorter = Math.min(previous.source.length, next.source.length);
  if (!shorter) return false;
  const shared = sharedEdgeLength(previous.source, next.source);
  return shared >= Math.min(8, Math.max(2, Math.ceil(shorter / 4)));
}

function matchLocalEdits(previous, next, matches) {
  const proposals = new Map();
  next.forEach((candidate, nextIndex) => {
    if (matches.matched.has(nextIndex)) return;
    let lower = -1;
    let upper = previous.length;
    for (const [matchedNext, matchedPrevious] of matches.matched) {
      if (matchedNext < nextIndex) lower = Math.max(lower, matchedPrevious);
      if (matchedNext > nextIndex) upper = Math.min(upper, matchedPrevious);
    }
    if (lower >= upper) return;
    const candidates = previous
      .map((block, index) => ({ block, index }))
      .filter(({ block, index }) => (
        index > lower
        && index < upper
        && !matches.claimed.has(index)
        && editAffinity(block, candidate)
      ));
    if (candidates.length === 1) proposals.set(nextIndex, candidates[0].index);
  });
  const proposedCounts = occurrences([...proposals.values()]);
  for (const [nextIndex, previousIndex] of proposals) {
    if (proposedCounts.get(previousIndex) !== 1) continue;
    matches.matched.set(nextIndex, previousIndex);
    matches.claimed.add(previousIndex);
  }
}

function parseDocument(source, metrics, mode = 'full') {
  if (metrics) metrics.parseCount = (metrics.parseCount || 0) + 1;
  if (metrics) {
    metrics.parsedCharacters = (metrics.parsedCharacters || 0) + source.length;
    const countKey = mode === 'suffix' ? 'suffixParseCount' : 'fullParseCount';
    metrics[countKey] = (metrics[countKey] || 0) + 1;
  }
  return processor.runSync(processor.parse(source));
}

function blocksFromDocument(source, document, sourceOffset = 0) {
  const definitions = document.children.filter((node) => node.type === 'definition');
  const definitionSource = definitions.map((node) => sourceOf(source, node)).join('\n');
  const definitionBytes = definitions.reduce((total, node) => total + preparedNodeBytes(node), 0);
  // Correctness must not depend on a short hash: a collision here could keep
  // a stale reference URL alive. Strings are immutable and shared by the JS
  // engine, so the exact definition environment is the revision token.
  const dependencyRevision = definitionSource;
  return document.children
    .filter((node) => node.type !== 'definition')
    .map((node) => {
      const sourceBlock = sourceOf(source, node);
      const canPrepare = !hasFootnoteNode(node);
      return {
        kind: node.type,
        source: sourceBlock,
        semanticText: semanticTextOf(node),
        sourceRange: Object.freeze({
          start: (node.position?.start?.offset ?? 0) + sourceOffset,
          end: (node.position?.end?.offset ?? 0) + sourceOffset,
        }),
        // Definitions are document-global in CommonMark. Appending them to an
        // isolated top-level slice preserves reference semantics. A definition
        // edit conservatively invalidates every block; it never freezes stale
        // links merely to obtain a smaller update count.
        renderSource: definitionSource ? `${sourceBlock}\n\n${definitionSource}` : sourceBlock,
        dependencyRevision,
        // Footnote tokenization depends on the full-document definition set,
        // while the existing independent-block renderer intentionally does
        // not globalize footnotes. Keep those rare blocks on the string path
        // so this optimization cannot silently change their output.
        preparedRoot: canPrepare ? Object.freeze({
          type: 'root',
          children: Object.freeze([node, ...definitions]),
        }) : null,
        preparedBytes: canPrepare
          ? preparedNodeBytes(node) + definitionBytes + ((definitions.length + 1) * 8) + 256
          : 0,
      };
    });
}

function parsedBlocks(source, metrics) {
  return blocksFromDocument(source, parseDocument(source, metrics));
}

function hasMarkdownRestartBoundary(source, offset) {
  if (offset === 0) return true;
  let cursor = offset - 1;
  if (source[cursor] !== '\n') return false;
  cursor -= 1;
  while (cursor >= 0 && (source[cursor] === ' ' || source[cursor] === '\t' || source[cursor] === '\r')) cursor -= 1;
  return source[cursor] === '\n';
}

function appendSuffixBlocks(source, previous, metrics) {
  if (!previous?.source
    || !source.startsWith(previous.source)
    || source.length === previous.source.length
    || !previous.blocks.length) return null;

  // Reference definitions and footnotes have document-wide meaning. Keep
  // those documents on the full parser path rather than trying to recreate a
  // second dependency resolver for the suffix path.
  if (previous.blocks.some((block) => block.dependencyRevision || block.kind === 'footnoteDefinition')) return null;

  let restartIndex = previous.blocks.length - 1;
  while (restartIndex > 0
    && !hasMarkdownRestartBoundary(previous.source, previous.blocks[restartIndex].sourceRange.start)) restartIndex -= 1;
  const restartBlock = previous.blocks[restartIndex];
  const reparseStart = restartBlock?.sourceRange?.start;
  if (!Number.isInteger(reparseStart)
    || reparseStart < 0
    || reparseStart >= previous.source.length
    || restartBlock.source !== previous.source.slice(restartBlock.sourceRange.start, restartBlock.sourceRange.end)
    || previous.blocks.slice(0, restartIndex).some((block) => block.sourceRange.end > reparseStart)) return null;

  const suffixSource = source.slice(reparseStart);
  const suffixDocument = parseDocument(suffixSource, metrics, 'suffix');
  if (suffixDocument.children.some((node) => node.type === 'definition' || node.type === 'footnoteDefinition')) return null;

  const suffixBlocks = blocksFromDocument(suffixSource, suffixDocument, reparseStart);
  if (!suffixBlocks.length || suffixBlocks[0].sourceRange.start !== reparseStart) return null;

  // A Markdown append can only keep or extend the final open top-level block.
  // Restart at its nearest blank-line boundary because interrupt rules (for
  // example an empty list marker following a paragraph) can also depend on
  // the immediately preceding, non-blank-separated block.
  return [...previous.blocks.slice(0, restartIndex), ...suffixBlocks];
}

function freezePlan(plan) {
  for (const block of plan.blocks) Object.freeze(block);
  Object.freeze(plan.blocks);
  Object.freeze(plan.changes.inserted);
  Object.freeze(plan.changes.updated);
  Object.freeze(plan.changes.replaced);
  Object.freeze(plan.changes.removed);
  Object.freeze(plan.changes);
  return Object.freeze(plan);
}

export function createContentPlan({
  contentKey,
  source = '',
  previous = null,
  parserRevision = CONTENT_PARSER_REVISION,
  metrics = null,
}) {
  if (!contentKey) throw new TypeError('ContentPlan requires a stable contentKey');
  if (previous?.contentKey === contentKey && previous.source === source && previous.parserRevision === parserRevision) return previous;

  const canReusePrevious = previous?.contentKey === contentKey && previous.parserRevision === parserRevision;
  const parsed = (canReusePrevious && appendSuffixBlocks(source, previous, metrics)) || parsedBlocks(source, metrics);
  const oldBlocks = canReusePrevious ? previous.blocks : [];
  const matches = exactMatches(oldBlocks, parsed);
  matchLocalEdits(oldBlocks, parsed, matches);
  matchGrowingTail(oldBlocks, parsed, matches);
  let nextSerial = previous?.contentKey === contentKey ? previous.nextSerial : 1;
  const inserted = [];
  const updated = [];
  const replaced = [];
  const blocks = parsed.map((candidate, index) => {
    const previousIndex = matches.matched.get(index);
    const old = Number.isInteger(previousIndex) ? oldBlocks[previousIndex] : null;
    const blockID = old?.blockID || `${contentKey}:b${nextSerial++}`;
    const state = index === parsed.length - 1 ? 'active' : 'sealed';
    const renderUnchanged = old
      && old.source === candidate.source
      && old.dependencyRevision === candidate.dependencyRevision;
    const renderRevision = renderUnchanged ? old.renderRevision : (old?.renderRevision || 0) + 1;
    if (!old) {
      inserted.push(blockID);
      if (oldBlocks[index] && !matches.claimed.has(index)) replaced.push(Object.freeze({ old: oldBlocks[index].blockID, next: blockID }));
    } else if (old.renderRevision !== renderRevision || old.state !== state) {
      updated.push(blockID);
    }
    return {
      ...candidate,
      blockID,
      state,
      renderRevision,
    };
  });
  const removed = oldBlocks.filter((_, index) => !matches.claimed.has(index)).map((block) => block.blockID);
  return freezePlan({
    contentKey,
    source,
    parserRevision,
    revision: (previous?.contentKey === contentKey ? previous.revision : 0) + 1,
    nextSerial,
    blocks,
    preparedBytes: blocks.reduce((total, block) => total + (block.preparedBytes || 0), 0),
    changes: { inserted, updated, replaced, removed },
  });
}

function normalizedTextPoint(value = {}) {
  return {
    blockID: String(value.blockID || ''),
    textOffset: Math.max(0, Number(value.textOffset) || 0),
    textBefore: String(value.textBefore || '').slice(-64),
    textAfter: String(value.textAfter || '').slice(0, 64),
    blockTextStart: String(value.blockTextStart || '').slice(0, 96),
    blockTextEnd: String(value.blockTextEnd || '').slice(-96),
  };
}

export function createContentTextPoint({ blockID, text = '', textOffset = 0 } = {}) {
  if (!blockID) throw new TypeError('Content text point requires blockID');
  const content = String(text || '');
  const offset = Math.min(content.length, Math.max(0, Number(textOffset) || 0));
  return Object.freeze({
    blockID: String(blockID),
    textOffset: offset,
    textBefore: content.slice(Math.max(0, offset - CONTENT_TEXT_CONTEXT), offset),
    textAfter: content.slice(offset, offset + CONTENT_TEXT_CONTEXT),
    blockTextStart: content.slice(0, 96),
    blockTextEnd: content.slice(-96),
  });
}

function boundaryScore(text, offset, point) {
  let before = 0;
  const beforeLimit = Math.min(offset, point.textBefore.length);
  while (before < beforeLimit
    && text[offset - before - 1] === point.textBefore[point.textBefore.length - before - 1]) before += 1;
  let after = 0;
  const afterLimit = Math.min(text.length - offset, point.textAfter.length);
  while (after < afterLimit && text[offset + after] === point.textAfter[after]) after += 1;
  return { before, after, score: before + after };
}

function candidateOffsets(text, point) {
  const offsets = new Set([Math.min(text.length, point.textOffset)]);
  const addOccurrences = (needle, offsetOf) => {
    if (!needle) return;
    let from = 0;
    let count = 0;
    while (from <= text.length) {
      const found = text.indexOf(needle, from);
      if (found < 0) break;
      offsets.add(offsetOf(found));
      count += 1;
      if (count >= 512) break;
      from = found + Math.max(1, needle.length);
    }
  };
  const before = point.textBefore;
  const after = point.textAfter;
  for (const length of [48, 32, 24, 16, 12, 8, 4]) {
    if (before.length >= length) {
      const fragment = before.slice(-length);
      addOccurrences(fragment, (found) => found + fragment.length);
      break;
    }
  }
  for (const length of [48, 32, 24, 16, 12, 8, 4]) {
    if (after.length >= length) {
      addOccurrences(after.slice(0, length), (found) => found);
      break;
    }
  }
  return [...offsets];
}

export function resolveContentTextOffset(text, value = {}) {
  const content = String(text || '');
  const point = normalizedTextPoint(value);
  const original = Math.min(content.length, point.textOffset);
  const direct = boundaryScore(content, original, point);
  const expected = point.textBefore.length + point.textAfter.length;
  if (direct.score === expected) {
    return Object.freeze({ textOffset: original, match: 'exact' });
  }
  const ranked = candidateOffsets(content, point)
    .map((textOffset) => ({ textOffset, ...boundaryScore(content, textOffset, point) }))
    .sort((left, right) => right.score - left.score || Math.abs(left.textOffset - original) - Math.abs(right.textOffset - original));
  const best = ranked[0];
  const minimum = Math.min(8, Math.max(1, Math.min(point.textBefore.length || Infinity, point.textAfter.length || Infinity)));
  const tied = ranked.filter((candidate) => candidate.score === best?.score);
  if (best && best.score >= minimum && tied.length === 1) {
    return Object.freeze({ textOffset: best.textOffset, match: 'context' });
  }
  // A stable block identity is still useful when its nearby text was wholly
  // rewritten. The caller can distinguish this documented coarse fallback
  // from an exact/context match and must not present it as semantic recovery.
  return Object.freeze({ textOffset: original, match: 'block-offset' });
}

function withoutPreparedTrees(plan) {
  if (!plan?.preparedBytes) return plan;
  const blocks = plan.blocks.map((block) => {
    const { preparedRoot: _preparedRoot, preparedBytes: _preparedBytes, ...durable } = block;
    return durable;
  });
  return freezePlan({ ...plan, blocks, preparedBytes: 0 });
}

export function createContentPlanStore({ limit = 128, preparedByteLimit = Number.POSITIVE_INFINITY } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('ContentPlan store limit must be a positive integer');
  if (!(preparedByteLimit >= 0)) throw new RangeError('ContentPlan prepared byte limit must be non-negative');
  const plans = new Map();
  // React StrictMode deliberately invokes render-phase memo calculators twice.
  // Keep exact, unpublished candidates separate from committed identity so the
  // replay can reuse immutable parser output without making an abandoned
  // source the previous plan for a later edit.
  const candidates = new Map();
  let preparedBytes = 0;
  let candidatePreparedBytes = 0;
  const forgetCandidate = (contentKey) => {
    const record = candidates.get(contentKey);
    if (!record) return false;
    candidatePreparedBytes -= record.plan.preparedBytes || 0;
    return candidates.delete(contentKey);
  };
  const retainCandidate = (contentKey, plan, previous) => {
    forgetCandidate(contentKey);
    candidates.set(contentKey, { plan, previous });
    candidatePreparedBytes += plan.preparedBytes || 0;
    while (candidates.size > limit || candidatePreparedBytes > preparedByteLimit) {
      const oldestKey = candidates.keys().next().value;
      forgetCandidate(oldestKey);
    }
    return plan;
  };
  const retain = (contentKey, plan) => {
    preparedBytes -= plans.get(contentKey)?.preparedBytes || 0;
    plans.delete(contentKey);
    plans.set(contentKey, plan);
    preparedBytes += plan.preparedBytes || 0;
    while (plans.size > limit) {
      const oldestKey = plans.keys().next().value;
      preparedBytes -= plans.get(oldestKey)?.preparedBytes || 0;
      plans.delete(oldestKey);
    }
    if (preparedBytes > preparedByteLimit) {
      for (const [key, retained] of plans) {
        if (!retained.preparedBytes) continue;
        const durable = withoutPreparedTrees(retained);
        plans.set(key, durable);
        preparedBytes -= retained.preparedBytes;
        if (preparedBytes <= preparedByteLimit) break;
      }
    }
    return plans.get(contentKey) || plan;
  };
  return {
    prepare(contentKey, source, options = {}) {
      const parserRevision = options.parserRevision || CONTENT_PARSER_REVISION;
      const committed = plans.get(contentKey) || null;
      const previous = Object.hasOwn(options, 'previous') ? options.previous : committed;
      if (previous?.source === source && previous.parserRevision === parserRevision) return previous;
      const record = candidates.get(contentKey) || null;
      const candidate = record?.plan || null;
      if (record?.previous === previous
        && candidate.source === source
        && candidate.parserRevision === parserRevision) {
        // Touch the exact candidate so interleaved sibling renders cannot
        // evict the StrictMode replay that is about to consume it.
        forgetCandidate(contentKey);
        candidates.set(contentKey, record);
        candidatePreparedBytes += candidate.preparedBytes || 0;
        return candidate;
      }
      const { previous: _previous, ...planOptions } = options;
      return retainCandidate(contentKey, createContentPlan({
        contentKey,
        source,
        previous,
        ...planOptions,
        parserRevision,
      }), previous);
    },
    plan(contentKey, source, options = {}) {
      const previous = plans.get(contentKey) || null;
      const next = createContentPlan({ contentKey, source, previous, ...options });
      return retain(contentKey, next);
    },
    // React render may be interrupted. Callers can prepare an immutable plan
    // without publishing it, then retain exactly that plan from a layout
    // effect once the corresponding DOM commit exists.
    commit(plan) {
      if (!plan?.contentKey || !Object.isFrozen(plan)) throw new TypeError('ContentPlan store commit requires a frozen plan');
      if (candidates.get(plan.contentKey)?.plan === plan) forgetCandidate(plan.contentKey);
      return retain(plan.contentKey, plan);
    },
    get(contentKey) {
      return plans.get(contentKey) || null;
    },
    delete(contentKey) {
      forgetCandidate(contentKey);
      preparedBytes -= plans.get(contentKey)?.preparedBytes || 0;
      return plans.delete(contentKey);
    },
    clear() {
      plans.clear();
      candidates.clear();
      preparedBytes = 0;
      candidatePreparedBytes = 0;
    },
    get size() {
      return plans.size;
    },
    get preparedBytes() {
      return preparedBytes;
    },
  };
}
