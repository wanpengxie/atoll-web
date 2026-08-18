const SENSITIVE_FIELD = /password|secret|token|credential|private_key|\bkey\b/i;

function value(payload, ...keys) {
  for (const key of keys) {
    const candidate = payload?.[key];
    if ((typeof candidate === 'string' || typeof candidate === 'number') && String(candidate).trim()) return String(candidate).trim();
  }
  return '';
}

function action(type, payload) {
  const target = value(payload, 'name', 'title', 'principal', 'instance_id', 'decl_id', 'id', 'channel_id', 'device_id');
  const exact = {
    'channel.create': ['创建子频道', [value(payload, 'name'), value(payload?.overrides?.profile, 'description')].filter(Boolean).join(' · ')],
    'channel.get': ['查看频道信息', value(payload, 'channel_id', 'id')],
    'channel.describe': ['查看频道能力', value(payload, 'channel_id', 'id')],
    'channel.retire': ['退役频道', value(payload, 'channel_id', 'id')],
    'channel.introduce_actor': ['添加参与者', value(payload, 'principal', 'decl_id')],
    'channel.remove_actor': ['移除参与者', value(payload, 'instance_id', 'principal')],
    'channel.restart_actor': ['重启参与者', value(payload, 'instance_id')],
    'actor.describe': ['查看 Actor 能力', value(payload, 'actor_id', 'id')],
    'actor.overlay.set': ['设置 Actor 频道配置', value(payload, 'decl_id')],
    'actor.overlay.clear': ['清除 Actor 频道配置', value(payload, 'decl_id')],
    'channel.profile.set': ['更新频道配置', value(payload, 'channel_id')],
    'task.create': ['创建任务', value(payload, 'title', 'description')],
    'agent.steer': ['调整任务方向', value(payload, 'text')],
    'agent.interrupt': ['打断当前回合', ''],
    'agent.queue': ['加入待办任务', value(payload, 'text')],
    'agent.stop': ['停止当前工作', ''],
    'agent.terminate': ['终止 Agent', ''],
    'agent.restart': ['重启 Agent', ''],
  }[type];
  if (exact) return exact;

  const template = type.match(/^(actor|channel)\.template\.(register|edit|revoke|list|get)$/);
  if (template) {
    const subject = template[1] === 'actor' ? 'Actor 模板' : '频道模板';
    const verb = { register: '创建', edit: '编辑', revoke: '撤销', list: '查看', get: '查看' }[template[2]];
    return [`${verb}${subject}`, target];
  }

  const device = type.match(/^device\.(mint|claim|retire|attach|detach)$/);
  if (device) {
    const verb = { mint: '创建设备凭据', claim: '认领设备', retire: '停用设备', attach: '挂载设备到频道', detach: '从频道卸载设备' }[device[1]];
    return [verb, value(payload, 'name', 'device_id')];
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

export function messagePresentation(envelope = {}) {
  const payload = envelope.payload || {};
  if (Object.prototype.hasOwnProperty.call(payload, 'text')) {
    const text = String(payload.text || '').trim();
    return { text: text || (payload.attachments?.length ? `发送了 ${payload.attachments.length} 个文件` : '空消息'), detail: '' };
  }
  const known = action(String(envelope.type || ''), payload);
  if (known) return { text: known[0], detail: known[1] || '' };
  if (payload.attachments?.length) return { text: `发送了 ${payload.attachments.length} 个文件`, detail: '' };
  return { text: envelope.type ? '提交了一项操作' : '记录了一条消息', detail: safeHint(payload) };
}
