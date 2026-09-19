import React, { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { SelectMenu } from '../../primitives/SelectMenu.jsx';

const THEME_KEY = 'atoll.terminal.theme';
const encoder = new TextEncoder();

function cssVar(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function monoStack() {
  const token = cssVar('--mono', '');
  const platformFonts = 'ui-monospace, "SF Mono", Menlo, "DejaVu Sans Mono", "Liberation Mono"';
  return token ? `${platformFonts}, ${token}` : `${platformFonts}, monospace`;
}

const DARK_THEME = Object.freeze({
  foreground: '#e8e0d4',
  background: '#1c1a17',
  cursor: '#ff5c78',
  cursorAccent: '#1c1a17',
  selectionBackground: '#3f3a33',
  selectionForeground: '#f5f0e8',
  black: '#3a352e',
  red: '#ff6b6b',
  green: '#8bd17c',
  yellow: '#e6c07b',
  blue: '#7aa2f7',
  magenta: '#c99bdd',
  cyan: '#6fd0d6',
  white: '#d6ccbd',
  brightBlack: '#6f6659',
  brightRed: '#ff8a8a',
  brightGreen: '#a7e39a',
  brightYellow: '#f2d493',
  brightBlue: '#9db8ff',
  brightMagenta: '#dbb4ee',
  brightCyan: '#96e2e7',
  brightWhite: '#fbf6ee',
});

function terminalTheme(mode) {
  if (mode !== 'light') return DARK_THEME;
  const foreground = cssVar('--text', '#2e2419');
  const background = cssVar('--workspace', '#ffffff');
  return {
    foreground,
    background,
    cursor: cssVar('--accent', '#e4002b'),
    cursorAccent: background,
    selectionBackground: cssVar('--surface-muted', '#f3ede2'),
    selectionForeground: foreground,
    black: foreground,
    red: '#b3261e',
    green: '#2f7d31',
    yellow: '#8a6100',
    blue: '#1f5fa8',
    magenta: '#8a3f9e',
    cyan: '#0f7a86',
    white: cssVar('--text-muted', '#6f6252'),
    brightBlack: cssVar('--text-muted', '#6f6252'),
    brightRed: cssVar('--accent', '#e4002b'),
    brightGreen: '#1f6b21',
    brightYellow: '#6f4e00',
    brightBlue: '#154a86',
    brightMagenta: '#71307f',
    brightCyan: '#0a616b',
    brightWhite: foreground,
  };
}

function readTheme() {
  try { return window.localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}

function copyFallback(text) {
  const pad = document.createElement('textarea');
  pad.value = text;
  pad.setAttribute('readonly', '');
  pad.style.position = 'fixed';
  pad.style.top = '0';
  pad.style.left = '-9999px';
  document.body.appendChild(pad);
  const active = document.activeElement;
  try {
    pad.focus();
    pad.select();
    pad.setSelectionRange(0, pad.value.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    pad.remove();
    if (active instanceof HTMLElement) active.focus();
  }
}

let clipboardWarned = false;
async function copyToClipboard(text) {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch { /* A denied Clipboard API write falls through to the user-gesture fallback. */ }
  if (!copyFallback(text) && !clipboardWarned) {
    clipboardWarned = true;
    console.warn('[terminal] 选中内容无法写入剪贴板（浏览器拒绝了复制）');
  }
}

function preferredDevice(devices, selected) {
  if (selected && devices.some((device) => device.id === selected)) return selected;
  return devices.find((device) => device.id === 'local-device')?.id
    || (devices.length === 1 ? devices[0].id : '');
}

function canWriteToTerminal(port) {
  return port.canWrite !== false
    && port.status !== 'unavailable'
    && port.transportOpen !== false
    && port.available !== false
    && port.unavailable !== true;
}

export function TerminalFeature({ channelId, port = {}, visible = true, onClose }) {
  const hostRef = useRef(null);
  const terminalRef = useRef(null);
  const fitRef = useRef(null);
  const handleRef = useRef(null);
  const commandsRef = useRef(port.commands || {});
  const canWriteRef = useRef(canWriteToTerminal(port));
  const [generation, setGeneration] = useState(0);
  const [status, setStatus] = useState('connecting');
  const [detail, setDetail] = useState('');
  const [renderer, setRenderer] = useState('');
  const [themeMode, setThemeMode] = useState(readTheme);
  commandsRef.current = port.commands || {};
  canWriteRef.current = canWriteToTerminal(port);

  const devices = port.devices || [];
  const deviceId = preferredDevice(devices, port.deviceId);

  useEffect(() => {
    if (!hostRef.current || !channelId || !deviceId || typeof commandsRef.current.connect !== 'function') return undefined;
    const host = hostRef.current;
    const connection = { disposed: false, handle: null };
    setStatus('connecting');
    setDetail('');
    setRenderer('');

    const terminal = new Terminal({
      allowProposedApi: true,
      convertEol: false,
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.25,
      fontFamily: monoStack(),
      fontWeight: 400,
      fontWeightBold: 650,
      letterSpacing: 0,
      scrollback: 5000,
      theme: terminalTheme(themeMode),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;

    void (async () => {
      let WebglAddon;
      try {
        ({ WebglAddon } = await import('@xterm/addon-webgl'));
      } catch (error) {
        if (!connection.disposed) {
          console.warn('[terminal] WebGL 渲染器加载失败，回落 DOM 渲染器（手感会变钝）：', error);
          setRenderer('dom');
        }
        return;
      }
      if (connection.disposed || terminalRef.current !== terminal) return;
      try {
        const addon = new WebglAddon();
        addon.onContextLoss(() => {
          console.warn('[terminal] WebGL 上下文丢失，已回落 DOM 渲染器——输入手感会变钝');
          addon.dispose();
          if (!connection.disposed) setRenderer('dom');
        });
        terminal.loadAddon(addon);
        setRenderer('webgl');
      } catch (error) {
        console.warn('[terminal] WebGL 渲染器不可用，回落 DOM 渲染器（手感会变钝）：', error);
        setRenderer('dom');
      }
    })();

    const fitAndResize = () => {
      if (connection.disposed) return;
      try { fit.fit(); } catch { return; }
      connection.handle?.resize?.(terminal.cols, terminal.rows);
    };
    fitAndResize();
    const observer = new ResizeObserver(fitAndResize);
    observer.observe(host);

    let selecting = false;
    const beginSelect = (event) => { if (event.button === 0) selecting = true; };
    const endSelect = () => {
      if (!selecting) return;
      selecting = false;
      if (!terminal.hasSelection()) return;
      const text = terminal.getSelection();
      if (text) void copyToClipboard(text);
    };
    host.addEventListener('mousedown', beginSelect);
    document.addEventListener('mouseup', endSelect);

    const input = terminal.onData((data) => {
      if (canWriteRef.current) connection.handle?.write?.(encoder.encode(data));
    });

    const installHandle = (handle) => {
      if (connection.disposed) {
        handle?.detach?.();
        return;
      }
      connection.handle = handle || null;
      handleRef.current = connection.handle;
      fitAndResize();
    };
    const failConnection = (error) => {
      if (!connection.disposed) {
        setStatus('ended');
        setDetail(error?.message || String(error));
      }
    };
    try {
      const handle = commandsRef.current.connect({
        channelId,
        deviceId,
        cols: terminal.cols,
        rows: terminal.rows,
        onData: (bytes) => { if (!connection.disposed) terminal.write(bytes); },
        onStatus: (next, message = '') => {
          if (!connection.disposed) {
            setStatus(next);
            setDetail(message);
          }
        },
        onExit: (message = '') => {
          if (!connection.disposed) {
            setStatus('ended');
            setDetail(message);
          }
        },
      });
      if (handle && typeof handle.then === 'function') handle.then(installHandle, failConnection);
      else installHandle(handle);
    } catch (error) {
      failConnection(error);
    }

    return () => {
      connection.disposed = true;
      observer.disconnect();
      host.removeEventListener('mousedown', beginSelect);
      document.removeEventListener('mouseup', endSelect);
      input.dispose();
      const handle = connection.handle;
      handle?.detach?.();
      connection.handle = null;
      if (handleRef.current === handle) handleRef.current = null;
      if (terminalRef.current === terminal) terminalRef.current = null;
      if (fitRef.current === fit) fitRef.current = null;
      terminal.dispose();
    };
  }, [channelId, deviceId, generation]);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = terminalTheme(themeMode);
    try { window.localStorage.setItem(THEME_KEY, themeMode); } catch { /* Private storage mode. */ }
  }, [themeMode]);

  useEffect(() => {
    if (!visible) return undefined;
    const frame = requestAnimationFrame(() => {
      try { fitRef.current?.fit(); } catch { /* Hidden geometry has not settled yet. */ }
      terminalRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  const reopen = () => {
    handleRef.current?.close?.();
    handleRef.current = null;
    setDetail('');
    setGeneration((value) => value + 1);
  };
  const shownStatus = port.status || status;
  const shownDetail = port.detail || detail;
  const label = !deviceId ? '频道没有可用的终端设备' : (({
    connecting: '连接中…',
    reconnecting: '重连中——断线期间的输出不会补',
    open: '',
    ended: shownDetail || '会话已结束',
  }[shownStatus]) ?? (shownDetail || '终端暂不可用'));

  return <section id="workspace-panel-terminal" className="terminal-view" data-terminal-theme={themeMode} hidden={!visible} role="region" aria-labelledby="workspace-terminal-toggle">
    <div className={`terminal-status terminal-status-${shownStatus}`} role="status">
      <span>{label}</span>
      {renderer === 'dom' && <span className="terminal-status-warn">GPU 渲染不可用，手感会变钝</span>}
      <span className="terminal-status-actions">
        {devices.length > 1 && <SelectMenu ariaLabel="终端设备" value={deviceId} placeholder="选择频道设备" options={devices.map((row) => ({ value: row.id, label: row.name || row.id, description: `${row.id}${row.online === false ? ' · 离线' : ''}` }))} onChange={(value) => commandsRef.current.selectDevice?.(value)} />}
        {shownStatus === 'ended' && <button type="button" onClick={reopen}>重开</button>}
        <button type="button" aria-label={themeMode === 'dark' ? '切到浅色' : '切到暗色'} title={themeMode === 'dark' ? '切到浅色' : '切到暗色'} onClick={() => setThemeMode((value) => value === 'dark' ? 'light' : 'dark')}>{themeMode === 'dark' ? '浅色' : '暗色'}</button>
        {onClose && <button type="button" aria-label="关闭终端" title="关闭终端" onClick={onClose}>×</button>}
      </span>
    </div>
    {!deviceId && <div className="artifact-empty"><strong>没有可用的终端设备</strong><p>为频道绑定在线设备后可以打开终端。</p></div>}
    <div className="terminal-host" ref={hostRef} />
  </section>;
}
