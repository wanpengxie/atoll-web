import { describe, expect, it } from 'vitest';
import {
  buildComposerModel,
  createControlRequest,
  createMessageRequest,
  parseComposerCommand,
  resolveComposerAgentSelection,
  resolveComposerDelivery,
} from '../ui/composer/composer-model.js';

const HUMAN = { id: 'human:root:1', kind: 'human', name: 'root' };
const CLAUDE = { id: 'agent:claude:1', kind: 'agent', name: 'claude' };
const CODEX = { id: 'agent:codex:1', kind: 'agent', name: 'codex' };
const ROSTER = [HUMAN, CLAUDE, CODEX];

function selected(actor) {
  return { target: { kind: 'single', agent: actor } };
}

describe('Composer Agent selection owner', () => {
  it('enforces manual > latest self ask > sole Agent > none', () => {
    expect(resolveComposerAgentSelection({
      roster: ROSTER,
      manualAgentId: CODEX.id,
      recentAgentId: CLAUDE.id,
    })).toMatchObject({ actorId: CODEX.id, agent: CODEX, source: 'manual' });

    expect(resolveComposerAgentSelection({
      roster: ROSTER,
      recentAgentId: CLAUDE.id,
    })).toMatchObject({ actorId: CLAUDE.id, agent: CLAUDE, source: 'recent' });

    expect(resolveComposerAgentSelection({
      roster: [HUMAN, CLAUDE],
      recentAgentId: 'agent:gone:1',
    })).toMatchObject({ actorId: CLAUDE.id, agent: CLAUDE, source: 'only' });

    expect(resolveComposerAgentSelection({
      roster: ROSTER,
      manualAgentId: 'agent:gone:1',
      recentAgentId: 'agent:also-gone:1',
    })).toEqual({ actorId: '', agent: null, source: '' });
  });

  it('invalidates a stale selected id before applying the sole-Agent fallback', () => {
    const model = buildComposerModel({
      activeChannelId: 'dev',
      draft: { recipients: [] },
      roster: [HUMAN, CLAUDE],
      access: 'member_active',
      agentSelection: { selectedAgentId: CODEX.id },
    });
    expect(model.targetAgent).toMatchObject({ id: CLAUDE.id });
    expect(model.delivery).toMatchObject({ sourceKey: 'only', sourceLabel: '默认 · 频道唯一 Agent' });
  });
});

describe('Composer 当前收件人合同', () => {
  it('把收件人名单和判据来源分开，避免横幅 title 重复名字', () => {
    expect(resolveComposerDelivery({
      draft: { recipients: [CLAUDE] }, roster: ROSTER,
    })).toMatchObject({ source: 'mention', sourceLabel: '由 @ 指定', label: '@claude' });

    expect(resolveComposerDelivery({
      draft: { recipients: [] },
      roster: [HUMAN, CLAUDE],
      agentSelection: { selectedAgentId: CLAUDE.id, fallbackSource: 'filter' },
    })).toMatchObject({ source: 'agent-selection', sourceKey: 'filter', sourceLabel: '默认 · 跟随筛选', label: '@claude' });

    expect(buildComposerModel({
      activeChannelId: 'dev',
      draft: { recipients: [] },
      roster: [HUMAN, CLAUDE],
      access: 'member_active',
    }).delivery).toMatchObject({ source: 'agent-selection', sourceKey: 'only', sourceLabel: '默认 · 频道唯一 Agent' });
  });

  it('参数选择提供默认 Agent，但正文里的 @ 仍然优先', () => {
    expect(resolveComposerDelivery({
      draft: { recipients: [] }, roster: ROSTER, agentSelection: selected(CODEX),
    })).toMatchObject({ kind: 'direct', source: 'agent-selection', rows: [CODEX] });

    expect(resolveComposerDelivery({
      draft: { recipients: [CLAUDE] }, roster: ROSTER, agentSelection: selected(CODEX),
    })).toMatchObject({ kind: 'direct', source: 'mention', rows: [CLAUDE] });
  });

  it('回复优先于 @ 与默认 Agent，且离场回复对象不会静默改投', () => {
    expect(resolveComposerDelivery({
      draft: {
        recipients: [CLAUDE],
        replyTarget: { senderId: HUMAN.id, senderName: HUMAN.name },
      },
      roster: ROSTER,
      agentSelection: selected(CODEX),
    })).toMatchObject({ kind: 'direct', source: 'reply', rows: [HUMAN] });

    expect(resolveComposerDelivery({
      draft: { replyTarget: { senderId: 'agent:gone:1', senderName: 'gone' } },
      roster: ROSTER,
      agentSelection: selected(CODEX),
    })).toMatchObject({ kind: 'lost', source: 'reply', rows: [] });
  });

  it('回复发送保留来源消息 parent identity，并按 sender kind 选择词', () => {
    const agentReply = buildComposerModel({
      activeChannelId: 'dev',
      draft: {
        text: '继续这个方向',
        recipients: [CODEX],
        replyTarget: {
          sourceId: 'answer-1',
          senderId: CLAUDE.id,
          senderKind: CLAUDE.kind,
          senderName: CLAUDE.name,
        },
      },
      roster: ROSTER,
      access: 'member_active',
      agentSelection: selected(CODEX),
    });
    expect(createMessageRequest(agentReply, { revision: 9 })).toMatchObject({
      batch: [{
        msgType: 'agent.ask',
        audience: [CLAUDE.id],
        parentId: 'answer-1',
      }],
    });

    const humanReply = buildComposerModel({
      activeChannelId: 'dev',
      draft: {
        text: '我来跟进',
        recipients: [CODEX],
        replyTarget: {
          sourceId: 'message-1',
          senderId: HUMAN.id,
          senderKind: HUMAN.kind,
          senderName: HUMAN.name,
        },
      },
      roster: ROSTER,
      access: 'member_active',
      agentSelection: selected(CODEX),
    });
    expect(createMessageRequest(humanReply, { revision: 10 })).toMatchObject({
      batch: [{
        msgType: 'human.message',
        audience: [HUMAN.id],
        parentId: 'message-1',
      }],
    });
  });

  it('多目标消息按当前 delivery 生成逐目标 typed batch', () => {
    const model = buildComposerModel({
      activeChannelId: 'dev',
      draft: { text: 'hello', recipients: [CLAUDE, HUMAN] },
      roster: ROSTER,
      access: 'member_active',
    });

    expect(model.canSubmit).toBe(true);
    expect(createMessageRequest(model, { revision: 7 })).toEqual({
      channelId: 'dev',
      draftRevision: 7,
      editorRevision: 0,
      batch: [
        {
          channelId: 'dev', text: 'hello', msgType: 'agent.ask',
          audience: [CLAUDE.id], targetLabel: 'claude',
        },
        {
          channelId: 'dev', text: 'hello', msgType: 'human.message',
          audience: [HUMAN.id], targetLabel: 'root',
        },
      ],
    });
  });
});

describe('Composer slash 入口', () => {
  it('未知 slash 永不降级为正文，双 slash 是显式正文转义', () => {
    expect(() => parseComposerCommand('/unknown')).toThrowError(expect.objectContaining({
      code: 'composer_command_unknown',
    }));
    expect(parseComposerCommand('//literal')).toEqual({ kind: 'escaped', text: '/literal' });
  });

  it('菜单只展示当前目标能力与权限允许的命令', () => {
    const capabilityIndex = new Map([[CODEX.id, {
      actorId: CODEX.id,
      describe: { types: new Set(['agent.compact']) },
    }]]);
    const model = buildComposerModel({
      activeChannelId: 'dev',
      draft: { text: '/', recipients: [] },
      roster: ROSTER,
      access: 'member_active',
      agentSelection: selected(CODEX),
      capabilityIndex,
    });

    expect(model.commandMenu.rows.map((row) => row.command)).toEqual(['compact', 'restart']);
    expect(model.controls.commands.new).toMatchObject({ state: 'unsupported', enabled: false });
  });

  it('TC-0658：steer 控制只发布标准文本/CAS 字段到当前 Agent', () => {
    const model = buildComposerModel({
      activeChannelId: 'dev',
      draft: { text: '改方向', recipients: [] },
      roster: ROSTER,
      access: 'member_active',
      agentSelection: selected(CODEX),
      capabilityIndex: new Map([[CODEX.id, {
        actorId: CODEX.id,
        describe: { types: new Set(['agent.steer']) },
      }]]),
    });

    expect(model.controls.steer).toMatchObject({ state: 'supported', enabled: true });
    expect(createControlRequest(model, 'agent.steer', { text: '换个方向' }, CODEX.id)).toEqual({
      channelId: 'dev',
      text: '',
      msgType: 'agent.steer',
      audience: [CODEX.id],
      targetLabel: CODEX.name,
      payload: { text: '换个方向' },
    });
    expect(createControlRequest(model, 'agent.steer', { text: '换个方向', expected_turn_id: 'turn-1' }, CODEX.id)).toEqual({
      channelId: 'dev',
      text: '',
      msgType: 'agent.steer',
      audience: [CODEX.id],
      targetLabel: CODEX.name,
      payload: { text: '换个方向', expected_turn_id: 'turn-1' },
    });
  });

  it('TC-0651：纯附件草稿也生成可发送正文与稳定附件 payload', () => {
    const attachment = {
      resource_id: 'file:report-1',
      name: '研究报告.pdf',
      media_type: 'application/pdf',
      size: 4096,
    };
    const model = buildComposerModel({
      activeChannelId: 'dev',
      draft: { text: '', recipients: [CODEX], attachments: [attachment] },
      roster: ROSTER,
      access: 'member_active',
    });

    expect(model.canSubmit).toBe(true);
    expect(createMessageRequest(model, { revision: 11 })).toEqual({
      channelId: 'dev',
      draftRevision: 11,
      editorRevision: 0,
      batch: [{
        channelId: 'dev',
        text: '发送 1 个附件',
        msgType: 'agent.ask',
        audience: [CODEX.id],
        targetLabel: CODEX.name,
        payload: { text: '发送 1 个附件', attachments: [attachment] },
      }],
    });
  });
});
