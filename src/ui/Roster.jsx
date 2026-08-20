import React from 'react';
import { actorDisplayName } from '../model/actor-display.js';
import { ActorDetails } from './ActorDetails.jsx';
import { visibleRosterRows } from './roster-visibility.js';

function Presence({ row }) {
  if (row.bound === true && row.deviceOnline === true) return <span className="presence online">在线</span>;
  if (row.bound === true) return <span className="presence bound">已绑定</span>;
  if (row.bound === false) return <span className="presence offline">未绑定</span>;
  return <span className="presence unknown">未知</span>;
}

export function Roster({ rows, selfId, identityPending = false, busy, focused = false, onClosePanel, onRefresh, selectedActor, capability, disabled, onSelectActor, onCloseActor, onDescribe, onInvoke }) {
  const visibleRows = visibleRosterRows(rows);
  return (
    <aside className={focused ? 'roster-panel focused' : 'roster-panel'} aria-label="频道成员">
      <header>
        <div><p className="eyebrow">MEMBERS</p><h2>成员 <small>{visibleRows.length}</small></h2></div>
        <div className="roster-header-actions"><button type="button" className="icon-button" onClick={onRefresh} disabled={busy} aria-label="刷新名册">{busy ? '…' : '↻'}</button>{onClosePanel && <button type="button" className="icon-button" onClick={onClosePanel} aria-label="关闭成员面板">×</button>}</div>
      </header>
      <div className="roster-list">
        {visibleRows.map((row) => (
          <button type="button" className={selectedActor?.id === row.id ? 'roster-row selected' : 'roster-row'} key={row.id} onClick={() => onSelectActor?.(row)}>
            <span className={`actor-icon kind-${row.kind}`}>{row.kind?.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong title={row.id}>{actorDisplayName(row)}{row.id === selfId && <em>我</em>}</strong>
              <span>{row.kind} · {row.decl_id || 'channel member'}</span>
            </div>
            <Presence row={row} />
          </button>
        ))}
        {!visibleRows.length && <p className="roster-empty">暂无业务成员</p>}
      </div>
      {identityPending && <p className="roster-identity-pending" role="status">正在确认你在本频道中的 Actor 身份</p>}
      {selectedActor && <ActorDetails actor={selectedActor} capability={capability} disabled={disabled} onClose={onCloseActor} onDescribe={onDescribe} onInvoke={onInvoke} />}
      <footer><span className="legend-dot online" />设备在线 <span className="legend-dot bound" />仅绑定</footer>
    </aside>
  );
}
