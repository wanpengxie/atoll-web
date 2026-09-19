import PQueue from 'p-queue';
// Owns physical concurrency only. It has no channel, source, priority, or
// obligation knowledge; ChannelFeedRuntime remains the sole lifecycle owner.
export function createHistoryBoundedExecutor({ concurrency, timeoutMs }) {
  const queue = new PQueue({ concurrency, autoStart: true });
  const jobs = new Set();
  function settle(job, outcome, value) {
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return;
    job.status = outcome;
    jobs.delete(job);
    (outcome === 'completed' ? job.resolve : job.reject)(value);
  }
  return Object.freeze({
    run(task, { id } = {}) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const job = { id, status: 'queued', resolve, reject };
      jobs.add(job);
      queue.add(() => {
        if (job.status !== 'queued') return undefined;
        job.status = 'running'; return task();
      }, { id, timeout: timeoutMs }).then(
        (value) => settle(job, 'completed', value),
        (error) => settle(job, 'failed', error),
      );
      return promise;
    },
    clear(reason = 'history executor cleared') {
      const error = Object.assign(new Error(reason), { code: 'history_cancelled' });
      for (const job of jobs) if (job.status === 'queued') settle(job, 'cancelled', error);
      queue.clear();
    },
    snapshot() {
      const count = (status) => [...jobs].filter((job) => job.status === status).length;
      return Object.freeze({ running: count('running'), queued: count('queued') });
    },
  });
}
