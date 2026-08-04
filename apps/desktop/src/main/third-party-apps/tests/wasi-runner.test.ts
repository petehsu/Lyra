import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  DEFAULT_THIRD_PARTY_WASI_LIMITS,
  ThirdPartyWasiRunnerError,
  createThirdPartyWasiRunnerService,
  isThirdPartyWasiEnabled,
  resolvePackagedWasiRunner,
  type ExecuteFile,
  type ThirdPartyWasiRunRequest
} from "../wasi-runner";

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const createFixture = (): {
  readonly allowedAppDataRoot: string;
  readonly allowedTemporaryRoot: string;
  readonly componentPackageRoot: string;
  readonly request: ThirdPartyWasiRunRequest;
  readonly resourcesRoot: string;
  readonly runner: string;
} => {
  const root = mkdtempSync(join(tmpdir(), "lyra-wasi-runner-test-"));
  temporaryDirectories.push(root);
  const resourcesRoot = join(root, "resources");
  const nativeRoot = join(resourcesRoot, "native", "darwin-arm64");
  mkdirSync(nativeRoot, { recursive: true });
  const runner = join(nativeRoot, "lyra-wasi-runner");
  writeFileSync(runner, "runner");
  chmodSync(runner, 0o700);

  const componentPackageRoot = join(root, "component-package");
  mkdirSync(componentPackageRoot);
  const componentPath = join(componentPackageRoot, "backend.wasm");
  writeFileSync(componentPath, "component");

  const allowedAppDataRoot = join(root, "app-data");
  const appDataRoot = join(allowedAppDataRoot, "example.notes");
  mkdirSync(appDataRoot, { recursive: true });
  const allowedTemporaryRoot = join(root, "temporary");
  const temporaryRoot = join(allowedTemporaryRoot, "example.notes");
  mkdirSync(temporaryRoot, { recursive: true });

  return {
    allowedAppDataRoot,
    allowedTemporaryRoot,
    componentPackageRoot,
    resourcesRoot,
    runner,
    request: {
      componentPackageRoot,
      componentPath,
      expectedSha256: "a".repeat(64),
      appDataRoot,
      temporaryRoot,
      permissions: ["wasi:app-data.read", "wasi:temp.write"]
    }
  };
};

describe("third-party WASI runner", () => {
  test("is default-off and has an independent feature flag", async () => {
    expect(isThirdPartyWasiEnabled({})).toBe(false);
    expect(isThirdPartyWasiEnabled({ LYRA_ENABLE_THIRD_PARTY_WASI: "1" })).toBe(true);
    const fixture = createFixture();
    const executeFile = vi.fn<ExecuteFile>();
    const service = createThirdPartyWasiRunnerService({
      resourcesRoot: fixture.resourcesRoot,
      allowedAppDataRoot: fixture.allowedAppDataRoot,
      allowedTemporaryRoot: fixture.allowedTemporaryRoot,
      executeFile
    });

    await expect(service.run(fixture.request)).rejects.toMatchObject({ code: "disabled" });
    expect(executeFile).not.toHaveBeenCalled();
  });

  test("executes only the packaged fixed runner without a shell", async () => {
    const fixture = createFixture();
    const executeFile = vi.fn<ExecuteFile>().mockResolvedValue({
      exitCode: 0,
      killed: false,
      signal: null,
      stderr: "",
      stdout: JSON.stringify({ protocolVersion: 1, status: "success" })
    });
    const service = createThirdPartyWasiRunnerService({
      resourcesRoot: fixture.resourcesRoot,
      allowedAppDataRoot: fixture.allowedAppDataRoot,
      allowedTemporaryRoot: fixture.allowedTemporaryRoot,
      platform: "darwin",
      arch: "arm64",
      featureEnabled: true,
      executeFile
    });

    await expect(service.run(fixture.request)).resolves.toEqual({ status: "success" });
    expect(executeFile).toHaveBeenCalledOnce();
    const [executable, args, options] = executeFile.mock.calls[0]!;
    expect(executable).toBe(realpathSync(fixture.runner));
    expect(args).toContain("--component");
    expect(args).toContain(realpathSync(fixture.request.componentPath));
    expect(args).toContain("--expected-sha256");
    expect(args).not.toContain("sh");
    expect(options).toMatchObject({
      env: {},
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024,
      shell: false,
      timeout: 32_000,
      windowsHide: true
    });
  });

  test("rejects paths outside the signed component package and authorized data roots", async () => {
    const fixture = createFixture();
    const outsideComponent = join(fixture.resourcesRoot, "outside.wasm");
    writeFileSync(outsideComponent, "component");
    const service = createThirdPartyWasiRunnerService({
      resourcesRoot: fixture.resourcesRoot,
      allowedAppDataRoot: fixture.allowedAppDataRoot,
      allowedTemporaryRoot: fixture.allowedTemporaryRoot,
      platform: "darwin",
      arch: "arm64",
      featureEnabled: true,
      executeFile: vi.fn<ExecuteFile>()
    });

    await expect(service.run({
      ...fixture.request,
      componentPath: outsideComponent
    })).rejects.toThrow("inside its package");
    await expect(service.run({
      ...fixture.request,
      appDataRoot: fixture.resourcesRoot
    })).rejects.toThrow("outside its authorized root");
  });

  test("rejects runner symlinks, unknown permissions, and limit escalation", async () => {
    const fixture = createFixture();
    const realRunner = join(fixture.resourcesRoot, "real-runner");
    writeFileSync(realRunner, "runner");
    chmodSync(realRunner, 0o700);
    rmSync(fixture.runner);
    symlinkSync(realRunner, fixture.runner);
    expect(() => resolvePackagedWasiRunner({
      resourcesRoot: fixture.resourcesRoot,
      platform: "darwin",
      arch: "arm64"
    })).toThrow("real file");

    const nextFixture = createFixture();
    const service = createThirdPartyWasiRunnerService({
      resourcesRoot: nextFixture.resourcesRoot,
      allowedAppDataRoot: nextFixture.allowedAppDataRoot,
      allowedTemporaryRoot: nextFixture.allowedTemporaryRoot,
      platform: "darwin",
      arch: "arm64",
      featureEnabled: true,
      executeFile: vi.fn<ExecuteFile>()
    });
    await expect(service.run({
      ...nextFixture.request,
      permissions: ["wasi:sockets.tcp" as never]
    })).rejects.toThrow("unsupported or duplicate");
    await expect(service.run({
      ...nextFixture.request,
      limits: {
        ...DEFAULT_THIRD_PARTY_WASI_LIMITS,
        maxMemoryBytes: DEFAULT_THIRD_PARTY_WASI_LIMITS.maxMemoryBytes + 1
      }
    })).rejects.toThrow("maxMemoryBytes");
  });

  test("kills hung runners and never trusts malformed structured output", async () => {
    const fixture = createFixture();
    const timedOut = createThirdPartyWasiRunnerService({
      resourcesRoot: fixture.resourcesRoot,
      allowedAppDataRoot: fixture.allowedAppDataRoot,
      allowedTemporaryRoot: fixture.allowedTemporaryRoot,
      platform: "darwin",
      arch: "arm64",
      featureEnabled: true,
      executeFile: vi.fn<ExecuteFile>().mockResolvedValue({
        exitCode: null,
        killed: true,
        signal: "SIGKILL",
        stderr: "",
        stdout: ""
      })
    });
    await expect(timedOut.run(fixture.request)).rejects.toEqual(
      new ThirdPartyWasiRunnerError("outerTimeout")
    );

    const malformed = createThirdPartyWasiRunnerService({
      resourcesRoot: fixture.resourcesRoot,
      allowedAppDataRoot: fixture.allowedAppDataRoot,
      allowedTemporaryRoot: fixture.allowedTemporaryRoot,
      platform: "darwin",
      arch: "arm64",
      featureEnabled: true,
      executeFile: vi.fn<ExecuteFile>().mockResolvedValue({
        exitCode: 0,
        killed: false,
        signal: null,
        stderr: "",
        stdout: "not-json"
      })
    });
    await expect(malformed.run(fixture.request)).rejects.toMatchObject({
      code: "invalidRunnerResponse"
    });
  });
});
