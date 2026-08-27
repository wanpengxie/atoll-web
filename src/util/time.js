// messageTimeLabel renders the clock shown at the head of a message. A message
// from today needs only its clock; anything older must say which day it was
// (and which year, once that differs too), otherwise "09:12" on a message read
// three days later reads as this morning.
const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const dayClock = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const fullClock = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

function sameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function messageTimeLabel(ts, now = Date.now()) {
  if (!ts) return '';
  const when = new Date(ts);
  const today = new Date(now);
  if (sameLocalDay(when, today)) return clock.format(when);
  if (when.getFullYear() === today.getFullYear()) return dayClock.format(when);
  return fullClock.format(when);
}
