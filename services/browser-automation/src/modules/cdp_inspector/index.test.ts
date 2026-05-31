import { describe, expect, test } from "vitest";

import {
  applyResponseBodyBudget,
  classifyNetworkFailure,
  createCdpNetworkRequestState,
  filterBrowserDiagnostics,
  normalizeCdpConsoleApiCalled,
  normalizeCdpNetworkLoadingFailed,
  normalizeCdpNetworkResponseReceived,
  normalizeCdpRuntimeExceptionThrown,
  redactHeaders
} from "./index";

describe("cdp_inspector diagnostics", () => {
  test("normalizes console errors with location and stack", () => {
    const entry = normalizeCdpConsoleApiCalled({
      type: "error",
      args: [{ type: "string", value: "boom" }],
      timestamp: 1_765_000_000_000,
      stackTrace: {
        callFrames: [
          {
            functionName: "render",
            url: "http://localhost:5173/src/App.tsx",
            lineNumber: 9,
            columnNumber: 4
          }
        ]
      }
    });

    expect(entry).toMatchObject({
      source: "console",
      severity: "error",
      message: "boom",
      url: "http://localhost:5173/src/App.tsx",
      line: 10,
      column: 5
    });
    expect(entry?.stack).toContain("render");
  });

  test("clips runtime exception stacks to the requested budget", () => {
    const callFrames = Array.from({ length: 8 }, (_, index) => ({
      functionName: `frame${index}`,
      url: `http://localhost:${3000 + index}/bundle.js`,
      lineNumber: index,
      columnNumber: 0
    }));
    const entry = normalizeCdpRuntimeExceptionThrown(
      {
        timestamp: 1_765_000_000_000,
        exceptionDetails: {
          text: "Uncaught",
          exception: { description: "Error: exploded" },
          stackTrace: { callFrames }
        }
      },
      { maxFrames: 3, maxChars: 400 }
    );

    expect(entry).toMatchObject({
      source: "runtime",
      severity: "error",
      message: "Error: exploded",
      stackTruncated: true,
      stackFrameCount: 8
    });
    expect(entry?.stack).toContain("frame0");
    expect(entry?.stack).not.toContain("frame7");
  });

  test("classifies HTTP, CORS, and loading failure diagnostics", () => {
    const request = createCdpNetworkRequestState({
      requestId: "req-1",
      documentURL: "http://localhost:5173/",
      request: {
        url: "http://api.local.test/users?debug=1",
        method: "POST",
        headers: { Authorization: "Bearer secret", Accept: "application/json" }
      },
      wallTime: 1_765_000_000
    });

    const response = normalizeCdpNetworkResponseReceived(
      {
        requestId: "req-1",
        type: "Fetch",
        response: {
          url: "http://api.local.test/users?debug=1",
          status: 500,
          statusText: "Internal Server Error",
          mimeType: "application/json",
          headers: { "Set-Cookie": "sid=secret", "Content-Type": "application/json" }
        }
      },
      request ?? undefined
    );
    const corsFailure = normalizeCdpNetworkLoadingFailed(
      {
        requestId: "req-1",
        errorText: "Access to fetch at X has been blocked by CORS policy",
        corsErrorStatus: { corsError: "MissingAllowOriginHeader" }
      },
      request ?? undefined
    );

    expect(response).toMatchObject({
      source: "network",
      severity: "error",
      status: 500,
      method: "POST",
      domain: "api.local.test",
      path: "/users?debug=1",
      failureKind: "http"
    });
    expect(response?.requestHeaders?.Authorization).toBe("[redacted]");
    expect(response?.responseHeaders?.["Set-Cookie"]).toBe("[redacted]");
    expect(corsFailure).toMatchObject({
      failureKind: "cors",
      method: "POST"
    });
    expect(classifyNetworkFailure({ errorText: "net::ERR_NAME_NOT_RESOLVED" })).toBe("dns");
  });

  test("redacts sensitive headers and filters by network fields", () => {
    expect(redactHeaders({
      Cookie: "session=abc",
      "X-API-Key": "secret",
      Accept: "text/html"
    })).toEqual({
      Accept: "text/html",
      Cookie: "[redacted]",
      "X-API-Key": "[redacted]"
    });

    const entries = [
      {
        source: "console" as const,
        severity: "error" as const,
        message: "client error",
        timestamp: "2026-05-31T00:00:00.000Z"
      },
      {
        source: "network" as const,
        severity: "error" as const,
        message: "server failed",
        timestamp: "2026-05-31T00:00:01.000Z",
        method: "GET",
        status: 500,
        domain: "api.example.com",
        path: "/v1/users"
      }
    ];

    expect(filterBrowserDiagnostics(entries, {
      includeConsole: false,
      domain: "example.com",
      path: "/v1",
      method: "GET",
      status: 500
    })).toEqual([entries[1]]);
  });

  test("applies a small response body budget", () => {
    expect(applyResponseBodyBudget("abcdef", false, 3)).toEqual({
      responseBody: "abc",
      responseBodyTruncated: true
    });
  });
});
