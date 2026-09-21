import { describe, expect, it } from 'vitest';
import {
  createContentPlan,
  createContentPlanStore,
  createContentTextPoint,
  resolveContentTextOffset,
} from '../src/model/content-plan.js';

function plan(input) {
  return createContentPlan(input);
}

function parserProjection(contentPlan) {
  return contentPlan.blocks.map(({
    kind,
    source,
    semanticText,
    sourceRange,
    renderSource,
    dependencyRevision,
  }) => ({
    kind,
    source,
    semanticText,
    sourceRange,
    renderSource,
    dependencyRevision,
  }));
}

describe('ContentPlan', () => {
  it('[TC-0527][AD-233] keeps unique surviving block ids and never duplicates ids for repeated content', () => {
    const first = plan({ contentKey: 'message:m1:body', source: 'alpha\n\nrepeat\n\nrepeat\n\nomega' });
    expect(new Set(first.blocks.map((block) => block.blockID)).size).toBe(first.blocks.length);

    const next = plan({
      contentKey: 'message:m1:body',
      source: 'prefix\n\nalpha\n\nrepeat\n\nrepeat\n\nomega',
      previous: first,
    });
    expect(new Set(next.blocks.map((block) => block.blockID)).size).toBe(next.blocks.length);
    expect(next.blocks.find((block) => block.source === 'alpha').blockID)
      .toBe(first.blocks.find((block) => block.source === 'alpha').blockID);
    expect(next.blocks.find((block) => block.source === 'omega').blockID)
      .toBe(first.blocks.find((block) => block.source === 'omega').blockID);
  });

  it('[TC-0528][AD-234] treats ambiguous duplicate insertion as replacement instead of transferring identity', () => {
    const first = plan({ contentKey: 'message:m2:body', source: 'same\n\nsame' });
    const next = plan({ contentKey: 'message:m2:body', source: 'same\n\nsame\n\nsame', previous: first });
    const oldIDs = new Set(first.blocks.map((block) => block.blockID));
    expect(next.blocks.every((block) => !oldIDs.has(block.blockID))).toBe(true);
    expect(next.changes.removed).toHaveLength(2);
    expect(new Set(next.blocks.map((block) => block.blockID)).size).toBe(3);
  });

  it('[TC-0529][AD-235] keeps one unambiguous growing active tail id while sealed prefix revisions stay fixed', () => {
    const first = plan({ contentKey: 'message:m3:body', source: 'sealed\n\nactive' });
    const next = plan({ contentKey: 'message:m3:body', source: 'sealed\n\nactive grows', previous: first });
    expect(next.blocks[0]).toMatchObject({
      blockID: first.blocks[0].blockID,
      renderRevision: first.blocks[0].renderRevision,
      state: 'sealed',
    });
    expect(next.blocks[1].blockID).toBe(first.blocks[1].blockID);
    expect(next.blocks[1].renderRevision).not.toBe(first.blocks[1].renderRevision);
  });

  it('[TC-0530][AD-236] keeps an unambiguous locally edited block identity but replaces ambiguous edits', () => {
    const first = plan({
      contentKey: 'message:local-edit:body',
      source: 'fixed before\n\nkeep these words\n\nfixed after',
    });
    const formatted = plan({
      contentKey: 'message:local-edit:body',
      source: 'fixed before\n\n**keep these words**\n\nfixed after',
      previous: first,
    });
    expect(formatted.blocks[1].blockID).toBe(first.blocks[1].blockID);
    expect(formatted.blocks[1].renderRevision).toBe(first.blocks[1].renderRevision + 1);

    const duplicates = plan({ contentKey: 'message:ambiguous-edit:body', source: 'same old\n\nsame old' });
    const ambiguous = plan({
      contentKey: 'message:ambiguous-edit:body',
      source: 'same edited\n\nsame edited',
      previous: duplicates,
    });
    const oldIDs = new Set(duplicates.blocks.map((block) => block.blockID));
    expect(ambiguous.blocks.every((block) => !oldIDs.has(block.blockID))).toBe(true);
  });

  it('[TC-0531][AD-237] expands invalidation for document-wide reference definitions without changing text identity', () => {
    const first = plan({ contentKey: 'message:m4:body', source: '[link][ref]\n\nplain\n\n[ref]: https://one.example' });
    const next = plan({ contentKey: 'message:m4:body', source: '[link][ref]\n\nplain\n\n[ref]: https://two.example', previous: first });
    expect(next.blocks.map((block) => block.blockID)).toEqual(first.blocks.map((block) => block.blockID));
    expect(next.blocks.every((block, index) => block.renderRevision !== first.blocks[index].renderRevision)).toBe(true);
    expect(next.blocks[0].renderSource).toContain('https://two.example');
  });

  it('keeps unclosed fence/list semantics atomic instead of splitting lines independently', () => {
    const fence = plan({ contentKey: 'message:m5:fence', source: 'before\n\n```js\nconst x = 1;\nstill code' });
    expect(fence.blocks.map((block) => block.kind)).toEqual(['paragraph', 'code']);
    expect(fence.blocks[1].source).toContain('still code');

    const list = plan({ contentKey: 'message:m5:list', source: '- first\n  continuation\n- second' });
    expect(list.blocks).toHaveLength(1);
    expect(list.blocks[0].kind).toBe('list');
  });

  it('persists plans across unmount-like release and bounds retained sources', () => {
    const store = createContentPlanStore({ limit: 2 });
    const first = store.plan('a', 'one\n\ntwo');
    expect(store.plan('a', 'one\n\ntwo')).toBe(first);
    store.plan('b', 'b');
    store.plan('c', 'c');
    expect(store.get('a')).toBeNull();
    expect(store.size).toBe(2);
  });

  it('does not publish a prepared render candidate before its commit boundary', () => {
    const store = createContentPlanStore({ limit: 2 });
    const prepared = createContentPlan({ contentKey: 'candidate', source: 'not committed yet' });
    expect(store.get('candidate')).toBeNull();
    store.commit(prepared);
    expect(store.get('candidate')).toBe(prepared);
  });

  it('reuses an exact unpublished render candidate without exposing it as committed identity', () => {
    const store = createContentPlanStore({ limit: 2 });
    const metrics = {};
    const first = store.prepare('strict-candidate', 'one\n\ntwo', { metrics });
    const replay = store.prepare('strict-candidate', 'one\n\ntwo', { metrics });
    expect(replay).toBe(first);
    expect(metrics.parseCount).toBe(1);
    expect(store.get('strict-candidate')).toBeNull();

    store.commit(replay);
    expect(store.get('strict-candidate')).toBe(first);
  });

  it('never treats a different abandoned candidate as committed previous identity', () => {
    const store = createContentPlanStore({ limit: 2 });
    const abandoned = store.prepare('concurrent-candidate', 'abandoned');
    const replacement = store.prepare('concurrent-candidate', 'replacement');
    expect(abandoned.revision).toBe(1);
    expect(replacement.revision).toBe(1);
    expect(store.get('concurrent-candidate')).toBeNull();
  });

  it('bounds prepared AST retention by bytes without discarding durable block identity', () => {
    const store = createContentPlanStore({ limit: 4, preparedByteLimit: 1 });
    const committed = createContentPlan({ contentKey: 'bounded-prepared', source: 'one\n\ntwo' });
    const first = store.commit(committed);
    expect(committed.preparedBytes).toBeGreaterThan(0);
    expect(committed.blocks.every((block) => block.preparedRoot)).toBe(true);
    expect(first.preparedBytes).toBe(0);
    expect(first.blocks.every((block) => block.preparedRoot === undefined)).toBe(true);
    expect(store.preparedBytes).toBe(0);

    const restored = store.plan('bounded-prepared', 'one\n\ntwo');
    expect(restored.blocks.map((block) => block.blockID)).toEqual(first.blocks.map((block) => block.blockID));
    expect(restored).toBe(first);
  });

  it('accounts prepared bytes when a retained plan is deleted', () => {
    const store = createContentPlanStore({ limit: 2, preparedByteLimit: 1024 * 1024 });
    store.plan('delete-prepared', 'retained prepared tree');
    expect(store.preparedBytes).toBeGreaterThan(0);
    store.delete('delete-prepared');
    expect(store.preparedBytes).toBe(0);
  });

  it('reports honest parser work while making unchanged publication a no-op', () => {
    const metrics = {};
    const first = plan({ contentKey: 'message:m6:body', source: 'one\n\ntwo', metrics });
    const same = plan({ contentKey: 'message:m6:body', source: 'one\n\ntwo', previous: first, metrics });
    const appended = plan({ contentKey: 'message:m6:body', source: 'one\n\ntwo more', previous: same, metrics });
    expect(same).toBe(first);
    expect(metrics.parseCount).toBe(2);
    expect(appended.blocks[0].renderRevision).toBe(first.blocks[0].renderRevision);
  });

  it('reparses only the final top-level suffix for a strict append', () => {
    const prefix = Array.from({ length: 80 }, (_, index) => `## Section ${index}\n\nparagraph ${index}`)
      .join('\n\n');
    const first = plan({ contentKey: 'message:suffix-fast-path:body', source: prefix });
    const metrics = {};
    const source = `${prefix}\n\nnew streamed paragraph`;
    const appended = plan({
      contentKey: 'message:suffix-fast-path:body',
      source,
      previous: first,
      metrics,
    });
    const full = plan({ contentKey: 'message:suffix-fast-path:full', source });

    expect(parserProjection(appended)).toEqual(parserProjection(full));
    expect(metrics).toMatchObject({ parseCount: 1, suffixParseCount: 1 });
    expect(metrics.fullParseCount).toBeUndefined();
    expect(metrics.parsedCharacters).toBeLessThan(source.length / 10);
    expect(appended.blocks[0].blockID).toBe(first.blocks[0].blockID);
  });

  it('falls back to a full parse when an append introduces a document-wide definition', () => {
    const first = plan({
      contentKey: 'message:suffix-definition:body',
      source: 'prefix\n\n[reference][target]',
    });
    const metrics = {};
    const source = `${first.source}\n\n[target]: https://example.test`;
    const appended = plan({
      contentKey: 'message:suffix-definition:body',
      source,
      previous: first,
      metrics,
    });
    const full = plan({ contentKey: 'message:suffix-definition:full', source });

    expect(parserProjection(appended)).toEqual(parserProjection(full));
    expect(metrics.suffixParseCount).toBe(1);
    expect(metrics.fullParseCount).toBe(1);
    expect(appended.blocks[0].renderSource).toContain('[target]: https://example.test');
  });

  it('keeps suffix parsing byte-for-byte equivalent to full parsing across streamed constructs', () => {
    const chunks = [
      '# Heading',
      '\n\nA paragraph',
      ' growing **bold**',
      '\n\n- list one',
      '\n- list two',
      '\n\n```js\nconst answer = 4',
      '2;\n```',
      '\n\n| A | B |\n| - | - |\n| 1 | 2 |',
      '\n\n> quote',
      '\n> continued',
      '\n\nInline $x^2$ math.',
      '\n\n<div>raw html</div>',
    ];
    let source = '';
    let incremental = null;
    for (const chunk of chunks) {
      source += chunk;
      incremental = plan({ contentKey: 'message:suffix-corpus:body', source, previous: incremental });
      const full = plan({ contentKey: 'message:suffix-corpus:full', source });
      expect(parserProjection(incremental)).toEqual(parserProjection(full));
    }
  });

  it('differentially matches full parsing for deterministic append fuzz', () => {
    const fragments = [
      'word', ' ', '\n', '\n\n', '*', '**', '`', '```', '-', '> ', '# ',
      '[label](https://example.test)', '| cell |', '$x$', '<span>', '</span>',
    ];
    let seed = 0x5eed1234;
    let source = '';
    let incremental = null;
    for (let index = 0; index < 64; index += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      source += fragments[seed % fragments.length];
      incremental = plan({ contentKey: 'message:suffix-fuzz:body', source, previous: incremental });
      const full = plan({ contentKey: 'message:suffix-fuzz:full', source });
      expect(parserProjection(incremental), `append ${index}: ${JSON.stringify(source)}`)
        .toEqual(parserProjection(full));
    }
  });

  it('resolves a saved text point by context after text is inserted before it', () => {
    const text = 'alpha beta target gamma omega';
    const point = createContentTextPoint({
      blockID: 'block:1',
      text,
      textOffset: text.indexOf('target'),
    });
    const changed = `new prefix ${text}`;
    expect(resolveContentTextOffset(changed, point)).toEqual({
      textOffset: changed.indexOf('target'),
      match: 'context',
    });
  });

  it('reports a coarse block-offset fallback rather than guessing between repeated contexts', () => {
    const point = createContentTextPoint({ blockID: 'block:1', text: 'before target after', textOffset: 7 });
    expect(resolveContentTextOffset('completely rewritten', point)).toEqual({
      textOffset: 7,
      match: 'block-offset',
    });
  });
});
