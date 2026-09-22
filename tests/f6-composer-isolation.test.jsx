// @vitest-environment jsdom
// 恢复自 master:tests/f6-composer-isolation.test.jsx（RC，2026-09-19）。
// 旧测试渲染已删除的 src/ui/Composer.jsx（扁平 props：channelId/roster/onDraftChange/onSend）
// 与 src/ui/Timeline.jsx，一次性覆盖"发送起点 token/阅读意图隔离/candidate-vs-committed
// owner/durable acceptance 时序"四类不变量。
// 新结构里 Composer 收敛成 model+commands 两个 prop（src/ui/composer/Composer.jsx），
// send-start/accepted/rejected 的 token 协议原样保留在
// src/ui/composer/useComposerCommands.js 的 performSend()（composerSendStarted/
// composerAccepted/composerRejected 三个可选回调，通过 ReadingIntentContext 注入）。
// candidate-vs-committed 的 React Suspense 架构已整体移除（同文件 6 的判定：src 全仓
// grep Suspense/startTransition 在 Composer 链路零命中）。
// 判定逐条记在 audit-output/RESTORE-MATRIX.md。
import 'fake-indexeddb/auto';
import React, { useLayoutEffect } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useComposerCommands } from '../src/ui/composer/useComposerCommands.js';
import { buildComposerModel } from '../src/ui/composer/composer-model.js';
import { Composer } from '../src/ui/composer/Composer.jsx';
import { ReadingIntentProvider, useReadingIntent } from '../src/ui/conversation/ReadingIntentContext.jsx';

afterEach(() => { cleanup(); });

const CLAUDE = { id: 'agent:claude:1', kind: 'agent', name: 'claude' };
const CODEX = { id: 'agent:codex:1', kind: 'agent', name: 'codex' };
const ROSTER = [{ id: 'root', kind: 'human', name: 'root' }, CLAUDE];

// Composer isolation owns the command/acceptance protocol; durable storage is
// a separate owner contract covered by the outbox tests. Keep this harness
// deterministic by supplying the same public store methods in memory, so an
// unmount cannot close an unrelated IndexedDB operation after the assertion.
function createMemoryOutboxStore() {
  const drafts = new Map();
  const submissions = new Map();
  return {
    async restore() { return [...submissions.values()]; },
    async restoreDrafts() { return [...drafts.values()]; },
    async writeDraft(principalId, channelId, draft, expectedRevision = 0) {
      const previous = drafts.get(`${principalId}:${channelId}`);
      const revision = Number(previous?.revision || 0);
      if (revision !== Number(expectedRevision || 0)) return { conflict: true, current: previous };
      const record = { principalId, channelId, revision: revision + 1, editorRevision: draft.editorRevision || 0, draft };
      drafts.set(`${principalId}:${channelId}`, record);
      return { conflict: false, record };
    },
    async putMany(principalId, rows) {
      rows.forEach((row) => submissions.set(`${principalId}:${row.messageId}`, { ...row, principalId }));
      return rows.map((row) => ({ ...row, principalId }));
    },
    async acceptDraft({ principalId, channelId, submissions: rows, expectedRevision = 0, editorRevision = 0 }) {
      const key = `${principalId}:${channelId}`;
      const current = drafts.get(key);
      if (Number(current?.revision || 0) < Number(expectedRevision || 0)) return { accepted: false, conflict: current || null };
      rows.forEach((row) => submissions.set(`${principalId}:${row.messageId}`, { ...row, principalId }));
      const record = { ...current, principalId, channelId, revision: Number(current?.revision || 0) + 1, editorRevision, draft: null };
      drafts.set(key, record);
      return { accepted: true, consumed: true, record, submissions: rows.map((row) => ({ ...row, principalId })) };
    },
    async patch(principalId, messageId, expectedStates, change) {
      const key = `${principalId}:${messageId}`;
      const current = submissions.get(key);
      if (!current || (expectedStates?.length && !expectedStates.includes(current.state))) return null;
      const next = { ...current, ...change };
      submissions.set(key, next);
      return next;
    },
    async remove(principalId, messageId) { return submissions.delete(`${principalId}:${messageId}`); },
    async acquireLease() { return null; },
    async releaseLease() { return false; },
    close() {},
  };
}

function commandsHarness(overrides = {}) {
  return {
    principalId: 'root', activeChannelId: 'c0', wireState: 'closed',
    wireRef: { current: null },
    rosterRef: { current: { recordSubmission: vi.fn(), observeFeed: vi.fn(), forgetSubmission: vi.fn() } },
    accessRef: { current: { state: () => ({ authorityEpoch: 1, relationship: 'member', existence: 'present', runtime: 'open', unavailable: false }) } },
    producerOwnerToken: 'owner:root', generationFor: () => 1, serverWorld: 'world-a',
    outboxFactory: createMemoryOutboxStore,
    onError: vi.fn(), onNotice: vi.fn(), onFeedChanged: vi.fn(), onAccessChanged: vi.fn(),
    roster: ROSTER, selfId: 'root', access: 'member_active',
    agentSelection: { selectedAgentId: 'agent:claude:1' }, capabilityIndex: new Map(),
    attachments: [], edit: null, channelState: { timeline: [] },
    onRequestCapability: vi.fn(), probes: { targetChanged: vi.fn(), requestKeys: () => ({}) },
    attachmentRef: { current: { attach: vi.fn(), upload: vi.fn(), mutate: vi.fn() } },
    ...overrides,
  };
}
const draftOf = (text) => ({ text, doc: null, recipients: [], attachments: [], replyTarget: null, editorRevision: 1 });

describe('发送起点 token（useComposerCommands.performSend 承接旧 F6 送达/回执协议）', () => {
  it('Composer send-start emits once and durable acceptance only correlates the stable id', async () => {
    const composerSendStarted = vi.fn(() => ({ activationID: 'a1', inputEpoch: 0, intentRevision: 0, mode: 'following' }));
    const composerAccepted = vi.fn();
    const config = commandsHarness();
    const { result, unmount } = renderHook((props) => useComposerCommands(props), { initialProps: config });
    await act(async () => {
      await result.current.commands.send({ readingIntent: { composerSendStarted, composerAccepted }, draft: draftOf('请继续') });
    });
    expect(composerSendStarted).toHaveBeenCalledOnce();
    expect(composerSendStarted).toHaveBeenCalledWith('c0');
    expect(composerAccepted).toHaveBeenCalledOnce();
    expect(composerAccepted.mock.calls[0][0]).toBe('c0');
    expect(composerAccepted.mock.calls[0][1]).toHaveLength(1);
    unmount();
  });

  it('captures send authority before deferred durable acceptance and never refreshes it on resolve', async () => {
    const token = { activationID: 'send-start', inputEpoch: 4, intentRevision: 7, mode: 'browsing' };
    const composerSendStarted = vi.fn(() => token);
    const composerAccepted = vi.fn();
    const config = commandsHarness();
    const { result, unmount } = renderHook((props) => useComposerCommands(props), { initialProps: config });
    // 发送本身在这份 harness 里是同步 durable-accept（wireState:'closed' 时 sendOnce
    // 落盘即 resolve，不等传输），token 必须只在起点取一次，accepted 回调必须收到
    // 同一个 token 引用。
    const ids = await result.current.commands.send({ readingIntent: { composerSendStarted, composerAccepted }, draft: draftOf('请继续') });
    expect(composerSendStarted).toHaveBeenCalledOnce();
    expect(composerAccepted).toHaveBeenCalledWith('c0', ids, token);
    unmount();
  });

  it('does not emit an acceptance event when durable write fails after the one send-start', async () => {
    const composerSendStarted = vi.fn(() => ({ activationID: 'a1', inputEpoch: 0, intentRevision: 0, mode: 'following' }));
    const composerAccepted = vi.fn();
    const composerRejected = vi.fn(() => true);
    // access 变成 observer（不可写）会让 authorize() 在 captureOwner/authorize 时抛出，
    // 模拟"耐久写入失败"。
    const config = commandsHarness({
      accessRef: { current: { state: () => ({ authorityEpoch: 1, relationship: 'observer', existence: 'present', runtime: 'open', unavailable: false }) } },
    });
    const { result, unmount } = renderHook((props) => useComposerCommands(props), { initialProps: config });
    await expect(result.current.commands.send({
      readingIntent: { composerSendStarted, composerAccepted, composerRejected }, draft: draftOf('请继续'),
    })).rejects.toThrow();
    expect(composerSendStarted).toHaveBeenCalledOnce();
    expect(composerAccepted).not.toHaveBeenCalled();
    expect(composerRejected).toHaveBeenCalledOnce();
    unmount();
  });
});

describe('Composer 渲染隔离（F6-PERF-06，轻量版：不拉起 5000 行 Timeline）', () => {
  it('逐字输入不驱动同级兄弟组件重渲染', async () => {
    const user = userEvent.setup();
    let siblingRenders = 0;
    function Sibling() { siblingRenders += 1; return null; }
    const model = buildComposerModel({ activeChannelId: 'c0', draft: { text: '', recipients: [] }, roster: ROSTER, access: 'member_active' });
    const commands = { changeDraft: vi.fn() };
    render(<><Sibling /><Composer model={model} commands={commands} /></>);
    const before = siblingRenders;
    const editor = screen.getByRole('textbox', { name: '消息' });
    await user.type(editor, '这段输入不应驱动兄弟组件重渲染');
    expect(editor.textContent).toContain('这段输入不应驱动兄弟组件重渲染');
    // Typing is not a durable write. The draft catches up once the typist
    // pauses, so no character may reach the draft owner on its own.
    expect(commands.changeDraft).not.toHaveBeenCalled();
    expect(siblingRenders).toBe(before);
  });
});

describe('AD-361 composition draft persistence contract', () => {
  function manualAnimationFrames() {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    let nextFrameId = 1;
    const frames = [];
    globalThis.requestAnimationFrame = (callback) => {
      const id = nextFrameId++;
      frames.push({ id, callback, cancelled: false });
      return id;
    };
    globalThis.cancelAnimationFrame = (id) => {
      const frame = frames.find((row) => row.id === id);
      if (frame) frame.cancelled = true;
    };
    const runFrame = () => {
      const frame = frames.shift();
      if (frame && !frame.cancelled) frame.callback(performance.now());
    };
    const restore = () => {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    };
    return { frames, runFrame, restore };
  }

  it('lets confirmed IME text paint without any draft write on the typing path', async () => {
    const animation = manualAnimationFrames();
    const changeDraft = vi.fn();
    const send = vi.fn().mockResolvedValue(['message-1']);
    try {
      const user = userEvent.setup();
      const model = buildComposerModel({
        activeChannelId: 'c0',
        draft: { text: '', recipients: [] },
        roster: ROSTER,
        access: 'member_active',
      });
      render(<Composer model={model} commands={{ changeDraft, send }} />);
      animation.frames.length = 0;
      const input = screen.getByRole('textbox', { name: '消息' });
      fireEvent.compositionStart(input, { data: '中' });
      await user.type(input, '中');
      fireEvent.compositionEnd(input, { data: '中' });
      expect(input.textContent).toContain('中');
      expect(changeDraft).not.toHaveBeenCalled();

      // The body is never written down, so neither the composition frames nor
      // anything after them may reach the draft owner.
      act(animation.runFrame);
      expect(changeDraft).not.toHaveBeenCalled();
      act(animation.runFrame);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(changeDraft).not.toHaveBeenCalled();

      fireEvent.compositionStart(input, { data: '文' });
      await user.type(input, '文');
      fireEvent.compositionEnd(input, { data: '文' });
      act(animation.runFrame); // consume the first RAF, leaving the second queued
      expect(animation.frames).toHaveLength(1);
      await user.keyboard('{Enter}');
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ draft: expect.objectContaining({ text: '中文' }) }));
      act(animation.runFrame); // the canceled second RAF must be a no-op
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(changeDraft).not.toHaveBeenCalled();
    } finally {
      animation.restore();
    }
  });

  it('cancels stale composition work and clears the composing guard on channel editor handoff', async () => {
    const animation = manualAnimationFrames();
    const changeDraft = vi.fn();
    const commands = { changeDraft, send: vi.fn().mockResolvedValue(['message-1']) };
    const modelFor = (channelId) => buildComposerModel({
      activeChannelId: channelId,
      draft: { text: '', recipients: [] },
      roster: ROSTER,
      access: 'member_active',
    });
    try {
      const user = userEvent.setup();
      const { rerender } = render(<Composer model={modelFor('c0')} commands={commands} />);
      animation.frames.length = 0;
      const oldInput = screen.getByRole('textbox', { name: '消息' });
      fireEvent.compositionStart(oldInput, { data: '旧' });
      await user.type(oldInput, '旧');
      fireEvent.compositionEnd(oldInput, { data: '旧' });
      expect(animation.frames).toHaveLength(1);

      rerender(<Composer model={modelFor('c1')} commands={commands} />);
      act(animation.runFrame);
      expect(changeDraft).not.toHaveBeenCalled();

      // Handing the editor to another channel must neither replay the old
      // composition nor start writing the new one down.
      const newInput = screen.getByRole('textbox', { name: '消息' });
      await user.type(newInput, '新');
      expect(newInput.textContent).toContain('新');
      expect(newInput.textContent).not.toContain('旧');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(changeDraft).not.toHaveBeenCalled();
    } finally {
      animation.restore();
    }
  });
});

describe('AD-346 slash command selection contract', () => {
  it('selects a backend-declared /new command on the first Enter and sends only on the second', async () => {
    const user = userEvent.setup();
    const capabilityIndex = new Map([[CLAUDE.id, {
      describe: { types: new Map([['agent.new', { inputSchema: { type: 'object' } }]]) },
    }]]);
    const config = commandsHarness({ capabilityIndex });
    let latest;

    function Harness() {
      latest = useComposerCommands(config);
      return <Composer model={latest.model} commands={latest.commands} />;
    }

    render(<Harness />);
    const input = screen.getByRole('textbox', { name: '消息' });
    await user.type(input, '/n');
    expect(await screen.findByRole('option', { name: /\/new/ })).toBeTruthy();

    await user.keyboard('{Enter}');
    await vi.waitFor(() => expect(input.textContent).toBe('/new '));
    expect(latest.submission.pending).toEqual([]);

    await user.keyboard('{Enter}');
    await vi.waitFor(() => expect(latest.submission.pending).toEqual([
      expect.objectContaining({
        frame: expect.objectContaining({
          msg_type: 'agent.new', payload: {}, audience: [CLAUDE.id],
        }),
      }),
    ]));
  });
});

describe('AD-347 describe-gated slash candidate contract', () => {
  it('shows only request control words declared by the target Agent', async () => {
    const user = userEvent.setup();
    const capabilityIndex = new Map([[CLAUDE.id, {
      describe: { types: new Map([['agent.compact', { inputSchema: { type: 'object' } }]]) },
    }]]);
    const config = commandsHarness({ capabilityIndex });
    let latest;

    function Harness() {
      latest = useComposerCommands(config);
      return <Composer model={latest.model} commands={latest.commands} />;
    }

    render(<Harness />);
    await user.type(screen.getByRole('textbox', { name: '消息' }), '/');
    expect(await screen.findByRole('option', { name: /\/compact/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /\/new/ })).toBeNull();
    const offered = screen.getAllByRole('option').map((row) => row.textContent || '');
    expect(offered.filter((label) => label.includes('/compact'))).toHaveLength(1);
    expect(offered.some((label) => label.includes('/new'))).toBe(false);
  });
});

describe('TC-0650 mention-then-command audience contract', () => {
  it('keeps an explicitly mentioned Agent as the slash command audience', async () => {
    const user = userEvent.setup();
    const capabilityIndex = new Map([
      [CLAUDE.id, { describe: { types: new Map([['agent.compact', { inputSchema: { type: 'object' } }]]) } }],
      [CODEX.id, { describe: { types: new Map([['agent.compact', { inputSchema: { type: 'object' } }]]) } }],
    ]);
    const config = commandsHarness({ roster: [...ROSTER, CODEX], capabilityIndex });
    let latest;

    function Harness() {
      latest = useComposerCommands(config);
      return <Composer model={latest.model} commands={latest.commands} />;
    }

    render(<Harness />);
    const input = screen.getByRole('textbox', { name: '消息' });
    await user.type(input, '@co');
    await user.click(await screen.findByRole('option', { name: /codex/i }));
    expect(await screen.findByRole('button', { name: '移除收件人 @codex' })).toBeTruthy();

    await user.type(input, '/co');
    expect(await screen.findByRole('option', { name: /\/compact/ })).toBeTruthy();
    await user.keyboard('{Enter}');
    await vi.waitFor(() => expect(input.textContent).toBe('/compact '));
    expect(latest.submission.pending).toEqual([]);

    await user.keyboard('{Enter}');
    await vi.waitFor(() => expect(latest.submission.pending).toEqual([
      expect.objectContaining({
        frame: expect.objectContaining({
          msg_type: 'agent.compact', payload: {}, audience: [CODEX.id],
        }),
      }),
    ]));
  });
});

describe('上传未完成时不能提交纯文本快照（呼应旧 F6 附件同批断言）', () => {
  it('does not send a text-only snapshot while a selected attachment is still uploading', async () => {
    const user = userEvent.setup();
    let finishUpload;
    const uploadPromise = new Promise((resolve) => { finishUpload = resolve; });
    const model = buildComposerModel({ activeChannelId: 'c0', draft: { text: '', recipients: [] }, roster: ROSTER, access: 'member_active' });
    const commands = { changeDraft: vi.fn(), upload: vi.fn(() => uploadPromise), send: vi.fn().mockResolvedValue(['message-1']) };
    render(<Composer model={model} commands={commands} />);
    await user.type(screen.getByRole('textbox', { name: '消息' }), '正文和附件必须同批');
    const uploading = user.upload(
      screen.getByLabelText('上传本机文件到频道'),
      new File(['evidence'], 'evidence.txt', { type: 'text/plain' }),
    );
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '发送' }).disabled).toBe(true));
    expect(commands.send).not.toHaveBeenCalled();
    finishUpload();
    await uploading;
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '发送' }).disabled).toBe(false));
  });
});

describe('编辑已有消息时禁止上传附件（呼应旧 F6 附件隔离断言）', () => {
  it('disables every normal-draft attachment entry while editing an existing message', () => {
    const model = buildComposerModel({
      activeChannelId: 'c0', draft: { text: '', recipients: [] }, roster: ROSTER, access: 'member_active',
      edit: { session: { sessionId: 'edit-1', targetId: 'target-1', phase: 'editing', text: '旧消息' } },
    });
    const commands = { changeDraft: vi.fn(), upload: vi.fn() };
    render(<Composer model={model} commands={commands} />);
    expect(screen.getByLabelText('上传本机文件到频道').disabled).toBe(true);
    expect(commands.upload).not.toHaveBeenCalled();
  });
});

describe('频道文件选择的公开 Composer 反馈', () => {
  it('passes the mounted Tiptap doc/text snapshot to the picker command', async () => {
    const user = userEvent.setup();
    const pickChannelFile = vi.fn().mockResolvedValue(null);
    const model = buildComposerModel({
      activeChannelId: 'c0',
      draft: { text: '第一行\n第二行', doc: null, recipients: [], attachments: [] },
      roster: ROSTER,
      access: 'member_active',
    });
    render(<Composer model={model} commands={{ changeDraft: vi.fn(), pickChannelFile }} />);
    await user.click(screen.getByRole('button', { name: '从频道文件选择' }));
    await vi.waitFor(() => expect(pickChannelFile).toHaveBeenCalledWith(expect.objectContaining({
      draft: expect.objectContaining({
        text: '第一行\n第二行',
        doc: expect.objectContaining({
          type: 'doc',
          content: [
            expect.objectContaining({ type: 'paragraph', content: [expect.objectContaining({ text: '第一行' })] }),
            expect.objectContaining({ type: 'paragraph', content: [expect.objectContaining({ text: '第二行' })] }),
          ],
        }),
      }),
    })));
  });

  it('disables the picker with the typed access reason when transmission is unavailable', () => {
    const model = buildComposerModel({
      activeChannelId: 'c0', draft: { text: '', recipients: [] }, roster: ROSTER,
      access: {
        relationship: 'member', existence: 'present', runtime: 'open', unavailable: true,
        canEditDraft: true, canDurablyAccept: true, canTransmit: false,
        reason: '连接可用后才能附加频道文件', transportOpen: false,
      },
    });
    render(<Composer model={model} commands={{ changeDraft: vi.fn(), pickChannelFile: vi.fn() }} />);
    const picker = screen.getByRole('button', { name: '从频道文件选择' });
    expect(picker.disabled).toBe(true);
    expect(picker.getAttribute('title')).toBe('连接可用后才能附加频道文件');
  });

  it('renders a picker rejection in the Composer alert rail', async () => {
    const user = userEvent.setup();
    const pickChannelFile = vi.fn().mockRejectedValue(new TypeError('频道文件选择已拒绝'));
    const model = buildComposerModel({
      activeChannelId: 'c0', draft: { text: '', recipients: [] }, roster: ROSTER, access: 'member_active',
    });
    render(<Composer model={model} commands={{ changeDraft: vi.fn(), pickChannelFile }} />);
    await user.click(screen.getByRole('button', { name: '从频道文件选择' }));
    expect((await screen.findByRole('alert')).textContent).toContain('频道文件选择已拒绝');
  });
});

describe('TC-0651 / AD-357 完整 Composer 动作合同', () => {
  it('从公共 Composer 完成本机附件、频道文件入口、多行输入与 accepted send', async () => {
    const user = userEvent.setup();
    const changeDraft = vi.fn();
    const upload = vi.fn().mockResolvedValue([]);
    const pickChannelFile = vi.fn().mockResolvedValue(null);
    const send = vi.fn().mockResolvedValue(['message-accepted']);
    const model = buildComposerModel({
      activeChannelId: 'c0',
      draft: { text: '', recipients: [] },
      roster: ROSTER,
      access: 'member_active',
    });

    render(<Composer model={model} commands={{ changeDraft, upload, pickChannelFile, send }} />);
    const input = screen.getByRole('textbox', { name: '消息' });
    expect(input).toBeTruthy();

    await user.upload(
      screen.getByLabelText('上传本机文件到频道'),
      new File(['local evidence'], '本机证据.txt', { type: 'text/plain' }),
    );
    expect(upload).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledWith([expect.objectContaining({ name: '本机证据.txt' })]);

    await user.click(screen.getByRole('button', { name: '从频道文件选择' }));
    await vi.waitFor(() => expect(pickChannelFile).toHaveBeenCalledWith(expect.objectContaining({
      draft: expect.objectContaining({ text: '', doc: expect.objectContaining({ type: 'doc' }) }),
    })));

    await user.type(input, '第一行{Shift>}{Enter}{/Shift}第二行');
    expect(send).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      draft: expect.objectContaining({
        text: '第一行\n第二行',
        doc: expect.objectContaining({ type: 'doc' }),
      }),
    }));
    await vi.waitFor(() => expect(input.textContent).toBe(''));
  });
});
