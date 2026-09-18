import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('test evidence integrity contracts', () => {
  test('shared setup does not mock a virtualizer or synthesize timeline geometry', () => {
    const setup = read('tests/setup.js');

    expect(setup).not.toMatch(/vi\.mock\(\s*['"]react-virtuoso['"]/);
    expect(setup).not.toMatch(/timeline-message-list|timeline-virtual-item|presentation-row/);
  });

  test('the unused Legend list dependency stays removed', () => {
    const manifest = JSON.parse(read('package.json'));

    expect(manifest.dependencies?.['@legendapp/list']).toBeUndefined();
    expect(manifest.devDependencies?.['@legendapp/list']).toBeUndefined();
    expect(read('package-lock.json')).not.toContain('@legendapp/list');
    expect(read('pnpm-lock.yaml')).not.toContain('@legendapp/list');
  });

  test('semantic list helper renders every supplied row', () => {
    const helper = read('tests/helpers/PresentationMessageList.jsx');

    expect(helper).toMatch(/const rows = snapshot\.rows;/);
    expect(helper).not.toMatch(/snapshot\.rows\s*\.\s*slice\s*\(/);
  });

  test('tests do not mock or inspect the removed MessageList module', () => {
    const offenders = globSync('tests/**/*.{js,jsx,mjs}', {
      cwd: new URL('..', import.meta.url),
    }).filter((path) => path !== 'tests/test-integrity-contract.test.js')
      .filter((path) => read(path).includes('src/ui/timeline/MessageList.jsx'));

    expect(offenders).toEqual([]);
  });

  // Chromium reports "ResizeObserver loop completed with undelivered
  // notifications" only through the page's own `error` event. Playwright's
  // `pageerror` and `console` channels stay silent — measured on 2026-09-18 by
  // the positive control in tests/browser/input-resize-observer-loop.spec.js:
  // 20 in-page errors and 20 app diagnostics for 0 Playwright reports. A spec
  // that claims the error is absent while watching only those two channels
  // asserts nothing at all.
  test('a spec may only claim a ResizeObserver loop is absent from a channel that sees it', () => {
    const detects = /addEventListener\(\s*['"]error['"]|resize_observer_loop/;
    const offenders = globSync('tests/browser/**/*.{js,jsx,mjs}', {
      cwd: new URL('..', import.meta.url),
    }).filter((path) => {
      const source = read(path);
      return /ResizeObserver loop/.test(source) && !detects.test(source);
    });

    expect(offenders).toEqual([]);
  });

  test('the unit runner excludes durable evidence sources', () => {
    const config = read('vite.config.js');

    expect(config).toMatch(/exclude:\s*\[[^\]]*['"]docs\/evidence\/\*\*['"]/s);
  });
});
