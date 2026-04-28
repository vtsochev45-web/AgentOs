import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  ResponseParseError,
  customFetch,
  setApiKeyGetter,
  setAuthTokenGetter,
  setBaseUrl,
} from "./custom-fetch";

type FetchSpy = ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}

function textResponse(body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "text/plain");
  }
  return new Response(body, { ...init, headers });
}

function lastFetchInit(spy: FetchSpy): RequestInit {
  return spy.mock.calls.at(-1)![1] as RequestInit;
}

function lastFetchUrl(spy: FetchSpy): string {
  const arg = spy.mock.calls.at(-1)![0];
  return typeof arg === "string" ? arg : (arg as URL | Request).toString();
}

function lastFetchHeaders(spy: FetchSpy): Headers {
  return new Headers(lastFetchInit(spy).headers as HeadersInit);
}

describe("customFetch", () => {
  let fetchSpy: FetchSpy;

  beforeEach(() => {
    fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setBaseUrl(null);
    setAuthTokenGetter(null);
    setApiKeyGetter(null);
  });

  describe("auth header injection", () => {
    it("attaches Authorization: Bearer <token> when the auth getter returns a token", async () => {
      setAuthTokenGetter(() => "abc123");
      fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));

      await customFetch("/me");

      expect(lastFetchHeaders(fetchSpy).get("authorization")).toBe(
        "Bearer abc123"
      );
    });

    it("awaits an async auth-token getter", async () => {
      setAuthTokenGetter(async () => "async-token");
      fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));

      await customFetch("/me");

      expect(lastFetchHeaders(fetchSpy).get("authorization")).toBe(
        "Bearer async-token"
      );
    });

    it("does not attach Authorization when the getter returns null", async () => {
      setAuthTokenGetter(() => null);
      fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));

      await customFetch("/me");

      expect(lastFetchHeaders(fetchSpy).has("authorization")).toBe(false);
    });

    it("preserves an explicit Authorization header instead of overwriting it", async () => {
      setAuthTokenGetter(() => "from-getter");
      fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));

      await customFetch("/me", { headers: { Authorization: "Bearer explicit" } });

      expect(lastFetchHeaders(fetchSpy).get("authorization")).toBe(
        "Bearer explicit"
      );
    });

    it("attaches X-API-Key when the api-key getter returns a key", async () => {
      setApiKeyGetter(() => "key-xyz");
      fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));

      await customFetch("/things");

      expect(lastFetchHeaders(fetchSpy).get("x-api-key")).toBe("key-xyz");
    });

    it("preserves an explicit x-api-key header when the getter is set", async () => {
      setApiKeyGetter(() => "from-getter");
      fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));

      await customFetch("/things", { headers: { "x-api-key": "explicit" } });

      expect(lastFetchHeaders(fetchSpy).get("x-api-key")).toBe("explicit");
    });
  });

  describe("base URL", () => {
    it("prepends a configured base URL to relative paths", async () => {
      setBaseUrl("https://api.example.com");
      fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));

      await customFetch("/users/1");

      expect(lastFetchUrl(fetchSpy)).toBe("https://api.example.com/users/1");
    });

    it("trims trailing slashes from the base URL", async () => {
      setBaseUrl("https://api.example.com///");
      fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));

      await customFetch("/users/1");

      expect(lastFetchUrl(fetchSpy)).toBe("https://api.example.com/users/1");
    });

    it("does not rewrite absolute URLs", async () => {
      setBaseUrl("https://api.example.com");
      fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));

      await customFetch("https://other.example.com/x");

      expect(lastFetchUrl(fetchSpy)).toBe("https://other.example.com/x");
    });

    it("clears the base URL when null is passed", async () => {
      setBaseUrl("https://api.example.com");
      setBaseUrl(null);
      fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));

      await customFetch("/users/1");

      expect(lastFetchUrl(fetchSpy)).toBe("/users/1");
    });
  });

  describe("method handling and body inference", () => {
    it("rejects GET with a body", async () => {
      await expect(
        customFetch("/x", { method: "GET", body: "payload" })
      ).rejects.toThrow(/GET requests cannot have a body/);
    });

    it("rejects HEAD with a body", async () => {
      await expect(
        customFetch("/x", { method: "HEAD", body: "payload" })
      ).rejects.toThrow(/HEAD requests cannot have a body/);
    });

    it("uppercases the method on the outgoing request", async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));
      await customFetch("/x", { method: "post", body: '{"a":1}' });
      expect(lastFetchInit(fetchSpy).method).toBe("POST");
    });

    it("sets content-type: application/json when the string body looks like JSON", async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));
      await customFetch("/x", { method: "POST", body: '{"a":1}' });
      expect(lastFetchHeaders(fetchSpy).get("content-type")).toBe(
        "application/json"
      );
    });

    it("does not override an explicit content-type", async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));
      await customFetch("/x", {
        method: "POST",
        body: '{"a":1}',
        headers: { "content-type": "application/vnd.custom+json" },
      });
      expect(lastFetchHeaders(fetchSpy).get("content-type")).toBe(
        "application/vnd.custom+json"
      );
    });

    it("does not set content-type for non-JSON-looking string bodies", async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));
      await customFetch("/x", { method: "POST", body: "hello world" });
      expect(lastFetchHeaders(fetchSpy).has("content-type")).toBe(false);
    });

    it("sets a default Accept header when responseType is 'json'", async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));
      await customFetch("/x", { responseType: "json" });
      expect(lastFetchHeaders(fetchSpy).get("accept")).toBe(
        "application/json, application/problem+json"
      );
    });

    it("does not override an explicit Accept header", async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));
      await customFetch("/x", {
        responseType: "json",
        headers: { accept: "application/ld+json" },
      });
      expect(lastFetchHeaders(fetchSpy).get("accept")).toBe(
        "application/ld+json"
      );
    });
  });

  describe("response parsing — success", () => {
    it("returns null on 204 No Content", async () => {
      fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
      const result = await customFetch("/x");
      expect(result).toBeNull();
    });

    it("returns null on a HEAD request even with a body", async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ ignored: true }));
      const result = await customFetch("/x", { method: "HEAD" });
      expect(result).toBeNull();
    });

    it("returns null when content-length is 0", async () => {
      fetchSpy.mockResolvedValue(
        new Response("", {
          status: 200,
          headers: { "content-length": "0", "content-type": "application/json" },
        })
      );
      const result = await customFetch("/x");
      expect(result).toBeNull();
    });

    it("auto-detects JSON via content-type", async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ a: 1 }));
      const result = await customFetch<{ a: number }>("/x");
      expect(result).toEqual({ a: 1 });
    });

    it("auto-detects +json subtypes", async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ a: 2 }), {
          headers: { "content-type": "application/problem+json" },
        })
      );
      const result = await customFetch<{ a: number }>("/x");
      expect(result).toEqual({ a: 2 });
    });

    it("auto-detects text/* as text", async () => {
      fetchSpy.mockResolvedValue(textResponse("hello"));
      const result = await customFetch("/x");
      expect(result).toBe("hello");
    });

    it("strips a UTF-8 BOM before parsing JSON", async () => {
      fetchSpy.mockResolvedValue(
        new Response("﻿" + JSON.stringify({ a: 3 }), {
          headers: { "content-type": "application/json" },
        })
      );
      const result = await customFetch<{ a: number }>("/x");
      expect(result).toEqual({ a: 3 });
    });

    it("returns null for an empty JSON body", async () => {
      fetchSpy.mockResolvedValue(
        new Response("", {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
      const result = await customFetch("/x");
      expect(result).toBeNull();
    });

    it("throws ResponseParseError with rawBody on malformed JSON", async () => {
      fetchSpy.mockResolvedValue(
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

      await expect(customFetch("/x")).rejects.toMatchObject({
        name: "ResponseParseError",
        rawBody: "not-json",
        status: 200,
      });
    });

    it("respects an explicit responseType: 'text'", async () => {
      fetchSpy.mockResolvedValue(
        new Response('{"a":1}', {
          headers: { "content-type": "application/json" },
        })
      );
      const result = await customFetch("/x", { responseType: "text" });
      expect(result).toBe('{"a":1}');
    });

    it("respects an explicit responseType: 'json' for unknown content-types", async () => {
      fetchSpy.mockResolvedValue(
        new Response('{"a":1}', {
          headers: { "content-type": "application/octet-stream" },
        })
      );
      const result = await customFetch<{ a: number }>("/x", {
        responseType: "json",
      });
      expect(result).toEqual({ a: 1 });
    });
  });

  describe("response parsing — errors", () => {
    it("throws ApiError for non-2xx responses with status, statusText, and url", async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ detail: "no" }), {
          status: 403,
          statusText: "Forbidden",
          headers: { "content-type": "application/json" },
        })
      );

      await expect(customFetch("/x")).rejects.toMatchObject({
        name: "ApiError",
        status: 403,
        statusText: "Forbidden",
        method: "GET",
      });
    });

    it("uses 'detail' from a JSON error body in the error message", async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ detail: "missing field" }), {
          status: 400,
          statusText: "Bad Request",
          headers: { "content-type": "application/json" },
        })
      );

      await expect(customFetch("/x")).rejects.toThrow(
        "HTTP 400 Bad Request: missing field"
      );
    });

    it("uses 'title — detail' when both are present", async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          JSON.stringify({ title: "Validation failed", detail: "name required" }),
          {
            status: 422,
            statusText: "Unprocessable Entity",
            headers: { "content-type": "application/problem+json" },
          }
        )
      );

      await expect(customFetch("/x")).rejects.toThrow(
        "HTTP 422 Unprocessable Entity: Validation failed — name required"
      );
    });

    it("falls back to 'message' when 'detail' is absent", async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ message: "boom" }), {
          status: 500,
          statusText: "Internal Server Error",
          headers: { "content-type": "application/json" },
        })
      );

      await expect(customFetch("/x")).rejects.toThrow(
        "HTTP 500 Internal Server Error: boom"
      );
    });

    it("uses a string error body verbatim (truncated to 300 chars)", async () => {
      const longBody = "x".repeat(500);
      fetchSpy.mockResolvedValue(
        new Response(longBody, {
          status: 500,
          statusText: "Internal Server Error",
          headers: { "content-type": "text/plain" },
        })
      );

      const error = (await customFetch("/x").catch((e) => e)) as ApiError;
      expect(error).toBeInstanceOf(ApiError);
      expect(error.message.startsWith("HTTP 500 Internal Server Error: ")).toBe(
        true
      );
      // Truncation replaces the last char with an ellipsis at 300 chars total.
      expect(error.message.length).toBeLessThan(longBody.length);
      expect(error.message.endsWith("…")).toBe(true);
    });

    it("returns just 'HTTP <status> <statusText>' when the error body is empty", async () => {
      fetchSpy.mockResolvedValue(
        new Response(null, { status: 502, statusText: "Bad Gateway" })
      );
      await expect(customFetch("/x")).rejects.toThrow("HTTP 502 Bad Gateway");
    });

    it("exposes parsed JSON error data on the ApiError instance", async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ code: "X", detail: "boom" }), {
          status: 400,
          statusText: "Bad Request",
          headers: { "content-type": "application/json" },
        })
      );

      const error = (await customFetch("/x").catch((e) => e)) as ApiError<{
        code: string;
        detail: string;
      }>;

      expect(error).toBeInstanceOf(ApiError);
      expect(error.data).toEqual({ code: "X", detail: "boom" });
    });

    it("keeps unparseable JSON error bodies as the raw string", async () => {
      fetchSpy.mockResolvedValue(
        new Response("oops not json", {
          status: 500,
          statusText: "Internal Server Error",
          headers: { "content-type": "application/json" },
        })
      );

      const error = (await customFetch("/x").catch((e) => e)) as ApiError;
      expect(error).toBeInstanceOf(ApiError);
      expect(error.data).toBe("oops not json");
    });
  });

  describe("error class identity", () => {
    it("ApiError is an Error subclass with name 'ApiError'", async () => {
      fetchSpy.mockResolvedValue(
        new Response("", { status: 500, statusText: "x" })
      );
      const error = (await customFetch("/x").catch((e) => e)) as ApiError;
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.name).toBe("ApiError");
    });

    it("ResponseParseError is an Error subclass with name 'ResponseParseError'", async () => {
      fetchSpy.mockResolvedValue(
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
      const error = (await customFetch("/x").catch(
        (e) => e
      )) as ResponseParseError;
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ResponseParseError);
      expect(error.name).toBe("ResponseParseError");
    });
  });
});
