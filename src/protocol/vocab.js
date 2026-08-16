export const TYPES = Object.freeze({
  // TODO(P1): coagent 把 agent.text 纳入 base 闭集后改回 agent.text；只改本处
  agentText: 'human.text',
  agentSteer: 'agent.steer',
  agentInterrupt: 'agent.interrupt',
  agentStop: 'agent.stop',
  humanMessage: 'human.message',
  humanApprove: 'human.approve',
  activity: Object.freeze({
    turnStarted: 'activity.turn.started',
    turnEnded: 'activity.turn.ended',
    toolStarted: 'activity.tool.started',
    toolEnded: 'activity.tool.ended',
  }),
  system: Object.freeze({
    registered: 'system.actor.registered',
    deregistered: 'system.actor.deregistered',
    forked: 'system.actor.forked',
    ended: 'system.actor.ended',
  }),
  sysactor: Object.freeze({
    introduce: 'channel.introduce_actor',
    remove: 'channel.remove_actor',
    restart: 'channel.restart_actor',
  }),
  registrar: Object.freeze({
    channelCreate: 'channel.create',
    channelList: 'channel.list',
  }),
  describe: 'actor.describe',
});

// platform/internal/humancell accepts these exact resolve-frame words.
export const DECISIONS = Object.freeze({ approve: 'approved', reject: 'rejected' });

// platform/home/opentry.go strictly decodes this field set. Agent/tool use
// kind+decl_id; an optional principal is legal for agent and forbidden for tool.
export const INTRODUCE_FIELDS = Object.freeze(['kind', 'decl_id', 'principal']);

export const SYSTEM_ACTOR_ID = 'system';
export const REGISTRAR_DECL_ID = 'atoll-internal:registrar-seat';

export const isActivity = (type = '') => type.startsWith('activity.');
export const isSystemNarration = (type = '') => type.startsWith('system.');
