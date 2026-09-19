import fs from "node:fs";
import { parentPort, workerData } from "node:worker_threads";

import { collectTypeScriptConfigOptionDiagnostics } from "./tsconfig-option-diagnostics";
import { listTypeScriptConfigPaths } from "./tsconfig-project-scan";

type WorkerJob = {
  readonly mode?: "project" | "options";
  readonly rootPath?: string;
  readonly filePath?: string;
  readonly content?: string;
  readonly tsserverPath: string;
};

const job = workerData as WorkerJob;
if (parentPort === null || typeof job.tsserverPath !== "string") {
  process.exit(0);
}

if (job.mode === "options") {
  if (typeof job.filePath === "string") {
    const optionDiagnostics = collectTypeScriptConfigOptionDiagnostics(
      job.filePath,
      typeof job.content === "string" ? job.content : "",
      job.tsserverPath
    );
    parentPort.postMessage({
      groups: [{ filePath: job.filePath, diagnostics: optionDiagnostics }]
    });
  }
} else if (typeof job.rootPath === "string") {
  for (const filePath of listTypeScriptConfigPaths(job.rootPath)) {
    let content = "";
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const optionDiagnostics = collectTypeScriptConfigOptionDiagnostics(
      filePath,
      content,
      job.tsserverPath
    );
    if (optionDiagnostics.length > 0) {
      parentPort.postMessage({
        groups: [{ filePath, diagnostics: optionDiagnostics }]
      });
    }
    // ponytail: do not createProgram the whole project here. VS Code uses tsserver;
    // one Lyra bind was typechecking `參考/vscode` (2500 files × 96 configs) and froze.
  }
}
