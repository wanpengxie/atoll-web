// 全局 key：空间范围的一块 kv 命名空间，id 是 global/<name>。
//
// 它没有新入口。任何频道的资源面都认 global/ 前缀，并且都落到同一份存储上，所以
// 浏览器用的就是已有的 resource 帧（list/create/read/write/delete/stat），只是
// resource_id 以 global/ 开头。成员配置里写 "$global.<name>" 引用它。
//
// 值按 JSON 字符串存：args 本身是 JSON，所以 "sk-..." 就是 args 的值。界面恒不
// 读出、恒不显示值——列表只列名字，改值是整值覆盖写。

export const GLOBAL_PREFIX = 'global/';
export const GLOBAL_REFERENCE_PREFIX = '$global.';
export const GLOBAL_NAME_PATTERN = /^[a-z0-9_-]{1,64}$/;
export const GLOBAL_NAME_HINT = '1–64 位小写字母、数字、下划线或连字符';

const LIST_PAGE_LIMIT = 500;
const LIST_PAGE_MAX = 20;

export function isGlobalName(name) {
  return typeof name === 'string' && GLOBAL_NAME_PATTERN.test(name);
}

export function globalResourceId(name) {
  const value = String(name ?? '').trim();
  if (!isGlobalName(value)) throw new TypeError(`全局 key 名称须为${GLOBAL_NAME_HINT}`);
  return `${GLOBAL_PREFIX}${value}`;
}

export function globalNameOf(resourceId) {
  const id = String(resourceId ?? '');
  if (!id.startsWith(GLOBAL_PREFIX)) return '';
  const name = id.slice(GLOBAL_PREFIX.length);
  return isGlobalName(name) ? name : '';
}

export function isGlobalResourceId(resourceId) {
  return Boolean(globalNameOf(resourceId));
}

export function globalReference(name) {
  return `${GLOBAL_REFERENCE_PREFIX}${globalNameOf(globalResourceId(name))}`;
}

// 回给别人看的只有掩码："****" 加末四位。四位以内的值末四位就是全部，所以只给
// "****"——掩码的意义是让人认出是哪一把，而不是把短值原样交出去。
export function maskSecret(value) {
  const text = String(value ?? '');
  return text.length > 4 ? `****${text.slice(-4)}` : '****';
}

export function globalKeyNames(items = []) {
  const names = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const name = globalNameOf(item?.id ?? item?.resource_id);
    if (name) names.add(name);
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

function conflict(error) {
  const code = String(error?.code || '');
  return code === 'conflict_exists' || code === 'already_exists' || /already exists/i.test(String(error?.detail || error?.message || ''));
}

// `resource` 是已绑定频道的发送端：(payload without channel_id) => Promise<receipt>。
export async function listGlobalKeys(resource) {
  const items = [];
  let cursor = '';
  for (let page = 0; page < LIST_PAGE_MAX; page += 1) {
    const receipt = await resource({
      op: 'list',
      query: { prefix: GLOBAL_PREFIX, limit: LIST_PAGE_LIMIT, ...(cursor ? { cursor } : {}) },
    });
    items.push(...(Array.isArray(receipt?.items) ? receipt.items : []));
    cursor = String(receipt?.next || '');
    if (!cursor) break;
  }
  return globalKeyNames(items);
}

// 不存在就 create，存在就 write；值恒是 JSON 字符串。create 撞上并发的同名创建
// 时退回 write——两种结局对调用方都是"这个名字现在存着这个值"。
export async function writeGlobalValue(resource, name, value) {
  const resourceId = globalResourceId(name);
  if (typeof value !== 'string') throw new TypeError('全局 key 的值必须是字符串');
  const stat = await resource({ op: 'stat', resource_id: resourceId });
  if (stat?.exists === true) {
    await resource({ op: 'write', resource_id: resourceId, args: value });
    return Object.freeze({ resourceId, created: false });
  }
  try {
    await resource({ op: 'create', resource_id: resourceId, args: value });
    return Object.freeze({ resourceId, created: true });
  } catch (error) {
    if (!conflict(error)) throw error;
    await resource({ op: 'write', resource_id: resourceId, args: value });
    return Object.freeze({ resourceId, created: false });
  }
}

export async function createGlobalKey(resource, name, value) {
  const resourceId = globalResourceId(name);
  if (typeof value !== 'string' || !value) throw new TypeError('全局 key 的值不能为空');
  await resource({ op: 'create', resource_id: resourceId, args: value });
  return resourceId;
}

// 覆盖一个已有的 key。不存在时照实报错，不顺手建一个——"改值"不该复活刚删掉的名字。
export async function overwriteGlobalKey(resource, name, value) {
  const resourceId = globalResourceId(name);
  if (typeof value !== 'string' || !value) throw new TypeError('全局 key 的值不能为空');
  await resource({ op: 'write', resource_id: resourceId, args: value });
  return resourceId;
}

export async function deleteGlobalKey(resource, name) {
  const resourceId = globalResourceId(name);
  await resource({ op: 'delete', resource_id: resourceId });
  return resourceId;
}
