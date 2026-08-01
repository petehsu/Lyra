import path from "node:path";

import {
  checkBuiltCoreOutput,
  checkPackagedCoreArchive,
  locatePackagedAsar,
  makeCorePayloadReport,
  validateBuilderConfiguration,
  writeCorePayloadReport
} from "./core-payload.ts";

const readArgument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
};

const main = async (): Promise<void> => {
  const repositoryRoot = path.resolve(readArgument("--repo") ?? process.cwd());
  const outputRoot = path.resolve(
    repositoryRoot,
    readArgument("--out") ?? "apps/desktop/out"
  );
  const explicitArchive = readArgument("--asar");
  const distRoot = readArgument("--dist");
  if (explicitArchive !== undefined && distRoot !== undefined) {
    throw new Error("Use either --asar or --dist, not both.");
  }

  await validateBuilderConfiguration(repositoryRoot);
  const output = await checkBuiltCoreOutput(outputRoot);
  const archivePath = explicitArchive !== undefined
    ? path.resolve(repositoryRoot, explicitArchive)
    : distRoot !== undefined
      ? await locatePackagedAsar(path.resolve(repositoryRoot, distRoot))
      : undefined;
  const packaged = archivePath === undefined
    ? undefined
    : await checkPackagedCoreArchive(archivePath, repositoryRoot);
  const report = makeCorePayloadReport(
    repositoryRoot,
    outputRoot,
    output,
    archivePath,
    packaged
  );

  const reportPath = readArgument("--report");
  if (reportPath !== undefined) {
    await writeCorePayloadReport(path.resolve(repositoryRoot, reportPath), report);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
