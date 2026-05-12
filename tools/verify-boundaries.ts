import fs from "node:fs";
import path from "node:path";

type ImportRule = {
  readonly fromPrefix: string;
  readonly disallowPrefix: string;
  readonly message: string;
};

type ForbiddenFileRule = {
  readonly relativePath: string;
  readonly message: string;
};

type ForbiddenPatternRule = {
  readonly scopePrefix: string;
  readonly pattern: RegExp;
  readonly message: string;
  readonly excludePathPattern?: RegExp;
  readonly allowLinePattern?: RegExp;
};

type ForbiddenDependencyRule = {
  readonly packageName: string;
  readonly message: string;
};

const ROOT = process.cwd();
const SOURCE_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".py", ".rs"]);
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "coverage", "target", ".venv"]);
const SCAN_ROOTS = ["apps", "services", "packages", "crates", "tools"];
const LONG_WORK_RUST_PATTERN =
  /\bLongWork\b|\blong_work\b|\bwork_slice\b|\bnative_long_work_goal\b|\bLongWorkContinuation\b|\bContinuationPacket\b|\bPrematureStop\b|\bStuckReport\b|\bAgentStuck\b|\blong_work_continuation\b|\bpremature_stop\b|\bstuck_report\b/;
const LONG_WORK_TS_PATTERN =
  /\bLongWork\b|\blongWork\b|\blong_work\b|\bworkSlice\b|\bLongWorkContinuation\b|\bContinuationPacket\b|\bPrematureStop\b|\bStuckReport\b|\bAgentStuck\b|\blongWorkContinuation\b|\bprematureStop\b|\bstuckReport\b/;
const FOLLOW_RUST_PATTERN =
  /\bFollowSession\b|\bFollowTarget\b|\bFollowEvent\b|\bLiveEditStream\b|\bWorkspaceCommit\b|\bLiveDraft\b|\bfollow_session\b|\bfollow_target\b|\bfollow_event\b|\blive_edit_stream\b|\bworkspace_commit\b|\blive_draft\b|\bdraft_buffer\b/;
const FOLLOW_TS_PATTERN =
  /\bAgentFollowSummary\b|\bAgentFollowTarget\b|\bAgentFollowEvent\b|\bAgentLiveEdit\b|\bAgentLiveDraft\b|\bfollowSummary\b|\bliveEditStream\b|\bworkspaceCommit\b|\bliveDraft\b|\bdraftBuffer\b/;
const ROLLBACK_RUST_PATTERN =
  /\bMessageRollbackAnchor\b|\bRollbackPreview\b|\bRollbackExecution\b|\bRollbackConflict\b|\bRecoveryExecution\b|\bMessageReopen\b|\bSideEffectRecord\b|\bWorkspaceSnapshot\b|\bConversationSnapshot\b|\bmessage_rollback_anchor\b|\brollback_preview\b|\brollback_execution\b|\brollback_conflict\b|\brecovery_execution\b|\bmessage_reopen\b|\breopen_message_for_rerun\b|\bside_effect_record\b|\bworkspace_snapshot\b|\bworkspace_file_snapshot\b|\bmessage_checkpoint\b/;
const ROLLBACK_TS_PATTERN =
  /\bAgentRollbackPreview\b|\bAgentRollbackAnchor\b|\bAgentRollbackExecution\b|\bAgentRollbackConflict\b|\bAgentRecoveryExecution\b|\bAgentMessageCheckpointSummary\b|\brollbackPreview\b|\brollbackExecution\b|\brollbackConflict\b|\bmessageRollback\b|\bsideEffectRecord\b|\bworkspaceSnapshot\b|\bmessageCheckpoint\b/;
const INTAKE_RUST_PATTERN =
  /\bUserIntentEnvelope\b|\bIntentTargetBinding\b|\bIntentAmbiguityFlag\b|\bRuntimeDecisionRecord\b|\bQuestionTicket\b|\bAssumptionRecord\b|\bInlineReference\b|\bReferenceAnchor\b|\bReferenceResolution\b|\buser_intent_envelope\b|\bintent_target_binding\b|\bruntime_decision_record\b|\bquestion_ticket\b|\bassumption_record\b|\binline_reference\b|\breference_anchor\b|\breference_resolution\b/;
const INTAKE_TS_PATTERN =
  /\bAgentIntentEnvelope\b|\bAgentIntentSummary\b|\bAgentReferenceSummary\b|\bAgentAssumptionSummary\b|\bAgentQuestionTicket\b|\bAgentClarification\b|\bInlineReference\b|\bReferenceAnchor\b|\bQuestionTicket\b|\bAssumptionRecord\b|\bresolveClarification\b|\bquestionTicketId\b|\bintentSummary\b|\breferenceSummary\b|\bassumptionSummary\b/;
const POLICY_SECURITY_RUST_PATTERN =
  /\bProjectManifest\b|\bEffectivePolicy\b|\bPolicySourceRecord\b|\bSecurityGate\b|\bSecurityDecisionRecord\b|\bSecretHandle\b|\bSecretDetectionReport\b|\bRedactionPolicy\b|\bSensitiveResource\b|\bSensitiveFilePolicy\b|\beffective_policy\b|\bpolicy_source_record\b|\bsecurity_gate\b|\bsecurity_decision_record\b|\bsecret_handle\b|\bsecret_detection_report\b|\bredaction_policy\b|\bsensitive_resource\b|\bsensitive_file_policy\b/;
const POLICY_SECURITY_TS_PATTERN =
  /\bAgentPolicySummary\b|\bAgentSecuritySummary\b|\bAgentSecurityDecisionSummary\b|\bProjectManifest\b|\bEffectivePolicy\b|\bSecurityDecisionRecord\b|\bSecretHandle\b|\bSecretDetectionReport\b|\bSecurityStatusRow\b|\bpolicySummary\b|\bsecuritySummary\b|\bsecurityDecision\b|\bsecretHandle\b|\bsecretDetectionReport\b/;

const importRules: readonly ImportRule[] = [
  {
    fromPrefix: "apps/desktop/src",
    disallowPrefix: "services/",
    message: "Desktop app must not import service internals directly; use contracts/protocol boundary."
  },
  {
    fromPrefix: "services/control-plane/src",
    disallowPrefix: "apps/",
    message: "Control plane must not import app layer."
  },
  {
    fromPrefix: "services/browser-automation/src",
    disallowPrefix: "apps/",
    message: "Browser automation service must not import app layer."
  },
  {
    fromPrefix: "packages/plugin-sdk/src",
    disallowPrefix: "services/",
    message: "Plugin SDK must stay framework-agnostic; do not import service internals."
  },
  {
    fromPrefix: "apps/desktop/src/modules/workbench/",
    disallowPrefix: "apps/desktop/src/main/",
    message:
      "Renderer workbench modules must not import Electron main-process modules directly; use shared desktop-bridge contracts."
  },
  {
    fromPrefix: "apps/desktop/src/main/",
    disallowPrefix: "apps/desktop/src/modules/workbench/",
    message:
      "Electron main-process modules must not import renderer workbench modules."
  }
];

const forbiddenFileRules: readonly ForbiddenFileRule[] = [
  {
    relativePath: "apps/desktop/src/modules/workbench/browser-tabs/service.ts",
    message:
      "Workspace tab lifecycle must live in workspace-tabs; do not reintroduce compatibility wrappers."
  },
  {
    relativePath: "apps/desktop/src/modules/workbench/browser-tabs/types.ts",
    message:
      "Workspace tab lifecycle types must live in workspace-tabs; do not alias through browser-tabs."
  }
];

const forbiddenPatternRules: readonly ForbiddenPatternRule[] = [
  {
    scopePrefix: "",
    pattern: /\b(?:AI-generated|generated by (?:ChatGPT|Codex|an AI)|bulk-generated|bulk generated|mechanically generated)\b/i,
    excludePathPattern: /^tools\/verify-boundaries\.ts$/,
    message:
      "Source files must not carry AI/bulk-generated code markers. Land hand-written, reviewed modules with clear ownership instead."
  },
  {
    scopePrefix: "apps/desktop/src/",
    pattern: /from\s+["'][^"']*\/pretext(?:\/|["'])|import\s+["'][^"']*\/pretext(?:\/|["'])/,
    message:
      "Workbench source must not import from the local pretext reference repository. Use ai-panel/text-layout internalized modules only."
  },
  {
    scopePrefix: "apps/desktop/src/",
    pattern: /@chenglou\/pretext/,
    message:
      "Workbench source must not import @chenglou/pretext directly. Use ai-panel/text-layout internalized modules only."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/sidebar/composer.tsx",
    pattern: /\bscrollHeight\b/,
    message:
      "Sidebar composer height must be driven by ai-panel/text-layout service, not direct scrollHeight reads."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/",
    pattern: /\buseBrowserTabsModel\b/,
    message:
      "Use workspace-tabs service directly (`useWorkspaceTabsModel`); avoid compatibility lifecycle hooks."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/",
    pattern: /browser-tabs\/service/,
    message:
      "Do not import browser-tabs service internals. Lifecycle lives in workspace-tabs."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/",
    pattern: /browser-tabs\/types/,
    message:
      "Do not import browser-tabs lifecycle types. Use workspace-tabs types."
  },
  {
    scopePrefix: "apps/desktop/src/main/runtime/workbench-fs-port.ts",
    pattern: /\bprobePathFallback\b|\bcollectFilePathsFallback\b/,
    message:
      "Workbench FS port must stay native-backed only; do not reintroduce Node fallback helpers."
  },
  {
    scopePrefix: "apps/desktop/src/main/runtime/workbench-fs-port.ts",
    pattern: /from\s+["']node:fs["']/,
    message:
      "Workbench FS port must not depend on Node fs fallback implementation."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/",
    pattern: /\blocalStorage\b|\bsessionStorage\b/,
    excludePathPattern: /\/tests\//,
    message:
      "Workbench modules must not use browser storage directly. Use workbenchState bridge-backed storage adapters."
  },
  {
    scopePrefix: "apps/desktop/src/main/",
    pattern: /\bapp\.getPath\("userData"\)|\buserDataPath\b/,
    message:
      "Main-process modules must use the centralized storage roots resolver. Do not use app.getPath(\"userData\") or userDataPath plumbing."
  },
  {
    scopePrefix: "apps/desktop/src/",
    pattern: /\bApp Connectors\b/,
    message:
      "Desktop must not expose App Connectors as an independent product surface; use the plugin UI."
  },
  {
    scopePrefix: "apps/desktop/src/",
    pattern: new RegExp([
      "aiContext" + "Collapse",
      "enableModelGuided" + "Compaction",
      "Context " + "Collapse"
    ].join("|")),
    message:
      "Desktop settings must not expose the removed model-guided context compaction UI."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/",
    pattern: new RegExp([
      "[\"'`]\\/status\\b",
      "[\"'`]\\/clear\\b",
      "[\"'`]\\/fast\\b",
      "[\"'`]\\/experimental\\b",
      "[\"'`]\\/memories\\b",
      "[\"'`]\\/approvals\\b",
      "[\"'`]\\/permissions\\b",
      "[\"'`]\\/personality\\b",
      "[\"'`]\\/compact\\b",
      "[\"'`]\\/debug-m-",
      "[\"'`]\\/rollout\\b",
      "[\"'`]\\/test-approval\\b",
      "[\"'`]\\/debug-config\\b",
      "[\"'`]\\/title\\b",
      "[\"'`]\\/statusline\\b",
      "[\"'`]\\/theme\\b",
      "[\"'`]\\/quit\\b",
      "[\"'`]\\/exit\\b",
      "[\"'`]\\/logout\\b",
      "[\"'`]\\/feedback\\b",
      "[\"'`]\\/apps\\b",
      "[\"'`]\\/plugins\\b",
      "[\"'`]\\/collab\\b",
      "[\"'`]\\/agent\\b",
      "[\"'`]\\/side\\b",
      "[\"'`]\\/subagents\\b",
      "[\"'`]\\/realtime\\b",
      "[\"'`]\\/settings\\b",
      "[\"'`]\\/mention\\b"
    ].join("|")),
    excludePathPattern: /\/tests\//,
    message:
      "AI panel must not expose unsupported Codex-style slash commands. Use explicit Lyra UI actions instead."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/thread-view.tsx",
    pattern: LONG_WORK_TS_PATTERN,
    message:
      "LongWork UI must live in focused AI panel components, not in the thread view."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/use-lyra-thread-runtime.ts",
    pattern: LONG_WORK_TS_PATTERN,
    message:
      "LongWork renderer state must live in focused runtime helpers, not in the broad Lyra thread runtime hook."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/use-agent-composer-runtime.ts",
    pattern: LONG_WORK_TS_PATTERN,
    message:
      "LongWork renderer state must live in focused runtime helpers, not in the broad composer runtime hook."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/use-ai-panel-surface-runtime.ts",
    pattern: LONG_WORK_TS_PATTERN,
    message:
      "LongWork surface behavior must live in focused helpers/components, not in the broad AI panel surface runtime hook."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/execution-todo-list.tsx",
    pattern: LONG_WORK_TS_PATTERN,
    message:
      "Execution todo UI must not absorb LongWork rendering. Add a compact LongWork status component instead."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/verification-summary-list.tsx",
    pattern: LONG_WORK_TS_PATTERN,
    message:
      "Verification UI must not absorb LongWork rendering. Keep verification rows and long-work status separate."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/pending-approval-list.tsx",
    pattern: LONG_WORK_TS_PATTERN,
    message:
      "Approval UI must not absorb LongWork rendering. Link blocked long work by ids from a focused component."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/patch-preview-card.tsx",
    pattern: LONG_WORK_TS_PATTERN,
    message:
      "Patch preview must stay patch-focused; do not add LongWork UI or state there."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/patch-review-strip.tsx",
    pattern: LONG_WORK_TS_PATTERN,
    message:
      "Patch review strip must stay patch-focused; do not add LongWork UI or state there."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/tests/thread-view.test.tsx",
    pattern: LONG_WORK_TS_PATTERN,
    message:
      "LongWork UI tests must live beside the focused LongWork component, not in broad thread-view tests."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/tests/use-lyra-thread-runtime.test.tsx",
    pattern: LONG_WORK_TS_PATTERN,
    message:
      "LongWork runtime tests must target focused helpers, not the broad Lyra thread runtime test."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/thread-view.tsx",
    pattern: FOLLOW_TS_PATTERN,
    message:
      "Follow UI must live in focused AI panel components, not in the thread view."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/use-lyra-thread-runtime.ts",
    pattern: FOLLOW_TS_PATTERN,
    message:
      "Follow renderer state must live in focused runtime helpers, not in the broad Lyra thread runtime hook."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/use-ai-panel-surface-runtime.ts",
    pattern: FOLLOW_TS_PATTERN,
    message:
      "Follow surface behavior must live in focused helpers/components, not in the broad AI panel surface runtime hook."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/execution-todo-list.tsx",
    pattern: FOLLOW_TS_PATTERN,
    message:
      "Execution todo UI must not absorb Follow rendering. Add a compact Follow process component instead."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/verification-summary-list.tsx",
    pattern: FOLLOW_TS_PATTERN,
    message:
      "Verification UI must not absorb Follow rendering. Keep verification rows and Follow process state separate."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/pending-approval-list.tsx",
    pattern: FOLLOW_TS_PATTERN,
    message:
      "Approval UI must not absorb Follow rendering. Link blocked Follow operations by ids from a focused component."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/patch-preview-card.tsx",
    pattern: FOLLOW_TS_PATTERN,
    message:
      "Patch preview must stay patch-focused; do not add Follow UI or state there."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/patch-review-strip.tsx",
    pattern: FOLLOW_TS_PATTERN,
    message:
      "Patch review strip must stay patch-focused; do not add Follow UI or state there."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/thread-view.tsx",
    pattern: ROLLBACK_TS_PATTERN,
    message:
      "Rollback UI must live in focused AI panel components, not in the thread view."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/use-lyra-thread-runtime.ts",
    pattern: ROLLBACK_TS_PATTERN,
    message:
      "Rollback renderer state must live in focused runtime helpers, not in the broad Lyra thread runtime hook."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/use-ai-panel-surface-runtime.ts",
    pattern: ROLLBACK_TS_PATTERN,
    message:
      "Rollback surface behavior must live in focused helpers/components, not in the broad AI panel surface runtime hook."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/execution-todo-list.tsx",
    pattern: ROLLBACK_TS_PATTERN,
    message:
      "Execution todo UI must not absorb rollback rendering. Add a focused rollback preview component instead."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/verification-summary-list.tsx",
    pattern: ROLLBACK_TS_PATTERN,
    message:
      "Verification UI must not absorb rollback rendering. Keep rollback preview state separate."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/pending-approval-list.tsx",
    pattern: ROLLBACK_TS_PATTERN,
    message:
      "Approval UI must not absorb rollback rendering. Link rollback approvals by ids from focused recovery UI."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/patch-preview-card.tsx",
    pattern: ROLLBACK_TS_PATTERN,
    message:
      "Patch preview must stay patch-focused; do not add message rollback UI or state there."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/patch-review-strip.tsx",
    pattern: ROLLBACK_TS_PATTERN,
    message:
      "Patch review strip must stay patch-focused; do not add message rollback UI or state there."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/thread-view.tsx",
    pattern: INTAKE_TS_PATTERN,
    message:
      "Intake and clarification UI must live in focused AI panel components, not in the thread view."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/use-lyra-thread-runtime.ts",
    pattern: INTAKE_TS_PATTERN,
    message:
      "Intake and clarification renderer state must live in focused helpers/components, not in the broad Lyra thread runtime hook."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/use-agent-composer-runtime.ts",
    pattern: INTAKE_TS_PATTERN,
    message:
      "Composer runtime may collect raw input, but structured intake/reference protocol logic must live in focused helpers."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/use-ai-panel-surface-runtime.ts",
    pattern: INTAKE_TS_PATTERN,
    message:
      "Clarification and intake actions must live in focused helpers, not in the broad AI panel surface runtime hook."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/pending-approval-list.tsx",
    pattern: INTAKE_TS_PATTERN,
    message:
      "Approval UI must not absorb clarification rendering. Add a compact ClarificationList component instead."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/execution-todo-list.tsx",
    pattern: INTAKE_TS_PATTERN,
    message:
      "Execution todo UI must not absorb intake or clarification rendering. Keep those rows focused and separate."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/thread-view.tsx",
    pattern: POLICY_SECURITY_TS_PATTERN,
    message:
      "Policy and security UI must live in focused AI panel components, not in the thread view."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/use-lyra-thread-runtime.ts",
    pattern: POLICY_SECURITY_TS_PATTERN,
    message:
      "Policy and security renderer state must live in focused helpers/components, not in the broad Lyra thread runtime hook."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/use-agent-composer-runtime.ts",
    pattern: POLICY_SECURITY_TS_PATTERN,
    message:
      "Composer runtime may collect user input, but policy/security protocol state belongs in focused helpers."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/use-ai-panel-surface-runtime.ts",
    pattern: POLICY_SECURITY_TS_PATTERN,
    message:
      "AI panel surface runtime must not absorb policy/security state machines. Add focused helpers and compact rows."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/pending-approval-list.tsx",
    pattern: POLICY_SECURITY_TS_PATTERN,
    message:
      "Approval UI must not absorb policy/security rendering. Link approval tickets to focused security summaries by id."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/execution-todo-list.tsx",
    pattern: POLICY_SECURITY_TS_PATTERN,
    message:
      "Execution todo UI must not absorb policy/security rendering. Keep policy/security rows focused and separate."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/verification-summary-list.tsx",
    pattern: POLICY_SECURITY_TS_PATTERN,
    message:
      "Verification UI must not absorb policy/security rendering. Reference security decisions by id only."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/patch-preview-card.tsx",
    pattern: POLICY_SECURITY_TS_PATTERN,
    message:
      "Patch preview must stay patch-focused; do not add policy/security UI or state there."
  },
  {
    scopePrefix: "apps/desktop/src/modules/workbench/ai-panel/patch-review-strip.tsx",
    pattern: POLICY_SECURITY_TS_PATTERN,
    message:
      "Patch review strip must stay patch-focused; do not add policy/security UI or state there."
  }
];

const forbiddenDependencyRules: readonly ForbiddenDependencyRule[] = [
  {
    packageName: "@chenglou/pretext",
    message:
      "Dependency @chenglou/pretext is forbidden in this repository. Keep text layout internalized under ai-panel/text-layout."
  }
];

const violations: string[] = [];

function walk(dir: string, out: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, out);
    } else {
      out.push(abs);
    }
  }
  return out;
}

function rel(abs: string): string {
  return path.relative(ROOT, abs).split(path.sep).join("/");
}

function checkImportBoundaries(file: string, content: string): void {
  const fileRel = rel(file);
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const m = line.match(/from\s+["']([^"']+)["']/) ?? line.match(/import\s+["']([^"']+)["']/);
    if (!m) continue;
    const spec = m[1];
    if (!spec || (!spec.startsWith(".") && !spec.startsWith("/"))) continue;

    const resolved = path.normalize(path.join(path.dirname(fileRel), spec)).split(path.sep).join("/");

    for (const rule of importRules) {
      if (fileRel.startsWith(rule.fromPrefix) && resolved.startsWith(rule.disallowPrefix)) {
        violations.push(`${fileRel}:${i + 1} ${rule.message} (import: ${spec})`);
      }
    }
  }
}

function checkForbiddenPatterns(file: string, content: string): void {
  const fileRel = rel(file);
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    for (const rule of forbiddenPatternRules) {
      if (fileRel.startsWith(rule.scopePrefix) === false) {
        continue;
      }
      if (rule.excludePathPattern !== undefined && rule.excludePathPattern.test(fileRel)) {
        continue;
      }
      if (rule.pattern.test(line) === false) {
        continue;
      }
      if (rule.allowLinePattern !== undefined && rule.allowLinePattern.test(line)) {
        continue;
      }
      violations.push(`${fileRel}:${i + 1} ${rule.message}`);
    }
  }
}

const files = SCAN_ROOTS.flatMap((entry) => {
  const abs = path.join(ROOT, entry);
  if (!fs.existsSync(abs)) return [];
  return walk(abs);
}).filter((f) => SOURCE_EXT.has(path.extname(f)));

for (const rule of forbiddenFileRules) {
  const abs = path.join(ROOT, rule.relativePath);
  if (fs.existsSync(abs)) {
    violations.push(`${rule.relativePath} ${rule.message}`);
  }
}

if (fs.existsSync(path.join(ROOT, "vendor", "portable-pty"))) {
  violations.push("Vendored PTY source must live under third-party/rust/portable-pty, not the old vendor PTY path.");
}

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  checkImportBoundaries(file, content);
  checkForbiddenPatterns(file, content);
}

const dependencyFiles = [
  "package.json",
  "apps/desktop/package.json"
];

for (const relativePath of dependencyFiles) {
  const absolutePath = path.join(ROOT, relativePath);
  if (fs.existsSync(absolutePath) === false) {
    continue;
  }
  const raw = fs.readFileSync(absolutePath, "utf8");
  const parsed = JSON.parse(raw) as {
    readonly dependencies?: Record<string, string>;
    readonly devDependencies?: Record<string, string>;
    readonly optionalDependencies?: Record<string, string>;
    readonly peerDependencies?: Record<string, string>;
  };
  const dependencyMaps = [
    parsed.dependencies,
    parsed.devDependencies,
    parsed.optionalDependencies,
    parsed.peerDependencies
  ];

  for (const rule of forbiddenDependencyRules) {
    const hasForbiddenDependency = dependencyMaps.some((dependencyMap) =>
      dependencyMap !== undefined
      && Object.prototype.hasOwnProperty.call(dependencyMap, rule.packageName)
    );
    if (hasForbiddenDependency) {
      violations.push(`${relativePath} ${rule.message}`);
    }
  }
}

if (violations.length > 0) {
  console.error("\n[Lyra Structure Guard] Violations found:\n");
  for (const v of violations) console.error(`- ${v}`);
  process.exit(1);
}

console.log("[Lyra Structure Guard] OK");
