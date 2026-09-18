// History acquisition can finish after the DOM fact that requested it has
// changed. Reading returns this typed receipt instead of replaying a stale
// viewport budget itself. The committed list that owns the geometry is the
// only layer allowed to remeasure and decide whether the demand still exists.
export function consumeHistoryConsumerResult(pending, recheck) {
  return Promise.resolve(pending).then((result) => {
    if (result?.kind !== 'consumer-recheck') return result;
    return recheck(result);
  });
}
