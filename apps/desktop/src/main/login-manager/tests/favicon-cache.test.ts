import { describe, expect, test } from "vitest";

import { parseIconLinksFromHtml } from "../favicon-cache";

// Self-check for the regex-based <link rel="icon"> extractor. The custom
// provider icon resolver depends on this returning the real declared icon
// href; if the regex breaks, icons silently fall back to /favicon.ico.
describe("parseIconLinksFromHtml", () => {
  test("extracts the highest-priority icon link from HTML", () => {
    const html = [
      `<html><head>`,
      `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`,
      `<link rel="icon" type="image/svg+xml" href="/assets/icon.svg">`,
      `<link rel="shortcut icon" href="/favicon.ico">`,
      `</head></html>`
    ].join("");
    // "shortcut icon" beats "icon" and "apple-touch-icon" by the sort order.
    expect(parseIconLinksFromHtml(html, "https://example.com")).toBe(
      "https://example.com/favicon.ico"
    );
  });

  test("resolves relative hrefs against the base URL", () => {
    const html = `<link rel="icon" type="image/svg+xml" href="/assets/v2/logo.svg">`;
    expect(parseIconLinksFromHtml(html, "https://api.example.com/v1")).toBe(
      "https://api.example.com/assets/v2/logo.svg"
    );
  });

  test("returns null when no icon link is declared", () => {
    const html = `<html><head><title>x</title></head></html>`;
    expect(parseIconLinksFromHtml(html, "https://example.com")).toBeNull();
  });

  test("tolerates href-before-rel attribute order", () => {
    const html = `<link href="/icon.png" rel="icon">`;
    expect(parseIconLinksFromHtml(html, "https://example.com")).toBe(
      "https://example.com/icon.png"
    );
  });
});