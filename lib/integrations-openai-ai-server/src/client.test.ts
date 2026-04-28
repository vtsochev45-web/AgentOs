import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The OpenAI SDK constructor itself is not the unit under test here —
// we only care that client.ts hands it the right apiKey/baseURL.
// Replace it with a spy that records the constructor args and exposes them
// as instance properties so the loaded `openai` export is inspectable.
vi.mock("openai", () => {
  const ctor = vi.fn(function (this: Record<string, unknown>, opts: unknown) {
    Object.assign(this, opts);
  });
  return { default: ctor };
});

const originalEnv = { ...process.env };

async function loadClient() {
  vi.resetModules();
  return import("./client");
}

function clearKeys() {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_BASE_URL;
}

describe("openai client module", () => {
  beforeEach(() => {
    clearKeys();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws a clear error when neither key is set", async () => {
    await expect(loadClient()).rejects.toThrow(
      /OPENROUTER_API_KEY \(or OPENAI_API_KEY\) must be set\./
    );
  });

  it("uses OPENROUTER_API_KEY when set", async () => {
    process.env.OPENROUTER_API_KEY = "rk-router";
    const { openai } = (await loadClient()) as unknown as {
      openai: { apiKey: string; baseURL: string };
    };
    expect(openai.apiKey).toBe("rk-router");
  });

  it("falls back to OPENAI_API_KEY when OPENROUTER_API_KEY is absent", async () => {
    process.env.OPENAI_API_KEY = "sk-openai";
    const { openai } = (await loadClient()) as unknown as {
      openai: { apiKey: string };
    };
    expect(openai.apiKey).toBe("sk-openai");
  });

  it("prefers OPENROUTER_API_KEY when both are set", async () => {
    process.env.OPENROUTER_API_KEY = "rk-router";
    process.env.OPENAI_API_KEY = "sk-openai";
    const { openai } = (await loadClient()) as unknown as {
      openai: { apiKey: string };
    };
    expect(openai.apiKey).toBe("rk-router");
  });

  it("falls back to OPENAI_API_KEY when OPENROUTER_API_KEY is the empty string", async () => {
    // `||` treats empty string as falsy, so an explicitly-empty router key
    // should not block the OpenAI fallback. Pinning this so a future
    // refactor to `??` doesn't silently change semantics.
    process.env.OPENROUTER_API_KEY = "";
    process.env.OPENAI_API_KEY = "sk-openai";
    const { openai } = (await loadClient()) as unknown as {
      openai: { apiKey: string };
    };
    expect(openai.apiKey).toBe("sk-openai");
  });

  it("defaults baseURL to https://openrouter.ai/api/v1 when OPENROUTER_BASE_URL is unset", async () => {
    process.env.OPENROUTER_API_KEY = "rk-router";
    const { openai } = (await loadClient()) as unknown as {
      openai: { baseURL: string };
    };
    expect(openai.baseURL).toBe("https://openrouter.ai/api/v1");
  });

  it("uses OPENROUTER_BASE_URL when set", async () => {
    process.env.OPENROUTER_API_KEY = "rk-router";
    process.env.OPENROUTER_BASE_URL = "https://proxy.example.com/v1";
    const { openai } = (await loadClient()) as unknown as {
      openai: { baseURL: string };
    };
    expect(openai.baseURL).toBe("https://proxy.example.com/v1");
  });

  it("passes the OpenAI constructor a single options object containing both fields", async () => {
    process.env.OPENROUTER_API_KEY = "rk-router";
    process.env.OPENROUTER_BASE_URL = "https://proxy.example.com/v1";

    await loadClient();

    const OpenAI = (await import("openai")).default as unknown as ReturnType<
      typeof vi.fn
    >;
    expect(OpenAI).toHaveBeenCalledTimes(1);
    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: "rk-router",
      baseURL: "https://proxy.example.com/v1",
    });
  });
});
