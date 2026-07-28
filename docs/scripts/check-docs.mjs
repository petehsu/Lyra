#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(scriptDir, "..");

const walkMarkdown = (root) => {
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.name.endsWith(".md")) {
        files.push(absolute);
      }
    }
  };
  visit(root);
  return files.sort();
};

const relative = (value) => path.relative(docsRoot, value).split(path.sep).join("/");
const errors = [];
const markdownFiles = walkMarkdown(docsRoot);

for (const file of markdownFiles) {
  const content = fs.readFileSync(file, "utf8");
  const header = content.split(/\r?\n/).slice(0, 16).join("\n");
  if (!/^Audience: Internal$/m.test(header)) {
    errors.push(`${relative(file)}: missing internal audience marker`);
  }
  if (!/^Status: (Active|Accepted|Proposed|Draft|Experimental|Superseded|Generated)$/m.test(header)) {
    errors.push(`${relative(file)}: missing or invalid status`);
  }
  if (!/^Last verified: \d{4}-\d{2}-\d{2}$/m.test(header)) {
    errors.push(`${relative(file)}: missing last verified date`);
  }

  if (relative(file).startsWith("decisions/ADR-")) {
    for (const section of ["## Context", "## Decision", "## Alternatives considered"]) {
      if (!content.includes(section)) {
        errors.push(`${relative(file)}: missing ${section}`);
      }
    }
    if (!/^Date: \d{4}-\d{2}-\d{2}$/m.test(header)) {
      errors.push(`${relative(file)}: missing ADR date`);
    }
  }

  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].trim().split("#")[0];
    if (
      target.length === 0
      || /^[a-z]+:/i.test(target)
      || target.startsWith("/")
      || target.includes("{")
    ) {
      continue;
    }
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
    if (!fs.existsSync(resolved)) {
      errors.push(`${relative(file)}: broken link ${match[1]}`);
    }
  }
}

const retired = [
  "architecture/agent-provider-protocol-rust-refactor.md",
  "architecture/lyra-agent-boundary-audit.md",
  "architecture/lyra-agent-vendor-audit.md",
  "architecture/native-core-engineering.md",
  "tailwind-surface-migration-spec.md",
  "visual-conformance-rubric.md",
];
for (const retiredPath of retired) {
  if (fs.existsSync(path.join(docsRoot, retiredPath))) {
    errors.push(`${retiredPath}: retired path still exists`);
  }
}

const generation = spawnSync(
  process.execPath,
  [path.join(scriptDir, "generate-inventories.mjs"), "--check"],
  { cwd: path.resolve(docsRoot, ".."), encoding: "utf8" },
);
if (generation.status !== 0) {
  errors.push(generation.stderr.trim() || generation.stdout.trim() || "inventory check failed");
}

if (errors.length > 0) {
  process.stderr.write(
    `Internal documentation check failed:\n${errors.map((error) => `- ${error}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Internal documentation check passed (${markdownFiles.length} Markdown files).\n`,
  );
}

