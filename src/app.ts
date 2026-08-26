import { Hono } from "hono";
import type { Context } from "hono";
import {
  agentStreamToSonarStream,
  toAgentRequest,
  toSonarResponse,
} from "./translate.js";
import { DEMO_PAGE } from "./ui.js";
import {
  DEFAULT_MODEL_TO_PRESET,
  type AgentResponse,
  type ProxyConfig,
  type SonarRequest,
} from "./types.js";

type Env = {
  Bindings: {
    UPSTREAM_URL?: string;
    PPLX_API_KEY?: string;
    MODEL_TO_PRESET?: string; // JSON object, overrides the default mapping
    INPUT_MODE?: string; // "array" (default) | "string"
  };
};

function env(c: Context<Env>, name: keyof Env["Bindings"]): string | undefined {
  const fromBinding = c.env?.[name];
  if (typeof fromBinding === "string" && fromBinding) return fromBinding;
  // Node fallback
  const g = globalThis as { process?: { env?: Record<string, string> } };
  return g.process?.env?.[name];
}

function config(c: Context<Env>): ProxyConfig {
  let modelToPreset = DEFAULT_MODEL_TO_PRESET;
  const override = env(c, "MODEL_TO_PRESET");
  if (override) {
    try {
      modelToPreset = { ...DEFAULT_MODEL_TO_PRESET, ...JSON.parse(override) };
    } catch {
      console.error("MODEL_TO_PRESET is not valid JSON; using defaults");
    }
  }
  return {
    modelToPreset,
    inputMode: env(c, "INPUT_MODE") === "string" ? "string" : "array",
  };
}

function errorBody(message: string, type = "proxy_error") {
  return { error: { message, type } };
}

export const app = new Hono<Env>();

app.get("/health", (c) => c.json({ ok: true }));

async function handleChatCompletions(c: Context<Env>) {
  // Auth: pass the caller's bearer token through; fall back to PPLX_API_KEY.
  const auth = c.req.header("authorization") ?? undefined;
  const key = env(c, "PPLX_API_KEY");
  const upstreamAuth = auth ?? (key ? `Bearer ${key}` : undefined);
  if (!upstreamAuth) {
    return c.json(errorBody("Missing Authorization header and no PPLX_API_KEY configured", "auth_error"), 401);
  }

  let sonarReq: SonarRequest;
  try {
    sonarReq = await c.req.json<SonarRequest>();
  } catch {
    return c.json(errorBody("Request body is not valid JSON", "invalid_request"), 400);
  }
  if (!sonarReq?.model || !Array.isArray(sonarReq.messages)) {
    return c.json(errorBody("Request must include 'model' and 'messages'", "invalid_request"), 400);
  }

  const { body, dropped } = toAgentRequest(sonarReq, config(c));
  if (dropped.length > 0) {
    console.log(`dropped unsupported sonar fields: ${dropped.join(", ")}`);
  }

  const upstreamUrl = env(c, "UPSTREAM_URL") ?? "https://api.perplexity.ai/v1/agent";
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: body.stream ? "text/event-stream" : "application/json",
        authorization: upstreamAuth,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return c.json(errorBody(`Upstream request failed: ${String(e)}`, "upstream_error"), 502);
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    console.error(`upstream ${upstream.status}: ${detail.slice(0, 2000)}`);
    return c.json(
      errorBody(`Agent API returned ${upstream.status}: ${detail.slice(0, 500)}`, "upstream_error"),
      upstream.status === 429 ? 429 : 502,
    );
  }

  if (body.stream) {
    if (!upstream.body) {
      return c.json(errorBody("Upstream returned no stream body", "upstream_error"), 502);
    }
    const transformed = upstream.body.pipeThrough(
      agentStreamToSonarStream(sonarReq.model),
    );
    return new Response(transformed, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }

  let agentResp: AgentResponse;
  try {
    agentResp = (await upstream.json()) as AgentResponse;
  } catch {
    return c.json(errorBody("Upstream returned non-JSON body", "upstream_error"), 502);
  }

  // The Agent API can return HTTP 200 with a failed run; surface it as an error.
  if (agentResp.status === "failed" || agentResp.status === "cancelled") {
    const msg = agentResp.error?.message ?? `Agent run ${agentResp.status}`;
    console.error(`agent run ${agentResp.status}: ${msg}`);
    return c.json(errorBody(msg, "upstream_error"), 502);
  }

  return c.json(toSonarResponse(agentResp, sonarReq.model));
}

// Both paths, matching api.perplexity.ai and OpenAI-style clients.
app.post("/chat/completions", handleChatCompletions);
app.post("/v1/chat/completions", handleChatCompletions);

// ---------------------------------------------------------------------------
// Demo UI: a prompt box that shows one request crossing every stage of the
// proxy. GET / serves the page; POST /inspect runs one real round-trip and
// returns all four stages so the page can render the flow.
// ---------------------------------------------------------------------------

interface InspectBody {
  prompt?: string;
  system?: string;
  model?: string;
  max_tokens?: number;
  // Routing override: an Agent API preset name (fast/low/medium/high/xhigh)
  // or a model id like "perplexity/sonar".
  target?: string;
}

const AGENT_PRESETS = new Set(["fast", "low", "medium", "high", "xhigh"]);

app.post("/inspect", async (c) => {
  const auth = c.req.header("authorization") ?? undefined;
  const key = env(c, "PPLX_API_KEY");
  const upstreamAuth = auth ?? (key ? `Bearer ${key}` : undefined);

  let req: InspectBody;
  try {
    req = await c.req.json<InspectBody>();
  } catch {
    return c.json(errorBody("Request body is not valid JSON", "invalid_request"), 400);
  }
  if (!req.prompt?.trim()) {
    return c.json(errorBody("'prompt' is required", "invalid_request"), 400);
  }

  const sonarRequest: SonarRequest = {
    model: req.model || "sonar-pro",
    messages: [
      ...(req.system?.trim()
        ? [{ role: "system" as const, content: req.system.trim() }]
        : []),
      { role: "user" as const, content: req.prompt.trim() },
    ],
    max_tokens:
      typeof req.max_tokens === "number" && req.max_tokens > 0
        ? Math.min(Math.floor(req.max_tokens), 8192)
        : 4096,
  };

  const { body: agentRequest, dropped } = toAgentRequest(sonarRequest, config(c));

  // Apply the demo's routing override after translation, so the displayed
  // agent_request is exactly what goes upstream.
  const target = req.target?.trim();
  if (target) {
    if (AGENT_PRESETS.has(target)) {
      delete agentRequest.model;
      agentRequest.preset = target;
    } else {
      delete agentRequest.preset;
      agentRequest.model = target;
      if (!agentRequest.tools?.some((t) => t.type === "web_search")) {
        agentRequest.tools = [...(agentRequest.tools ?? []), { type: "web_search" }];
      }
    }
  }

  if (!upstreamAuth) {
    return c.json({
      sonar_request: sonarRequest,
      agent_request: agentRequest,
      dropped_fields: dropped,
      error: "No API key: paste your Perplexity key in the page, or set PPLX_API_KEY on the server.",
    });
  }

  const upstreamUrl = env(c, "UPSTREAM_URL") ?? "https://api.perplexity.ai/v1/agent";
  const t0 = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: upstreamAuth,
      },
      body: JSON.stringify(agentRequest),
    });
  } catch (e) {
    return c.json({
      sonar_request: sonarRequest,
      agent_request: agentRequest,
      dropped_fields: dropped,
      error: `Upstream request failed: ${String(e)}`,
    });
  }
  const latency = Date.now() - t0;

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return c.json({
      sonar_request: sonarRequest,
      agent_request: agentRequest,
      dropped_fields: dropped,
      upstream_status: upstream.status,
      latency_ms: latency,
      error: `Agent API returned ${upstream.status}: ${detail.slice(0, 1000)}`,
    });
  }

  let agentResponse: AgentResponse;
  try {
    agentResponse = (await upstream.json()) as AgentResponse;
  } catch {
    return c.json({
      sonar_request: sonarRequest,
      agent_request: agentRequest,
      dropped_fields: dropped,
      upstream_status: upstream.status,
      latency_ms: latency,
      error: "Upstream returned non-JSON body",
    });
  }

  const failed =
    agentResponse.status === "failed" || agentResponse.status === "cancelled";
  return c.json({
    sonar_request: sonarRequest,
    agent_request: agentRequest,
    dropped_fields: dropped,
    upstream_status: upstream.status,
    latency_ms: latency,
    agent_response: agentResponse,
    ...(failed
      ? { error: agentResponse.error?.message ?? `Agent run ${agentResponse.status}` }
      : { sonar_response: toSonarResponse(agentResponse, sonarRequest.model) }),
  });
});

app.get("/", (c) => c.html(DEMO_PAGE));
