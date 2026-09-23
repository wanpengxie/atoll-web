import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

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
  await expect(page.locator('main h1')).toHaveText('c0');
}

async function chooseSteward(page) {
  const choose = page.getByRole('button', { name: '选择 Agent' });
  await expect(choose).toBeVisible();
  await choose.click();
  await page.getByRole('menu', { name: '选择目标 Agent' })
    .getByRole('menuitem', { name: 'steward' }).click();
}

// A live notification must enter through the canonical presentable append
// path. The legacy `pulse` action is a transient transport/demo event and is
// intentionally rejected by notification policy.
async function appendCanonicalTail(request, { ask, text }) {
  const response = await request.post('/mock/control/action', {
    data: { type: 'q_tail_append', channel_id: 'c0', ask, text },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.request_id).toBeTruthy();
  return body;
}

async function capturePaint(page, region, frames) {
  return page.evaluate(async ({ region: paintRegion, frames: encoded }) => {
    const decode = (base64) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = `data:image/jpeg;base64,${base64}`;
    });
    const result = [];
    for (let index = 0; index < encoded.length; index += 1) {
      const image = await decode(encoded[index]);
      const scaleX = image.naturalWidth / paintRegion.pageWidth;
      const scaleY = image.naturalHeight / paintRegion.pageHeight;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(paintRegion.width * scaleX));
      canvas.height = Math.max(1, Math.floor(paintRegion.height * scaleY));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(
        image,
        Math.floor(paintRegion.left * scaleX), Math.floor(paintRegion.top * scaleY), canvas.width, canvas.height,
        0, 0, canvas.width, canvas.height,
      );
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let foreground = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const difference = Math.abs(pixels[offset] - paintRegion.color[0])
          + Math.abs(pixels[offset + 1] - paintRegion.color[1])
          + Math.abs(pixels[offset + 2] - paintRegion.color[2]);
        if (difference > 45) foreground += 1;
      }
      result.push({ index, foreground, width: canvas.width, height: canvas.height });
    }
    return result;
  }, { region, frames });
}



test('TC0214 F7 history and progress stay quiet while a canonical live append creates new-dynamic notification', async ({ page, request }) => {
  await reset(request, 'deep-history', 1718);
  await login(page);
  const viewport = page.locator('.timeline-message-list');
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  await viewport.hover();
  for (let index = 0; index < 4; index += 1) {
    await page.mouse.wheel(0, -100_000);
    await page.waitForTimeout(30);
  }
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  await expect(page.getByRole('button', { name: /条新动态/ })).toHaveCount(0);
  const progress = await request.post('/mock/control/action', {
    data: { type: 'dense_progress', channel_id: 'c0', count: 80 },
  });
  expect(progress.ok()).toBe(true);
  await page.waitForTimeout(250);
  await expect(page.getByRole('button', { name: /条新动态/ })).toHaveCount(0);
  await appendCanonicalTail(request, {
    ask: 'TC0214 canonical live append',
    text: 'TC0214 canonical live update',
  });
  await expect(page.getByRole('button', { name: /1 条新动态/ })).toBeVisible();
});


