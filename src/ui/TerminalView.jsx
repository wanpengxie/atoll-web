import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

// The terminal leg is its own WebSocket, not the ledger feed's: a build's
// scrolling output would otherwise share one serialized writer pump with every
// ledger frame. See .dalek/pm/terminal-line-design.md §4.5 — this is a known
// workaround for the browser leg lacking a multiplexer, not the target shape.
function ptyURL(channelId, sessionId, cols, rows) {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const q = new URLSearchParams({ channel_id: channelId, cols: String(cols), rows: String(rows) });
  if (sessionId) q.set('session', sessionId);
  return `${scheme}//${window.location.host}/pty?${q.toString()}`;
}

// 保住进程，恒不保住输出 (§4.4): the shell survives a dropped connection for a
// grace window, so reconnecting reattaches rather than starting a new shell.
// Output produced while away is gone — nothing was buffered, by design.
const RECONNECT_DELAYS = [400, 800, 1600, 3000, 5000];

export function TerminalView({ channelId, canWrite = true }) {
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const wsRef = useRef(null);
  const sessionRef = useRef('');
  const attemptRef = useRef(0);
  const closedRef = useRef(false);
  const [status, setStatus] = useState('connecting');
  const [detail, setDetail] = useState('');

  useEffect(() => {
    if (!hostRef.current || !channelId) return undefined;
    closedRef.current = false;
    sessionRef.current = '';
    attemptRef.current = 0;

    const term = new Terminal({
      allowProposedApi: true,
      convertEol: false,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
      scrollback: 5000,
      theme: { background: 'transparent' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(hostRef.current);
    termRef.current = term;
    fitRef.current = fit;

    // WebGL is the fast renderer but it fails on some GPUs/drivers; falling
    // back is normal, not an error, so it must never take the terminal down.
    (async () => {
      try {
        const { WebglAddon } = await import('@xterm/addon-webgl');
        const addon = new WebglAddon();
        addon.onContextLoss(() => addon.dispose());
        term.loadAddon(addon);
      } catch {
        /* DOM renderer stays; nothing to report. */
      }
    })();

    try { fit.fit(); } catch { /* pre-layout */ }

    const observer = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* detached */ }
    });
    observer.observe(hostRef.current);

    let reconnectTimer = 0;

    const send = (obj) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    };

    const connect = () => {
      if (closedRef.current) return;
      setStatus(sessionRef.current ? 'reconnecting' : 'connecting');
      const ws = new WebSocket(ptyURL(channelId, sessionRef.current, term.cols, term.rows));
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => { attemptRef.current = 0; };
      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'ready') {
              sessionRef.current = msg.session || '';
              setStatus('open');
              setDetail('');
              send({ type: 'resize', cols: term.cols, rows: term.rows });
            }
          } catch { /* not ours */ }
          return;
        }
        term.write(new Uint8Array(event.data));
      };
      ws.onclose = (event) => {
        wsRef.current = null;
        if (closedRef.current) return;
        // 1000 with a reason means the door ended it deliberately (the shell
        // exited, or the session was closed): reconnecting would silently
        // start a second shell, which is exactly what a person does not mean.
        if (event.code === 1000 && event.reason) {
          setStatus('ended');
          setDetail(event.reason);
          return;
        }
        const delay = RECONNECT_DELAYS[Math.min(attemptRef.current, RECONNECT_DELAYS.length - 1)];
        attemptRef.current += 1;
        setStatus('reconnecting');
        reconnectTimer = window.setTimeout(connect, delay);
      };
      ws.onerror = () => { setDetail('连接中断'); };
    };

    const disposeData = term.onData((data) => {
      if (!canWrite) return;
      send({ type: 'input', data });
    });
    const disposeResize = term.onResize(({ cols, rows }) => {
      // Window size is a control message, never an escape smuggled into the
      // byte stream: it is low-frequency and has to be reliable (§4).
      send({ type: 'resize', cols, rows });
    });

    connect();

    return () => {
      closedRef.current = true;
      window.clearTimeout(reconnectTimer);
      observer.disconnect();
      disposeData.dispose();
      disposeResize.dispose();
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        // Plain close, NOT a "close" control message: leaving means the
        // viewer went away, and the shell is supposed to outlive that.
        try { ws.close(); } catch { /* already gone */ }
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [channelId, canWrite]);

  const label = {
    connecting: '连接中…',
    reconnecting: '重连中——进程还在，断线期间的输出不会补',
    open: '',
    ended: detail || '会话已结束',
  }[status];

  return (
    <section id="workspace-panel-terminal" className="terminal-view" role="tabpanel" aria-labelledby="workspace-tab-terminal">
      {label && (
        <div className={`terminal-status terminal-status-${status}`} role="status">
          <span>{label}</span>
          {status === 'ended' && (
            <button type="button" onClick={() => { sessionRef.current = ''; setStatus('connecting'); window.location.reload(); }}>重开</button>
          )}
        </div>
      )}
      <div className="terminal-host" ref={hostRef} />
    </section>
  );
}
