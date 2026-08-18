const ROOT_ID = 'root';
const STAMP = 1_723_974_400_000;

export function measure(name, value, observedAt) {
  return { name, value, unknown: false, observed_at: observedAt, since: null };
}

export function item(declared, measures = null, key = declared.id) {
  return { ...(key ? { key } : {}), declared, actual: measures == null ? null : { measures } };
}

export function observation(subject, kind, items, complete = true, extra = {}) {
  return { subject, kind, complete, items, ...extra };
}

export function rosterItem({ id, kind, declId = '', name = id, description = '', principal = '', bound = true, online = null }, observedAt = STAMP) {
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

function createRoster(channel, memberships, clock) {
  const rows = [
    rosterItem({ id: 'system', kind: 'system', name: 'system', description: 'Channel system actor' }, clock),
    rosterItem({ id: 'svcactor', kind: 'tool', declId: 'atoll-internal:svcactor', name: 'svcactor', description: 'Service actor tool' }, clock),
  ];
  if (channel.id === 'c0') {
    rows.push(rosterItem({ id: 'registrar', kind: 'tool', declId: 'atoll-internal:registrar-seat', name: 'registrar', description: 'Registrar seat tool' }, clock));
  } else {
    rows.push(rosterItem({ id: 'coreactor', kind: 'tool', declId: 'coreactor', name: 'coreactor', description: 'Channel core actor' }, clock));
  }
  if (!channel.internal) {
    rows.push(rosterItem({ id: channel.id === 'c0' ? 'steward' : `${channel.name}-agent`, kind: 'agent', declId: 'mock:steward', name: channel.id === 'c0' ? 'steward' : `${channel.name}-agent`, description: 'Mock collaboration agent' }, clock));
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
    this.rosters = new Map([...this.channels.values()].map((channel) => [channel.id, createRoster(channel, this.memberships, this.clock)]));
    this.histories = new Map([...this.channels.keys()].map((channelId) => [channelId, []]));
    this.scheduled = structuredClone(config.scheduled || []);
    this.delays = structuredClone(config.delays || {});
    this.behavior = structuredClone(config.behavior || {});
    this.obsComplete = config.obs_complete !== false;
    this.faults = [];
    const stamp = STAMP;
    this.declarations = new Map([
      ['mock:steward', { id: 'mock:steward', name: 'Steward', description: 'Mock steward declaration', owner: ROOT_ID, class: 'codex', default_class: 'codex', config: {}, status: 'present', visibility: 'private', created_at: stamp, updated_at: stamp }],
      ['mock:analyst', { id: 'mock:analyst', name: 'Analyst Agent', description: 'Mock agent declaration', owner: ROOT_ID, class: 'codex-agent', default_class: 'codex-agent', kind: 'agent', config: {}, status: 'present', visibility: 'private', created_at: stamp, updated_at: stamp }],
      ['mock:search', { id: 'mock:search', name: 'Search Tool', description: 'Mock tool declaration', owner: ROOT_ID, class: 'mcp-tool', default_class: 'mcp-tool', kind: 'tool', config: {}, status: 'present', visibility: 'private', created_at: stamp, updated_at: stamp }],
      ['atoll-internal:registrar-seat', { id: 'atoll-internal:registrar-seat', name: 'Registrar Seat', owner: ROOT_ID, class: 'atoll-internal:registrar', default_class: 'atoll-internal:registrar', status: 'present', visibility: 'private', created_at: stamp, updated_at: stamp }],
      ['atoll-internal:svcactor', { id: 'atoll-internal:svcactor', name: 'Service Actor', owner: ROOT_ID, class: 'svcactor', default_class: 'svcactor', status: 'present', visibility: 'private', created_at: stamp, updated_at: stamp }],
    ]);
    this.channelTemplates = new Map([
      ['mock:team', { id: 'mock:team', name: 'Team channel', description: 'Mock team template', visibility: 'private', body: { declarations: [{ decl_id: 'mock:steward' }] }, status: 'present' }],
    ]);
    this.overlays = new Map();
    this.profiles = new Map([...this.channels.values()].map((channel) => [channel.id, { channel_id: channel.id, description: channel.description || '', serving: channel.open ? 1 : 0, endpoints: {} }]));
    this.devices = new Map([['local-device', { id: 'local-device', owner_principal: ROOT_ID, name: 'Mock local device', status: 'present', online: true, key: 'mock-device-key-never-observed' }]]);
    this.bindings = new Set();
    this.resources = new Map([...this.channels.keys()].map((id) => [id, new Map()]));
    this.files = new Map();
    for (const [index, seed] of (config.files || []).entries()) {
      const channel = this.channels.get(seed.channel_id);
      const store = this.resources.get(seed.channel_id);
      const segments = String(seed.path || '').split('/').filter(Boolean);
      if (!channel || !store || segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) continue;
      const encodedPath = segments.map((segment) => encodeURIComponent(segment)).join('/');
      const address = `daemon://local-device/${channel.qualified_name}/${encodedPath}`;
      const content = Buffer.from(String(seed.content || ''), 'utf8');
      const mediaType = seed.media_type || 'application/octet-stream';
      const resourceId = `file:seed:${seed.channel_id}:${index + 1}`;
      store.set(resourceId, { id: resourceId, resource_id: resourceId, kind: 'file', address, meta: { size: content.length, media_type: mediaType, available: true } });
      this.files.set(address, { content, mediaType, size: content.length });
    }
    this.tickets = new Map();
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
      owner_principal: ROOT_ID,
      description: channel.description || '',
      serving: channel.open ? 1 : 0,
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

  membershipRows(principalId) {
    return this.memberships
      .filter((entry) => entry.principal_id === principalId)
      .map((entry) => item({ ...entry }, null, `${entry.principal_id}:${entry.channel_id}`));
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

  createChannel(parentId, name, principalId = ROOT_ID) {
    const clean = String(name || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(clean)) throw new TypeError('channel name must use lowercase letters, numbers or hyphens');
    const parent = this.channel(parentId);
    if (!parent || parent.status !== 'present') throw new TypeError('parent channel does not exist');
    const id = `${parentId}.${clean}`;
    if (this.channels.has(id)) throw new TypeError('channel already exists');
    const channel = { id, name: clean, qualified_name: id, parent_id: parentId, internal: false, open: true, status: 'present' };
    this.channels.set(id, channel);
    const membership = { principal_id: principalId, channel_id: id, actor_id: `${principalId}-${clean}`, role: 'owner', status: 'active' };
    this.memberships.push(membership);
    this.rosters.set(id, createRoster(channel, this.memberships, this.clock));
    this.histories.set(id, []);
    return { ...channel };
  }

  introduceActor(channelId, spec) {
    const channel = this.channel(channelId);
    if (!channel || channel.status !== 'present') throw new TypeError('channel does not exist');
    if (!['human', 'agent', 'tool'].includes(spec?.kind)) throw new TypeError('actor kind must be human, agent or tool');
    let id;
    if (spec.kind === 'human') {
      if (!spec.principal || spec.decl_id) throw new TypeError('human requires principal and forbids decl_id');
      id = `${spec.principal}-${channel.name}`;
      if (!this.activeMembership(spec.principal, channelId)) {
        this.memberships.push({ principal_id: spec.principal, channel_id: channelId, actor_id: id, role: 'member', status: 'active' });
      }
    } else {
      if (!spec.decl_id || (spec.kind === 'tool' && spec.principal)) throw new TypeError('agent/tool requires decl_id; tool forbids principal');
      const knownKind = spec.decl_id === 'mock:search' ? 'tool'
        : ['mock:steward', 'mock:analyst', 'mock:reviewer'].includes(spec.decl_id) ? 'agent' : '';
      if (knownKind && knownKind !== spec.kind) {
        const error = new TypeError(`asserted kind ${spec.kind} does not match declaration kind ${knownKind}`);
        error.code = 'bad_payload';
        throw error;
      }
      id = `${spec.kind}-${this.nextId('actor')}`;
    }
    const rows = this.rosters.get(channelId) || [];
    if (!rows.some((entry) => entry.declared.id === id)) {
      rows.push(rosterItem({ id, kind: spec.kind, declId: spec.decl_id || '', name: spec.name || id, principal: spec.principal || '', description: 'Introduced by mock system actor' }, this.clock));
    }
    return { instance_id: id, created: true };
  }

  removeActor(channelId, actorId) {
    if (['system', 'coreactor', 'svcactor', 'registrar'].includes(actorId)) {
      const error = new TypeError('protected system actor cannot be removed');
      error.code = 'protected_actor';
      throw error;
    }
    const rows = this.rosters.get(channelId);
    if (!rows) throw new TypeError('channel does not exist');
    const index = rows.findIndex((entry) => entry.declared.id === actorId);
    if (index < 0) throw new TypeError('actor does not exist');
    const [removed] = rows.splice(index, 1);
    const membership = this.memberships.find((entry) => entry.channel_id === channelId && entry.actor_id === actorId && entry.status === 'active');
    if (membership) membership.status = 'revoked';
    return { removed: true };
  }

  restartActor(channelId, actorId) {
    const row = (this.rosters.get(channelId) || []).find((entry) => entry.declared.id === actorId);
    if (!row) throw new TypeError('actor does not exist');
    if (['system', 'coreactor', 'svcactor', 'registrar'].includes(actorId) || String(row.declared.decl_id || '').startsWith('peer:')) {
      const error = new TypeError('protected system actor cannot be restarted');
      error.code = 'protected_actor';
      throw error;
    }
    return { restarted: actorId };
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

  setOverlay(channelId, declId, config) {
    if (!this.channel(channelId) || !this.declarations.get(declId)) throw new TypeError('channel or declaration does not exist');
    this.overlays.set(`${channelId}:${declId}`, { channel_id: channelId, decl_id: declId, config: structuredClone(config) });
    return { channel_id: channelId, decl_id: declId, applied: true };
  }

  clearOverlay(channelId, declId) {
    this.overlays.delete(`${channelId}:${declId}`);
    return { channel_id: channelId, decl_id: declId, cleared: true };
  }

  setProfile(channelId, profile) {
    const channel = this.channel(channelId);
    if (!channel) throw new TypeError('channel does not exist');
    this.profiles.set(channelId, structuredClone(profile));
    channel.description = profile.description; channel.open = profile.serving > 0;
    return structuredClone(profile);
  }

  daemonRows() {
    return [...this.devices.values()].filter((row) => row.status === 'present').map((row) => item({ id: row.id, owner_principal: row.owner_principal, name: row.name, status: row.status, created_at: STAMP }, [measure('online', row.online, this.clock)]));
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
    row.status = 'retired'; this.bindings = new Set([...this.bindings].filter((value) => !value.endsWith(`:${id}`)));
    return { device_id: id, retired: true };
  }

  bindDevice(channelId, deviceId, attach) {
    if (!this.channel(channelId) || !this.devices.get(deviceId) || this.devices.get(deviceId).status !== 'present') throw new TypeError('channel or device does not exist');
    const key = `${channelId}:${deviceId}`;
    if (attach) this.bindings.add(key); else this.bindings.delete(key);
    return { channel_id: channelId, device_id: deviceId, attached: attach };
  }

  resource(channelId, payload) {
    const store = this.resources.get(channelId); if (!store) throw new TypeError('channel does not exist');
    const { op, resource_id: id, args } = payload;
    if (op === 'list') {
      const prefix = String(payload.query?.prefix || '');
      const rows = [...store.values()];
      if (prefix.startsWith('daemon://')) {
        return {
          items: rows
            .filter((row) => row.kind === 'file' && String(row.address || '').startsWith(prefix))
            .map((row) => ({ id: row.address, kind: 'file', ops: ['read', 'write', 'delete'], meta: structuredClone(row.meta || {}) })),
          next: null,
        };
      }
      return { items: rows.map((row) => structuredClone(row)), next: null };
    }
    if (op === 'create' && payload.address) {
      const resourceId = `file:${this.nextId('resource')}`;
      const row = { id: resourceId, resource_id: resourceId, kind: 'file', address: payload.address, meta: {} };
      store.set(resourceId, row);
      const ticket = this.issueTicket('put', payload.address, resourceId);
      return { status: 'ok', ticket, redeem: 'http', resource_id: resourceId, address: payload.address };
    }
    if (op === 'create') {
      if (store.has(id)) throw new TypeError('resource already exists');
      const row = { id, resource_id: id, kind: 'kv', value: structuredClone(args ?? {}) }; store.set(id, row); return { status: 'ok', resource_id: id, value: row.value };
    }
    const row = store.get(id) || [...store.values()].find((entry) => entry.address === id);
    if (op === 'stat') return { exists: Boolean(row), ...(row ? { meta: { kind: row.kind, ...(row.meta || {}) } } : {}) };
    if (!row) throw new TypeError('resource does not exist');
    if (op === 'read' && row.kind === 'file' && payload.with_content) return { status: 'ok', ticket: this.issueTicket('get', row.address, id), redeem: 'http', resource_id: id, address: row.address };
    if (op === 'read') return { status: 'ok', resource_id: id, value: structuredClone(row.value) };
    if (op === 'write') { row.value = structuredClone(args ?? {}); return { status: 'ok', resource_id: id, value: row.value }; }
    if (op === 'delete') { store.delete(row.id || id); if (row.address) this.files.delete(row.address); return { status: 'ok', resource_id: id, deleted: true }; }
    throw new TypeError('unsupported resource operation');
  }

  issueTicket(method, address, resourceId) {
    const ticket = this.nextId('ticket');
    this.tickets.set(ticket, { method, address, resourceId, expiresAt: this.clock + 60_000, used: false });
    return ticket;
  }

  redeemTicket(ticket, method, address) {
    const row = this.tickets.get(ticket);
    if (!row || row.method !== method || row.address !== address || row.expiresAt <= this.clock || (method === 'put' && row.used)) return null;
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
    const targets = ['attach', 'submit', 'resolve', 'cancel', 'after', 'cancel_timer', 'resource', 'observe', 'unobserve', 'receipt', 'feed', 'obs'];
    const modes = ['reject', 'delay', 'drop', 'partial'];
    if (!targets.includes(fault?.target)) throw new TypeError('unknown fault target');
    if (!modes.includes(fault?.mode)) throw new TypeError('unknown fault mode');
    const count = fault.count == null ? 1 : Number(fault.count);
    const delayMs = fault.delay_ms == null ? 0 : Number(fault.delay_ms);
    if (!Number.isSafeInteger(count) || count < 1) throw new TypeError('fault count must be a positive safe integer');
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) throw new TypeError('fault delay_ms must be a non-negative safe integer');
    const configured = { target: fault.target, mode: fault.mode, count, delay_ms: delayMs, code: fault.code || 'unavailable' };
    this.faults.push(configured);
    return { ...configured };
  }

  takeFault(target) {
    const index = this.faults.findIndex((fault) => fault.target === target && fault.count > 0);
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
      overlays: [...this.overlays.values()].map((row) => ({ channel_id: row.channel_id, decl_id: row.decl_id })),
      devices: [...this.devices.values()].map(({ key, ...row }) => row),
      bindings: [...this.bindings],
      resources: Object.fromEntries([...this.resources].map(([id, rows]) => [id, [...rows.values()].map((row) => ({ id: row.id, kind: row.kind, address: row.address }))])),
      tickets: [...this.tickets.values()].map((row) => ({ method: row.method, address: row.address, expiresAt: row.expiresAt, used: row.used })),
    };
  }
}

export const createMockDomain = (config) => new MockDomain(config);
