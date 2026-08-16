const JSON_HEADERS = { 'Content-Type': 'application/json' };

export class IdentityError extends Error {
  constructor(status, code, detail) {
    super(detail || code || `identity request failed (${status})`);
    this.name = 'IdentityError';
    this.status = status;
    this.code = code || 'unknown';
    this.detail = detail || '';
  }
}

async function request(path, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(path, {
    ...options,
    credentials: 'include',
    headers: options.body ? { ...JSON_HEADERS, ...options.headers } : options.headers,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new IdentityError(response.status, body.code, body.detail);
  }
  return body;
}

export function createIdentityClient(fetchImpl = fetch) {
  return {
    login(email, password) {
      return request('/api/identity/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }, fetchImpl);
    },
    register({ id, email, password, display_name }) {
      const payload = { email, password };
      if (id) payload.id = id;
      if (display_name) payload.display_name = display_name;
      return request('/api/identity/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      }, fetchImpl);
    },
    logout() {
      return request('/api/identity/logout', { method: 'POST' }, fetchImpl);
    },
  };
}

const identity = createIdentityClient();
export const login = identity.login;
export const register = identity.register;
export const logout = identity.logout;
