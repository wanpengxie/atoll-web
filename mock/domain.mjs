import { createHash } from 'node:crypto';

const ROOT_ID = 'root';
const STAMP = 1_723_974_400_000;

// 全局 key：空间范围的 kv 命名空间，任何频道的资源面都认 global/ 前缀并落到同一份。
const GLOBAL_PREFIX = 'global/';
const GLOBAL_NAME = /^[a-z0-9_-]{1,64}$/;
const GLOBAL_REFERENCE = '$global.';

// ---- 描述与配置的纯函数（对齐 platform/configval）----
const REQUIRED = '$required';

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// 上层盖下层，对象逐层合并，不删键（configval.Overlay）。
function overlay(base, top) {
  if (!plainObject(base) || !plainObject(top)) return structuredClone(top === undefined ? base : top);
  const out = structuredClone(base);
  for (const [key, value] of Object.entries(top)) {
    out[key] = plainObject(out[key]) && plainObject(value) ? overlay(out[key], value) : structuredClone(value);
  }
  return out;
}

// RFC 7396（configval.ApplyPatch）：null 删键，对象逐层合并。
function applyMergePatch(target, patch) {
  if (!plainObject(patch)) return structuredClone(patch);
  const out = plainObject(target) ? structuredClone(target) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else out[key] = applyMergePatch(out[key], value);
  }
  return out;
}

// 还站着的占位："$required" 或 "$required:说明"（configval.Missing）。
function placeholders(value, path = '', out = []) {
  if (typeof value === 'string' && (value === REQUIRED || value.startsWith(`${REQUIRED}:`))) {
    out.push({ key: path, ...(value.length > REQUIRED.length + 1 ? { hint: value.slice(REQUIRED.length + 1) } : {}) });
  } else if (plainObject(value)) {
    for (const key of Object.keys(value).sort()) placeholders(value[key], path ? `${path}.${key}` : key, out);
  }
  return out;
}

// 每个叶子键来自哪一层：后面的层盖前面的。
function layerSources(layers) {
  const out = {};
  const walk = (value, path, layer) => {
    if (plainObject(value) && Object.keys(value).length) {
      for (const [key, inner] of Object.entries(value)) walk(inner, path ? `${path}.${key}` : key, layer);
      return;
    }
    if (!path) return;
    for (const existing of Object.keys(out)) if (existing.startsWith(`${path}.`)) delete out[existing];
    out[path] = layer;
  };
  for (const [layer, value] of layers) walk(value, '', layer);
  return out;
}

function bodyPhrase(body) {
  if (body?.actor) return `actor ${body.actor}`;
  return `class ${body?.class || '?'}`;
}

// actor id 是 <kind>:<名字>:<届次>；老 mock 行的 id 就是名字。
function memberNameOf(id) {
  const parts = String(id || '').split(':');
  return parts.length >= 3 ? parts.slice(1, -1).join(':') : String(id || '');
}

function operationError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

const MEMBER_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const GENERATED_BODY = 'generated';

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

// 名册行上的"建好了"就是 bound（与真后端一样：对外只有一个状态）。
export function setRowBuilt(row, built, observedAt = STAMP) {
  const measures = (row.actual?.measures || []).filter((entry) => entry.name !== 'bound');
  measures.push(measure('bound', Boolean(built), observedAt));
  measures.sort((left, right) => left.name.localeCompare(right.name));
  row.actual = { ...(row.actual || {}), measures };
  return row;
}

export function rowBuilt(row) {
  const bound = row?.actual?.measures?.find((entry) => entry.name === 'bound');
  return Boolean(bound && !bound.unknown && bound.value);
}

export function rosterItem({ id, kind, body = kind === 'human' ? 'human' : '', name = id, description = '', principal = '', bound = true, online = null }, observedAt = STAMP) {
  const declared = {
    id,
    kind,
    ...(body ? { body } : {}),
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
  return item(declared, measures);
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
    rosterItem({ id: 'system', kind: 'system', body: GENERATED_BODY, name: 'system', description: 'Channel system actor' }, clock),
    rosterItem({ id: 'svcactor', kind: 'peer', body: GENERATED_BODY, name: 'Service Actor', description: 'Service actor' }, clock),
  ];
  if (channel.id === 'c0') {
    rows.push(rosterItem({ id: 'registrar', kind: 'system', body: GENERATED_BODY, name: 'Registrar Seat', description: 'Registrar seat' }, clock));
  }
	if (!channel.internal && seedBusiness) {
		const businessActorId = channel.id === 'c0'
			? canonicalActorIds ? 'agent:steward:test' : 'steward'
			: canonicalActorIds ? `agent:${channel.name}:test` : `${channel.name}-agent`;
		rows.push(rosterItem({ id: businessActorId, kind: 'agent', body: 'class codex', name: channel.id === 'c0' ? 'steward' : `${channel.name}-agent`, description: 'Mock collaboration agent' }, clock));
    if (channel.id === 'c0') rows.push(rosterItem({ id: 'claude', kind: 'agent', body: 'class claude', name: 'Claude', description: 'Mock Claude collaboration agent' }, clock));
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
    // Actor 描述：不可变的 名字@版本（c0 的 actor_descriptions 表）。
    this.actorDescriptions = new Map();
    for (const [name, klass, description, params] of [
      ['steward', 'codex', 'Mock steward', {}],
      ['claude', 'claude', 'Mock Claude agent', {}],
      ['analyst', 'codex-agent', 'Mock analyst agent', {}],
      ['search', 'mcp-tool', 'Mock search tool', {}],
    ]) this.putActorDescription({ name, class: klass, description, params }, stamp);
    // 频道描述（c0 的 channel_descriptions 表）：c0 和大厅是平台搭的，没有描述。
    this.descriptions = new Map();
    // c0 的成员是平台固定的：条目只能读，这一台的配置可以改。
    this.c0Entries = [];
    // 成员这一台的配置（各频道自己的 member_config 表）：key → {desired_host, values, revision}。
    this.memberConfigs = new Map();
    // 每个成员 / 频道最近一次构建记录。
    this.builds = new Map();
    this.events = [];
    for (const channel of this.channels.values()) {
      const entries = (this.rosters.get(channel.id) || [])
        .filter((row) => ['agent', 'tool'].includes(row.declared.kind) && String(row.declared.body || '').startsWith('class '))
        .map((row) => ({ name: memberNameOf(row.declared.id), body: { class: row.declared.body.slice('class '.length) } }));
      if (channel.id === 'c0') this.c0Entries = entries;
      else if (!channel.internal) this.descriptions.set(channel.id, { body: this.normalizedDescription({ members: entries, description: channel.description || '' }), revision: 1 });
    }
    for (const channelId of this.channels.keys()) {
      for (const entry of this.entriesOf(channelId)) this.builds.set(this.memberKey(channelId, entry.name), this.buildRecord(channelId, entry.name, { result: 'ok', state: 'ready', attempt: 1, at: stamp }));
    }
    // Device id is authority/routing identity; its canonical name spells the
    // human-readable daemon:// namespace.
    this.devices = new Map([['local-device', { id: 'local-device', owner_principal: ROOT_ID, name: 'local-device', status: 'present', online: true, key: 'mock-device-key-never-observed' }]]);
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
    if (this.behavior.actor_layers_demo) this.seedActorLayersDemo();
    // 场景自带的构建是初始状态，不是账本里发生过的事。
    this.events = [];
  }

  // actor-config 场景（c0.project 里）：一个引用了不存在的全局 key、起不来的
  // agent（deepseek）；一个连不上端点、起不来的 tool（search-tool）；一个还有占位
  // 没填、构建失败停下的 agent（writer）。外加一把已有的全局 key 给编辑器插引用用。
  seedActorLayersDemo() {
    const stamp = STAMP;
    this.putActorDescription({ name: 'deepseek', class: 'deepseek-agent', description: 'Mock DeepSeek agent', params: { model: 'deepseek-chat', api_key: `${GLOBAL_REFERENCE}deepseek_prod` } }, stamp);
    this.putActorDescription({ name: 'writer', class: 'claude', description: '写作助手', params: { model: 'claude-opus', service: { api_key: `${REQUIRED}:写作服务的 API key`, region: 'cn' } } }, stamp);
    this.globals.set(`${GLOBAL_PREFIX}openai_prod`, { value: 'sk-mock-openai-0000', created_by: 'c0/root', created_at: stamp });
    const channelId = 'c0.project';
    const description = this.descriptions.get(channelId);
    if (!description) return;
    description.body.members.push(
      { name: 'deepseek', body: { actor: 'deepseek@1' } },
      { name: 'search-tool', body: { actor: 'search@1' }, params: { endpoint: 'http://127.0.0.1:9000/mcp' } },
      { name: 'writer', body: { actor: 'writer@1' }, params: { temperature: 0.3 } },
    );
    description.revision += 1;
    for (const name of ['deepseek', 'search-tool', 'writer']) this.buildMember(channelId, name, { at: stamp });
  }

  memberKey(channelId, name) {
    return `${channelId}\u0000${name}`;
  }

  // 名册行：按 actor id 或成员名找。
  memberRow(channelId, target) {
    const rows = this.rosters.get(channelId) || [];
    return rows.find((entry) => entry.declared.id === target)
      || rows.find((entry) => entry.declared.kind !== 'human' && memberNameOf(entry.declared.id) === target)
      || null;
  }

  putActorDescription({ name, class: klass, params = {}, description = '', visibility = 'private' }, at = this.clock) {
    if (!MEMBER_NAME.test(String(name || ''))) throw operationError('invalid_args', `name ${JSON.stringify(name)}: 1-63 chars of lowercase a-z, 0-9 or '-'`);
    if (!klass) throw operationError('invalid_args', 'class required');
    if (!MOCK_CLASSES[klass]) throw operationError('invalid_args', `class ${klass} is not a class this node has; see system.class.list`);
    if (!plainObject(params)) throw operationError('invalid_args', 'params must be a JSON object');
    const version = [...this.actorDescriptions.values()].filter((row) => row.name === name).reduce((highest, row) => Math.max(highest, row.version), 0) + 1;
    const ref = `${name}@${version}`;
    const row = { name, version, ref, class: klass, params: structuredClone(params), description, owner: ROOT_ID, visibility, status: 'present', created_at: at };
    this.actorDescriptions.set(ref, row);
    return structuredClone(row);
  }

  actorDescription(name, version = 0) {
    const rows = [...this.actorDescriptions.values()].filter((row) => row.name === name);
    const row = version ? rows.find((entry) => entry.version === Number(version)) : rows.filter((entry) => entry.status === 'present').sort((left, right) => right.version - left.version)[0];
    if (!row) throw operationError('not_found', `actor description ${name}${version ? `@${version}` : ''} does not exist; see system.actor.description.list`);
    return structuredClone(row);
  }

  retireActorDescription(name, version) {
    const row = this.actorDescriptions.get(`${name}@${version}`);
    if (!row) throw operationError('not_found', `actor description ${name}@${version} does not exist`);
    row.status = 'retired';
    return structuredClone(row);
  }

  actorDescriptionRows() {
    return [...this.actorDescriptions.values()].map((row) => item(structuredClone(row), null, row.ref));
  }

  normalizedDescription(body = {}) {
    return {
      members: Array.isArray(body.members) ? structuredClone(body.members) : [],
      service: plainObject(body.service) ? structuredClone(body.service) : { words: {} },
      ...(body.description ? { description: String(body.description) } : {}),
      serving: Number(body.serving || 0) === 1 ? 1 : 0,
      ...(Array.isArray(body.devices) && body.devices.length ? { devices: [...body.devices] } : {}),
    };
  }

  validateDescription(body) {
    const seen = new Set();
    for (const entry of body.members) {
      if (!MEMBER_NAME.test(String(entry?.name || ''))) throw operationError('invalid_args', `member name ${JSON.stringify(entry?.name)}: 1-63 chars of lowercase a-z, 0-9 or '-'`);
      if (seen.has(entry.name)) throw operationError('invalid_args', `two members are named ${entry.name}`);
      seen.add(entry.name);
      const hasClass = Boolean(entry.body?.class);
      const hasActor = Boolean(entry.body?.actor);
      const isPerson = entry.body?.human === true;
      if (Number(hasClass) + Number(hasActor) + Number(isPerson) !== 1) throw operationError('invalid_args', `member ${entry.name}: body names exactly one of class, actor ("name@version") or human (true: a person)`);
      if (isPerson && entry.principal && entry.principal !== entry.name) throw operationError('invalid_args', `member ${entry.name}: a person's member name is their principal`);
      if (hasActor && !/^[a-z0-9-]+@[1-9][0-9]*$/.test(entry.body.actor)) throw operationError('invalid_args', `member ${entry.name}: actor ${JSON.stringify(entry.body.actor)} is not name@version`);
      if (entry.params != null && !plainObject(entry.params)) throw operationError('invalid_args', `member ${entry.name}: params must be a JSON object`);
    }
  }

  entriesOf(channelId) {
    if (channelId === 'c0') return this.c0Entries;
    return this.descriptions.get(channelId)?.body.members || [];
  }

  entry(channelId, name) {
    return this.entriesOf(channelId).find((entry) => entry.name === name) || null;
  }

  // 频道描述的唯一写口：c0 和大厅没有描述。改完重新校验、版本加一、重建。
  editDescription(channelId, mutate) {
    const current = this.descriptions.get(channelId);
    if (!current) throw operationError('reserved', 'lagoon: this channel is built by the platform and has no description');
    const next = structuredClone(current.body);
    const result = mutate(next);
    const body = this.normalizedDescription(next);
    this.validateDescription(body);
    current.body = body;
    current.revision += 1;
    this.realize(channelId);
    return { revision: current.revision, result };
  }

  // 成员的各层合成：Class 默认值 ← Actor 描述 ← 成员条目 ← 这一台的配置。
  layersOf(channelId, entry) {
    const actor = entry.body?.actor ? this.actorDescriptions.get(entry.body.actor) || null : null;
    const klass = actor?.class || entry.body?.class || '';
    const config = this.memberConfigs.get(this.memberKey(channelId, entry.name)) || { desired_host: '', values: {}, revision: 0 };
    const layers = [
      ['default', structuredClone(MOCK_CLASSES[klass]?.defaults || {})],
      ['actor', structuredClone(actor?.params || {})],
      ['member', structuredClone(entry.params || {})],
      ['config', structuredClone(config.values || {})],
    ];
    const effective = layers.reduce((value, [, layer]) => overlay(value, layer), {});
    return { actor, klass, config, layers, effective, sources: layerSources(layers), missing: placeholders(effective) };
  }

  channelDeviceIds(channelId) {
    const channel = this.channel(channelId);
    if (!channel || channel.internal) return [];
    const described = this.descriptions.get(channelId)?.body.devices || [];
    return ['local-device', ...described.filter((id) => this.devices.get(id)?.status === 'present' && id !== 'local-device')];
  }

  buildRecord(channelId, name, { result, state, reason = '', attempt = 1, cause = '', at = this.clock }) {
    const entry = this.entry(channelId, name);
    const config = this.memberConfigs.get(this.memberKey(channelId, name));
    return {
      object: { kind: 'member', channel: channelId, name },
      description: { channel_revision: this.descriptions.get(channelId)?.revision || 0, ...(entry?.body?.actor ? { actor: entry.body.actor } : {}) },
      ...(config ? { config: { revision: config.revision } } : {}),
      attempt,
      ...(cause ? { cause } : {}),
      result,
      state,
      ...(reason ? { reason } : {}),
      started_at: at,
      finished_at: at,
    };
  }

  // 一个成员的一次构建：失败就不在名册上（占位没填、设备不在、描述缺失）；业务层
  // 初始化失败时名册上有它、构建记为失败。两条事件进本频道账本。
  buildMember(channelId, name, { cause = '', at = this.clock } = {}) {
    const entry = this.entry(channelId, name);
    if (!entry) return null;
    const key = this.memberKey(channelId, name);
    const { actor, klass, config, effective, missing } = this.layersOf(channelId, entry);
    let reason = '';
    if (entry.body?.actor && !actor) reason = `member ${name}: actor description ${entry.body.actor} does not exist; see system.actor.description.list`;
    else if (!MOCK_CLASSES[klass]) reason = `member ${name}: class ${klass} is not a class this node has`;
    else if (missing.length) reason = `member ${name}: ${missing.map((row) => `${row.key} is a placeholder still unfilled${row.hint ? ` (${row.hint})` : ''}`).join('; ')}; fill it in this member's own configuration with system.member.config.set`;
    else if (config.desired_host && !this.channelDeviceIds(channelId).includes(config.desired_host)) reason = `member ${name}: desired_host ${config.desired_host} is neither local-device nor one of this channel's devices; attach it with system.device.attach, or clear desired_host with system.member.config.set`;
    const started = this.buildRecord(channelId, name, { result: '', state: '', attempt: 1, cause, at });
    delete started.result; delete started.state; delete started.finished_at;
    this.events.push({ channelId, type: 'system.build.started', payload: started });
    let record;
    if (reason) {
      const rows = this.rosters.get(channelId) || [];
      const index = rows.findIndex((row) => row.declared.kind !== 'human' && memberNameOf(row.declared.id) === name);
      if (index >= 0) rows.splice(index, 1);
      record = this.buildRecord(channelId, name, { result: 'failed', state: 'stopped', reason, cause, at });
    } else {
      const kind = MOCK_CLASSES[klass].kind;
      let row = this.memberRow(channelId, name);
      if (row && row.declared.kind !== kind) {
        this.rosters.get(channelId).splice(this.rosters.get(channelId).indexOf(row), 1);
        row = null;
      }
      if (!row) {
        this.counter += 1;
        row = rosterItem({ id: `${kind}:${name}:${this.clock + this.counter}`, kind, body: bodyPhrase(entry.body), name, description: actor?.description || '' }, this.clock);
        this.rosters.get(channelId)?.push(row);
      } else {
        row.declared.body = bodyPhrase(entry.body);
      }
      // 业务起不来（缺全局 key、class 拒绝、端点连不上）：actor 自己结束、由
      // supervisor 退避重建，对外只是"没建好"——名册上 bound=false，这次构建只有
      // 开始回执，没有结束回执（owner 09-30：不补回执）。
      const failure = this.startupFailure({ class: klass, effective });
      setRowBuilt(row, !failure, this.clock);
      if (failure) {
        this.builds.set(key, started);
        return started;
      }
      record = this.buildRecord(channelId, name, { result: 'ok', state: 'ready', cause, at });
    }
    this.builds.set(key, record);
    this.events.push({ channelId, type: 'system.build.finished', payload: structuredClone(record) });
    return record;
  }

  // 让一个频道的成员对上它的描述：多的删、少的建、变了的重建。
  realize(channelId, { cause = '', only = null } = {}) {
    // 人由成员关系（memberships）表示，按人的条目放进放出；这里只建 agent/tool。
    const names = new Set(this.entriesOf(channelId).filter((entry) => entry.body?.human !== true).map((entry) => entry.name));
    const rows = this.rosters.get(channelId) || [];
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index].declared;
      if (!['agent', 'tool'].includes(row.kind) || row.body === GENERATED_BODY) continue;
      if (!names.has(memberNameOf(row.id))) rows.splice(index, 1);
    }
    for (const key of [...this.builds.keys()]) if (key.startsWith(`${channelId}\u0000`) && !names.has(key.slice(channelId.length + 1))) this.builds.delete(key);
    for (const name of names) if (!only || only === name) this.buildMember(channelId, name, { cause });
  }

  takeEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  // 这个成员此刻起不起得来（actor 内部的事，对外只看建没建好）：引用的全局 key
  // 缺了、class 拒绝配置、tool 的端点还指着那个死端口，都起不来。
  startupFailure({ class: klass, effective }) {
    for (const name of globalReferences(effective)) {
      if (!this.globals.has(`${GLOBAL_PREFIX}${name}`)) return `missing global resource ${GLOBAL_PREFIX}${name}`;
    }
    const refused = MOCK_CLASSES[klass]?.refuse?.(effective) || '';
    if (refused) return `config refused by ${klass}: ${refused}`;
    if (klass === 'mcp-tool' && String(effective.endpoint || '').includes(':9000')) return 'connection refused';
    return '';
  }

  memberSummary(channelId, row) {
    const name = memberNameOf(row.id);
    const entry = row.kind === 'human' ? null : this.entry(channelId, name);
    return entry ? bodyPhrase(entry.body) : GENERATED_BODY;
  }

  // system.member.get：成员事实（建好了没有）+ 它的各层（条目、这一台的配置、合成值、
  // 来源、占位、最近一次构建）。描述里有但没在跑的成员也答（从描述里答）。
  memberInfo(channelId, target) {
    const row = this.memberRow(channelId, target);
    const name = row ? memberNameOf(row.declared.id) : String(target || '');
    const entry = row?.declared.kind === 'human' ? null : this.entry(channelId, name);
    if (!row && !entry) throw operationError('not_found', `${target} is not a member of this channel; see system.member.list`);
    const built = row ? (row.declared.kind === 'human' ? true : rowBuilt(row)) : false;
    const status = {
      actor_id: row?.declared.id || '',
      member: Boolean(row),
      present: built,
      ...(built ? { uptime_ms: 60_000 } : {}),
      name,
    };
    if (!entry) return row?.declared.kind === 'human' ? status : { ...status, generated: true };
    const { klass, config, effective, sources, missing } = this.layersOf(channelId, entry);
    const newer = entry.body.actor ? [...this.actorDescriptions.values()].filter((value) => value.name === entry.body.actor.split('@')[0] && value.status === 'present' && value.version > Number(entry.body.actor.split('@')[1])).sort((left, right) => right.version - left.version)[0] : null;
    return {
      ...status,
      class: klass,
      config: structuredClone(effective),
      desired_host: config.desired_host || 'local-device',
      body: structuredClone(entry.body),
      ...(entry.params ? { params: structuredClone(entry.params) } : {}),
      ...(entry.requires?.length ? { requires: [...entry.requires] } : {}),
      own_config: { ...(config.desired_host ? { desired_host: config.desired_host } : {}), values: structuredClone(config.values || {}), revision: config.revision || 0 },
      effective,
      sources,
      ...(missing.length ? { missing } : {}),
      ...(this.builds.get(this.memberKey(channelId, name)) ? { build: structuredClone(this.builds.get(this.memberKey(channelId, name))) } : {}),
      ...(newer ? { note: `a newer version of its actor description exists: ${newer.ref}; change body.actor with system.member.set to use it` } : {}),
    };
  }

  // system.member.create：频道描述里加一个条目。
  createMemberEntry(channelId, { name, body, params, requires } = {}) {
    const entry = { name: String(name || '').trim(), body: structuredClone(body || {}), ...(params ? { params: structuredClone(params) } : {}), ...(requires?.length ? { requires: [...requires] } : {}) };
    const { revision } = this.editDescription(channelId, (description) => {
      if (description.members.some((row) => row.name === entry.name)) throw operationError('invalid_args', `the channel description already has a member named ${JSON.stringify(entry.name)}; change it with system.member.set, or pick another name`);
      description.members.push(entry);
    });
    return { written: true, description_revision: revision, entry };
  }

  // system.member.set：条目原地改——body 整个换、params 合并补丁、requires 整个换（null 清空）。
  setMemberEntry(channelId, { member, body, params, requires } = {}) {
    const name = this.memberRow(channelId, member) ? memberNameOf(this.memberRow(channelId, member).declared.id) : String(member || '');
    let result = null;
    const { revision } = this.editDescription(channelId, (description) => {
      const entry = description.members.find((row) => row.name === name);
      if (!entry) throw operationError('invalid_args', `the channel description has no member named ${JSON.stringify(name)}; members the runtime keeps itself (the service door, peers, handles) are not in it — see system.channel.description.get`);
      if (body) entry.body = structuredClone(body);
      if (params) entry.params = applyMergePatch(entry.params || {}, params);
      if (requires === null) delete entry.requires;
      else if (Array.isArray(requires)) entry.requires = [...requires];
      result = structuredClone(entry);
    });
    return { written: true, description_revision: revision, entry: result };
  }

  // system.member.delete：人就是请出去；其余是条目离开描述，这一台的配置一起删。
  deleteMember(channelId, member) {
    const row = this.memberRow(channelId, member);
    if (row?.declared.body === GENERATED_BODY) throw operationError('protected_actor', 'the runtime keeps this member itself; it is not in the channel description');
    const person = row?.declared.kind === 'human';
    const name = person ? String(row.declared.name || memberNameOf(row.declared.id)) : row ? memberNameOf(row.declared.id) : String(member || '');
    const channel = this.channel(channelId);
    if (person && channel?.owner_principal === name) throw operationError('reserved', `${JSON.stringify(name)} is the channel's owner, who stays in the channel`);
    const { revision } = this.editDescription(channelId, (description) => {
      const before = description.members.length;
      description.members = description.members.filter((entry) => entry.name !== name);
      if (description.members.length === before) throw operationError('invalid_args', `the channel description has no member named ${JSON.stringify(name)}; members the runtime keeps itself (the service door, peers, handles) leave when what they follow from changes`);
    });
    this.memberConfigs.delete(this.memberKey(channelId, name));
    if (person) this.removeActor(channelId, row.declared.id);
    return { written: true, description_revision: revision };
  }

  memberConfig(channelId, member) {
    const name = this.memberRow(channelId, member) ? memberNameOf(this.memberRow(channelId, member).declared.id) : String(member || '');
    const config = this.memberConfigs.get(this.memberKey(channelId, name)) || { desired_host: '', values: {}, revision: 0 };
    return { member: name, desired_host: config.desired_host || '', values: structuredClone(config.values || {}), revision: config.revision || 0 };
  }

  // system.member.config.set：这一台的设备和 values 的合并补丁。值本身不检查，
  // 构建会说它行不行。
  setMemberConfig(channelId, { member, desired_host: desiredHost, values } = {}) {
    const name = this.memberRow(channelId, member) ? memberNameOf(this.memberRow(channelId, member).declared.id) : String(member || '');
    if (!this.entry(channelId, name)) throw operationError('invalid_args', `${JSON.stringify(name)} is not a member of this channel's description, so it has no configuration of its own here; see system.channel.description.get`);
    if (values != null && !plainObject(values)) throw operationError('invalid_args', 'values must be a JSON object (a merge patch)');
    const key = this.memberKey(channelId, name);
    const current = this.memberConfigs.get(key) || { desired_host: '', values: {}, revision: 0 };
    const next = {
      desired_host: desiredHost === undefined ? current.desired_host : String(desiredHost || '').trim(),
      values: values ? applyMergePatch(current.values, values) : structuredClone(current.values),
      revision: current.revision,
    };
    next.revision += 1;
    this.memberConfigs.set(key, next);
    this.buildMember(channelId, name);
    return { member: name, desired_host: next.desired_host, values: structuredClone(next.values), revision: next.revision };
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

  // system.member.admit：只收 principal。
  // system.member.admit：往描述里写这个人的条目（registrar 的回复形状），人随即进来。
  admitPerson(channelId, principal) {
    if (!principal) throw operationError('invalid_args', 'principal required: the person to let in (see system.principal.list)');
    if (!this.humanPrincipals.has(principal)) throw operationError('not_found', `principal ${principal} does not exist or is not a person; see system.principal.list`);
    const entry = { name: principal, body: { human: true }, principal };
    const { revision } = this.editDescription(channelId, (description) => {
      const existing = description.members.find((row) => row.name === principal);
      if (existing && existing.body?.human !== true) throw operationError('invalid_args', `the channel description already has a member named ${JSON.stringify(principal)} that is not this person`);
      if (!existing) description.members.push(entry);
    });
    this.admitMember(channelId, principal);
    return { written: true, description_revision: revision, entry };
  }

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
    const target = (this.rosters.get(channelId) || []).find((entry) => entry.declared.id === actorId);
    if (target?.declared.body === GENERATED_BODY) {
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
    if (row.declared.body === GENERATED_BODY) {
      const error = new TypeError('protected system actor cannot be restarted');
      error.code = 'protected_actor';
      throw error;
    }
    // 重启 = 按当前描述和配置重建：缺的全局 key 补上了，卡住的成员就起来了。
    this.buildMember(channelId, memberNameOf(actorId));
    return { member: actorId };
  }

  // system.channel.create：从空描述、给定的描述或复制另一个频道的描述（copy_from，
  // 只抄描述，成员配置留在源频道）开始；humans 是一开始放进来的人。
  createChannel(parentId, { name, parent, humans = [], description, copy_from: copyFrom } = {}, principalId = ROOT_ID) {
    const clean = String(name || '').trim();
    if (!MEMBER_NAME.test(clean)) throw operationError('invalid_args', 'channel name must use lowercase letters, numbers or hyphens');
    if (description != null && copyFrom) throw operationError('invalid_args', 'give at most one of description (the new channel\'s description) and copy_from (copy another channel\'s)');
    const parentRef = String(parent || parentId);
    const parentRow = this.channel(parentRef) || [...this.channels.values()].find((row) => row.qualified_name === parentRef);
    if (!parentRow || parentRow.status !== 'present') throw operationError('not_found', `parent channel ${parentRef} does not exist; see system.channel.list`);
    if (parentRow.internal) throw operationError('reserved', 'the lobby has no child channels');
    let body = this.normalizedDescription({});
    if (description != null) {
      if (!plainObject(description)) throw operationError('invalid_args', 'description must be a JSON object');
      body = this.normalizedDescription(description);
    } else if (copyFrom) {
      const source = this.channel(copyFrom) || [...this.channels.values()].find((row) => row.qualified_name === copyFrom);
      if (!source || source.status !== 'present') throw operationError('not_found', `channel to copy ${copyFrom} does not exist; see system.channel.list`);
      const copied = this.descriptions.get(source.id);
      if (!copied) throw operationError('invalid_args', `${source.qualified_name} is built by the platform and has no description to copy`);
      body = structuredClone(copied.body);
    }
    if (!Array.isArray(humans)) throw operationError('invalid_args', 'humans must be an array of principal ids');
    for (const human of humans) if (!this.humanPrincipals.has(human)) throw operationError('not_found', `principal ${human} does not exist; see system.principal.list`);
    // 一开始放进来的人就是新描述里的人的条目。
    for (const human of new Set(humans)) {
      if (!body.members.some((entry) => entry.name === human)) body.members.push({ name: human, body: { human: true }, principal: human });
    }
    this.validateDescription(body);
    const id = `${parentRow.id}.${clean}`;
    if (this.channels.has(id)) throw operationError('conflict_exists', `channel ${id} already exists (${id})`);
    const channel = { id, name: clean, qualified_name: id, parent_id: parentRow.id, owner_principal: principalId, internal: false, open: true, status: 'present' };
    this.channels.set(id, channel);
    for (const human of new Set(humans)) {
      this.counter += 1;
      this.memberships.push({ principal_id: human, channel_id: id, actor_id: `human:${human}:${this.clock + this.counter}`, role: human === principalId ? 'owner' : 'member', status: 'active' });
    }
    this.rosters.set(id, createRoster(channel, this.memberships, this.clock, { seedBusiness: false }));
    this.histories.set(id, []);
    this.resources.set(id, new Map());
    this.descriptions.set(id, { body, revision: 1 });
    this.realize(id);
    return { channel_id: id, revision: 1 };
  }

  // system.channel.get：只答注册库里的事实——目录行和描述。
  channelView(channelId) {
    const channel = this.channel(channelId) || [...this.channels.values()].find((row) => row.qualified_name === channelId);
    if (!channel) throw operationError('not_found', `channel ${channelId} does not exist; see system.channel.list`);
    const description = this.descriptions.get(channel.id);
    return {
      id: channel.id,
      ...(channel.parent_id ? { parent_id: channel.parent_id } : {}),
      name: channel.name,
      qualified_name: channel.qualified_name,
      type: 'group',
      status: channel.status,
      owner_principal: channel.owner_principal || ROOT_ID,
      created_at: STAMP,
      temporary: false,
      ...(description ? { description: { body: structuredClone(description.body), revision: description.revision } } : {}),
    };
  }

  channelDescription(channelRef) {
    const channel = this.channel(channelRef) || [...this.channels.values()].find((row) => row.qualified_name === channelRef);
    if (!channel) throw operationError('not_found', `channel ${channelRef} does not exist; see system.channel.list`);
    const description = this.descriptions.get(channel.id);
    if (!description) throw operationError('reserved', `${channel.qualified_name} is built by the platform and has no description; system.member.list shows its members`);
    return { body: structuredClone(description.body), revision: description.revision };
  }

  // system.channel.set：描述里的说明和 serving 两个字段。
  setChannel(channelId, { description, serving } = {}) {
    const { revision } = this.editDescription(channelId, (body) => {
      if (description !== undefined) body.description = String(description || '');
      if (serving !== undefined) body.serving = Number(serving) === 1 ? 1 : 0;
    });
    const channel = this.channel(channelId);
    if (channel && description !== undefined) channel.description = String(description || '');
    return { channel_id: channelId, revision };
  }

  daemonRows() {
    return [...this.devices.values()].filter((row) => row.status === 'present').map((row) => item({ id: row.id, owner_principal: row.owner_principal, name: row.name, status: row.status, created_at: STAMP }, [measure('online', row.online, this.clock)]));
  }

  channelDeviceRows(channelId) {
    return this.channelDeviceIds(channelId)
      .map((id) => this.devices.get(id))
      .map((row) => item({ channel_id: channelId, device_id: row.id, owner_principal: row.owner_principal, name: row.name, status: row.status, default: row.id === 'local-device' }, [measure('online', row.online, this.clock)], row.id));
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
    if (id === 'local-device') throw operationError('reserved', 'local-device is the node\'s own device and cannot be retired');
    const row = this.devices.get(id); if (!row || row.status !== 'present') throw new TypeError('device does not exist');
    row.status = 'retired';
    for (const channelId of this.descriptions.keys()) if ((this.descriptions.get(channelId).body.devices || []).includes(id)) this.realize(channelId);
    return { device_id: id, retired: true };
  }

  // system.device.attach / detach：编辑频道描述里的 devices。
  bindDevice(channelId, deviceId, attach) {
    if (!this.channel(channelId)) throw operationError('not_found', `channel ${channelId} does not exist`);
    if (deviceId === 'local-device') throw operationError('reserved', 'every channel already has local-device; it is not attached or detached');
    if (!this.devices.get(deviceId) || this.devices.get(deviceId).status !== 'present') throw operationError('not_found', `device ${deviceId} does not exist; see system.device.list`);
    const { revision } = this.editDescription(channelId, (body) => {
      const devices = new Set(body.devices || []);
      if (attach) devices.add(deviceId); else devices.delete(deviceId);
      body.devices = [...devices];
    });
    return { channel_id: channelId, revision };
  }

  // global/ 不是这个频道的：任何频道的资源面都落到同一份空间存储。只有 kv；
  // 名字必须满足 [a-z0-9_-]{1,64}，和 $global.<name> 引用能写的一样。
  // principal 是发这帧的人；成员资格已由 server 在收帧时判过（和真节点一样只看
  // "是不是这个频道的活跃成员"），这里只用它记创建者。
  globalResource(channelId, payload, principal = ROOT_ID) {
    const { op, resource_id: id, args } = payload;
    const creator = `${channelId}/${this.activeMembership(principal, channelId)?.actor_id || principal}`;
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

  resource(channelId, payload, principal = ROOT_ID) {
    const store = this.resources.get(channelId); if (!store) throw new TypeError('channel does not exist');
    const target = String(payload.resource_id || (payload.op === 'list' ? payload.query?.prefix || '' : ''));
    if (target.startsWith(GLOBAL_PREFIX)) return this.globalResource(channelId, payload, principal);
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
      actor_descriptions: [...this.actorDescriptions.values()].map((row) => structuredClone(row)),
      descriptions: Object.fromEntries([...this.descriptions].map(([id, row]) => [id, structuredClone(row)])),
      devices: [...this.devices.values()].map(({ key, ...row }) => row),
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
        const [channelId, member] = key.split('\u0000');
        return { channel_id: channelId, member, desired_host: row.desired_host, values: structuredClone(row.values), revision: row.revision };
      }),
      builds: [...this.builds.values()].map((row) => structuredClone(row)),
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


export const createMockDomain = (config) => new MockDomain(config);
