import { useEffect, useState } from 'react';

// 频道可以操作这块屏。那就得让坐在屏前的人看见发生了什么——否则页面自己动起来
// 是件吓人的事,而且事后无从知道刚才那一下是谁干的、干了什么。
//
// 它只报告,不拦截:这一版没有"允许/拒绝",操作已经做完了。所以它是**回执**,
// 不是**许可**——措辞和形态都按这个来,不做成需要处理的弹窗。

// IDLE_MS 是最后一条之后留多久。够久到你从别处回来还能看到刚才发生了什么,
// 又不至于一直杵在那儿。每来一条新的就重新计时。
const IDLE_MS = 60_000;

function label(entry) {
  const body = entry.body || {};
  switch (entry.type) {
    case 'ui.state':
      return '读取了这块屏的状态';
    case 'ui.navigate':
      return `切到 ${body.channel_id || '?'}${body.view ? ` · ${body.view}` : ''}`;
    case 'ui.open':
      return `打开 ${body.path || '?'}${body.line ? `:${body.line}` : ''}`;
    default:
      return entry.type;
  }
}

export function UiActivityOverlay({ entries = [], onDismiss }) {
  const [dismissedAt, setDismissedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const last = entries.length ? entries[entries.length - 1].at : 0;

  // 一个计时器等到该消失的那一刻,而不是每秒醒一次:这块面板不显示倒计时,
  // 所以除了"到点了"没有别的理由重渲染。
  useEffect(() => {
    if (!last) return undefined;
    const remaining = last + IDLE_MS - Date.now();
    if (remaining <= 0) { setNow(Date.now()); return undefined; }
    const timer = setTimeout(() => setNow(Date.now()), remaining + 20);
    return () => clearTimeout(timer);
  }, [last]);

  if (!entries.length) return null;
  if (dismissedAt >= last) return null;          // 关掉之后,要等新的一条才再出现
  if (now >= last + IDLE_MS) return null;

  return (
    <aside className="ui-activity" aria-live="polite" aria-label="频道对本页的操作">
      <header className="ui-activity-head">
        <span className="ui-activity-title">频道操作了这块屏</span>
        <button
          type="button"
          className="ui-activity-close"
          aria-label="关闭"
          onClick={() => { setDismissedAt(last); onDismiss?.(); }}
        >×</button>
      </header>
      <ol className="ui-activity-list">
        {entries.map((entry) => (
          <li key={entry.id} className={entry.ok ? '' : 'is-failed'}>
            <span className="ui-activity-what">{label(entry)}</span>
            {!entry.ok && <span className="ui-activity-why">{entry.error || '没成功'}</span>}
          </li>
        ))}
      </ol>
    </aside>
  );
}
