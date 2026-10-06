import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// A message names files in object storage (oss://c0.storage/c0.dev/…). The page
// asks the channel's storage seat for a signed URL and reads the bytes from
// it — cross-origin, from the bucket (here: the mock's own origin), never via
// the node's /files.
async function reset(request, seed = 200601) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'storage-link', seed },
  });
  expect(response.ok()).toBe(true);
}

async function openDev(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await page.getByRole('navigation', { name: '频道' }).getByText('c0.dev', { exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('c0.dev');
}

function watchReads(page) {
  const reads = { bucket: [], files: [] };
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/mock/oss/')) reads.bucket.push(url);
    if (url.pathname === '/files') reads.files.push(url);
  });
  return reads;
}

test('STORAGE-01 an oss image link previews from the signed cross-origin URL', async ({ page, request }) => {
  await reset(request);
  const reads = watchReads(page);
  await openDev(page);

  const link = page.getByRole('link', { name: 'Q3 图表', exact: true });
  await expect(link).toBeVisible({ timeout: 15_000 });
  await expect(link).not.toHaveAttribute('target', '_blank');
  const before = page.url();
  await link.click();

  const detail = page.getByRole('complementary', { name: '文件详情' });
  await expect(detail).toContainText('q3-chart.png');
  const image = detail.locator('img');
  await expect(image).toHaveAttribute('src', /\/mock\/oss\/c0\.dev\/reports\/q3-chart\.png\?/);
  // The bytes come from another origin than the page (the bucket), decoded.
  const source = new URL(await image.getAttribute('src'));
  expect(source.origin).not.toBe(new URL(page.url()).origin);
  await expect.poll(() => image.evaluate((element) => element.naturalWidth)).toBe(240);
  await expect(page).toHaveURL(before);
  expect(reads.files).toHaveLength(0);
  expect(reads.bucket.map((url) => url.searchParams.get('disp'))).toEqual(['inline']);
  // The exchange for a URL is not a message in the conversation.
  await expect(page.locator('main')).not.toContainText('storage.get_url');
});

test('STORAGE-02 a bare oss address and a resource_link read their text cross-origin', async ({ page, request }) => {
  await reset(request);
  const reads = watchReads(page);
  await openDev(page);

  const bare = page.getByRole('link', { name: 'oss://c0.storage/c0.dev/reports/q3-notes.txt', exact: true });
  await expect(bare).toBeVisible({ timeout: 15_000 });
  await bare.click();
  const detail = page.getByRole('complementary', { name: '文件详情' });
  await expect(detail).toContainText('q3-notes.txt');
  await expect(detail).toContainText('收入同比增长 18%');

  await page.getByRole('button', { name: 'q3-summary.md 文本' }).click();
  await expect(detail).toContainText('q3-summary.md');
  await expect(detail.locator('.markdown-content h1')).toHaveText('Q3 小结');
  expect(reads.files).toHaveLength(0);
  expect(reads.bucket.length).toBeGreaterThanOrEqual(2);
});

test('STORAGE-03 a link to another channel\'s file says where it belongs and asks nothing', async ({ page, request }) => {
  await reset(request);
  const reads = watchReads(page);
  await openDev(page);

  const foreign = page.getByRole('link', { name: 'cvmax 报告', exact: true });
  await expect(foreign).toBeVisible({ timeout: 15_000 });
  await foreign.click();
  const detail = page.getByRole('complementary', { name: '文件详情' });
  await expect(detail).toContainText('这个文件属于频道 c0.cvmax，不在当前频道 c0.dev 里；请到 c0.cvmax 打开它。');
  await expect(detail.getByRole('button', { name: '下载 q3.pdf' })).toHaveCount(0);
  expect(reads.bucket).toHaveLength(0);
  expect(reads.files).toHaveLength(0);
});

test('STORAGE-04 downloading a stored attachment saves it from an attachment URL', async ({ page, request }) => {
  await reset(request);
  await openDev(page);
  const button = page.getByRole('button', { name: '下载 q3-summary.md' });
  await expect(button).toBeVisible({ timeout: 15_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(download.suggestedFilename()).toBe('q3-summary.md');
  expect(new URL(download.url()).searchParams.get('disp')).toBe('attachment');
});
