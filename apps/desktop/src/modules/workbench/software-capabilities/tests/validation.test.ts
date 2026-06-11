import {
  describe,
  expect,
  test
} from "vitest";

import {
  baseName,
  optionalLoginAuthMethodKind,
  parentDirectoryPath,
  requirePermissionGranted,
  validateInputSchema
} from "../validation";

describe("software capability validation", () => {
  test("validates required fields, property types, and enum values", () => {
    const schema = {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string" },
        mode: { type: "string", enum: ["read", "write"] },
        maxItems: { type: "number" }
      }
    };

    expect(validateInputSchema({}, schema)).toEqual(["path is required"]);
    expect(validateInputSchema({
      path: 42,
      mode: "delete",
      maxItems: "10"
    }, schema)).toEqual([
      "path must be string",
      "mode must be one of read, write",
      "maxItems must be number"
    ]);
    expect(validateInputSchema({
      path: "/tmp",
      mode: "read",
      maxItems: 10
    }, schema)).toEqual([]);
  });

  test("requires explicit runtime permission and validates login auth kinds", () => {
    expect(() => requirePermissionGranted({}, "software.install")).toThrow(
      "software.install requires runtime permission"
    );
    expect(() => requirePermissionGranted(
      { permissionGranted: true },
      "software.install"
    )).not.toThrow();
    expect(optionalLoginAuthMethodKind({ kind: "oauth" }, "kind")).toBe("oauth");
    expect(optionalLoginAuthMethodKind({ kind: "invalid" }, "kind")).toBeUndefined();
  });

  test("normalizes parent and base names for cross-platform paths", () => {
    expect(parentDirectoryPath("C:\\Users\\Lyra\\image.png")).toBe("C:/Users/Lyra");
    expect(baseName("C:\\Users\\Lyra\\image.png")).toBe("image.png");
    expect(parentDirectoryPath("/file.txt")).toBe("/");
  });
});
