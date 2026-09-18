import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('test evidence integrity contracts', () => {
  test('shared setup does not mock a virtualizer or synthesize timeline geometry', () => {
    const setup = read('tests/setup.js');

    expect(setup).not.toMatch(/vi\.mock\(\s*['"](?:react-virtuoso|@legendapp\/list(?:\/react)?)['"]/);
    expect(setup).not.toMatch(/timeline-message-list|timeline-virtual-item|presentation-row/);
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

  test('the unit runner excludes durable evidence sources', () => {
    const config = read('vite.config.js');

    expect(config).toMatch(/exclude:\s*\[[^\]]*['"]docs\/evidence\/\*\*['"]/s);
  });
});
