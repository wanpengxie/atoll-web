// 消息类型闭集。每一条都对齐 coagent 后端的当前定义：
//   agent.*            drivers/agents/base/base.go
//   system.*           protocol/message/system.go
//   human.*            platform/subjectgate/frame.go
//   actor.describe     lib/introspect/introspect.go
export const TYPES = Object.freeze({
  // 人向 agent 提问：agent 基座的标准请求词。
  agentAsk: 'agent.ask',
  // agent 控制词（都由 agent 基座直接受理）。
  agentSteer: 'agent.steer',
  agentQueue: 'agent.queue',
  agentInterrupt: 'agent.interrupt',
  // 请受理方把一条还在等待的活答掉。取消自己的那条走 wire.cancel（调用方自闭
  // 账）；别人的没有那一臂，只能请持有它的 actor 自己回一条。
  agentDismiss: 'agent.dismiss',
  agentHold: 'agent.hold',
  agentUnhold: 'agent.unhold',
  agentReplace: 'agent.replace',
  agentHoldExpired: 'agent.hold_expired',
  agentFork: 'agent.fork',
  agentCompact: 'agent.compact',
  agentNew: 'agent.new',
  agentSelect: 'agent.select',
  agentContext: 'agent.context',

  // 人对人：humancell 的三个词。
  humanMessage: 'human.message',
  humanAsk: 'human.ask',
  humanApprove: 'human.approve',

  // 频道对 UI：由**人的客户端**受理，不是人。实验性（见 DEV_BACKLOG 附录 A）。
  // 与 human.* 分族是刻意的：human.* 等的是有人来读（分钟/小时/永不），
  // ui.* 等的是一个标签页（毫秒，或者页面根本不在）。混成一族，调用方就
  // 分不清"还没人看"和"没有屏幕"。
  uiState: 'ui.state',
  uiNavigate: 'ui.navigate',
  uiOpen: 'ui.open',

  // 平台叙事事件（kind=event，visibility=system）。
  narration: Object.freeze({
    memberCreated: 'system.member.created',
    memberDeleted: 'system.member.deleted',
    channelInbound: 'system.channel.inbound',
  }),

  // 频道面：由本频道的 system actor 直接受理。
  member: Object.freeze({
    create: 'system.member.create',
    admit: 'system.member.admit',
    list: 'system.member.list',
    get: 'system.member.get',
    remove: 'system.member.delete',
    restart: 'system.member.restart',
    // 破窗恢复：给频道内所有干活的成员（agent/tool）换一届任期。不删任何东西。
    restartAll: 'system.member.restart_all',
  }),
  log: Object.freeze({ recent: 'system.log.recent' }),

  // 空间面：同样发给 system actor，由它转交 c0 的 registrar。
  channel: Object.freeze({
    create: 'system.channel.create',
    get: 'system.channel.get',
    list: 'system.channel.list',
    set: 'system.channel.set',
    remove: 'system.channel.delete',
  }),
  channelDevice: Object.freeze({ list: 'system.channel.device.list' }),
  channelTemplate: Object.freeze({
    create: 'system.channel.template.create',
    get: 'system.channel.template.get',
    list: 'system.channel.template.list',
    set: 'system.channel.template.set',
    remove: 'system.channel.template.delete',
  }),
  actorTemplate: Object.freeze({
    create: 'system.actor.template.create',
    get: 'system.actor.template.get',
    list: 'system.actor.template.list',
    set: 'system.actor.template.set',
    remove: 'system.actor.template.delete',
  }),
  actorOverlay: Object.freeze({
    set: 'system.actor.overlay.set',
    clear: 'system.actor.overlay.delete',
  }),
  principal: Object.freeze({
    create: 'system.principal.create',
    login: 'system.principal.login',
    remove: 'system.principal.delete',
    get: 'system.principal.get',
    list: 'system.principal.list',
  }),
  credential: Object.freeze({ set: 'system.credential.set' }),
  device: Object.freeze({
    create: 'system.device.create',
    attach: 'system.device.attach',
    detach: 'system.device.detach',
    list: 'system.device.list',
    remove: 'system.device.delete',
  }),

  describe: 'actor.describe',
});

// platform/internal/humancell 只认这两个 resolve 决定词。
export const DECISIONS = Object.freeze({ approve: 'approve', reject: 'reject' });

// 频道内唯一的不动面：system actor。频道面的词它自己答，空间面的词它转交
// c0 的 registrar，所以客户端只需要认识这一个收件人。
export const SYSTEM_ACTOR_ID = 'system';

// 由 genesis 铸出、不可由人增删的声明 id（platform/lagoon/contracts.go）。
export const SYSTEM_DECL_IDS = Object.freeze(['registrar', 'svcactor']);

// 叙事的判据是 visibility，不是词的前缀：system.* 里既有 visibility=system 的
// 事件，也有 visibility=public 的治理请求/回复——后者是正经的 turn。
export const isNarrationEnvelope = (envelope) => envelope?.visibility === 'system';

export const isSystemWord = (type = '') => type.startsWith('system.');
