import { describe, expect, test } from "vitest";

import {
  isNativeHttpFamilyDownloadUrl,
  toHttpDownloadTransportUrl
} from "../transport-url";

describe("download transport URL helpers", () => {
  test("maps WebDAV schemes onto HTTP transport while keeping HTTP family routing", () => {
    expect(isNativeHttpFamilyDownloadUrl("webdav://dav.example.com/file.zip")).toBe(true);
    expect(isNativeHttpFamilyDownloadUrl("webdavs://dav.example.com/file.zip")).toBe(true);
    expect(toHttpDownloadTransportUrl("webdav://dav.example.com/file.zip")).toBe(
      "http://dav.example.com/file.zip"
    );
    expect(toHttpDownloadTransportUrl("webdavs://dav.example.com/file.zip")).toBe(
      "https://dav.example.com/file.zip"
    );
  });
});
