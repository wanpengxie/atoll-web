#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const expectedRoot = path.resolve(import.meta.dirname, '../..');
if (root !== expectedRoot) {
  console.error(`run from ${expectedRoot}`);
  process.exit(2);
}

const extensions = ['.js', '.jsx', '.mjs', '.ts', '.tsx'];
const production = [];
const compatibilityFiles = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(filename);
    else if (!/\.(test|spec)\.[^.]+$/.test(entry.name)) {
      if (extensions.includes(path.extname(entry.name))) production.push(path.resolve(filename));
      if ([...extensions, '.css'].includes(path.extname(entry.name))) compatibilityFiles.push(path.resolve(filename));
    }
  }
}
walk('src');

const productionSet = new Set(production);
const edges = new Map(production.map((filename) => [filename, []]));
const importPattern = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
function resolveImport(filename, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(filename), specifier);
  return [
    base,
    ...extensions.map((extension) => base + extension),
    ...extensions.map((extension) => path.join(base, `index${extension}`)),
  ].find((candidate) => productionSet.has(candidate)) || null;
}
for (const filename of production) {
  const source = fs.readFileSync(filename, 'utf8');
  for (const match of source.matchAll(importPattern)) {
    const target = resolveImport(filename, match[1] || match[2]);
    if (target) edges.get(filename).push(target);
  }
}

const relative = (filename) => path.relative(root, filename);
const entry = path.resolve('src/main.jsx');
const reachable = new Set();
function visit(filename) {
  if (reachable.has(filename)) return;
  reachable.add(filename);
  for (const target of edges.get(filename) || []) visit(target);
}
visit(entry);

let serial = 0;
const stack = [];
const onStack = new Set();
const indexes = new Map();
const lowLinks = new Map();
const cycles = [];
function strongConnect(filename) {
  indexes.set(filename, serial);
  lowLinks.set(filename, serial);
  serial += 1;
  stack.push(filename);
  onStack.add(filename);
  for (const target of edges.get(filename) || []) {
    if (!reachable.has(target)) continue;
    if (!indexes.has(target)) {
      strongConnect(target);
      lowLinks.set(filename, Math.min(lowLinks.get(filename), lowLinks.get(target)));
    } else if (onStack.has(target)) {
      lowLinks.set(filename, Math.min(lowLinks.get(filename), indexes.get(target)));
    }
  }
  if (lowLinks.get(filename) !== indexes.get(filename)) return;
  const component = [];
  let current;
  do {
    current = stack.pop();
    onStack.delete(current);
    component.push(current);
  } while (current !== filename);
  if (component.length > 1 || edges.get(filename)?.includes(filename)) {
    cycles.push(component.map(relative).sort());
  }
}
for (const filename of reachable) if (!indexes.has(filename)) strongConnect(filename);

const compatibilityRules = [
  ['B1 legacy notification receipts', /legacyAcknowledged|notificationMigrationSignature/],
  ['B2 localStorage submission migration', /restoreSubmissions|saveSubmissions|removeStoredSubmissions|atoll\.submissions\.v1/],
  ['B3 legacy feed owner/cache', /atoll\.feed\.v5|atoll\.feed\.owner\.v1/],
  // actor.describe's wire manifest canonically spells this field input_schema.
  // Only internal aliases/reconstructed option domains are compatibility debt.
  ['B4 old agent-options schema', /meta\.input_schema|describe\?\.oneOf|describe\.oneOf/],
  ['B5 reconstructed task control', /fallbackControl|legacyControl|caller-built control/i],
  ['B6 optional edit lease CAS', /function\s+withExpectedHold|conditionally omits expected_hold_id/i],
  ['B7 unversioned attachment world', /legacy draft|untagged attachment|synthetic single world/i],
  ['B8 CSS compatibility alias', /compatibility alias|legacy token alias/i],
  ['B11 retired control persistence', /atoll\.controls\.v1/],
];
const compatibilityHits = [];
for (const filename of compatibilityFiles) {
  const source = fs.readFileSync(filename, 'utf8');
  const lines = source.split('\n');
  for (const [rule, pattern] of compatibilityRules) {
    lines.forEach((line, index) => {
      if (pattern.test(line)) compatibilityHits.push({ rule, file: relative(filename), line: index + 1, text: line.trim() });
    });
  }
}

// B9/B10 intentionally retain unsupported rows/records at their storage or
// transport boundary, so their acceptance rule is fail-closed shape handling,
// not absence of an old token.
const boundaryCompatibility = {
  B9CanonicalEnvelopeOnly: /if\s*\(!hasCanonicalBody\(envelope\)\)\s*return\s*\{\}/
    .test(fs.readFileSync(path.resolve('src/protocol/envelope.js'), 'utf8')),
  B10StrictViewSessionSchema: (() => {
    const source = fs.readFileSync(path.resolve('src/model/view-session.js'), 'utf8');
    return /value\?\.schema\s*!==\s*VIEW_SESSION_SCHEMA/.test(source)
      && /atoll\.view-session\.v3\./.test(source);
  })(),
};

const coreFiles = [
  'src/App.jsx',
  'src/ui/Timeline.jsx',
  'src/ui/timeline/useReadingSession.js',
  'src/ui/timeline/LegendMessageList.jsx',
  'src/model/history-scheduler.js',
  'src/app/hooks/useChannelFeed.js',
  'src/app/hooks/useSubmissions.js',
];
const hookPattern = /\b(useState|useReducer|useRef|useEffect|useLayoutEffect|useMemo|useCallback|useSyncExternalStore)\s*\(/g;
const core = {};
for (const name of coreFiles) {
  const filename = path.resolve(name);
  const source = fs.readFileSync(filename, 'utf8');
  const hooks = {};
  for (const match of source.matchAll(hookPattern)) hooks[match[1]] = (hooks[match[1]] || 0) + 1;
  core[name] = {
    lines: source.split('\n').length,
    hooks,
    imports: (edges.get(filename) || []).length,
    importedBy: production.filter((candidate) => edges.get(candidate)?.includes(filename)).map(relative).sort(),
  };
}

const persistenceAccessPattern = /\b(localStorage|sessionStorage|indexedDB|IDBKeyRange)\b|new\s+Dexie\s*\(/;
const persistenceModules = production.flatMap((filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  return persistenceAccessPattern.test(source) ? [relative(filename)] : [];
}).sort();

const sources = new Map(production.map((filename) => [relative(filename), fs.readFileSync(filename, 'utf8')]));
const modulesExporting = (pattern) => [...sources.entries()]
  .filter(([, source]) => pattern.test(source))
  .map(([filename]) => filename);
const historyCandidateReducers = modulesExporting(/export\s+function\s+reduceHistoryCandidates\s*\(/);
const historyBoundedExecutors = modulesExporting(/export\s+function\s+createHistoryBoundedExecutor\s*\(/);
const historySourceAdapters = modulesExporting(/export\s+function\s+createHistorySourceAdapters\s*\(/);
const soleSource = (filenames) => filenames.length === 1 ? sources.get(filenames[0]) : '';
const legendModule = 'src/ui/timeline/LegendMessageList.jsx';
const legendSource = sources.get(legendModule);
const legendDependencies = new Set((edges.get(path.resolve(legendModule)) || []).map(relative));
const readingNavigationOwners = modulesExporting(/export\s+function\s+ReadingNavigationOwner\s*\(/);
const browsingInputControllers = modulesExporting(/export\s+function\s+useBrowsingReadingController\s*\(/);
const readingDOMCommandExecutors = modulesExporting(/export\s+function\s+executeReadingDOMCommand\s*\(/);
const inputTransactionWriters = [...sources.entries()]
  .filter(([, source]) => /\.(?:beginNavigation|updateNavigation|finishNavigation|cancelNavigation)(?:\?\.)?\s*\(/.test(source))
  .map(([filename]) => filename);
const directScrollWritePattern = /\.scrollTo(?:Index)?\s*\(|\.scrollBy\s*\(|\.scrollTop\s*=(?!=)/;
const timelineScrollWriters = [...sources.entries()]
  .filter(([filename, source]) => filename.startsWith('src/ui/timeline/') && directScrollWritePattern.test(source))
  .map(([filename]) => filename);
const retiredInputResizePattern = /atoll:input-resize-prepared|data-input-resize-(?:transition|growth)|timeline-input-resize-content/;
const retiredInputResizeModules = [...sources.entries()]
  .filter(([, source]) => retiredInputResizePattern.test(source))
  .map(([filename]) => filename);
const structuralChecks = [
  {
    id: 'C1',
    description: 'App is composition, not domain lifecycle owner',
    violations: [
      ['direct Wire construction', /createWire\s*\(/],
      ['direct roster construction', /createRoster\s*\(/],
      ['attachment transaction state', /attachment(UploadQueues|ActiveUploads|DraftEpochs|WorldRevision)Ref/],
      ['agent probe lifecycle state', /(describeProbes|contextProbed|optionsProbed|manualProbe)Ref/],
    ].filter(([, pattern]) => pattern.test(sources.get('src/App.jsx'))).map(([name]) => name),
  },
  {
    id: 'C2',
    description: 'Timeline composes projection, waiting/editing, receipts and rows',
    violations: [
      ['constructs Presentation owner', /createConversationPresentation\s*\(/],
      ['owns editing transaction', /\[editing,\s*setEditing\]/],
      ['owns waiting continuity', /waitingContinuityRef/],
      ['owns fold preference state', /\[foldOverrides,\s*setFoldOverrides\]/],
      ['builds protocol control frames', /TYPES\.agent(Hold|Unhold|Replace|Context)/],
    ].filter(([, pattern]) => pattern.test(sources.get('src/ui/Timeline.jsx'))).map(([name]) => name),
  },
  {
    id: 'C3',
    description: 'ReadingSession consumes pure history, notification and DOM-evidence ports',
    violations: [
      ['reads document visibility directly', /document\.visibilityState|visibilitychange/],
      ['owns notification acknowledgement lifecycle', /notificationConfirmationRef|acknowledgeChannelNotificationsRef/],
      ['owns history retry/deadline lifecycle', /historyEpochRef|initializationDeadlineRef|failedAnticipatoryRequestRef/],
    ].filter(([, pattern]) => pattern.test(sources.get('src/ui/timeline/useReadingSession.js'))).map(([name]) => name),
  },
  {
    id: 'C4',
    description: 'Legend adapter delegates typed DOM commands and emits evidence only',
    violations: [
      ['decides history demand', /requestTopDemand|coverageDemandKeyRef|historyRunwayMinimumPx/.test(legendSource)],
      ['physical navigation owner capability is not uniquely owned', readingNavigationOwners.length !== 1],
      ['input transaction writes escape physical navigation owner', inputTransactionWriters.length !== 1
        || inputTransactionWriters[0] !== readingNavigationOwners[0]],
      ['browsing input controller capability is not uniquely owned', browsingInputControllers.length !== 1],
      ['Legend does not consume physical navigation owner', readingNavigationOwners.length !== 1
        || !legendDependencies.has(readingNavigationOwners[0])],
      ['Legend does not consume browsing input controller', browsingInputControllers.length !== 1
        || !legendDependencies.has(browsingInputControllers[0])],
      ['Legend retains input transaction state', /\b(?:input|transaction)OwnerRef\b|\binputRef\b/.test(legendSource)],
      ['retains retired input-resize protocol', retiredInputResizeModules.length > 0],
      ['DOM command executor capability is not uniquely owned', readingDOMCommandExecutors.length !== 1],
      ['Legend does not consume DOM command executor', readingDOMCommandExecutors.length !== 1
        || !legendDependencies.has(readingDOMCommandExecutors[0])],
      ['timeline scroll writes escape DOM command executor', timelineScrollWriters.length !== 1
        || timelineScrollWriters[0] !== readingDOMCommandExecutors[0]],
      ['DOM command executor lacks typed row/tail commands', readingDOMCommandExecutors.length !== 1
        || !/command\.type\s*===\s*['"]position-row['"]/.test(soleSource(readingDOMCommandExecutors))
        || !/command\.type\s*===\s*['"]scroll-tail['"]/.test(soleSource(readingDOMCommandExecutors))],
    ].filter(([, failed]) => failed === true).map(([name]) => name),
  },
  {
    id: 'C5',
    description: 'History scheduler is reducer + executor + source adapters',
    violations: [
      ['monolith still owns candidate and execution', /function\s+candidate\s*\([\s\S]*async\s+function\s+execute\s*\(/],
      ['monolith still owns source selection', /function\s+sourceFor\s*\(/],
      ['candidate reducer capability is not uniquely owned', historyCandidateReducers.length !== 1],
      ['bounded executor capability is not uniquely owned', historyBoundedExecutors.length !== 1],
      ['source adapter capability is not uniquely owned', historySourceAdapters.length !== 1],
      ['candidate reducer performs source or queue effects', /\b(?:PQueue|requestPage|readCache|cancelPage)\b/
        .test(soleSource(historyCandidateReducers))],
      ['bounded executor owns channel or source policy', /\b(?:channelId|priorityClass|beforeSeq|requestPage|readCache)\b/
        .test(soleSource(historyBoundedExecutors))],
      ['source adapters import scheduler policy owners', /history-(?:candidate-reducer|bounded-executor)/
        .test(soleSource(historySourceAdapters))],
    ].filter(([, test]) => test === true || test instanceof RegExp && test.test(sources.get('src/model/history-scheduler.js'))).map(([name]) => name),
  },
  {
    id: 'C6',
    description: 'Channel feed is a committed ingress coordinator',
    violations: [
      ['constructs cache owner', /createFeedCache\s*\(/],
      ['constructs cursor owner', /createCursors\s*\(/],
      ['constructs scheduler owner', /createHistoryScheduler\s*\(/],
      ['constructs replica owner', /createChannelReplicaStore\s*\(/],
      ['owns notification hydration state', /notificationHydrationRef/],
    ].filter(([, pattern]) => pattern.test(sources.get('src/app/hooks/useChannelFeed.js'))).map(([name]) => name),
  },
  {
    id: 'C7',
    description: 'Submissions uses one durable outbox and one transaction projection',
    violations: [
      ['parallel pending state/ref mutations', /pendingLedgerRef\.current\s*=/.test(sources.get('src/app/hooks/useSubmissions.js'))
        && /setPending\s*\(/.test(sources.get('src/app/hooks/useSubmissions.js'))],
      ['parallel draft state/ref mutations', /draftLedgerRef\.current\s*=/.test(sources.get('src/app/hooks/useSubmissions.js'))
        && /setDrafts\s*\(/.test(sources.get('src/app/hooks/useSubmissions.js'))],
    ].filter(([, test]) => test === true).map(([name]) => name),
  },
];

const result = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  baselineCommit: 'acd272a9b44542771da9ed0307d1bdacae38a7f6',
  trackedWorktreeChanges: execFileSync(
    'git', ['status', '--porcelain=v1', '--untracked-files=no'], { cwd: root, encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean),
  reachability: {
    productionModules: production.length,
    reachableModules: reachable.size,
    unreachable: production.filter((filename) => !reachable.has(filename)).map(relative).sort(),
  },
  importCycles: cycles,
  compatibilityHits,
  boundaryCompatibility,
  persistenceModules,
  historySchedulerModules: {
    candidateReducer: historyCandidateReducers,
    boundedExecutor: historyBoundedExecutors,
    sourceAdapters: historySourceAdapters,
  },
  readingListCapabilities: {
    physicalNavigationOwner: readingNavigationOwners,
    inputTransactionWriters,
    browsingInputController: browsingInputControllers,
    domCommandExecutor: readingDOMCommandExecutors,
    timelineScrollWriters,
    retiredInputResizeModules,
  },
  core,
  c1ToC7: structuralChecks,
};

console.log(JSON.stringify(result, null, 2));
const failed = result.trackedWorktreeChanges.length > 0
  || result.reachability.unreachable.length > 0
  || result.importCycles.length > 0
  || result.compatibilityHits.length > 0
  || Object.values(result.boundaryCompatibility).some((passed) => !passed)
  || result.c1ToC7.some((check) => check.violations.length > 0);
process.exitCode = failed ? 1 : 0;
