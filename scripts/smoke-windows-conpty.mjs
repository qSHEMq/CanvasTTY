import assert from "node:assert/strict";
import pty from "node-pty";
import headless from "@xterm/headless";

const { Terminal } = headless;

if (process.platform !== "win32") {
  console.log("Windows ConPTY smoke skipped on this platform.");
  process.exit(0);
}

async function smoke() {
  const terminal = new Terminal({ cols: 80, rows: 24, scrollback: 100, allowProposedApi: true });
  const source = `
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let revision = 0;
    function paint() {
      const text = 'native \\u{f0d17} · resize';
      process.stdout.write('\\x1b[?7l\\r\\x1b[H\\x1b[2J\\x1b[3J' + text + '\\r\\x1b]0;frame-' + (++revision) + '\\x07');
    }
    process.stdin.on('data', data => { if (data.toString() === 'z') process.exit(0); else paint(); });
    paint();
  `;
  let resolveFrame;
  let rejectFrame;
  let expectedTitle = "frame-1";
  const completion = terminal.parser.registerOscHandler(0, title => {
    if (title === expectedTitle) resolveFrame?.();
    return false;
  });
  let frame = new Promise((resolve, reject) => { resolveFrame = resolve; rejectFrame = reject; });
  const child = pty.spawn(process.execPath, ["-e", source], {
    name: "xterm-256color", cols: 80, rows: 24, cwd: process.cwd(), env: process.env, useConptyDll: true
  });
  const watchdog = setTimeout(() => {
    console.error("Windows ConPTY smoke timed out.");
    try { process.kill(child.pid); } catch {}
    child.kill();
    process.exit(1);
  }, 15000);
  const data = child.onData(chunk => terminal.write(chunk));
  let resolveExit;
  const exited = new Promise(resolve => { resolveExit = resolve; });
  const exit = child.onExit(({ exitCode }) => {
    resolveExit();
    rejectFrame?.(new Error(`PTY exited early: ${exitCode}`));
  });
  try {
    await frame;
    for (const [index, [cols, rows]] of [[60, 12], [100, 30], [80, 24]].entries()) {
      terminal.resize(cols, rows);
      child.resize(cols, rows);
      expectedTitle = `frame-${index + 2}`;
      frame = new Promise((resolve, reject) => { resolveFrame = resolve; rejectFrame = reject; });
      child.write("x");
      await frame;
      const buffer = terminal.buffer.active;
      assert.equal(buffer.baseY, 0, "resize repaint must remove stale native history");
      assert.equal(buffer.getLine(0).translateToString(true), "native \u{f0d17} · resize");
    }
    child.write("z");
    await exited;
  } finally {
    data.dispose(); exit.dispose(); completion.dispose(); child.kill(); terminal.dispose();
    clearTimeout(watchdog);
  }
}

try {
  await smoke();
  console.log("Bundled ConPTY: Unicode cells, resize history and process exit verified.");
  // node-pty 1.1.0 leaves its socket worker alive after DLL-backed PTY exit.
  // Keep this native probe standalone rather than leaking that worker into the test suite.
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
