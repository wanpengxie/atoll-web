const BASE_CHANNELS = Object.freeze([
  { id: 'c0', name: 'home', qualified_name: 'c0', parent_id: '', internal: false, open: true, status: 'present' },
  { id: 'c0.project', name: 'project', qualified_name: 'c0.project', parent_id: 'c0', internal: false, open: true, status: 'present' },
  { id: 'c0.public', name: 'public', qualified_name: 'c0.public', parent_id: 'c0', internal: false, open: true, status: 'present' },
  { id: 'c0.lobby', name: 'lobby', qualified_name: 'c0.lobby', parent_id: 'c0', internal: true, open: true, status: 'present' },
]);

const DEMO_FILES = Object.freeze([
  { channel_id: 'c0', path: '欢迎使用 Atoll.md', media_type: 'text/markdown', content: '# Atoll 文件区\n\n这里是 root 频道的默认挂载目录。' },
  { channel_id: 'c0', path: 'workspace/README.md', media_type: 'text/markdown', content: '# Workspace\n\n频道文件会按目录组织，并可附加到消息。' },
  { channel_id: 'c0.project', path: '项目说明.md', media_type: 'text/markdown', content: '# Project\n\n这是 c0.project 的演示文件。' },
  { channel_id: 'c0.project', path: 'docs/交互设计.md', media_type: 'text/markdown', content: '# 交互设计\n\n动态、文件、任务是频道的三个主工作区。' },
  { channel_id: 'c0.project', path: 'reports/F6-验收记录.txt', media_type: 'text/plain', content: 'F6：视觉、响应式、性能、无障碍和真实后端 smoke 已收口。' },
  { channel_id: 'c0.project', path: 'data/demo.json', media_type: 'application/json', content: '{\n  "channel": "c0.project",\n  "source": "mock daemon"\n}\n' },
  { channel_id: 'c0.public', path: '共享说明.md', media_type: 'text/markdown', content: '# Public\n\n这是可发现频道的共享目录示例。' },
]);

const member = (channelId, actorId = 'root', role = 'owner') => ({
  principal_id: 'root',
  channel_id: channelId,
  actor_id: actorId,
  role,
  status: 'active',
});

const standard = (overrides = {}) => ({
  clock: 1_723_974_400_000,
  seed: 17,
  channels: BASE_CHANNELS,
  memberships: [member('c0'), member('c0.project', 'root-project', 'member')],
  history: true,
  approval: false,
  delays: { receipt_ms: 0, feed_ms: 0, obs_ms: 0 },
  scheduled: [],
  ...overrides,
});

export const SCENARIOS = Object.freeze({
  'first-login': standard({ memberships: [], history: false }),
  'multi-channel': standard({ files: DEMO_FILES, behavior: { demo_attachments: true } }),
  'message-flow': standard({ history: false }),
  approval: standard({ approval: true }),
  'network-drop': standard(),
  'permission-revoked': standard({ scheduled: [{ at_ms: 5_000, type: 'revoke_membership', channel_id: 'c0.project' }] }),
  'channel-retired': standard({ scheduled: [{ at_ms: 5_000, type: 'retire_channel', channel_id: 'c0.project' }] }),
  'projection-delay': standard({ delays: { receipt_ms: 50, feed_ms: 500, obs_ms: 1_000 } }),
  'actor-capability': standard({ behavior: { seed_actor_describe: true, capabilities: true } }),
  'task-capability': standard({ behavior: { seed_actor_describe: true, capabilities: true, task_capability: true } }),
  'channel-governance': standard(),
  'channel-governance-delay': standard({ delays: { receipt_ms: 0, feed_ms: 0, obs_ms: 700 } }),
  'channel-governance-denied': standard({ behavior: { governance_denied: true } }),
  'actor-governance': standard(),
  'space-governance': standard(),
  'space-administration': standard(),
  'space-administration-denied': standard({ behavior: { governance_denied: true } }),
  'device-governance': standard(),
  'resource-workflow': standard(),
  'resource-ticket-expired': standard(),
  'scheduled-action': standard(),
  'scheduled-action-denied': standard({ memberships: [] }),
  'message-structured-success': standard({ history: false, behavior: { message: 'structured' } }),
  'message-empty-success': standard({ history: false, behavior: { message: 'empty' } }),
  'message-failed': standard({ history: false, behavior: { message: 'failed' } }),
  'business-provisional': standard({ history: false, behavior: { message: 'business-provisional' } }),
  'provisional-after-terminal': standard({ history: false, behavior: { message: 'provisional-after-terminal' } }),
  'terminal-conflict': standard({ history: false, behavior: { message: 'terminal-conflict' } }),
  'receipt-delayed': standard({ history: false, delays: { receipt_ms: 800, feed_ms: 0, obs_ms: 0 } }),
  'feed-delayed': standard({ history: false, delays: { receipt_ms: 0, feed_ms: 800, obs_ms: 0 } }),
  'receipt-lost-feed-landed': standard({ history: false, delays: { receipt_ms: 1_500, feed_ms: 0, obs_ms: 0 }, behavior: { drop_receipt: true } }),
  'obs-partial': standard({ obs_complete: false }),
  'real-backend-shape': standard({ behavior: { membership_extension: false, roster_principal: false } }),
  'long-running': standard({ history: false, behavior: { capabilities: true, message: 'long-running' } }),
  'control-conflict': standard({ history: false, behavior: { capabilities: true, message: 'long-running' } }),
  'actor-lifecycle': standard({ history: false, behavior: { capabilities: true } }),
  'approval-schema': standard({ behavior: { approval_schema: true } }),
  'approval-expired': standard({ behavior: { approval_expired: true } }),
  'approval-conflict': standard({ behavior: { approval_schema: true } }),
});

export const scenarioIds = () => Object.keys(SCENARIOS);

export function loadScenario(id = 'multi-channel', seed) {
  const source = SCENARIOS[id];
  if (!source) throw new RangeError(`unknown mock scenario: ${id}`);
  const value = structuredClone(source);
  value.id = id;
  if (seed != null) {
    const parsed = Number(seed);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError('mock seed must be a non-negative safe integer');
    value.seed = parsed;
  }
  return value;
}
