import React, { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { SelectMenu } from '../../primitives/SelectMenu.jsx';

const encoder = new TextEncoder();

function theme(mode) {
  if (mode === 'light') return { foreground: '#2e2419', background: '#ffffff', cursor: '#e4002b', selectionBackground: '#eee6da' };
  return { foreground: '#e8e0d4', background: '#1c1a17', cursor: '#ff5c78', selectionBackground: '#3f3a33' };
}

export function TerminalFeature({ channelId, port = {}, visible = true, onClose }) {
  const hostRef = useRef(null);
  const terminalRef = useRef(null);
  const fitRef = useRef(null);
  const handleRef = useRef(null);
  const commandsRef = useRef(port.commands || {});
  const canWriteRef = useRef(port.canWrite !== false);
  const [generation, setGeneration] = useState(0);
  const [status, setStatus] = useState('connecting');
  const [detail, setDetail] = useState('');
  const [themeMode, setThemeMode] = useState('dark');
  commandsRef.current = port.commands || {};
  canWriteRef.current = port.canWrite !== false;
  const devices = port.devices || [];
  const deviceId = port.deviceId || (devices.length === 1 ? devices[0].id : '');

  useEffect(() => {
    if (!hostRef.current || !channelId || !deviceId || typeof commandsRef.current.connect !== 'function') return undefined;
    let disposed = false;
    const terminal = new Terminal({ cursorBlink: true, fontSize: 13, lineHeight: 1.25, scrollback: 5000, theme: theme(themeMode) });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(hostRef.current);
    terminalRef.current = terminal;
    fitRef.current = fit;
    const fitAndResize = () => {
      if (disposed) return;
      try { fit.fit(); } catch { return; }
      handleRef.current?.resize?.(terminal.cols, terminal.rows);
    };
    fitAndResize();
    const observer = new ResizeObserver(fitAndResize);
    observer.observe(hostRef.current);
    const input = terminal.onData((data) => {
      if (canWriteRef.current) handleRef.current?.write?.(encoder.encode(data));
    });
    setStatus('connecting');
    setDetail('');
    Promise.resolve(commandsRef.current.connect({
      channelId,
      deviceId,
      cols: terminal.cols,
      rows: terminal.rows,
      onData: (bytes) => { if (!disposed) terminal.write(bytes); },
      onStatus: (next, message = '') => { if (!disposed) { setStatus(next); setDetail(message); } },
      onExit: (message = '') => { if (!disposed) { setStatus('ended'); setDetail(message); } },
    })).then((handle) => {
      if (disposed) { handle?.detach?.(); return; }
      handleRef.current = handle || null;
      fitAndResize();
    }).catch((error) => {
      if (!disposed) { setStatus('ended'); setDetail(error?.message || String(error)); }
    });
    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      handleRef.current?.detach?.();
      handleRef.current = null;
      fitRef.current = null;
      terminalRef.current = null;
      terminal.dispose();
    };
  }, [channelId, deviceId, generation, themeMode]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      try { fitRef.current?.fit(); } catch { /* hidden geometry is not ready yet */ }
      terminalRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  const reopen = () => {
    handleRef.current?.close?.();
    handleRef.current = null;
    setGeneration((value) => value + 1);
  };
  const shownStatus = port.status || status;
  const shownDetail = port.detail || detail;
  return <section id="workspace-panel-terminal" className="terminal-view" data-terminal-theme={themeMode} hidden={!visible} role="region" aria-label="频道终端">
    <div className={`terminal-status terminal-status-${shownStatus}`}><span>{shownStatus === 'open' ? '终端已连接' : shownStatus === 'reconnecting' ? '终端重连中…' : shownStatus === 'ended' ? shownDetail || '终端已结束' : '正在连接终端…'}</span><div className="terminal-status-actions">
      {devices.length > 1 && <SelectMenu ariaLabel="终端设备" value={deviceId} options={devices.map((row) => ({ value: row.id, label: row.name || row.id }))} onChange={(value) => commandsRef.current.selectDevice?.(value)} />}
      <button type="button" onClick={() => setThemeMode((value) => value === 'dark' ? 'light' : 'dark')}>{themeMode === 'dark' ? '浅色' : '深色'}</button>
      {shownStatus === 'ended' && <button type="button" onClick={reopen}>重开</button>}
      {onClose && <button type="button" onClick={onClose}>收起</button>}
    </div></div>
    {!deviceId && <div className="artifact-empty"><strong>没有可用的终端设备</strong><p>为频道绑定在线设备后可以打开终端。</p></div>}
    <div className="terminal-host" ref={hostRef} />
  </section>;
}
