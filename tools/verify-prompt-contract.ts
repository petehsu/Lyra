import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CONTRACT_PATH = "crates/lyra-agent-runtime/src/prompt_contract.rs";
const AUDIT_PATH = "crates/lyra-agent-runtime/src/prompt_contract_audit.toml";
const SELF_TEST_ARG = "--self-test";

const PROTECTED_PREFIXES = [
  "crates/lyra-agent-runtime/src/prompts/",
  "crates/lyra-agent-runtime/src/native_backend/context_window",
  "crates/lyra-agent-runtime/src/native_backend/session_trim/",
  "crates/lyra-agent-runtime/src/native_backend/memory",
  "crates/lyra-tool-fs-core/src/catalog/",
];

const PROTECTED_FILES = new Set([
  "crates/lyra-agent-runtime/src/prompt_policy.rs",
  "crates/lyra-agent-runtime/src/prompt_templates.rs",
  "crates/lyra-agent-runtime/src/context_builder.rs",
  "crates/lyra-agent-runtime/src/native_backend/context.rs",
  "crates/lyra-agent-runtime/src/native_backend/turns.rs",
  "crates/lyra-agent-runtime/src/native_backend/prompt_cache.rs",
  "crates/lyra-agent-runtime/src/retention_policy.rs",
  "crates/lyra-agent-runtime/src/memory_service.rs",
  "crates/lyra-tool-fs-core/src/model.rs",
  "crates/lyra-tool-fs-core/src/registry.rs",
  "crates/lyra-tool-fs-core/src/catalog.rs",
  "crates/lyra-tool-fs-core/src/search.rs",
  "crates/lyra-tool-fs-core/src/scene.rs",
]);

function git(args: string[]): string[] {
  try {
    const output = execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function normalize(file: string): string {
  return file.split(path.sep).join("/").replace(/^\.\//, "");
}

function changedFilesFromGit(): string[] {
  const changed = new Set<string>();
  for (const file of git(["diff", "--name-only", "--cached"])) changed.add(normalize(file));
  for (const file of git(["diff", "--name-only"])) changed.add(normalize(file));
  for (const file of git(["ls-files", "--others", "--exclude-standard"])) {
    changed.add(normalize(file));
  }

  const baseRef = process.env.GITHUB_BASE_REF;
  if (process.env.CI && baseRef) {
    git(["fetch", "origin", baseRef, "--depth=1"]);
    for (const file of git(["diff", "--name-only", `origin/${baseRef}...HEAD`])) {
      changed.add(normalize(file));
    }
  } else if (process.env.CI) {
    for (const file of git(["diff", "--name-only", "HEAD^", "HEAD"])) {
      changed.add(normalize(file));
    }
  }

  return [...changed].sort();
}

function changedFilesFromArgs(args: string[]): string[] {
  return args
    .filter((arg) => arg !== SELF_TEST_ARG)
    .filter((arg) => !arg.startsWith("--"))
    .map(normalize)
    .filter(Boolean);
}

function changedFiles(): string[] {
  const cliFiles = changedFilesFromArgs(process.argv.slice(2));
  return cliFiles.length > 0 ? [...new Set(cliFiles)].sort() : changedFilesFromGit();
}

function isProtected(file: string): boolean {
  return PROTECTED_FILES.has(file) || PROTECTED_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function isSnapshotOrProjectionAck(file: string): boolean {
  return (
    file.startsWith("crates/lyra-agent-runtime/tests/snapshots/") ||
    file.startsWith("crates/lyra-agent-runtime/src/snapshots/") ||
    file.startsWith("crates/lyra-tool-fs-core/tests/snapshots/") ||
    /(^|\/)(prompt|context|memory|runtime|tool)[^/]*(snapshot|projection)/i.test(file) ||
    /(^|\/)[^/]*(snapshot|projection)[^/]*(prompt|context|memory|runtime|tool)/i.test(file)
  );
}

function promptContractGateDecision(changed: string[], auditAck: boolean) {
  const protectedChanged = changed.filter(isProtected);

  if (protectedChanged.length === 0) {
    return { ok: true, protectedChanged };
  }

  const contractChanged = changed.includes(CONTRACT_PATH);
  const snapshotOrProjectionChanged = changed.some(isSnapshotOrProjectionAck);

  return {
    ok: contractChanged || snapshotOrProjectionChanged || auditAck,
    protectedChanged,
  };
}

function auditAcknowledged(): boolean {
  const auditFile = path.join(ROOT, AUDIT_PATH);
  if (!fs.existsSync(auditFile)) return false;
  const source = fs.readFileSync(auditFile, "utf8");
  return /^\s*reviewed_prompt_contract\s*=\s*true\s*$/m.test(source);
}

function assertSelfTest(
  name: string,
  changed: string[],
  auditAck: boolean,
  expectedOk: boolean
) {
  const decision = promptContractGateDecision(changed.map(normalize), auditAck);
  if (decision.ok !== expectedOk) {
    throw new Error(
      `[prompt-contract self-test] ${name} expected ok=${expectedOk} but got ok=${decision.ok}`
    );
  }
}

function assertCliFiles(name: string, args: string[], expected: string[]) {
  const actual = changedFilesFromArgs(args);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `[prompt-contract self-test] ${name} expected ${JSON.stringify(
        expected
      )} but got ${JSON.stringify(actual)}`
    );
  }
}

function runSelfTest() {
  assertSelfTest(
    "protected path without contract review fails",
    ["crates/lyra-agent-runtime/src/prompt_policy.rs"],
    false,
    false
  );
  assertSelfTest(
    "contract bump allows protected path",
    [
      "crates/lyra-agent-runtime/src/prompt_policy.rs",
      "crates/lyra-agent-runtime/src/prompt_contract.rs",
    ],
    false,
    true
  );
  assertSelfTest(
    "projection snapshot allows protected path",
    [
      "crates/lyra-agent-runtime/src/native_backend/context.rs",
      "crates/lyra-agent-runtime/src/native_backend/tests/prompt_projection_snapshot.rs",
    ],
    false,
    true
  );
  assertSelfTest(
    "prompt snapshot allows protected path",
    [
      "crates/lyra-agent-runtime/src/prompt_policy.rs",
      "crates/lyra-agent-runtime/tests/snapshots/prompt_snapshots__full_prompt_report.snap",
    ],
    false,
    true
  );
  assertSelfTest(
    "unrelated snapshot does not acknowledge protected path",
    [
      "crates/lyra-agent-runtime/src/prompt_policy.rs",
      "crates/lyra-agent-reader/tests/snapshots/golden_html__clean_article.snap",
    ],
    false,
    false
  );
  assertSelfTest(
    "audit ack allows protected path",
    ["crates/lyra-tool-fs-core/src/registry.rs"],
    true,
    true
  );
  assertSelfTest("unprotected paths pass", ["README.md"], false, true);
  assertCliFiles(
    "cli changed file args normalize and ignore flags",
    [SELF_TEST_ARG, "./crates/lyra-agent-runtime/src/prompt_policy.rs", "--ignored"],
    ["crates/lyra-agent-runtime/src/prompt_policy.rs"]
  );
  console.log("[prompt-contract] self-test passed");
}

if (process.argv.includes(SELF_TEST_ARG)) {
  runSelfTest();
  process.exit(0);
}

const changed = changedFiles();
const auditAck = changed.includes(AUDIT_PATH) && auditAcknowledged();
const decision = promptContractGateDecision(changed, auditAck);
const protectedChanged = decision.protectedChanged;

if (protectedChanged.length === 0) {
  console.log("[prompt-contract] no protected prompt/context/memory/Tool-FS paths changed");
  process.exit(0);
}

if (decision.ok) {
  console.log(
    `[prompt-contract] protected paths reviewed: ${protectedChanged.length} protected file(s) changed`
  );
  process.exit(0);
}

console.error("\n[Prompt Contract Gate] Protected prompt/context/memory/Tool-FS paths changed:\n");
for (const file of protectedChanged) {
  console.error(`- ${file}`);
}
console.error(
  "\nUpdate crates/lyra-agent-runtime/src/prompt_contract.rs, update prompt/projection snapshots/tests, or change crates/lyra-agent-runtime/src/prompt_contract_audit.toml with reviewed_prompt_contract = true after an explicit contract review.\n"
);
process.exit(1);
