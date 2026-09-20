import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative) => readFileSync(resolve(process.cwd(), relative), 'utf8');

/*
 * TC0216's sparse-page proof is allowed to remove the geometry-anchor
 * requirement, but it is not allowed to remove the lifecycle owner. This
 * contract test keeps the exact-lineage and fail-stop boundary reviewable
 * without exporting a private ref or adding a second product owner.
 *
 * This is a source-boundary test because the continuation is an ephemeral
 * private ref.  The user-visible browser contract remains the existing
 * TC0216 test; this test makes the safety boundary reviewable without adding
 * a private export or a second product owner.
 */
describe('TC0216 sparse top continuation exact lineage contract', () => {
  const consumer = () => read('src/ui/timeline/useHistoryConsumer.js');

  it('retains the sparse physical-page proof independently of geometry', () => {
    const source = consumer();
    expect(source).toMatch(/firstVisibleSeq/);
    expect(source).toMatch(/continuationAnchorID/);
    expect(source).toMatch(/continuationAnchorSeq/);
    expect(source).toMatch(/rows\[0\]\??\.?id/);
    expect(source).toMatch(/rows\[0\]\??\.?seqLow/);
    expect(source).toMatch(/firstVisibleSeq[\s\S]{0,180}(?:===|==)[\s\S]{0,120}(?:first\.)?seqLow/);
    expect(source).toMatch(/continuationAnchorID\s*:\s*first\?\.id/);
    expect(source).toMatch(/continuationAnchorSeq\s*:\s*Number\(first\?\.seqLow/);
  });

  it('requires every exact continuation lineage field, never a monotonic substitute', () => {
    const source = consumer();
    const settlementGate = source.match(
      /const sameExactLineage = [\s\S]*?const continueTop =/,
    )?.[0] || '';
    expect(settlementGate, 'exact sparse continuation settlement gate is missing').not.toBe('');

    const continuationObject = source.match(
      /const continuation = \{[\s\S]*?\n\s*\};/,
    )?.[0] || '';
    expect(continuationObject, 'continuation token construction is missing').not.toBe('');

    // The first six fields already exist in the ordinary owner tuple.  The
    // latter three are the missing physical/lifecycle identity that prevents a
    // new gesture or remounted/hidden root from inheriting an old timer.
    const fieldNames = [
      'controller', 'activationID', 'channelID', 'viewKey', 'inputEpoch',
      'intentRevision', 'gestureID', 'rootIdentity', 'visibilityEpoch',
    ];
    for (const field of fieldNames) {
      expect(continuationObject, `continuation token lacks ${field} lineage`)
        .toMatch(new RegExp(`(?:^|[,{\\s])${field}\\s*:`));
    }

    const exactField = (field) => new RegExp(
      `continuation(?:\\.lineage)?\\.${field}\\s*===`,
    );
    const insertionGate = source.match(
      /const sameIntent = [\s\S]*?\n\s*if \(!sameIntent\)/,
    )?.[0] || '';
    expect(insertionGate, 'continuation insertion gate is missing').not.toBe('');
    for (const field of fieldNames) {
      expect(insertionGate, `insertion gate lacks exact ${field} lineage`)
        .toMatch(exactField(field));
      expect(settlementGate, `settlement gate lacks exact ${field} lineage`)
        .toMatch(new RegExp(`boundary\\.${field}\\s*===`));
    }

    const timerGate = source.match(
      /const sameOlderIntent = [\s\S]*?\n\s*const ownerAnchorReady/,
    )?.[0] || '';
    expect(timerGate, 'continuation timer gate is missing').not.toBe('');
    for (const field of fieldNames) {
      expect(timerGate, `timer gate lacks exact ${field} lineage`)
        .toMatch(exactField(field));
    }

    // A new epoch/revision is a new input or lifecycle boundary.  It must
    // fail-stop; >=/<= would let an old sparse timer adopt that boundary.
    expect(settlementGate).not.toMatch(/inputEpoch[^\n]*(?:>=|<=)/);
    expect(settlementGate).not.toMatch(/intentRevision[^\n]*(?:>=|<=)/);
  });

  it('clears the timer and boundary on any lineage mismatch so the next input reissues', () => {
    const source = consumer();
    expect(source).toMatch(/if \(!sameIntent\)[\s\S]*?clearTopContinuation\(topContinuationRef\)/);
    expect(source).toMatch(/topBoundaryRef\.current\s*=\s*null/);
    expect(source).toMatch(/position-anchor-missing/);
    expect(source).toMatch(/continuation(?:\.lineage)?\.(?:gestureID|rootIdentity|visibilityEpoch)/);
  });

  it('threads visibility/root observations from the existing Reading owner and reissues a clamped top input', () => {
    const projection = read('src/ui/timeline/useConversationProjection.js');
    expect(projection).toMatch(/visibilityBoundaryRef = useRef\([\s\S]*?visibilityEpoch:\s*0/);
    expect(projection).toMatch(/const nextEffective = boundary\.documentVisible && boundary\.surfaceVisible;[\s\S]*?boundary\.visibilityEpoch \+= 1/);
    expect(projection).toMatch(/getContinuationLineage = useCallback\([\s\S]*?rootIdentity[\s\S]*?visibilityEpoch/);
    expect(projection).toMatch(/useHistoryConsumer\([\s\S]*?getContinuationLineage,[\s\S]*?continuationLineage,/);

    const vendor = read('src/ui/timeline/VendorListExecutor.jsx');
    expect(vendor).toMatch(/const atTop = root\.scrollTop <= 1/);
    expect(vendor).toMatch(/direction === 'older' && atTop[\s\S]*?type: 'scroll-position'[\s\S]*?atTop: true/);
  });
});
