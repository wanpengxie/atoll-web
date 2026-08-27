import { argsOf } from '../protocol/envelope.js';
import { TYPES } from '../protocol/vocab.js';

const SENSITIVE_FIELD = /password|secret|token|credential|private_key|\bkey\b/i;
const CONVERSATION_TYPES = new Set([TYPES.agentAsk, TYPES.agentQueue, TYPES.agentReplace, TYPES.agentSteer, TYPES.humanAsk, TYPES.humanMessage]);

function value(payload, ...keys) {
  for (const key of keys) {
    const candidate = payload?.[key];
    if ((typeof candidate === 'string' || typeof candidate === 'number') && String(candidate).trim()) return String(candidate).trim();
  }
  return '';
}

function action(type, payload) {
  const target = value(payload, 'name', 'title', 'principal', 'member', 'decl_id', 'id', 'channel_id', 'device_id');
  const exact = {
    [TYPES.channel.create]: ['创建子频道', [value(payload, 'name'), value(payload?.recipe?.profile, 'description')].filter(Boolean).join(' · ')],
    [TYPES.channel.get]: ['查看频道信息', value(payload, 'channel_id', 'id')],
    [TYPES.channel.list]: ['列出频道', value(payload, 'parent_id')],
    [TYPES.channel.remove]: ['退役频道', value(payload, 'channel_id', 'id')],
    [TYPES.channel.set]: ['更新频道配置', value(payload, 'channel_id')],
    [TYPES.member.create]: ['添加参与者', value(payload, 'decl_id')],
    [TYPES.member.admit]: ['邀请成员加入', value(payload, 'principal')],
    [TYPES.member.list]: ['查看频道成员', ''],
    [TYPES.member.get]: ['查看成员状态', value(payload, 'member')],
    [TYPES.member.remove]: ['移除参与者', value(payload, 'member')],
    [TYPES.member.restart]: ['重启参与者', value(payload, 'member')],
    [TYPES.member.restartAll]: ['重启频道内全部成员', ''],
    [TYPES.agentDismiss]: ['请对方放弃一条等待中的任务', value(payload, 'target')],
    [TYPES.log.recent]: ['读取最近账本', ''],
    [TYPES.describe]: ['查看 Actor 能力', value(payload, 'type')],
    [TYPES.actorOverlay.set]: ['设置 Actor 频道配置', value(payload, 'decl_id')],
    [TYPES.actorOverlay.clear]: ['清除 Actor 频道配置', value(payload, 'decl_id')],
    'task.create': ['创建任务', value(payload, 'title', 'description')],
    [TYPES.agentAsk]: ['向 Agent 提问', value(payload, 'text')],
    [TYPES.agentSteer]: ['插入到当前回合', value(payload, 'text')],
    [TYPES.agentInterrupt]: ['停止', ''],
    [TYPES.agentHold]: ['暂停等待区', value(payload, 'target')],
    [TYPES.agentUnhold]: ['继续等待区', ''],
    [TYPES.agentReplace]: ['修改任务内容', value(payload, 'new_text')],
    [TYPES.agentQueue]: ['加入待办任务', value(payload, 'text')],
    [TYPES.agentFork]: ['分叉出新 Agent', ''],
    [TYPES.agentCompact]: ['压缩上下文', ''],
    [TYPES.agentNew]: ['新建对话', ''],
    [TYPES.agentSelect]: ['切换模型与算力', value(payload, 'model', 'effort')],
    [TYPES.agentContext]: ['查看上下文用量', ''],
  }[type];
  if (exact) return exact;

  const template = type.match(/^system\.(actor|channel)\.template\.(create|set|delete|list|get)$/);
  if (template) {
    const subject = template[1] === 'actor' ? 'Actor 模板' : '频道模板';
    const verb = { create: '创建', set: '编辑', delete: '撤销', list: '查看', get: '查看' }[template[2]];
    return [`${verb}${subject}`, target];
  }

  const device = type.match(/^system\.device\.(create|delete|attach|detach|list)$/);
  if (device) {
    const verb = { create: '创建设备凭据', delete: '停用设备', attach: '挂载设备到频道', detach: '从频道卸载设备', list: '查看设备' }[device[1]];
    return [verb, value(payload, 'name', 'device_id')];
  }

  const principal = type.match(/^system\.(principal|credential)\.(create|login|delete|get|list|set)$/);
  if (principal) {
    const verb = { create: '创建账户', login: '登录', delete: '停用账户', get: '查看账户', list: '查看账户列表', set: '重设凭据' }[principal[2]];
    return [verb, value(payload, 'email', 'principal_id', 'id')];
  }
  return null;
}

function safeHint(payload) {
  if (!payload || typeof payload !== 'object') return '';
  for (const [key, item] of Object.entries(payload)) {
    if (SENSITIVE_FIELD.test(key) || ['text', 'attachments'].includes(key)) continue;
    if ((typeof item === 'string' || typeof item === 'number') && String(item).trim()) return String(item).trim();
  }
  return '';
}

function textContent(payload) {
  if (!payload || typeof payload !== 'object') return '';
  for (const candidate of [payload.new_text, payload.text, payload.message, payload.content, payload.prompt, payload.input?.text]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  if (Array.isArray(payload.content)) {
    return payload.content
      .filter((item) => item && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}

export function messagePresentation(envelope = {}) {
  const payload = argsOf(envelope);
  const conversation = textContent(payload);
  if (conversation || CONVERSATION_TYPES.has(envelope.type)) {
    return {
      text: conversation || (payload.attachments?.length ? `发送了 ${payload.attachments.length} 个文件` : '没有可显示的消息正文'),
      detail: '',
    };
  }
  const known = action(String(envelope.type || ''), payload);
  if (known) return { text: known[0], detail: known[1] || '' };
  if (payload.attachments?.length) return { text: `发送了 ${payload.attachments.length} 个文件`, detail: '' };
  return { text: envelope.type ? '提交了一项操作' : '记录了一条消息', detail: safeHint(payload) };
}
