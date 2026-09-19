import { SYSTEM_ACTOR_ID, TYPES } from '../../protocol/vocab.js';

const SENDABLE_KINDS = new Set(['agent', 'human']);
const RETRYABLE_STATES = new Set(['rejected', 'uncertain']);
const DELIVERY_SOURCE_LABELS = Object.freeze({
  reply: '回复',
  mention: '由 @ 指定',
  filter: '默认 · 跟随筛选',
  manual: '默认 · 手选',
  recent: '默认 · 最近交互',
  only: '默认 · 频道唯一 Agent',
});
export const COMPOSER_SLASH_COMMANDS = Object.freeze([
  Object.freeze({ command: 'compact', type: TYPES.agentCompact, scope: 'agent', label: '压缩上下文', description: '保留当前对话，压缩较早的上下文', usage: '/compact', minArgs: 0, maxArgs: 0 }),
  Object.freeze({ command: 'new', type: TYPES.agentNew, scope: 'agent', label: '新建对话', description: '保留当前 Agent，换成一段全新会话', usage: '/new', minArgs: 0, maxArgs: 0 }),
  // Restart belongs to the channel system actor: a wedged Agent must not be
  // asked to restart itself. The selected Agent is carried in payload.member.
  Object.freeze({ command: 'restart', type: TYPES.member.restart, scope: 'system-target', label: '重启 Agent', description: '给卡住的 Agent 换一届任期；账本与文件不动', usage: '/restart', minArgs: 0, maxArgs: 0 }),
  Object.freeze({ command: 'model', type: TYPES.agentSelect, scope: 'agent', menu: false, label: '切换模型', description: '设置目标 Agent 的模型与推理强度', usage: '/model [model] [effort]', minArgs: 0, maxArgs: 2 }),
  Object.freeze({ command: 'fork', type: TYPES.agentFork, scope: 'agent', menu: false, label: '分叉对话', description: '从当前上下文分叉', usage: '/fork', minArgs: 0, maxArgs: 0 }),
  Object.freeze({ command: 'context', type: TYPES.agentContext, scope: 'agent', menu: false, label: '查看上下文', description: '请求目标 Agent 的上下文状态', usage: '/context', minArgs: 0, maxArgs: 0 }),
  Object.freeze({ command: 'status', type: TYPES.describe, scope: 'agent', menu: false, label: '查看状态', description: '读取目标 Agent 的当前状态', usage: '/status', minArgs: 0, maxArgs: 0 }),
  Object.freeze({ command: 'introduce', type: TYPES.member.create, scope: 'system', menu: false, label: '创建成员', description: '按声明在当前频道创建成员', usage: '/introduce <decl_id>', minArgs: 1, maxArgs: 1 }),
  Object.freeze({ command: 'admit', type: TYPES.member.admit, scope: 'system', menu: false, label: '准入用户', description: '将 principal 准入当前频道', usage: '/admit <principal>', minArgs: 1, maxArgs: 1 }),
  Object.freeze({ command: 'members', type: TYPES.member.list, scope: 'system', menu: false, label: '成员列表', description: '查看当前频道成员', usage: '/members', minArgs: 0, maxArgs: 0 }),
  Object.freeze({ command: 'channels', type: TYPES.channel.list, scope: 'system', menu: false, label: '频道列表', description: '查看子频道', usage: '/channels [parent_id]', minArgs: 0, maxArgs: 1 }),
]);
const SLASH_COMMAND_BY_NAME = new Map(COMPOSER_SLASH_COMMANDS.map((row) => [row.command, row]));

function text(value) {
  return typeof value === 'string' ? value : '';
}

function actorName(actor) {
  return text(actor?.name) || text(actor?.label) || text(actor?.id) || '未知成员';
}

function commandError(message, code) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

// A leading slash is never silently downgraded to an ordinary message.
// `//literal` is the explicit escape and is sent as `/literal`.
export function parseComposerCommand(value) {
  const source = text(value).trim();
  if (!source.startsWith('/')) return null;
  if (source.startsWith('//')) return Object.freeze({ kind: 'escaped', text: source.slice(1) });
  const [verb, ...args] = source.split(/\s+/u);
  const command = verb.slice(1);
  const definition = SLASH_COMMAND_BY_NAME.get(command);
  if (!definition) {
    throw commandError(`未知命令 ${verb || '/'}；普通正文以 / 开头时请写成 /${source}`, 'composer_command_unknown');
  }
  if (args.length < definition.minArgs || args.length > definition.maxArgs) {
    throw commandError(`用法：${definition.usage}`, 'composer_command_usage');
  }
  let payload = {};
  if (command === 'model') payload = { ...(args[0] ? { model: args[0] } : {}), ...(args[1] ? { effort: args[1] } : {}) };
  else if (command === 'introduce') payload = { decl_id: args[0] };
  else if (command === 'admit') payload = { principal: args[0] };
  else if (command === 'channels' && args[0]) payload = { parent_id: args[0] };
  return Object.freeze({ kind: 'command', ...definition, payload: Object.freeze(payload) });
}

function uniqueRows(rows, keyOf) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = keyOf(row);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeComposerDraft(value) {
  const draft = value && typeof value === 'object' ? value : {};
  return Object.freeze({
    ...draft,
    text: text(draft.text),
    doc: draft.doc || null,
    recipients: Object.freeze(Array.isArray(draft.recipients) ? [...draft.recipients] : []),
    attachments: Object.freeze(Array.isArray(draft.attachments) ? [...draft.attachments] : []),
    replyTarget: draft.replyTarget || null,
    editorRevision: Math.max(0, Number(draft.editorRevision) || 0),
  });
}

function recipientIdentity(recipient) {
  return typeof recipient === 'string' ? recipient : text(recipient?.id);
}

function deliverySourceLabel(source) {
  return DELIVERY_SOURCE_LABELS[text(source)] || '';
}

// The current Workspace owner only supplies selectedAgentId. Preserve an
// explicitly supplied fallback source when a future owner has one, but do not
// infer filter/manual provenance from the same id: both routes intentionally
// converge on the same Composer command.
function selectedAgentSource(agentSelection, soleFallback) {
  const source = text(agentSelection?.fallbackSource)
    || text(agentSelection?.source)
    || text(agentSelection?.target?.source)
    || text(agentSelection?.view?.source);
  return deliverySourceLabel(source) ? source : soleFallback ? 'only' : '';
}

export function resolveMentionRows(recipients, roster) {
  const rosterByID = new Map((roster || []).map((actor) => [actor.id, actor]));
  return Object.freeze(uniqueRows((recipients || []).flatMap((recipient) => {
    const id = recipientIdentity(recipient);
    if (!id) return [];
    const actor = rosterByID.get(id);
    if (actor) return [{ ...actor, missing: false, label: actorName(actor) }];
    return [{
      id,
      kind: text(recipient?.kind),
      name: text(recipient?.name) || text(recipient?.label) || id,
      label: text(recipient?.name) || text(recipient?.label) || id,
      missing: true,
    }];
  }), (row) => row.id));
}

function selectedAgentID(agentSelection) {
  const target = agentSelection?.target;
  if (target?.kind === 'single' && target.agent?.id) return target.agent.id;
  return text(agentSelection?.agentId)
    || text(agentSelection?.selectedAgentId)
    || text(agentSelection?.actorId)
    || text(agentSelection?.view?.actorId);
}

// The Composer has one target-selection contract.  `manualAgentId` and
// `recentAgentId` are the two facts the probe owner can observe; the optional
// selected id is the already-materialized projection supplied by the shell.
// Keeping the order here means the hook cannot drift from the pure Composer
// projection when a roster changes or a channel is replaced.
export function resolveComposerAgentSelection({
  roster = [],
  manualAgentId = '',
  recentAgentId = '',
  selectedAgentId = '',
  selectedSource = '',
} = {}) {
  const agents = (roster || []).filter((actor) => actor?.kind === 'agent' && actor.id);
  const byId = new Map(agents.map((actor) => [actor.id, actor]));
  const manual = byId.get(text(manualAgentId));
  if (manual) return Object.freeze({ actorId: manual.id, agent: manual, source: 'manual' });
  const recent = byId.get(text(recentAgentId));
  if (recent) return Object.freeze({ actorId: recent.id, agent: recent, source: 'recent' });
  const selected = byId.get(text(selectedAgentId));
  if (selected) {
    return Object.freeze({
      actorId: selected.id,
      agent: selected,
      source: text(selectedSource) || (agents.length === 1 ? 'only' : 'selected'),
    });
  }
  if (agents.length === 1) return Object.freeze({ actorId: agents[0].id, agent: agents[0], source: 'only' });
  return Object.freeze({ actorId: '', agent: null, source: '' });
}

export function resolveComposerDelivery({ draft, roster, agentSelection }) {
  const normalized = normalizeComposerDraft(draft);
  const rosterByID = new Map((roster || []).map((actor) => [actor.id, actor]));
  const mentions = resolveMentionRows(normalized.recipients, roster);
  const reply = normalized.replyTarget;

  if (reply) {
    const id = text(reply.senderId) || text(reply.actorId);
    const actor = rosterByID.get(id);
    if (!actor) {
      return Object.freeze({
        kind: 'lost',
        source: 'reply',
        rows: Object.freeze([]),
        missing: Object.freeze([]),
        sourceLabel: deliverySourceLabel('reply'),
        label: `@${text(reply.senderName) || id || '原发送者'} 已不在频道`,
      });
    }
    return Object.freeze({ kind: 'direct', source: 'reply', rows: Object.freeze([actor]), missing: Object.freeze([]), sourceLabel: deliverySourceLabel('reply'), label: `回复 @${actorName(actor)}` });
  }

  if (mentions.length) {
    const missing = mentions.filter((row) => row.missing);
    return Object.freeze({
      kind: missing.length ? 'lost' : 'direct',
      source: 'mention',
      rows: mentions,
      missing: Object.freeze(missing),
      sourceLabel: deliverySourceLabel('mention'),
      label: mentions.map((row) => `@${actorName(row)}`).join('、'),
    });
  }

  const selectedID = selectedAgentID(agentSelection);
  const selected = selectedID ? rosterByID.get(selectedID) : null;
  if (selected?.kind === 'agent') {
    const source = selectedAgentSource(agentSelection, false);
    return Object.freeze({ kind: 'direct', source: 'agent-selection', sourceKey: source, rows: Object.freeze([selected]), missing: Object.freeze([]), sourceLabel: deliverySourceLabel(source), label: `@${actorName(selected)}` });
  }
  return Object.freeze({ kind: 'none', source: '', rows: Object.freeze([]), missing: Object.freeze([]), sourceLabel: '', label: '请选择收件人' });
}

export function composerPermissions(access) {
  if (access && typeof access === 'object') {
    const writable = access.relationship === 'member'
      && access.existence !== 'retired'
      && access.unavailable !== true
      && access.runtime !== 'closed';
    const canEditDraft = access.canEditDraft ?? access.canWrite ?? writable;
    const canDurablyAccept = access.canDurablyAccept ?? canEditDraft;
    const canTransmit = access.canTransmit ?? (canDurablyAccept && access.transportOpen !== false);
    return Object.freeze({
      canEditDraft: Boolean(canEditDraft),
      canDurablyAccept: Boolean(canDurablyAccept),
      canTransmit: Boolean(canTransmit),
      reason: text(access.reason) || (canEditDraft ? '' : '当前频道不可写'),
    });
  }
  const writable = access === 'member_active' || access === 'member';
  return Object.freeze({
    canEditDraft: writable,
    canDurablyAccept: writable,
    canTransmit: writable,
    reason: writable ? '' : '当前频道不可写',
  });
}

function pendingForChannel(pending, channelId) {
  return (pending || []).filter((row) => !row?.channelId || row.channelId === channelId);
}

function mentionQuery(value, candidates) {
  const match = /(?:^|\s)@([^\s@]*)$/u.exec(value);
  if (!match) return null;
  const at = match.index + match[0].lastIndexOf('@');
  const query = match[1].toLocaleLowerCase();
  const rows = candidates.filter((actor) => {
    const haystack = `${actorName(actor)} ${actor.id}`.toLocaleLowerCase();
    return !query || haystack.includes(query);
  });
  return Object.freeze({ query: match[1], start: at, end: value.length, rows: Object.freeze(rows.slice(0, 8)) });
}

function controlAvailability(capability, type, targetAgent, permissions) {
  if (!targetAgent) return Object.freeze({ state: 'no-target', enabled: false, reason: '请先选择目标 Agent' });
  if (!permissions.canTransmit) return Object.freeze({ state: 'offline', enabled: false, reason: '连接可用后才能发送控制命令' });
  if (!capability?.describe) {
    return Object.freeze({
      state: capability?.error ? 'unavailable' : 'unknown',
      enabled: false,
      reason: capability?.error ? 'Agent 能力读取失败' : '正在确认 Agent 能力',
    });
  }
  if (!capability.describe.types?.has?.(type)) {
    return Object.freeze({ state: 'unsupported', enabled: false, reason: `Agent 不支持 ${type}` });
  }
  return Object.freeze({ state: 'supported', enabled: true, reason: '' });
}

function commandAvailability(definition, capability, targetAgent, permissions) {
  if (!permissions.canTransmit) return Object.freeze({ state: 'offline', enabled: false, reason: '连接可用后才能发送命令' });
  if (definition.scope === 'system') return Object.freeze({ state: 'supported', enabled: true, reason: '' });
  if (!targetAgent) return Object.freeze({ state: 'no-target', enabled: false, reason: '请先选择目标 Agent' });
  if (definition.scope === 'system-target') return Object.freeze({ state: 'supported', enabled: true, reason: '' });
  return controlAvailability(capability, definition.type, targetAgent, permissions);
}

function slashCommandMenu(value, controls) {
  const match = /^\/([^\s/]*)$/u.exec(text(value));
  if (!match) return null;
  const query = match[1].toLocaleLowerCase();
  const matching = COMPOSER_SLASH_COMMANDS.filter((row) => row.menu !== false && (
    `${row.command} ${row.label}`.toLocaleLowerCase().includes(query)
  ));
  const rows = matching.filter((row) => controls[row.command]?.enabled).map((row) => Object.freeze({
    ...row,
    availability: controls[row.command],
  }));
  const unavailable = matching.find((row) => controls[row.command]?.reason);
  return Object.freeze({
    query: match[1],
    rows: Object.freeze(rows),
    reason: rows.length ? '' : controls[unavailable?.command]?.reason || controls.restart?.reason || '没有匹配的命令',
  });
}

export function buildComposerModel({
  activeChannelId = '',
  draft,
  pending = [],
  roster = [],
  selfId = '',
  access,
  agentSelection = null,
  capabilityIndex = new Map(),
  attachments,
  edit = null,
  editText,
  accepting = false,
} = {}) {
  const baseDraft = normalizeComposerDraft({
    ...draft,
    attachments: attachments ?? draft?.attachments,
  });
  const editSession = edit?.session || edit || null;
  const normalizedDraft = editSession ? normalizeComposerDraft({
    ...baseDraft,
    text: editText ?? editSession.text ?? '',
    attachments: editSession.attachments || [],
  }) : baseDraft;
  const permissions = composerPermissions(access);
  const channelPending = pendingForChannel(pending, activeChannelId);
  const failures = channelPending.filter((row) => RETRYABLE_STATES.has(row?.state));
  const mentionCandidates = (roster || []).filter((actor) => (
    actor?.id && actor.id !== selfId && SENDABLE_KINDS.has(actor.kind)
  ));
  const activeMention = mentionQuery(normalizedDraft.text, mentionCandidates);
  const agents = (roster || []).filter((actor) => actor?.kind === 'agent');
  const selectedID = selectedAgentID(agentSelection);
  const selection = resolveComposerAgentSelection({
    roster,
    selectedAgentId: selectedID,
    selectedSource: selectedAgentSource(agentSelection, false),
  });
  const selectedAgent = selection.agent;
  const delivery = resolveComposerDelivery({
    draft: normalizedDraft,
    roster,
    agentSelection: selectedAgent
      ? {
        ...agentSelection,
        selectedAgentId: selectedAgent.id,
        ...(selection.source === 'only' ? { fallbackSource: 'only' } : {}),
      }
      : agentSelection,
  });
  const deliveryAgents = delivery.rows.filter((actor) => actor.kind === 'agent');
  const targetAgent = deliveryAgents.length === 1 ? deliveryAgents[0] : delivery.rows.length ? null : selectedAgent;
  const parameterView = agentSelection?.view?.actorId && agentSelection.view.actorId !== targetAgent?.id
    ? null
    : agentSelection?.view || null;
  const parameterPending = agentSelection?.pending?.actorId && agentSelection.pending.actorId !== targetAgent?.id
    ? null
    : agentSelection?.pending || null;
  const editOwner = edit || normalizedDraft.edit || null;
  const targetCapability = targetAgent ? capabilityIndex.get(targetAgent.id) : null;
  const commandControls = Object.freeze(Object.fromEntries(COMPOSER_SLASH_COMMANDS.map((definition) => [
    definition.command,
    commandAvailability(definition, targetCapability, targetAgent, permissions),
  ])));
  const controls = Object.freeze({
    actorId: targetAgent?.id || '',
    steer: controlAvailability(targetCapability, TYPES.agentSteer, targetAgent, permissions),
    interrupt: controlAvailability(targetCapability, TYPES.agentInterrupt, targetAgent, permissions),
    commands: commandControls,
  });
  const hasBody = Boolean(normalizedDraft.text.trim() || normalizedDraft.attachments.length);
  const commandLike = normalizedDraft.text.trim().startsWith('/') && !normalizedDraft.text.trim().startsWith('//');
  const canSubmit = editOwner
    ? Boolean(normalizedDraft.text.trim() && permissions.canTransmit && (!editSession?.phase || editSession.phase === 'editing'))
    : commandLike
      ? Boolean(hasBody && permissions.canEditDraft)
      : Boolean(hasBody && permissions.canDurablyAccept && delivery.kind === 'direct');

  return Object.freeze({
    channelId: activeChannelId,
    draft: normalizedDraft,
    delivery,
    roster: Object.freeze([...(roster || [])]),
    selfId,
    mentionCandidates: Object.freeze(mentionCandidates),
    mentionQuery: activeMention,
    agents: Object.freeze(agents),
    selectedAgent,
    targetAgent,
    agentSelection,
    parameters: parameterView,
    parameterPending,
    controls,
    commandMenu: editOwner ? null : slashCommandMenu(normalizedDraft.text, commandControls),
    pending: Object.freeze(channelPending),
    failures: Object.freeze(failures),
    failure: failures.at(-1) || null,
    edit: editOwner,
    editSession,
    permissions,
    canSubmit,
    busy: Boolean(accepting || (editSession?.phase
      && editSession.phase !== 'editing'
      && !editSession.error)),
  });
}

function ensureSendableDelivery(delivery) {
  if (delivery.kind === 'lost') throw new TypeError(delivery.label || '收件人已不在频道');
  if (delivery.kind !== 'direct' || !delivery.rows.length) throw new TypeError('请选择收件人或目标 Agent');
  const invalid = delivery.rows.find((row) => !SENDABLE_KINDS.has(row.kind));
  if (invalid) throw new TypeError(`@${actorName(invalid)} 不能作为消息收件人`);
}

export function createMessageRequest(model, persistedDraft) {
  ensureSendableDelivery(model.delivery);
  if (!model.draft.text.trim() && !model.draft.attachments.length) throw new TypeError('消息内容不能为空');
  const slash = parseComposerCommand(model.draft.text);
  if (slash?.kind === 'command') {
    throw commandError(`命令 /${slash.command} 必须通过命令端口发送`, 'composer_command_route_required');
  }
  const body = slash?.kind === 'escaped'
    ? slash.text
    : model.draft.text.trim() || `发送 ${model.draft.attachments.length} 个附件`;
  const parentId = text(model.draft.replyTarget?.sourceId);
  const batch = model.delivery.rows.map((actor) => ({
    channelId: model.channelId,
    text: body,
    msgType: actor.kind === 'human' ? TYPES.humanMessage : TYPES.agentAsk,
    audience: [actor.id],
    targetLabel: actorName(actor),
    payload: model.draft.attachments.length
      ? { text: body, attachments: model.draft.attachments }
      : undefined,
    ...(parentId ? { parentId } : {}),
  }));
  return Object.freeze({
    channelId: model.channelId,
    batch,
    draftRevision: Number(persistedDraft?.revision ?? model.draft.revision ?? 0),
    editorRevision: model.draft.editorRevision,
  });
}

export function createComposerCommandRequest(model, parsed = parseComposerCommand(model?.draft?.text)) {
  if (!parsed || parsed.kind !== 'command') throw commandError('没有可执行的 Composer 命令', 'composer_command_missing');
  if (model.draft.replyTarget) throw commandError('回复模式下不能使用斜杠命令，请先取消回复', 'composer_command_reply');
  if (model.draft.attachments.length) throw commandError('斜杠命令不能携带附件，请先移除附件', 'composer_command_attachments');
  const availability = model.controls.commands?.[parsed.command];
  if (!availability?.enabled) {
    throw commandError(availability?.reason || `命令 /${parsed.command} 当前不可用`, `composer_command_${availability?.state || 'unavailable'}`);
  }
  if (parsed.scope === 'system' || parsed.scope === 'system-target') {
    return Object.freeze({
      channelId: model.channelId,
      text: '',
      msgType: parsed.type,
      audience: [SYSTEM_ACTOR_ID],
      targetLabel: SYSTEM_ACTOR_ID,
      payload: parsed.scope === 'system-target'
        ? Object.freeze({ ...parsed.payload, member: model.targetAgent.id })
        : parsed.payload,
    });
  }
  return createControlRequest(model, parsed.type, parsed.payload, model.targetAgent.id);
}

export function createControlRequest(model, type, payload, actorId = '') {
  const targetActor = actorId
    ? model.roster.find((actor) => actor.id === actorId)
    : model.selectedAgent || model.delivery.rows.find((actor) => actor.kind === 'agent');
  if (!targetActor || targetActor.kind !== 'agent') throw new TypeError('请选择目标 Agent');
  return Object.freeze({
    channelId: model.channelId,
    text: '',
    msgType: type,
    audience: [targetActor.id],
    targetLabel: actorName(targetActor),
    payload,
  });
}

export function editCASPayload(edit, nextText) {
  const target = text(edit?.targetId) || text(edit?.target);
  const oldText = text(edit?.oldText ?? edit?.text);
  const newText = text(nextText);
  if (!target) throw new TypeError('编辑目标不存在');
  if (!newText.trim()) throw new TypeError('编辑内容不能为空');
  return Object.freeze({
    target,
    old_text: oldText,
    new_text: newText,
    ...(text(edit?.holdId) ? { expected_hold_id: text(edit.holdId) } : {}),
  });
}
