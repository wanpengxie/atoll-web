import { defaultUrlTransform } from 'react-markdown';

// An object-storage address names one stored file by who keeps it and whose it
// is: oss://<storage channel>/<host channel>/<path>, both channels by qualified
// name (c0.storage, c0.dev). The bytes are read from the URL the host
// channel's storage seat signs for that path (storage.get_url), never through
// the node.
export const STORAGE_SCHEME = 'oss://';
const MAX_PATH_BYTES = 1024;

export function isStorageAddress(value) {
  return typeof value === 'string' && value.startsWith(STORAGE_SCHEME);
}

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

// Markdown hands a link destination URI-encoded (a Chinese file name arrives
// as %E6…); the storage manager knows the path as it was written. Each segment
// is decoded on its own, so an encoded "/" can never become a separator.
export function parseStorageAddress(value) {
  const raw = String(value || '').trim();
  if (!isStorageAddress(raw)) return null;
  const rest = raw.slice(STORAGE_SCHEME.length);
  if (/[\s?#]/.test(rest)) return null;
  const parts = rest.split('/');
  if (parts.length < 3) return null;
  const [storageChannel, hostChannel, ...encodedPath] = parts.map(decodeSegment);
  if (!storageChannel || !hostChannel || [storageChannel, hostChannel].some((name) => name.includes('/'))) return null;
  const segments = encodedPath;
  if (!segments.length || segments.some((segment) => segment == null || segment === '' || segment === '.' || segment === '..' || segment.includes('/'))) return null;
  const path = segments.join('/');
  if (new TextEncoder().encode(path).byteLength > MAX_PATH_BYTES) return null;
  return Object.freeze({
    address: `${STORAGE_SCHEME}${storageChannel}/${hostChannel}/${path}`,
    storageChannel,
    hostChannel,
    path,
    name: segments.at(-1),
  });
}

// react-markdown drops every scheme it does not know. A link to a stored file
// is kept so it can be opened in Atoll; an image source is not (the browser
// cannot load oss: itself), and every other value keeps the default filter —
// javascript: and friends still become an empty href.
export function storageUrlTransform(url, key) {
  if (key === 'href' && isStorageAddress(url)) return url;
  return defaultUrlTransform(url);
}

// Bare text is a link too: an agent writing "saved to oss://c0.storage/c0.dev/a.pdf"
// means that file. Trailing sentence punctuation is not part of the address.
const BARE_ADDRESS = /oss:\/\/[^\s<>()[\]{}"'`，。；、！？（）【】《》]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?'"]+$/;
const LINK_PARENTS = new Set(['link', 'linkReference']);

function linkifyText(node) {
  const value = String(node.value || '');
  if (!value.includes(STORAGE_SCHEME)) return null;
  const out = [];
  let cursor = 0;
  for (const match of value.matchAll(BARE_ADDRESS)) {
    const candidate = match[0].replace(TRAILING_PUNCTUATION, '');
    if (!parseStorageAddress(candidate)) continue;
    if (match.index > cursor) out.push({ type: 'text', value: value.slice(cursor, match.index) });
    out.push({ type: 'link', url: candidate, title: null, children: [{ type: 'text', value: candidate }] });
    cursor = match.index + candidate.length;
  }
  if (!out.length) return null;
  if (cursor < value.length) out.push({ type: 'text', value: value.slice(cursor) });
  return out;
}

function linkifyChildren(parent) {
  if (!Array.isArray(parent?.children) || LINK_PARENTS.has(parent.type)) return;
  for (let index = 0; index < parent.children.length; index += 1) {
    const child = parent.children[index];
    if (child?.type === 'text') {
      const replaced = linkifyText(child);
      if (replaced) {
        parent.children.splice(index, 1, ...replaced);
        index += replaced.length - 1;
      }
      continue;
    }
    linkifyChildren(child);
  }
}

export function remarkStorageLinks() {
  return (tree) => {
    linkifyChildren(tree);
  };
}

// The reference a Markdown link hands to the file-opening context.
export function storageFileReference(parsed) {
  return Object.freeze({ resource_id: parsed.address, address: parsed.address, name: parsed.name });
}
