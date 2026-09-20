// @vitest-environment jsdom
// 旧 src/ui/ChannelCreateModal.jsx（独立、有焦点陷阱的 role="dialog"）已删除。
// "新建频道"能力现在是 src/app/WorkspaceApp.jsx 里 `navigation.openChannelAdministration`
// 打开的 src/ui/features/governance/GovernanceFeature.jsx 的
// ChannelAdministrationPanel 侧栏（"概览" tab 里的"创建子频道"卡片），不再是
// 独立 Modal（role="dialog"），也没有焦点陷阱/Escape/遮罩关闭这套语义（SidePanel
// 是否有这些需要单独确认，见下）。详见 RM 账本，"四步收敛"进度、模板两段式
// 读取（先 GET 模板 body 再 CREATE）、agent 座位勾选带入、失败重试保留输入的
// 专属 UI，全部没有对应物——不是换了皮肤，是这条创建体验被大幅简化，只剩
// "填名称/用途/模板 ID 字符串→一次性提交"。
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelAdministrationPanel } from '../src/ui/features/governance/GovernanceFeature.jsx';

afterEach(cleanup);

describe('创建子频道（原 ChannelCreateModal，现内嵌于治理侧栏）', () => {
  it('提交创建子频道命令（组件契约层面；不再是独立 Modal，无四步收敛进度）', () => {
    const submit = vi.fn().mockResolvedValue('request-1');
    render(<ChannelAdministrationPanel
      channel={{ id: 'c0', qualified_name: 'c0' }}
      port={{ commands: { submit, refresh: vi.fn() }, children: [] }}
      initialTab="overview"
      onClose={vi.fn()}
    />);
    // 不再是 role="dialog"：整个面板是 SidePanel，不是独立对话框。
    expect(screen.queryByRole('dialog', { name: '新建频道' })).toBeNull();
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'research' } });
    fireEvent.change(screen.getByLabelText('用途'), { target: { value: '分析资料' } });
    fireEvent.click(screen.getByRole('button', { name: '创建子频道' }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'channel', action: 'create_child',
      payload: { name: 'research', purpose: '分析资料', templateId: '', parentId: 'c0' },
    }));
    // 旧版这里会展示"频道创建进度"四步收敛 region；新版没有。
    expect(screen.queryByRole('region', { name: '频道创建进度' })).toBeNull();
  });
});
