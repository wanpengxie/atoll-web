import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  consumeLatestIntent,
  createReadingSession,
  observeReading,
  READING_MODE,
  requestLatest,
  takeReadingControl,
} from '../src/model/reading-session.js';
import { createConversationPresentation } from '../src/model/conversation-presentation.js';
import { createViewSessionStore } from '../src/model/view-session.js';

const eventArb = fc.oneof(
  fc.record({ type: fc.constant('prepend'), count: fc.integer({ min: 1, max: 5 }) }),
  fc.record({ type: fc.constant('append'), count: fc.integer({ min: 1, max: 5 }) }),
  fc.record({ type: fc.constant('layout-tail'), revision: fc.nat({ max: 1000 }) }),
  fc.record({ type: fc.constant('user-older') }),
  fc.record({ type: fc.constant('user-newer-tail') }),
  fc.record({ type: fc.constant('latest') }),
  fc.record({ type: fc.constant('consume-latest'), stale: fc.boolean() }),
);

const entry = (seq) => ({
  kind: 'standalone', seq,
  envelope: { id: `m-${seq}`, seq, ts: seq * 1000, sender: { id: 'agent' }, payload: { text: `message ${seq}` } },
});

function commitProjection(owner, entries, options) {
  const candidate = owner.evaluate(entries, options);
  expect(owner.commitCandidate(candidate)).toBe(true);
  return candidate.snapshot;
}

describe('conversation UX state-machine fuzz', () => {
  it('keeps data/layout events powerless over reading intent and keeps semantic rows unique', () => {
    fc.assert(fc.property(fc.array(eventArb, { minLength: 1, maxLength: 240 }), (events) => {
      let reading = createReadingSession({ key: 'c0:all', activationID: 'active' });
      let low = 0;
      let high = 20;
      let entries = Array.from({ length: 20 }, (_, index) => entry(index + 1));
      let sourceRevision = 1;
      const presentation = createConversationPresentation();
      let snapshot = commitProjection(presentation, entries, {
        nextViewID: 'c0:all', epoch: 'p:w', sourceRevision,
      });

      for (const event of events) {
        const beforeMode = reading.mode;
        const beforeInput = reading.inputEpoch;
        if (event.type === 'prepend') {
          const older = Array.from({ length: event.count }, () => entry(--low));
          entries = [...older.reverse(), ...entries];
          sourceRevision += 1;
          snapshot = commitProjection(presentation, entries, {
            nextViewID: 'c0:all', epoch: 'p:w', sourceRevision,
          });
          expect(reading.mode).toBe(beforeMode);
          expect(reading.inputEpoch).toBe(beforeInput);
        } else if (event.type === 'append') {
          entries = [...entries, ...Array.from({ length: event.count }, () => entry(++high))];
          sourceRevision += 1;
          snapshot = commitProjection(presentation, entries, {
            nextViewID: 'c0:all', epoch: 'p:w', sourceRevision,
          });
          expect(reading.mode).toBe(beforeMode);
          expect(reading.inputEpoch).toBe(beforeInput);
        } else if (event.type === 'layout-tail') {
          reading = observeReading(reading, {
            activationID: 'active', atTail: true, source: 'layout',
            geometryRevision: event.revision, inputEpoch: reading.inputEpoch,
          });
          expect(reading.mode).toBe(beforeMode);
          expect(reading.inputEpoch).toBe(beforeInput);
        } else if (event.type === 'user-older') {
          reading = takeReadingControl(reading, { direction: 'older', gestureID: `up-${sourceRevision}` });
          expect(reading.mode).toBe(READING_MODE.browsing);
          expect(reading.bottomIntent.id).toBe('');
        } else if (event.type === 'user-newer-tail') {
          reading = takeReadingControl(reading, {
            direction: 'newer',
            gestureID: `down-${sourceRevision}`,
            geometryRevision: sourceRevision,
          });
          reading = observeReading(reading, {
            activationID: 'active', atTail: true, source: 'user',
            geometryRevision: sourceRevision, inputEpoch: reading.inputEpoch,
          });
          expect(reading.mode).toBe(READING_MODE.following);
        } else if (event.type === 'latest') {
          reading = requestLatest(reading, `latest-${sourceRevision}`);
          expect(reading.mode).toBe(READING_MODE.following);
        } else if (event.type === 'consume-latest') {
          const before = reading;
          reading = consumeLatestIntent(reading, {
            id: reading.bottomIntent.id,
            inputEpoch: reading.bottomIntent.inputEpoch,
            activationID: event.stale ? 'stale' : 'active',
          });
          if (event.stale || !before.bottomIntent.id) expect(reading).toBe(before);
          else expect(reading.bottomIntent.id).toBe('');
        }

        expect(new Set(snapshot.orderedIDs).size).toBe(snapshot.orderedIDs.length);
        expect(snapshot.rows.map((row) => row.id)).toEqual(snapshot.orderedIDs);
        for (const row of snapshot.rows) expect(snapshot.entities.get(row.id)).toBe(row);
      }
    }), { numRuns: 400 });
  });

  it('keeps the newest A→B→A activation authoritative under arbitrary stale saves', () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        view: fc.constantFrom('mine', 'all', 'agent:a'),
        message: fc.integer({ min: 1, max: 500 }),
        staleAttempt: fc.boolean(),
      }), { minLength: 1, maxLength: 120 }),
      (steps) => {
        const values = new Map();
        const storage = {
          getItem: (key) => values.get(key) || null,
          setItem: (key, value) => values.set(key, value),
        };
        const store = createViewSessionStore({ principalID: 'root', storage });
        const prior = new Map();
        steps.forEach((step, index) => {
          const activationID = `activation-${index}`;
          const saved = store.activate('c0', step.view, activationID);
          const stale = prior.get(step.view);
          if (step.staleAttempt && stale) {
            expect(store.save('c0', step.view, stale.id, stale.revision, {
              mode: READING_MODE.browsing,
              bookmark: { messageID: `stale-${index}` },
            })).toBe(false);
          }
          expect(store.save('c0', step.view, activationID, saved.revision, {
            mode: READING_MODE.browsing,
            bookmark: { messageID: `m-${step.message}` },
          })).toBe(true);
          expect(store.readView('c0', step.view).bookmark.messageID).toBe(`m-${step.message}`);
          prior.set(step.view, { id: activationID, revision: saved.revision });
        });
      },
    ), { numRuns: 250 });
  });
});
