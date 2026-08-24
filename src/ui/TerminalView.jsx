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

// xterm 用 canvas 的 ctx.font 量字，**CSS var() 在那里恒不解析**——直接把
// "var(--mono)" 交给它会静默回落到浏览器默认字体（通常是衬线体）。所以在
// 挂载时把变量读成真值再传进去，读不到才用兜底栈。
function cssVar(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// tokens.css 的 --mono 以 "SFMono-Regular" 打头，但**浏览器恒拿不到这个族名**
// ——SF Mono 从不以此名暴露给网页；Consolas 只在 Windows 上有。于是 macOS 上
// 一路回落到 Courier，正是"字体效果太差"的样子。ui-monospace 才是各平台拿
// 系统等宽字体的正规写法，故在 token 前面补齐一段，恒不改动全局 token。
function monoStack() {
  const token = cssVar('--mono', '');
  const lead = 'ui-monospace, "SF Mono", Menlo, "DejaVu Sans Mono", "Liberation Mono"';
  return token ? `${lead}, ${token}` : `${lead}, monospace`;
}

// 两套终端配色。默认暗底——终端惯例如此（VSCode/iTerm 在浅色 IDE 里也是
// 暗的），而且它让「这是另一台机器的表面」一眼可辨。色调按 tokens 的暖调
// 走，恒不用冷灰，否则它在这套配色里像块贴上去的补丁。
//
// 十六色两套都是为各自底色调过的：xterm 自带那套给黑底设计，直接用在白底
// 上黄/青会糊；反过来把浅底色搬到暗底又会发闷。
const TERMINAL_THEMES = {
  dark: {
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
  },
  light: null, // 运行时从 tokens.css 读，见 lightTheme()
};

function lightTheme() {
  const fg = cssVar('--text', '#2e2419');
  const bg = cssVar('--workspace', '#ffffff');
  return {
    foreground: fg,
    background: bg,
    cursor: cssVar('--accent', '#e4002b'),
    cursorAccent: bg,
    selectionBackground: cssVar('--surface-muted', '#f3ede2'),
    selectionForeground: fg,
    black: fg,
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
    brightWhite: fg,
  };
}

function terminalTheme(mode) {
  return mode === 'light' ? lightTheme() : TERMINAL_THEMES.dark;
}

const THEME_KEY = 'atoll.terminal.theme';
const encoder = new TextEncoder();

// 会话 id 按频道记在 sessionStorage：组件卸载（切频道）或刷新之后回来，
// 只要还在后端的宽限期内，就接回同一个 shell 而恒不新开一个。
// 用 sessionStorage 而非模块变量，是为了让刷新页面也能接回去。
const sessionKey = (channelId) => `atoll.terminal.session.${channelId}`;

function readSession(channelId) {
  try { return window.sessionStorage.getItem(sessionKey(channelId)) || ''; } catch { return ''; }
}
function writeSession(channelId, id) {
  try {
    if (id) window.sessionStorage.setItem(sessionKey(channelId), id);
    else window.sessionStorage.removeItem(sessionKey(channelId));
  } catch { /* private mode */ }
}

export function TerminalView({ channelId, canWrite = true, visible = true }) {
  const hostRef = useRef(null);
  // canWrite is read through a ref, never a dependency: a momentary
  // permission flicker must not tear the terminal down and abandon the
  // session id — that would strand the running shell and start a new one.
  const canWriteRef = useRef(canWrite);
  canWriteRef.current = canWrite;
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const genRef = useRef(null);
  const [status, setStatus] = useState('connecting');
  const [detail, setDetail] = useState('');
  // Bumping this remounts the effect with a fresh generation and no session id
  // — a deliberate new shell, which is what 「重开」 means.
  const [reopen, setReopen] = useState(0);
  const [renderer, setRenderer] = useState('');
  const [themeMode, setThemeMode] = useState(() => {
    try { return window.localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
  });
  const themeRef = useRef(themeMode);
  themeRef.current = themeMode;

  useEffect(() => {
    if (!hostRef.current || !channelId) return undefined;
    // Per-generation state. The previous effect's sockets fire their onclose
    // asynchronously, possibly AFTER this one has started; sharing refs across
    // generations let a dead socket null out the live one and schedule a
    // reconnect nobody asked for.
    const gen = { disposed: false, ws: null, timer: 0, attempt: 0, session: readSession(channelId) };
    genRef.current = gen;

    const term = new Terminal({
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
      // 恒不用 transparent：WebGL 渲染器在透明底下表现不稳，而且没有前景色
      // 时 xterm 默认是白字——落在白底上就是看不见。
      theme: terminalTheme(themeRef.current),
      // 恒不开 minimumContrastRatio：它让渲染器对**每个单元格**算一次对比度
      // 并让配色缓存失效，是 xterm 里有名的掉帧源。两套十六色都是照各自底色
      // 调过的，对比度本就够——为一个已经解决的问题付每帧的代价恒不值得。
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(hostRef.current);
    termRef.current = term;
    fitRef.current = fit;

    // WebGL is the fast renderer but it fails on some GPUs/drivers; falling
    // back is normal, not an error, so it must never take the terminal down.
    // WebGL 渲染器。失败会静默回落到 DOM 渲染器——那是**每个单元格一个 DOM
    // 节点**，在一块 200×50 的网格上就是一万个节点，手感立刻变钝。所以失败
    // 恒须说出来，恒不吞掉：不然"有点不跟手"永远查不出原因。
    (async () => {
      try {
        const { WebglAddon } = await import('@xterm/addon-webgl');
        const addon = new WebglAddon();
        addon.onContextLoss(() => {
          console.warn('[terminal] WebGL 上下文丢失，已回落 DOM 渲染器——输入手感会变钝');
          addon.dispose();
        });
        term.loadAddon(addon);
        setRenderer('webgl');
      } catch (err) {
        console.warn('[terminal] WebGL 渲染器不可用，回落 DOM 渲染器（手感会变钝）：', err);
        setRenderer('dom');
      }
    })();

    try { fit.fit(); } catch { /* pre-layout */ }

    const observer = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* detached */ }
    });
    observer.observe(hostRef.current);

    let reconnectTimer = 0;

    const send = (obj) => {
      const ws = gen.ws;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    };

    const connect = () => {
      if (gen.disposed) return;
      setStatus(gen.session ? 'reconnecting' : 'connecting');
      const requested = gen.session;
      let ready = false;
      const ws = new WebSocket(ptyURL(channelId, requested, term.cols, term.rows));
      ws.binaryType = 'arraybuffer';
      gen.ws = ws;

      ws.onopen = () => { gen.attempt = 0; };
      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'ready') {
              ready = true;
              gen.session = msg.session || '';
              writeSession(channelId, gen.session);
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
        // A socket from a superseded generation must touch nothing.
        if (gen.disposed || gen.ws !== ws) return;
        gen.ws = null;
        // 1000 with a reason means the door ended it deliberately (the shell
        // exited, or the session was closed): reconnecting would silently
        // start a second shell, which is exactly what a person does not mean.
        if (event.code === 1000 && event.reason) {
          // 真结束（shell 退出/显式关闭）：清掉记录，否则下次会拿着一个
          // 死 id 去接，门会答 no such session。
          writeSession(channelId, '');
          setStatus('ended');
          setDetail(event.reason);
          return;
        }
        // 带着一个 session id 却连 ready 都没拿到 → 那个会话已经不在了
        // （宽限期过了，或者节点重启过）。浏览器的 WebSocket API 恒拿不到
        // 握手的 HTTP 状态码，所以恒不能靠状态码分辨；能分辨的事实只有
        // 「这次有没有握上手」。此时**必须把 id 丢掉重开**，否则就是拿着
        // 一个死 id 无限重试——用户看到的就是永远「重连中」的黑屏。
        if (!ready && requested) {
          writeSession(channelId, '');
          gen.session = '';
          gen.attempt = 0;
          setStatus('connecting');
          gen.timer = window.setTimeout(connect, 200);
          return;
        }
        // 连全新的会话都开不起来，就恒不再空转：说清楚并把重试交给人。
        if (!ready && gen.attempt >= RECONNECT_DELAYS.length) {
          setStatus('ended');
          setDetail('连不上终端——设备可能不在线');
          return;
        }
        const delay = RECONNECT_DELAYS[Math.min(gen.attempt, RECONNECT_DELAYS.length - 1)];
        gen.attempt += 1;
        setStatus('reconnecting');
        gen.timer = window.setTimeout(connect, delay);
      };
      ws.onerror = () => { setDetail('连接中断'); };
    };

    const disposeData = term.onData((data) => {
      if (!canWriteRef.current) return;
      // 按键走二进制原样发：终端输入恒不是结构化数据，套一层 JSON 只是给
      // 每一次击键加一轮编解码。门那侧本就把二进制帧直接当输入收。
      const ws = gen.ws;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(encoder.encode(data));
    });
    const disposeResize = term.onResize(({ cols, rows }) => {
      // Window size is a control message, never an escape smuggled into the
      // byte stream: it is low-frequency and has to be reliable (§4).
      send({ type: 'resize', cols, rows });
    });

    connect();

    return () => {
      gen.disposed = true;
      window.clearTimeout(gen.timer);
      observer.disconnect();
      disposeData.dispose();
      disposeResize.dispose();
      const ws = gen.ws;
      gen.ws = null;
      if (ws) {
        // Plain close, NOT a "close" control message: leaving means the
        // viewer went away, and the shell is supposed to outlive that.
        try { ws.close(); } catch { /* already gone */ }
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // canWrite is deliberately NOT a dependency — see canWriteRef above.
  }, [channelId, reopen]);

  // 切换配色恒不重建终端——重建会清空屏幕，而配色只是外观。
  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.theme = terminalTheme(themeMode);
    try { window.localStorage.setItem(THEME_KEY, themeMode); } catch { /* private mode */ }
  }, [themeMode]);

  // 隐藏期间容器尺寸为 0，xterm 量出来的行列会是垃圾值；重新可见时补一次
  // fit，并把新尺寸告诉设备。ResizeObserver 在 display:none 之间不保证触发，
  // 故恒不指望它。
  useEffect(() => {
    if (!visible) return undefined;
    const id = window.requestAnimationFrame(() => {
      try { fitRef.current?.fit(); } catch { /* detached */ }
      termRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [visible]);

  const label = {
    connecting: '连接中…',
    reconnecting: '重连中——断线期间的输出不会补',
    open: '',
    ended: detail || '会话已结束',
  }[status];

  return (
    <section id="workspace-panel-terminal" className="terminal-view" hidden={!visible} data-terminal-theme={themeMode} role="region" aria-labelledby="workspace-terminal-toggle">
      <div className={`terminal-status terminal-status-${status}`} role="status">
        <span>{label}</span>
        {renderer === 'dom' && <span className="terminal-status-warn">GPU 渲染不可用，手感会变钝</span>}
        <span className="terminal-status-actions">
          {status === 'ended' && (
            <button type="button" onClick={() => { writeSession(channelId, ''); setDetail(''); setReopen((n) => n + 1); }}>重开</button>
          )}
          <button
            type="button"
            aria-label={themeMode === 'dark' ? '切到浅色' : '切到暗色'}
            title={themeMode === 'dark' ? '切到浅色' : '切到暗色'}
            onClick={() => setThemeMode((m) => (m === 'dark' ? 'light' : 'dark'))}
          >{themeMode === 'dark' ? '浅色' : '暗色'}</button>
        </span>
      </div>
      <div className="terminal-host" ref={hostRef} />
    </section>
  );
}
