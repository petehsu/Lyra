import { beforeEach, describe, expect, test, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFileSync: run, default: { execFileSync: run } }));
import { configureLinuxSecretStore, readSessionBusNames } from "../linux-secret-store";

const makeApp = (explicit = false, ready = false) => ({
  isReady: () => ready,
  commandLine: { hasSwitch: vi.fn(() => explicit), appendSwitch: vi.fn() }
});

describe("Linux secret store selection before Electron ready", () => {
  beforeEach(() => { run.mockReset(); });

  test.each(["sway", "Hyprland", "niri", "i3", ""])('uses the active Secret Service on "%s"', desktop => {
    const app = makeApp();
    const readNames = vi.fn(() => ["org.freedesktop.secrets"]);
    expect(configureLinuxSecretStore(app, { platform: "linux", env: { XDG_CURRENT_DESKTOP: desktop }, readNames }))
      .toBe("gnome-libsecret");
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith("password-store", "gnome-libsecret");
    expect(readNames).toHaveBeenCalledTimes(1);
  });

  test.each(["GNOME", "KDE", "sway:GNOME", "X-Cinnamon", "XFCE"])('preserves the native selection on "%s"', desktop => {
    const app = makeApp();
    const readNames = vi.fn();
    configureLinuxSecretStore(app, { platform: "linux", env: { XDG_CURRENT_DESKTOP: desktop }, readNames });
    expect(readNames).not.toHaveBeenCalled();
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();
  });

  test("preserves explicit overrides, non-Linux platforms, and already initialized backends", () => {
    const readNames = vi.fn();
    for (const [app, platform] of [[makeApp(true), "linux"], [makeApp(false, true), "linux"],
      [makeApp(), "darwin"], [makeApp(), "win32"]] as const) {
      configureLinuxSecretStore(app, { platform, env: {}, readNames });
      expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();
    }
    expect(readNames).not.toHaveBeenCalled();
  });

  test("prefers a running wallet to a different installed keyring", () => {
    const app = makeApp();
    const readNames = vi.fn(method => method === "ListNames" ? ["org.kde.kwalletd6"] : ["org.freedesktop.secrets"]);
    expect(configureLinuxSecretStore(app, { platform: "linux", env: {}, readNames })).toBe("kwallet6");
    expect(readNames).toHaveBeenCalledTimes(1);
  });

  test.each([["org.kde.kwalletd", "kwallet"], ["org.kde.kwalletd5", "kwallet5"],
    ["org.freedesktop.secrets", "gnome-libsecret"]])("detects activatable %s without starting it", (service, backend) => {
    const readNames = vi.fn(method => method === "ListNames" ? [] : [service]);
    expect(configureLinuxSecretStore(makeApp(), { platform: "linux", env: {}, readNames })).toBe(backend);
    expect(readNames.mock.calls).toEqual([["ListNames"], ["ListActivatableNames"]]);
  });

  test("does not invent a backend or enable plaintext when no service exists", () => {
    const app = makeApp();
    expect(configureLinuxSecretStore(app, { platform: "linux", env: {}, readNames: () => ["org.example.secrets"] })).toBeUndefined();
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();
  });

  test("reads exact service names with bounded, shell-free D-Bus calls", () => {
    run.mockReturnValue('array [ string "org.freedesktop.secrets" string "org.kde.kwalletd6" ]');
    expect(readSessionBusNames("ListNames")).toEqual(["org.freedesktop.secrets", "org.kde.kwalletd6"]);
    expect(run).toHaveBeenCalledWith("dbus-send", expect.arrayContaining(["org.freedesktop.DBus.ListNames"]),
      expect.objectContaining({ timeout: 700, maxBuffer: 65536, killSignal: "SIGKILL" }));
  });

  test("uses gdbus only if dbus-send is missing", () => {
    run.mockImplementationOnce(() => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); })
      .mockReturnValueOnce("(['org.freedesktop.secrets'],)");
    expect(readSessionBusNames("ListActivatableNames")).toEqual(["org.freedesktop.secrets"]);
    expect(run.mock.calls[1]?.[0]).toBe("gdbus");
  });

  test("a bus timeout does not crash startup or retry another client", () => {
    run.mockImplementation(() => { throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }); });
    expect(readSessionBusNames("ListNames")).toEqual([]);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
