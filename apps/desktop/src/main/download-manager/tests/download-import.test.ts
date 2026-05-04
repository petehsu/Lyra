import { describe, expect, test } from "vitest";

import {
  parseDownloadImportItems,
  parseDownloadUrls
} from "../download-import";

describe("download import parsing", () => {
  test("extracts supported URLs from pasted text", () => {
    expect(parseDownloadUrls({
      text: "mirror https://example.com/a.zip and sftp://files.example.com/b.tar webdavs://dav.example.com/c.iso magnet:?xt=urn:btih:abc&dn=Example"
    })).toEqual([
      "https://example.com/a.zip",
      "sftp://files.example.com/b.tar",
      "webdavs://dav.example.com/c.iso",
      "magnet:?xt=urn:btih:abc&dn=Example"
    ]);
  });

  test("keeps remote torrent URLs as downloadable imports", () => {
    expect(parseDownloadImportItems({
      text: "https://example.com/releases/app.torrent"
    })).toEqual([{
      url: "https://example.com/releases/app.torrent"
    }]);
  });

  test("groups Metalink urls as mirrors and reads checksums", () => {
    const items = parseDownloadImportItems({
      text: `
        <metalink>
          <file name="app.zip">
            <hash type="sha-256">abc123</hash>
            <resources>
              <url>https://mirror-a.example.com/app.zip</url>
              <url>https://mirror-b.example.com/app.zip</url>
            </resources>
          </file>
        </metalink>
      `
    });

    expect(items).toEqual([{
      url: "https://mirror-a.example.com/app.zip",
      mirrors: ["https://mirror-b.example.com/app.zip"],
      checksum: {
        algorithm: "sha256",
        expected: "abc123"
      }
    }]);
  });
});
