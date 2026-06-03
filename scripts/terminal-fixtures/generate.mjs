import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = join(repoRoot, "crates/lyra-terminal-core/tests/fixtures");
const checkOnly = process.argv.includes("--check");

const fixtures = {
  "npm-install-long-output.txt": `# terminal-fixture-v1: npm install long output
$ npm install
npm WARN deprecated request@2.88.2: request has been deprecated
npm WARN deprecated uuid@3.4.0: Please upgrade to version 7 or higher
added 1543 packages, and audited 1544 packages in 48s
273 packages are looking for funding
found 0 vulnerabilities
> esbuild@0.23.1 postinstall
> node install.js
[1/4] resolving packages
[2/4] fetching packages
[3/4] linking dependencies
[4/4] building fresh packages
Done in 48.22s.
`,
  "npm-test-failure-stack.txt": `# terminal-fixture-v1: npm test failure with stack trace
$ npm test -- --runInBand
> lyra-app@0.1.0 test
> vitest run --runInBand

FAIL src/terminal/session.test.ts
  TerminalSession
    x records command completion

  AssertionError: expected 'running' to equal 'completed'
    at src/terminal/session.test.ts:42:24
    at processTicksAndRejections (node:internal/process/task_queues:95:5)

Test Files 1 failed, 17 passed
Tests 1 failed, 92 passed
Duration 3.42s
`,
  "npm-run-dev-server.txt": `# terminal-fixture-v1: npm run dev long-running server
$ npm run dev
> lyra-app@0.1.0 dev
> vite --host 127.0.0.1

  VITE v5.4.10 ready in 642 ms
  Local:   http://127.0.0.1:5173/
  Network: use --host to expose
watching for file changes...
[hmr] connected
`,
  "cargo-test-success.txt": `# terminal-fixture-v1: cargo test success
$ cargo test -p lyra-terminal-core
running 38 tests
test command_tracker::tests::tracks_command ... ok
test memory::tests::replays_screen ... ok
test permissions::tests::scope_reuse ... ok

test result: ok. 38 passed; 0 failed; 0 ignored; finished in 1.47s
`,
  "cargo-test-failure.txt": `# terminal-fixture-v1: cargo test failure
$ cargo test -p lyra-terminal-core
running 38 tests
test tui_act::tests::stale_cursor_rejected ... FAILED

failures:
---- tui_act::tests::stale_cursor_rejected stdout ----
thread 'tui_act::tests::stale_cursor_rejected' panicked at crates/lyra-terminal-core/src/tui_act.rs:188:5:
expected stale cursor warning

failures:
    tui_act::tests::stale_cursor_rejected

test result: FAILED. 37 passed; 1 failed; finished in 1.92s
`,
  "github-cli-auth-code.txt": `# terminal-fixture-v1: GitHub CLI browser auth code entry workflow
$ gh auth login
? What account do you want to log into? GitHub.com
? What is your preferred protocol for Git operations? HTTPS
? Authenticate Git with your GitHub credentials? Yes
! First copy your one-time code: XXXX-XXXX
- Press Enter to open github.com in your browser...
Authentication complete. Token was stored in the system keychain.
`,
  "cli-wizard-approval.txt": `# terminal-fixture-v1: CLI wizard with one-time approval
$ npm create vite@latest
? Project name: lyra-terminal-demo
? Select a framework: React
? Select a variant: TypeScript
Scaffolding project in /workspaces/lyra-terminal-demo...
? Agent requests one-time approval to run: npm install
> Allow once
  Deny
Done. Now run:
  cd lyra-terminal-demo
  npm install
  npm run dev
`,
  "less-search-quit.ansi": `# terminal-fixture-v1: ansi-escaped less read/search/quit
\\x1b[?1049h\\x1b[H\\x1b[2JREADME.md\\r\\nLyra Terminal Release Gate\\r\\n\\x1b[7m/permission\\x1b[0m\\r\\nPermission ledger and audit timeline\\r\\n:\\x1b[?1049l
`,
  "vim-edit-save-quit.ansi": `# terminal-fixture-v1: ansi-escaped vim open/edit/save/quit
\\x1b[?1049h\\x1b[H\\x1b[2Jsrc/main.rs\\r\\nfn main() {\\r\\n    println!("hello lyra");\\r\\n}\\r\\n\\x1b[24;1H-- INSERT --\\x1b[24;1H:wq\\r\\n\\x1b[?1049l
`,
  "git-add-p-hunk-flow.txt": `# terminal-fixture-v1: git add -p hunk flow
$ git add -p
diff --git a/src/terminal.rs b/src/terminal.rs
@@ -12,6 +12,7 @@ pub fn start() {
 println!("terminal");
+println!("audit");
}
Stage this hunk [y,n,q,a,d,s,e,?]? y
staged 1 hunk
`,
  "node-repl.txt": `# terminal-fixture-v1: Node REPL
$ node
Welcome to Node.js v22.10.0.
Type ".help" for more information.
> const answer = 21 * 2
undefined
> answer
42
> .exit
`,
  "python-repl.txt": `# terminal-fixture-v1: Python REPL
$ python3
Python 3.12.0 (main, Jan 1 2026, 00:00:00) [Clang] on darwin
>>> answer = 21 * 2
>>> answer
42
>>> exit()
`,
  "debugger-prompt.txt": `# terminal-fixture-v1: debugger prompt
$ node inspect dist/server.js
< Debugger listening on ws://127.0.0.1:9229/debug
debug> cont
break in dist/server.js:14
 12 const server = createServer(app)
 13 server.listen(3000)
>14 throw new Error("port unavailable")
debug> repl
press Ctrl+C to leave debug repl
> process.pid
4242
`,
  "ssh-remote-limited.txt": `# terminal-fixture-v1: SSH session marked remote/limited
$ ssh deploy@example.internal
Welcome to example.internal
lyra-remote$ uname -a
Linux example.internal 6.8.0 x86_64 GNU/Linux
[lyra-terminal] process model: remote session, local process tree unavailable, limited=true
lyra-remote$ rm -rf ./build
[lyra-terminal] risk: remote destructive action requires elevated approval
`
};

const requiredNames = Object.keys(fixtures).sort();

let failed = false;
await mkdir(fixtureRoot, { recursive: true });

for (const name of requiredNames) {
  const expected = fixtures[name];
  const path = join(fixtureRoot, name);
  if (checkOnly) {
    let actual = "";
    try {
      actual = await readFile(path, "utf8");
    } catch (error) {
      console.error(`missing fixture: ${name}`);
      failed = true;
      continue;
    }
    if (actual !== expected) {
      console.error(`fixture drift: ${name}`);
      failed = true;
    }
  } else {
    await writeFile(path, expected, "utf8");
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`${checkOnly ? "checked" : "generated"} ${requiredNames.length} terminal fixtures`);
}
