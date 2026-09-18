import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

function captureHistoryFrames(page) {
  const frames = [];
  page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
    try {
      const frame = JSON.parse(String(payload));
      if (frame?.frame_type === 'page_end' || frame?.payload?.source === 'history') frames.push(frame);
    } catch {
      // Binary/non-JSON frames are outside the Gateway history contract.
    }
  }));
  return frames;
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await page.waitForFunction(() => document.querySelector('.connection-state.state-open'));
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'c0');
  await page.waitForFunction(() => document.querySelector('.timeline-message-list')?.clientHeight > 0);
}

async function canonicalSnapshot(page) {
  return page.evaluate(() => {
    const host = document.querySelector('.timeline');
    const fiberKey = host && Object.keys(host).find((key) => key.startsWith('__reactFiber$'));
    let fiber = fiberKey ? host[fiberKey] : null;
    while (fiber && fiber.elementType?.name !== 'Timeline') fiber = fiber.return;
    const props = fiber?.memoizedProps || {};
    const state = props.state;
    const waitingIDs = [...document.querySelectorAll('.agent-wait-item')]
      .map((node) => node.dataset.requestId || '')
      .filter(Boolean);
    return {
      controlCurrent: props.history?.status?.controlCurrent === true,
      generation: Number(props.history?.status?.generation || 0),
      waitingIDs,
      turns: waitingIDs.map((requestId) => {
        const turn = state?.turns?.get?.(requestId);
        return {
          requestId,
          requestSeq: Number(turn?.requestSeq || 0),
          provisional: (turn?.provisional || []).map((item) => ({
            seq: Number(item.seq || 0),
            status: String(item.status || item.envelope?.payload?.status || ''),
          })),
          latestStatus: String(turn?.latestStatus || ''),
          terminalSeq: Number(turn?.terminalSeq || 0),
          terminalStatus: String(turn?.terminal?.payload?.status || ''),
        };
      }),
    };
  });
}

test('completed root-safe history pages never add canonical Waiting turns', async ({ page, request }, testInfo) => {
  test.slow();
  const reset = await request.post('/mock/control/reset', {
    data: { scenario: 'long-running-history', seed: 0x92_17_01 },
  });
  expect(reset.ok()).toBe(true);
  const historyFrames = captureHistoryFrames(page);
  await login(page);

  const samples = [{ step: 0, snapshot: await canonicalSnapshot(page) }];
  const scroller = page.locator('.timeline-message-list');
  for (let step = 1; step <= 10; step += 1) {
    await scroller.hover();
    await page.mouse.wheel(0, -4_000);
    await page.waitForTimeout(180);
    samples.push({ step, snapshot: await canonicalSnapshot(page) });
  }

  const decodedPages = [];
  let rows = [];
  for (const frame of historyFrames) {
    if (frame.frame_type === 'feed' && frame.payload?.source === 'history') {
      rows.push({
        seq: Number(frame.payload.seq || 0),
        id: String(frame.payload.envelope?.id || ''),
        parentId: String(frame.payload.envelope?.parent_id || ''),
        kind: String(frame.payload.envelope?.kind || ''),
        status: String(frame.payload.envelope?.payload?.status || ''),
      });
    } else if (frame.frame_type === 'page_end') {
      decodedPages.push({ pageEnd: frame.payload, rows });
      rows = [];
    }
  }
  const artifact = { samples, pages: decodedPages };
  const path = testInfo.outputPath('canonical-waiting-history.json');
  await writeFile(path, JSON.stringify(artifact, null, 2));
  await testInfo.attach('canonical-waiting-history', { path, contentType: 'application/json' });

  const firstCurrent = samples.findIndex((sample) => sample.snapshot.controlCurrent);
  expect(firstCurrent).toBeGreaterThanOrEqual(0);
  expect(samples.slice(firstCurrent).every((sample) => sample.snapshot.controlCurrent)).toBe(true);
  expect(samples.flatMap((sample) => sample.snapshot.waitingIDs)).toEqual([]);
  for (const pageEntry of decodedPages) {
    const terminalParents = new Set(pageEntry.rows
      .filter((row) => ['completed', 'failed', 'cancelled'].includes(row.status))
      .map((row) => row.parentId));
    const queuedParents = new Set(pageEntry.rows
      .filter((row) => row.status === 'queued')
      .map((row) => row.parentId));
    expect([...queuedParents].filter((id) => !terminalParents.has(id))).toEqual([]);
  }
});
