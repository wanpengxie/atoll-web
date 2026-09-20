import PQueue from 'p-queue';
// Owns physical concurrency only. It has no channel, source, priority, or
// obligation knowledge; ChannelFeedRuntime remains the sole lifecycle owner.
export function createHistoryBoundedExecutor({ concurrency, timeoutMs }) {
  const queue = new PQueue({ concurrency, autoStart: true });
  const jobs = new Set();
  let nextJobID = 0;
  const cancelledError = (reason = 'history executor cancelled') => Object.assign(
    new Error(String(reason)),
    { code: 'history_cancelled' },
  );
  function settle(job, outcome, value) {
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return;
    job.status = outcome;
    jobs.delete(job);
    (outcome === 'completed' ? job.resolve : job.reject)(value);
  }
  return Object.freeze({
    run(task, { id, priority = 0, signal } = {}) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const jobID = id ?? `history-job-${++nextJobID}`;
      const job = { id: jobID, priority, status: 'queued', resolve, reject };
      jobs.add(job);
      const queued = queue.add(({ signal: queueSignal } = {}) => {
        if (job.status !== 'queued') return undefined;
        job.status = 'running'; return task(queueSignal || signal);
      }, { id: jobID, priority, timeout: timeoutMs, signal }).then(
        (value) => settle(job, 'completed', value),
        (error) => settle(
          job,
          signal?.aborted ? 'cancelled' : 'failed',
          signal?.aborted ? cancelledError(signal.reason || 'history operation aborted') : error,
        ),
      );
      // A PhysicalOperation can be joined by a foreground waiter while it is
      // still queued.  Keep this one tiny scheduler seam on the existing
      // bounded executor; callers never receive the PQueue instance.
      promise.promote = (nextPriority = priority) => {
        if (job.status !== 'queued') return false;
        const value = Number(nextPriority);
        if (!Number.isFinite(value) || value <= job.priority) return false;
        try {
          queue.setPriority(jobID, value);
          job.priority = value;
          return true;
        } catch {
          return false;
        }
      };
      // The wrapper promise owns settlement.  PQueue may retain a removed
      // queued callback after clear(), so make sure its rejection is handled
      // even when the caller has already received history_cancelled.
      void queued.catch(() => {});
      return promise;
    },
    clear(reason = 'history executor cleared') {
      const error = cancelledError(reason);
      for (const job of jobs) if (job.status === 'queued') settle(job, 'cancelled', error);
      queue.clear();
    },
    snapshot() {
      const count = (status) => [...jobs].filter((job) => job.status === status).length;
      return Object.freeze({ running: count('running'), queued: count('queued') });
    },
  });
}
