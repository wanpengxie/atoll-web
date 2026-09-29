import { createHash } from 'node:crypto';

const ROOT_ID = 'root';
const STAMP = 1_723_974_400_000;

// 全局 key：空间范围的 kv 命名空间，任何频道的资源面都认 global/ 前缀并落到同一份。
const GLOBAL_PREFIX = 'global/';
const GLOBAL_NAME = /^[a-z0-9_-]{1,64}$/;
const GLOBAL_REFERENCE = '$global.';

// 成员可用的 class：它造出什么 kind 的成员、默认配置、以及它拒绝什么配置。
// member.set 换 class 不许换 kind；配置被 class 拒绝时业务层卡住。
const MOCK_CLASSES = Object.freeze({
  codex: { kind: 'agent', defaults: { model: 'gpt-5.6-sol', effort: 'medium' } },
  'codex-agent': { kind: 'agent', defaults: { model: 'gpt-5.4', effort: 'light' } },
  claude: { kind: 'agent', defaults: { model: 'claude-opus', effort: 'medium' } },
  'deepseek-agent': {
    kind: 'agent',
    defaults: { model: 'deepseek-chat', base_url: 'https://api.deepseek.com', temperature: 0.7 },
    refuse: (config) => {
      if (config.temperature != null && (typeof config.temperature !== 'number' || config.temperature < 0 || config.temperature > 2)) return 'temperature must be a number between 0 and 2';
      if (config.model != null && !['deepseek-chat', 'deepseek-reasoner'].includes(config.model)) return `unknown model ${JSON.stringify(config.model)}; deepseek-agent accepts deepseek-chat or deepseek-reasoner`;
      return '';
    },
  },
  'mcp-tool': {
    kind: 'tool',
    defaults: { endpoint: 'http://127.0.0.1:9000/mcp' },
    refuse: (config) => (config.endpoint != null && typeof config.endpoint !== 'string' ? 'endpoint must be a string' : ''),
  },
});

export function measure(name, value, observedAt) {
  return { name, value, unknown: false, observed_at: observedAt, since: null };
}

export function item(declared, measures = null, key = declared.id) {
  return { ...(key ? { key } : {}), declared, actual: measures == null ? null : { measures } };
}

export function observation(subject, kind, items, complete = true, extra = {}) {
  return { subject, kind, complete, items, ...extra };
}

function layerMeasure(name, layer, observedAt) {
  if (!layer?.state) return { name, value: null, unknown: true, reason: 'no_testimony', observed_at: observedAt, since: null };
  return {
    name,
    value: layer.state,
    unknown: false,
    ...(layer.reason ? { reason: layer.reason } : {}),
    observed_at: observedAt,
    since: layer.since > 0 ? layer.since : null,
  };
}

// 两层状态随名册行一起出（与真后端 OBS 同形：standard/business 两个 measure，
// value 是状态字符串，reason 说为什么没就绪，since 是进入这个状态的时刻）。
// 干活的成员默认两层都就绪；人没有证词。
export function defaultLayers(kind) {
  return kind === 'human' ? null : { standard: { state: 'ready' }, business: { state: 'ready' } };
}

export function setRosterLayers(row, layers, observedAt = STAMP) {
  const measures = (row.actual?.measures || []).filter((entry) => entry.name !== 'standard' && entry.name !== 'business');
  measures.push(layerMeasure('standard', layers?.standard, observedAt), layerMeasure('business', layers?.business, observedAt));
  measures.sort((left, right) => left.name.localeCompare(right.name));
  row.actual = { ...(row.actual || {}), measures };
  return row;
}

// 名册行上的两层读回 member.list / member.get 的形状：{state, reason?, since_ms?}。
// 事实只有一处（行上的 measure），不另存一份。
export function rowLayer(row, name) {
  const measure = row?.actual?.measures?.find((entry) => entry.name === name);
  if (!measure || measure.unknown || typeof measure.value !== 'string') return undefined;
  return { state: measure.value, ...(measure.reason ? { reason: measure.reason } : {}), ...(measure.since > 0 ? { since_ms: measure.since } : {}) };
}

export function rosterItem({ id, kind, declId = '', name = id, description = '', principal = '', bound = true, online = null, layers = defaultLayers(kind) }, observedAt = STAMP) {
  const declared = {
    id,
    kind,
    ...(declId ? { decl_id: declId } : {}),
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(principal ? { principal } : {}),
  };
  const measures = [measure('bound', bound, observedAt)];
  if (online == null) {
    measures.push({ name: 'device_online', value: null, unknown: true, reason: 'no_testimony', observed_at: observedAt, since: null });
  } else {
    measures.push(measure('device_online', online, observedAt));
  }
  measures.sort((left, right) => left.name.localeCompare(right.name));
  return setRosterLayers(item(declared, measures), layers, observedAt);
}

export function envelope({ id, channelId, sender, kind, type, payload = {}, parentId = '', correlationId = '', visibility = 'public', audience = [], ts }) {
  return {
    id,
    ts,
    channel_id: channelId,
    sender,
    kind,
    type,
    payload,
    ...(parentId ? { parent_id: parentId } : {}),
    ...(correlationId ? { correlation_id: correlationId } : {}),
    visibility,
    audience,
  };
}

function createRoster(channel, memberships, clock, { seedBusiness = true, canonicalActorIds = false } = {}) {
  // 与真实后端一致：每个频道都有 system 与 svcactor(peer)，registrar 只在 c0。
  const rows = [
    rosterItem({ id: 'system', kind: 'system', name: 'system', description: 'Channel system actor' }, clock),
    rosterItem({ id: 'svcactor', kind: 'peer', declId: 'svcactor', name: 'Service Actor', description: 'Service actor' }, clock),
  ];
  if (channel.id === 'c0') {
    rows.push(rosterItem({ id: 'registrar', kind: 'system', declId: 'registrar', name: 'Registrar Seat', description: 'Registrar seat' }, clock));
  }
	if (!channel.internal && seedBusiness) {
		const businessActorId = channel.id === 'c0'
			? canonicalActorIds ? 'agent:steward:test' : 'steward'
			: canonicalActorIds ? `agent:${channel.name}:test` : `${channel.name}-agent`;
		rows.push(rosterItem({ id: businessActorId, kind: 'agent', declId: 'mock:steward', name: channel.id === 'c0' ? 'steward' : `${channel.name}-agent`, description: 'Mock collaboration agent' }, clock));
    if (channel.id === 'c0') rows.push(rosterItem({ id: 'claude', kind: 'agent', declId: 'mock:claude', name: 'Claude', description: 'Mock Claude collaboration agent' }, clock));
  }
  for (const membership of memberships.filter((entry) => entry.channel_id === channel.id && entry.status === 'active')) {
    rows.push(rosterItem({ id: membership.actor_id, kind: 'human', name: membership.principal_id, principal: membership.principal_id, online: true, description: 'Human channel member' }, clock));
  }
  return rows;
}

export class MockDomain {
  constructor(config) {
    this.reset(config);
  }

  reset(config) {
    this.scenario = config.id;
    this.seed = config.seed;
    this.clock = config.clock;
    this.counter = 0;
    this.channels = new Map(config.channels.map((channel) => [channel.id, structuredClone(channel)]));
    this.memberships = structuredClone(config.memberships);
    this.humanPrincipals = new Set([ROOT_ID, 'alice', 'bob']);
    this.rosters = new Map([...this.channels.values()].map((channel) => [channel.id, createRoster(channel, this.memberships, this.clock, {
      canonicalActorIds: config.behavior?.canonical_actor_ids === true,
    })]));
    this.histories = new Map([...this.channels.keys()].map((channelId) => [channelId, []]));
    this.scheduled = structuredClone(config.scheduled || []);
    this.delays = structuredClone(config.delays || {});
    this.behavior = structuredClone(config.behavior || {});
    this.obsComplete = config.obs_complete !== false;
    this.faults = [];
    const stamp = STAMP;
    this.declarations = new Map([
      ['mock:steward', { id: 'mock:steward', name: 'Steward', description: 'Mock steward declaration', owner: ROOT_ID, class: 'codex', default_class: 'codex', config: {}, status: 'present', visibility: 'private', created_at: stamp, updated_at: stamp }],
      ['mock:claude', { id: 'mock:claude', name: 'Claude', description: 'Mock Claude agent declaration', owner: ROOT_ID, class: 'claude', default_class: 'claude', kind: 'agent', config: {}, status: 'present', visibility: 'private', created_at: stamp, updated_at: stamp }],
      ['mock:analyst', { id: 'mock:analyst', name: 'Analyst Agent', description: 'Mock agent declaration', owner: ROOT_ID, class: 'codex-agent', default_class: 'codex-agent', kind: 'agent', config: {}, status: 'present', visibility: 'private', created_at: stamp, updated_at: stamp }],
      ['mock:search', { id: 'mock:search', name: 'Search Tool', description: 'Mock tool declaration', owner: ROOT_ID, class: 'mcp-tool', default_class: 'mcp-tool', kind: 'tool', config: {}, status: 'present', visibility: 'private', created_at: stamp, updated_at: stamp }],
      ['registrar', { id: 'registrar', name: 'Registrar Seat', owner: ROOT_ID, class: 'registrar', default_class: 'registrar', status: 'present', visibility: 'private', created_at: stamp, updated_at: stamp }],
      ['svcactor', { id: 'svcactor', name: 'Service Actor', owner: ROOT_ID, class: 'svcactor', default_class: 'svcactor', status: 'present', visibility: 'private', created_at: stamp, updated_at: stamp }],
    ]);
    this.channelTemplates = new Map([
      ['mock:team', { id: 'mock:team', name: 'Team channel', description: 'Mock team template', visibility: 'private', body: { declarations: [{ decl_id: 'mock:steward' }], profile: { default_storage_device_id: 'local-device' } }, status: 'present' }],
    ]);
    this.profiles = new Map([...this.channels.values()].map((channel) => [channel.id, { channel_id: channel.id, description: channel.description || '', serving: channel.open ? 1 : 0, default_storage_device_id: 'local-device', endpoints: {} }]));
    // Device id is authority/routing identity; its canonical name spells the
    // human-readable daemon:// namespace.
    this.devices = new Map([['local-device', { id: 'local-device', owner_principal: ROOT_ID, name: 'local-device', status: 'present', online: true, key: 'mock-device-key-never-observed' }]]);
    this.bindings = new Set([...this.channels.keys()].map((channelId) => `${channelId}:local-device`));
    this.resources = new Map([...this.channels.keys()].map((id) => [id, new Map()]));
    this.files = new Map();
    for (const [index, seed] of (config.files || []).entries()) {
      const channel = this.channels.get(seed.channel_id);
      const store = this.resources.get(seed.channel_id);
      const segments = String(seed.path || '').split('/').filter(Boolean);
      if (!channel || !store || segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) continue;
      const encodedPath = segments.map((segment) => encodeURIComponent(segment)).join('/');
      const address = `daemon://local-device/${channel.qualified_name || channel.name || channel.id}/${encodedPath}`;
      const content = Buffer.from(String(seed.content || ''), 'utf8');
      const mediaType = seed.media_type || 'application/octet-stream';
      const resourceId = `file:seed:${seed.channel_id}:${index + 1}`;
      for (let depth = 1; depth < segments.length; depth += 1) {
        const directoryAddress = `daemon://local-device/${channel.qualified_name || channel.name || channel.id}/${segments.slice(0, depth).map((segment) => encodeURIComponent(segment)).join('/')}`;
        if (![...store.values()].some((row) => row.address === directoryAddress)) {
          const directoryId = `file:directory:${seed.channel_id}:${segments.slice(0, depth).join(':')}`;
          store.set(directoryId, { id: directoryId, resource_id: directoryId, kind: 'file', address: directoryAddress, meta: { node_type: 'directory' } });
        }
      }
      store.set(resourceId, { id: resourceId, resource_id: resourceId, kind: 'file', address, meta: { node_type: 'regular', size: content.length, media_type: mediaType, available: true } });
      this.files.set(address, { content, mediaType, size: content.length });
    }
    this.tickets = new Map();
    // 全局 key 是空间的，不属于任何频道：id → {value, created_by, created_at}。
    this.globals = new Map();
    // 成员的 class 与配置（成员行是权威）：`${channelId}\u0000${actorId}` → {class, config, source, desired_host?}。
    this.memberConfigs = new Map();
    for (const [channelId, rows] of this.rosters) {
      for (const row of rows) {
        const declaration = this.declarations.get(row.declared.decl_id || '');
        if (!declaration || !['agent', 'tool'].includes(row.declared.kind)) continue;
        this.memberConfigs.set(this.memberKey(channelId, row.declared.id), {
          class: declaration.default_class || declaration.class,
          config: structuredClone(declaration.config || {}),
          source: { decl_id: declaration.id },
        });
      }
    }
    if (this.behavior.actor_layers_demo) this.seedActorLayersDemo();
  }

  // actor-config 场景：一个因为缺全局 key 而卡住的 agent、一个连不上端点正在重试
  // 的 tool，外加一把已有的全局 key 给编辑器插引用用。
  seedActorLayersDemo() {
    const stamp = STAMP;
    this.declarations.set('mock:deepseek', { id: 'mock:deepseek', name: 'DeepSeek', description: 'Mock DeepSeek agent declaration', owner: ROOT_ID, class: 'deepseek-agent', default_class: 'deepseek-agent', kind: 'agent', config: { model: 'deepseek-chat', api_key: `${GLOBAL_REFERENCE}deepseek_prod` }, status: 'present', visibility: 'private', created_at: stamp, updated_at: stamp });
    this.globals.set(`${GLOBAL_PREFIX}openai_prod`, { value: 'sk-mock-openai-0000', created_by: 'c0/root', created_at: stamp });
    const rows = this.rosters.get('c0');
    if (!rows) return;
    rows.push(rosterItem({ id: 'deepseek', kind: 'agent', declId: 'mock:deepseek', name: 'DeepSeek', description: 'Mock DeepSeek agent' }, this.clock));
    this.memberConfigs.set(this.memberKey('c0', 'deepseek'), {
      class: 'deepseek-agent',
      config: { model: 'deepseek-chat', api_key: `${GLOBAL_REFERENCE}deepseek_prod` },
      source: { decl_id: 'mock:deepseek' },
    });
    rows.push(rosterItem({ id: 'search-tool', kind: 'tool', declId: 'mock:search', name: 'Search Tool', description: 'Mock MCP search tool' }, this.clock));
    this.memberConfigs.set(this.memberKey('c0', 'search-tool'), {
      class: 'mcp-tool',
      config: { endpoint: 'http://127.0.0.1:9000/mcp' },
      source: { decl_id: 'mock:search' },
      desired_host: 'local-device',
    });
    this.evaluateMember('c0', 'deepseek');
    this.evaluateMember('c0', 'search-tool');
  }

  memberKey(channelId, actorId) {
    return `${channelId}\u0000${actorId}`;
  }

  memberRow(channelId, actorId) {
    return (this.rosters.get(channelId) || []).find((entry) => entry.declared.id === actorId) || null;
  }

  // 业务层是配置的函数：引用的全局 key 缺了 → stuck；class 拒绝配置 → stuck；
  // tool 的端点还指着那个死端口 → retrying；否则 ready。标准层恒就绪。
  businessOf(record) {
    const effective = { ...(MOCK_CLASSES[record.class]?.defaults || {}), ...record.config };
    for (const name of globalReferences(effective)) {
      if (!this.globals.has(`${GLOBAL_PREFIX}${name}`)) return { state: 'stuck', reason: `missing global resource ${GLOBAL_PREFIX}${name}` };
    }
    const refused = MOCK_CLASSES[record.class]?.refuse?.(effective) || '';
    if (refused) return { state: 'stuck', reason: `config refused by ${record.class}: ${refused}` };
    if (record.class === 'mcp-tool' && String(effective.endpoint || '').includes(':9000')) {
      return { state: 'retrying', reason: `dial tcp ${String(effective.endpoint).replace(/^\w+:\/\//, '').split('/')[0]}: connection refused; retry in 8s` };
    }
    return { state: 'ready' };
  }

  evaluateMember(channelId, actorId) {
    const row = this.memberRow(channelId, actorId);
    const record = this.memberConfigs.get(this.memberKey(channelId, actorId));
    if (!row || !record) return null;
    const business = this.businessOf(record);
    setRosterLayers(row, { standard: { state: 'ready' }, business: { ...business, ...(business.state === 'ready' ? {} : { since: this.clock }) } }, this.clock);
    return business;
  }

  // system.member.get：成员事实 + 两层 + class/config/来源（只有干活的成员有后三样）。
  memberInfo(channelId, actorId) {
    const row = this.memberRow(channelId, actorId);
    if (!row) throw new TypeError('member does not exist');
    const standard = rowLayer(row, 'standard');
    const business = rowLayer(row, 'business');
    const record = this.memberConfigs.get(this.memberKey(channelId, actorId));
    return {
      actor_id: row.declared.id,
      member: true,
      present: business ? business.state === 'ready' : true,
      uptime_ms: 60_000,
      ...(standard ? { standard } : {}),
      ...(business ? { business } : {}),
      ...(record ? {
        class: record.class,
        config: structuredClone(record.config),
        source: structuredClone(record.source),
        ...(record.desired_host ? { desired_host: record.desired_host } : {}),
      } : {}),
    };
  }

  // system.member.set：config 是顶层补丁（null = 回 class 默认值，即从存储里去掉
  // 这个键）；换 class 不许换 kind；class 拒绝的配置、引用了不存在的全局 key 都
  // 整条拒绝。dry_run 只回将要存的样子。
  setMember(channelId, { member, class: nextClass, config, dry_run: dryRun } = {}) {
    const row = this.memberRow(channelId, member);
    if (!row) throw new TypeError('member does not exist');
    const kind = row.declared.kind;
    if (!['agent', 'tool'].includes(kind)) {
      const error = new TypeError(`member ${member} is a ${kind}; only agent and tool members have a class and config`);
      error.code = kind === 'system' || kind === 'peer' ? 'protected_actor' : 'invalid_args';
      throw error;
    }
    const current = this.memberConfigs.get(this.memberKey(channelId, member)) || { class: '', config: {}, source: {} };
    if (config != null && (typeof config !== 'object' || Array.isArray(config))) throw new TypeError('config must be an object');
    const className = nextClass == null || nextClass === '' ? current.class : String(nextClass);
    const definition = MOCK_CLASSES[className];
    if (!definition) throw new TypeError(`unknown class ${className}`);
    if (definition.kind !== kind) throw new TypeError(`class ${className} makes a ${definition.kind}; member ${member} is a ${kind}`);
    const stored = structuredClone(current.config || {});
    for (const [key, value] of Object.entries(config || {})) {
      if (value === null) delete stored[key];
      else stored[key] = structuredClone(value);
    }
    const effective = { ...definition.defaults, ...stored };
    const refused = definition.refuse?.(effective) || '';
    if (refused) throw new TypeError(`config refused by ${className}: ${refused}`);
    for (const name of globalReferences(effective)) {
      if (!this.globals.has(`${GLOBAL_PREFIX}${name}`)) throw new TypeError(`missing global resource ${GLOBAL_PREFIX}${name}`);
    }
    const changed = className !== current.class || JSON.stringify(sortKeys(stored)) !== JSON.stringify(sortKeys(current.config || {}));
    if (dryRun) return { member, changed, class: className, config: stored };
    if (changed) {
      this.memberConfigs.set(this.memberKey(channelId, member), { ...current, class: className, config: stored });
      this.evaluateMember(channelId, member);
    }
    return { member, changed, rebuilt: changed };
  }

  now() {
    return this.clock;
  }

  nextId(prefix = 'mock') {
    this.counter += 1;
    return `${prefix}-${this.seed}-${this.counter}`;
  }

  channel(id) {
    return this.channels.get(id) || null;
  }

  activeMembership(principalId, channelId) {
    return this.memberships.find((entry) => entry.principal_id === principalId && entry.channel_id === channelId && entry.status === 'active') || null;
  }

  canRead(principalId, channelId, observed = new Set()) {
    const channel = this.channel(channelId);
    if (!channel || channel.status !== 'present') return false;
    return Boolean(this.activeMembership(principalId, channelId) || observed.has(channelId));
  }

  canWrite(principalId, channelId) {
    const channel = this.channel(channelId);
    return Boolean(channel && channel.status === 'present' && channel.open && this.activeMembership(principalId, channelId));
  }

  channelRow(channel, { withKey = true } = {}) {
    const declared = {
      id: channel.id,
      ...(channel.parent_id ? { parent_id: channel.parent_id } : {}),
      name: channel.name,
      qualified_name: channel.qualified_name,
      type: 'group',
      status: channel.status,
			owner_principal: channel.owner_principal || ROOT_ID,
      description: channel.description || '',
      serving: channel.open ? 1 : 0,
      default_storage_device_id: this.profiles.get(channel.id)?.default_storage_device_id || 'local-device',
      spec: {},
      created_at: STAMP,
    };
    const value = item(declared, [measure('open', channel.open, this.clock)]);
    if (!withKey) delete value.key;
    return value;
  }

  channelRows(parentId) {
    return [...this.channels.values()]
      .filter((channel) => !channel.internal && channel.status === 'present' && (parentId == null ? !channel.parent_id : channel.parent_id === parentId))
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((channel) => this.channelRow(channel));
  }

  // attach 回执携带的成员清单（对齐真后端：网关资格账快照，连上即得）。
  attachMemberships(principalId) {
    return this.memberships
      .filter((entry) => entry.principal_id === principalId && entry.status === 'active')
      .map((entry) => ({ channel_id: entry.channel_id, actor_id: entry.actor_id || '' }))
      .sort((left, right) => left.channel_id.localeCompare(right.channel_id));
  }

  append(channelId, value) {
    const history = this.histories.get(channelId);
    if (!history) return null;
    const row = { channel_id: channelId, seq: history.length + 1, envelope: value };
    history.push(row);
    return row;
  }

  revokeMembership(principalId, channelId) {
    const membership = this.memberships.find((entry) => entry.principal_id === principalId && entry.channel_id === channelId && entry.status === 'active');
    if (!membership) return false;
    membership.status = 'revoked';
    this.rosters.set(channelId, createRoster(this.channel(channelId), this.memberships, this.clock));
    return true;
  }

  grantMembership(principalId, channelId, actorId = '') {
    const channel = this.channel(channelId);
    if (!channel || channel.status !== 'present') throw new TypeError('channel does not exist');
    let membership = this.memberships.find((entry) => entry.principal_id === principalId && entry.channel_id === channelId);
    if (!membership) {
      membership = { principal_id: principalId, channel_id: channelId, actor_id: actorId || `${principalId}-${channel.name}`, role: 'member', status: 'active' };
      this.memberships.push(membership);
    } else {
      membership.status = 'active';
      if (actorId) membership.actor_id = actorId;
    }
    this.rosters.set(channelId, createRoster(channel, this.memberships, this.clock));
    return { ...membership };
  }

  setChannelOpen(channelId, open) {
    const channel = this.channel(channelId);
    if (!channel || channel.status !== 'present') throw new TypeError('channel does not exist');
    channel.open = Boolean(open);
    return { ...channel };
  }

  retireChannel(channelId) {
    const channel = this.channel(channelId);
    if (!channel || channel.status === 'retired') return false;
    channel.status = 'retired';
    channel.open = false;
    return true;
  }

  createChannel(parentId, name, principalId = ROOT_ID, initialActorIds = []) {
    const clean = String(name || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(clean)) throw new TypeError('channel name must use lowercase letters, numbers or hyphens');
    const parent = this.channel(parentId);
    if (!parent || parent.status !== 'present') throw new TypeError('parent channel does not exist');
		if (!Array.isArray(initialActorIds)) throw new TypeError('initial_actor_ids must be an array');
		if (new Set(initialActorIds).size !== initialActorIds.length) throw new TypeError('initial_actor_ids contains duplicates');
		const sourceRows = this.rosters.get(parentId) || [];
		const sourceActors = initialActorIds.map((actorId) => {
			const row = sourceRows.find((entry) => entry.declared.id === actorId);
			if (!row) throw new TypeError(`actor ${actorId} is not an active member of this channel`);
			if (!['human', 'agent', 'tool'].includes(row.declared.kind)) throw new TypeError(`actor ${actorId} is not importable`);
			return row.declared;
		});
    const id = `${parentId}.${clean}`;
    if (this.channels.has(id)) throw new TypeError('channel already exists');
		const channel = { id, name: clean, qualified_name: id, parent_id: parentId, owner_principal: principalId, internal: false, open: true, status: 'present' };
    this.channels.set(id, channel);
		for (const source of sourceActors.filter((entry) => entry.kind === 'human')) {
			this.memberships.push({
				principal_id: source.principal, channel_id: id,
				actor_id: `human:${source.principal}:${this.clock + this.counter + 1}`,
				role: source.principal === principalId ? 'owner' : 'member', status: 'active',
			});
			this.counter += 1;
		}
		const targetRows = createRoster(channel, this.memberships, this.clock, { seedBusiness: false });
		for (const source of sourceActors.filter((entry) => entry.kind !== 'human')) {
			this.counter += 1;
			const actorId = `${source.kind}:${source.name || source.id}:${this.clock + this.counter}`;
			targetRows.push(rosterItem({
				id: actorId, kind: source.kind, declId: source.decl_id || '', name: source.name,
				description: source.description || '', principal: source.principal || '',
			}, this.clock));
		}
    this.rosters.set(id, targetRows);
    this.histories.set(id, []);
    this.profiles.set(id, { channel_id: id, description: '', serving: 1, default_storage_device_id: 'local-device', endpoints: {} });
    this.bindings.add(`${id}:local-device`);
    return { ...channel };
  }

  // system.member.create：只收 decl_id，actor kind 由声明本身决定。
  createMember(channelId, declId) {
    const channel = this.channel(channelId);
    if (!channel || channel.status !== 'present') throw new TypeError('channel does not exist');
    if (!declId) throw new TypeError('decl_id required');
    const declaration = this.declarations.get(declId);
    if (!declaration || declaration.status !== 'present') throw new TypeError('declaration does not exist');
    const kind = declaration.kind || (String(declaration.default_class || '').includes('codex') ? 'agent' : 'tool');
    const id = `${kind}-${this.nextId('actor')}`;
    const rows = this.rosters.get(channelId) || [];
    rows.push(rosterItem({ id, kind, declId, name: declaration.name || id, description: 'Introduced by mock system actor' }, this.clock));
    this.memberConfigs.set(this.memberKey(channelId, id), {
      class: declaration.default_class || declaration.class,
      config: structuredClone(declaration.config || {}),
      source: { decl_id: declId },
    });
    this.evaluateMember(channelId, id);
    return { member: id };
  }

  // system.member.admit：只收 principal。
  admitMember(channelId, principal) {
    const channel = this.channel(channelId);
    if (!channel || channel.status !== 'present') throw new TypeError('channel does not exist');
    if (!principal) throw new TypeError('principal required');
    if (!this.humanPrincipals.has(principal)) throw new TypeError('system.member.admit accepts human principals only');
    const id = `${principal}-${channel.name}`;
    if (!this.activeMembership(principal, channelId)) {
      this.memberships.push({ principal_id: principal, channel_id: channelId, actor_id: id, role: 'member', status: 'active' });
    }
    const rows = this.rosters.get(channelId) || [];
    if (!rows.some((entry) => entry.declared.id === id)) {
      rows.push(rosterItem({ id, kind: 'human', name: principal, principal, description: 'Admitted by mock system actor' }, this.clock));
    }
    return { member: id };
  }

  removeActor(channelId, actorId) {
    if (['system', 'svcactor', 'registrar'].includes(actorId)) {
      const error = new TypeError('protected system actor cannot be removed');
      error.code = 'protected_actor';
      throw error;
    }
    const rows = this.rosters.get(channelId);
    if (!rows) throw new TypeError('channel does not exist');
    const index = rows.findIndex((entry) => entry.declared.id === actorId);
    if (index < 0) throw new TypeError('actor does not exist');
    rows.splice(index, 1);
    const membership = this.memberships.find((entry) => entry.channel_id === channelId && entry.actor_id === actorId && entry.status === 'active');
    if (membership) membership.status = 'revoked';
    return { removed: [actorId] };
  }

  restartActor(channelId, actorId) {
    const row = (this.rosters.get(channelId) || []).find((entry) => entry.declared.id === actorId);
    if (!row) throw new TypeError('actor does not exist');
    if (['system', 'svcactor', 'registrar'].includes(actorId) || String(row.declared.decl_id || '').startsWith('peer:')) {
      const error = new TypeError('protected system actor cannot be restarted');
      error.code = 'protected_actor';
      throw error;
    }
    // 重启 = 按当前配置重建业务层：缺的全局 key 补上了，卡住的成员就起来了。
    this.evaluateMember(channelId, actorId);
    return { member: actorId };
  }

  declarationRows() {
    return [...this.declarations.values()].filter((row) => row.status === 'present').map((row) => item({ ...row }, null));
  }

  registerActorTemplate(spec) {
    if (!spec.id || !spec.name || !spec.class || !spec.visibility) throw new TypeError('id, name, class and visibility are required');
    if (this.declarations.get(spec.id)?.status === 'present') throw new TypeError('actor template already exists');
    const row = { ...structuredClone(spec), owner: ROOT_ID, default_class: spec.class, status: 'present', created_at: this.clock, updated_at: this.clock };
    this.declarations.set(row.id, row);
    return { ...row };
  }

  editActorTemplate(spec) {
    const row = this.declarations.get(spec.id);
    if (!row || row.status !== 'present') throw new TypeError('actor template does not exist');
    Object.assign(row, structuredClone(spec), spec.class ? { default_class: spec.class } : {}, { updated_at: this.clock });
    return { ...row };
  }

  revokeActorTemplate(id) {
    const row = this.declarations.get(id);
    if (!row || row.status !== 'present') throw new TypeError('actor template does not exist');
    if (String(id).startsWith('atoll-internal:') || String(id).startsWith('peer:')) throw new TypeError('protected actor template');
    row.status = 'revoked'; row.updated_at = this.clock;
    return { id, revoked: true };
  }

  registerChannelTemplate(spec) {
    if (!spec.id || !spec.name || !spec.visibility || !spec.body) throw new TypeError('id, name, visibility and body are required');
    if (this.channelTemplates.get(spec.id)?.status === 'present') throw new TypeError('channel template already exists');
    const row = { ...structuredClone(spec), status: 'present' };
    this.channelTemplates.set(row.id, row); return { ...row };
  }

  editChannelTemplate(spec) {
    const row = this.channelTemplates.get(spec.id);
    if (!row || row.status !== 'present') throw new TypeError('channel template does not exist');
    Object.assign(row, structuredClone(spec)); return { ...row };
  }

  revokeChannelTemplate(id) {
    const row = this.channelTemplates.get(id);
    if (!row || row.status !== 'present') throw new TypeError('channel template does not exist');
    row.status = 'revoked'; return { id, revoked: true };
  }

  setProfile(channelId, profile) {
    const channel = this.channel(channelId);
    if (!channel) throw new TypeError('channel does not exist');
    const current = this.profiles.get(channelId) || {};
    const next = { ...current, ...structuredClone(profile) };
    if (!this.bindings.has(`${channelId}:${next.default_storage_device_id}`)) throw new TypeError('default storage device is not attached to channel');
    this.profiles.set(channelId, next);
    channel.description = profile.description; channel.open = profile.serving > 0;
    return structuredClone(next);
  }

  daemonRows() {
    return [...this.devices.values()].filter((row) => row.status === 'present').map((row) => item({ id: row.id, owner_principal: row.owner_principal, name: row.name, status: row.status, created_at: STAMP }, [measure('online', row.online, this.clock)]));
  }

  channelDeviceRows(channelId) {
    const defaultDevice = this.profiles.get(channelId)?.default_storage_device_id || 'local-device';
    return [...this.devices.values()]
      .filter((row) => row.status === 'present' && this.bindings.has(`${channelId}:${row.id}`))
      .map((row) => item({ channel_id: channelId, device_id: row.id, owner_principal: row.owner_principal, name: row.name, status: row.status, attached_at: STAMP, default_storage: row.id === defaultDevice }, [measure('online', row.online, this.clock)]));
  }

  mintDevice(name, claimedId = '') {
    if (!name) throw new TypeError('device name is required');
    const id = claimedId || this.nextId('device');
    if (this.devices.get(id)?.status === 'present') throw new TypeError('device already exists');
    const key = `mock-key-${this.seed}-${this.nextId('secret')}`;
    this.devices.set(id, { id, owner_principal: ROOT_ID, name, status: 'present', online: false, key });
    return { device_id: id, key };
  }

  retireDevice(id) {
    const row = this.devices.get(id); if (!row || row.status !== 'present') throw new TypeError('device does not exist');
    if ([...this.profiles.values()].some((profile) => profile.default_storage_device_id === id)) throw new TypeError('device is still a channel default storage');
    row.status = 'retired'; this.bindings = new Set([...this.bindings].filter((value) => !value.endsWith(`:${id}`)));
    return { device_id: id, retired: true };
  }

  bindDevice(channelId, deviceId, attach) {
    if (!this.channel(channelId) || !this.devices.get(deviceId) || this.devices.get(deviceId).status !== 'present') throw new TypeError('channel or device does not exist');
    const key = `${channelId}:${deviceId}`;
    if (attach) this.bindings.add(key);
    else {
      if (this.profiles.get(channelId)?.default_storage_device_id === deviceId) throw new TypeError('device is this channel default storage');
      this.bindings.delete(key);
    }
    return { channel_id: channelId, device_id: deviceId, attached: attach };
  }

  // global/ 不是这个频道的：任何频道的资源面都落到同一份空间存储。只有 kv；
  // 名字必须满足 [a-z0-9_-]{1,64}，和 $global.<name> 引用能写的一样。
  globalResource(channelId, payload) {
    const { op, resource_id: id, args } = payload;
    const creator = `${channelId}/${this.activeMembership(ROOT_ID, channelId)?.actor_id || ROOT_ID}`;
    if (op === 'list') {
      const prefix = String(payload.query?.prefix || GLOBAL_PREFIX);
      const items = [...this.globals.keys()].filter((key) => key.startsWith(prefix)).sort()
        .map((key) => ({ id: key, kind: 'kv', ops: ['read', 'write', 'delete'], meta: {} }));
      return { items, next: null };
    }
    const name = String(id || '').slice(GLOBAL_PREFIX.length);
    if (op === 'create') {
      if (payload.address) throw new TypeError('global resources are kv only');
      if (!GLOBAL_NAME.test(name)) throw new TypeError('a global resource is named global/<name>, name matching [a-z0-9_-]{1,64}');
      // 资源门的拒绝是一张 status:"rejected" 的回执，不是错误帧。
      if (this.globals.has(id)) return { status: 'rejected', resource_id: id, detail: 'already_exists' };
      this.globals.set(id, { value: structuredClone(args ?? null), created_by: creator, created_at: this.clock });
      return { status: 'ok', resource_id: id };
    }
    const row = this.globals.get(id);
    if (op === 'stat') return { exists: Boolean(row), ...(row ? { meta: { kind: 'kv', created_at: row.created_at, created_by: row.created_by } } : {}) };
    if (!row) return { status: 'rejected', resource_id: id, detail: 'resource_not_found' };
    if (op === 'read') return { status: 'ok', resource_id: id, value: structuredClone(row.value) };
    if (op === 'write') { row.value = structuredClone(args ?? null); return { status: 'ok', resource_id: id }; }
    if (op === 'delete') { this.globals.delete(id); return { status: 'ok', resource_id: id, deleted: true }; }
    throw new TypeError('unsupported resource operation');
  }

  resource(channelId, payload) {
    const store = this.resources.get(channelId); if (!store) throw new TypeError('channel does not exist');
    const target = String(payload.resource_id || (payload.op === 'list' ? payload.query?.prefix || '' : ''));
    if (target.startsWith(GLOBAL_PREFIX)) return this.globalResource(channelId, payload);
    const { op, resource_id: id, args } = payload;
    if (op === 'list') {
      const prefix = String(payload.query?.prefix || '');
      const rows = [...store.values()];
      if (prefix.startsWith('daemon://')) {
        const cursor = Number.parseInt(String(payload.query?.cursor || '0'), 10);
        const limit = Math.max(1, Math.min(500, Number(payload.query?.limit) || 50));
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new TypeError('bad_cursor');
        const candidates = rows
          .filter((row) => row.kind === 'file' && String(row.address || '').startsWith(prefix))
          .filter((row) => !String(row.address).slice(prefix.length).includes('/'))
          .sort((left, right) => {
            const leftDir = left.meta?.node_type === 'directory';
            const rightDir = right.meta?.node_type === 'directory';
            if (leftDir !== rightDir) return leftDir ? -1 : 1;
            return String(left.address).localeCompare(String(right.address));
          });
        const page = candidates.slice(cursor, cursor + limit);
        return {
          items: page.map((row) => ({ id: row.address, kind: 'file', ops: ['read', 'write', 'delete'], meta: structuredClone(row.meta || {}) })),
          next: cursor + page.length < candidates.length ? String(cursor + page.length) : null,
        };
      }
      return { items: rows.map((row) => structuredClone(row)), next: null };
    }
    if (op === 'create' && payload.address) {
      const nodeType = payload.node_type || 'regular';
      const existing = [...store.values()].find((entry) => entry.address === payload.address);
      if (existing) {
        if (nodeType !== 'regular' || existing.meta?.node_type !== 'regular') throw new TypeError('resource already exists');
        return { status: 'ok', ticket: this.issueTicket('put', payload.address, existing.resource_id), redeem: 'http', resource_id: existing.resource_id };
      }
      const resourceId = `file:${this.nextId('resource')}`;
      const row = { id: resourceId, resource_id: resourceId, kind: 'file', address: payload.address, meta: { node_type: nodeType } };
      store.set(resourceId, row);
      if (nodeType === 'directory') return { status: 'ok', resource_id: payload.address };
      const ticket = this.issueTicket('put', payload.address, resourceId);
      // 回执不带 address：真实服务端只回述 resource_id，mock 多给一个字段就会让
      // 前端写出依赖它的代码，而那份代码到了真节点上必然失败。
      return { status: 'ok', ticket, redeem: 'http', resource_id: resourceId };
    }
    if (op === 'create') {
      if (store.has(id)) throw new TypeError('resource already exists');
      const row = { id, resource_id: id, kind: 'kv', value: structuredClone(args ?? {}) }; store.set(id, row); return { status: 'ok', resource_id: id, value: row.value };
    }
    let row = store.get(id) || [...store.values()].find((entry) => entry.address === id);
    // 真 accessdoor 会把频道 mount 内的宿主绝对路径规范化成 daemon:// address。
    // Mock 只为 read 复刻这条已有能力，让文件引用演示走完整 ticket 数据面。
    if (!row && op === 'read' && typeof id === 'string' && id.startsWith('/')) {
      const channel = this.channel(channelId);
      const root = `/mock/atoll/local-device/channels/${channel?.qualified_name || channelId}`;
      if (!id.startsWith(`${root}/`)) throw new TypeError('path is outside this channel');
      const segments = id.slice(root.length + 1).split('/');
      if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..')) throw new TypeError('path is outside this channel');
      const address = `daemon://local-device/${channel.qualified_name || channel.name || channel.id}/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
      row = [...store.values()].find((entry) => entry.address === address);
    }
    if (op === 'stat') return { exists: Boolean(row), ...(row ? { meta: { kind: row.kind, ...(row.meta || {}) } } : {}) };
    if (!row) throw new TypeError('resource does not exist');
    if (op === 'read' && row.kind === 'file' && payload.with_content) return { status: 'ok', ticket: this.issueTicket('get', row.address, id), redeem: 'http', resource_id: id };
    if (op === 'read') return { status: 'ok', resource_id: id, value: structuredClone(row.value) };
    if (op === 'write') { row.value = structuredClone(args ?? {}); return { status: 'ok', resource_id: id, value: row.value }; }
    if (op === 'delete') {
      if (row.meta?.node_type === 'directory' && [...store.values()].some((entry) => String(entry.address || '').startsWith(`${row.address}/`))) throw new TypeError('directory is not empty');
      store.delete(row.id || id); if (row.address) this.files.delete(row.address); return { status: 'ok', resource_id: id, deleted: true };
    }
    throw new TypeError('unsupported resource operation');
  }

  issueTicket(method, address, resourceId) {
    const ticket = this.nextId('ticket');
    this.tickets.set(ticket, { method, address, resourceId, expiresAt: this.clock + 60_000, used: false });
    return ticket;
  }

  // 票是这一步的全部输入：地址、方向、资源都在发票时定死，兑的时候从票里读。
  redeemTicket(ticket, method) {
    const row = this.tickets.get(ticket);
    if (!row || row.method !== method || row.expiresAt <= this.clock || (method === 'put' && row.used)) return null;
    if (method === 'put') row.used = true;
    return row;
  }

  advance(ms) {
    if (!Number.isSafeInteger(ms) || ms < 0) throw new TypeError('advance ms must be a non-negative safe integer');
    this.clock += ms;
    const due = this.scheduled.filter((entry) => entry.at_ms <= this.clock - STAMP);
    this.scheduled = this.scheduled.filter((entry) => entry.at_ms > this.clock - STAMP);
    for (const entry of due) {
      if (entry.type === 'revoke_membership') this.revokeMembership(ROOT_ID, entry.channel_id);
      if (entry.type === 'retire_channel') this.retireChannel(entry.channel_id);
    }
    return due;
  }

  configureFault(fault) {
    const targets = ['attach', 'submit', 'resolve', 'cancel', 'after', 'cancel_timer', 'resource', 'observe', 'unobserve', 'receipt', 'feed', 'obs', 'history'];
    const modes = ['reject', 'delay', 'drop', 'partial'];
    if (!targets.includes(fault?.target)) throw new TypeError('unknown fault target');
    if (!modes.includes(fault?.mode)) throw new TypeError('unknown fault mode');
    const count = fault.count == null ? 1 : Number(fault.count);
    const delayMs = fault.delay_ms == null ? 0 : Number(fault.delay_ms);
    if (!Number.isSafeInteger(count) || count < 1) throw new TypeError('fault count must be a positive safe integer');
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) throw new TypeError('fault delay_ms must be a non-negative safe integer');
    const matchMsgType = String(fault.match_msg_type || '').trim();
    const configured = { target: fault.target, mode: fault.mode, count, delay_ms: delayMs, code: fault.code || 'unavailable', ...(matchMsgType ? { match_msg_type: matchMsgType } : {}) };
    this.faults.push(configured);
    return { ...configured };
  }

  takeFault(target, context = {}) {
    const index = this.faults.findIndex((fault) => fault.target === target
      && fault.count > 0
      && (!fault.match_msg_type || fault.match_msg_type === context.msgType));
    if (index < 0) return null;
    const fault = this.faults[index];
    fault.count -= 1;
    const result = { ...fault, count: 1 };
    if (fault.count === 0) this.faults.splice(index, 1);
    return result;
  }

  snapshot() {
    return {
      scenario: this.scenario,
      seed: this.seed,
      clock: this.clock,
      channels: [...this.channels.values()].map((channel) => ({ ...channel })),
      memberships: structuredClone(this.memberships),
      feeds: Object.fromEntries([...this.histories].map(([id, rows]) => [id, rows.length])),
      scheduled: structuredClone(this.scheduled),
      delays: structuredClone(this.delays),
      behavior: structuredClone(this.behavior),
      obs_complete: this.obsComplete,
      faults: structuredClone(this.faults),
      declarations: [...this.declarations.values()].map(({ config, ...row }) => ({ ...row, has_config: Boolean(config && Object.keys(config).length) })),
      channel_templates: [...this.channelTemplates.values()].map((row) => ({ id: row.id, name: row.name, status: row.status })),
      devices: [...this.devices.values()].map(({ key, ...row }) => row),
      bindings: [...this.bindings],
      resources: Object.fromEntries([...this.resources].map(([id, rows]) => [id, [...rows.values()].map((row) => ({ id: row.id, kind: row.kind, address: row.address }))])),
      tickets: [...this.tickets.values()].map((row) => ({ method: row.method, address: row.address, expiresAt: row.expiresAt, used: row.used })),
      // 全局 key 的值恒不出现在状态里：只给摘要，测试据此核对写进去的是哪个值。
      globals: [...this.globals].map(([id, row]) => ({
        id,
        kind: 'kv',
        created_by: row.created_by,
        value_sha256: createHash('sha256').update(JSON.stringify(row.value)).digest('hex'),
      })),
      member_configs: [...this.memberConfigs].map(([key, row]) => {
        const [channelId, actorId] = key.split('\u0000');
        return { channel_id: channelId, member: actorId, class: row.class, config: structuredClone(row.config) };
      }),
    };
  }
}

function globalReferences(value, found = new Set()) {
  if (typeof value === 'string') {
    if (value.startsWith(GLOBAL_REFERENCE) && GLOBAL_NAME.test(value.slice(GLOBAL_REFERENCE.length))) found.add(value.slice(GLOBAL_REFERENCE.length));
  } else if (Array.isArray(value)) value.forEach((item) => globalReferences(item, found));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => globalReferences(item, found));
  return found;
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  return value;
}

export const createMockDomain = (config) => new MockDomain(config);
