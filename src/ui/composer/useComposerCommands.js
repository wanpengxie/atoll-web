import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TYPES } from '../../protocol/vocab.js';
import { createComposerCommandPort } from './command-port.js';
import { projectAgentParameters } from './agent-parameters.js';
import { useComposerSubmissionRuntime } from './useComposerSubmissionRuntime.js';
import {
  buildComposerModel,
  createControlRequest,
  createMessageRequest,
  editCASPayload,
  normalizeComposerDraft,
} from './composer-model.js';

function idsOf(result) {
  if (Array.isArray(result)) return result.filter(Boolean);
  return result ? [result] : [];
}

function normalizeMention(actor) {
  if (!actor?.id) throw new TypeError('收件人不存在');
  if (!['agent', 'human'].includes(actor.kind)) throw new TypeError('该成员不能作为消息收件人');
  return { id: actor.id, kind: actor.kind, name: actor.name || actor.label || actor.id };
}

function attachmentID(row) {
  return row?.resource_id || row?.id || '';
}

function commandOwner(config, model) {
  const {
    submission = {},
    agentSelection = null,
  } = config;
  const probes = () => config.probesRef?.current || config.probes || {};
  const attachment = () => config.attachmentRef?.current || config.attachment || {};
  const requireChannel = () => {
    if (!model.channelId) throw new TypeError('请先选择频道');
    return model.channelId;
  };
  const requireDraftEdit = () => {
    if (!model.permissions.canEditDraft) throw new TypeError(model.permissions.reason || '当前频道不可编辑草稿');
  };
  const persist = (next) => {
    requireChannel();
    requireDraftEdit();
    if (typeof submission.updateDraft !== 'function') throw new TypeError('草稿 owner 未连接');
    return submission.updateDraft(model.channelId, next);
  };
  const changeDraft = (change) => {
    const current = model.draft;
    const patch = typeof change === 'function' ? change(current) : change;
    const next = normalizeComposerDraft({
      ...current,
      ...(patch && typeof patch === 'object' ? patch : { text: String(patch ?? '') }),
      editorRevision: current.editorRevision + 1,
    });
    if (model.edit) {
      if (typeof config.setEditText !== 'function') throw new TypeError('编辑草稿 owner 未连接');
      config.setEditText(next.text);
      return next;
    }
    return persist(next);
  };
  const control = (type, payload, actorId = '') => {
    requireChannel();
    if (!model.permissions.canTransmit) throw new TypeError('连接可用后才能发送 Agent 控制命令');
    if (typeof submission.control !== 'function') throw new TypeError('Agent 控制 owner 未连接');
    return submission.control(createControlRequest(model, type, payload, actorId));
  };
  const performSend = async ({ readingIntent = null } = {}) => {
    requireChannel();
    if (!model.permissions.canDurablyAccept) throw new TypeError(model.permissions.reason || '当前频道不能保存发送');
    if (typeof submission.send !== 'function') throw new TypeError('发送 owner 未连接');
    const token = readingIntent?.composerSendStarted?.(model.channelId) || null;
    let accepted = [];
    try {
      const persisted = typeof submission.updateDraft === 'function'
        ? await submission.updateDraft(model.channelId, model.draft, { preserveEditorRevision: true })
        : null;
      const result = await submission.send(createMessageRequest(model, persisted));
      accepted = idsOf(result);
      if (!accepted.length) throw new Error('发送队列未返回消息编号');
      readingIntent?.composerAccepted?.(model.channelId, accepted, token);
      return accepted;
    } catch (error) {
      if (!accepted.length) readingIntent?.composerRejected?.(model.channelId, token);
      throw error;
    }
  };

  return Object.freeze({
    changeDraft,
    addMention(actor) {
      const recipient = normalizeMention(actor);
      if (model.draft.recipients.some((row) => (typeof row === 'string' ? row : row?.id) === recipient.id)) return null;
      return changeDraft({ recipients: [...model.draft.recipients, recipient] });
    },
    pickMention(actor) {
      const recipient = normalizeMention(actor);
      const query = model.mentionQuery;
      const recipients = model.draft.recipients.some((row) => (typeof row === 'string' ? row : row?.id) === recipient.id)
        ? model.draft.recipients
        : [...model.draft.recipients, recipient];
      const nextText = query
        ? `${model.draft.text.slice(0, query.start)}${model.draft.text.slice(query.end)}`.replace(/[ \t]+$/u, '')
        : model.draft.text;
      return changeDraft({ recipients, text: nextText });
    },
    removeMention(actorId) {
      return changeDraft({
        recipients: model.draft.recipients.filter((row) => (typeof row === 'string' ? row : row?.id) !== actorId),
      });
    },
    clearReply() {
      return changeDraft({ replyTarget: null });
    },
    send(options = {}) {
      const key = `${model.channelId}:${model.draft.editorRevision}`;
      const existing = config.sendIntentRef.current.get(key);
      if (existing) return existing;
      const operation = performSend(options).finally(() => {
        if (config.sendIntentRef.current.get(key) === operation) config.sendIntentRef.current.delete(key);
      });
      config.sendIntentRef.current.set(key, operation);
      return operation;
    },
    steer(value = {}) {
      const input = typeof value === 'string' ? { text: value } : value;
      let payload;
      if (input.all === true) payload = { all: true };
      else if (input.target) payload = { target: input.target };
      else if (String(input.text || '').trim()) payload = {
        text: String(input.text),
        ...(input.expectedTurnId ? { expected_turn_id: input.expectedTurnId } : {}),
      };
      else throw new TypeError('Steer 内容或目标不能为空');
      return control(TYPES.agentSteer, payload, input.actorId || model.editSession?.actorId);
    },
    replace(value = {}) {
      const input = typeof value === 'string' ? { newText: value } : value;
      const edit = input.edit || model.editSession || model.edit;
      return control(TYPES.agentReplace, editCASPayload(edit, input.newText ?? model.draft.text), input.actorId || model.editSession?.actorId);
    },
    interrupt(value = {}) {
      const input = typeof value === 'string' ? { actorId: value } : value;
      return control(TYPES.agentInterrupt, {}, input.actorId || model.editSession?.actorId);
    },
    retry(value = model.failure) {
      if (typeof submission.retry !== 'function') throw new TypeError('重试 owner 未连接');
      const row = typeof value === 'string'
        ? model.pending.find((item) => item.messageId === value || item.id === value)
        : value;
      if (!row) throw new TypeError('重试目标不存在');
      return submission.retry(row);
    },
    edit(value = {}) {
      const input = typeof value === 'string' ? { newText: value } : value;
      if (typeof model.edit?.onSave === 'function') return model.edit.onSave(input.newText ?? model.draft.text);
      if (typeof model.edit?.commit === 'function') return model.edit.commit(input.newText ?? model.draft.text);
      return control(TYPES.agentReplace, editCASPayload(input.edit || model.editSession || model.edit, input.newText ?? model.draft.text), input.actorId);
    },
    cancelEdit() {
      return model.edit?.onAbandon?.() ?? model.edit?.abandon?.() ?? null;
    },
    attach(resource) {
      requireDraftEdit();
      if (model.edit) throw new TypeError('编辑已有消息时不能附加频道文件');
      const owner = attachment();
      if (typeof owner.attach !== 'function') throw new TypeError('频道附件 owner 未连接');
      return owner.attach(resource, model.channelId);
    },
    upload(files) {
      requireDraftEdit();
      if (model.edit) throw new TypeError('编辑已有消息时不能上传普通草稿附件');
      const owner = attachment();
      if (typeof owner.upload !== 'function') throw new TypeError('上传 owner 未连接');
      return owner.upload([...files]);
    },
    removeAttachment(resourceId) {
      requireDraftEdit();
      const owner = attachment();
      if (typeof owner.mutate !== 'function') throw new TypeError('附件草稿 owner 未连接');
      return owner.mutate(model.channelId, (rows) => rows.filter((row) => attachmentID(row) !== resourceId));
    },
    clearAttachments() {
      requireDraftEdit();
      const owner = attachment();
      if (typeof owner.clear !== 'function') throw new TypeError('附件草稿 owner 未连接');
      return owner.clear(model.channelId);
    },
    selectAgent(actorId) {
      const actor = model.agents.find((row) => row.id === actorId);
      if (!actor) throw new TypeError('目标 Agent 已不在频道');
      const owner = probes();
      owner.pickAgent?.(actorId);
      owner.targetChanged?.(actorId);
      return actor;
    },
    openAgentSelector() {
      return probes().selectorOpened?.();
    },
    setModelParameters(value = {}) {
      const actorId = value.actorId || model.targetAgent?.id || model.parameters?.actorId;
      if (!value.model) throw new TypeError('模型参数缺少 model');
      const payload = {
        model: value.model,
        ...(value.effort ? { effort: value.effort } : {}),
      };
      if (typeof agentSelection?.onChange === 'function') {
        return agentSelection.onChange({ actorId, ...payload });
      }
      return control(TYPES.agentSelect, payload, actorId);
    },
  });
}

export function useComposerCommands(config = {}) {
  const {
    activeChannelId = '', roster, selfId, access,
    agentSelection, attachments, edit,
  } = config;
  const submission = useComposerSubmissionRuntime(config);
  const draft = submission.draftFor(activeChannelId);
  const pending = submission.pending;
  const editSession = edit?.session || edit || null;
  const editSessionKey = editSession?.sessionId || editSession?.targetId || '';
  const [editBuffer, setEditBuffer] = useState({ key: '', text: '' });
  const sendIntentRef = useRef(new Map());
  const editText = editSessionKey && editBuffer.key === editSessionKey
    ? editBuffer.text
    : String(editSession?.text || '');
  const setEditText = (value) => setEditBuffer({ key: editSessionKey, text: String(value ?? '') });
  const selectedAgentId = agentSelection?.target?.agent?.id
    || agentSelection?.agentId
    || agentSelection?.selectedAgentId
    || agentSelection?.actorId
    || '';
  const probeOwner = config.probes || config.probesRef?.current;
  const parameterProjection = projectAgentParameters({
    state: config.channelState,
    actorId: selectedAgentId,
    requestKeys: probeOwner?.requestKeys?.(activeChannelId, selectedAgentId),
  });
  const effectiveAgentSelection = {
    ...agentSelection,
    view: agentSelection?.view || parameterProjection.view,
    pending: agentSelection?.pending || parameterProjection.pending,
  };
  const model = useMemo(() => buildComposerModel({
    activeChannelId,
    draft,
    pending,
    roster,
    selfId,
    access,
    agentSelection: effectiveAgentSelection,
    attachments,
    edit,
    editText,
    accepting: submission.accepting,
  }), [activeChannelId, access, attachments, draft, edit, editText, effectiveAgentSelection, pending, roster, selfId, submission.accepting]);

  // A different channel is a different command authority. The old painted
  // editor keeps its port while a replacement render suspends, and that port
  // is permanently retired when the replacement commits.
  const port = useMemo(() => createComposerCommandPort(), [activeChannelId]);
  const owner = commandOwner({ ...config, agentSelection: effectiveAgentSelection, submission, setEditText, sendIntentRef }, model);
  useLayoutEffect(() => {
    const release = port.commit(owner);
    return () => {
      release();
      // StrictMode immediately re-commits the same mounted owner after its
      // setup/cleanup probe. Defer final retirement one microtask so that
      // probe can reclaim the port; a genuinely unmounted/channel-replaced
      // port remains ownerless and is then retired permanently.
      queueMicrotask(() => {
        if (!port.current()) port.retire();
      });
    };
  }, [owner, port]);
  useLayoutEffect(() => {
    const probes = config.probesRef?.current || config.probes;
    probes?.targetChanged?.(model.targetAgent?.id || '');
  }, [config.probes, config.probesRef, model.targetAgent?.id]);

  return useMemo(() => Object.freeze({
    model,
    commands: port.commands,
    retire: port.retire,
    submission,
  }), [model, port, submission]);
}
