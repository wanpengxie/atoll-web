// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  forgetCachedPrincipal, readCachedPrincipal, readWorkspaceBootstrap,
  rememberCachedPrincipal, writeWorkspaceBootstrap,
} from '../src/model/workspace-bootstrap-cache.js';

afterEach(() => localStorage.clear());

describe('workspace bootstrap cache', () => {
  it('restores the small identity, membership and profile manifest without mixing principals', () => {
    rememberCachedPrincipal({ id: 'root', display_name: 'Root' });
    writeWorkspaceBootstrap('root', { channels: [{
      channelId: 'c0', relationship: 'member', selfActorId: 'human:root',
      profile: { id: 'c0', name: 'home', open: true },
    }] });
    expect(readCachedPrincipal()).toEqual({ id: 'root', display_name: 'Root' });
    expect(readWorkspaceBootstrap('root')).toMatchObject({
      profiles: [{ id: 'c0', name: 'home', open: true }],
      memberships: [{ channel_id: 'c0', actor_id: 'human:root', status: 'active' }],
	  rosters: {},
    });
    expect(readWorkspaceBootstrap('alice')).toEqual({ profiles: [], memberships: [], rosters: {} });
    forgetCachedPrincipal();
    expect(readCachedPrincipal()).toBeNull();
  });
});
