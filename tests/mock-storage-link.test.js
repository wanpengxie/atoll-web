import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createMockServer } from '../mock/server.mjs';
import { createIdentityClient } from '../src/net/identity.js';
import { createWire } from '../src/net/wire.js';

const servers = new Set();
async function listen(server) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); servers.add(server); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { if (!servers.delete(server)) return; server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
async function waitFor(predicate, timeout = 3000) { const start = Date.now(); while (Date.now() - start < timeout) { const value = predicate(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error('timed out'); }

async function harness() {
  const server = createMockServer({ rootPassword: 'test-root', scenario: 'storage-link', liveIntervalMs: 0 });
  const baseURL = await listen(server); let cookie = '';
  const fetchSession = async (path, options = {}) => { const headers = new Headers(options.headers); if (cookie) headers.set('Cookie', cookie); const response = await fetch(`${baseURL}${path}`, { ...options, headers }); const next = response.headers.get('set-cookie'); if (next) cookie = next.split(';', 1)[0]; return response; };
  await createIdentityClient(fetchSession).login('root@atoll.local', 'test-root');
  class SessionWebSocket extends WebSocket { constructor(url) { super(url, { headers: { Cookie: cookie } }); } }
  const envelopes = []; const states = [];
  const wire = createWire({ url: `${baseURL.replace('http', 'ws')}/ws`, WebSocketImpl: SessionWebSocket, onState: (state) => states.push(state), onFeed: (_channel, _seq, envelope) => envelopes.push(envelope) });
  await waitFor(() => states.includes('attached'));
  return { server, baseURL, fetchSession, wire, envelopes };
}

async function submitTerminal(h, msgType, payload, audience, channelId = 'c0.dev') {
  const receipt = await h.wire.submit({ channel_id: channelId, msg_type: msgType, kind: 'request', payload, audience });
  return waitFor(() => h.envelopes.find((row) => row.parent_id === receipt.message_id && ['completed', 'failed'].includes(row.payload?.body?.status)));
}

afterEach(async () => Promise.all([...servers].map(close)));

describe('storage-link mock: a seat to c0.storage and a cross-origin bucket', () => {
  it('lists the seat as the node does and signs a URL the bucket serves to any origin', async () => {
    const h = await harness();
    const roster = await h.fetchSession('/obs/channel/c0.dev/actors').then((response) => response.json());
    const seat = roster.items.find((item) => item.declared.body === 'class channel-seat');
    expect(seat.declared).toMatchObject({ kind: 'channel', name: 'storage' });
    const seatId = seat.declared.id;

    const member = await submitTerminal(h, 'system.member.get', { member: seatId }, ['system']);
    expect(member.payload.body).toMatchObject({ status: 'completed', body: { class: 'channel-seat' }, params: { body: 'c0.storage' } });
    const describe = await submitTerminal(h, 'actor.describe', {}, [seatId]);
    expect(Object.keys(describe.payload.body.words)).toContain('storage.get_url');

    const signed = await submitTerminal(h, 'storage.get_url', { path: 'reports/q3-notes.txt', inline: true }, [seatId]);
    expect(signed.payload.body).toMatchObject({ status: 'completed', media_type: 'text/plain' });
    const url = new URL(signed.payload.body.url);
    expect(url.origin).toBe(h.baseURL);
    expect(Date.parse(signed.payload.body.expires_at)).toBeGreaterThan(Date.now());

    // No cookie: the signature is the only credential.
    const response = await fetch(url, { headers: { Origin: 'http://127.0.0.1:15173' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-expose-headers')).toContain('Content-Length');
    expect(response.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(await response.text()).toContain('Q3 纪要');
    expect(Number(response.headers.get('content-length'))).toBe(signed.payload.body.size);

    const tampered = new URL(url); tampered.searchParams.set('disp', 'attachment');
    expect((await fetch(tampered)).status).toBe(403);

    const missing = await submitTerminal(h, 'storage.get_url', { path: 'reports/none.pdf' }, [seatId]);
    expect(missing.payload.body).toMatchObject({ status: 'failed', error_code: 'not_found' });
    const escape = await submitTerminal(h, 'storage.get_url', { path: '../c0.cvmax/x.pdf' }, [seatId]);
    expect(escape.payload.body).toMatchObject({ status: 'failed', error_code: 'invalid_args' });
    h.wire.close(); await close(h.server);
  });
});
