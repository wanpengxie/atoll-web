// @vitest-environment jsdom
// 恢复自 master:tests/app-shell-composer-port.test.jsx（RC，2026-09-19）。
// 旧测试整体 mock 已删除的 src/app/AppShell.jsx + src/ui/Composer.jsx + src/ui/Timeline.jsx，
// 用 React.Suspense + startTransition 制造"候选 B 频道渲染挂起时，已提交的 A 频道
// Composer 回调不能被顶掉"的场景。
//
// 权威声明：src 全仓 grep Suspense/startTransition 在 Composer 渲染链路（WorkspaceApp.jsx /
// ConversationSurface.jsx / WorkspaceLayout.jsx / SurfaceShell.jsx）零命中；频道切换不再走
// React 并发候选树，而是 ConversationSurface.jsx:308 的 `key={state.channelId}` 同步 remount
// （与 RW 在 RESTORE-MATRIX 对 Timeline candidate-vs-committed 架构的判定一致）。<Composer>
// 本身也不再按频道挂载/卸载——它是 WorkspaceApp.jsx 里的单一常驻实例，props 随频道切换正常
// 重渲染，不再有"旧频道的候选树还没卸载、新频道候选树已经提交"的竞态窗口。
// 旧测试保护的"渲染竞态下不把 A 的编辑动作路由给 B"这条不变量，现由
// src/ui/composer/command-port.js 的 createComposerCommandPort() 承接：一个 port 只属于
// 一个 useMemo(() => createComposerCommandPort(), [activeChannelId]) 周期（即按频道换代），
// commands 对象引用稳定，内部路由到最近一次 useLayoutEffect 提交的 owner；port.retire()
// 只在真正卸载时调用，迟到的调用直接拿到 composer_owner_retired 拒绝，不会被误路由。
// 判定逐条记在 audit-output/RESTORE-MATRIX.md。
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createComposerCommandPort } from '../src/ui/composer/command-port.js';
import { useComposerCommands } from '../src/ui/composer/useComposerCommands.js';

describe('Composer 命令口的稳定引用与 owner 提交（command-port.js 直接验证）', () => {
  it('keeps callback identity stable within one owner while committing the latest feed-render targets', () => {
    const port = createComposerCommandPort();
    const ownerA = { changeDraft: vi.fn() };
    const ownerB = { changeDraft: vi.fn() };
    const before = port.commands.changeDraft;

    port.commit(ownerA);
    expect(port.commands.changeDraft).toBe(before);
    port.commands.changeDraft({ text: 'first' });
    expect(ownerA.changeDraft).toHaveBeenCalledWith({ text: 'first' });

    // 最新一次渲染提交了新的 owner（同一个 activeChannelId 下，账本/state 推进后的最新
    // commands 实现），commands 对象与函数引用必须保持不变——否则依赖引用相等的
    // memoized 子树会被无谓打散。
    port.commit(ownerB);
    expect(port.commands.changeDraft).toBe(before);
    port.commands.changeDraft({ text: 'latest' });
    expect(ownerA.changeDraft).toHaveBeenCalledTimes(1);
    expect(ownerB.changeDraft).toHaveBeenCalledWith({ text: 'latest' });
  });

  it('retires late calls after the port is torn down instead of silently routing them to whatever owner remains', async () => {
    const port = createComposerCommandPort();
    const owner = { changeDraft: vi.fn() };
    port.commit(owner);
    port.retire();
    await expect(port.commands.changeDraft({ text: 'late' })).rejects.toMatchObject({ code: 'composer_owner_retired' });
    expect(owner.changeDraft).not.toHaveBeenCalled();
  });
});

function memberHarness(overrides = {}) {
  const databaseName = `port-composer-${crypto.randomUUID()}`;
  const CLAUDE = { id: 'agent:claude:1', kind: 'agent', name: 'claude' };
  return {
    principalId: 'root', activeChannelId: 'c0', wireState: 'open',
    wireRef: { current: { send: vi.fn() } },
    rosterRef: { current: { recordSubmission: vi.fn(), observeFeed: vi.fn() } },
    accessRef: { current: { state: () => ({ authorityEpoch: 1, relationship: 'member', existence: 'present', runtime: 'open', unavailable: false }) } },
    producerOwnerToken: 'owner:root', generationFor: () => 1, serverWorld: 'world-a',
    outboxFactory: () => ({
      restore: vi.fn().mockResolvedValue([]), restoreDrafts: vi.fn().mockResolvedValue([]), close: vi.fn(),
      persistDraft: vi.fn().mockResolvedValue(undefined), removeDraft: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined),
    }),
    onError: vi.fn(), onNotice: vi.fn(), onFeedChanged: vi.fn(), onAccessChanged: vi.fn(),
    roster: [CLAUDE], selfId: 'root', access: 'member_active',
    agentSelection: { selectedAgentId: 'agent:claude:1' }, capabilityIndex: new Map(),
    attachments: [], edit: null, channelState: { timeline: [] },
    onRequestCapability: vi.fn(), probes: { targetChanged: vi.fn(), requestKeys: () => ({}) },
    attachmentRef: { current: { attach: vi.fn(), upload: vi.fn(), mutate: vi.fn() } },
    ...overrides,
  };
}

describe('编辑已有消息时禁止附件操作（useComposerCommands 直接 renderHook）', () => {
  it('rejects channel-file attachment and normal-draft upload while an existing message edit owns the composer', async () => {
    const attachmentPort = { attach: vi.fn(), upload: vi.fn(), mutate: vi.fn() };
    const editSession = { channelId: 'c0', session: { sessionId: 'edit-1', targetId: 'msg-1', channelId: 'c0', text: 'x', phase: 'editing' } };
    // renderHook 的回调必须是稳定引用：config 里的 Map/数组每次渲染都换新对象会让
    // buildComposerModel 的 useMemo 每次都判定依赖变了，进而让"请求能力"的 effect
    // 每次重渲都触发一次 setState，形成无限渲染循环（曾把 worker 撑爆 OOM）。
    const config = memberHarness({ edit: editSession, attachmentRef: { current: attachmentPort } });
    const { result } = renderHook(() => useComposerCommands(config));
    await expect(result.current.commands.attach({ resource_id: 'file-1' })).rejects.toThrow('编辑已有消息时不能附加频道文件');
    await expect(result.current.commands.upload([new File(['x'], 'x.txt')])).rejects.toThrow('编辑已有消息时不能上传普通草稿附件');
    expect(attachmentPort.attach).not.toHaveBeenCalled();
    expect(attachmentPort.upload).not.toHaveBeenCalled();
  });
});

describe('频道文件选择走 typed attachment owner', () => {
  it('materializes the live Tiptap draft before attaching a selected resource', async () => {
    const resource = {
      resource_id: 'file-multiline', address: 'file-multiline', name: 'notes.md',
      media_type: 'text/markdown', size: 42,
    };
    const snapshot = {
      text: '第一行\n第二行',
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '第一行' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '第二行' }] },
        ],
      },
      recipients: [], attachments: [], replyTarget: null, editorRevision: 4,
    };
    const writeDraft = vi.fn(async (principalId, channelId, draft, expectedRevision) => ({
      conflict: false,
      record: {
        principalId, channelId, revision: Number(expectedRevision || 0) + 1,
        editorRevision: draft.editorRevision, draft,
      },
    }));
    const attachmentPort = {
      pickChannelFile: vi.fn().mockResolvedValue(resource),
      attach: vi.fn().mockResolvedValue(resource),
      upload: vi.fn(), mutate: vi.fn(),
    };
    const config = memberHarness({
      attachmentRef: { current: attachmentPort },
      outboxFactory: () => ({
        restore: vi.fn().mockResolvedValue([]),
        restoreDrafts: vi.fn().mockResolvedValue([]),
        writeDraft,
        close: vi.fn(),
      }),
    });
    const { result } = renderHook(() => useComposerCommands(config));

    await expect(result.current.commands.pickChannelFile({ draft: snapshot })).resolves.toEqual(resource);
    expect(writeDraft).toHaveBeenCalledWith(
      'root', 'c0', expect.objectContaining({ text: snapshot.text, doc: snapshot.doc }), expect.any(Number),
    );
    expect(attachmentPort.attach).toHaveBeenCalledWith(resource, 'c0');
    expect(writeDraft.mock.invocationCallOrder[0]).toBeLessThan(attachmentPort.attach.mock.invocationCallOrder[0]);
  });

  it('attaches the selected resource exactly once and leaves cancel as a no-op', async () => {
    const resource = {
      resource_id: 'file-1', address: 'file-1', name: 'notes.md',
      media_type: 'text/markdown', size: 42,
    };
    const attachmentPort = {
      pickChannelFile: vi.fn()
        .mockResolvedValueOnce(resource)
        .mockResolvedValueOnce(null),
      attach: vi.fn().mockResolvedValue(resource),
      preview: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn(), mutate: vi.fn(),
    };
    const config = memberHarness({ attachmentRef: { current: attachmentPort } });
    const { result } = renderHook(() => useComposerCommands(config));

    await expect(result.current.commands.pickChannelFile()).resolves.toEqual(resource);
    expect(attachmentPort.pickChannelFile).toHaveBeenCalledWith('c0');
    expect(attachmentPort.attach).toHaveBeenCalledTimes(1);
    expect(attachmentPort.attach).toHaveBeenCalledWith(resource, 'c0');
    await expect(result.current.commands.previewAttachment(resource)).resolves.toBeUndefined();
    expect(attachmentPort.preview).toHaveBeenCalledWith(resource, 'c0');

    await expect(result.current.commands.pickChannelFile()).resolves.toBeNull();
    expect(attachmentPort.attach).toHaveBeenCalledTimes(1);
  });

  it('preserves typed picker rejection and does not attach a rejected resource', async () => {
    const rejection = Object.assign(new TypeError('频道暂不可用'), { code: 'channel_unavailable' });
    const attachmentPort = {
      pickChannelFile: vi.fn().mockRejectedValue(rejection),
      attach: vi.fn(), upload: vi.fn(), mutate: vi.fn(),
    };
    const config = memberHarness({ attachmentRef: { current: attachmentPort } });
    const { result } = renderHook(() => useComposerCommands(config));

    await expect(result.current.commands.pickChannelFile()).rejects.toMatchObject({
      code: 'channel_unavailable', message: '频道暂不可用',
    });
    expect(attachmentPort.attach).not.toHaveBeenCalled();
  });
});
