import React, { useState } from 'react';

export function Auth({ identity, onAuthed }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const principal = mode === 'login'
        ? await identity.login(email, password)
        : await identity.register({ email, password, display_name: displayName || undefined });
      onAuthed(principal);
    } catch (reason) {
      setError(reason.detail || reason.message || String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <div className="brand-lockup"><span className="brand-dot" />ATOLL</div>
        <p className="eyebrow">COLLABORATION LEDGER · V2</p>
        <h1>与频道里的成员<br />在同一本账上协作。</h1>
        <p>登录后读取回放与实时 feed，向 agent 发起回合，并在同一条时间线上处理审批。</p>
        <div className="surface-list">
          <span>IDENTITY HTTP</span><span>WS / V2</span><span>OBS / READ</span>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-brand">
          <span className="auth-brand-mark">↯</span>
          <strong>ATOLL</strong>
          <small>// collaboration ledger · ws v2</small>
        </div>
        <div className="auth-tabs" role="tablist" aria-label="账号操作">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>登录</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>注册</button>
        </div>
        <form onSubmit={submit}>
          <label>邮箱<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          {mode === 'register' && (
            <label>显示名 <small>可选</small><input type="text" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          )}
          <label>密码<input type="password" minLength={mode === 'register' ? 8 : undefined} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={busy}>{busy ? '请稍候…' : mode === 'login' ? '进入 Atoll' : '创建账号'}</button>
        </form>
      </section>
    </main>
  );
}
