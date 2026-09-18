import React from 'react';

export function VersionIncompatible({ expectedVersion, receivedVersion, onRefresh }) {
  const versionDetail = receivedVersion == null
    ? `当前页面使用协议 v${expectedVersion}`
    : `当前页面使用协议 v${expectedVersion}，服务端已使用 v${receivedVersion}`;
  return <main className="version-incompatible" role="alert" aria-labelledby="version-incompatible-title">
    <div className="version-incompatible-card">
      <span className="brand-dot" aria-hidden="true" />
      <p className="eyebrow">需要刷新</p>
      <h1 id="version-incompatible-title">这个页面的版本已经过期</h1>
      <p>为避免旧页面继续读取或写入不兼容的数据，当前会话已经停止。</p>
      <p className="version-incompatible-detail">{versionDetail}</p>
      <button type="button" autoFocus onClick={onRefresh}>刷新页面</button>
    </div>
  </main>;
}
