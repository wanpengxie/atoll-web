import { TYPES } from '../protocol/vocab.js';
import { attachmentFromFileReference } from './file-references.js';

// ui-words.js 是 ui.* 的**纯**那一半：把一条发给我的请求，变成一个 resolve 帧。
//
// 副作用（真的切频道、真的开预览）由调用方注入，因为它们住在 App 的 state 里；
// 这里只负责三件事：读参数、决定调哪个动作、把结果或失败装回帧。这样"客户端
// 如实回报成功与否"这条契约可以被直接测试，不用先渲染一棵组件树。
//
// 实验性原型（DEV_BACKLOG 附录 A）：词名是手写的，不是从界面推导出来的。

// requestBody 取出词的参数。线上每条 request 的 payload 恒是 {_context?, body}，
// _context 是底座的，跟词的契约无关。
export function requestBody(envelope) {
  const payload = envelope?.payload;
  if (!payload || typeof payload !== 'object') return {};
  const body = payload.body;
  return body && typeof body === 'object' ? body : {};
}

// snapshot 是"客户端现在显示着什么"的投影。
//
// 它必须从**渲染真正读的那份 state** 算出来，不能另起一份影子状态：两份必然
// 漂移，然后 agent"先看再动"看的是个谎——那比不看更糟，不看至少知道自己不知道。
//
// available 是刻意在的：只给当前状态而不给可选项，调用方只能靠猜，
// 于是 ui.navigate 的合法参数集就没有出处。
export function snapshot({ channelId, view, channels, open, viewport }) {
  return {
    route: { channel_id: channelId || '', view: view || '' },
    open: open || { kind: 'none' },
    available: {
      channels: (channels || []).map((row) => ({ id: row.id, name: row.name || row.id })),
      views: ['dynamic', 'artifacts'],
    },
    viewport: viewport || {},
  };
}

// openFromPreview 把 App 的 mountedFilePreview 折成 snapshot 的 open 段。
export function openFromPreview(preview) {
  if (!preview) return { kind: 'none' };
  return {
    kind: preview.file_reference ? 'file' : 'artifact',
    path: preview.resource_id || '',
    name: preview.name || '',
    ...(Number.isSafeInteger(preview.line) && preview.line > 0 ? { line: preview.line } : {}),
  };
}

const ok = (reqId, channelId, result) => ({ channel_id: channelId, req_id: reqId, result });
const fail = (reqId, channelId, code, message) => ({ channel_id: channelId, req_id: reqId, error: { code, message } });

// execute 受理一条 ui.* 请求，返回要发回去的 resolve 帧。
//
// actions 里的动作是同步的 UI 变更；它们做完之后 snapshot 才算数，所以帧里的
// 状态是**操作之后**的——调用方不需要再读一次。
export async function execute(envelope, { actions, readSnapshot }) {
  const reqId = envelope.id;
  const channelId = envelope.channel_id;
  const body = requestBody(envelope);

  try {
    switch (envelope.type) {
      case TYPES.uiState:
        return ok(reqId, channelId, readSnapshot());

      case TYPES.uiNavigate: {
        const target = String(body.channel_id || '');
        if (!target) return fail(reqId, channelId, 'invalid_args', 'channel_id required');
        const before = readSnapshot();
        const known = before.available.channels.some((row) => row.id === target);
        if (!known) {
          // 点名可选项，而不是只说"找不到"——调用方下一个问题必然是"那有哪些"。
          const names = before.available.channels.map((row) => row.id).join(', ');
          return fail(reqId, channelId, 'unknown_channel', `no channel ${target} here; this client can reach: ${names}`);
        }
        const view = body.view ? String(body.view) : '';
        if (view && !before.available.views.includes(view)) {
          return fail(reqId, channelId, 'invalid_args', `unknown view ${view}; this client has: ${before.available.views.join(', ')}`);
        }
        await actions.navigate(target, view);
        return ok(reqId, channelId, readSnapshot());
      }

      case TYPES.uiOpen: {
        const path = String(body.path || '');
        if (!path.startsWith('/')) {
          return fail(reqId, channelId, 'invalid_args', 'path must be an absolute host path');
        }
        const line = Number(body.line);
        const reference = { path, ...(Number.isSafeInteger(line) && line > 0 ? { line } : {}) };
        await actions.open(attachmentFromFileReference(reference));
        return ok(reqId, channelId, readSnapshot());
      }

      default:
        return fail(reqId, channelId, 'type_unsupported', `this client does not answer ${envelope.type}`);
    }
  } catch (error) {
    // 说实话比说好听重要：这条链路存在的意义就是前端第一次能报告"我没做成"。
    return fail(reqId, channelId, 'ui_error', String(error?.message || error));
  }
}
