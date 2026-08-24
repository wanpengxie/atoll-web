// Mock terminal leg.
//
// Real PTY, no native module: `script -qfc` allocates one for us, so vim,
// colours and Ctrl-C behave exactly as they will against the real node. That
// fidelity is the point — a fake terminal would prove nothing about the UI.
//
// The OSC 133 scan mirrors platform/terminal/osc133.go, including the part
// that matters most: bytes are passed through UNCHANGED, and boundaries come
// back with offsets so a chunk carrying both C and D attributes its output
// correctly.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ESC = 0x1b;
const BEL = 0x07;
const MAX_OSC = 8192;

export function createScanner() {
  let pending = [];
  let inOSC = false;
  let cmd = '';
  let cwd = '';
  let started = false;

  function interpret(body, out, at) {
    if (body.startsWith('133;')) {
      const rest = body.slice(4);
      if (rest.startsWith('C')) {
        started = true;
        out.push({ kind: 'start', offset: at, text: cmd, cwd });
      } else if (rest.startsWith('D')) {
        if (!started) { cmd = ''; return; }
        const i = rest.indexOf(';');
        const code = i >= 0 ? Number.parseInt(rest.slice(i + 1).trim(), 10) : NaN;
        out.push({ kind: 'end', offset: at, text: cmd, cwd, exitCode: Number.isNaN(code) ? 0 : code });
        started = false;
        cmd = '';
      }
    } else if (body.startsWith('1337;AtollCmd=')) {
      cmd = unquote(body.slice('1337;AtollCmd='.length));
    } else if (body.startsWith('1337;AtollCwd=')) {
      cwd = unquote(body.slice('1337;AtollCwd='.length));
    }
  }

  return function feed(chunk) {
    const out = [];
    for (let i = 0; i < chunk.length; i += 1) {
      const b = chunk[i];
      const at = i + 1;
      if (!inOSC) {
        if (b === ESC) { pending = [ESC]; continue; }
        if (pending.length === 1 && pending[0] === ESC && b === 0x5d) { inOSC = true; pending = []; continue; }
        pending = [];
        continue;
      }
      if (b === BEL) { interpret(Buffer.from(pending).toString(), out, at); inOSC = false; pending = []; continue; }
      if (b === ESC) { pending.push(ESC); continue; }
      if (pending.length && pending[pending.length - 1] === ESC) {
        if (b === 0x5c) {
          interpret(Buffer.from(pending.slice(0, -1)).toString(), out, at);
          inOSC = false; pending = [];
          continue;
        }
        pending.push(b);
        continue;
      }
      if (pending.length >= MAX_OSC) { pending = []; inOSC = false; continue; }
      pending.push(b);
    }
    return out;
  };
}

function unquote(input) {
  const s = input.trim();
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).split(`'\\''`).join("'");
  }
  return s.replace(/\\(.)/g, '$1');
}

// stripControl mirrors terminal.StripControl: the recorded tail is text for a
// person to read, and a surviving OSC 133 mark would be worse than noise.
export function stripControl(input) {
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    if (c !== ESC) { if (c !== BEL) out += input[i]; continue; }
    if (i + 1 >= input.length) break;
    const next = input[i + 1];
    if (next === ']') {
      i += 2;
      while (i < input.length) {
        if (input.charCodeAt(i) === BEL) break;
        if (input.charCodeAt(i) === ESC && input[i + 1] === '\\') { i += 1; break; }
        i += 1;
      }
    } else if (next === '[') {
      i += 2;
      while (i < input.length) {
        const code = input.charCodeAt(i);
        if (code >= 0x40 && code <= 0x7e) break;
        i += 1;
      }
    } else {
      i += 1;
    }
  }
  return out;
}

// spawnPTY starts a login shell on a real pty. integrationPath, when given, is
// sourced so OSC 133 marks appear — without it the terminal works but no
// command is recorded, which is exactly the honest behaviour of the real node.
export function spawnPTY({ cols = 80, rows = 24, cwd = process.cwd(), integrationPath = '' } = {}) {
  const shell = process.env.SHELL || '/bin/bash';
  const isZsh = /zsh$/.test(shell);
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    ATOLL_TERMINAL: '1',
    COLUMNS: String(cols),
    LINES: String(rows),
  };
  let zdotdir = '';
  if (integrationPath && fs.existsSync(integrationPath) && isZsh) {
    // ZDOTDIR rather than writing `source …` to stdin: that write races the
    // shell's own startup and gets eaten or mangled. This loads the fragment
    // deterministically, at rc time, in the interactive shell that will emit
    // the marks — and still runs the user's real rc first so the terminal
    // looks like theirs.
    zdotdir = fs.mkdtempSync(path.join(os.tmpdir(), 'atoll-zdotdir-'));
    const userZshrc = path.join(os.homedir(), '.zshrc');
    fs.writeFileSync(path.join(zdotdir, '.zshrc'),
      `[ -f ${JSON.stringify(userZshrc)} ] && source ${JSON.stringify(userZshrc)}
` +
      `source ${JSON.stringify(integrationPath)}
`);
    env.ZDOTDIR = zdotdir;
    env.ATOLL_SHELL_INTEGRATION = '1';
  }
  const child = spawn('script', ['-qfc', `${shell} -i`, '/dev/null'], {
    cwd, env, stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.on('exit', () => {
    if (zdotdir) { try { fs.rmSync(zdotdir, { recursive: true, force: true }); } catch { /* gone */ } }
  });
  return child;
}
