// Provider switching is env-only: the same client talks to Nebius (default) or the NVIDIA API.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { providerFromUrl } from "@/lib/config";

const LLM_ENV = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_PROVIDER", "LLM_JSON_MODE", "NEBIUS_API_KEY", "NEBIUS_BASE_URL", "MODEL_NANO", "OFFLINE_MOCK"];

async function load(env: Record<string, string>) {
  for (const k of LLM_ENV) delete process.env[k];
  Object.assign(process.env, env);
  vi.resetModules();
  const llm = await import("@/lib/llm");
  const { config } = await import("@/lib/config");
  return { ...llm, config };
}

function okResponse(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
}

describe("providerFromUrl", () => {
  it("infers the provider from the base URL, and LLM_PROVIDER wins", () => {
    expect(providerFromUrl("https://api.tokenfactory.nebius.com/v1")).toBe("nebius");
    expect(providerFromUrl("https://api.tokenfactory.us-central1.nebius.com/v1")).toBe("nebius");
    expect(providerFromUrl("https://integrate.api.nvidia.com/v1")).toBe("nvidia");
    expect(providerFromUrl("http://localhost:8000/v1")).toBe("openai-compatible");
    expect(providerFromUrl("https://integrate.api.nvidia.com/v1", "openai-compatible")).toBe("openai-compatible");
  });
});

describe("LLM config + client", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to Nebius Token Factory and still accepts the NEBIUS_* names", async () => {
    const { config } = await load({ NEBIUS_API_KEY: "nb-key", MODEL_NANO: "nvidia/nvidia-nemotron-3-nano-30b-a3b" });
    expect(config.llm).toMatchObject({ provider: "nebius", baseUrl: "https://api.tokenfactory.nebius.com/v1", apiKey: "nb-key" });
  });

  it("switches to the NVIDIA API with env vars only", async () => {
    const { chat, RunContext, config } = await load({ LLM_BASE_URL: "https://integrate.api.nvidia.com/v1/", LLM_API_KEY: "nvapi-test", MODEL_NANO: "nvidia/nemotron-nano-3-30b-a3b" });
    expect(config.llm.provider).toBe("nvidia");
    fetchMock.mockResolvedValueOnce(okResponse('{"ok":true}'));
    const ctx = new RunContext();
    await chat(ctx, { tier: "nano", stage: "t", messages: [{ role: "user", content: "hi" }], json: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer nvapi-test");
    expect(JSON.parse(init.body)).toMatchObject({ model: "nvidia/nemotron-nano-3-30b-a3b", response_format: { type: "json_object" }, chat_template_kwargs: { enable_thinking: false } });
    expect(ctx.logs[0]).toMatchObject({ provider: "nvidia", model: "nvidia/nemotron-nano-3-30b-a3b", tokensIn: 10, tokensOut: 5, ok: true });
  });

  it("LLM_* takes precedence over NEBIUS_*", async () => {
    const { config } = await load({ NEBIUS_API_KEY: "nb", NEBIUS_BASE_URL: "https://api.tokenfactory.nebius.com/v1", LLM_API_KEY: "nv", LLM_BASE_URL: "https://integrate.api.nvidia.com/v1" });
    expect(config.llm).toMatchObject({ provider: "nvidia", apiKey: "nv" });
  });

  it("drops unsupported optional params on 400 (thinking toggle, then JSON mode) and remembers per model", async () => {
    const { chat, RunContext } = await load({ LLM_BASE_URL: "https://integrate.api.nvidia.com/v1", LLM_API_KEY: "k", MODEL_NANO: "m" });
    fetchMock
      .mockResolvedValueOnce(new Response("bad chat_template_kwargs", { status: 400 }))
      .mockResolvedValueOnce(new Response("bad response_format", { status: 400 }))
      .mockResolvedValueOnce(okResponse("{}"))
      .mockResolvedValueOnce(okResponse("{}"));
    const ctx = new RunContext();
    await chat(ctx, { tier: "nano", stage: "t", messages: [{ role: "user", content: "x" }], json: true });
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
    expect("chat_template_kwargs" in bodies[1]).toBe(false);
    expect("response_format" in bodies[2]).toBe(false);
    await chat(ctx, { tier: "nano", stage: "t", messages: [{ role: "user", content: "x" }], json: true });
    expect(fetchMock).toHaveBeenCalledTimes(4); // second call goes straight through with the trimmed params
    expect(Object.keys(JSON.parse(fetchMock.mock.calls[3][1].body))).not.toContain("response_format");
  });

  it("reports errors with the provider name", async () => {
    const { chat, RunContext } = await load({ LLM_BASE_URL: "https://integrate.api.nvidia.com/v1", LLM_API_KEY: "k", MODEL_NANO: "m", LLM_JSON_MODE: "false" });
    fetchMock.mockResolvedValue(new Response("unauthorized", { status: 401 }));
    await expect(chat(new RunContext(), { tier: "nano", stage: "t", messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/^nvidia 401/);
  });
});
