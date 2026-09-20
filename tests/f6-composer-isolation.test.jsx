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
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useComposerCommands } from '../src/ui/composer/useComposerCommands.js';
import { buildComposerModel } from '../src/ui/composer/composer-model.js';
import { Composer } from '../src/ui/composer/Composer.jsx';
import { ReadingIntentProvider, useReadingIntent } from '../src/ui/conversation/ReadingIntentContext.jsx';

afterEach(() => { cleanup(); });

const CLAUDE = { id: 'agent:claude:1', kind: 'agent', name: 'claude' };
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
    await user.type(screen.getByRole('textbox', { name: '消息' }), '这段输入不应驱动兄弟组件重渲染');
    expect(commands.changeDraft).toHaveBeenCalled();
    expect(siblingRenders).toBe(before);
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
