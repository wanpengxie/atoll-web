import { SYSTEM_ACTOR_ID, TYPES } from '../../protocol/vocab.js';

const SENDABLE_KINDS = new Set(['agent', 'human']);
const RETRYABLE_STATES = new Set(['rejected', 'uncertain']);
export const COMPOSER_SLASH_COMMANDS = Object.freeze([
  Object.freeze({ command: 'compact', type: TYPES.agentCompact, label: '压缩上下文', description: '保留当前对话，压缩较早的上下文', usage: '/compact' }),
  Object.freeze({ command: 'new', type: TYPES.agentNew, label: '新建对话', description: '保留当前 Agent，换成一段全新会话', usage: '/new' }),
  // Restart belongs to the channel system actor: a wedged Agent must not be
  // asked to restart itself. The selected Agent is carried in payload.member.
  Object.freeze({ command: 'restart', type: TYPES.member.restart, scope: 'system', label: '重启 Agent', description: '给卡住的 Agent 换一届任期；账本与文件不动', usage: '/restart' }),
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
  if (args.length) {
    throw commandError(`用法：${definition.usage}`, 'composer_command_usage');
  }
  return Object.freeze({ kind: 'command', ...definition, payload: Object.freeze({}) });
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
        label: `@${text(reply.senderName) || id || '原发送者'} 已不在频道`,
      });
    }
    return Object.freeze({ kind: 'direct', source: 'reply', rows: Object.freeze([actor]), missing: Object.freeze([]), label: `回复 @${actorName(actor)}` });
  }

  if (mentions.length) {
    const missing = mentions.filter((row) => row.missing);
    return Object.freeze({
      kind: missing.length ? 'lost' : 'direct',
      source: 'mention',
      rows: mentions,
      missing: Object.freeze(missing),
      label: mentions.map((row) => `@${actorName(row)}`).join('、'),
    });
  }

  const selectedID = selectedAgentID(agentSelection);
  const selected = selectedID ? rosterByID.get(selectedID) : null;
  if (selected?.kind === 'agent') {
    return Object.freeze({ kind: 'direct', source: 'agent-selection', rows: Object.freeze([selected]), missing: Object.freeze([]), label: `@${actorName(selected)}` });
  }
  return Object.freeze({ kind: 'none', source: '', rows: Object.freeze([]), missing: Object.freeze([]), label: '请选择收件人' });
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
  if (!targetAgent) return Object.freeze({ state: 'no-target', enabled: false, reason: '请先选择目标 Agent' });
  if (!permissions.canTransmit) return Object.freeze({ state: 'offline', enabled: false, reason: '连接可用后才能发送命令' });
  if (definition.scope === 'system') return Object.freeze({ state: 'supported', enabled: true, reason: '' });
  return controlAvailability(capability, definition.type, targetAgent, permissions);
}

function slashCommandMenu(value, controls) {
  const match = /^\/([^\s/]*)$/u.exec(text(value));
  if (!match) return null;
  const query = match[1].toLocaleLowerCase();
  const matching = COMPOSER_SLASH_COMMANDS.filter((row) => (
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
  const delivery = resolveComposerDelivery({ draft: normalizedDraft, roster, agentSelection });
  const permissions = composerPermissions(access);
  const channelPending = pendingForChannel(pending, activeChannelId);
  const failures = channelPending.filter((row) => RETRYABLE_STATES.has(row?.state));
  const mentionCandidates = (roster || []).filter((actor) => (
    actor?.id && actor.id !== selfId && SENDABLE_KINDS.has(actor.kind)
  ));
  const activeMention = mentionQuery(normalizedDraft.text, mentionCandidates);
  const agents = (roster || []).filter((actor) => actor?.kind === 'agent');
  const selectedID = selectedAgentID(agentSelection);
  const selectedAgent = agents.find((actor) => actor.id === selectedID) || null;
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
  if (parsed.scope === 'system') {
    return Object.freeze({
      channelId: model.channelId,
      text: '',
      msgType: parsed.type,
      audience: [SYSTEM_ACTOR_ID],
      targetLabel: SYSTEM_ACTOR_ID,
      payload: Object.freeze({ member: model.targetAgent.id }),
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
