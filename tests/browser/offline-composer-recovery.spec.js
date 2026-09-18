import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

async function reset(request) {
  const response = await request.post('/mock/control/reset', { data: { scenario: 'message-flow', seed: 6601 } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

async function disconnect(context, page, request) {
  await context.setOffline(true);
  // A reload can briefly overlap its retired socket with the newly attached
  // one. Drop the bounded current set until the UI observes the close; browser
  // offline mode then prevents another connection from replacing it.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await request.post('/mock/control/action', { data: { type: 'drop' } });
    expect(response.ok()).toBe(true);
    await page.waitForTimeout(200);
    if (await page.locator('.connection-state').evaluate((node) => node.classList.contains('state-reconnecting'))) break;
  }
  await expect(page.locator('.connection-state')).toHaveClass(/state-reconnecting/);
}

async function outboxSnapshot(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('atoll-outbox-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['drafts', 'submissions'], 'readonly');
      const draftRequest = transaction.objectStore('drafts').getAll();
      const submissionRequest = transaction.objectStore('submissions').getAll();
      transaction.oncomplete = () => {
        resolve({ drafts: draftRequest.result, submissions: submissionRequest.result });
        db.close();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  }));
}

test('W6 known member edits/restores a draft offline and queues one durable frame before reconnect', async ({ context, page, request }, testInfo) => {
  await reset(request);
  await login(page);

  await disconnect(context, page, request);
  const editor = page.getByRole('textbox', { name: '消息' });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(page.getByText(/离线编辑；发送会先保存到本机/)).toBeVisible();
  await expect(page.getByLabel('上传本机文件到频道')).toBeDisabled();
  await expect(page.getByRole('button', { name: '从频道文件选择' })).toBeDisabled();

  await editor.fill('@st');
  await page.getByRole('option', { name: /steward/ }).click();
  await editor.pressSequentially('离线草稿跨刷新恢复');
  await expect.poll(async () => {
    const snapshot = await outboxSnapshot(page);
    return snapshot.drafts.some((row) => row.draft?.text === '离线草稿跨刷新恢复'
      && row.draft?.recipients?.some((recipient) => recipient.id === 'steward'));
  }).toBe(true);

  await context.setOffline(false);
  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.getByRole('textbox', { name: '消息' })).toContainText('离线草稿跨刷新恢复');
  await expect(page.getByRole('status', { name: '收件人' })).toContainText('@steward');

  await disconnect(context, page, request);
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('已保存到本机，连接可用后自动发送')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '消息' })).toHaveText('');

  await expect.poll(async () => {
    const snapshot = await outboxSnapshot(page);
    return snapshot.submissions.some((row) => row.frame?.payload?.text === '离线草稿跨刷新恢复');
  }).toBe(true);
  const queued = (await outboxSnapshot(page)).submissions
    .find((row) => row.frame?.payload?.text === '离线草稿跨刷新恢复');
  expect(queued).toMatchObject({ state: 'queued', frame: { id: queued.messageId, channel_id: 'c0' } });
  await page.screenshot({ path: testInfo.outputPath('offline-durable-queued.png'), fullPage: true });
  await writeFile(testInfo.outputPath('offline-outbox.json'), JSON.stringify(queued, null, 2));
  await testInfo.attach('offline-outbox.json', {
    body: Buffer.from(JSON.stringify(queued, null, 2)),
    contentType: 'application/json',
  });

  await context.setOffline(false);
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.turn-card').filter({ hasText: '离线草稿跨刷新恢复' })).toBeVisible();
  await expect.poll(async () => (await outboxSnapshot(page)).submissions.some((row) => row.messageId === queued.messageId)).toBe(false);
});
