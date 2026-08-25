import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { ptyClient, writeSession } from '../net/pty.js';

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
// navigator.clipboard 只在安全上下文（https 或 localhost）里存在。Atoll 的
// 网页在内网/Tailscale 上常常是明文 http 访问的——那里它恒是 undefined，所以
// 必须留一条回退路径，否则"选择即复制"在真实部署里一次都不生效。
// execCommand('copy') 已废弃但恒可用，且它是非安全上下文里唯一可用的那条。
function copyFallback(text) {
  const pad = document.createElement('textarea');
  pad.value = text;
  // 恒不让它影响布局或抢走滚动位置。
  pad.setAttribute('readonly', '');
  pad.style.position = 'fixed';
  pad.style.top = '0';
  pad.style.left = '-9999px';
  document.body.appendChild(pad);
  const active = document.activeElement;
  try {
    // focus 恒不能省：execCommand('copy') 复制的是**当前选区**，而 select()
    // 在部分浏览器（尤其 iOS Safari）不会把焦点带过来，那时复制的是空的。
    // readonly 让 iOS 聚焦时恒不弹软键盘。
    pad.focus();
    pad.select();
    pad.setSelectionRange(0, pad.value.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    pad.remove();
    // 焦点必须还给终端，否则复制完就打不了字了。
    if (active instanceof HTMLElement) active.focus();
  }
}

let clipboardWarned = false;
async function copyToClipboard(text) {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 权限被拒或无用户手势，落到下面的回退 */ }
  const ok = copyFallback(text);
  // 恒不每次都喊：复制失败是环境性的，刷屏只会淹掉真正的错误。
  if (!ok && !clipboardWarned) {
    clipboardWarned = true;
    console.warn('[terminal] 选中内容无法写入剪贴板（浏览器拒绝了复制）');
  }
  return ok;
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
    // 卸载时 hostRef.current 可能已被 React 置空，事件必须摘在同一个节点上。
    const host = hostRef.current;
    // Per-generation state. The previous effect's sockets fire their onclose
    // asynchronously, possibly AFTER this one has started; sharing refs across
    // generations let a dead socket null out the live one and schedule a
    // reconnect nobody asked for.
    // 一代 = 一次挂载。连接与重连都归 net/pty.js 的单例管，这里只留
    // "本代还在不在"这一件事：await 之后到达的续体恒不许写别代的状态。
    const gen = { disposed: false, handle: null };
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
      let WebglAddon;
      try {
        ({ WebglAddon } = await import('@xterm/addon-webgl'));
      } catch (err) {
        if (!gen.disposed) {
          console.warn('[terminal] WebGL 渲染器加载失败，回落 DOM 渲染器（手感会变钝）：', err);
          setRenderer('dom');
        }
        return;
      }
      // 这里是 await 之后的续体，本代可能已经被卸载，term 也可能已经 dispose 掉。
      // 往一个 dispose 过的 terminal 上 loadAddon 会炸在它的内部字段上（linkifier
      // 随 dispose 一起清空），而那口锅会被上面的 catch 记到 WebGL 头上——更糟的是
      // 死掉那一代的 setRenderer('dom') 会盖掉活着那一代的成功，让人以为 GPU 不可用。
      // 恒不让上一代的续体写这一代的状态（与下面 WS 的分代同律）。
      if (gen.disposed || termRef.current !== term) return;
      try {
        const addon = new WebglAddon();
        addon.onContextLoss(() => {
          console.warn('[terminal] WebGL 上下文丢失，已回落 DOM 渲染器——输入手感会变钝');
          addon.dispose();
          if (!gen.disposed) setRenderer('dom');
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

    // 连接不再归这块终端所有：整页共用一条 WS，这里只要一条流。
    // 屏幕由服务端回放（platform/terminal 的回放环），所以卸载/重挂/刷新页面
    // 回来看到的都是走之前那一屏，恒不是黑屏。
    const handle = ptyClient().attach(channelId, {
      cols: term.cols,
      rows: term.rows,
      onData: (bytes) => term.write(bytes),
      onStatus: (next, detail) => {
        if (gen.disposed) return;
        setStatus(next);
        setDetail(detail || '');
      },
      onExit: (reason) => {
        if (gen.disposed) return;
        setStatus('ended');
        setDetail(reason);
      },
    });
    gen.handle = handle;

    // 选择即复制。终端里 Ctrl+C 恒是 SIGINT，恒不是复制——所以"拖一下就进
    // 剪贴板"不是锦上添花，它是这块区域唯一顺手的复制方式。
    //
    // 触发点是 mouseup 而不是 xterm 的 onSelectionChange：后者在拖拽过程中
    // 连续触发，而剪贴板写入需要用户手势（transient activation），拖到一半
    // 的那些帧恒不带手势。mouseup 既是选区的终点，又必然带手势。
    //
    // mouseup 挂在 document 上而不是终端节点上：从终端里往外拖、在页面别处
    // 松手是常见动作，挂在节点上那一次恒收不到，选了却没复制最恼人。
    let selecting = false;
    const beginSelect = (event) => { if (event.button === 0) selecting = true; };
    const endSelect = () => {
      if (!selecting) return;
      selecting = false;
      if (!term.hasSelection()) return;
      const text = term.getSelection();
      if (!text) return;
      void copyToClipboard(text);
    };
    host.addEventListener('mousedown', beginSelect);
    document.addEventListener('mouseup', endSelect);

    const disposeData = term.onData((data) => {
      if (!canWriteRef.current) return;
      // 按键走二进制原样发：终端输入恒不是结构化数据，套一层 JSON 只是给
      // 每一次击键加一轮编解码。门那侧本就把二进制帧直接当输入收。
      gen.handle?.write(encoder.encode(data));
    });
    const disposeResize = term.onResize(({ cols, rows }) => {
      // Window size is a control message, never an escape smuggled into the
      // byte stream: it is low-frequency and has to be reliable (§4).
      gen.handle?.resize(cols, rows);
    });

    return () => {
      gen.disposed = true;
      observer.disconnect();
      host.removeEventListener('mousedown', beginSelect);
      document.removeEventListener('mouseup', endSelect);
      for (const animation of hostRef.current?.getAnimations?.({ subtree: true }) || []) {
        try { animation.finish(); } catch { /* 无限时长的动画不参与回收 */ }
      }
      disposeData.dispose();
      disposeResize.dispose();
      // detach 恒不是 close：卸载只是 viewer 走人，shell 由宽限期保住（§4.4），
      // 屏幕由服务端的回放环保住。下次挂回来两样都还在。
      gen.handle?.detach();
      gen.handle = null;
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
