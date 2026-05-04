import { describe, expect, test } from "vitest";

import { isCurlDownloadUrl } from "../curl-engine";

describe("isCurlDownloadUrl", () => {
  test("routes FTP family protocols to the curl backend", () => {
    expect(isCurlDownloadUrl("ftp://example.com/file.zip")).toBe(true);
    expect(isCurlDownloadUrl("ftps://example.com/file.zip")).toBe(true);
    expect(isCurlDownloadUrl("sftp://example.com/file.zip")).toBe(true);
    expect(isCurlDownloadUrl("https://example.com/file.zip")).toBe(false);
  });
});
