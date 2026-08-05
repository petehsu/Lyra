import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const argument = (name: string): string => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
};

const FILES = [
  "web/site/lib/legal/meta.ts",
  "web/site/lib/legal/terms.ts",
  "web/site/lib/legal/privacy.ts",
  "web/site/lib/legal/providers.ts",
  "legal/generated/THIRD-PARTY-NOTICES.md",
  "legal/generated/third-party-license-index.json",
  "legal/OPERATOR_LEGAL_RISK_REVIEW.md",
  "legal/RELEASE_COMPLIANCE.md",
  "docs/operations/preview-market-transfer-review.md",
  "docs/operations/copyleft-release.md"
] as const;

const digest = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const main = async (): Promise<void> => {
  const repository = path.resolve(argument("--repository"));
  const output = path.resolve(argument("--out"));
  const releaseVersion = argument("--release-version");
  const releaseTag = argument("--release-tag");
  const target = argument("--target");
  const files = [];
  for (const relativePath of FILES) {
    const bytes = await readFile(path.join(repository, relativePath));
    files.push({ path: relativePath, size: bytes.length, sha256: digest(bytes) });
  }
  const metadataSource = await readFile(
    path.join(repository, "web/site/lib/legal/meta.ts"),
    "utf8"
  );
  const legalVersion = metadataSource.match(/\n\s*version:\s*"([^"]+)"/u)?.[1];
  const legalStatus = metadataSource.match(/\n\s*status:\s*"(pending|effective)"/u)?.[1];
  const dateToken = metadataSource.match(/\n\s*effectiveDate:\s*(null|"[^"]+")/u)?.[1];
  if (legalVersion === undefined || legalStatus === undefined || dateToken === undefined) {
    throw new Error("Unable to read legal publication metadata");
  }
  const record = {
    schemaVersion: 1,
    releaseVersion,
    releaseTag,
    target,
    sourceCommit: process.env.GITHUB_SHA ?? "local-uncommitted",
    workflow: process.env.GITHUB_WORKFLOW ?? "local",
    workflowRunId: process.env.GITHUB_RUN_ID ?? null,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    generatedAt: new Date().toISOString(),
    operator: {
      legalName: "徐远豪",
      englishName: "Pete Hsu",
      tradingName: "Lyra"
    },
    legalPublication: {
      version: legalVersion,
      status: legalStatus,
      effectiveDate: dateToken === "null" ? null : dateToken.slice(1, -1),
      independentCounselObtained: false,
      operatorRiskReviewSigned: true,
      operatorPublicationInstructionDate: "2026-08-06",
      rightsFlowEndToEndVerified: false
    },
    files
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, sha256: digest(await readFile(output)) })}\n`);
};

main().catch((error: unknown) => {
  process.stderr.write(
    `lyra-publication-record: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
