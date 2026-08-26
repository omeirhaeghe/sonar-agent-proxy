import type {
  AgentOutputMessage,
  AgentOutputSearchResults,
  AgentRequest,
  AgentResponse,
  ProxyConfig,
  SonarRequest,
  SonarResponse,
  SonarSearchResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Request: Sonar chat completions -> Agent API
// ---------------------------------------------------------------------------

export function toAgentRequest(
  req: SonarRequest,
  cfg: ProxyConfig,
): { body: AgentRequest; dropped: string[] } {
  const dropped: string[] = [];

  const preset = cfg.modelToPreset[req.model];
  const messages = Array.isArray(req.messages) ? req.messages : [];

  const systemParts = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content);
  const convo = messages.filter((m) => m.role !== "system");

  let input: AgentRequest["input"];
  if (cfg.inputMode === "string") {
    // Flatten: single user turn stays a plain string; multi-turn becomes a transcript.
    if (convo.length === 1 && convo[0].role === "user") {
      input = convo[0].content;
    } else {
      input = convo.map((m) => `${m.role}: ${m.content}`).join("\n\n");
    }
  } else {
    input = convo.map((m) => ({ role: m.role, content: m.content }));
  }

  const body: AgentRequest = { input };
  if (preset) {
    body.preset = preset;
  } else {
    // Unmapped model name: pass through as-is so Agent API model ids
    // (e.g. "perplexity/sonar") keep working through the proxy.
    body.model = req.model;
    body.tools = [{ type: "web_search" }];
  }
  if (systemParts.length > 0) body.instructions = systemParts.join("\n\n");

  if (req.stream === true) body.stream = true;
  if (typeof req.temperature === "number") body.temperature = req.temperature;
  if (typeof req.top_p === "number") body.top_p = req.top_p;
  if (typeof req.presence_penalty === "number")
    body.presence_penalty = req.presence_penalty;
  if (typeof req.frequency_penalty === "number")
    body.frequency_penalty = req.frequency_penalty;
  if (typeof req.max_tokens === "number") body.max_output_tokens = req.max_tokens;

  // Search filters move under the web_search tool.
  const filters: Record<string, unknown> = {};
  if (Array.isArray(req.search_domain_filter) && req.search_domain_filter.length)
    filters.search_domain_filter = req.search_domain_filter;
  if (typeof req.search_recency_filter === "string")
    filters.search_recency_filter = req.search_recency_filter;
  if (Object.keys(filters).length > 0) {
    const web = (body.tools ?? []).find((t) => t.type === "web_search");
    if (web) web.filters = filters;
    else body.tools = [...(body.tools ?? []), { type: "web_search", filters }];
  }

  // Everything else is dropped (Agent API rejects unknown fields with 400).
  const consumed = new Set([
    "model",
    "messages",
    "stream",
    "temperature",
    "top_p",
    "max_tokens",
    "presence_penalty",
    "frequency_penalty",
    "search_domain_filter",
    "search_recency_filter",
  ]);
  for (const key of Object.keys(req)) {
    if (!consumed.has(key)) dropped.push(key);
  }

  return { body, dropped };
}

// ---------------------------------------------------------------------------
// Response: Agent API -> Sonar chat completions
// ---------------------------------------------------------------------------

function collectSearchResults(resp: AgentResponse): SonarSearchResult[] {
  const out: SonarSearchResult[] = [];
  for (const item of resp.output ?? []) {
    if (item.type !== "search_results") continue;
    for (const r of (item as AgentOutputSearchResults).results ?? []) {
      if (!r.url) continue;
      out.push({
        title: r.title ?? "",
        url: r.url,
        date: r.date ?? null,
        last_updated: r.last_updated ?? null,
        ...(r.snippet ? { snippet: r.snippet } : {}),
      });
    }
  }
  return out;
}

function collectText(resp: AgentResponse): string {
  if (typeof resp.output_text === "string" && resp.output_text.length > 0)
    return resp.output_text;
  const parts: string[] = [];
  for (const item of resp.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of (item as AgentOutputMessage).content ?? []) {
      if (typeof c.text === "string") parts.push(c.text);
    }
  }
  return parts.join("");
}

function finishReason(resp: AgentResponse): string {
  if (resp.status === "incomplete") {
    return resp.incomplete_details?.reason === "max_output_tokens"
      ? "length"
      : "stop";
  }
  return "stop";
}

export function toSonarResponse(
  resp: AgentResponse,
  requestedModel: string,
): SonarResponse {
  const searchResults = collectSearchResults(resp);
  const citations = [...new Set(searchResults.map((r) => r.url))];
  return {
    id: resp.id ?? cryptoRandomId(),
    model: requestedModel,
    created: resp.created_at ?? Math.floor(Date.now() / 1000),
    object: "chat.completion",
    citations,
    search_results: searchResults,
    choices: [
      {
        index: 0,
        finish_reason: finishReason(resp),
        message: { role: "assistant", content: collectText(resp) },
      },
    ],
    usage: {
      prompt_tokens: resp.usage?.input_tokens ?? 0,
      completion_tokens: resp.usage?.output_tokens ?? 0,
      total_tokens:
        resp.usage?.total_tokens ??
        (resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0),
    },
  };
}

function cryptoRandomId(): string {
  return "chatcmpl-" + Math.random().toString(36).slice(2, 14);
}

// ---------------------------------------------------------------------------
// Streaming: Agent API typed SSE events -> chat.completion.chunk SSE
// ---------------------------------------------------------------------------

interface SseEvent {
  event: string;
  data: string;
}

/** Incremental SSE parser: feed raw text, get complete events. */
export class SseParser {
  private buffer = "";

  push(text: string): SseEvent[] {
    this.buffer += text;
    const events: SseEvent[] = [];
    let idx: number;
    // Events are separated by a blank line.
    while ((idx = this.buffer.search(/\r?\n\r?\n/)) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx).replace(/^\r?\n\r?\n/, "");
      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length > 0) events.push({ event, data: dataLines.join("\n") });
    }
    return events;
  }
}

function chunkEnvelope(
  id: string,
  model: string,
  extra: Record<string, unknown>,
): string {
  return (
    "data: " +
    JSON.stringify({
      id,
      model,
      created: Math.floor(Date.now() / 1000),
      object: "chat.completion.chunk",
      ...extra,
    }) +
    "\n\n"
  );
}

/** Pull a text delta out of a response.chunk payload, tolerating shape drift. */
export function extractDelta(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (payload === null || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  for (const key of ["delta", "text", "output_text", "content"]) {
    const v = p[key];
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      const nested = extractDelta(v);
      if (nested) return nested;
    }
  }
  return "";
}

/**
 * Transforms the Agent API SSE stream into a Sonar-style chat.completion.chunk
 * stream, ending with `data: [DONE]`. Terminal events (completed / failed /
 * incomplete / cancelled) all close the stream — a consumer must never hang.
 */
export function agentStreamToSonarStream(
  requestedModel: string,
): TransformStream<Uint8Array, Uint8Array> {
  const parser = new SseParser();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const id = cryptoRandomId();
  let sentRole = false;
  let done = false;
  const searchResults: SonarSearchResult[] = [];

  const emit = (
    controller: TransformStreamDefaultController<Uint8Array>,
    extra: Record<string, unknown>,
  ) => controller.enqueue(encoder.encode(chunkEnvelope(id, requestedModel, extra)));

  const finish = (
    controller: TransformStreamDefaultController<Uint8Array>,
    finish_reason: string,
    usage?: Record<string, unknown>,
  ) => {
    if (done) return;
    done = true;
    const citations = [...new Set(searchResults.map((r) => r.url))];
    emit(controller, {
      choices: [{ index: 0, delta: {}, finish_reason }],
      citations,
      search_results: searchResults,
      ...(usage ? { usage } : {}),
    });
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      for (const evt of parser.push(decoder.decode(chunk, { stream: true }))) {
        if (done) return;
        let payload: unknown = null;
        try {
          payload = JSON.parse(evt.data);
        } catch {
          // non-JSON data line; ignore
        }
        const p = (payload ?? {}) as Record<string, unknown>;

        switch (evt.event) {
          case "response.chunk": {
            const text = extractDelta(payload);
            if (text) {
              const delta: Record<string, unknown> = { content: text };
              if (!sentRole) {
                delta.role = "assistant";
                sentRole = true;
              }
              emit(controller, {
                choices: [{ index: 0, delta, finish_reason: null }],
              });
            }
            break;
          }
          case "response.search_results": {
            const results = (p.results ?? p.search_results) as
              | Array<Record<string, unknown>>
              | undefined;
            for (const r of results ?? []) {
              if (typeof r.url === "string") {
                searchResults.push({
                  title: typeof r.title === "string" ? r.title : "",
                  url: r.url,
                  date: (r.date as string | null | undefined) ?? null,
                });
              }
            }
            break;
          }
          case "response.completed": {
            const usage = (p.response as Record<string, unknown> | undefined)
              ?.usage ?? p.usage;
            finish(
              controller,
              "stop",
              usage ? normalizeUsage(usage as Record<string, unknown>) : undefined,
            );
            break;
          }
          case "response.incomplete": {
            const reason =
              ((p.response as Record<string, unknown> | undefined)
                ?.incomplete_details as Record<string, unknown> | undefined)
                ?.reason ?? (p.incomplete_details as Record<string, unknown> | undefined)?.reason;
            finish(controller, reason === "max_output_tokens" ? "length" : "stop");
            break;
          }
          case "response.failed":
          case "response.cancelled": {
            finish(controller, "stop");
            break;
          }
          default:
            // response.started, tool events, unknown events: nothing to forward.
            break;
        }
      }
    },
    flush(controller) {
      // Upstream closed without a terminal event: still terminate cleanly.
      finish(controller, "stop");
    },
  });
}

function normalizeUsage(u: Record<string, unknown>): Record<string, unknown> {
  return {
    prompt_tokens: (u.input_tokens as number) ?? 0,
    completion_tokens: (u.output_tokens as number) ?? 0,
    total_tokens:
      (u.total_tokens as number) ??
      ((u.input_tokens as number) ?? 0) + ((u.output_tokens as number) ?? 0),
  };
}
