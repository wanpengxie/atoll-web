import { describe, expect, it } from 'vitest';
import {
  buildComposerModel,
  createMessageRequest,
  parseComposerCommand,
  resolveComposerDelivery,
} from '../ui/composer/composer-model.js';

const HUMAN = { id: 'human:root:1', kind: 'human', name: 'root' };
const CLAUDE = { id: 'agent:claude:1', kind: 'agent', name: 'claude' };
const CODEX = { id: 'agent:codex:1', kind: 'agent', name: 'codex' };
const ROSTER = [HUMAN, CLAUDE, CODEX];

function selected(actor) {
  return { target: { kind: 'single', agent: actor } };
}

describe('Composer 当前收件人合同', () => {
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
});
