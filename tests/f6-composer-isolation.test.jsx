// @vitest-environment jsdom
import React, { Suspense, startTransition, useLayoutEffect } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { Composer } from '../src/ui/Composer.jsx';
import { Timeline } from '../src/ui/Timeline.jsx';
import { ReadingIntentProvider, useReadingIntent } from '../src/ui/conversation/ReadingIntentContext.jsx';

// This assertion is only about React surface isolation. It neither claims nor
// stubs a virtual-list geometry/paging contract; those F6 IDs live in Chromium.
vi.mock('../src/ui/timeline/LegendMessageList.jsx', async () => ({
  MessageList: (await import('./helpers/PresentationMessageList.jsx')).PresentationMessageList,
}));

afterEach(cleanup);

it('creates one bottom intent at send-start and acceptance only consumes its correlation token', async () => {
  let readingIntent;
  function Probe() {
    const value = useReadingIntent();
    useLayoutEffect(() => { readingIntent = value; }, [value]);
    return null;
  }
  const state = {
    channelId: 'c0', rows: new Map(), turns: new Map(), standalone: [],
    orphans: [], narration: [], lastSeq: 0,
  };
  const view = render(<Timeline
    state={state}
    composer={<Probe />}
    roster={[{ id: 'me', name: '我' }]}
    selfId="me"
    pending={[]}
    approvalStates={{}}
  />);
  await waitFor(() => expect(readingIntent?.composerSendStarted).toBeTypeOf('function'));
  expect(readingIntent.composerAccepted('c0', ['m-null'], null)).toBe(false);
  expect(readingIntent.composerAccepted('c0', ['m-malformed'], { activationID: 'x' })).toBe(false);

  const token = readingIntent.composerSendStarted('c0');
  expect(token).toMatchObject({ activationID: expect.any(String), inputEpoch: 0, intentRevision: 1 });
  let accepted;
  act(() => { accepted = readingIntent.composerAccepted('c0', ['m-valid'], token); });
  expect(accepted).toBe(true);
  act(() => { accepted = readingIntent.composerAccepted('c0', ['m-valid'], token); });
  expect(accepted).toBe(false);

  const rejectedToken = readingIntent.composerSendStarted('c0');
  expect(rejectedToken).toMatchObject({ bottomIntentID: expect.stringMatching(/^composer:send-start:/) });
  let rejected;
  act(() => { rejected = readingIntent.composerRejected('c0', rejectedToken); });
  expect(rejected).toBe(true);
  act(() => { rejected = readingIntent.composerRejected('c0', rejectedToken); });
  expect(rejected).toBe(false);

  const oldIntent = readingIntent;
  const staleToken = oldIntent.composerSendStarted('c0');
  view.rerender(<Timeline
    state={{ ...state, channelId: 'c1' }}
    composer={<Probe />}
    roster={[{ id: 'me', name: '我' }]}
    selfId="me"
    pending={[]}
    approvalStates={{}}
  />);
  await waitFor(() => expect(readingIntent).not.toBe(oldIntent));
  expect(oldIntent.composerAccepted('c0', ['m-late'], staleToken)).toBe(false);
});

it('F6-PERF-06 逐字输入不重新渲染独立的 Timeline 表面', async () => {
  const user = userEvent.setup();
  const standalone = Array.from({ length: 5_000 }, (_, index) => ({
    seq: index + 1,
    envelope: {
      id: `m-${index}`, kind: 'event', type: 'human.note', ts: 1_700_000_000_000 + index,
      sender: { id: 'alice', kind: 'human' }, payload: { text: `动态 ${index + 1}` },
    },
  }));
  const state = { channelId: 'c0', rows: new Map(standalone.map((row) => [row.seq, row.envelope])), turns: new Map(), standalone, orphans: [], narration: [], lastSeq: 5_000 };
  let timelineRenders = 0;
  let draft = '';
  function TrackedTimeline() {
    timelineRenders += 1;
    return <Timeline state={state} roster={[{ id: 'alice', name: 'Alice' }]} pending={[]} approvalStates={{}} />;
  }
  render(<><TrackedTimeline /><Composer channelId="c0" roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-1', kind: 'agent', name: '研究员' }]} selfId="me" onDraftChange={(value) => { draft = value; }} onSend={() => Promise.resolve('message-1')} /></>);
  const before = timelineRenders;
  await user.type(screen.getByRole('textbox', { name: '消息' }), '这段输入不应驱动五千条动态重新渲染');
  expect(draft.text).toBe('这段输入不应驱动五千条动态重新渲染');
  expect(draft.doc.type).toBe('doc');
  expect(timelineRenders).toBe(before);
// The 5,000-row projection plus real ProseMirror keystrokes takes ~12s alone
// and can exceed 20s while the full Vitest pool is saturated. Keep every
// render/text assertion intact; this timeout is harness headroom only.
}, 40_000);

it('Composer send-start emits once and durable acceptance only correlates the stable id', async () => {
  const user = userEvent.setup();
  const composerAccepted = vi.fn();
  const token = { activationID: 'a1', inputEpoch: 0, intentRevision: 0, mode: 'following' };
  const composerSendStarted = vi.fn(() => token);
  const onSend = vi.fn().mockResolvedValue(['message-1']);
  render(
    <ReadingIntentProvider value={{ composerSendStarted, composerAccepted }}>
      <Composer
        channelId="c0"
        roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-1', kind: 'agent', name: '研究员' }]}
        selfId="me"
        onDraftChange={() => ({ revision: 1 })}
        onSend={onSend}
      />
    </ReadingIntentProvider>,
  );
  const editor = screen.getByRole('textbox', { name: '消息' });
  await user.type(editor, '@研');
  await user.click(await screen.findByRole('option', { name: /研究员/ }));
  await user.type(editor, '请继续');
  await user.click(screen.getByRole('button', { name: '发送' }));
  await vi.waitFor(() => expect(onSend).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(editor.textContent).toBe(''));
  expect(document.querySelector('.composer-wrap')?.hasAttribute('data-send-clear-revision')).toBe(false);
  expect(composerSendStarted).toHaveBeenCalledWith('c0');
  expect(composerAccepted).toHaveBeenCalledOnce();
  expect(composerAccepted).toHaveBeenCalledWith('c0', ['message-1'], token);
});

it('keeps deferred ProseMirror draft persistence on the last committed owner while a same-channel candidate render suspends', async () => {
  const user = userEvent.setup();
  const committedDraft = vi.fn().mockResolvedValue({ revision: 1 });
  const candidateDraft = vi.fn().mockResolvedValue({ revision: 2 });
  const committedSend = vi.fn().mockResolvedValue(['message-a']);
  const candidateSend = vi.fn().mockResolvedValue(['message-b']);
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const renders = [];
  function Candidate({ label, props }) {
    renders.push(label);
    return <Composer {...props} />;
  }
  function SuspendAfterComposer({ active }) {
    if (active) throw blocked;
    return null;
  }
  const common = {
    channelId: 'c0',
    selfId: 'me',
    roster: [{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-a', kind: 'agent', name: '研究员' }],
  };
  const committedProps = {
    ...common,
    attachments: [],
    onDraftChange: committedDraft,
    onSend: committedSend,
  };
  const candidateProps = {
    ...common,
    attachments: [{ resource_id: 'candidate-file', name: 'candidate.txt' }],
    replyTarget: { sourceId: 'candidate-reply', senderId: 'agent-a', senderName: '研究员', senderKind: 'agent' },
    canDurablyAccept: false,
    onDraftChange: candidateDraft,
    onSend: candidateSend,
  };
  const view = render(<Suspense fallback={<p>候选等待中</p>}>
    <Candidate label="A" props={committedProps} />
    <SuspendAfterComposer active={false} />
  </Suspense>);
  const editor = screen.getByRole('textbox', { name: '消息' });
  await user.type(editor, '已提交正文');
  await waitFor(() => expect(committedDraft).toHaveBeenCalled());
  committedDraft.mockClear();

  await act(async () => {
    startTransition(() => view.rerender(<Suspense fallback={<p>候选等待中</p>}>
      <Candidate label="B" props={candidateProps} />
      <SuspendAfterComposer active />
    </Suspense>));
  });
  expect(renders).toContain('B');
  expect(screen.queryByText('候选等待中')).toBeNull();

  // ProseMirror onUpdate originates outside React commit and schedules draft
  // persistence through the owner port captured by the last layout commit.
  await user.type(editor, '补');
  await waitFor(() => expect(committedDraft).toHaveBeenCalled());
  expect(committedDraft.mock.calls.at(-1)[0]).toMatchObject({
    attachments: [],
    replyTarget: null,
  });
  expect(candidateDraft).not.toHaveBeenCalled();

  view.unmount();
  release();
});

it('keeps ProseMirror Enter authority on the committed send port when a same-channel candidate suspends', async () => {
  const user = userEvent.setup();
  const committedSend = vi.fn().mockResolvedValue(['message-a']);
  const candidateSend = vi.fn().mockResolvedValue(['message-b']);
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const renders = [];
  function Candidate({ label, props }) {
    renders.push(label);
    return <Composer {...props} />;
  }
  function SuspendAfterComposer({ active }) {
    if (active) throw blocked;
    return null;
  }
  const common = {
    channelId: 'c0',
    selfId: 'me',
    roster: [{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-a', kind: 'agent', name: '研究员' }],
    onDraftChange: vi.fn().mockResolvedValue({ revision: 1 }),
  };
  const view = render(<Suspense fallback={<p>候选等待中</p>}>
    <Candidate label="A" props={{ ...common, attachments: [], onSend: committedSend }} />
    <SuspendAfterComposer active={false} />
  </Suspense>);
  const editor = screen.getByRole('textbox', { name: '消息' });
  await user.type(editor, '已提交正文');

  await act(async () => {
    startTransition(() => view.rerender(<Suspense fallback={<p>候选等待中</p>}>
      <Candidate label="B" props={{
        ...common,
        attachments: [{ resource_id: 'candidate-file', name: 'candidate.txt' }],
        canDurablyAccept: false,
        onSend: candidateSend,
      }} />
      <SuspendAfterComposer active />
    </Suspense>));
  });
  expect(renders).toContain('B');
  expect(screen.queryByText('候选等待中')).toBeNull();

  // No intervening editor transaction or React state update is allowed to
  // abort the pending render before the long-lived key handler reads submitRef.
  await user.keyboard('{Enter}');
  await waitFor(() => expect(committedSend).toHaveBeenCalledOnce());
  expect(candidateSend).not.toHaveBeenCalled();

  view.unmount();
  release();
});

it('captures send authority before deferred durable acceptance and never refreshes it on resolve', async () => {
  const user = userEvent.setup();
  let resolveAcceptance;
  const accepted = new Promise((resolve) => { resolveAcceptance = resolve; });
  const token = { activationID: 'send-start', inputEpoch: 4, intentRevision: 7, mode: 'browsing' };
  const composerSendStarted = vi.fn(() => token);
  const composerAccepted = vi.fn();
  const onSend = vi.fn(() => accepted);
  render(
    <ReadingIntentProvider value={{ composerSendStarted, composerAccepted }}>
      <Composer
        channelId="c0"
        roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-1', kind: 'agent', name: '研究员' }]}
        selfId="me"
        onDraftChange={() => ({ revision: 1 })}
        onSend={onSend}
      />
    </ReadingIntentProvider>,
  );
  const editor = screen.getByRole('textbox', { name: '消息' });
  await user.type(editor, '@研');
  await user.click(await screen.findByRole('option', { name: /研究员/ }));
  await user.type(editor, '请继续');
  const click = user.click(screen.getByRole('button', { name: '发送' }));
  await vi.waitFor(() => expect(onSend).toHaveBeenCalledOnce());
  expect(composerSendStarted).toHaveBeenCalledOnce();
  expect(composerAccepted).not.toHaveBeenCalled();

  resolveAcceptance(['message-late']);
  await click;
  expect(composerSendStarted).toHaveBeenCalledOnce();
  expect(composerAccepted).toHaveBeenCalledWith('c0', ['message-late'], token);
});

it('does not emit an acceptance event when durable write fails after the one send-start', async () => {
  const user = userEvent.setup();
  const composerSendStarted = vi.fn(() => ({
    activationID: 'a1', inputEpoch: 0, intentRevision: 0, mode: 'following',
  }));
  const composerAccepted = vi.fn();
  const composerRejected = vi.fn(() => true);
  render(
    <ReadingIntentProvider value={{ composerSendStarted, composerAccepted, composerRejected }}>
      <Composer
        channelId="c0"
        roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-1', kind: 'agent', name: '研究员' }]}
        selfId="me"
        onDraftChange={() => ({ revision: 1 })}
        onSend={() => Promise.reject(new Error('IndexedDB acceptance failed'))}
      />
    </ReadingIntentProvider>,
  );
  const editor = screen.getByRole('textbox', { name: '消息' });
  await user.type(editor, '@研');
  await user.click(await screen.findByRole('option', { name: /研究员/ }));
  await user.type(editor, '请继续');
  await user.click(screen.getByRole('button', { name: '发送' }));
  await screen.findByRole('alert');
  expect(composerSendStarted).toHaveBeenCalledOnce();
  expect(composerAccepted).not.toHaveBeenCalled();
  expect(composerRejected).toHaveBeenCalledOnce();
});

it('releases the durable-accept mutex before transport settles and retains an older late rejection', async () => {
  const user = userEvent.setup();
  const composerSendStarted = vi.fn(() => ({
    activationID: 'a1', inputEpoch: 0, intentRevision: 1, mode: 'following',
  }));
  const composerAccepted = vi.fn(() => true);
  const onSend = vi.fn()
    .mockResolvedValueOnce(['message-1'])
    .mockResolvedValueOnce(['message-2']);
  const onRetry = vi.fn();
  const props = (pending) => ({
    channelId: 'c0',
    roster: [{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-1', kind: 'agent', name: '研究员' }],
    selfId: 'me',
    pending,
    onDraftChange: () => ({ revision: 1 }),
    onSend,
    onRetry,
  });
  const view = render(
    <ReadingIntentProvider value={{ composerSendStarted, composerAccepted }}>
      <Composer {...props([])} />
    </ReadingIntentProvider>,
  );
  const editor = screen.getByRole('textbox', { name: '消息' });
  await user.type(editor, '第一条');
  await user.click(screen.getByRole('button', { name: '发送' }));
  await vi.waitFor(() => expect(onSend).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(editor.textContent).toBe(''));

  view.rerender(
    <ReadingIntentProvider value={{ composerSendStarted, composerAccepted }}>
      <Composer {...props([{ messageId: 'message-1', state: 'transmitting' }])} />
    </ReadingIntentProvider>,
  );
  await user.type(editor, '第二条');
  expect(screen.getByRole('button', { name: '发送' }).disabled).toBe(false);
  await user.click(screen.getByRole('button', { name: '发送' }));
  await vi.waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));

  const uncertain = { messageId: 'message-2', state: 'uncertain' };
  view.rerender(
    <ReadingIntentProvider value={{ composerSendStarted, composerAccepted }}>
      <Composer {...props([
        { messageId: 'message-1', state: 'transmitting' },
        uncertain,
      ])} />
    </ReadingIntentProvider>,
  );
  await user.click(await screen.findByRole('button', { name: '使用原编号重试' }));
  expect(onRetry).toHaveBeenCalledWith(uncertain);

  view.rerender(
    <ReadingIntentProvider value={{ composerSendStarted, composerAccepted }}>
      <Composer {...props([
        { messageId: 'message-1', state: 'rejected', error: { detail: '首条晚到拒绝' } },
        { messageId: 'message-2', state: 'transmitting' },
      ])} />
    </ReadingIntentProvider>,
  );
  expect((await screen.findByRole('alert')).textContent).toContain('首条晚到拒绝');
  expect(composerAccepted).toHaveBeenCalledTimes(2);
});

it('clears the accepted editor version without clearing newer input typed during durable acceptance', async () => {
  const user = userEvent.setup();
  let resolveAcceptance;
  const acceptance = new Promise((resolve) => { resolveAcceptance = resolve; });
  render(
    <ReadingIntentProvider value={{
      composerSendStarted: () => ({ activationID: 'a1', inputEpoch: 0, intentRevision: 1, mode: 'following' }),
      composerAccepted: () => true,
    }}>
      <Composer
        channelId="c0"
        roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-1', kind: 'agent', name: '研究员' }]}
        selfId="me"
        onDraftChange={() => ({ revision: 1 })}
        onSend={() => acceptance}
      />
    </ReadingIntentProvider>,
  );
  const editor = screen.getByRole('textbox', { name: '消息' });
  await user.type(editor, '不可重复的快照');
  const click = user.click(screen.getByRole('button', { name: '发送' }));
  await vi.waitFor(() => expect(screen.getByRole('button', { name: '发送中' }).disabled).toBe(true));
  expect(editor.getAttribute('contenteditable')).toBe('true');
  await user.type(editor, '；这是下一稿');
  expect(screen.getByRole('button', { name: '发送中' }).disabled).toBe(true);
  resolveAcceptance(['message-1']);
  await click;
  expect(editor.textContent).toContain('这是下一稿');
  expect(document.querySelector('.composer-wrap')?.hasAttribute('data-send-clear-revision')).toBe(false);
});

it('does not send a text-only snapshot while a selected attachment is still uploading', async () => {
  const user = userEvent.setup();
  let finishUpload;
  const upload = new Promise((resolve) => { finishUpload = resolve; });
  const onSend = vi.fn().mockResolvedValue(['message-1']);
  render(<Composer
    channelId="c0"
    roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-1', kind: 'agent', name: '研究员' }]}
    selfId="me"
    onDraftChange={() => ({ revision: 1 })}
    onUploadAttachments={() => upload}
    onSend={onSend}
  />);
  await user.type(screen.getByRole('textbox', { name: '消息' }), '正文和附件必须同批');
  const uploading = user.upload(
    screen.getByLabelText('上传本机文件到频道'),
    new File(['evidence'], 'evidence.txt', { type: 'text/plain' }),
  );
  await vi.waitFor(() => expect(screen.getByRole('button', { name: '发送' }).disabled).toBe(true));
  expect(onSend).not.toHaveBeenCalled();
  finishUpload();
  await uploading;
  await vi.waitFor(() => expect(screen.getByRole('button', { name: '发送' }).disabled).toBe(false));
});

it('disables every normal-draft attachment entry while editing an existing message', () => {
  const onUploadAttachments = vi.fn();
  render(<Composer
    channelId="c0"
    roster={[{ id: 'me', kind: 'human', name: '我' }]}
    selfId="me"
    onUploadAttachments={onUploadAttachments}
    onOpenChannelFiles={vi.fn()}
    editMode={{ session: { id: 'edit-1', targetId: 'target-1', phase: 'editing', text: '旧消息' }, onSave: vi.fn(), onAbandon: vi.fn() }}
  />);
  expect(screen.getByLabelText('上传本机文件到频道').disabled).toBe(true);
  expect(screen.getByRole('button', { name: '从频道文件选择' }).disabled).toBe(true);
  expect(onUploadAttachments).not.toHaveBeenCalled();
});
