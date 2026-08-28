import { TYPES } from '../protocol/vocab.js';
import { actorDisplayName } from './actor-display.js';

function measure(actual, name) {
  return actual?.measures?.find((item) => item.name === name);
}

function project(item) {
  const declared = item.declared || {};
  const id = declared.id || item.key;
  const bound = measure(item.actual, 'bound');
  const device = measure(item.actual, 'device_online');
  return {
    id,
    kind: declared.kind,
    name: actorDisplayName({ id, name: declared.name }),
    decl_id: declared.decl_id || '',
    description: declared.description || '',
    principal: declared.principal || '',
    bound: bound?.unknown ? null : Boolean(bound?.value),
    deviceOnline: device?.unknown ? null : Boolean(device?.value),
  };
}

const ROSTER_MUTATION_WORDS = new Set([
  TYPES.member.create,
  TYPES.member.admit,
  TYPES.member.remove,
  TYPES.member.restart,
]);

// 浏览器可见 feed 会过滤 visibility=system 的叙事事件，所以真实客户端不能
// 只等 system.member.created/deleted。成员治理的公开 completed 终态同样是权威
// 失效信号：收到后重取 Actor OBS，不从响应 payload 拼装名册。
export function invalidatesRoster(envelope) {
  if ([TYPES.narration.memberCreated, TYPES.narration.memberDeleted].includes(envelope?.type)) return true;
  return envelope?.kind === 'response'
    && ROSTER_MUTATION_WORDS.has(envelope?.type)
    && envelope?.payload?.status === 'completed';
}

export function createRoster({ obs, me = '', debounceMs = 500 } = {}) {
  const cache = new Map();
  const pendingSubmissions = new Map();
  const timers = new Map();
  // self 是活状态读数（我在此频道以哪个 actor 身份行动），恒只活在内存：
  // 页面刷新即重学（obs principal 对账 / attach 回执 actor_id / feed 对账），
  // 恒不落 localStorage——持久化只会让上一个生命期的旧身份还魂。
  const selves = new Map();

  function savedSelf(channelId) {
    return selves.get(channelId) || '';
  }

  function saveSelf(channelId, actorId) {
    if (channelId && actorId) selves.set(channelId, actorId);
  }

  async function refresh(channelId) {
    const observation = await obs.channelActors(channelId);
    const rows = (observation.items || []).map(project);
    cache.set(channelId, rows);
    const principalMatch = me
      ? rows.find((row) => row.kind === 'human' && row.principal === me)
      : undefined;
    if (principalMatch) saveSelf(channelId, principalMatch.id);
    return rows;
  }

  return {
    refresh,
    get(channelId) {
      return cache.get(channelId) || [];
    },
    async ensure(channelId) {
      return cache.has(channelId) ? cache.get(channelId) : refresh(channelId);
    },
    self(channelId) {
      const principalMatch = me
        ? (cache.get(channelId) || []).find((row) => row.kind === 'human' && row.principal === me)
        : undefined;
      return principalMatch?.id || savedSelf(channelId);
    },
    candidates(channelId) {
      const selfId = this.self(channelId);
      return (cache.get(channelId) || []).filter((row) => !selfId || row.id !== selfId);
    },
    recordSubmission(channelId, messageId) {
      if (channelId && messageId) pendingSubmissions.set(messageId, channelId);
    },
    observeFeed(channelId, envelope) {
      const expectedChannel = envelope?.id ? pendingSubmissions.get(envelope.id) : '';
      if (expectedChannel === channelId && envelope?.kind === 'request' && envelope?.sender?.kind === 'human' && envelope?.sender?.id) {
        saveSelf(channelId, envelope.sender.id);
        pendingSubmissions.delete(envelope.id);
        return envelope.sender.id;
      }
      return '';
    },
    // noteSelf 记下"我在这个频道是哪个 actor"。
    //
    // attach 回执自带这份清单,是权威来源。在此之前 self() 只有两条路——把那个
    // 频道的 roster 拉下来(只有当前活跃频道会拉),或者你自己在那儿发过言——
    // 所以一个你还没打开、也没说过话的频道里,self() 是空的。
    //
    // 而 fold 用 selfId 判断"这条是不是发给我的":空了就整条丢掉,而且之后没人
    // 再捡回来。人家在别的频道 @ 你一条 human.ask,或者 agent 发一条 ui.* 过来,
    // 都会这样无声消失。既然连上那一刻答案就在手里,就不该等到那两条慢路。
    noteSelf(channelId, actorId) {
      if (!channelId || !actorId) return '';
      if (selves.get(channelId) === actorId) return '';
      saveSelf(channelId, actorId);
      return actorId;
    },
    clearSelf(channelId) {
      selves.delete(channelId);
    },
    handleEnvelope(channelId, envelope, onRefresh) {
      if (!invalidatesRoster(envelope)) return;
      if (timers.has(channelId)) clearTimeout(timers.get(channelId));
      timers.set(channelId, setTimeout(async () => {
        timers.delete(channelId);
        try {
          const rows = await refresh(channelId);
          onRefresh?.(rows);
        } catch (error) {
          onRefresh?.(null, error);
        }
      }, debounceMs));
    },
    close() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
