// @vitest-environment jsdom
// Round-12–14 exact-path recovery for the five I-M baseline files that the
// global static ledger still reports as `absent target path`. These tests are
// deliberately public-owner contracts: no deleted adapter, private helper, or
// production state map is imported.
import React, { Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WebSocket } from 'ws';
import {
  createChannelReplicaCache,
  createChannelReplicaStore,
} from '../src/model/channel-replica.js';
import {
  createChannelFeedRuntime,
  HISTORY_BATCH_BYTES,
  HISTORY_PAGE_SIZE,
} from '../src/model/channel-feed-runtime.js';
import {
  CONVERSATION_SCOPE,
  createConversationPresentation,
  selectTimelineItems,
} from '../src/model/conversation-presentation.js';
import { isStandardActorIdentity, isVisibleActor } from '../src/model/actor-visibility.js';
import { acknowledgeLivePresentationArrivals } from '../src/model/live-arrivals.js';
import { isRailNotifiableDisposition, notificationDisposition } from '../src/model/notification-policy.js';
import {
  bindLatestIntentTargets,
  consumeLatestIntent,
  createReadingSession,
  observeReading,
  READING_MODE,
  requestLatest,
  resolveReadingBookmark,
  takeReadingControl,
} from '../src/model/reading-session.js';
import {
  SYSTEM_ACTOR_ID,
  SYSTEM_DECL_IDS,
  TYPES,
} from '../src/protocol/vocab.js';
import { createReadingNavigationCoordinator } from '../src/ui/timeline/reading-navigation-coordinator.js';
import { MarkdownContent, MarkdownFileReferenceProvider } from '../src/ui/MarkdownContent.jsx';
import { clearMermaidDiagramCache } from '../src/ui/MermaidBlock.jsx';
import {
  buildComposerModel,
  createComposerCommandRequest,
  parseComposerCommand,
} from '../src/ui/composer/composer-model.js';
import { Composer } from '../src/ui/composer/Composer.jsx';
import { useTimelineRowRenderer } from '../src/ui/timeline/TimelineRowRenderer.jsx';
import { projectAgentParameters } from '../src/ui/composer/agent-parameters.js';
import { normalizeMathMarkdown } from '../src/model/math-markdown.js';
import { messageTimeLabel } from '../src/util/time.js';
import {
  downstreamFrame,
  FRAME_VERSION,
  MAX_FRAME_BYTES,
  PAYLOAD_FIELDS,
  validatePayload,
} from '../mock/protocol.mjs';
import { createMockDomain } from '../mock/domain.mjs';
import { loadScenario, scenarioIds } from '../mock/scenarios.mjs';
import { createMockServer } from '../mock/server.mjs';
import { createIdentityClient } from '../src/net/identity.js';
import { createWire } from '../src/net/wire.js';
import {
  createMessageLayoutStore,
  MessageLayoutProvider,
  MessageLayoutScope,
  useMessageLayoutState,
} from '../src/ui/timeline/MessageLayoutState.jsx';
import { createViewSessionStore } from '../src/model/view-session.js';
import { detectProfile, PROFILE_DESKTOP, PROFILE_MOBILE } from '../src/model/device-profile.js';
import { MermaidBlock } from '../src/ui/MermaidBlock.jsx';
import { VendorListExecutor } from '../src/ui/timeline/VendorListExecutor.jsx';
import { ReadingContainerHandoff } from '../src/ui/timeline/ReadingContainerHandoff.jsx';
import { HISTORY_INTENT } from '../src/model/history-demand.js';
import {
  blockingAdmission,
  historyConsumerObligation,
} from '../src/ui/timeline/history-consumer-obligation.js';

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

const vendorHarness = vi.hoisted(() => ({
  props: null,
  root: null,
  scrollTo: null,
  scrollToIndex: null,
  rootMetrics: null,
}));

vi.mock('react-virtuoso', async () => {
  const ReactModule = await import('react');
  const Virtuoso = ReactModule.forwardRef(function ExactContractVirtuoso(props, ref) {
    const nodeRef = ReactModule.useRef(null);
    const scrollToIndex = ReactModule.useMemo(() => vi.fn(), []);
    ReactModule.useLayoutEffect(() => {
      const sameRoot = vendorHarness.root === nodeRef.current && vendorHarness.scrollTo;
      vendorHarness.props = props;
      vendorHarness.root = nodeRef.current;
      vendorHarness.scrollToIndex = scrollToIndex;
      if (!sameRoot) vendorHarness.scrollTo = vi.fn((options) => {
        if (nodeRef.current && options && typeof options === 'object') {
          nodeRef.current.scrollTop = Number(options.top || 0);
        }
      });
      nodeRef.current.scrollTo = vendorHarness.scrollTo;
      if (vendorHarness.rootMetrics) {
        Object.defineProperties(nodeRef.current, {
          clientHeight: { configurable: true, value: vendorHarness.rootMetrics.clientHeight },
          scrollHeight: { configurable: true, value: vendorHarness.rootMetrics.scrollHeight },
          scrollTop: {
            configurable: true,
            writable: true,
            value: vendorHarness.rootMetrics.scrollTop,
          },
        });
      }
      props.scrollerRef?.(nodeRef.current);
      props.rangeChanged?.({
        startIndex: props.firstItemIndex,
        endIndex: props.firstItemIndex + props.data.length - 1,
      });
      return () => props.scrollerRef?.(null);
    }, [props, scrollToIndex]);
    ReactModule.useImperativeHandle(ref, () => ({ scrollToIndex }), [scrollToIndex]);
    const List = props.components?.List || 'div';
    const Header = props.components?.Header || (() => null);
    return (
      <div
        ref={nodeRef}
        className={props.className}
        role={props.role}
        aria-label={props['aria-label']}
        tabIndex={props.tabIndex}
      >
        <List context={props.context}>
          <Header context={props.context} />
          {props.data.map((value, index) => (
            <div key={props.computeItemKey(index + props.firstItemIndex, value)}>
              {props.itemContent(index + props.firstItemIndex, value)}
            </div>
          ))}
        </List>
      </div>
    );
  });
  return { Virtuoso };
});

vi.mock('mermaid', () => ({ default: mermaidMock }));

const mockServers = new Set();
const mockWires = new Set();

async function listenMockServer(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  mockServers.add(server);
  return 'http://127.0.0.1:' + server.address().port;
}

async function closeMockServer(server) {
  if (!mockServers.delete(server)) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

function waitForMock(predicate, detail, timeoutMs = 5_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const value = predicate();
      if (value) resolve(value);
      else if (Date.now() - started >= timeoutMs) reject(new Error('timed out waiting for ' + detail));
      else setTimeout(poll, 10);
    };
    poll();
  });
}

async function connectMockScenario(scenario) {
  const server = createMockServer({ rootPassword: 'test-root', scenario });
  const baseURL = await listenMockServer(server);
  let cookie = '';
  const fetchSession = async (path, options = {}) => {
    const headers = new Headers(options.headers);
    if (cookie) headers.set('Cookie', cookie);
    const response = await fetch(baseURL + path, { ...options, headers });
    const next = response.headers.get('set-cookie');
    if (next) cookie = next.split(';', 1)[0];
    return response;
  };
  await createIdentityClient(fetchSession).login('root@atoll.local', 'test-root');
  class SessionWebSocket extends WebSocket {
    constructor(url) { super(url, { headers: { Cookie: cookie } }); }
  }
  const feeds = [];
  let attachDetail = null;
  const wire = createWire({
    url: baseURL.replace('http', 'ws') + '/ws',
    WebSocketImpl: SessionWebSocket,
    onState: (state, detail) => { if (state === 'attached') attachDetail = detail; },
    onFeed: (channelId, seq, envelope) => feeds.push({ channelId, seq, envelope }),
  });
  mockWires.add(wire);
  await waitForMock(() => attachDetail, 'mock attach');
  return { server, fetchSession, wire, feeds, attachDetail };
}

function mockRequest(id, type, payload = {}, parentId = '') {
  return {
    channel_id: CHANNEL,
    id,
    msg_type: type,
    kind: 'request',
    payload,
    audience: ['steward'],
    visibility: 'public',
    ...(parentId ? { parent_id: parentId } : {}),
  };
}

function mockTerminal(feeds, requestId) {
  return feeds.find((row) => row.envelope.kind === 'response'
    && row.envelope.parent_id === requestId
    && ['completed', 'failed'].includes(row.envelope.payload?.body?.status))?.envelope;
}

function LayoutChoice() {
  const [open, setOpen] = useMessageLayoutState('details', false);
  return <button aria-expanded={open} onClick={() => setOpen((value) => !value)}>details</button>;
}

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  clearMermaidDiagramCache();
  mermaidMock.initialize.mockReset();
  mermaidMock.render.mockReset();
  vendorHarness.props = null;
  vendorHarness.root = null;
  vendorHarness.scrollTo = null;
  vendorHarness.scrollToIndex = null;
  vendorHarness.rootMetrics = null;
  for (const wire of mockWires) wire.close();
  mockWires.clear();
  await Promise.all([...mockServers].map(closeMockServer));
});

const CHANNEL = 'c0';
const SELF = 'human:root:1';
const AGENT = 'agent:steward:1';

function envelope(seq, {
  id = `event-${seq}`,
  kind = 'event',
  type = 'human.note',
  sender = SELF,
  audience = [],
  parentId = '',
  body = { text: String(seq) },
} = {}) {
  return {
    channel_id: CHANNEL,
    seq,
    envelope: {
      id,
      kind,
      type,
      sender: { id: sender, kind: sender.startsWith('human:') ? 'human' : 'agent' },
      audience,
      ...(parentId ? { parent_id: parentId, correlation_id: parentId } : {}),
      payload: { body },
    },
  };
}

function flatEnvelope(seq, options = {}) {
  const row = envelope(seq, options);
  return {
    ...row,
    envelope: { ...row.envelope, payload: options.body },
  };
}

function request(seq, id) {
  return envelope(seq, {
    id,
    kind: 'request',
    type: 'agent.ask',
    audience: [AGENT],
    body: { text: id },
  });
}

function terminal(seq, id, status = 'completed', text = 'done') {
  return envelope(seq, {
    id: `${id}-terminal-${seq}`,
    kind: 'response',
    type: 'agent.ask',
    sender: AGENT,
    audience: [SELF],
    parentId: id,
    body: { status, text },
  });
}

function note(seq) {
  return envelope(seq, { id: `note-${seq}` });
}

function progress(seq, requestId, text = 'still working') {
  return envelope(seq, {
    id: `${requestId}-progress-${seq}`,
    kind: 'response',
    type: 'agent.ask',
    sender: AGENT,
    audience: [SELF],
    parentId: requestId,
    body: { status: 'processing', text },
  });
}

function completedTurn({ requestId, actorId, type, value }) {
  return {
    kind: 'turn',
    turn: {
      requestId,
      request: { id: requestId, type, audience: [actorId] },
      terminal: {
        kind: 'response',
        type,
        parent_id: requestId,
        sender: { id: actorId },
        payload: { body: { status: 'completed', value } },
      },
    },
  };
}

const OPTIONS_VALUE = {
  models: [
    { value: 'gpt-5.6-sol', label: '5.6 Sol', efforts: [{ value: 'medium', label: '中等' }] },
    { value: 'gpt-5.4', label: '5.4', efforts: [{ value: 'light', label: '轻量' }] },
  ],
};

function optionsState(actorId = 'steward') {
  return { timeline: [completedTurn({
    requestId: 'options', actorId, type: 'agent.options', value: OPTIONS_VALUE,
  })] };
}

function currentAgentSelection(actorId = 'steward') {
  const { view } = projectAgentParameters({
    state: optionsState(actorId),
    actorId,
    requestKeys: { options: 'options' },
  });
  const agent = { id: actorId, kind: 'agent', name: actorId === 'steward' ? 'Steward' : 'Other' };
  return { target: { kind: 'single', agent }, view };
}

function currentAgentSelectionWithUsage(actorId = 'steward') {
  const { view } = projectAgentParameters({
    state: {
      timeline: [
        ...optionsState(actorId).timeline,
        completedTurn({
          requestId: 'context', actorId, type: 'agent.context',
          value: { model: 'gpt-5.6-sol', effort: 'medium', context_tokens: 42_000, context_window: 200_000 },
        }),
      ],
    },
    actorId,
    requestKeys: { options: 'options', context: 'context' },
  });
  const agent = { id: actorId, kind: 'agent', name: actorId === 'steward' ? 'Steward' : 'Other' };
  return { target: { kind: 'single', agent }, view };
}

function messageRow(type, body) {
  const envelopeValue = {
    id: 'message',
    kind: 'request',
    type,
    sender: { id: SELF, kind: 'human' },
    audience: [AGENT],
    payload: { body },
  };
  return {
    id: 'message',
    seqLow: 1,
    seqHigh: 1,
    contentRevision: 1,
    visualSlotID: 'message',
    body: { kind: 'standalone', envelope: envelopeValue },
  };
}

function MessageHarness({ row }) {
  const { renderRow } = useTimelineRowRenderer({
    state: { channelId: CHANNEL, narration: [] },
    names: new Map([[SELF, 'Root'], [AGENT, 'Steward']]),
    selfId: SELF,
    presentationEditing: null,
    browsingExpandedSlots: new Set(),
    effectiveFoldOverrides: new Map(),
    approvalStates: {},
  });
  return renderRow(row);
}

function presentationEntry(id, seq, text = id) {
  return {
    kind: 'standalone',
    seq,
    envelope: {
      id,
      seq,
      ts: seq * 1_000,
      kind: 'event',
      type: 'human.note',
      sender: { id: SELF, kind: 'human' },
      payload: { body: { text } },
    },
  };
}

function readingSession(saved = {}, activationID = 'activation:round-13') {
  return createReadingSession({ key: `${CHANNEL}:all`, activationID, saved });
}

function round33Reading(overrides = {}) {
  const session = {
    activationID: 'activation:round-33',
    inputEpoch: 0,
    geometryRevision: 0,
    mode: READING_MODE.following,
    bottomIntent: { id: '', inputEpoch: 0 },
    bookmark: null,
  };
  const owner = {
    activationID: session.activationID,
    session,
    initializing: false,
    restorePending: false,
    bottomReady: true,
    status: {},
    getSession: () => owner.session,
    onAtTop: vi.fn(),
    onNearTop: vi.fn(),
    onUnderfill: vi.fn(() => null),
    onPresentationMaterialized: vi.fn(),
    onReadingObservation: vi.fn(),
    onSurfaceVisibilityChange: vi.fn(),
    onUserControl: vi.fn(),
    consumeBottomIntent: vi.fn(() => false),
    beginNavigation: vi.fn(() => ({ inputGeneration: owner.session.inputEpoch })),
    updateNavigation: vi.fn(),
    finishNavigation: vi.fn(),
    cancelNavigation: vi.fn(),
    ...overrides,
  };
  return owner;
}

function round33Row(id, seq) {
  return {
    id,
    seqLow: seq,
    seqHigh: seq,
    contentRevision: 1,
    visualSlotID: id,
    layoutClass: 'message',
    body: { kind: 'standalone', envelope: { id, kind: 'event', type: 'human.note' } },
  };
}

function round33Snapshot(rows, { firstItemIndex = 1, revision = 7 } = {}) {
  return { rows, firstItemIndex, revision, roleRevision: 1 };
}

function round34Reading({
  activationID = 'activation:round-34',
  mode = READING_MODE.browsing,
  bookmark = null,
  initializing = false,
  restorePending = false,
} = {}) {
  const owner = round33Reading();
  owner.activationID = activationID;
  owner.session = {
    ...owner.session,
    activationID,
    mode,
    bookmark,
  };
  owner.initializing = initializing;
  owner.restorePending = restorePending;
  return owner;
}

// Model the Reading owner's public receipt semantics without asserting the
// adapter's callback name or call shape. A valid typed intent is consumed by
// the current activation/epoch exactly once; stale or duplicate receipts are
// observable only as an unchanged session.
function installSemanticBottomIntentConsumer(reading) {
  reading.consumeBottomIntent = (intent) => {
    const current = reading.getSession();
    const next = consumeLatestIntent(current, {
      id: intent?.id,
      inputEpoch: intent?.inputEpoch,
      activationID: current.activationID,
    });
    if (next === current) return false;
    reading.session = next;
    return true;
  };
  return reading;
}

function setRound35Geometry(node, {
  clientHeight = 600,
  scrollHeight = 1_000,
  scrollTop = 400,
} = {}) {
  Object.defineProperties(node, {
    clientHeight: { configurable: true, value: clientHeight },
    scrollHeight: { configurable: true, value: scrollHeight },
    scrollTop: { configurable: true, writable: true, value: scrollTop },
  });
  node.getBoundingClientRect = () => ({
    top: 0,
    bottom: clientHeight,
    left: 0,
    right: 800,
    width: 800,
    height: clientHeight,
  });
  return node;
}

// Keep the send-join fixtures tied to the current public handoff. The range
// receipt is the adapter's typed presentation-ready fact; the height callback
// below is the separate physical measurement. Neither helper reaches through
// the Vendor owner or invents a test-only production prop.
function capturePublicPresentationReady(reading, snapshot) {
  const firstItemIndex = Number(snapshot.firstItemIndex || 0);
  const ready = Object.freeze({
    activationID: reading.activationID,
    presentationRevision: Number(snapshot.revision || 0),
    startIndex: firstItemIndex,
    endIndex: firstItemIndex + snapshot.rows.length - 1,
  });
  expect(reading.onPresentationMaterialized).toHaveBeenLastCalledWith(ready);
  return ready;
}

function publishPublicPhysicalMeasurement({
  reading,
  snapshot,
  root,
  presentationReady,
  clientHeight = 600,
  scrollHeight,
  scrollTop = 400,
}) {
  expect(presentationReady).toMatchObject({
    activationID: reading.activationID,
    presentationRevision: Number(snapshot.revision || 0),
  });
  const measurement = Object.freeze({
    activationID: reading.activationID,
    presentationRevision: Number(snapshot.revision || 0),
    clientHeight,
    scrollHeight,
    scrollTop,
  });
  setRound35Geometry(root, measurement);
  act(() => vendorHarness.props.totalListHeightChanged());
  return measurement;
}

function round36BottomPresentation(reading, snapshot, intent, ready) {
  const targetIDs = intent.targetMessageIDs.map(String);
  return Object.freeze({
    kind: 'bottom-intent-presentation',
    intentID: intent.id,
    activationID: reading.activationID,
    inputEpoch: Number(reading.session.inputEpoch || 0),
    intentRevision: Number(reading.session.intentRevision || 0),
    presentationRevision: Number(snapshot.revision || 0),
    targetIDs: Object.freeze(targetIDs),
    ready: ready === true,
    destinations: Object.freeze(ready === true
      ? targetIDs.map((messageID) => Object.freeze({
        messageID,
        destination: 'timeline',
        targetListRevision: Number(snapshot.revision || 0),
      }))
      : []),
  });
}

function liveCheckpointOptions() {
  return {
    wireRef: { current: null },
    rosterRef: { current: { self: () => '', observeFeed: () => '', handleEnvelope: () => {} } },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: CHANNEL },
    onRoster: vi.fn(),
    onError: vi.fn(),
    onChannelsDiscovered: vi.fn(),
    onDirectoryInvalidated: vi.fn(),
    onTimerFired: vi.fn(),
    onSubmissionFeed: vi.fn(),
    onAccessChanged: vi.fn(),
    onAgentActivity: vi.fn(),
  };
}

describe('I-M exact-path public-owner recovery (round 12)', () => {
  it('management-actors: routes /members through the channel system actor', () => {
    const model = buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '/members', recipients: [] },
      roster: [{ id: AGENT, kind: 'agent', name: 'Steward' }],
      access: 'member_active',
      agentSelection: { target: { kind: 'single', agent: { id: AGENT, kind: 'agent' } } },
    });
    const requestValue = createComposerCommandRequest(model, parseComposerCommand('/members'));
    expect(requestValue).toMatchObject({
      channelId: CHANNEL,
      msgType: TYPES.member.list,
      audience: [SYSTEM_ACTOR_ID],
      targetLabel: SYSTEM_ACTOR_ID,
    });
  });

  it('memory-window: clamps trim at the oldest open request and keeps its progress', () => {
    const store = createChannelReplicaStore();
    store.commit(request(1, 'open-work'), SELF);
    store.commit(envelope(2, {
      id: 'open-progress',
      kind: 'response',
      type: 'agent.ask',
      sender: AGENT,
      audience: [SELF],
      parentId: 'open-work',
      body: { status: 'processing', text: 'still working' },
    }), SELF);
    for (let seq = 3; seq <= 12; seq += 1) store.commit(note(seq), SELF);

    expect(store.trim(CHANNEL, 4)).toBe(0);
    const turn = store.state(CHANNEL).timeline
      .find((entry) => entry.turn?.requestId === 'open-work')?.turn;
    expect(turn).toMatchObject({ requestId: 'open-work', status: 'pending', terminal: null });
    expect(turn.provisional.map((item) => item.envelope.id)).toEqual(['open-progress']);
  });

  it('memory-window: response-first terminal upgrades only after the exact full row returns', () => {
    const store = createChannelReplicaStore();
    const final = terminal(2, 'response-first');
    store.commit(final, SELF);
    for (let seq = 3; seq <= 10; seq += 1) store.commit(note(seq), SELF);
    expect(store.trim(CHANNEL, 4)).toBeGreaterThan(0);

    store.commit(request(1, 'response-first'), SELF);
    const compactTurn = store.state(CHANNEL).timeline
      .find((entry) => entry.turn?.requestId === 'response-first')?.turn;
    expect(compactTurn).toMatchObject({ status: 'completed', terminalClosureOnly: true });

    store.commit(final, SELF);
    const turn = store.state(CHANNEL).timeline
      .find((entry) => entry.turn?.requestId === 'response-first')?.turn;
    expect(turn).toMatchObject({ status: 'completed', terminalClosureOnly: false });
    expect(turn.terminal.id).toBe(final.envelope.id);
  });

  it('memory-window: identical request ids remain isolated between channel records', () => {
    const store = createChannelReplicaStore();
    expect(store.commit({ ...request(1, 'same-id'), channel_id: 'closed' }, SELF).accepted).toBe(true);
    expect(store.commit({ ...request(1, 'same-id'), channel_id: 'open' }, SELF).accepted).toBe(true);
    expect(store.state('closed').timeline[0].turn.requestId).toBe('same-id');
    expect(store.state('open').timeline[0].turn.requestId).toBe('same-id');
    expect(store.state('closed').rows).not.toBe(store.state('open').rows);
  });

  it('message-presentation: canonical body text wins over a system-operation label', () => {
    render(<MessageHarness row={messageRow(TYPES.member.create, {
      text: '用户正文', decl_id: 'demo:agent',
    })} />);
    expect(screen.getByText('用户正文')).toBeTruthy();
    expect(screen.queryByText('添加参与者：demo:agent')).toBeNull();
  });

  it('model-selector: canonical options project a null ledger current without inventing a choice', () => {
    const { view } = projectAgentParameters({
      state: optionsState(),
      actorId: 'steward',
      requestKeys: { options: 'options' },
    });
    expect(view.models.map((model) => model.id)).toEqual(['gpt-5.6-sol', 'gpt-5.4']);
    expect(view.current).toBeNull();
  });

  it('model-selector: changing target closes the public Composer selector', async () => {
    const user = userEvent.setup();
    const commands = { openAgentSelector: vi.fn(), changeDraft: vi.fn() };
    const steward = currentAgentSelection('steward');
    const other = currentAgentSelection('other');
    const roster = [steward.target.agent, other.target.agent];
    const model = (agentSelection, draft = { text: '', recipients: [] }) => buildComposerModel({
      activeChannelId: CHANNEL,
      draft,
      roster,
      access: 'member_active',
      agentSelection,
    });
    const { rerender } = render(<Composer model={model(steward)} commands={commands} />);
    await user.click(screen.getByRole('button', { name: 'Steward，模型未知' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    rerender(<Composer model={model(other, { text: '', recipients: [other.target.agent] })} commands={commands} />);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('message-list-lifecycle: immutable Presentation detaches visible rows from later source mutation', () => {
    const presentation = createConversationPresentation();
    const source = {
      kind: 'standalone',
      seq: 1,
      envelope: {
        id: 'detached',
        kind: 'event',
        type: 'human.note',
        sender: { id: SELF, kind: 'human' },
        payload: { body: { text: 'before' } },
      },
    };
    const candidate = presentation.evaluate([source], {
      nextViewID: `${CHANNEL}:all`, epoch: 'replica:1', sourceRevision: 1,
    });
    expect(presentation.commitCandidate(candidate)).toBe(true);
    source.envelope.payload.body.text = 'after';
    expect(candidate.snapshot.rows[0].body.envelope.payload.body.text).toBe('before');
  });
});

describe('I-M exact-path public-owner recovery (round 13)', () => {
  it('message-list-lifecycle TC-0976: prepending one committed row decrements the data origin once', () => {
    const presentation = createConversationPresentation();
    const baseCandidate = presentation.evaluate([
      presentationEntry('middle', 2),
      presentationEntry('tail', 3),
    ], {
      nextViewID: `${CHANNEL}:all`, epoch: 'replica:13', sourceRevision: 1,
    });
    expect(presentation.commitCandidate(baseCandidate)).toBe(true);
    const base = presentation.current();

    const nextCandidate = presentation.evaluate([
      presentationEntry('head', 1),
      presentationEntry('middle', 2),
      presentationEntry('tail', 3),
    ], {
      nextViewID: `${CHANNEL}:all`, epoch: 'replica:13', sourceRevision: 2,
    });
    expect(presentation.commitCandidate(nextCandidate)).toBe(true);
    const next = presentation.current();

    expect(next.firstItemIndex).toBe(base.firstItemIndex - 1);
    expect(next.changes).toMatchObject({ kind: 'prepend', prefixCount: 1 });
  });

  it('message-list-lifecycle TC-0976: exact restore resolves against the data-relative row index', () => {
    const rows = [
      { id: 'head', seqLow: 1 },
      { id: 'target', seqLow: 2 },
      { id: 'tail', seqLow: 3 },
    ];

    expect(resolveReadingBookmark(rows, {
      messageID: 'target', rowViewportOffset: -24,
    })).toEqual({
      index: 1, messageID: 'target', rowViewportOffset: -24, exact: true,
    });
  });

  it('message-list-lifecycle TC-0980: stale activation observations cannot settle a late bookmark', () => {
    const current = readingSession({
      mode: READING_MODE.browsing,
      bookmark: { messageID: 'late-target', rowViewportOffset: -36 },
    }, 'activation:current');

    const stale = observeReading(current, {
      activationID: 'activation:old',
      atTail: true,
      source: 'user',
      inputEpoch: current.inputEpoch,
      geometryRevision: 1,
    });

    expect(stale).toBe(current);
    expect(stale.bookmark).toMatchObject({ messageID: 'late-target', rowViewportOffset: -36 });
  });

  it('message-list-lifecycle TC-0981: a provisional successor never inherits the exact row offset', () => {
    expect(resolveReadingBookmark([
      { id: 'successor', seqLow: 11 },
    ], {
      messageID: 'late-target',
      successorID: 'successor',
      rowViewportOffset: -36,
    })).toEqual({
      index: 0, messageID: 'successor', rowViewportOffset: null, exact: false,
    });
  });

  it('message-list-lifecycle TC-0981: a materialized exact target is the only row allowed to reuse its offset', () => {
    expect(resolveReadingBookmark([
      { id: 'late-target', seqLow: 12 },
    ], {
      messageID: 'late-target', rowViewportOffset: -36,
    })).toEqual({
      index: 0, messageID: 'late-target', rowViewportOffset: -36, exact: true,
    });
  });

  it('message-list-lifecycle TC-0996: a tail observation without current newer evidence keeps following', () => {
    const current = readingSession();
    const observed = observeReading(current, {
      activationID: current.activationID,
      atTail: true,
      source: 'user',
      inputEpoch: current.inputEpoch,
      geometryRevision: current.geometryRevision,
    });

    expect(observed.mode).toBe(READING_MODE.following);
    expect(observed).toBe(current);
  });

  it('message-list-lifecycle TC-0996: older input takes control of the following session', () => {
    const current = readingSession();
    const browsing = takeReadingControl(current, {
      direction: 'older', gestureID: 'up', geometryRevision: 2,
    });

    expect(browsing.mode).toBe(READING_MODE.browsing);
    expect(browsing.inputEpoch).toBe(current.inputEpoch + 1);
  });

  it('message-list-lifecycle TC-0997: selection-at-tail evidence never grants following authority', () => {
    const browsing = takeReadingControl(readingSession(), {
      direction: 'older', gestureID: 'selection-owner', geometryRevision: 2,
    });
    const observed = observeReading(browsing, {
      activationID: browsing.activationID,
      atTail: true,
      source: 'selection',
      inputEpoch: browsing.inputEpoch,
      geometryRevision: 2,
    });

    expect(observed.mode).toBe(READING_MODE.browsing);
  });

  it('message-list-lifecycle TC-0998: an explicit latest intent survives zero-geometry layout evidence', () => {
    const current = requestLatest(readingSession(), 'latest:zero-geometry', {
      afterPresentationRevision: 4,
      baselineTailID: 'tail:4',
    });
    const observed = observeReading(current, {
      activationID: current.activationID,
      atTail: false,
      source: 'layout',
      inputEpoch: current.inputEpoch,
      geometryRevision: 0,
    });

    expect(observed.bottomIntent).toMatchObject({
      id: 'latest:zero-geometry', afterPresentationRevision: 4, baselineTailID: 'tail:4',
    });
  });

  it('message-list-lifecycle TC-0999: a later layout revision does not consume explicit latest', () => {
    const current = requestLatest(readingSession(), 'latest:later-height', {
      afterPresentationRevision: 5,
      baselineTailID: 'tail:5',
    });
    const observed = observeReading(current, {
      activationID: current.activationID,
      atTail: false,
      source: 'layout',
      inputEpoch: current.inputEpoch,
      geometryRevision: 7,
    });

    expect(observed.geometryRevision).toBe(7);
    expect(observed.bottomIntent.id).toBe('latest:later-height');
  });

  it('message-list-lifecycle TC-1002: exact latest consumption clears the intent and rejects a second consume', () => {
    const current = requestLatest(readingSession(), 'latest:once');
    const consumed = consumeLatestIntent(current, {
      id: 'latest:once',
      inputEpoch: current.inputEpoch,
      activationID: current.activationID,
    });

    expect(consumed.bottomIntent.id).toBe('');
    expect(consumeLatestIntent(consumed, {
      id: 'latest:once',
      inputEpoch: current.inputEpoch,
      activationID: current.activationID,
    })).toBe(consumed);
  });

  it('message-list-lifecycle TC-1005: native input cancels a pending following intent before a height write', () => {
    const current = requestLatest(readingSession(), 'latest:cancelled');
    const browsing = takeReadingControl(current, {
      direction: 'older', gestureID: 'up-after-latest', geometryRevision: 8,
    });

    expect(browsing.mode).toBe(READING_MODE.browsing);
    expect(browsing.bottomIntent.id).toBe('');
  });

  it('message-list-lifecycle TC-1009: consuming explicit latest leaves the session following at the real tail', () => {
    const browsing = takeReadingControl(readingSession(), {
      direction: 'older', gestureID: 'before-latest', geometryRevision: 3,
    });
    const current = requestLatest(browsing, 'latest:real-tail');
    const consumed = consumeLatestIntent(current, {
      id: 'latest:real-tail',
      inputEpoch: current.inputEpoch,
      activationID: current.activationID,
    });

    expect(consumed.mode).toBe(READING_MODE.following);
    expect(consumed.bottomIntent.id).toBe('');
  });

  it('message-list-lifecycle TC-1017: latest target binding de-duplicates durable echo identities', () => {
    const current = requestLatest(readingSession(), 'latest:target-bind');
    const bound = bindLatestIntentTargets(current, {
      activationID: current.activationID,
      inputEpoch: current.inputEpoch,
      intentRevision: current.intentRevision,
    }, ['echo:one', 'echo:one', 'echo:two']);

    expect(bound.bottomIntent.targetMessageIDs).toEqual(['echo:one', 'echo:two']);
  });

  it('message-list-lifecycle TC-1017: stale activation cannot mutate a bound latest target set', () => {
    const current = requestLatest(readingSession(), 'latest:target-bind-stale');
    const bound = bindLatestIntentTargets(current, {
      activationID: current.activationID,
      inputEpoch: current.inputEpoch,
      intentRevision: current.intentRevision,
    }, ['echo:one']);

    expect(bindLatestIntentTargets(bound, {
      activationID: 'activation:stale',
      inputEpoch: bound.inputEpoch,
      intentRevision: bound.intentRevision,
    }, ['echo:stale'])).toBe(bound);
  });

  it('message-list-lifecycle TC-1026: one wheel transaction settles once through the public scrollend owner', () => {
    vi.useFakeTimers();
    const events = [];
    const coordinator = createReadingNavigationCoordinator({
      activationID: 'activation:round-13',
      onBegin: () => ({ inputGeneration: 13 }),
      onEnd: (_transaction, reason) => events.push(reason),
    });

    coordinator.recordInput({
      source: 'wheel', hostRole: 'browsing', hostToken: 'host-13', direction: 'older',
    });
    coordinator.recordScroll({
      hostRole: 'browsing', hostToken: 'host-13', direction: 'older',
    });
    expect(coordinator.recordScrollEnd({
      hostRole: 'browsing', hostToken: 'host-13',
    })).toBe(true);
    vi.advanceTimersByTime(200);

    expect(events).toEqual(['native-scrollend']);
  });
});

describe('I-M exact-path public-owner recovery (round 14)', () => {
  it('memory-window TC-0936: trim removes only the oldest materialized rows and rebuilds public coverage', () => {
    const store = createChannelReplicaStore();
    for (let seq = 1; seq <= 8; seq += 1) {
      expect(store.commit(note(seq), SELF).accepted).toBe(true);
    }

    expect(store.trim(CHANNEL, 4)).toBe(4);
    const state = store.state(CHANNEL);
    expect([...state.rows.keys()]).toEqual([5, 6, 7, 8]);
    expect(state.timeline.map((entry) => entry.envelope.id)).toEqual([
      'note-5', 'note-6', 'note-7', 'note-8',
    ]);
    expect(store.record(CHANNEL).materializedCoverage).toEqual([{ lowSeq: 5, highSeq: 8 }]);
  });

  it('memory-window TC-0937: a trim at or below the row limit is a no-op', () => {
    const store = createChannelReplicaStore();
    for (let seq = 1; seq <= 4; seq += 1) store.commit(note(seq), SELF);

    expect(store.trim(CHANNEL, 8)).toBe(0);
    expect(store.trim(CHANNEL, 4)).toBe(0);
    expect([...store.state(CHANNEL).rows.keys()]).toEqual([1, 2, 3, 4]);
  });

  it('memory-window TC-0940: response-first closure chooses the earliest terminal by sequence', () => {
    const store = createChannelReplicaStore();
    store.commit(terminal(3, 'out-of-order'), SELF);
    store.commit(terminal(2, 'out-of-order', 'completed', 'earlier'), SELF);
    for (let seq = 4; seq <= 8; seq += 1) store.commit(note(seq), SELF);

    expect(store.trim(CHANNEL, 4)).toBeGreaterThan(0);
    store.commit(request(1, 'out-of-order'), SELF);
    const turn = store.state(CHANNEL).timeline
      .find((entry) => entry.turn?.requestId === 'out-of-order')?.turn;

    expect(turn).toMatchObject({
      requestId: 'out-of-order', status: 'completed', terminalSeq: 2, terminalClosureOnly: true,
    });
    expect(turn.terminal.id).toBe('out-of-order-terminal-2');
  });

  it('memory-window TC-0941: a retained matched closure keeps a stale queued row completed', () => {
    const store = createChannelReplicaStore();
    store.commit(request(1, 'closed-request'), SELF);
    store.commit(progress(2, 'closed-request'), SELF);
    store.commit(terminal(3, 'closed-request'), SELF);
    for (let seq = 4; seq <= 8; seq += 1) store.commit(note(seq), SELF);

    expect(store.trim(CHANNEL, 4)).toBeGreaterThan(0);
    store.commit(request(1, 'closed-request'), SELF);
    store.commit(progress(2, 'closed-request', 'stale queued work'), SELF);
    const turn = store.state(CHANNEL).timeline
      .find((entry) => entry.turn?.requestId === 'closed-request')?.turn;

    expect(turn).toMatchObject({
      requestId: 'closed-request', status: 'completed', terminalClosureOnly: true,
    });
    expect(turn.provisional.map((item) => item.envelope.id)).toContain('closed-request-progress-2');
  });

  it('memory-window baseline 26: a conflicting terminal cannot replace the first compact closure', () => {
    const store = createChannelReplicaStore();
    const requestID = 'compact-conflict';
    store.commit(terminal(2, requestID), SELF);
    for (let seq = 3; seq <= 10; seq += 1) store.commit(note(seq), SELF);
    expect(store.trim(CHANNEL, 4)).toBeGreaterThan(0);

    store.commit(request(1, requestID), SELF);
    let turn = store.state(CHANNEL).timeline
      .find((entry) => entry.turn?.requestId === requestID)?.turn;
    expect(turn).toMatchObject({ status: 'completed', terminalClosureOnly: true });

    const conflict = terminal(11, requestID, 'failed', 'conflicting terminal');
    conflict.envelope.id = `${requestID}-conflict`;
    store.commit(conflict, SELF);
    turn = store.state(CHANNEL).timeline
      .find((entry) => entry.turn?.requestId === requestID)?.turn;
    expect(turn).toMatchObject({ status: 'completed', terminalClosureOnly: true });
    expect(turn.terminal.id).toBe(`${requestID}-terminal-2`);

    store.commit(terminal(2, requestID), SELF);
    turn = store.state(CHANNEL).timeline
      .find((entry) => entry.turn?.requestId === requestID)?.turn;
    expect(turn).toMatchObject({ status: 'completed', terminalClosureOnly: false });
    expect(turn.terminal.id).toBe(`${requestID}-terminal-2`);
  });

  it('memory-window baseline 27: the earliest ledger terminal stays canonical', () => {
    const store = createChannelReplicaStore();
    const requestID = 'ledger-order-terminal';
    store.commit(request(1, requestID), SELF);
    store.commit(terminal(2, requestID, 'completed', 'first terminal'), SELF);

    const later = terminal(3, requestID, 'failed', 'later conflict');
    later.envelope.id = `${requestID}-later-conflict`;
    store.commit(later, SELF);

    const turn = store.state(CHANNEL).timeline
      .find((entry) => entry.turn?.requestId === requestID)?.turn;
    expect(turn).toMatchObject({ status: 'completed', terminalSeq: 2 });
    expect(turn.terminal.id).toBe(`${requestID}-terminal-2`);
  });

  it('memory-window TC-0946: unmatched provisional progress is evicted without creating a turn', () => {
    const store = createChannelReplicaStore();
    store.commit(progress(1, 'missing-request'), SELF);
    for (let seq = 2; seq <= 8; seq += 1) store.commit(note(seq), SELF);

    expect(store.trim(CHANNEL, 4)).toBeGreaterThan(0);
    expect(store.state(CHANNEL).rows.has(1)).toBe(false);
    expect(store.state(CHANNEL).timeline.some((entry) => entry.turn?.requestId === 'missing-request')).toBe(false);
  });

  it('memory-window TC-0947: a closed turn outside the window leaves no conversation row', () => {
    const store = createChannelReplicaStore();
    store.commit(request(1, 'old-request'), SELF);
    store.commit(terminal(2, 'old-request'), SELF);
    for (let seq = 3; seq <= 8; seq += 1) store.commit(note(seq), SELF);

    expect(store.trim(CHANNEL, 4)).toBeGreaterThan(0);
    const state = store.state(CHANNEL);
    expect(state.timeline.some((entry) => entry.turn?.requestId === 'old-request')).toBe(false);
    expect(selectTimelineItems(state, {
      scope: CONVERSATION_SCOPE.mine, selfId: SELF,
    }).items.some((entry) => entry.turn?.requestId === 'old-request')).toBe(false);
  });

  it('memory-window TC-0948: mine projection contains only the surviving public turns after trim', () => {
    const store = createChannelReplicaStore();
    store.commit(request(1, 'old-request'), SELF);
    store.commit(terminal(2, 'old-request'), SELF);
    store.commit(note(3), SELF);
    store.commit(note(4), SELF);
    store.commit(request(5, 'new-request'), SELF);
    store.commit(terminal(6, 'new-request'), SELF);
    store.commit(note(7), SELF);
    store.commit(note(8), SELF);

    store.trim(CHANNEL, 4);
    const state = store.state(CHANNEL);
    const mine = selectTimelineItems(state, {
      scope: CONVERSATION_SCOPE.mine, selfId: SELF,
    });

    expect(mine.items.map((entry) => entry.turn?.requestId).filter(Boolean)).toEqual(['new-request']);
    expect(mine.items.some((entry) => entry.turn?.requestId === 'old-request')).toBe(false);
  });

  it('memory-window TC-0949: backfilled rows re-enter the public mine projection', () => {
    const store = createChannelReplicaStore();
    for (let index = 0; index < 6; index += 1) {
      const requestID = `q-${index}`;
      store.commit(request(index * 2 + 1, requestID), SELF);
      store.commit(terminal(index * 2 + 2, requestID), SELF);
    }

    store.trim(CHANNEL, 8);
    const before = selectTimelineItems(store.state(CHANNEL), {
      scope: CONVERSATION_SCOPE.mine, selfId: SELF,
    });
    expect(before.items.some((entry) => entry.turn?.requestId === 'q-0')).toBe(false);

    store.commit(request(1, 'q-0'), SELF);
    store.commit(terminal(2, 'q-0'), SELF);
    const after = selectTimelineItems(store.state(CHANNEL), {
      scope: CONVERSATION_SCOPE.mine, selfId: SELF,
    });
    expect(after.items.some((entry) => entry.turn?.requestId === 'q-0')).toBe(true);
  });

  it('management-actors TC-0924: genesis system declarations remain standard identities', () => {
    expect(SYSTEM_DECL_IDS).toEqual(['registrar', 'svcactor']);
    expect(isStandardActorIdentity({ id: 'registrar' })).toBe(true);
    expect(isStandardActorIdentity({ id: 'svcactor' })).toBe(true);
  });

  it('message-presentation TC-1031: the canonical body wrapper is read without surfacing context metadata', () => {
    const row = messageRow(TYPES.member.create, { decl_id: 'reviewer' });
    row.body.envelope.payload = {
      _context: { caller: { channel: CHANNEL, actor: SELF } },
      body: { decl_id: 'reviewer' },
    };
    render(<MessageHarness row={row} />);

    expect(screen.getByText('添加参与者：reviewer')).toBeTruthy();
    expect(screen.queryByText('human:root:1')).toBeNull();
  });

  it('model-selector TC-1060: canonical context truth overrides the available model catalog', () => {
    const selection = currentAgentSelectionWithUsage();
    expect(selection.view.models.map((model) => model.id)).toEqual(['gpt-5.6-sol', 'gpt-5.4']);
    expect(selection.view.current).toEqual({ model: 'gpt-5.6-sol', effort: 'medium' });
  });

  it('model-selector TC-1062: the public projection accepts a capability oneOf catalog', () => {
    const capability = {
      describe: {
        types: new Map([[TYPES.agentSelect, {
          inputSchema: {
            oneOf: [
              { properties: {
                model: { const: 'gpt-5.6-sol', title: '5.6 Sol' },
                effort: { const: 'medium', title: '中等' },
              } },
              { properties: {
                model: { const: 'gpt-5.4', title: '5.4' },
                effort: { const: 'light', title: '轻量' },
              } },
            ],
          },
        }]]),
      },
    };
    const { view } = projectAgentParameters({
      state: { timeline: [] }, actorId: 'steward', requestKeys: {}, capability,
    });

    expect(view.selections.map((row) => `${row.model}:${row.effort}`)).toEqual([
      'gpt-5.6-sol:medium', 'gpt-5.4:light',
    ]);
  });

  it('model-selector TC-1063: changing model chooses its first legal effort when the old effort is absent', () => {
    const commands = { openAgentSelector: vi.fn(), setModelParameters: vi.fn() };
    const selection = currentAgentSelectionWithUsage();
    const model = buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '', recipients: [] },
      roster: [selection.target.agent],
      access: 'member_active',
      agentSelection: selection,
    });
    render(<Composer model={model} commands={commands} />);

    fireEvent.click(screen.getByRole('button', { name: /Steward，模型 5.6 Sol/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^模型/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '5.4' }));

    expect(commands.setModelParameters).toHaveBeenCalledWith({
      actorId: 'steward', model: 'gpt-5.4', effort: 'light',
    });
  });

  it('model-selector TC-1064: the public menu exposes only model and effort levels', () => {
    const selection = currentAgentSelectionWithUsage();
    const model = buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '', recipients: [] },
      roster: [selection.target.agent],
      access: 'member_active',
      agentSelection: selection,
    });
    render(<Composer model={model} commands={{ openAgentSelector: vi.fn() }} />);

    fireEvent.click(screen.getByRole('button', { name: /Steward，模型 5.6 Sol/ }));
    expect(screen.getByRole('menuitem', { name: /^模型/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^推理强度/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Provider' })).toBeNull();
  });

  it('model-selector TC-1065: pending model changes show the target and disable the selector entry', () => {
    const selection = {
      ...currentAgentSelectionWithUsage(),
      pending: {
        actorId: 'steward', state: 'pending',
        value: { model: 'gpt-5.4', effort: 'light' },
      },
    };
    const model = buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '', recipients: [] },
      roster: [selection.target.agent],
      access: 'member_active',
      agentSelection: selection,
    });
    render(<Composer model={model} commands={{ openAgentSelector: vi.fn() }} />);

    const trigger = screen.getByRole('button', { name: /Steward，模型 5.4，推理强度 轻量，切换中/ });
    expect(trigger.disabled).toBe(true);
    expect(screen.getByText('切换中')).toBeTruthy();
  });

  it('model-selector TC-1066: current context usage is visible in the trigger and expanded panel', () => {
    const selection = currentAgentSelectionWithUsage();
    const model = buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '', recipients: [] },
      roster: [selection.target.agent],
      access: 'member_active',
      agentSelection: selection,
    });
    render(<Composer model={model} commands={{ openAgentSelector: vi.fn() }} />);

    expect(screen.getByText('21%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Steward，模型 5.6 Sol/ }));
    expect(screen.getByLabelText('上下文用量 21%')).toBeTruthy();
    expect(screen.getByText('42K / 200K')).toBeTruthy();
  });

  it('model-selector TC-1067: multiple recipients expose a count without a single-agent settings entry', () => {
    const other = { id: 'other', kind: 'agent', name: 'Other' };
    const model = buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '', recipients: [
        { ...currentAgentSelection().target.agent }, other,
      ] },
      roster: [currentAgentSelection().target.agent, other],
      access: 'member_active',
    });
    render(<Composer model={model} commands={{}} />);

    expect(screen.getByLabelText('2 个目标')).toBeTruthy();
    expect(document.querySelector('.model-selector button')).toBeNull();
  });

  it('model-selector TC-1068: no-target delivery offers an explicit public Agent picker', () => {
    const other = { id: 'other', kind: 'agent', name: 'Other' };
    const commands = { selectAgent: vi.fn() };
    const model = buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '', recipients: [] },
      roster: [currentAgentSelection().target.agent, other],
      access: 'member_active',
    });
    render(<Composer model={model} commands={commands} />);

    fireEvent.click(screen.getByRole('button', { name: '选择 Agent' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Other' }));
    expect(commands.selectAgent).toHaveBeenCalledWith('other');
  });

  it('model-selector TC-1069: a cold selector requests options first and opens when the same target becomes ready', () => {
    const commands = { openAgentSelector: vi.fn(), changeDraft: vi.fn() };
    const agent = currentAgentSelection().target.agent;
    const build = (agentSelection) => buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '', recipients: [] },
      roster: [agent],
      access: 'member_active',
      agentSelection,
    });
    const { rerender } = render(<Composer model={build({ target: { kind: 'single', agent }, view: null })} commands={commands} />);

    fireEvent.click(screen.getByRole('button', { name: 'Steward，点击读取可用模型' }));
    expect(commands.openAgentSelector).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();

    rerender(<Composer model={build(currentAgentSelection())} commands={commands} />);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('model-selector TC-1072: options arriving without a user open action do not open the menu', () => {
    const commands = { openAgentSelector: vi.fn() };
    const agent = currentAgentSelection().target.agent;
    const build = (agentSelection) => buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '', recipients: [] },
      roster: [agent],
      access: 'member_active',
      agentSelection,
    });
    const { rerender } = render(<Composer model={build({ target: { kind: 'single', agent }, view: null })} commands={commands} />);
    rerender(<Composer model={build(currentAgentSelection())} commands={commands} />);

    expect(screen.queryByRole('menu')).toBeNull();
    expect(commands.openAgentSelector).not.toHaveBeenCalled();
  });

  it('model-selector baseline 159: expanded selector exposes provider client upgrade status', async () => {
    const user = userEvent.setup();
    const selection = currentAgentSelectionWithUsage();
    const agentSelection = {
      ...selection,
      view: {
        ...selection.view,
        client: {
          name: 'codex',
          current: '0.153.4',
          latest: '0.154.0',
          update_status: 'available',
        },
      },
    };
    const model = buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '', recipients: [] },
      roster: [selection.target.agent],
      access: 'member_active',
      agentSelection,
    });
    render(<Composer model={model} commands={{ openAgentSelector: vi.fn() }} />);

    await user.click(screen.getByRole('button', { name: /Steward，模型 5.6 Sol/ }));
    expect(screen.getByText('0.153.4 · 可升级至 0.154.0')).toBeTruthy();
  });
});

describe('I-M exact-path public-owner recovery (round 38 model contracts)', () => {
  it('model-selector TC-1059: the public capability projection preserves every oneOf pair and title', () => {
    const capability = {
      describe: {
        types: new Map([[TYPES.agentSelect, {
          inputSchema: {
            oneOf: [
              { properties: {
                model: { const: 'gpt-5.6-sol', title: '5.6 Sol' },
                effort: { const: 'medium', title: '中等' },
              } },
              { properties: {
                model: { const: 'gpt-5.6-sol', title: '5.6 Sol' },
                effort: { const: 'high', title: '高' },
              } },
              { properties: {
                model: { const: 'gpt-5.4', title: '5.4' },
                effort: { const: 'light', title: '轻量' },
              } },
            ],
          },
        }]]),
      },
    };
    const { view } = projectAgentParameters({
      state: { timeline: [] }, actorId: 'steward', requestKeys: {}, capability,
    });

    expect(view.source).toBe('describe');
    expect(view.models).toEqual([
      { id: 'gpt-5.6-sol', label: '5.6 Sol', description: '' },
      { id: 'gpt-5.4', label: '5.4', description: '' },
    ]);
    expect(view.selections).toEqual([
      { model: 'gpt-5.6-sol', effort: 'medium', modelLabel: '5.6 Sol', effortLabel: '中等' },
      { model: 'gpt-5.6-sol', effort: 'high', modelLabel: '5.6 Sol', effortLabel: '高' },
      { model: 'gpt-5.4', effort: 'light', modelLabel: '5.4', effortLabel: '轻量' },
    ]);
  });

  it('model-selector TC-1061: options without a current-session context keep current null', () => {
    const { view } = projectAgentParameters({
      state: optionsState('steward'),
      actorId: 'steward',
      requestKeys: { options: 'options' },
    });

    expect(view.current).toBeNull();
    expect(view.selections[0]).toMatchObject({ model: 'gpt-5.6-sol', effort: 'medium' });
  });

  it('model-selector TC-1070: a transient missing view does not close an open same-target panel', async () => {
    const user = userEvent.setup();
    const ready = currentAgentSelection();
    const build = (agentSelection) => buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '', recipients: [] },
      roster: [ready.target.agent],
      access: 'member_active',
      agentSelection,
    });
    const commands = { openAgentSelector: vi.fn(), changeDraft: vi.fn() };
    const { rerender } = render(<Composer model={build(ready)} commands={commands} />);

    await user.click(screen.getByRole('button', { name: 'Steward，模型未知' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    rerender(<Composer model={build({ target: ready.target, view: null })} commands={commands} />);
    rerender(<Composer model={build(ready)} commands={commands} />);

    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('model-selector TC-1071: changing the target closes the prior agent panel', async () => {
    const user = userEvent.setup();
    const steward = currentAgentSelection('steward');
    const other = currentAgentSelection('other');
    const roster = [steward.target.agent, other.target.agent];
    const build = (agentSelection, recipients = []) => buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '', recipients },
      roster,
      access: 'member_active',
      agentSelection,
    });
    const commands = { openAgentSelector: vi.fn(), changeDraft: vi.fn() };
    const { rerender } = render(<Composer model={build(steward)} commands={commands} />);

    await user.click(screen.getByRole('button', { name: 'Steward，模型未知' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    rerender(<Composer model={build(other, [other.target.agent])} commands={commands} />);

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('model-selector TC-1073: an unknown current value remains configurable through the public model menu', async () => {
    const user = userEvent.setup();
    const selection = currentAgentSelection();
    const model = buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '', recipients: [] },
      roster: [selection.target.agent],
      access: 'member_active',
      agentSelection: selection,
    });
    const commands = { setModelParameters: vi.fn().mockResolvedValue(undefined), openAgentSelector: vi.fn() };
    render(<Composer model={model} commands={commands} />);

    await user.click(screen.getByRole('button', { name: 'Steward，模型未知' }));
    await user.click(screen.getByRole('menuitem', { name: /^模型/ }));
    await user.click(screen.getByRole('menuitemradio', { name: '5.4' }));

    expect(commands.setModelParameters).toHaveBeenCalledWith({
      actorId: 'steward', model: 'gpt-5.4', effort: 'light',
    });
  });

  it('model-selector TC-1074: context-only values render read-only state without fabricated choices', async () => {
    const user = userEvent.setup();
    const { view } = projectAgentParameters({
      state: {
        timeline: [completedTurn({
          requestId: 'context-only', actorId: 'claude', type: 'agent.context',
          value: { model: 'claude-opus-5', effort: '', context_tokens: 25_000, context_window: 200_000 },
        })],
      },
      actorId: 'claude',
      requestKeys: { options: '', context: 'context-only' },
    });
    const agent = { id: 'claude', kind: 'agent', name: 'Claude' };
    const model = buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '', recipients: [] },
      roster: [agent],
      access: 'member_active',
      agentSelection: { target: { kind: 'single', agent }, view },
    });
    render(<Composer model={model} commands={{ openAgentSelector: vi.fn() }} />);

    expect(screen.getByText('claude-opus-5')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Claude，模型 claude-opus-5/ }));
    expect(screen.getByRole('dialog', { name: 'Claude Agent 状态' })).toBeTruthy();
    expect(screen.queryByRole('menuitem')).toBeNull();
  });
});

describe('I-M exact-path public-owner recovery (round 16)', () => {
  it('message-presentation TC-1031: flat ledger rows are transport-safe but absent from every public projection', () => {
    const store = createChannelReplicaStore();
    const flatRows = [
      flatEnvelope(1, {
        id: 'flat-request', kind: 'request', type: TYPES.agentAsk, audience: [AGENT],
        body: { text: '旧账本请求' },
      }),
      flatEnvelope(2, {
        id: 'flat-response', kind: 'response', type: TYPES.agentAsk, parentId: 'flat-request',
        sender: AGENT, audience: [SELF], body: { status: 'completed', text: '旧账本响应' },
      }),
      flatEnvelope(3, {
        id: 'flat-event', kind: 'event', type: 'human.note', sender: AGENT, audience: [SELF],
        body: { text: '旧账本事件' },
      }),
      flatEnvelope(4, {
        id: 'flat-orphan-response', kind: 'response', type: 'vendor.custom', sender: AGENT,
        audience: [SELF], body: { status: 'completed', text: '旧账本孤立响应' },
      }),
    ];
    const canonicalEvent = envelope(5, {
      id: 'canonical-event', kind: 'event', type: 'human.note', sender: AGENT, audience: [SELF],
      body: { text: '当前规范事件' },
    });
    const state = store.ensure(CHANNEL).state;
    const release = state.arrivalReceipts.attachPresentationConsumer(Symbol('flat-payload-contract'));
    for (const row of [...flatRows, canonicalEvent]) {
      expect(store.commit({ channel_id: CHANNEL, seq: row.seq, envelope: row.envelope }, SELF, (value) => value, { source: 'live' }).accepted).toBe(true);
    }

    const all = selectTimelineItems(store.state(CHANNEL), {
      scope: CONVERSATION_SCOPE.all, selfId: SELF,
    });
    const mine = selectTimelineItems(store.state(CHANNEL), {
      scope: CONVERSATION_SCOPE.mine, selfId: SELF,
    });
    const presentation = createConversationPresentation();
    const candidate = presentation.evaluate(all.items, {
      epoch: CHANNEL + ':flat-payload', nextViewID: CHANNEL + ':conversation', sourceRevision: 5,
    });

    expect([...store.state(CHANNEL).rows.keys()]).toEqual([1, 2, 3, 4, 5]);
    expect(all.items.map((entry) => entry.envelope?.id || entry.turn?.requestId)).toEqual(['canonical-event']);
    expect(mine.items.map((entry) => entry.envelope?.id || entry.turn?.requestId)).toEqual(['canonical-event']);
    expect(candidate.snapshot.rows.map((row) => row.body.envelope?.id)).toEqual(['canonical-event']);
    expect(store.state(CHANNEL).arrivalReceipts.presentation().events.map((event) => event.rowIDs)).toEqual([['canonical-event']]);
    for (const row of flatRows) {
      expect(notificationDisposition(store.state(CHANNEL), row.envelope, SELF)).toBe('not_presented');
      expect(isRailNotifiableDisposition(notificationDisposition(store.state(CHANNEL), row.envelope, SELF))).toBe(false);
    }
    release();
  });
});

describe('I-M exact-path public-owner recovery (round 27 live contracts)', () => {
  it('live-checkpoint-ordering TC-0918: landing precedes the accepted coverage checkpoint', async () => {
    const options = liveCheckpointOptions();
    const ownerToken = Object.freeze({ principalId: 'round27-live' });
    const runtime = createChannelFeedRuntime(options);
    runtime.bind({ ...options, ownerToken });
    await runtime.getSnapshot().setHistoryGrants([
      { channel_id: CHANNEL, head_seq: 2, has_rows: true },
    ], { generation: 27, boot: 'round27-boot', focus: CHANNEL });

    const owner = runtime.getOwnerSnapshot(ownerToken);
    expect(owner.enqueue({
      source: 'live', generation: 27, channel_id: CHANNEL, seq: 1,
      envelope: { id: 'round27-live-1', kind: 'event', type: 'human.note', payload: { body: { text: 'one' } } },
    })).toBe(true);
    expect(owner.enqueue({
      source: 'live', generation: 27, channel_id: CHANNEL, seq: 2,
      envelope: { id: 'round27-live-2', kind: 'event', type: 'human.note', payload: { body: { text: 'two' } } },
    })).toBe(true);

    expect(owner.liveCheckpoint({
      generation: 27, channel_id: CHANNEL, scan_low_seq: 1, scanned_seq: 2,
    })).toBe(true);
    expect([...runtime.getSnapshot().stateFor(CHANNEL).rows.keys()]).toEqual([1, 2]);
    expect(runtime.getSnapshot().historyFor(CHANNEL).controlCoverage).toEqual([
      { lowSeq: 1, highSeq: 2 },
    ]);
    runtime.destroy();
  });

  it('live-checkpoint-ordering TC-0919: an empty checkpoint never fabricates a live row', async () => {
    const options = liveCheckpointOptions();
    const ownerToken = Object.freeze({ principalId: 'round27-empty' });
    const runtime = createChannelFeedRuntime(options);
    runtime.bind({ ...options, ownerToken });
    await runtime.getSnapshot().setHistoryGrants([
      { channel_id: CHANNEL, head_seq: 0, has_rows: false },
    ], { generation: 27, boot: 'round27-empty-boot', focus: CHANNEL });

    const owner = runtime.getOwnerSnapshot(ownerToken);
    expect(owner.liveCheckpoint({
      generation: 27, channel_id: CHANNEL, scan_low_seq: 1, scanned_seq: 1,
    })).toBe(true);
    expect(runtime.getSnapshot().stateFor(CHANNEL).rows.size).toBe(0);
    expect(runtime.getSnapshot().stateFor(CHANNEL).timeline).toEqual([]);
    expect(runtime.getSnapshot().historyFor(CHANNEL).controlCoverage).toEqual([
      { lowSeq: 1, highSeq: 1 },
    ]);
    runtime.destroy();
  });

  it('live-presentation-arrivals TC-0920: only an attached consumer receives a live backlog', () => {
    const store = createChannelReplicaStore();
    const state = store.ensure(CHANNEL).state;
    store.commit(request(1, 'before-round27-mount'), SELF, (value) => value, { source: 'live' });
    expect(state.arrivalReceipts.presentation().events).toEqual([]);

    const release = state.arrivalReceipts.attachPresentationConsumer(Symbol('round27-timeline'));
    store.commit(request(2, 'during-round27-mount'), SELF, (value) => value, { source: 'live' });
    expect(state.arrivalReceipts.presentation().events).toEqual([
      expect.objectContaining({ rowIDs: ['during-round27-mount'], sourceRevision: 2 }),
    ]);

    release();
    expect(state.arrivalReceipts.presentation().events).toEqual([]);
    store.commit(request(3, 'after-round27-release'), SELF, (value) => value, { source: 'live' });
    expect(state.arrivalReceipts.presentation().events).toEqual([]);
  });

  it('live-presentation-arrivals TC-0921: acknowledging one source prefix leaves the later event', () => {
    const store = createChannelReplicaStore();
    const state = store.ensure(CHANNEL).state;
    state.arrivalReceipts.attachPresentationConsumer(Symbol('round27-prefix'));
    store.commit(request(1, 'round27-first'), SELF, (value) => value, { source: 'live' });
    store.commit(request(2, 'round27-second'), SELF, (value) => value, { source: 'live' });

    const first = state.arrivalReceipts.presentation(1);
    expect(first).toMatchObject({ revision: 1, headRevision: 2 });
    expect(first.events.map((event) => event.rowIDs[0])).toEqual(['round27-first']);
    expect(state.arrivalReceipts.dispatch(acknowledgeLivePresentationArrivals(first.revision))).toBe(1);
    expect(state.arrivalReceipts.presentation(2).events.map((event) => event.rowIDs[0])).toEqual([
      'round27-second',
    ]);
  });

  it('live-presentation-arrivals TC-0922: a response arrival keeps root and exact envelope identities', () => {
    const store = createChannelReplicaStore();
    const state = store.ensure(CHANNEL).state;
    state.arrivalReceipts.attachPresentationConsumer(Symbol('round27-response'));
    store.commit(request(1, 'round27-root'), SELF, (value) => value, { source: 'live' });
    state.arrivalReceipts.dispatch(acknowledgeLivePresentationArrivals(1));

    store.commit(progress(2, 'round27-root', 'round27-progress'), SELF, (value) => value, { source: 'live' });
    expect(state.arrivalReceipts.presentation(2).events).toEqual([
      expect.objectContaining({ rowIDs: ['round27-root', 'round27-root-progress-2'], sourceRevision: 2 }),
    ]);
  });
});

describe('I-M exact-path public-owner recovery (round 28 projection contracts)', () => {
  it('management-actors TC-0923: business roster hides the system actor while governance keeps its route', () => {
    const rows = [
      { id: SYSTEM_ACTOR_ID, kind: 'system' },
      { id: AGENT, kind: 'agent', name: 'Steward' },
    ];
    expect(rows.filter(isVisibleActor).map((row) => row.id)).toEqual([AGENT]);

    const model = buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '/members', recipients: [] },
      roster: [rows[1]],
      access: 'member_active',
      agentSelection: { target: { kind: 'single', agent: rows[1] } },
    });
    expect(createComposerCommandRequest(model, parseComposerCommand('/members'))).toMatchObject({
      channelId: CHANNEL,
      msgType: TYPES.member.list,
      audience: [SYSTEM_ACTOR_ID],
    });
  });

  it('markdown-content TC-0925: math renders while fenced and inline code remain literal', () => {
    const tick = String.fromCharCode(96);
    const source = [
      '行内 \\(M_t = \\operatorname{Fold}_R(H_t)\\) 与 $G_t$.',
      '',
      '\\[',
      '\\text{Problem}\\rightarrow\\text{Machine}',
      '\\]',
      '',
      tick + '\\(not math\\)' + tick,
      '',
      tick.repeat(3) + 'tex',
      '\\[not math\\]',
      tick.repeat(3),
    ].join('\n');
    const { container } = render(<MarkdownContent text={source} />);

    expect(container.querySelectorAll('.katex')).toHaveLength(3);
    expect(container.querySelectorAll('.katex-display')).toHaveLength(1);
    expect(container.querySelector('code').textContent).toBe('\\(not math\\)');
    expect(container.querySelector('pre code').textContent).toContain('\\[not math\\]');
  });

  it('markdown-content TC-0926: delimiter normalization is paired, unescaped, and code-scoped', () => {
    const tick = String.fromCharCode(96);
    const source = '\\(x\\) ' + tick + '\\(code\\)' + tick + ' \\\\(literal\\\\) \\[y\\] \\[unclosed';
    const expected = '$x$ ' + tick + '\\(code\\)' + tick + ' \\\\(literal\\\\) $$y$$ \\[unclosed';
    expect(normalizeMathMarkdown(source)).toBe(expected);
  });

  it('markdown-content TC-0927: the public renderer preserves GFM table/task/link semantics', () => {
    const source = [
      '| 名称 | 状态 |',
      '| --- | --- |',
      '| 报告 | 完成 |',
      '',
      '- [x] 已核对',
      '',
      '~~旧结论~~ [来源](https://example.com)',
    ].join('\n');
    const { container } = render(<MarkdownContent text={source} />);

    expect(container.querySelector('table')).toBeTruthy();
    expect(container.querySelector('input[type="checkbox"]')?.disabled).toBe(true);
    expect(container.querySelector('del')?.textContent).toBe('旧结论');
    expect(screen.getByRole('link', { name: '来源' }).getAttribute('target')).toBe('_blank');
  });

  it('markdown-content TC-0928: ledger HTML remains inert instead of becoming executable DOM', () => {
    const { container } = render(
      <MarkdownContent text={'<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>'} />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('mock-protocol TC-1047: malformed or unknown upstream fields return explicit validation errors', () => {
    expect(validatePayload('submit', { channel_id: CHANNEL })).toContain('msg_type');
    expect(validatePayload('submit', {
      channel_id: CHANNEL, msg_type: TYPES.agentAsk, extra: true,
    })).toContain('unknown field: extra');
    expect(validatePayload('missing', {})).toContain('unknown upstream frame_type');
  });
});

describe('I-M exact-path public-owner recovery (round 29 protocol contracts)', () => {
  it('markdown-content TC-0929: unsafe URL protocols are filtered at the public renderer boundary', () => {
    const { container } = render(<MarkdownContent text="[危险](javascript:alert%281%29)" />);
    expect(container.querySelector('a').getAttribute('href')).toBe('');
  });

  it('markdown-content TC-0930: explicit file links stay in-app while web links stay external', () => {
    const onOpen = vi.fn();
    render(
      <MarkdownFileReferenceProvider onOpen={onOpen}>
        <MarkdownContent text={'[代码](/srv/atoll/work/main.go:42) [网页](https://example.com)'} />
      </MarkdownFileReferenceProvider>,
    );

    const file = screen.getByRole('link', { name: '代码' });
    expect(file.getAttribute('target')).toBeNull();
    expect(file.classList.contains('markdown-file-reference')).toBe(true);
    fireEvent.click(file);
    expect(onOpen).toHaveBeenCalledWith({ path: '/srv/atoll/work/main.go', line: 42 });
    expect(screen.getByRole('link', { name: '网页' }).getAttribute('target')).toBe('_blank');
  });

  it('markdown-content TC-0931: prepared content resolves the current file-open provider', () => {
    const firstOpen = vi.fn();
    const nextOpen = vi.fn();
    const view = render(
      <MarkdownFileReferenceProvider onOpen={firstOpen}>
        <MarkdownContent contentKey="message:round29:context" text={'[代码](/srv/atoll/work/main.go:42)'} />
      </MarkdownFileReferenceProvider>,
    );
    view.rerender(
      <MarkdownFileReferenceProvider onOpen={nextOpen}>
        <MarkdownContent contentKey="message:round29:context" text={'[代码](/srv/atoll/work/main.go:42)'} />
      </MarkdownFileReferenceProvider>,
    );

    fireEvent.click(view.container.querySelector('a.markdown-file-reference'));
    expect(firstOpen).not.toHaveBeenCalled();
    expect(nextOpen).toHaveBeenCalledWith({ path: '/srv/atoll/work/main.go', line: 42 });
  });

  it('markdown-content TC-0932: ordinary text and non-absolute links are never guessed as file references', () => {
    const onOpen = vi.fn();
    const tick = String.fromCharCode(96);
    const text = '/srv/a.go:2 ' + tick + '/srv/b.go:3' + tick
      + ' [相对](docs/a.md) [站点](//example.com/a)';
    const { container } = render(
      <MarkdownFileReferenceProvider onOpen={onOpen}>
        <MarkdownContent text={text} />
      </MarkdownFileReferenceProvider>,
    );
    expect(container.querySelectorAll('.markdown-file-reference')).toHaveLength(0);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('message-time TC-1032: a same-day message projects only its local clock', () => {
    const now = new Date(2026, 7, 27, 9, 30).getTime();
    expect(messageTimeLabel(new Date(2026, 7, 27, 0, 5).getTime(), now)).toBe('00:05');
    expect(messageTimeLabel(new Date(2026, 7, 27, 23, 59).getTime(), now)).toBe('23:59');
  });

  it('message-time TC-1035: absent timestamps project to an empty label', () => {
    const now = new Date(2026, 7, 27, 9, 30).getTime();
    expect(messageTimeLabel(0, now)).toBe('');
    expect(messageTimeLabel(undefined, now)).toBe('');
  });

  it('mock-protocol TC-1048: every minimal closed-set upstream payload validates', () => {
    const values = {
      attach: { focus: '', history_protocol: 5, generation: 1 },
      submit: { channel_id: CHANNEL, msg_type: TYPES.agentAsk },
      resolve: { channel_id: CHANNEL, req_id: 'r', decision: 'approved' },
      cancel: { channel_id: CHANNEL, req_id: 'r' },
      after: { channel_id: CHANNEL, duration_ms: 1, msg_type: TYPES.agentAsk },
      cancel_timer: { channel_id: CHANNEL, timer_id: 't' },
      resource: { channel_id: CHANNEL, op: 'list' },
      observe: { channel_id: 'c1' },
      unobserve: { channel_id: 'c1' },
      channel_meta: { channel_id: 'c1', generation: 1 },
      history_before: {
        channel_id: 'c1', before_seq: 10, limit: 50, generation: 1,
        purpose: 'hydrate', priority: 'background',
      },
      history_cancel: { channel_id: 'c1', target_ref: 'history-before-1', generation: 1 },
    };
    for (const [type, payload] of Object.entries(values)) {
      expect(validatePayload(type, payload)).toBe('');
    }
  });

  it('mock-protocol TC-1050: resource validation follows the operation-specific field contract', () => {
    expect(validatePayload('resource', { channel_id: CHANNEL, op: 'list' })).toBe('');
    expect(validatePayload('resource', {
      channel_id: CHANNEL, op: 'create', address: 'daemon://d/c0/file.txt', with_content: true,
    })).toBe('');
    expect(validatePayload('resource', { channel_id: CHANNEL, op: 'create' }))
      .toContain('resource_id or address');
    expect(validatePayload('resource', { channel_id: CHANNEL, op: 'read' }))
      .toContain('requires resource_id');
    expect(validatePayload('resource', { channel_id: CHANNEL, op: 'explode' }))
      .toContain('op must be one of');
  });

  it('mock-protocol TC-1051: a non-positive timer duration returns a validation error', () => {
    expect(validatePayload('after', {
      channel_id: CHANNEL, duration_ms: 0, msg_type: TYPES.agentAsk,
    })).toContain('positive');
  });
});

describe('I-M exact-path public-owner recovery (round 30 projection and wire contracts)', () => {
  it('markdown-content TC-0933: image decoding keeps one stable media frame', () => {
    const { container } = render(<MarkdownContent text={'![架构图](https://example.com/diagram.png)'} />);
    const frame = container.querySelector('[data-viewport-stable-media="image"]');
    const image = frame.querySelector('img');

    expect(frame.dataset.imagePhase).toBe('loading');
    fireEvent.load(image);
    expect(frame.dataset.imagePhase).toBe('ready');
    expect(container.querySelector('[data-viewport-stable-media="image"]')).toBe(frame);
  });

  it('markdown-content TC-0934: semantic block ids survive prefix insertion and streaming growth', () => {
    const view = render(<MarkdownContent contentKey="message:round30:stable" text={'第一段\n\n保留段落'} />);
    const ids = () => Object.fromEntries([...view.container.querySelectorAll('[data-reading-block-id]')]
      .map((node) => [node.textContent, node.dataset.readingBlockId]));
    const initial = ids();

    view.rerender(<MarkdownContent contentKey="message:round30:stable" text={'新前文\n\n第一段\n\n保留段落'} />);
    expect(ids()['第一段']).toBe(initial['第一段']);
    expect(ids()['保留段落']).toBe(initial['保留段落']);
    const beforeGrowth = ids()['保留段落'];
    view.rerender(<MarkdownContent contentKey="message:round30:stable" text={'新前文\n\n第一段\n\n保留段落继续生成'} />);
    expect(ids()['保留段落继续生成']).toBe(beforeGrowth);
  });

  it('markdown-content TC-0935: completed block DOM and native selection survive tail streaming', () => {
    const view = render(<MarkdownContent contentKey="message:round30:selection" text={'已完成段落\n\n生成中'} />);
    const sealed = [...view.container.querySelectorAll('[data-reading-block-id]')]
      .find((node) => node.textContent === '已完成段落');
    const textNode = sealed.querySelector('p').firstChild;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 3);
    getSelection().removeAllRanges();
    getSelection().addRange(range);

    view.rerender(<MarkdownContent contentKey="message:round30:selection" text={'已完成段落\n\n生成中继续'} />);
    const surviving = [...view.container.querySelectorAll('[data-reading-block-id]')]
      .find((node) => node.textContent === '已完成段落');

    expect(surviving.isSameNode(sealed)).toBe(true);
    expect(surviving.querySelector('p').firstChild.isSameNode(textNode)).toBe(true);
    expect(getSelection().anchorNode?.isSameNode(textNode)).toBe(true);
    expect(getSelection().toString()).toBe('已完成');
  });

  it('message-time TC-1033: an older same-year message includes day and clock once', () => {
    const now = new Date(2026, 7, 27, 9, 30).getTime();
    expect(messageTimeLabel(new Date(2026, 7, 26, 23, 59).getTime(), now)).toBe('8/26 23:59');
    expect(messageTimeLabel(new Date(2026, 0, 3, 8, 0).getTime(), now)).toBe('1/3 08:00');
  });

  it('message-time TC-1034: a prior-year message includes the year, day, and clock', () => {
    const now = new Date(2026, 7, 27, 9, 30).getTime();
    expect(messageTimeLabel(new Date(2025, 11, 31, 18, 45).getTime(), now))
      .toBe('2025/12/31 18:45');
  });

  it('mock-protocol TC-1046: the public wire frame remains versioned and closed-set', () => {
    expect(FRAME_VERSION).toBe(5);
    expect(MAX_FRAME_BYTES).toBe(512 * 1024);
    expect(Object.keys(PAYLOAD_FIELDS).sort()).toEqual([
      'after', 'attach', 'cancel', 'cancel_timer', 'channel_meta', 'history_before',
      'history_cancel', 'observe', 'resolve', 'resource', 'submit', 'unobserve',
    ]);
    expect(downstreamFrame('receipt', 'r1', { message_id: 'm1' })).toEqual({
      v: 5,
      frame_type: 'receipt',
      ref: 'r1',
      payload: { message_id: 'm1' },
    });
  });

  it('mock-protocol TC-1049: attach accepts a string client label and rejects non-string labels', () => {
    expect(validatePayload('attach', {
      focus: '', history_protocol: 5, generation: 1, label: 'Mac Chrome',
    })).toBe('');
    expect(validatePayload('attach', {
      focus: '', history_protocol: 5, generation: 1, label: 42,
    })).toContain('label must be a string');
  });

  it('mock-scenarios TC-1052: the public scenario catalog retains every supported flow', () => {
    expect(scenarioIds()).toEqual(expect.arrayContaining([
      'first-login', 'multi-channel', 'deep-history-delayed', 'message-flow', 'approval', 'network-drop',
      'permission-revoked', 'channel-retired', 'projection-delay', 'actor-capability',
      'channel-governance', 'space-governance', 'resource-workflow', 'scheduled-action',
      'message-structured-success', 'message-empty-success', 'message-failed',
      'business-provisional', 'provisional-after-terminal', 'terminal-conflict',
      'receipt-delayed', 'feed-delayed', 'receipt-lost-feed-landed', 'obs-partial',
      'real-backend-shape',
    ]));
  });

  it('mock-scenarios TC-1053: channel availability and membership independently gate access', () => {
    const domain = createMockDomain(loadScenario('message-structured-success'));
    expect(domain.behavior.message).toBe('structured');
    expect(domain.setChannelOpen('c0.project', false).open).toBe(false);
    expect(domain.canWrite('root', 'c0.project')).toBe(false);
    domain.setChannelOpen('c0.project', true);
    domain.revokeMembership('root', 'c0.project');
    expect(domain.canRead('root', 'c0.project')).toBe(false);
    expect(domain.grantMembership('root', 'c0.project')).toMatchObject({ status: 'active' });
    expect(domain.canWrite('root', 'c0.project')).toBe(true);
  });

  it('mock-scenarios TC-1055: space discovery stays separate from active membership', () => {
    const domain = createMockDomain(loadScenario('multi-channel'));
    expect(domain.channelRows('c0').map((item) => item.declared.id)).toEqual(['c0.project', 'c0.public']);
    expect(domain.attachMemberships('root').map((entry) => entry.channel_id)).toEqual(['c0', 'c0.project']);
    expect(domain.canRead('root', 'c0.public')).toBe(false);
    expect(domain.canWrite('root', 'c0.project')).toBe(true);
  });
});

describe('I-M exact-path public-owner recovery (round 31 media and scenario contracts)', () => {
  it('mermaid-block TC-0954: a diagram renders and its source toggle preserves focus', async () => {
    vi.useRealTimers();
    mermaidMock.render.mockResolvedValue({ svg: '<svg data-diagram="round31"><text>A</text></svg>' });
    const tick = String.fromCharCode(96);
    const source = tick.repeat(3) + 'mermaid\n' + 'graph LR\n  A --> B\n' + tick.repeat(3);
    const { container } = render(<MarkdownContent text={source} />);

    await waitFor(() => expect(container.querySelector('svg[data-diagram="round31"]')).toBeTruthy());
    expect(mermaidMock.render).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-/), 'graph LR\n  A --> B');
    const toggle = screen.getByRole('button', { name: '查看源码' });
    toggle.focus();
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: '查看图表' })).toBe(toggle);
    expect(document.activeElement).toBe(toggle);
    expect(container.querySelector('pre code').textContent).toContain('graph LR');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: '查看源码' })).toBe(toggle);
    expect(document.activeElement).toBe(toggle);
  });

  it('mermaid-block TC-0955: syntax errors stay local while source and sibling text remain visible', async () => {
    vi.useRealTimers();
    mermaidMock.render.mockRejectedValue(new Error('Parse error on line 2'));
    const tick = String.fromCharCode(96);
    const source = '前文\n\n' + tick.repeat(3) + 'mermaid\nbroken\n' + tick.repeat(3) + '\n\n后文';
    const { container } = render(<MarkdownContent text={source} />);

    await screen.findByRole('alert');
    expect(screen.getByText('图表语法有误')).toBeTruthy();
    expect(container.querySelector('pre code').textContent).toContain('broken');
    expect(container.textContent).toContain('前文');
    expect(container.textContent).toContain('后文');
  });

  it('mermaid-block TC-0956: parent rerenders do not redraw an unchanged diagram', async () => {
    vi.useRealTimers();
    mermaidMock.render.mockResolvedValue({ svg: '<svg data-diagram="stable"><text>A</text></svg>' });
    const tick = String.fromCharCode(96);
    const source = tick.repeat(3) + 'mermaid\ngraph LR\n  A --> B\n' + tick.repeat(3);
    const view = render(<MarkdownContent text={source} />);
    await waitFor(() => expect(view.container.querySelector('svg[data-diagram="stable"]')).toBeTruthy());

    view.rerender(<MarkdownContent text={source} className="parent-refreshed" />);
    await Promise.resolve();
    expect(mermaidMock.render).toHaveBeenCalledTimes(1);
    view.rerender(<MarkdownContent text={source + '\n\n后续流式文本'} className="parent-refreshed" />);
    await Promise.resolve();
    expect(mermaidMock.render).toHaveBeenCalledTimes(1);
  });

  it('mermaid-block TC-0957: StrictMode effect probing does not issue a duplicate render', async () => {
    vi.useRealTimers();
    mermaidMock.render.mockResolvedValue({ svg: '<svg data-diagram="strict" />' });
    const tick = String.fromCharCode(96);
    const source = tick.repeat(3) + 'mermaid\ngraph TD\nA-->B\n' + tick.repeat(3);
    const { container } = render(<React.StrictMode><MarkdownContent text={source} /></React.StrictMode>);

    await waitFor(() => expect(container.querySelector('svg[data-diagram="strict"]')).toBeTruthy());
    expect(mermaidMock.render).toHaveBeenCalledTimes(1);
  });

  it('mermaid-block TC-0958: remounting a recycled diagram reuses its SVG cache', async () => {
    vi.useRealTimers();
    mermaidMock.render.mockResolvedValue({ svg: '<svg data-diagram="cached" />' });
    const tick = String.fromCharCode(96);
    const source = tick.repeat(3) + 'mermaid\ngraph LR\ncache-->stable\n' + tick.repeat(3);
    const first = render(<MarkdownContent text={source} />);
    await waitFor(() => expect(first.container.querySelector('svg[data-diagram="cached"]')).toBeTruthy());
    first.unmount();

    const second = render(<MarkdownContent text={source} />);
    expect(second.container.querySelector('svg[data-diagram="cached"]')).toBeTruthy();
    expect(mermaidMock.render).toHaveBeenCalledTimes(1);
  });

  it('mermaid-block TC-0959: shared render work gives each mounted SVG a unique reference id', async () => {
    vi.useRealTimers();
    mermaidMock.render.mockResolvedValue({
      svg: '<svg id="canonical"><defs><marker id="arrow"><path /></marker></defs><path class="edge" marker-end="url(#arrow)" /></svg>',
    });
    const tick = String.fromCharCode(96);
    const diagram = tick.repeat(3) + 'mermaid\ngraph LR\nA-->B\n' + tick.repeat(3);
    const { container } = render(<MarkdownContent text={diagram + '\n\n' + diagram} />);

    await waitFor(() => expect(container.querySelectorAll('.mermaid-diagram svg')).toHaveLength(2));
    const markerIds = [...container.querySelectorAll('.mermaid-diagram marker')].map((node) => node.id);
    expect(mermaidMock.render).toHaveBeenCalledTimes(1);
    expect(new Set(markerIds).size).toBe(2);
  });

  it('mock-scenarios TC-1054: an authenticated principal never gains lobby membership', () => {
    for (const id of scenarioIds()) {
      const domain = createMockDomain(loadScenario(id));
      expect(domain.activeMembership('root', 'c0.lobby')).toBeNull();
      expect(domain.canRead('root', 'c0.lobby')).toBe(false);
    }
  });

  it('mock-scenarios TC-1056: daemon file projections stay isolated by channel prefix', () => {
    const domain = createMockDomain(loadScenario('multi-channel'));
    const projectPrefix = 'daemon://local-device/c0.project/';
    const projectFiles = domain.resource('c0.project', { op: 'list', query: { prefix: projectPrefix } }).items
      .map((row) => row.id);
    const projectDoc = projectPrefix + encodeURIComponent('项目说明.md');
    const docsPrefix = projectPrefix + 'docs/';
    const designDoc = projectPrefix + 'docs/' + encodeURIComponent('交互设计.md');

    expect(projectFiles).toEqual(expect.arrayContaining([
      projectDoc, projectPrefix + 'docs', projectPrefix + 'reports', projectPrefix + 'data',
    ]));
    expect(domain.resource('c0.project', {
      op: 'list', query: { prefix: docsPrefix },
    }).items.map((row) => row.id)).toContain(designDoc);
    expect(projectFiles.every((address) => address.startsWith(projectPrefix))).toBe(true);
    expect(domain.resource('c0', {
      op: 'list', query: { prefix: 'daemon://local-device/c0/' },
    }).items.map((row) => row.id)).not.toContain(projectFiles[0]);
  });

  it('mock-scenarios TC-1057: the same scenario seed and clock actions are deterministic', () => {
    const left = createMockDomain(loadScenario('permission-revoked', 9));
    const right = createMockDomain(loadScenario('permission-revoked', 9));
    expect(left.nextId('request')).toBe(right.nextId('request'));
    left.advance(5_000);
    right.advance(5_000);
    expect(left.snapshot()).toEqual(right.snapshot());
    expect(left.canWrite('root', 'c0.project')).toBe(false);
  });

  it('mock-scenarios TC-1058: scheduled retirement closes a channel at its public deadline', () => {
    const domain = createMockDomain(loadScenario('channel-retired'));
    domain.advance(4_999);
    expect(domain.channel('c0.project').status).toBe('present');
    domain.advance(1);
    expect(domain.channel('c0.project')).toMatchObject({ status: 'retired', open: false });
  });
});

describe('I-M exact-path public-owner recovery (round 32 rendering and access contracts)', () => {
  it('message-layout-state TC-0960: recycled rows retain their own geometry choices', () => {
    const store = createMessageLayoutStore();
    const ui = (id, shown = true) => (
      <MessageLayoutProvider store={store}>
        <MessageLayoutScope rowID={id}>{shown && <LayoutChoice key={id} />}</MessageLayoutScope>
      </MessageLayoutProvider>
    );
    const view = render(ui('a'));
    fireEvent.click(view.getByRole('button'));
    view.rerender(ui('a', false));
    view.rerender(ui('b'));
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('false');
    view.rerender(ui('a'));
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true');
  });

  it('message-layout-state TC-0961: durable layout choices survive sessions without viewport leakage', () => {
    const sessions = createViewSessionStore();
    const store = createMessageLayoutStore([], (layoutChoices) => sessions.writeConversation('round32', { layoutChoices }));
    store.set('expanded', ['child-a'], []);
    const copy = sessions.read('round32');
    copy.layoutChoices[0][1].push('not-persisted');

    expect(sessions.read('round32').layoutChoices).toEqual([['expanded', ['child-a']]]);
    expect(sessions.read('round32')).not.toHaveProperty('viewportSnapshot');
    expect(sessions.read('other').layoutChoices).toEqual([]);
    expect(createMessageLayoutStore(sessions.read('round32').layoutChoices).get('expanded', []))
      .toEqual(['child-a']);
  });

  it('message-layout-state TC-0962: Mermaid source geometry survives row recycle', async () => {
    vi.useRealTimers();
    mermaidMock.render.mockResolvedValue({ svg: '<svg data-diagram="layout-round32" />' });
    const store = createMessageLayoutStore();
    const ui = (shown) => (
      <MessageLayoutProvider store={store}>
        <MessageLayoutScope rowID="round32-message">
          {shown && <MermaidBlock code="graph TD; A-->B" layoutKey="body:round32" />}
        </MessageLayoutScope>
      </MessageLayoutProvider>
    );
    let view;
    await act(async () => { view = render(ui(true)); });
    await waitFor(() => expect(view.container.querySelector('svg[data-diagram="layout-round32"]')).toBeTruthy());
    fireEvent.click(view.getByRole('button', { name: '查看源码' }));
    view.rerender(ui(false));
    await act(async () => view.rerender(ui(true)));
    expect(view.getByRole('button', { name: '查看图表' }).isConnected).toBe(true);
  });

  it('message-layout-state TC-0963: standalone subscriptions notify only the affected row', () => {
    const store = createMessageLayoutStore();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = store.subscribe('round32-a', first);
    store.subscribe('round32-b', second);

    store.set('round32-a', true, false);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    unsubscribe();
    store.set('round32-a', false, true);
    expect(first).toHaveBeenCalledTimes(1);
    const view = render(
      <MessageLayoutProvider store={store}>
        <MessageLayoutScope rowID="round32-a"><LayoutChoice /></MessageLayoutScope>
      </MessageLayoutProvider>,
    );
    fireEvent.click(view.getByRole('button'));
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true');
  });

  it('mock-governance TC-1036: structured governance results converge public channel and actor projections', async () => {
    const h = await connectMockScenario('multi-channel');
    const listRequest = { ...mockRequest('round32-channel-list', 'system.channel.list'), audience: ['system'] };
    const listReceipt = await h.wire.submit(listRequest);
    const list = await waitForMock(() => mockTerminal(h.feeds, listReceipt.message_id), 'channel list terminal');
    expect(list.payload.body.status).toBe('completed');
    expect(list.payload.body.value.map((channel) => channel.id))
      .toEqual(expect.arrayContaining(['c0', 'c0.project', 'c0.public']));
    expect(list.payload.body.value.some((channel) => channel.id === 'c0.lobby')).toBe(false);

    const createRequest = { ...mockRequest('round32-member-create', 'system.member.create', { decl_id: 'mock:analyst' }), audience: ['system'] };
    const createReceipt = await h.wire.submit(createRequest);
    const created = await waitForMock(() => mockTerminal(h.feeds, createReceipt.message_id), 'member create terminal');
    const memberId = created.payload.body.member;
    const actors = await h.fetchSession('/obs/channel/c0/actors').then((response) => response.json());
    expect(actors.items.map((entry) => entry.declared.id)).toContain(memberId);
    h.wire.close();
  });

  it('mock-phase-b TC-1037: membership arrives through attach and actor projections omit mock principals', async () => {
    const h = await connectMockScenario('real-backend-shape');
    expect((await h.fetchSession('/obs/space/memberships')).status).toBe(404);
    expect(h.attachDetail.memberships_complete).toBe(true);
    expect(h.attachDetail.memberships.map((entry) => entry.channel_id)).toContain(CHANNEL);
    h.wire.close();
    const actors = await h.fetchSession('/obs/channel/c0/actors').then((response) => response.json());
    expect(actors.items.find((item) => item.declared.kind === 'human').declared)
      .not.toHaveProperty('principal');
  });

  it('mock-phase-b TC-1038: same client retries are idempotent while conflicting payloads fail', async () => {
    const h = await connectMockScenario('message-flow');
    const frame = mockRequest('round32-stable-id', 'agent.ask', { text: 'same' });
    await expect(h.wire.submit(frame)).resolves.toMatchObject({ message_id: 'round32-stable-id' });
    await waitForMock(() => h.feeds.some((row) => row.envelope.id === 'round32-stable-id'), 'first feed');
    await expect(h.wire.submit(frame)).resolves.toMatchObject({ message_id: 'round32-stable-id' });
    expect(h.feeds.filter((row) => row.envelope.id === 'round32-stable-id')).toHaveLength(1);
    await expect(h.wire.submit({ ...frame, payload: { text: 'changed' } }))
      .rejects.toMatchObject({ code: 'idempotency_conflict' });
    h.wire.close();
  });

  it('mock-phase-c TC-1039: Describe exposes typed capabilities and a structured result', async () => {
    const h = await connectMockScenario('actor-capability');
    const describeReceipt = await h.wire.submit(mockRequest('round32-describe', 'actor.describe'));
    const describe = await waitForMock(
      () => mockTerminal(h.feeds, describeReceipt.message_id),
      'actor describe terminal',
    );
    expect(describe.payload.body).toMatchObject({ class: 'codex', interfaces: ['actor', 'agent'] });
    expect(describe.payload.body.words['mock.order.create']).toMatchObject({
      input_schema: { type: 'object', required: ['name', 'count'] },
    });
    const orderReceipt = await h.wire.submit(mockRequest(
      'round32-order', 'mock.order.create', { name: 'round32', count: 4, priority: 'urgent', notify: true },
    ));
    const order = await waitForMock(() => mockTerminal(h.feeds, orderReceipt.message_id), 'order terminal');
    expect(order.payload.body).toMatchObject({
      status: 'completed',
      value: { accepted: true, name: 'round32', count: 4, priority: 'urgent', notify: true },
    });
    h.wire.close();
  });

  it('mock-phase-c TC-1040: cancel receipt is distinct from cancelled terminal and errors remain stable', async () => {
    const h = await connectMockScenario('long-running');
    await h.wire.submit(mockRequest('round32-cancel', 'agent.ask', { text: '持续运行' }));
    await waitForMock(
      () => h.feeds.some((row) => row.envelope.parent_id === 'round32-cancel'
        && row.envelope.payload?.body?.turn_id),
      'processing turn',
    );
    await expect(h.wire.cancel({ channel_id: CHANNEL, req_id: 'round32-cancel' }))
      .resolves.toEqual({ req_id: 'round32-cancel' });
    expect(mockTerminal(h.feeds, 'round32-cancel')).toBeUndefined();
    const cancelled = await waitForMock(
      () => mockTerminal(h.feeds, 'round32-cancel'),
      'cancelled terminal',
    );
    expect(cancelled.payload.body).toMatchObject({ status: 'failed', cancelled: true });
    await expect(h.wire.cancel({ channel_id: CHANNEL, req_id: 'round32-cancel' }))
      .rejects.toMatchObject({ code: 'already_closed' });
    await expect(h.wire.cancel({ channel_id: CHANNEL, req_id: 'missing-round32' }))
      .rejects.toMatchObject({ code: 'request_not_found' });
    h.wire.close();
  });

  it('mock-phase-c TC-1041: steer uses turn CAS and emits independent control terminals', async () => {
    const h = await connectMockScenario('long-running');
    const rootRequest = mockRequest('round32-steer-root', 'agent.ask', { text: '原任务' });
    await h.wire.submit(rootRequest);
    const processing = await waitForMock(
      () => h.feeds.find((row) => row.envelope.parent_id === 'round32-steer-root'
        && row.envelope.payload?.body?.turn_id)?.envelope,
      'steerable processing',
    );
    const turnId = processing.payload.body.turn_id;
    await h.wire.submit(mockRequest(
      'round32-steer-bad', 'agent.steer',
      { text: '错误 CAS', expected_turn_id: 'stale-turn' }, 'round32-steer-root',
    ));
    expect((await waitForMock(
      () => mockTerminal(h.feeds, 'round32-steer-bad'),
      'CAS failure',
    )).payload.body).toMatchObject({ status: 'failed', reason: 'cas_mismatch' });

    await h.wire.submit(mockRequest(
      'round32-steer-good', 'agent.steer',
      { text: '新的方向', expected_turn_id: turnId }, 'round32-steer-root',
    ));
    const control = await waitForMock(
      () => mockTerminal(h.feeds, 'round32-steer-good'),
      'steer terminal',
    );
    expect(control.payload.body).toMatchObject({
      status: 'completed', value: { merged_into: turnId, direction: '新的方向' },
    });
    expect((await waitForMock(
      () => mockTerminal(h.feeds, 'round32-steer-root'),
      'preempted root',
    )).payload.body).toMatchObject({
      status: 'completed', value: { preempted_by: 'round32-steer-good' },
    });
    h.wire.close();
  });
});

describe('I-M exact-path public-owner recovery (round 33 layout and resource contracts)', () => {
  it('message-list-lifecycle TC-0964: a fresh following activation does not restore an old position', () => {
    const reading = round33Reading();
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([])}
        reading={reading}
        renderRow={() => null}
      />,
    );

    expect(view.queryByRole('status')).toBeNull();
    expect(view.getByRole('region', { name: '频道动态' })).toBeTruthy();
  });

  it('message-list-lifecycle TC-0965: one row revision feeds both subtree metadata and the range certificate', () => {
    const reading = round33Reading();
    const measured = round33Row('measured', 1);
    const rowRevision = vi.fn((index, row) => (
      `${index}:${row.id}:layout-7:history-start-role:${reading.activationID}:${row.id}`
    ));
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([measured], { firstItemIndex: 99, revision: 7 })}
        reading={reading}
        surfaceVisible
        rowRevision={rowRevision}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );

    expect(rowRevision).toHaveBeenCalledWith(99, measured);
    expect(view.container.querySelector('[data-presentation-row-id="measured"] [data-render-revision]')
      .getAttribute('data-render-revision'))
      .toBe('99:measured:layout-7:history-start-role:activation:round-33:measured');
    expect(reading.onPresentationMaterialized).toHaveBeenCalledWith({
      activationID: reading.activationID,
      presentationRevision: 7,
      startIndex: 99,
      endIndex: 99,
    });
  });

  it('message-list-lifecycle TC-0966: the exhausted boundary is inside the ordinary list before its oldest row', () => {
    const reading = round33Reading();
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([round33Row('oldest', 1), round33Row('newer', 2)])}
        reading={reading}
        surfaceVisible
        historyStartBoundary={{ generation: 4, label: '已到频道最早一条动态' }}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const boundary = view.getByText('已到频道最早一条动态');
    const slot = boundary.closest('.timeline-history-boundary-slot');
    const list = slot.parentElement;
    const firstRow = view.container.querySelector('[data-presentation-row-id="oldest"]');

    expect(slot).toBeTruthy();
    expect(list.contains(firstRow)).toBe(true);
    expect(list.firstElementChild).toBe(slot);
    expect(slot.nextElementSibling.contains(firstRow)).toBe(true);
  });

  it('message-list-lifecycle TC-0967: one boundary role survives an open-frontier prepend', () => {
    const reading = round33Reading();
    const oldest = round33Row('oldest-a', 10);
    const anchor = round33Row('anchor', 11);
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([oldest, anchor], { firstItemIndex: 10 })}
        reading={reading}
        surfaceVisible
        historyStartBoundary={{ generation: 4, label: '历史起点' }}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const retained = view.container.querySelector('[data-presentation-row-id="oldest-a"]');

    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([round33Row('head', 9), oldest, anchor], { firstItemIndex: 9 })}
        reading={reading}
        surfaceVisible
        historyStartBoundary={{ generation: 4, label: '历史起点' }}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );

    expect(view.container.querySelectorAll('.timeline-history-boundary')).toHaveLength(1);
    expect(view.getByText('历史起点')).toBeTruthy();
    expect(view.container.querySelector('[data-presentation-row-id="oldest-a"]')).toBe(retained);
    expect(vendorHarness.props.firstItemIndex).toBe(9);
  });

  it('message-list-lifecycle TC-0968: the first materialized row remains the anchor across an open prepend', () => {
    const reading = round33Reading();
    const first = round33Row('first', 10);
    const anchor = round33Row('anchor', 11);
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([], { firstItemIndex: 10 })}
        reading={reading}
        renderRow={() => null}
      />,
    );
    expect(view.container.querySelectorAll('.timeline-history-boundary')).toHaveLength(0);

    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([first, anchor], { firstItemIndex: 10 })}
        reading={reading}
        surfaceVisible
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const retained = view.container.querySelector('[data-presentation-row-id="first"]');

    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([round33Row('head', 9), first, anchor], { firstItemIndex: 9 })}
        reading={reading}
        surfaceVisible
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );

    expect(view.container.querySelector('[data-presentation-row-id="first"]')).toBe(retained);
    expect(view.container.querySelectorAll('.timeline-history-boundary')).toHaveLength(0);
    expect(vendorHarness.props.firstItemIndex).toBe(9);
  });

  it('message-list-lifecycle TC-0969: removing the retained front row transfers the boundary to its replacement', () => {
    const reading = round33Reading();
    const removed = round33Row('removed-owner', 10);
    const survivor = round33Row('survivor', 11);
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([removed, survivor], { firstItemIndex: 10 })}
        reading={reading}
        surfaceVisible
        historyStartBoundary={{ generation: 4, label: '历史起点' }}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const oldNode = view.container.querySelector('[data-presentation-row-id="removed-owner"]');

    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([round33Row('replacement-frontier', 12), survivor], { firstItemIndex: 10 })}
        reading={reading}
        surfaceVisible
        historyStartBoundary={{ generation: 4, label: '历史起点' }}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const boundary = view.getByText('历史起点');
    const replacement = view.container.querySelector('[data-presentation-row-id="replacement-frontier"]');

    expect(oldNode.isConnected).toBe(false);
    expect(boundary.closest('.timeline-history-boundary-slot').nextElementSibling.contains(replacement)).toBe(true);
    expect(view.container.querySelectorAll('.timeline-history-boundary')).toHaveLength(1);
  });

  it('mock-phase-e TC-1042: template, channel, overlay, device and secret-safe projections converge', async () => {
    const h = await connectMockScenario('space-administration');
    const submit = async (id, msgType, payload) => {
      const receipt = await h.wire.submit({
        ...mockRequest(id, msgType, payload),
        audience: ['system'],
      });
      return waitForMock(() => mockTerminal(h.feeds, receipt.message_id), `${msgType} terminal`);
    };

    expect((await submit('round33-template', 'system.actor.template.create', {
      id: 'demo:assistant', name: 'Demo', class: 'codex', config: { model: 'mock' }, visibility: 'private',
    })).payload.body.status).toBe('completed');
    expect((await submit('round33-template-list', 'system.actor.template.list', {})).payload.body.value
      .map((row) => row.id)).toContain('demo:assistant');
    expect((await submit('round33-channel-template', 'system.channel.template.create', {
      id: 'demo:channel', name: 'Demo channel', visibility: 'private',
      body: { declarations: [{ decl_id: 'demo:assistant' }] },
    })).payload.body.status).toBe('completed');
    expect((await submit('round33-overlay', 'system.actor.overlay.set', {
      channel_id: CHANNEL, decl_id: 'demo:assistant', config: { model: 'overlay' },
    })).payload.body.value.applied).toBe(true);
    expect((await submit('round33-channel-set', 'system.channel.set', {
      channel_id: CHANNEL, description: 'Configured', serving: 1,
    })).payload.body.status).toBe('completed');
    expect((await submit('round33-device-list', 'system.channel.device.list', {})).payload.body.value)
      .toEqual(expect.arrayContaining([expect.objectContaining({ channel_id: CHANNEL, device_id: 'local-device' })]));
    const minted = await submit('round33-device-create', 'system.device.create', { name: 'Laptop' });
    const key = minted.payload.body.value.key;
    expect(key).toMatch(/^mock-key-/);
    const daemons = await h.fetchSession('/obs/space/daemons').then((response) => response.json());
    expect(daemons.items.map((row) => row.declared.id)).toContain(minted.payload.body.value.device_id);
    expect(JSON.stringify(daemons)).not.toContain(key);
    const state = await h.fetchSession('/mock/control/state').then((response) => response.json());
    expect(JSON.stringify(state)).not.toContain(key);
  });

  it('mock-phase-e TC-1043: resource list omits the id requirement while file tickets round-trip content', async () => {
    const h = await connectMockScenario('resource-workflow');
    await expect(h.wire.resource({ channel_id: CHANNEL, op: 'create', resource_id: 'kv:round33', args: { value: 1 } }))
      .resolves.toMatchObject({ status: 'ok', resource_id: 'kv:round33' });
    await expect(h.wire.resource({ channel_id: CHANNEL, op: 'write', resource_id: 'kv:round33', args: { value: 2 } }))
      .resolves.toMatchObject({ value: { value: 2 } });
    expect((await h.wire.resource({ channel_id: CHANNEL, op: 'list' })).items.map((row) => row.id))
      .toContain('kv:round33');
    const address = 'daemon://local-device/c0/round33.txt';
    const created = await h.wire.resource({ channel_id: CHANNEL, op: 'create', address, with_content: true });
    const put = await h.fetchSession(`/files?channel_id=${CHANNEL}&t=${encodeURIComponent(created.ticket)}`, {
      method: 'PUT', body: 'round33', headers: { 'Content-Type': 'text/plain' },
    });
    expect(put.status).toBe(200);
    const read = await h.wire.resource({ channel_id: CHANNEL, op: 'read', resource_id: created.resource_id, with_content: true });
    const get = await h.fetchSession(`/files?channel_id=${CHANNEL}&t=${encodeURIComponent(read.ticket)}`);
    expect(await get.text()).toBe('round33');
  });

  it('mock-phase-e TC-1044: expired file tickets fail and a fresh ticket is single-use', async () => {
    const h = await connectMockScenario('resource-ticket-expired');
    const address = 'daemon://local-device/c0/round33-expired.txt';
    const first = await h.wire.resource({ channel_id: CHANNEL, op: 'create', address, with_content: true });
    await h.fetchSession('/mock/control/advance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ms: 60_000 }),
    });
    const expired = await h.fetchSession(`/files?channel_id=${CHANNEL}&t=${encodeURIComponent(first.ticket)}`, {
      method: 'PUT', body: 'old',
    });
    expect(expired.status).toBe(403);
    const fresh = await h.wire.resource({ channel_id: CHANNEL, op: 'create', address, with_content: true });
    const uploaded = await h.fetchSession(`/files?channel_id=${CHANNEL}&t=${encodeURIComponent(fresh.ticket)}`, {
      method: 'PUT', body: 'fresh',
    });
    expect(uploaded.status).toBe(200);
    const repeated = await h.fetchSession(`/files?channel_id=${CHANNEL}&t=${encodeURIComponent(fresh.ticket)}`, {
      method: 'PUT', body: 'duplicate',
    });
    expect(repeated.status).toBe(403);
  });

  it('mock-phase-e TC-1045: due timers enter the original ledger while cancelled timers never fire', async () => {
    const h = await connectMockScenario('scheduled-action');
    const scheduled = await h.wire.after({
      channel_id: CHANNEL, duration_ms: 1_000, msg_type: 'mock.timer.notice', payload: { text: 'due' },
    });
    const cancelled = await h.wire.after({
      channel_id: CHANNEL, duration_ms: 1_000, msg_type: 'mock.timer.cancelled', payload: { text: 'never' },
    });
    await expect(h.wire.cancelTimer({ channel_id: CHANNEL, timer_id: cancelled.timer_id }))
      .resolves.toMatchObject({ timer_id: cancelled.timer_id });
    await h.fetchSession('/mock/control/advance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ms: 1_000 }),
    });
    await waitForMock(() => h.feeds.find((row) => row.envelope.id === scheduled.timer_id), 'scheduled timer');
    expect(h.feeds.some((row) => row.envelope.id === cancelled.timer_id)).toBe(false);
  });
});

describe('I-M exact-path public-owner recovery (round 34 lifecycle and viewport contracts)', () => {
  it('message-list-lifecycle TC-0970: a replacement activation cannot inherit a retained history-start role', () => {
    const abandoned = round34Reading({
      activationID: 'activation:abandoned-history-role',
      mode: READING_MODE.browsing,
    });
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([round33Row('abandoned-oldest', 10), round33Row('abandoned-tail', 11)])}
        reading={abandoned}
        surfaceVisible
        historyStartBoundary={{ generation: 7, label: 'abandoned history floor' }}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    expect(view.getByText('abandoned history floor')).toBeTruthy();

    const replacement = round34Reading({
      activationID: 'activation:replacement-history-role',
      mode: READING_MODE.browsing,
    });
    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([round33Row('replacement-oldest', 20), round33Row('replacement-tail', 21)])}
        reading={replacement}
        surfaceVisible
        historyStartBoundary={null}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );

    expect(view.queryByText('abandoned history floor')).toBeNull();
    expect(view.container.querySelector('[data-presentation-row-id="replacement-oldest"]')).toBeTruthy();
    expect(view.container.querySelectorAll('.timeline-history-boundary')).toHaveLength(0);
  });

  it('message-list-lifecycle TC-0971: the fixed history-start role appears only after the public owner reports exhaustion', () => {
    const reading = round34Reading({ mode: READING_MODE.browsing });
    const rows = [round33Row('boundary-oldest', 30), round33Row('boundary-tail', 31)];
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot(rows)}
        reading={reading}
        surfaceVisible
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    expect(view.container.querySelectorAll('.timeline-history-boundary')).toHaveLength(0);

    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot(rows)}
        reading={reading}
        surfaceVisible
        historyStartBoundary={{ generation: 8, label: '已到最早动态' }}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );

    expect(view.getByText('已到最早动态')).toBeTruthy();
    expect(view.container.querySelectorAll('.timeline-history-boundary')).toHaveLength(1);
    expect(view.container.querySelector('.timeline-history-boundary-slot').nextElementSibling
      .contains(view.container.querySelector('[data-presentation-row-id="boundary-oldest"]'))).toBe(true);
  });

  it('message-list-lifecycle TC-0972: revoking the boundary before an open prepend leaves rows stable without a stale role', () => {
    const reading = round34Reading({ mode: READING_MODE.browsing });
    const anchor = round33Row('open-prepend-anchor', 40);
    const tail = round33Row('open-prepend-tail', 41);
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([anchor, tail], { firstItemIndex: 40 })}
        reading={reading}
        surfaceVisible
        historyStartBoundary={{ generation: 9, label: '临时历史起点' }}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const retainedAnchor = view.container.querySelector('[data-presentation-row-id="open-prepend-anchor"]');

    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([
          round33Row('open-prepend-head', 39),
          anchor,
          tail,
        ], { firstItemIndex: 39 })}
        reading={reading}
        surfaceVisible
        historyStartBoundary={null}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );

    expect(view.container.querySelectorAll('.timeline-history-boundary')).toHaveLength(0);
    expect(view.container.querySelector('[data-presentation-row-id="open-prepend-anchor"]')).toBe(retainedAnchor);
    expect(vendorHarness.props.firstItemIndex).toBe(39);
    expect(view.container.querySelector('[data-presentation-row-id="open-prepend-head"]')).toBeTruthy();
  });

  it('message-list-lifecycle TC-0973: formal history admission is scoped to the exact activation/view/epoch tuple', () => {
    const status = {
      generation: 12,
      attached: true,
      localReplicaReady: true,
      sourceLease: 'round34-lease',
      presentationAdmissionState: {
        phase: 'pending-baseline-commit',
        token: { activationID: 'activation:current', viewID: 'c0:all', epoch: 'c0:12' },
      },
    };
    const currentOwner = { channelID: 'c0', activationID: 'activation:current', viewKey: 'c0:all' };
    const obligation = historyConsumerObligation({
      intent: HISTORY_INTENT.initialView,
      targetSeq: 42,
      requiredVisibleCoverage: { messageID: 'm0973', seq: 42 },
      firstRow: { id: 'm0975', seqLow: 45 },
      status,
    });

    expect(obligation).toMatchObject({
      key: expect.stringContaining('m0973'),
      sourceKey: expect.stringContaining('round34-lease'),
    });
    expect(blockingAdmission(status, currentOwner)).toBe(status.presentationAdmissionState);
    expect(blockingAdmission(status, {
      ...currentOwner,
      activationID: 'activation:abandoned',
    })).toBeNull();
    expect(blockingAdmission(status, {
      ...currentOwner,
      viewKey: 'c0:other',
    })).toBeNull();
  });

  it('message-list-lifecycle TC-0974: an empty presentation remains a readable region while admission feedback is pending', () => {
    const reading = round34Reading({ mode: READING_MODE.following });
    reading.status = {
      generation: 13,
      presentationAdmissionState: {
        phase: 'committed-awaiting-layout',
        token: { activationID: reading.activationID, viewID: 'c0:all', epoch: 'c0:13' },
      },
    };
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([])}
        reading={reading}
        renderRow={() => null}
      />,
    );

    const region = view.getByRole('region', { name: '频道动态' });
    expect(region.getAttribute('data-empty')).toBe('true');
    expect(view.queryByRole('status')).toBeNull();
  });

  it('message-list-lifecycle TC-0975: a bookmark restore with no rows exposes explicit restore status', () => {
    const reading = round34Reading({
      mode: READING_MODE.browsing,
      restorePending: true,
      bookmark: { messageID: 'late-bookmark', rowViewportOffset: -16 },
    });
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([])}
        reading={reading}
        renderRow={() => null}
      />,
    );

    expect(view.getByRole('status').textContent).toBe('正在恢复上次阅读位置…');
    expect(view.queryByRole('region', { name: '频道动态' })).toBeNull();
  });

  it('message-list-lifecycle TC-0977: an abandoned activation cannot reuse its initial location on replacement', () => {
    const abandoned = round34Reading({
      activationID: 'activation:abandoned-location',
      mode: READING_MODE.browsing,
      bookmark: { messageID: 'abandoned-target', rowViewportOffset: -20 },
    });
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([
          round33Row('abandoned-head', 50),
          round33Row('abandoned-target', 51),
        ])}
        reading={abandoned}
        surfaceVisible
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    expect(vendorHarness.scrollToIndex).toHaveBeenCalledWith({
      index: 1,
      align: 'start',
      offset: 20,
    });
    // The abandoned command has already been delivered to activation A. A
    // replacement activation must not replay it through the same mounted
    // public list owner after the session changes.
    vendorHarness.scrollToIndex.mockClear();

    const replacement = round34Reading({
      activationID: 'activation:replacement-location',
      mode: READING_MODE.browsing,
      bookmark: null,
    });
    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([
          round33Row('replacement-head', 60),
          round33Row('replacement-tail', 61),
        ])}
        reading={replacement}
        surfaceVisible
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );

    expect(vendorHarness.scrollToIndex).not.toHaveBeenCalled();
    expect(view.container.querySelector('[data-presentation-row-id="replacement-head"]')).toBeTruthy();
  });

  it('message-list-lifecycle TC-0978: a browsing bookmark resolves to its exact row through the public list owner', () => {
    const reading = round34Reading({
      mode: READING_MODE.browsing,
      bookmark: { messageID: 'bookmark-target', rowViewportOffset: -24 },
    });
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([
          round33Row('bookmark-head', 70),
          round33Row('bookmark-target', 71),
          round33Row('bookmark-tail', 72),
        ], { firstItemIndex: 70 })}
        reading={reading}
        surfaceVisible
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );

    expect(vendorHarness.props.firstItemIndex).toBe(70);
    expect(vendorHarness.scrollToIndex).toHaveBeenCalledWith({
      index: 1,
      align: 'start',
      offset: 24,
    });
    expect(view.container.querySelector('[data-presentation-row-id="bookmark-target"]')).toBeTruthy();
  });

  it('message-list-lifecycle TC-0979: a late exact bookmark supersedes the temporary fallback once its row arrives', () => {
    const reading = round34Reading({
      mode: READING_MODE.browsing,
      bookmark: { messageID: 'late-exact-target', rowViewportOffset: -12 },
    });
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([round33Row('temporary-fallback', 80)])}
        reading={reading}
        surfaceVisible
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    expect(vendorHarness.scrollToIndex).toHaveBeenCalledWith({ index: 0, align: 'start' });

    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([
          round33Row('temporary-fallback', 80),
          round33Row('late-exact-target', 81),
        ])}
        reading={reading}
        surfaceVisible
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );

    expect(vendorHarness.scrollToIndex).toHaveBeenLastCalledWith({
      index: 1,
      align: 'start',
      offset: 12,
    });
    expect(view.container.querySelector('[data-presentation-row-id="late-exact-target"]')).toBeTruthy();
    expect(view.queryByRole('status')).toBeNull();
  });

  it('message-list-lifecycle TC-0983: the handoff keeps one active paint layer while an incoming activation is inert', () => {
    const incoming = round34Reading({
      activationID: 'activation:incoming-inert',
      mode: READING_MODE.following,
      initializing: true,
    });
    const view = render(
      <ReadingContainerHandoff
        reading={incoming}
        surfaceVisible
        snapshot={round33Snapshot([])}
        focusOnMount={false}
        renderRow={() => null}
      />,
    );
    const layer = view.container.querySelector('.timeline-reading-layer');
    expect(view.container.querySelectorAll('.timeline-reading-layer.is-active')).toHaveLength(1);
    expect(view.queryByRole('region', { name: '频道动态' })).toBeNull();

    const revealed = round34Reading({
      activationID: 'activation:revealed',
      mode: READING_MODE.browsing,
    });
    view.rerender(
      <ReadingContainerHandoff
        reading={revealed}
        surfaceVisible
        snapshot={round33Snapshot([round33Row('focus-target', 90)])}
        focusOnMount
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );

    expect(view.container.querySelector('.timeline-reading-layer')).toBe(layer);
    expect(view.container.querySelectorAll('.timeline-reading-layer.is-active')).toHaveLength(1);
    expect(view.container.querySelector('.timeline-reading-stack').getAttribute('data-reading-activation'))
      .toBe('activation:revealed');
    expect(document.activeElement).toBe(view.getByRole('region', { name: '频道动态' }));
  });
});

describe('I-M exact-path public-owner recovery (round 35–36 reading-adapter and committed-tail contracts)', () => {
  it('message-list-lifecycle TC-0984: an underfilled committed range returns a typed acquisition wake to the current owner', async () => {
    const pending = Promise.resolve({ kind: 'consumer-recheck', reason: 'supply-progressed' });
    const reading = round34Reading({ mode: READING_MODE.browsing });
    reading.status = {
      attached: true,
      generation: 7,
      messageCurrent: true,
      headSeq: 0,
      hasOlder: true,
      completedPages: 2,
      revealVersion: 1,
    };
    reading.bottomReady = true;
    reading.onUnderfill = vi.fn(() => pending);
    vendorHarness.rootMetrics = { clientHeight: 600, scrollHeight: 500, scrollTop: 0 };
    render(
      <VendorListExecutor
        snapshot={round33Snapshot([
          round33Row('underfill-first', 1),
          round33Row('underfill-second', 2),
        ], { firstItemIndex: 0 })}
        reading={reading}
        surfaceVisible
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 500,
      scrollTop: 0,
    });
    act(() => vendorHarness.props.rangeChanged({ startIndex: 0, endIndex: 1 }));

    await waitFor(() => expect(reading.onUnderfill).toHaveBeenCalled());
    expect(reading.onUnderfill.mock.calls[0][0]).toMatchObject({ demandUnits: expect.any(Number) });
    await act(async () => {
      await pending;
      await new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
    });
    expect(scroller.getBoundingClientRect().height).toBe(600);
    expect(reading.onReadingObservation).toHaveBeenCalled();
  });

  it('message-list-lifecycle TC-0985: the following owner, not vendor followOutput, performs one bottom write', () => {
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.following }));
    reading.session = {
      ...reading.session,
      bottomIntent: { id: 'bottom:round35', inputEpoch: 0 },
    };
    vendorHarness.rootMetrics = { clientHeight: 600, scrollHeight: 1_200, scrollTop: 400 };
    render(
      <VendorListExecutor
        snapshot={round33Snapshot([round33Row('following-first', 1)], { firstItemIndex: 0 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );

    expect(vendorHarness.props.followOutput).toBe(false);
    expect(reading.getSession().bottomIntent.id).toBe('');
    expect(vendorHarness.scrollTo).toHaveBeenCalledWith({ top: 1_200, behavior: 'auto' });
    // The public bottom owner writes the mounted physical root itself; no
    // vendor followOutput or detached geometry proxy is part of this contract.
    expect(vendorHarness.root.scrollTo).toBe(vendorHarness.scrollTo);
  });

  it('message-list-lifecycle TC-0986: a role-only public height commit lets following tail exactly once', () => {
    const reading = round34Reading({ mode: READING_MODE.following });
    const first = round33Row('role-height-row', 1);
    const view = render(
      <VendorListExecutor
        snapshot={{ ...round33Snapshot([first]), roleRevision: 0, roleChanges: { updated: [] } }}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = vendorHarness.root;
    view.rerender(
      <VendorListExecutor
        snapshot={{ ...round33Snapshot([{ ...first }]), revision: 8, roleRevision: 1, roleChanges: { updated: [first.id] } }}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();

    setRound35Geometry(scroller, { clientHeight: 600, scrollHeight: 1_200, scrollTop: 400 });
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).toHaveBeenCalledTimes(1);
    expect(vendorHarness.scrollTo).toHaveBeenCalledWith({ top: 1_200, behavior: 'auto' });
    expect(scroller.scrollTop).toBe(1_200);
  });

  it('message-list-lifecycle TC-0987: native older input cancels a child-first role height before it can follow', () => {
    const reading = round34Reading({ mode: READING_MODE.following });
    reading.beginNavigation = vi.fn(() => {
      reading.session = { ...reading.session, mode: READING_MODE.browsing, inputEpoch: 1 };
      return { inputGeneration: 1 };
    });
    render(
      <VendorListExecutor
        snapshot={{ ...round33Snapshot([round33Row('child-first-role', 1)]), roleRevision: 0, roleChanges: { updated: [] } }}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_200,
      scrollTop: 400,
    });
    vendorHarness.scrollTo.mockClear();

    act(() => fireEvent.wheel(scroller, { deltaY: -80 }));
    act(() => vendorHarness.props.totalListHeightChanged());

    expect(reading.beginNavigation).toHaveBeenCalled();
    expect(reading.session.mode).toBe(READING_MODE.browsing);
    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();
  });

  it('message-list-lifecycle TC-0988: a role-only height commit cannot bypass an active send bottom join', () => {
    const intent = {
      id: 'composer:send-start:role-blocked-round35',
      inputEpoch: 0,
      afterPresentationRevision: 1,
      targetMessageIDs: ['send-target-round35'],
    };
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.following }));
    reading.session = { ...reading.session, bottomIntent: intent };
    render(
      <VendorListExecutor
        snapshot={{ ...round33Snapshot([round33Row('send-role-row', 1)]), roleRevision: 0, roleChanges: { updated: [] } }}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    setRound35Geometry(vendorHarness.root, { clientHeight: 600, scrollHeight: 1_200, scrollTop: 400 });
    vendorHarness.scrollTo.mockClear();

    act(() => vendorHarness.props.totalListHeightChanged());

    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();
    expect(reading.getSession().bottomIntent.id).toBe(intent.id);
  });

  it('message-list-lifecycle TC-0989: an optional diagnostic sink cannot take down the sole bottom writer', () => {
    const previousTrace = globalThis.__ATOLL_READING_TRACE__;
    globalThis.__ATOLL_READING_TRACE__ = () => { throw new Error('diagnostic sink failed'); };
    try {
      const reading = round34Reading({ mode: READING_MODE.following });
      render(
        <VendorListExecutor
          snapshot={round33Snapshot([round33Row('trace-safe-tail', 1)])}
          reading={reading}
          renderRow={(row) => <article>{row.id}</article>}
        />,
      );
      setRound35Geometry(vendorHarness.root, { clientHeight: 600, scrollHeight: 1_200, scrollTop: 400 });
      vendorHarness.scrollTo.mockClear();

      act(() => vendorHarness.props.totalListHeightChanged());

      expect(vendorHarness.scrollTo).toHaveBeenCalledWith({ top: 1_200, behavior: 'auto' });
    } finally {
      if (previousTrace) globalThis.__ATOLL_READING_TRACE__ = previousTrace;
      else delete globalThis.__ATOLL_READING_TRACE__;
    }
  });

  it('message-list-lifecycle TC-0991: the public Waiting reserve excludes rows behind its readable bottom', async () => {
    const observations = [];
    const reading = round34Reading({ mode: READING_MODE.browsing });
    reading.onReadingObservation = vi.fn((observation) => observations.push(observation));
    render(
      <VendorListExecutor
        snapshot={round33Snapshot([round33Row('covered-by-waiting', 1)], { firstItemIndex: 0 })}
        reading={reading}
        surfaceVisible
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 600,
      scrollTop: 0,
    });
    scroller.style.setProperty('--conversation-waiting-reserve', '100px');
    const rowNode = scroller.querySelector('[data-presentation-row-id]');
    rowNode.getBoundingClientRect = () => ({
      top: 520, bottom: 590, left: 0, right: 800, width: 800, height: 70,
    });
    const previousElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => rowNode),
    });
    try {
      const Footer = vendorHarness.props.components.Footer;
      const footer = render(<Footer />);
      expect(footer.container.querySelector('.timeline-waiting-obstruction')).toBeTruthy();
      observations.length = 0;
      await act(async () => {
        vendorHarness.props.rangeChanged({ startIndex: 0, endIndex: 0 });
        await new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
      });
      expect(observations.at(-1)?.visibleRows).toEqual([]);
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: previousElementFromPoint,
      });
    }
  });

  it('message-list-lifecycle TC-0992: a promoted short-list row is resampled from the committed List without trusting its wrapper', async () => {
    const observations = [];
    const reading = round34Reading({ mode: READING_MODE.browsing });
    reading.onReadingObservation = vi.fn((observation) => observations.push(observation));
    render(
      <VendorListExecutor
        snapshot={round33Snapshot([round33Row('short-promoted-row', 1)], { firstItemIndex: 0 })}
        reading={reading}
        surfaceVisible
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 600,
      scrollTop: 0,
    });
    const rowNode = scroller.querySelector('[data-presentation-row-id]');
    rowNode.getBoundingClientRect = () => ({
      top: 0, bottom: 132, left: 0, right: 800, width: 800, height: 132,
    });
    const viewport = scroller.firstElementChild;
    viewport.setAttribute('data-viewport-type', 'element');
    const previousElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => viewport),
    });
    try {
      observations.length = 0;
      await act(async () => {
        vendorHarness.props.rangeChanged({ startIndex: 0, endIndex: 0 });
        await new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
      });
      expect(observations.at(-1)?.visibleRows).toEqual([]);

      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: vi.fn(() => rowNode),
      });
      await act(async () => {
        vendorHarness.props.rangeChanged({ startIndex: 0, endIndex: 0 });
        await new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
      });
      expect(observations.at(-1)?.visibleRows).toEqual([
        { messageID: 'short-promoted-row', seqHigh: 1 },
      ]);
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: previousElementFromPoint,
      });
    }
  });

  it('message-list-lifecycle TC-0993: a late root geometry publication gets one committed-height recheck', async () => {
    const reading = round34Reading({ mode: READING_MODE.following });
    render(
      <VendorListExecutor
        snapshot={round33Snapshot([round33Row('late-height-tail', 1)])}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = vendorHarness.root;
    vendorHarness.scrollTo.mockClear();
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();

    setRound35Geometry(scroller, { clientHeight: 600, scrollHeight: 1_031, scrollTop: 400 });
    await act(async () => { await Promise.resolve(); });

    expect(vendorHarness.scrollTo).toHaveBeenCalledTimes(1);
    expect(vendorHarness.scrollTo).toHaveBeenCalledWith({ top: 1_031, behavior: 'auto' });
  });

  it('message-list-lifecycle TC-0994: real upward input near the revealed edge starts one bounded runway demand', () => {
    const reading = round34Reading({ mode: READING_MODE.browsing });
    reading.beginNavigation = vi.fn(() => {
      reading.session = { ...reading.session, inputEpoch: 1 };
      return { inputGeneration: 1 };
    });
    reading.onNearTop = vi.fn();
    render(
      <VendorListExecutor
        snapshot={round33Snapshot([round33Row('runway-first', 1), round33Row('runway-second', 2)])}
        reading={reading}
        surfaceVisible
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_000,
      scrollTop: 500,
    });

    scroller.scrollTop = 500;
    act(() => fireEvent.scroll(scroller));
    act(() => fireEvent.wheel(scroller, { deltaY: -120 }));
    scroller.scrollTop = 350;
    act(() => fireEvent.scroll(scroller));

    expect(reading.onNearTop).toHaveBeenCalledTimes(1);
    expect(reading.onNearTop).toHaveBeenCalledWith({ demandUnits: expect.any(Number) });
  });

  it('message-list-lifecycle TC-0995: live gesture evidence remains one bounded demand after native scrollend', () => {
    const reading = round34Reading({ mode: READING_MODE.browsing });
    reading.beginNavigation = vi.fn(() => {
      reading.session = { ...reading.session, inputEpoch: 1 };
      return { inputGeneration: 1 };
    });
    reading.onNearTop = vi.fn();
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([round33Row('live-first', 1), round33Row('live-second', 2)])}
        reading={reading}
        surfaceVisible
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 2_600,
      scrollTop: 1_200,
    });

    act(() => fireEvent.scroll(scroller));
    act(() => fireEvent.wheel(scroller, { deltaY: -600 }));
    scroller.scrollTop = 700;
    act(() => fireEvent.scroll(scroller));
    expect(reading.onNearTop).toHaveBeenCalledTimes(1);

    act(() => fireEvent(scroller, new Event('scrollend')));
    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([
          round33Row('live-older', 0),
          round33Row('live-first', 1),
          round33Row('live-second', 2),
        ], { revision: 8 })}
        reading={reading}
        surfaceVisible
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    scroller.scrollTop = 500;
    act(() => fireEvent.scroll(scroller));
    expect(reading.onNearTop).toHaveBeenCalledTimes(1);
  });

  it('message-list-lifecycle TC-1000: mixed forward presentation changes follow the exact committed tail once', () => {
    const reading = round34Reading({ mode: READING_MODE.following });
    const first = round33Row('mixed-first', 1);
    const partialTail = round33Row('mixed-partial-tail', 2);
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([first, partialTail], { revision: 1 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_000,
      scrollTop: 400,
    });
    vendorHarness.scrollTo.mockClear();

    view.rerender(
      <VendorListExecutor
        snapshot={{
          ...round33Snapshot([first, partialTail, round33Row('mixed-installed-tail', 3)], { revision: 2 }),
          changes: {
            kind: 'mixed',
            inserted: ['mixed-installed-tail'],
            updated: ['mixed-first'],
            removed: [],
          },
        }}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    setRound35Geometry(scroller, { clientHeight: 600, scrollHeight: 1_132, scrollTop: 400 });
    act(() => vendorHarness.props.totalListHeightChanged());

    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(vendorHarness.scrollTo).toHaveBeenCalledWith({ top: 1_132, behavior: 'auto' });
  });

  it('message-list-lifecycle TC-1001: following readiness can finish at the committed physical tail', () => {
    const reading = round34Reading({ mode: READING_MODE.following });
    reading.bottomReady = false;
    const current = round33Snapshot([round33Row('ready-tail', 1)], { revision: 1 });
    const view = render(
      <VendorListExecutor
        snapshot={current}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_218,
      scrollTop: 600,
    });
    vendorHarness.scrollTo.mockClear();

    reading.bottomReady = true;
    view.rerender(
      <VendorListExecutor
        snapshot={{ ...current }}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );

    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(vendorHarness.scrollTo).toHaveBeenCalledWith({ top: 1_218, behavior: 'auto' });
    expect(scroller.scrollTop).toBe(1_218);
  });

  it('message-list-lifecycle TC-1003: explicit latest writes against current geometry without waiting for readiness', () => {
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.following, initializing: true }));
    reading.bottomReady = false;
    const current = round33Snapshot([round33Row('direct-latest', 1)], { revision: 1 });
    const view = render(
      <VendorListExecutor
        snapshot={current}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_200,
      scrollTop: 300,
    });
    vendorHarness.scrollTo.mockClear();
    const intent = { id: 'latest:round36-direct', inputEpoch: 0, afterPresentationRevision: 1 };
    reading.session = { ...reading.session, bottomIntent: intent };

    view.rerender(
      <VendorListExecutor
        snapshot={{ ...current }}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );

    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(vendorHarness.scrollTo).toHaveBeenCalledWith({ top: 1_200, behavior: 'auto' });
    expect(reading.getSession().bottomIntent.id).toBe('');
    expect(scroller.scrollTop).toBe(1_200);
  });

  it('message-list-lifecycle TC-1004: explicit latest at the physical tail consumes without a redundant DOM write', () => {
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.following }));
    const current = round33Snapshot([round33Row('already-tail', 1)], { revision: 1 });
    const view = render(
      <VendorListExecutor
        snapshot={current}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_200,
      scrollTop: 600,
    });
    vendorHarness.scrollTo.mockClear();
    const intent = { id: 'latest:round36-at-tail', inputEpoch: 0, afterPresentationRevision: 1 };
    reading.session = { ...reading.session, bottomIntent: intent };

    view.rerender(
      <VendorListExecutor
        snapshot={{ ...current }}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );

    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();
    expect(reading.getSession().bottomIntent.id).toBe('');
  });

  it('message-list-lifecycle TC-1006: ordinary following waits for the physical root to reach public height', () => {
    const reading = round34Reading({ mode: READING_MODE.following });
    const first = round33Row('ordinary-first', 1);
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([first], { revision: 1 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_000,
      scrollTop: 400,
    });
    vendorHarness.scrollTo.mockClear();

    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([first, round33Row('ordinary-appended', 2)], { revision: 2 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();

    setRound35Geometry(scroller, { clientHeight: 600, scrollHeight: 1_200, scrollTop: 400 });
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(vendorHarness.scrollTo).toHaveBeenCalledWith({ top: 1_200, behavior: 'auto' });
  });

  it('message-list-lifecycle TC-1007: browsing send stays at the user viewport without synthetic following height', () => {
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.browsing }));
    const intent = {
      id: 'composer:send-start:round36-browsing',
      inputEpoch: 0,
      afterPresentationRevision: 6,
      targetMessageIDs: [],
    };
    reading.session = { ...reading.session, bottomIntent: intent };
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([round33Row('browsing-tail', 1)], { revision: 6 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_200,
      scrollTop: 100,
    });
    vendorHarness.scrollTo.mockClear();

    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([round33Row('browsing-tail', 1)], { revision: 6 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    act(() => vendorHarness.props.totalListHeightChanged());

    expect(scroller.scrollTop).toBe(100);
    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();
    expect(reading.getSession().bottomIntent.id).toBe(intent.id);
  });

  it('message-list-lifecycle TC-1008: a pending send join cannot displace the real viewport before readiness', () => {
    const intent = {
      id: 'composer:send-start:round36-geometry',
      inputEpoch: 0,
      afterPresentationRevision: 6,
      targetMessageIDs: [],
    };
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.following }));
    reading.session = { ...reading.session, bottomIntent: intent };
    render(
      <VendorListExecutor
        snapshot={round33Snapshot([round33Row('geometry-tail', 1)], { revision: 6 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 500,
      scrollHeight: 1_200,
      scrollTop: 500,
    });
    vendorHarness.scrollTo.mockClear();
    act(() => vendorHarness.props.totalListHeightChanged());

    expect(scroller.scrollTop).toBe(500);
    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();
    expect(reading.getSession().bottomIntent.id).toBe(intent.id);
  });

  it('message-list-lifecycle TC-1010: readiness before public item measurement writes only after the committed height', () => {
    const intent = {
      id: 'composer:send-start:round36-ready-first',
      inputEpoch: 0,
      afterPresentationRevision: 1,
      targetMessageIDs: ['round36-target'],
    };
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.following }));
    reading.session = { ...reading.session, bottomIntent: intent };
    const first = round33Row('ready-first', 1);
    const target = { ...round33Row('round36-target', 2), body: { local: false } };
    const initialSnapshot = round33Snapshot([first], { revision: 1 });
    const initialPresentation = round36BottomPresentation(reading, initialSnapshot, intent, false);
    const view = render(
      <VendorListExecutor
        snapshot={initialSnapshot}
        reading={reading}
        bottomIntentPresentation={initialPresentation}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_000,
      scrollTop: 400,
    });
    vendorHarness.scrollTo.mockClear();

    const targetSnapshot = round33Snapshot([first, target], { revision: 2 });
    const targetPresentation = round36BottomPresentation(reading, targetSnapshot, intent, true);
    view.rerender(
      <VendorListExecutor
        snapshot={targetSnapshot}
        reading={reading}
        bottomIntentPresentation={targetPresentation}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();
    expect(reading.getSession().bottomIntent.id).toBe(intent.id);

    setRound35Geometry(scroller, { clientHeight: 600, scrollHeight: 1_132, scrollTop: 400 });
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(vendorHarness.scrollTo).toHaveBeenCalledWith({ top: 1_132, behavior: 'auto' });
    expect(reading.getSession().bottomIntent.id).toBe('');
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(reading.getSession().bottomIntent.id).toBe('');
  });

  it('message-list-lifecycle TC-1011: a later same-revision height remains ordinary follow while the join is pending', () => {
    const intent = {
      id: 'composer:send-start:round36-later-height',
      inputEpoch: 0,
      afterPresentationRevision: 1,
      targetMessageIDs: ['round36-target-later'],
    };
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.following }));
    reading.session = { ...reading.session, bottomIntent: intent };
    const first = round33Row('later-height-first', 1);
    const initialSnapshot = round33Snapshot([first], { revision: 1 });
    const initialPresentation = round36BottomPresentation(reading, initialSnapshot, intent, false);
    const view = render(
      <VendorListExecutor
        snapshot={initialSnapshot}
        reading={reading}
        bottomIntentPresentation={initialPresentation}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_000,
      scrollTop: 400,
    });
    vendorHarness.scrollTo.mockClear();

    const targetSnapshot = round33Snapshot([first, { ...round33Row('round36-target-later', 2), body: { local: false } }], { revision: 2 });
    const pendingPresentation = round36BottomPresentation(reading, targetSnapshot, intent, false);
    view.rerender(
      <VendorListExecutor
        snapshot={targetSnapshot}
        reading={reading}
        bottomIntentPresentation={pendingPresentation}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    setRound35Geometry(scroller, { clientHeight: 600, scrollHeight: 1_132, scrollTop: 400 });
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();
    expect(reading.getSession().bottomIntent.id).toBe(intent.id);

    const readyPresentation = round36BottomPresentation(reading, targetSnapshot, intent, true);
    view.rerender(
      <VendorListExecutor
        snapshot={targetSnapshot}
        reading={reading}
        bottomIntentPresentation={readyPresentation}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    setRound35Geometry(scroller, { clientHeight: 600, scrollHeight: 1_200, scrollTop: 400 });
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(vendorHarness.scrollTo).toHaveBeenCalledWith({ top: 1_200, behavior: 'auto' });
    expect(reading.getSession().bottomIntent.id).toBe('');
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(reading.getSession().bottomIntent.id).toBe('');
  });

  it('message-list-lifecycle: a ready receipt without a timeline destination cannot consume the send intent', () => {
    const intent = {
      id: 'composer:send-start:round36-waiting-destination',
      inputEpoch: 0,
      afterPresentationRevision: 2,
      targetMessageIDs: ['round36-waiting-target'],
    };
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.following }));
    const consumeBottomIntent = reading.consumeBottomIntent;
    reading.consumeBottomIntent = vi.fn((candidate) => consumeBottomIntent(candidate));
    reading.session = { ...reading.session, bottomIntent: intent };
    const first = round33Row('round36-waiting-first', 1);
    const target = { ...round33Row('round36-waiting-target', 2), body: { local: false } };
    const snapshot = round33Snapshot([first, target], { revision: 2 });
    const waitingReceipt = Object.freeze({
      ...round36BottomPresentation(reading, snapshot, intent, true),
      destinations: Object.freeze([Object.freeze({
        messageID: target.id,
        destination: 'waiting',
        targetListRevision: snapshot.revision,
      })]),
    });
    const view = render(
      <VendorListExecutor
        snapshot={snapshot}
        reading={reading}
        bottomIntentPresentation={waitingReceipt}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_132,
      scrollTop: 400,
    });
    vendorHarness.scrollTo.mockClear();
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();
    expect(reading.consumeBottomIntent).not.toHaveBeenCalled();
    expect(reading.getSession().bottomIntent.id).toBe(intent.id);
    expect(scroller.scrollTop).toBe(400);
    view.unmount();
  });

  it('message-list-lifecycle TC-1012: an equal-height target baseline precedes a later same-revision resize', () => {
    const intent = {
      id: 'composer:send-start:round37-equal-baseline',
      inputEpoch: 0,
      afterPresentationRevision: 1,
      targetMessageIDs: ['round37-target'],
    };
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.following }));
    reading.session = { ...reading.session, bottomIntent: intent };
    const first = round33Row('round37-first', 1);
    const target = { ...round33Row('round37-target', 2), body: { local: false } };
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([first], { revision: 1 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_000,
      scrollTop: 400,
    });
    vendorHarness.scrollTo.mockClear();
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();
    expect(reading.getSession().bottomIntent.id).toBe(intent.id);

    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([first, target], { revision: 2 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();
    expect(reading.getSession().bottomIntent.id).toBe(intent.id);

    setRound35Geometry(scroller, { clientHeight: 600, scrollHeight: 1_100, scrollTop: 400 });
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(vendorHarness.scrollTo).toHaveBeenCalledWith({ top: 1_100, behavior: 'auto' });
    expect(reading.getSession().bottomIntent.id).toBe('');
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(reading.getSession().bottomIntent.id).toBe('');
  });

  it('message-list-lifecycle TC-1013: the first child-first target ack is the baseline and a later ack is ordinary layout', () => {
    const intent = {
      id: 'composer:send-start:round37-child-first',
      inputEpoch: 0,
      afterPresentationRevision: 1,
      targetMessageIDs: ['round37-child-target'],
    };
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.following }));
    reading.session = { ...reading.session, bottomIntent: intent };
    const first = round33Row('round37-child-first', 1);
    const target = { ...round33Row('round37-child-target', 2), body: { local: false } };
    const initialSnapshot = round33Snapshot([first], { revision: 1 });
    const initialPresentation = round36BottomPresentation(reading, initialSnapshot, intent, false);
    const view = render(
      <VendorListExecutor
        snapshot={initialSnapshot}
        reading={reading}
        bottomIntentPresentation={initialPresentation}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_200,
      scrollTop: 400,
    });
    vendorHarness.scrollTo.mockClear();

    const targetSnapshot = round33Snapshot([first, target], { revision: 2 });
    const targetPresentation = round36BottomPresentation(reading, targetSnapshot, intent, true);
    view.rerender(
      <VendorListExecutor
        snapshot={targetSnapshot}
        reading={reading}
        bottomIntentPresentation={targetPresentation}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );

    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();
    expect(reading.getSession().bottomIntent.id).toBe(intent.id);
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(vendorHarness.scrollTo).toHaveBeenCalledWith({ top: 1_200, behavior: 'auto' });
    expect(reading.getSession().bottomIntent.id).toBe('');
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(reading.getSession().bottomIntent.id).toBe('');
    expect(scroller.scrollTop).toBe(1_200);
  });

  it('message-list-lifecycle TC-1014: revoking a send does not overwrite a later same-revision height token', () => {
    const intent = {
      id: 'composer:send-start:round37-revoke-after-media',
      inputEpoch: 0,
      afterPresentationRevision: 1,
      targetMessageIDs: ['round37-revoke-target'],
    };
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.following }));
    reading.session = { ...reading.session, bottomIntent: intent };
    const first = round33Row('round37-revoke-first', 1);
    const target = { ...round33Row('round37-revoke-target', 2), body: { local: false } };
    const initialSnapshot = round33Snapshot([first], { revision: 1 });
    const initialPresentation = round36BottomPresentation(reading, initialSnapshot, intent, false);
    const view = render(
      <VendorListExecutor
        snapshot={initialSnapshot}
        reading={reading}
        bottomIntentPresentation={initialPresentation}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_132,
      scrollTop: 400,
    });
    vendorHarness.scrollTo.mockClear();

    const targetSnapshot = round33Snapshot([first, target], { revision: 2 });
    const pendingPresentation = round36BottomPresentation(reading, targetSnapshot, intent, false);
    view.rerender(
      <VendorListExecutor
        snapshot={targetSnapshot}
        reading={reading}
        bottomIntentPresentation={pendingPresentation}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    act(() => vendorHarness.props.totalListHeightChanged());
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();
    expect(reading.getSession().bottomIntent.id).toBe(intent.id);

    reading.session = { ...reading.session, bottomIntent: { id: '', inputEpoch: 0 } };
    // The owner update itself revokes the send lease. Keep the same public
    // snapshot/receipt tuple on this rerender so the old physical callback
    // cannot be mistaken for a new presentation; no matching intent means
    // the stale receipt has no authority.
    view.rerender(
      <VendorListExecutor
        snapshot={targetSnapshot}
        reading={reading}
        bottomIntentPresentation={pendingPresentation}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    setRound35Geometry(scroller, { clientHeight: 600, scrollHeight: 1_200, scrollTop: 400 });
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(vendorHarness.scrollTo).toHaveBeenCalledWith({ top: 1_200, behavior: 'auto' });
    expect(reading.getSession().bottomIntent.id).toBe('');
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(reading.getSession().bottomIntent.id).toBe('');
  });

  it('message-list-lifecycle TC-1015: revoking an owned send baseline releases ordinary following', () => {
    const intent = {
      id: 'composer:send-start:round37-revoked',
      inputEpoch: 0,
      afterPresentationRevision: 1,
      targetMessageIDs: ['round37-revoked-target'],
    };
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.following }));
    reading.session = { ...reading.session, bottomIntent: intent };
    const first = round33Row('round37-revoked-first', 1);
    const target = { ...round33Row('round37-revoked-target', 2), body: { local: false } };
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([first], { revision: 1 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_132,
      scrollTop: 400,
    });
    vendorHarness.scrollTo.mockClear();

    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([first, target], { revision: 2 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();
    expect(reading.getSession().bottomIntent.id).toBe(intent.id);

    reading.session = { ...reading.session, bottomIntent: { id: '', inputEpoch: 0 } };
    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([first, target], { revision: 2 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />
    );
    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(vendorHarness.scrollTo).toHaveBeenCalledWith({ top: 1_132, behavior: 'auto' });
    expect(reading.getSession().bottomIntent.id).toBe('');
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(reading.getSession().bottomIntent.id).toBe('');
    expect(scroller.scrollTop).toBe(1_132);
  });

  it('message-list-lifecycle TC-1016: a mixed send-target commit preserves the parent-first ordinary tail obligation', () => {
    const intent = {
      id: 'composer:send-start:round37-mixed-tail',
      inputEpoch: 0,
      afterPresentationRevision: 1,
      targetMessageIDs: ['round37-mixed-target'],
    };
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.following }));
    reading.session = { ...reading.session, bottomIntent: intent };
    const previousTail = round33Row('round37-unrelated-tail', 1);
    const target = { ...round33Row('round37-mixed-target', 2), body: { local: false } };
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([previousTail], { revision: 1 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_100,
      scrollTop: 400,
    });
    vendorHarness.scrollTo.mockClear();

    view.rerender(
      <VendorListExecutor
        snapshot={{
          ...round33Snapshot([target], { revision: 2 }),
          changes: {
            kind: 'mixed',
            inserted: ['round37-mixed-target'],
            updated: [],
            removed: ['round37-unrelated-tail'],
          },
        }}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    act(() => vendorHarness.props.totalListHeightChanged());

    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(vendorHarness.scrollTo).toHaveBeenCalledWith({ top: 1_100, behavior: 'auto' });
    expect(reading.getSession().bottomIntent.id).toBe('');
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(reading.getSession().bottomIntent.id).toBe('');
    expect(scroller.scrollTop).toBe(1_100);
  });

  it('message-list-lifecycle TC-1018: an unrelated committed tail may follow while a newer send target remains pending', () => {
    const intent = {
      id: 'composer:send-start:round37-pending-b',
      inputEpoch: 0,
      afterPresentationRevision: 1,
      targetMessageIDs: ['round37-target-b'],
    };
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.following }));
    reading.session = { ...reading.session, bottomIntent: intent };
    const first = round33Row('round37-pending-first', 1);
    const unrelated = round33Row('round37-waiting-a', 2);
    const target = { ...round33Row('round37-target-b', 3), localState: 'queued', body: { local: true } };
    const initialSnapshot = round33Snapshot([first], { revision: 1 });
    const view = render(
      <VendorListExecutor
        snapshot={initialSnapshot}
        reading={reading}
        bottomIntentPresentation={round36BottomPresentation(reading, initialSnapshot, intent, false)}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_000,
      scrollTop: 200,
    });
    vendorHarness.scrollTo.mockClear();

    const unrelatedSnapshot = {
      ...round33Snapshot([first, unrelated], { revision: 2 }),
      changes: {
        kind: 'append',
        inserted: [unrelated.id],
        frontInsertedIDs: [],
        backInsertedIDs: [unrelated.id],
        updated: [],
        removed: [],
      },
    };
    view.rerender(
      <VendorListExecutor
        snapshot={unrelatedSnapshot}
        reading={reading}
        bottomIntentPresentation={round36BottomPresentation(reading, unrelatedSnapshot, intent, false)}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    setRound35Geometry(scroller, { clientHeight: 600, scrollHeight: 1_132, scrollTop: 400 });
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(vendorHarness.scrollTo).toHaveBeenCalledWith({ top: 1_132, behavior: 'auto' });
    expect(reading.getSession().bottomIntent.id).toBe(intent.id);

    const queuedSnapshot = round33Snapshot([first, unrelated, target], { revision: 3 });
    view.rerender(
      <VendorListExecutor
        snapshot={queuedSnapshot}
        reading={reading}
        bottomIntentPresentation={round36BottomPresentation(reading, queuedSnapshot, intent, false)}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    expect(reading.getSession().bottomIntent.id).toBe(intent.id);
  });

  it('message-list-lifecycle TC-1019: removing a send target into Waiting cannot bypass destination readiness', () => {
    const intent = {
      id: 'composer:send-start:round37-timeline-to-waiting',
      inputEpoch: 0,
      afterPresentationRevision: 1,
      targetMessageIDs: ['round37-removable-target'],
    };
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.following }));
    const consumeBottomIntent = reading.consumeBottomIntent;
    reading.consumeBottomIntent = vi.fn((candidate) => consumeBottomIntent(candidate));
    reading.session = { ...reading.session, bottomIntent: intent };
    const first = round33Row('round37-waiting-first', 1);
    const target = {
      ...round33Row('round37-removable-target', 2),
      localState: 'waiting',
      body: { local: true, state: 'waiting' },
    };
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([first], { revision: 1 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_000,
      scrollTop: 200,
    });
    vendorHarness.scrollTo.mockClear();

    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([first, target], { revision: 2 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    // The only retry signals exercised here are public Presentation/range/
    // height deliveries. No timer, private callback, or detached state may
    // grant the old tail writer a new lease.
    act(() => vendorHarness.props.totalListHeightChanged());
    act(() => vendorHarness.props.rangeChanged({ startIndex: 1, endIndex: 2 }));
    expect({
      scrollWrites: vendorHarness.scrollTo.mock.calls,
      intentReceipts: reading.consumeBottomIntent.mock.calls,
      scrollTop: scroller.scrollTop,
      pendingIntent: reading.getSession().bottomIntent.id,
    }).toEqual({
      scrollWrites: [],
      intentReceipts: [],
      scrollTop: 200,
      pendingIntent: intent.id,
    });

    // Re-arm the same public owner tuple only to isolate the second branch of
    // this one contract. The first branch is the Waiting target; this branch
    // is the target's committed absence after removal.
    reading.session = { ...reading.session, mode: READING_MODE.following, bottomIntent: intent };
    reading.consumeBottomIntent.mockClear();
    vendorHarness.scrollTo.mockClear();
    view.rerender(
      <VendorListExecutor
        snapshot={{
          ...round33Snapshot([first], { revision: 3 }),
          changes: { kind: 'mixed', inserted: [], updated: [], removed: ['round37-removable-target'] },
        }}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    setRound35Geometry(scroller, { clientHeight: 600, scrollHeight: 1_000, scrollTop: 200 });
    act(() => vendorHarness.props.rangeChanged({ startIndex: 1, endIndex: 1 }));
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();
    expect(reading.consumeBottomIntent).not.toHaveBeenCalled();
    expect(reading.getSession().bottomIntent.id).toBe(intent.id);
    expect(scroller.scrollTop).toBe(200);
  });

  it('message-list-lifecycle TC-1019: a stale presentation revision is not a measured send target', () => {
    const intent = {
      id: 'composer:send-start:round37-unmeasured',
      inputEpoch: 0,
      afterPresentationRevision: 3,
      targetMessageIDs: ['round37-unmeasured-target'],
    };
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.following }));
    const consumeBottomIntent = reading.consumeBottomIntent;
    reading.consumeBottomIntent = vi.fn((candidate) => consumeBottomIntent(candidate));
    reading.session = { ...reading.session, bottomIntent: intent };
    const first = round33Row('round37-unmeasured-first', 1);
    const target = { ...round33Row('round37-unmeasured-target', 2), body: { local: false } };
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([first, target], { revision: 2 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_000,
      scrollTop: 200,
    });
    vendorHarness.scrollTo.mockClear();
    act(() => vendorHarness.props.rangeChanged({ startIndex: 1, endIndex: 2 }));
    act(() => vendorHarness.props.totalListHeightChanged());

    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();
    expect(reading.consumeBottomIntent).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(200);
    expect(reading.getSession().bottomIntent.id).toBe(intent.id);

    // The normal Presentation delivery is the only retry source. Once its
    // revision reaches the intent's public floor, the existing Vendor writer
    // may perform the one send join and receipt.
    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([first, target], { revision: 3 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(reading.getSession().bottomIntent.id).toBe('');
  });

  it('message-list-lifecycle TC-1019: native takeover revokes a pending tail join before public retries', () => {
    const intent = {
      id: 'composer:send-start:round37-native-revoke',
      inputEpoch: 0,
      afterPresentationRevision: 1,
      targetMessageIDs: ['round37-native-target'],
    };
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.following }));
    const consumeBottomIntent = reading.consumeBottomIntent;
    reading.consumeBottomIntent = vi.fn((candidate) => consumeBottomIntent(candidate));
    reading.session = { ...reading.session, bottomIntent: intent };
    reading.beginNavigation = vi.fn(({ direction, gestureID, geometryRevision }) => {
      reading.session = takeReadingControl(reading.session, {
        direction,
        gestureID,
        geometryRevision,
      });
      return { inputGeneration: reading.session.inputEpoch };
    });
    const first = round33Row('round37-native-first', 1);
    const target = {
      ...round33Row('round37-native-target', 2),
      localState: 'waiting',
      body: { local: true, state: 'waiting' },
    };
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([first], { revision: 1 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_000,
      scrollTop: 200,
    });
    vendorHarness.scrollTo.mockClear();

    // A real public native gesture revokes the old Reading intent first. The
    // later target/presentation and range/height callbacks must not resurrect
    // the old tail writer or receipt.
    act(() => fireEvent.wheel(scroller, { deltaY: -120 }));
    expect(reading.beginNavigation).toHaveBeenCalled();
    expect(reading.getSession().mode).toBe(READING_MODE.browsing);
    expect(reading.getSession().bottomIntent.id).toBe('');

    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([first, target], { revision: 2 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    setRound35Geometry(scroller, { clientHeight: 600, scrollHeight: 1_000, scrollTop: 200 });
    act(() => vendorHarness.props.rangeChanged({ startIndex: 1, endIndex: 2 }));
    act(() => vendorHarness.props.totalListHeightChanged());

    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();
    expect(reading.consumeBottomIntent).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(200);
  });

  it('message-list-lifecycle TC-1019: replacement root revokes an old height/range writer and receipt', () => {
    const intent = {
      id: 'composer:send-start:round37-root-revoke',
      inputEpoch: 0,
      afterPresentationRevision: 1,
      targetMessageIDs: ['round37-root-target'],
    };
    // Mount in browsing so arming the explicit following intent below is a
    // test-owned public state transition, not an initial layout write.
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.browsing }));
    const consumeBottomIntent = reading.consumeBottomIntent;
    reading.consumeBottomIntent = vi.fn((candidate) => consumeBottomIntent(candidate));
    const first = round33Row('round37-root-first', 1);
    const target = {
      ...round33Row('round37-root-target', 2),
      localState: 'waiting',
      body: { local: true, state: 'waiting' },
    };
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([first, target], { revision: 1 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const firstRoot = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_000,
      scrollTop: 200,
    });
    const staleHeightCallback = vendorHarness.props.totalListHeightChanged;
    const staleRangeCallback = vendorHarness.props.rangeChanged;
    vendorHarness.scrollTo.mockClear();

    // A keyed remount is the public physical-root replacement. It gives the
    // successor its own DOM node and retires the old callback/root tuple.
    view.rerender(
      <VendorListExecutor
        key="round37-root-successor"
        snapshot={round33Snapshot([first, target], { revision: 2 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const replacementRoot = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_000,
      scrollTop: 200,
    });
    vendorHarness.scrollTo.mockClear();
    // Arm the old intent only after the physical replacement. This prevents
    // the successor's own layout effect from being part of the stale-callback
    // proof; the callbacks below are still the pre-replacement public props.
    reading.session = {
      ...reading.session,
      mode: READING_MODE.following,
      bottomIntent: intent,
    };
    act(() => {
      staleRangeCallback({ startIndex: 1, endIndex: 2 });
      staleHeightCallback();
    });

    expect(firstRoot).not.toBe(replacementRoot);
    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();
    expect(replacementRoot.scrollTo).not.toHaveBeenCalled();
    expect(replacementRoot.scrollTop).toBe(200);
    expect(reading.consumeBottomIntent).not.toHaveBeenCalled();
    expect(reading.getSession().bottomIntent.id).toBe(intent.id);
  });

  it('message-list-lifecycle TC-1020: committed Waiting-to-timeline growth continues ordinary following after one send join', () => {
    const intent = {
      id: 'composer:send-start:round37-waiting',
      inputEpoch: 0,
      afterPresentationRevision: 1,
      targetMessageIDs: ['round37-queued-request'],
    };
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.following }));
    reading.session = { ...reading.session, bottomIntent: intent };
    const first = round33Row('round37-waiting-root', 1);
    const queued = { ...round33Row('round37-queued-request', 2), localState: 'queued', body: { local: true } };
    const humanNext = { ...round33Row('round37-human-next', 3), body: { local: false } };
    const running = { ...round33Row('round37-running', 4), body: { local: false } };
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([first], { revision: 1 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_000,
      scrollTop: 200,
    });
    vendorHarness.scrollTo.mockClear();

    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([first, queued], { revision: 2 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(reading.getSession().bottomIntent.id).toBe('');
    setRound35Geometry(scroller, { clientHeight: 600, scrollHeight: 1_100, scrollTop: 400 });
    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([first, queued, humanNext], { revision: 3 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).toHaveBeenCalledTimes(2);

    setRound35Geometry(scroller, { clientHeight: 600, scrollHeight: 1_180, scrollTop: 500 });
    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([first, queued, humanNext, running], { revision: 4 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).toHaveBeenCalledTimes(3);
  });

  it('message-list-lifecycle TC-1021: child-first and repeated committed heights follow while Waiting enters timeline', async () => {
    const intent = {
      id: 'composer:send-start:round37-child-first-waiting',
      inputEpoch: 0,
      afterPresentationRevision: 1,
      targetMessageIDs: ['round37-child-waiting'],
    };
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.following }));
    reading.session = { ...reading.session, bottomIntent: intent };
    const first = round33Row('round37-child-root', 1);
    const queued = { ...round33Row('round37-child-waiting', 2), localState: 'queued', body: { local: true } };
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([first], { revision: 1 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_000,
      scrollTop: 200,
    });
    vendorHarness.scrollTo.mockClear();

    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([first, queued], { revision: 2 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    expect(vendorHarness.scrollTo).toHaveBeenCalledTimes(1);
    expect(reading.getSession().bottomIntent.id).toBe('');

    setRound35Geometry(scroller, { clientHeight: 600, scrollHeight: 1_180, scrollTop: 400 });
    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([first, queued], { revision: 3 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    await act(async () => { await Promise.resolve(); });
    expect(vendorHarness.scrollTo).toHaveBeenCalledTimes(2);

    setRound35Geometry(scroller, { clientHeight: 600, scrollHeight: 1_240, scrollTop: 580 });
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).toHaveBeenCalledTimes(3);

    setRound35Geometry(scroller, { clientHeight: 600, scrollHeight: 1_280, scrollTop: 640 });
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).toHaveBeenCalledTimes(4);

    setRound35Geometry(scroller, { clientHeight: 600, scrollHeight: 1_312, scrollTop: 680 });
    view.rerender(
      <VendorListExecutor
        snapshot={{
          ...round33Snapshot([first, { ...queued, contentRevision: 2 }], { revision: 4 }),
          changes: { kind: 'revise', inserted: [], updated: ['round37-child-waiting'], removed: [] },
        }}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    await act(async () => { await Promise.resolve(); });
    expect(vendorHarness.scrollTo).toHaveBeenCalledTimes(5);
  });

  it('message-list-lifecycle TC-1022: Waiting-to-timeline growth stops after user input takes ownership', () => {
    const intent = {
      id: 'composer:send-start:round37-waiting-takeover',
      inputEpoch: 0,
      afterPresentationRevision: 1,
      targetMessageIDs: ['round37-takeover-target'],
    };
    const reading = installSemanticBottomIntentConsumer(round34Reading({ mode: READING_MODE.following }));
    reading.session = { ...reading.session, bottomIntent: intent };
    reading.onUserControl = vi.fn(() => {
      reading.session = { ...reading.session, mode: READING_MODE.browsing, inputEpoch: 1 };
    });
    const first = round33Row('round37-takeover-first', 1);
    const target = { ...round33Row('round37-takeover-target', 2), localState: 'queued', body: { local: true } };
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([first], { revision: 1 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_000,
      scrollTop: 200,
    });
    vendorHarness.scrollTo.mockClear();

    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([first, target], { revision: 2 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(reading.getSession().bottomIntent.id).toBe('');
    reading.onUserControl();

    setRound35Geometry(scroller, { clientHeight: 600, scrollHeight: 1_180, scrollTop: 400 });
    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([first, target], { revision: 3 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    act(() => vendorHarness.props.totalListHeightChanged());
    expect(vendorHarness.scrollTo).toHaveBeenCalledTimes(1);
    expect(scroller.scrollTop).toBe(400);
  });

  it('message-list-lifecycle TC-1023: public height delivery re-reads browsing ownership before writing', async () => {
    const reading = round34Reading({ mode: READING_MODE.following });
    reading.onUserControl = vi.fn(() => {
      reading.session = {
        ...reading.session,
        mode: READING_MODE.browsing,
        inputEpoch: reading.session.inputEpoch + 1,
        bottomIntent: { id: '', inputEpoch: reading.session.inputEpoch + 1 },
      };
    });
    const first = round33Row('round38-control-first', 1);
    render(
      <VendorListExecutor
        snapshot={round33Snapshot([first], { revision: 1 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_000,
      scrollTop: 400,
    });
    vendorHarness.scrollTo.mockClear();

    reading.onUserControl();
    setRound35Geometry(scroller, { clientHeight: 600, scrollHeight: 1_200, scrollTop: 400 });
    await act(async () => {
      vendorHarness.props.totalListHeightChanged();
      await Promise.resolve();
    });

    expect(reading.getSession().mode).toBe(READING_MODE.browsing);
    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(400);
  });

  it('message-list-lifecycle TC-1024: a pre-activation height callback cannot write into the successor owner', () => {
    const firstOwner = round34Reading({ mode: READING_MODE.following, activationID: 'activation:round38-first' });
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([round33Row('round38-first', 1)], { revision: 1 })}
        reading={firstOwner}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const scroller = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_000,
      scrollTop: 400,
    });
    vendorHarness.scrollTo.mockClear();
    const staleHeightCallback = vendorHarness.props.totalListHeightChanged;
    const physicalRoot = scroller;
    const successor = round34Reading({ mode: READING_MODE.following, activationID: 'activation:round38-successor' });

    view.rerender(
      <VendorListExecutor
        snapshot={round33Snapshot([round33Row('round38-successor', 2)], { revision: 2 })}
        reading={successor}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    vendorHarness.scrollTo.mockClear();
    setRound35Geometry(scroller, { clientHeight: 600, scrollHeight: 1_200, scrollTop: 400 });
    expect(vendorHarness.root).toBe(physicalRoot);
    staleHeightCallback();

    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(400);
    expect(screen.getByText('round38-successor')).toBeTruthy();

    // The current successor callback still owns this same physical root; the
    // stale callback above is the only one that must be fenced out.
    vendorHarness.props.totalListHeightChanged();
    expect(vendorHarness.scrollTo).toHaveBeenCalledOnce();
    expect(vendorHarness.scrollTo).toHaveBeenCalledWith({ top: 1_200, behavior: 'auto' });
    expect(physicalRoot.scrollTop).toBe(1_200);
  });

  it('message-list-lifecycle TC-1024b: a same-activation callback cannot write into a replacement root', () => {
    const reading = round34Reading({ mode: READING_MODE.following, activationID: 'activation:round40-root' });
    render(
      <VendorListExecutor
        snapshot={round33Snapshot([round33Row('round40-root-first', 1)], { revision: 1 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const firstRoot = setRound35Geometry(vendorHarness.root, {
      clientHeight: 600,
      scrollHeight: 1_000,
      scrollTop: 400,
    });
    const staleHeightCallback = vendorHarness.props.totalListHeightChanged;
    const replacementRoot = setRound35Geometry(document.createElement('div'), {
      clientHeight: 600,
      scrollHeight: 1_200,
      scrollTop: 400,
    });
    replacementRoot.scrollTo = vi.fn((options) => {
      replacementRoot.scrollTop = Number(options?.top || 0);
    });

    // Replace only the mounted physical root. Activation and generation stay
    // equal, so the physical-root fence is the deciding owner boundary.
    act(() => {
      vendorHarness.props.scrollerRef?.(replacementRoot);
      staleHeightCallback();
    });

    expect(firstRoot).not.toBe(replacementRoot);
    expect(replacementRoot.scrollTo).not.toHaveBeenCalled();
    expect(replacementRoot.scrollTop).toBe(400);
  });

  it('message-list-lifecycle TC-1025: a late public height callback after unmount is a no-op', () => {
    const reading = round34Reading({ mode: READING_MODE.following });
    const view = render(
      <VendorListExecutor
        snapshot={round33Snapshot([round33Row('round38-unmounted', 1)], { revision: 1 })}
        reading={reading}
        renderRow={(row) => <article>{row.id}</article>}
      />,
    );
    const lateHeightCallback = vendorHarness.props.totalListHeightChanged;
    view.unmount();

    expect(() => lateHeightCallback()).not.toThrow();
    expect(vendorHarness.scrollTo).not.toHaveBeenCalled();
  });

  it('message-list-lifecycle TC-1027: a suspended same-activation candidate cannot replace committed rows', () => {
    const presentation = createConversationPresentation();
    const committedEntry = presentationEntry('round38-committed', 1);
    const initial = presentation.evaluate([committedEntry], {
      nextViewID: 'channel:all:round38', epoch: 'generation:round38', sourceRevision: 1,
    });
    expect(presentation.commitCandidate(initial)).toBe(true);
    const committed = initial.snapshot;
    const suspended = new Promise(() => {});

    function DiscardedView() {
      presentation.evaluate([presentationEntry('round38-speculative', 2)], {
        nextViewID: 'channel:all:round38', epoch: 'generation:round38', sourceRevision: 2,
      });
      throw suspended;
    }

    render(<Suspense fallback={<p>loading</p>}><DiscardedView /></Suspense>);
    expect(screen.getByText('loading')).toBeTruthy();
    expect(presentation.current()).toBe(committed);

    const resumed = presentation.evaluate([committedEntry], {
      nextViewID: 'channel:all:round38', epoch: 'generation:round38', sourceRevision: 1,
    });
    expect(presentation.commitCandidate(resumed)).toBe(true);
    expect(presentation.current()).toBe(committed);
    expect(presentation.current().orderedIDs).toEqual(['round38-committed']);
  });
});

describe('I-M exact-path public-owner recovery (round 41 data and presentation contracts)', () => {
  it('memory-window TC-0942: nested terminal control facts survive public closure reconciliation', () => {
    const store = createChannelReplicaStore();
    const steer = envelope(1, {
      id: 'round41-steer',
      kind: 'request',
      type: 'agent.steer',
      audience: [AGENT],
      body: { text: '改道' },
    });
    const terminalRow = terminal(2, 'round41-steer');
    terminalRow.envelope.type = 'agent.steer';
    terminalRow.envelope.payload.body.value = {
      merged_into: 'turn-7',
      preempted_by: 'replacement-8',
      replaced_by: 'turn-9',
    };
    store.commit(steer, SELF);
    store.commit(terminalRow, SELF);
    for (let seq = 3; seq <= 8; seq += 1) store.commit(note(seq), SELF);

    expect(store.trim(CHANNEL, 4)).toBeGreaterThan(0);
    // Re-admit the exact public request and terminal rows after the closure
    // was compacted. The user-visible turn must retain all three control
    // relations; no closure-specific map is inspected here.
    store.commit(steer, SELF);
    store.commit(terminalRow, SELF);
    const turn = store.state(CHANNEL).timeline
      .find((entry) => entry.turn?.requestId === 'round41-steer')?.turn;
    expect(turn).toMatchObject({
      requestId: 'round41-steer', status: 'completed', terminalClosureOnly: false,
    });
    expect(turn.terminal.payload.body.value).toEqual({
      merged_into: 'turn-7',
      preempted_by: 'replacement-8',
      replaced_by: 'turn-9',
    });
  });

  it('memory-window TC-0950: the public cache byte budget only narrows a page', async () => {
    const cache = createChannelReplicaCache({ indexedDB: null });
    await cache.ensureOwner('root', { world: 'round41-byte-budget' });
    await cache.clear();
    const rows = [1, 2, 3].map((seq) => envelope(seq, {
      id: `round41-cache-${seq}`,
      body: { text: `${seq}`.repeat(160) },
    }));
    try {
      expect(await cache.saveRows(rows)).toBe(3);
      const page = await cache.readBefore(CHANNEL, 99, 10, 420);
      expect(page.rows.length).toBeGreaterThan(0);
      expect(page.rows.length).toBeLessThan(rows.length);
      expect(page.bytes).toBeLessThanOrEqual(420);
      expect(page.rows.map((row) => row.seq)).toEqual([3]);
    } finally {
      await cache.clear();
    }
  });

  it('memory-window baseline 35: a byte-bounded page preserves opaque nested row data', async () => {
    const cache = createChannelReplicaCache({ indexedDB: null });
    await cache.ensureOwner('root', { world: 'round52-byte-shape' });
    await cache.clear();
    const rows = [1, 2].map((seq) => envelope(seq, {
      id: `round52-cache-${seq}`,
      body: { text: `row-${seq}`, result: { nested: 'x'.repeat(3_200) } },
    }));
    try {
      expect(await cache.saveRows(rows)).toBe(2);
      const page = await cache.readBefore(CHANNEL, 99, 10, 5_000);
      expect(page.rows.map((row) => row.seq)).toEqual([2]);
      expect(page.rows[0].envelope.payload.body.result.nested).toHaveLength(3_200);
      expect(page.bytes).toBeLessThanOrEqual(5_000);
    } finally {
      await cache.clear();
    }
  });

  it('memory-window baseline 36: mobile history policy remains bounded by public defaults', () => {
    const storage = (() => {
      const values = new Map();
      return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
      };
    })();
    const mobile = detectProfile({
      matchMedia: (query) => ({ matches: query === '(pointer: coarse)' || query === '(max-width: 900px)' }),
      search: '',
      storage,
    });
    const desktop = detectProfile({
      matchMedia: () => ({ matches: false }),
      search: '?perf=desktop',
      storage,
    });

    expect(mobile).toBe(PROFILE_MOBILE);
    expect(desktop).toBe(PROFILE_DESKTOP);
    // The deleted MOBILE_WINDOW export was an implementation detail. The
    // current public history policy remains finite and bounded; preserving
    // the old maxima is the user invariant, not the old numeric constant.
    expect(HISTORY_PAGE_SIZE).toBeGreaterThan(0);
    expect(HISTORY_PAGE_SIZE).toBeLessThanOrEqual(500);
    expect(HISTORY_BATCH_BYTES).toBeGreaterThan(0);
    expect(HISTORY_BATCH_BYTES).toBeLessThanOrEqual(8 * 1024 * 1024);
  });

  it('memory-window TC-0951: a reload derives coverage from physical rows and keeps a gap unknown', async () => {
    const cache = createChannelReplicaCache({ indexedDB: null });
    await cache.ensureOwner('root', { world: 'round41-physical-gap' });
    await cache.clear();
    try {
      await cache.saveRows([envelope(1, { id: 'round41-gap-1' }), envelope(3, { id: 'round41-gap-3' })], {
        coverage: { channelId: CHANNEL, lowSeq: 1, highSeq: 3 },
      });
      expect((await cache.readBefore(CHANNEL, 4, 10, 10_000)).rows.map((row) => row.seq))
        .toEqual([1, 3]);

      await cache.ensureOwner('root', { world: 'round41-physical-gap' });
      expect(cache.metaSnapshot().get(CHANNEL)).toMatchObject({
        rowCount: 2,
        oldestSeq: 1,
        newestSeq: 3,
        coverage: [{ lowSeq: 1, highSeq: 1 }, { lowSeq: 3, highSeq: 3 }],
      });
      const page = await cache.readBefore(CHANNEL, 4, 10, 10_000);
      expect(page.rows.map((row) => row.seq)).toEqual([1, 3]);
      expect(page.exhausted).toBe(false);
    } finally {
      await cache.clear();
    }
  });

  it('message-presentation TC-1028: typed system operations render product language through the public row owner', () => {
    const row = messageRow(TYPES.channel.create, {
      name: 'round41-room',
      recipe: { declarations: [] },
    });
    row.body.envelope.visibility = 'system';
    render(<MessageHarness row={row} />);
    expect(screen.getByText('创建子频道：round41-room')).toBeTruthy();
    expect(screen.queryByText(TYPES.channel.create)).toBeNull();
  });

  it('message-presentation TC-1029: unknown structured payloads never expose sensitive hints', () => {
    const row = messageRow('vendor.round41.custom', {
      status: 'completed',
      result: { nested: { value: 1 }, token: 'round41-secret' },
    });
    row.body.envelope.kind = 'response';
    row.body.envelope.sender = { id: AGENT, kind: 'agent' };
    row.body.envelope.audience = [SELF];
    render(<MessageHarness row={row} />);
    expect(screen.queryByText('round41-secret')).toBeNull();
    expect(document.querySelector('.message-body')?.textContent).toContain('已隐藏');
  });
});
