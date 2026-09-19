import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const checker = path.join(root, 'audit-output/frontend-subtractive-c1-c7-acd272a/check-architecture.mjs');

describe('frontend subtractive architecture checker', () => {
  it('treats App probe read ports as consumption and the lifecycle constructor as ownership', () => {
    const appSource = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
    const ownerSource = fs.readFileSync(path.join(root, 'src/app/hooks/useAgentProbes.js'), 'utf8');
    expect(appSource).toMatch(/contextProbedRef/);
    expect(appSource).toMatch(/optionsProbedRef/);
    expect(appSource).not.toMatch(/createAgentProbeLifecycle\s*\(/);
    expect(ownerSource.match(/createAgentProbeLifecycle\s*\(/g)).toHaveLength(1);

    let output = '';
    try {
      output = execFileSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
    } catch (error) {
      // The checker also reports unrelated tracked worktree changes. Its JSON
      // remains the authority for the structural assertions in this test.
      output = error.stdout;
    }
    const result = JSON.parse(output);
    expect(result.c1LifecycleCapabilities.agentProbeLifecycle).toEqual([
      'src/app/hooks/useAgentProbes.js',
    ]);
    expect(result.c1ToC7.find((check) => check.id === 'C1')?.violations).toEqual([]);
  });
});
