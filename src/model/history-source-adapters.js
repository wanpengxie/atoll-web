function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function numeric(value) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : 0;
}
function validateNetworkPage(batch, result, rows) {
  if (numeric(result.generation) !== numeric(batch.authority?.generation)) throw new Error('历史批次 generation 不匹配');
  if (result.channel_id !== batch.channelId) throw new Error('历史批次 channel 不匹配');
  const declaredRows = Number(result.declaredRows);
  if (!Number.isSafeInteger(declaredRows) || declaredRows !== rows.length) throw new Error('历史批次 rows 计数不匹配');
  const scanHigh = Number(result.scan_high_seq);
  const nextBefore = Number(result.next_before_seq);
  if (!Number.isSafeInteger(scanHigh) || scanHigh !== batch.beforeSeq - 1)
    throw new Error(`历史批次 scan_high 不连续: got=${scanHigh} want=${batch.beforeSeq - 1}`);
  if (!Number.isSafeInteger(nextBefore) || nextBefore < 0 || nextBefore > scanHigh) throw new Error('历史批次 next_before 非法');
  const scanLow = Number(result.scan_low_seq);
  if (!Number.isSafeInteger(scanLow) || scanLow !== nextBefore) throw new Error('历史批次 scan_low 与 cursor 不一致');
  if (result.has_older && nextBefore >= batch.beforeSeq) throw new Error('历史批次 cursor 未前进');
  if (rows.some(({ seq }) => !Number.isSafeInteger(Number(seq)) || seq < scanLow || seq > scanHigh))
    throw new Error('历史事实落在扫描区间外');
}
function validateCachePage(batch, result, rows) {
  const nextBefore = Number(result.nextBeforeSeq);
  if (!Number.isSafeInteger(nextBefore) || nextBefore <= 0 || nextBefore >= batch.beforeSeq)
    throw new Error('缓存历史批次 cursor 未前进');
  if (rows.some(({ seq }) => !Number.isSafeInteger(Number(seq)) || seq < nextBefore || seq >= batch.beforeSeq))
    throw new Error('缓存历史事实落在扫描区间外');
}
// Source adapters own I/O shape and validation only. They never inspect or
// mutate channel lifecycle state and cannot choose the next obligation.
export function createHistorySourceAdapters({ requestPage, cancelPage, readCache, registerNetwork }) {
  const requiredPorts = { requestPage, cancelPage, readCache, registerNetwork };
  for (const [name, port] of Object.entries(requiredPorts)) {
    if (typeof port !== 'function') throw new TypeError(`history source adapters require ${name}`);
  }
  const operations = new WeakMap();
  const terminal = new Set(['completed', 'failed', 'cancelled']);

  function sourceKind(batch) {
    if (batch?.source === 'indexeddb' || batch?.source === 'network') return batch.source;
    throw new TypeError(`unknown history source: ${String(batch?.source || '')}`);
  }

  function operationFor(batch) {
    const operation = operations.get(batch);
    if (!operation) throw new Error('history source operation was not prepared');
    return operation;
  }
  function setStatus(batch, status) {
    const operation = operationFor(batch);
    if (!terminal.has(operation.status)) operation.status = status;
  }
  async function executeNetwork(batch, operation, { priority = 'background' } = {}) {
    operation.phase = 'network-receipt';
    const accepted = requestPage(batch.channelId, batch.beforeSeq, batch.limit, {
      priority,
      generation: batch.authority?.generation, byteLimit: batch.byteLimit,
    });
    batch.ref = accepted?.ref || '';
    registerNetwork(batch);
    const receipt = await Promise.race([accepted, operation.cancellation.promise]);
    if (!receipt?.accepted || receipt.generation !== batch.authority?.generation || receipt.channel_id !== batch.channelId)
      throw new Error('历史批次回执不匹配');
    operation.phase = 'network-page';
    const page = await Promise.race([operation.page.promise, operation.cancellation.promise]);
    return { ...page, declaredRows: page.rows, rows: operation.rows };
  }
  return Object.freeze({
    prepare(batch) {
      const cancellation = deferred();
      const page = deferred();
      void cancellation.promise.catch(() => {});
      void page.promise.catch(() => {});
      operations.set(batch, { status: 'pending', phase: 'queued', cancellation, page, rows: [] });
    },
    async execute(batch, { priority = 'background' } = {}) {
      if (batch.cancelled) throw new Error('history batch cancelled');
      const operation = operationFor(batch);
      if (operation.status !== 'pending') throw new Error('history source operation already started');
      operation.status = 'running';
      try {
        const result = sourceKind(batch) === 'indexeddb'
          ? await Promise.race([(operation.phase = 'cache-read',
            readCache(batch.channelId, batch.beforeSeq, batch.limit, batch.byteLimit)), operation.cancellation.promise])
          : await executeNetwork(batch, operation, { priority });
        if (operation.status === 'running') operation.status = 'delivered';
        return result;
      } catch (error) {
        if (!terminal.has(operation.status)) operation.status = 'failed';
        throw error;
      }
    },
    validate: (batch, result, rows) =>
      (sourceKind(batch) === 'indexeddb' ? validateCachePage : validateNetworkPage)(batch, result, rows),
    appendRow(batch, row) {
      const operation = operationFor(batch);
      if (terminal.has(operation.status)) return false;
      operation.rows.push(row);
      return true;
    },
    finish(batch, payload) {
      const operation = operationFor(batch);
      if (terminal.has(operation.status)) return false;
      if (payload.error_code) operation.page.reject(new Error(payload.error_detail || payload.error_code));
      else operation.page.resolve(payload);
      return true;
    },
    rowCount: (batch) => operationFor(batch).rows.length,
    phase: (batch) => operationFor(batch).phase,
    cancellation: (batch) => operationFor(batch).cancellation.promise,
    status: (batch) => operationFor(batch).status,
    complete: (batch) => setStatus(batch, 'completed'),
    fail: (batch) => setStatus(batch, 'failed'),
    cancel(batch, reason = 'history operation cancelled', { notifyRemote = true } = {}) {
      const operation = operationFor(batch);
      if (!terminal.has(operation.status)) operation.status = 'cancelled';
      const error = Object.assign(new Error(reason), { code: 'history_cancelled' });
      operation.page.reject(error);
      operation.cancellation.reject(error);
      return notifyRemote && batch.source === 'network' && batch.ref
        ? Promise.resolve().then(() => cancelPage(batch.channelId, batch.ref, batch.authority?.generation))
        : Promise.resolve();
    },
  });
}
