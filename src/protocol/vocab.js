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
  agentOptions: 'agent.options',
  agentContext: 'agent.context',
  // agent 的 provider 自己开的一轮（后台任务完成后 agent 接着说话）：
  // drivers/agents/base/providerrun.go。body 是 {task_summary?, text}。
  agentProviderRun: 'agent.provider.run',
  // agent 为自己的某次工具调用在后台跑的活（子 agent、后台命令）的一步：
  // drivers/agents/base/subtask.go。parent_id 是那次调用所服务的请求。
  // body 是 {call_id, task_id?, phase, kind?, title?, text?}。
  agentTask: 'agent.task',

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
  // 请这块屏弹一张按 JSON Schema 画的表单。secret 字段的值由客户端自己写进
  // global/<name>，回复里只有掩码——值恒不进账本。
  uiForm: 'ui.form',
  // 列出这个人此刻连着的屏。由服务端的 human cell 从会话目录直接答，不问任何
  // 一块屏，所以它不在 CLIENT_UI_WORDS 里。
  uiSessionList: 'ui.session.list',

  // 平台叙事事件（kind=event，visibility=system）。
  narration: Object.freeze({
    memberCreated: 'system.member.created',
    memberDeleted: 'system.member.deleted',
    channelInbound: 'system.channel.inbound',
    memberUpdated: 'system.member.updated',
    serviceUpdated: 'system.service.updated',
    // 构建记录：运行时把写下的描述和配置变成在跑的东西，每次尝试两条事件。
    buildStarted: 'system.build.started',
    buildFinished: 'system.build.finished',
  }),

  // 频道面：由本频道的 system actor 直接受理。
  member: Object.freeze({
    create: 'system.member.create',
    admit: 'system.member.admit',
    list: 'system.member.list',
    get: 'system.member.get',
    remove: 'system.member.delete',
    restart: 'system.member.restart',
    // 改一个成员在频道描述里的条目：body（class 或 名字@版本）、params（RFC 7396
    // 合并补丁）、requires。system actor 把它（和 create、delete、service.set）
    // 转交 c0 的 registrar，由它写描述。
    set: 'system.member.set',
    // 这一台的配置（本频道库里）：desired_host 和 values（合并补丁）。
    configGet: 'system.member.config.get',
    configSet: 'system.member.config.set',
    // 破窗恢复：给频道内所有干活的成员（agent/tool）换一届任期。不删任何东西。
    restartAll: 'system.member.restart_all',
  }),
  log: Object.freeze({ recent: 'system.log.recent', query: 'system.log.query' }),

  // 空间面：同样发给 system actor，由它转交 c0 的 registrar。
  channel: Object.freeze({
    create: 'system.channel.create',
    get: 'system.channel.get',
    list: 'system.channel.list',
    set: 'system.channel.set',
    remove: 'system.channel.delete',
  }),
  channelDevice: Object.freeze({ list: 'system.channel.device.list' }),
  // 频道描述（c0 里的那份文档）：成员条目、服务、说明、外挂设备。频道内的
  // member.create/set/delete 和 channel.set、device.attach/detach 都是在改它。
  channelDescription: Object.freeze({ get: 'system.channel.description.get' }),
  // Actor 描述：不可变的 名字@版本。新建同名 = 下一个版本；退役只让它不能再被新
  // 成员引用，已经引用它的成员照旧。
  actorDescription: Object.freeze({
    create: 'system.actor.description.create',
    get: 'system.actor.description.get',
    list: 'system.actor.description.list',
    retire: 'system.actor.description.retire',
  }),
  classes: Object.freeze({ list: 'system.class.list' }),
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

// 由**客户端**受理的 ui.* 词（platform/subjectgate IsUIWord）。客户端按请求里点名的
// session 判断是不是这块屏；ui.session.list 由服务端答，不在其中。
export const CLIENT_UI_WORDS = Object.freeze([
  TYPES.uiState,
  TYPES.uiNavigate,
  TYPES.uiOpen,
  TYPES.uiForm,
]);

// platform/internal/humancell 只认这两个 resolve 决定词。
export const DECISIONS = Object.freeze({ approve: 'approve', reject: 'reject' });

// 频道内唯一的不动面：system actor。频道面的词它自己答，空间面的词它转交
// c0 的 registrar，所以客户端只需要认识这一个收件人。
export const SYSTEM_ACTOR_ID = 'system';

// 平台自己建的频道（platform/channelspec/wellknown.go）：空间根 c0、登录用的大厅，
// 以及放所有人 home 频道的 c0.home。它们没有频道描述，所以不能被复制
// （lagoon.SystemChannel）。
export const ROOT_CHANNEL_ID = 'c0';
export const LOBBY_CHANNEL_ID = 'c0.lobby';
export const HOME_PARENT_CHANNEL_ID = 'c0.home';

export function isPlatformChannel(id) {
  return id === ROOT_CHANNEL_ID || id === LOBBY_CHANNEL_ID || id === HOME_PARENT_CHANNEL_ID;
}

// 节点自己的设备：除大厅外每个频道都有它，文件和成员默认都在它上面，不需要
// 任何设置。
export const LOCAL_DEVICE_ID = 'local-device';

// member.list / OBS 名册里 body 的这个值说：成员是运行时自己生成的（服务门、
// peer、handle），没有描述条目。
export const GENERATED_BODY = 'generated';

// 叙事的判据是 visibility，不是词的前缀：system.* 里既有 visibility=system 的
// 事件，也有 visibility=public 的治理请求/回复——后者是正经的 turn。
export const isNarrationEnvelope = (envelope) => envelope?.visibility === 'system';

export const isSystemWord = (type = '') => type.startsWith('system.');

// An operation is a member working the channel's machinery — asking the system
// door (log, members, timers), describing an actor — not talking to anyone.
// It is part of how a turn got its answer, never a message of its own.
export const isOperationCall = (envelope) => {
  const type = String(envelope?.type || '');
  const audience = Array.isArray(envelope?.audience) ? envelope.audience : [];
  return isSystemWord(type) || type === TYPES.describe
    || (audience.length > 0 && audience.every((id) => id === SYSTEM_ACTOR_ID));
};

// A conversation call is one member addressing another who answers in words:
// an agent or a person (and an agent in another channel, reached through its
// peer door with an ask). Calling a tool or working the machinery is process.
export const isConversationCall = (envelope) => {
  if (isOperationCall(envelope)) return false;
  const audience = Array.isArray(envelope?.audience) ? envelope.audience : [];
  return audience.some((id) => {
    const kind = String(id || '').split(':')[0];
    return kind === 'agent' || kind === 'human' || (kind === 'peer' && envelope?.type === TYPES.agentAsk);
  });
};
