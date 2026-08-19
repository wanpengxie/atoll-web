import { describe, expect, it } from 'vitest';
import { isSystemDeclaration, resolveManagementActors, SYSTEM_ACTOR } from '../src/model/management-actors.js';

describe('management actor resolver', () => {
  it('总是解析到本频道的 system actor，名册里没有它时用恒定描述兜底', () => {
    const listed = resolveManagementActors([{ id: 'system', kind: 'system', name: 'system' }, { id: 'some-tool', kind: 'tool' }]);
    expect(listed.system.id).toBe('system');
    // system.member.list 不列自己，所以名册里通常看不到 system actor。
    const absent = resolveManagementActors([{ id: 'some-tool', kind: 'tool' }]);
    expect(absent.system).toEqual(SYSTEM_ACTOR);
  });

  it('识别 genesis 铸出的系统声明', () => {
    expect(isSystemDeclaration('registrar')).toBe(true);
    expect(isSystemDeclaration('svcactor')).toBe(true);
    expect(isSystemDeclaration('peer:c0.lobby')).toBe(true);
    expect(isSystemDeclaration('mock:steward')).toBe(false);
  });
});
