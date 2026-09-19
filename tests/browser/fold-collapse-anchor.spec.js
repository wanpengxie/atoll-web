import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// H — 折叠锚点。两种读者报告的"跳"在这里被量成数字：
//   1) 收起时手指下的控件跳走（用户手势引起的尺寸骤减）；
//   2) 顶部大跳：读者在历史里浏览，新消息到达使上一条失去 current-entry
//      角色而自动折叠，读者眼前的内容被拽走（非用户手势引起的尺寸骤减）。
//
// oracle 说明（这条是本 spec 的核心，前任版本与我的第一版都选错过）：
// 收起使锚点上方的内容缩短时，scroller 的 scrollTop 必须同量减少才能把锚点
// 留在原处——那个大数值的 scrollTop 变化是**合法补偿**，不是缺陷。同样，
// "scrollTop_before 超过收起后的 maxScrollTop" 也**不是**豁免理由：列表本来
// 就要把 scrollTop 往下调，调完之后远在可滚范围之内（诊断证据 diag7：应到
// 4452，maxScrollTop_after=6090，根本不需要夹限）。拿它当豁免等于用缺陷本身
// 给缺陷开脱。
//
// 正确判据：被收起的那条消息，其折叠控件位于正文**下方**，所以收缩量全部发生
// 在锚点上方。于是维持锚点所需的落点是确定的：
//     desired = scrollTop_before − shrink
// 只有当 desired 落在 [0, maxScrollTop_after] 之外时，锚点才不得不移动，移动量
// 就是被夹掉的那一段；这是物理必然，给预算。除此之外锚点必须一动不动。
//     allowedDrift = |clamp(desired, 0, maxScrollTop_after) − desired|
//     excessDrift  = max(0, |实际位移| − allowedDrift)
// §9.10.12 记录的真实大跳（按钮 412→466→2241）就是靠这条判据被抓住的。

const OUT = '/tmp/H-53cb1122-out';
const SCROLLER = '.timeline-message-list';
const TOLERANCE = 8;

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

async function chooseSteward(page) {
  const choose = page.getByRole('button', { name: '选择 Agent' });
  await expect(choose).toBeVisible();
  await choose.click();
  await page.getByRole('menu', { name: '选择目标 Agent' })
    .getByRole('menuitem', { name: 'steward' }).click();
}

async function send(page, text) {
  await page.getByTestId('composer-input').fill(text);
  await page.getByRole('button', { name: /发送/ }).click();
}

function longBody(marker, lines = 46) {
  return [marker, ...Array.from({ length: lines }, (_, i) => `${marker} 正文第 ${i + 1} 行，用来把这条消息推过折叠阈值。`)].join('\n');
}

// 逐 rAF 采样。每帧重新按 selector 查询（虚拟化会换 DOM 节点），记录锚点视口
// top 与 scroller 的 scrollTop / scrollHeight / clientHeight。采样在触发动作
// 之前就开始跑，跨越那一帧。
async function startSampling(page, anchorSelector) {
  await page.evaluate(({ anchorSelector, scrollerSelector }) => {
    window.__foldFrames = [];
    window.__foldSampling = true;
    const tick = () => {
      if (!window.__foldSampling) return;
      const scroller = document.querySelector(scrollerSelector);
      const anchor = document.querySelector(anchorSelector);
      const rect = anchor?.getBoundingClientRect();
      window.__foldFrames.push({
        at: Math.round(performance.now()),
        present: Boolean(anchor),
        top: rect ? Math.round(rect.top * 100) / 100 : null,
        expanded: anchor?.getAttribute('aria-expanded') ?? null,
        scrollTop: Math.round((scroller?.scrollTop || 0) * 100) / 100,
        scrollHeight: Math.round(scroller?.scrollHeight || 0),
        clientHeight: Math.round(scroller?.clientHeight || 0),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { anchorSelector, scrollerSelector: SCROLLER });
}

async function stopSampling(page) {
  return page.evaluate(() => {
    window.__foldSampling = false;
    return window.__foldFrames;
  });
}

async function readScroller(page) {
  return page.evaluate((scrollerSelector) => {
    const scroller = document.querySelector(scrollerSelector);
    return {
      scrollTop: Math.round(scroller.scrollTop * 100) / 100,
      scrollHeight: Math.round(scroller.scrollHeight),
      clientHeight: Math.round(scroller.clientHeight),
      maxScrollTop: Math.round(scroller.scrollHeight - scroller.clientHeight),
    };
  }, SCROLLER);
}

async function readGeometry(page, anchorSelector) {
  return page.evaluate(({ anchorSelector, scrollerSelector }) => {
    const anchor = document.querySelector(anchorSelector);
    const scroller = document.querySelector(scrollerSelector);
    const rect = anchor.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    return {
      top: Math.round(rect.top * 100) / 100,
      viewportTop: Math.round(box.top * 100) / 100,
      viewportBottom: Math.round(box.bottom * 100) / 100,
      scrollTop: Math.round(scroller.scrollTop * 100) / 100,
      scrollHeight: Math.round(scroller.scrollHeight),
      clientHeight: Math.round(scroller.clientHeight),
      maxScrollTop: Math.round(scroller.scrollHeight - scroller.clientHeight),
      belowRoom: Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop),
      mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
    };
  }, { anchorSelector, scrollerSelector: SCROLLER });
}

// 判据见文件头。after 由调用方给出收起后的稳定几何。
function analyse(before, after, frames) {
  const round = (value) => Math.round(value * 100) / 100;
  const seen = frames.filter((row) => row.present && row.top != null);
  const settled = seen.at(-1) || null;
  // 收缩量全在锚点上方：折叠控件渲染在正文下方。
  const shrink = before.scrollHeight - after.scrollHeight;
  const desired = before.scrollTop - shrink;
  const clamped = Math.min(Math.max(desired, 0), after.maxScrollTop);
  const allowedDrift = round(Math.abs(clamped - desired));
  let worstDrift = 0;
  let worstFrameAt = null;
  for (const frame of seen) {
    const drift = Math.abs(frame.top - before.top);
    if (drift > worstDrift) { worstDrift = drift; worstFrameAt = frame.at; }
  }
  let maxFrameStep = 0;
  for (let i = 1; i < frames.length; i += 1) {
    const a = frames[i - 1];
    const b = frames[i];
    if (a.present && b.present) maxFrameStep = Math.max(maxFrameStep, Math.abs(b.top - a.top));
  }
  // 锚点行被滚出物化范围，等于读者盯着的东西直接消失：按整屏位移计。
  const vanished = frames.some((row) => !row.present);
  const effectiveWorst = vanished ? Math.max(worstDrift, before.clientHeight) : worstDrift;
  return {
    beforeTop: before.top,
    beforeScrollTop: before.scrollTop,
    shrink,
    desiredScrollTop: round(desired),
    settledScrollTop: after.scrollTop,
    settledTop: settled?.top ?? null,
    maxScrollTopAfter: after.maxScrollTop,
    // scrollDelta 只记录不判：锚上方的内容收缩必然带来同量的 scrollTop 变化。
    scrollDelta: round(after.scrollTop - before.scrollTop),
    compensationError: round(after.scrollTop - desired),
    anchorDrift: settled ? round(settled.top - before.top) : null,
    allowedDrift,
    worstDrift: round(worstDrift),
    worstFrameAt,
    excessDrift: round(Math.max(0, effectiveWorst - allowedDrift)),
    maxFrameStep: round(maxFrameStep),
    vanished,
    unmountedFrames: frames.filter((row) => !row.present).length,
    frameCount: frames.length,
  };
}

async function record(testInfo, name, payload) {
  await mkdir(OUT, { recursive: true });
  const body = JSON.stringify(payload, null, 2);
  await writeFile(`${OUT}/${name}.json`, body);
  const evidencePath = testInfo.outputPath(`${name}.json`);
  await writeFile(evidencePath, body);
  await testInfo.attach(`${name}.json`, { path: evidencePath, contentType: 'application/json' });
}

// 用真实滚轮把锚点调到目标视口比例处。ratio=0.5 视口中部（上下都有余量），
// ratio=0.15 靠近顶部（下方余量被吃掉，clamp 可能成立）。
async function placeAnchor(page, anchorSelector, ratio) {
  const scroller = page.locator(SCROLLER);
  for (let attempt = 0; attempt < 28; attempt += 1) {
    const geometry = await page.evaluate(({ anchorSelector, scrollerSelector, ratio }) => {
      const anchor = document.querySelector(anchorSelector);
      const scroller = document.querySelector(scrollerSelector);
      if (!anchor || !scroller) return null;
      const rect = anchor.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      return { offset: rect.top - (box.top + box.height * ratio) };
    }, { anchorSelector, scrollerSelector: SCROLLER, ratio });
    if (!geometry) {
      await page.waitForTimeout(120);
      continue;
    }
    if (Math.abs(geometry.offset) < 40) return true;
    await scroller.hover();
    await page.mouse.wheel(0, Math.max(-600, Math.min(600, Math.round(geometry.offset))));
    await page.waitForTimeout(160);
  }
  return false;
}

async function seedLongHistory(page, request, markers) {
  const reset = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario: 'deep-history', seed: 20260918 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await chooseSteward(page);
  for (const marker of markers) {
    await send(page, longBody(marker));
    await expect(page.locator('[data-presentation-row-id]').filter({ hasText: marker }).first()).toBeVisible();
  }
}

function rowOf(page, marker) {
  return page.locator('[data-presentation-row-id]').filter({ hasText: marker }).first();
}

// The production list is virtualized: semantic rows stay in the presentation
// but only the current viewport is mounted. Reaching a row is therefore a
// reader action, not a locator retry. Walk the real scroller until the row is
// materialized before measuring its fold geometry.
async function revealRow(page, marker) {
  const scroller = page.locator(SCROLLER);
  const row = rowOf(page, marker);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await row.count() && await row.boundingBox()) return row;
    await scroller.hover();
    await page.mouse.wheel(0, -Math.max(320, Math.round((await scroller.evaluate((node) => node.clientHeight)) * 0.8)));
    await page.waitForTimeout(80);
  }
  return row;
}

// ——— 1/2：用户手势收起 ————————————————————————————————————————————
// 同一动作在两种放置下各跑一遍：视口中部（clamp 预算为 0，任何位移都是缺陷）
// 与靠近顶部（下方余量少，允许 clamp 预算内的位移）。
for (const placement of [
  { name: 'mid-viewport', ratio: 0.5, label: '视口中部（clamp 不成立）' },
  { name: 'near-top', ratio: 0.15, label: '靠近视口顶部（下方余量少，允许 clamp）' },
]) {
  test(`收起：${placement.label}，读者点下的控件不得超出 clamp 预算`, async ({ page, request }, testInfo) => {
    test.setTimeout(300_000);
    const markers = Array.from({ length: 6 }, (_, i) => `H-FOLD-${placement.name}-${i + 1}`);
    await seedLongHistory(page, request, markers);
    // 末尾一条短消息：上面全部失去 current-entry 角色，按裁定默认折叠。
    await send(page, '收尾短消息：上面全部转为历史。');
    await page.waitForTimeout(500);

    const rounds = [];
    for (const marker of [markers[4], markers[3], markers[2]]) {
      const row = await revealRow(page, marker);
      const expandToggle = row.locator('.message-fold-toggle').first();
      await expect(expandToggle).toBeVisible();
      await expect(expandToggle).toHaveAttribute('aria-expanded', 'false');
      await expandToggle.click();
      await expect(row.locator('.message-fold-toggle').first()).toHaveAttribute('aria-expanded', 'true');
      await page.waitForTimeout(400);

      const foldId = await row.locator('.message-fold-toggle').first().getAttribute('data-fold-id');
      const anchorSelector = `.message-fold-toggle[data-fold-id="${foldId}"]`;
      expect(await placeAnchor(page, anchorSelector, placement.ratio), `未能把 ${marker} 的折叠控件放到目标位置`).toBe(true);
      await page.waitForTimeout(300);

      const before = await readGeometry(page, anchorSelector);
      await startSampling(page, anchorSelector);
      await page.locator(anchorSelector).click();
      await page.waitForTimeout(700);
      const frames = await stopSampling(page);
      const after = await readScroller(page);
      rounds.push({ marker, foldId, before, after, report: analyse(before, after, frames), frames });
      // 下一轮要重新展开它：先把它带回视口。
      await placeAnchor(page, anchorSelector, 0.5);
    }

    await record(testInfo, `collapse-anchor-${placement.name}`, { placement, rounds });
    for (const round of rounds) {
      const context = `${round.marker} ${JSON.stringify({ before: round.before, after: round.after, report: round.report })}`;
      // 读者点下的控件留在原位（逐帧，不只是稳定帧）。
      expect(round.report.excessDrift, context).toBeLessThanOrEqual(TOLERANCE);
      // 没有跨帧大跳。
      expect(round.report.maxFrameStep, context).toBeLessThanOrEqual(round.report.allowedDrift + TOLERANCE);
      // 被点的那一行恒不许在收起过程中被滚出物化范围。
      expect(round.report.vanished, context).toBe(false);
    }
  });
}

// ——— 3：顶部大跳 ————————————————————————————————————————————————
// 读者停在历史里；一条新消息到达把 current-entry 角色从那条长消息上拿走，
// 它于是自动折叠。这不是用户手势，读者眼前的内容恒不许因此移动。
test('角色转移导致的自动折叠，不得移动正在阅读的内容', async ({ page, request }, testInfo) => {
  test.setTimeout(300_000);
  const markers = Array.from({ length: 6 }, (_, i) => `H-ROLE-${i + 1}`);
  await seedLongHistory(page, request, markers);
  await page.waitForTimeout(600);

  // 末条是长消息且持有 current-entry 角色 → 默认展开。
  const latestRow = await revealRow(page, markers[5]);
  await expect(latestRow.locator('.message-fold-toggle').first()).toHaveAttribute('aria-expanded', 'true');

  // 读者上滑到历史里；锚点取一条仍在视口内的更早消息。
  const anchorMarker = markers[1];
  const anchorRow = await revealRow(page, anchorMarker);
  const anchorRowId = await anchorRow.getAttribute('data-presentation-row-id');
  const anchorSelector = `[data-presentation-row-id="${anchorRowId}"]`;
  expect(await placeAnchor(page, anchorSelector, 0.35), '未能把历史锚点放进视口').toBe(true);
  await page.waitForTimeout(400);

  const before = await readGeometry(page, anchorSelector);
  expect(before.mode, JSON.stringify(before)).toBe('browsing');
  // 前置条件：读者离底部还很远，自动折叠对他的阅读位置本该完全无关。
  expect(before.belowRoom, JSON.stringify(before)).toBeGreaterThan(before.clientHeight);

  await startSampling(page, anchorSelector);
  // pulse 的奇数 tick 落在 c0；两条保证 c0 至少收到一条真实 live 到达。
  for (let i = 0; i < 2; i += 1) {
    const pulse = await request.post(`${MOCK}/mock/control/action`, { data: { type: 'pulse' } });
    expect(pulse.ok()).toBe(true);
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(800);
  const frames = await stopSampling(page);
  const after = await readGeometry(page, anchorSelector);
  const report = analyse(before, after, frames);
  const latestFolded = await (await revealRow(page, markers[5])).locator('.message-fold-toggle').first().getAttribute('aria-expanded');
  await record(testInfo, 'role-transition-anchor', { anchorMarker, before, after, latestFolded, report, frames });

  // 角色确实转移了（否则这条 spec 什么都没测）。
  expect(latestFolded, '末条长消息在新到达后仍持有 current-entry 角色，用例前提不成立').toBe('false');
  const context = JSON.stringify({ before, after, report });
  expect(report.excessDrift, context).toBeLessThanOrEqual(TOLERANCE);
  expect(report.maxFrameStep, context).toBeLessThanOrEqual(report.allowedDrift + TOLERANCE);
});
