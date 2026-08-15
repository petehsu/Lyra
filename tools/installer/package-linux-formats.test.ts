import assert from "node:assert/strict";
import test from "node:test";
import { linuxPackageArchitectures, linuxPackageVersion } from "./package-linux-formats";

test("maps Linux package architectures for x86_64", () => {
  assert.deepEqual(linuxPackageArchitectures("linux-x64"), {
    deb: "amd64", rpm: "x86_64", arch: "x86_64", flatpak: "x86_64"
  });
});

test("maps Linux package architectures for ARM64", () => {
  assert.deepEqual(linuxPackageArchitectures("linux-arm64"), {
    deb: "arm64", rpm: "aarch64", arch: "aarch64", flatpak: "aarch64"
  });
});

test("normalizes Preview versions for each package manager", () => {
  assert.deepEqual(linuxPackageVersion("0.1.0-preview.12"), {
    deb: "0.1.0~preview.12", rpm: "0.1.0~preview.12", arch: "0.1.0_preview.12"
  });
});
