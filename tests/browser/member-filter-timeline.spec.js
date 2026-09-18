import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

async function productionFingerprint() {
  const paths = [
    'src/model/timeline-scope.js',
    'src/model/timeline-projection.js',
    'src/ui/Timeline.jsx',
    'src/ui/timeline/LegendMessageList.jsx',
  ];
  const hash = createHash('sha256');
  for (const path of paths) hash.update(path).update('\0').update(await readFile(path));
  return { paths, digest: hash.digest('hex') };
}

async function attachEvidence(testInfo, name, evidence) {
  const path = testInfo.outputPath(name);
  await writeFile(path, JSON.stringify({ source: await productionFingerprint(), ...evidence }, null, 2));
  await testInfo.attach(name, {
    path,
    contentType: 'application/json',
  });
}

async function reset(request, scenario, seed) {
  const response = await request.post('/mock/control/reset', { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

test('opaque member filter keeps a whole historical turn across roster and human incarnations', async ({ page }, testInfo) => {
  await page.goto('/tests/browser/fixtures/member-filter-timeline.html');
  await page.waitForFunction(() => Boolean(window.memberFilterTimeline));

  const stale = page.getByRole('button', {
    name: '移除已失效成员筛选 agent:claude:old-incarnation',
  });
  await expect(stale).toBeVisible();
  await expect(page.getByText('历史 Claude 问题')).toHaveCount(0);

  await page.evaluate(() => window.memberFilterTimeline.settleRoster());
  const claude = page.getByRole('group', { name: '按成员过滤' })
    .getByRole('button', { name: 'Claude', exact: true });
  await expect(claude).toBeVisible();
  await stale.click();

  const turn = page.locator('[data-presentation-row-id="ask-claude"]');
  await expect(turn).toContainText('历史 Claude 问题');
  await expect(turn).toContainText('历史 Claude 回答');
  await expect(page.getByText('正在确认频道内容…')).toHaveCount(0);
  await expect(page.getByText('正在恢复上次阅读位置…')).toHaveCount(0);

  await claude.click();
  await expect(claude).toHaveAttribute('aria-pressed', 'true');
  await expect(turn).toContainText('历史 Claude 回答');
  const filtered = await page.evaluate(() => window.memberFilterTimeline.snapshot());
  await attachEvidence(testInfo, 'member-filter-production-timeline.json', { filtered });
  expect(filtered.rowIDs).toEqual(['ask-claude']);
  expect(filtered.scopeDirectText).toEqual([]);
  expect(filtered.statuses).not.toContain('正在确认频道内容…');

  await claude.click();
  await expect(claude).toHaveAttribute('aria-pressed', 'false');
  await expect(turn).toContainText('历史 Claude 回答');
});

test('full AppShell shows one real agent chip without a bare zero and filters installed rows on its first frame', async ({ page, request }, testInfo) => {
  await reset(request, 'deep-history', 29_211);
  await login(page);
  await page.locator('.channel-item').filter({
    has: page.locator('.channel-name', { hasText: /^c0\.project$/ }),
  }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.getByText('c0.project history 120: ask project-agent for PONG', { exact: true })).toBeVisible();

  const filter = page.getByRole('group', { name: '按成员过滤' })
    .getByRole('button', { name: 'project-agent', exact: true });
  await expect(filter).toBeVisible();
  await page.evaluate(() => {
    window.__ATOLL_SINGLE_AGENT_TRACE__ = [];
    const sample = () => {
      const button = document.querySelector('.timeline-actor-filter button[aria-pressed="true"]');
      const scope = document.querySelector('[aria-label="动态范围"]');
      window.__ATOLL_SINGLE_AGENT_TRACE__.push({
        filtered: Boolean(button),
        rowCount: document.querySelectorAll('[data-presentation-row-id]').length,
        directText: [...(scope?.childNodes || [])]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent.trim()).filter(Boolean),
        confirming: [...document.querySelectorAll('.timeline-history-status')]
          .some((node) => node.textContent?.includes('确认频道内容')),
        restoring: [...document.querySelectorAll('[role="status"]')]
          .some((node) => node.textContent?.includes('恢复上次阅读位置')),
      });
      window.__ATOLL_SINGLE_AGENT_RAF__ = requestAnimationFrame(sample);
    };
    window.__ATOLL_SINGLE_AGENT_RAF__ = requestAnimationFrame(sample);
  });
  await filter.click();
  await page.waitForTimeout(250);
  const evidence = await page.evaluate(() => {
    cancelAnimationFrame(window.__ATOLL_SINGLE_AGENT_RAF__);
    return { frames: window.__ATOLL_SINGLE_AGENT_TRACE__ };
  });
  await attachEvidence(testInfo, 'member-filter-full-appshell.json', evidence);

  const filteredFrames = evidence.frames.filter((frame) => frame.filtered);
  expect(filteredFrames.length).toBeGreaterThan(0);
  expect(filteredFrames[0].rowCount).toBeGreaterThan(0);
  expect(filteredFrames.every((frame) => frame.directText.length === 0)).toBe(true);
  expect(filteredFrames.every((frame) => !frame.confirming && !frame.restoring)).toBe(true);
});
