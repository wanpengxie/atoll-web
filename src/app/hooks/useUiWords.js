import { useCallback, useEffect, useRef, useState } from 'react';
import { diagnostic } from '../../model/diagnostics.js';
import {
  answerUiForm,
  clientUiRequests,
  parseUiFormRequest,
  uiFormCancelled,
  uiRequestAddressing,
} from '../../model/ui-form.js';

const CLOSED_CODES = new Set(['already_closed', 'request_not_found']);

// useUiWords 是 ui.* 的不纯那一半：盯住账本里发给我、还开着、点名这块屏的请求，
// 把 ui.form 排进弹窗队列，答完用 resolve 帧关掉。
//
// version 是必需的：feed 的版本号是这里唯一如实反映"账本动过了"的东西；
// stateEntries 只给一次只读快照。
export function useUiWords({ stateEntries, version, selfFor, wireRef, wireState, onNotice }) {
  // 一条请求在终态回到账本之前一直开着，所以要自己记住受理过什么，否则每次
  // 重渲染都会再弹一次同一张表。
  const handledRef = useRef(new Set());
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;
  // 每个频道只在它的时间线真的变了（_timelineRevision）才重扫；大账本上每来一行
  // 就把所有频道从头走一遍，会把这条旁路变成主路径上的开销。
  const scansRef = useRef(new WeakMap());
  const [forms, setForms] = useState([]);

  const send = useCallback((frame) => {
    const wire = wireRef.current;
    if (typeof wire?.resolve !== 'function') {
      return Promise.reject(Object.assign(new Error('连接尚未就绪，稍后重试'), { code: 'unavailable' }));
    }
    return wire.resolve(frame);
  }, [wireRef]);

  const dismiss = useCallback((id) => {
    setForms((current) => (current.some((form) => form.id === id) ? current.filter((form) => form.id !== id) : current));
  }, []);

  useEffect(() => {
    if (wireState !== 'open') return;
    // 这块屏叫什么由 attach 回执给出；还没拿到就不判断"是不是点我"。
    const session = wireRef.current?.session?.();
    if (!session?.id) return;
    const closed = new Set();
    const accepted = [];
    for (const [channelId, state] of stateEntries()) {
      const selfId = selfFor(channelId);
      const revision = state?._timelineRevision;
      const cached = state && typeof state === 'object' ? scansRef.current.get(state) : null;
      let scan = cached && Number.isFinite(revision) && cached.revision === revision && cached.selfId === selfId
        ? cached.scan
        : null;
      if (!scan) {
        scan = clientUiRequests(state, selfId);
        if (state && typeof state === 'object') scansRef.current.set(state, { revision, selfId, scan });
      }
      const { open, closed: done } = scan;
      for (const id of done) closed.add(id);
      for (const request of open) {
        if (handledRef.current.has(request.id)) continue;
        handledRef.current.add(request.id);
        const addressing = uiRequestAddressing(request, session);
        if (addressing === 'other') continue;
        // 没人操作时，这块屏恒不自己往账本写东西（手动挡）：没点名屏的、形状不对
        // 的请求不弹、也不替人回拒绝，留在账本里由它自己的过期收尾。
        if (addressing === 'unaddressed') {
          diagnostic('info', 'ui_word.unaddressed', { reqId: request.id, session: session.id });
          continue;
        }
        const parsed = parseUiFormRequest(request);
        if (!parsed.ok) {
          diagnostic('info', 'ui_word.malformed', { reqId: request.id, code: parsed.code, detail: parsed.message });
          continue;
        }
        accepted.push(parsed.form);
      }
    }
    if (!accepted.length && !closed.size) return;
    // 只有看见终态才收表单：频道还在同步时看不见它，不等于它关了。
    setForms((current) => {
      const kept = current.filter((form) => !closed.has(form.id));
      const known = new Set(kept.map((form) => form.id));
      const next = [...kept, ...accepted.filter((form) => !known.has(form.id))];
      return next.length === current.length && next.every((form, index) => form === current[index]) ? current : next;
    });
  }, [selfFor, stateEntries, version, wireRef, wireState]);

  const settleClosed = useCallback((form, error, written = []) => {
    if (!CLOSED_CODES.has(error?.code)) return false;
    dismiss(form.id);
    // 回复在写完 key 之后才发：表单已经关了，但 key 已经写进去了，要照实说。
    noticeRef.current?.(written.length
      ? `key 已写入 ${written.join('、')}，但这张表单已经关闭（在别处答复了或已过期），agent 没收到回复。`
      : '这张表单已经关闭（在别处答复了或已过期）。');
    return true;
  }, [dismiss]);

  const submit = useCallback(async (form, values, writeSecret) => {
    try {
      const result = await answerUiForm({ form, values, writeSecret, resolve: send });
      dismiss(form.id);
      return result;
    } catch (error) {
      // 走到回复这一步才会是"已关闭"，所以填了的 secret 都已写入。
      const written = Object.entries(form.secret || {}).filter(([name]) => Object.hasOwn(values || {}, name)).map(([, resourceId]) => resourceId);
      if (settleClosed(form, error, written)) return null;
      throw error;
    }
  }, [dismiss, send, settleClosed]);

  const cancel = useCallback(async (form) => {
    try {
      await send(uiFormCancelled(form));
      dismiss(form.id);
    } catch (error) {
      if (settleClosed(form, error)) return;
      throw error;
    }
  }, [dismiss, send, settleClosed]);

  return { forms, current: forms[0] || null, submit, cancel };
}
