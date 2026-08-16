import React from 'react';

function Presence({ row }) {
  if (row.bound === true && row.deviceOnline === true) return <span className="presence online">在线</span>;
  if (row.bound === true) return <span className="presence bound">已绑定</span>;
  if (row.bound === false) return <span className="presence offline">未绑定</span>;
  return <span className="presence unknown">未知</span>;
}

export function Roster({ rows, selfId, busy, onRefresh }) {
  return (
    <aside className="roster-panel">
      <header>
        <div><p className="eyebrow">LIVE DIRECTORY</p><h2>频道名册</h2></div>
        <button type="button" className="icon-button" onClick={onRefresh} disabled={busy} aria-label="刷新名册">{busy ? '…' : '↻'}</button>
      </header>
      <div className="roster-list">
        {rows.map((row) => (
          <article className="roster-row" key={row.id}>
            <span className={`actor-icon kind-${row.kind}`}>{row.kind?.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{row.name || row.id}{row.id === selfId && <em>我</em>}</strong>
              <span>{row.kind} · {row.decl_id || 'channel member'}</span>
            </div>
            <Presence row={row} />
          </article>
        ))}
        {!rows.length && <p className="roster-empty">尚未读取名册</p>}
      </div>
      <footer><span className="legend-dot online" />设备在线 <span className="legend-dot bound" />仅绑定</footer>
    </aside>
  );
}
