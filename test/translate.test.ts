import { describe, expect, it } from "vitest";
import {
  SseParser,
  agentStreamToSonarStream,
  extractDelta,
  toAgentRequest,
  toSonarResponse,
} from "../src/translate.js";
import {
  DEFAULT_MODEL_TO_PRESET,
  type AgentResponse,
  type ProxyConfig,
  type SonarRequest,
} from "../src/types.js";

const cfg: ProxyConfig = {
  modelToPreset: DEFAULT_MODEL_TO_PRESET,
  inputMode: "array",
};

describe("toAgentRequest", () => {
  it("maps sonar-pro to the low preset and messages to input", () => {
    const req: SonarRequest = {
      model: "sonar-pro",
      messages: [
        { role: "system", content: "Be terse." },
        { role: "user", content: "Latest AI news?" },
      ],
      max_tokens: 500,
      temperature: 0.2,
    };
    const { body, dropped } = toAgentRequest(req, cfg);
    expect(body.preset).toBe("low");
    expect(body.model).toBeUndefined();
    expect(body.instructions).toBe("Be terse.");
    expect(body.input).toEqual([{ role: "user", content: "Latest AI news?" }]);
    expect(body.max_output_tokens).toBe(500);
    expect(body.temperature).toBe(0.2);
    expect(dropped).toEqual([]);
  });

  it("flattens to a string in string input mode", () => {
    const { body } = toAgentRequest(
      {
        model: "sonar-pro",
        messages: [{ role: "user", content: "hello" }],
      },
      { ...cfg, inputMode: "string" },
    );
    expect(body.input).toBe("hello");
  });

  it("moves search filters under the web_search tool", () => {
    const { body } = toAgentRequest(
      {
        model: "sonar-pro",
        messages: [{ role: "user", content: "q" }],
        search_domain_filter: ["example.com"],
        search_recency_filter: "week",
      },
      cfg,
    );
    const web = body.tools?.find((t) => t.type === "web_search");
    expect(web?.filters).toEqual({
      search_domain_filter: ["example.com"],
      search_recency_filter: "week",
    });
  });

  it("drops sonar-only fields the Agent API would reject", () => {
    const { body, dropped } = toAgentRequest(
      {
        model: "sonar-pro",
        messages: [{ role: "user", content: "q" }],
        return_related_questions: true,
        return_citations: true,
        web_search_options: { search_context_size: "high" },
      },
      cfg,
    );
    expect(dropped.sort()).toEqual([
      "return_citations",
      "return_related_questions",
      "web_search_options",
    ]);
    expect(JSON.stringify(body)).not.toContain("return_related_questions");
  });

  it("passes unmapped model names through with an explicit web_search tool", () => {
    const { body } = toAgentRequest(
      { model: "perplexity/sonar", messages: [{ role: "user", content: "q" }] },
      cfg,
    );
    expect(body.model).toBe("perplexity/sonar");
    expect(body.preset).toBeUndefined();
    expect(body.tools).toEqual([{ type: "web_search" }]);
  });
});

const agentResponse: AgentResponse = {
  id: "resp_123",
  created_at: 1771891464,
  model: "perplexity/sonar",
  object: "response",
  status: "completed",
  output: [
    {
      type: "search_results",
      queries: ["ai news"],
      results: [
        { id: 1, title: "A", url: "https://a.com/x", snippet: "s", date: "2026-08-01" },
        { id: 2, title: "B", url: "https://b.com/y", date: null },
        { id: 3, title: "A again", url: "https://a.com/x" },
      ],
    },
    {
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "Here is the answer." }],
    },
  ],
  usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
  error: null,
};

describe("toSonarResponse", () => {
  it("rebuilds the chat.completion shape with citations and search_results", () => {
    const out = toSonarResponse(agentResponse, "sonar-pro");
    expect(out.object).toBe("chat.completion");
    expect(out.model).toBe("sonar-pro");
    expect(out.choices[0].message.content).toBe("Here is the answer.");
    expect(out.choices[0].finish_reason).toBe("stop");
    expect(out.citations).toEqual(["https://a.com/x", "https://b.com/y"]);
    expect(out.search_results).toHaveLength(3);
    expect(out.search_results[0]).toMatchObject({
      title: "A",
      url: "https://a.com/x",
      date: "2026-08-01",
    });
    expect(out.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    });
  });

  it("maps truncation to finish_reason length", () => {
    const out = toSonarResponse(
      {
        ...agentResponse,
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      },
      "sonar-pro",
    );
    expect(out.choices[0].finish_reason).toBe("length");
  });
});

describe("SseParser", () => {
  it("parses events split across chunks", () => {
    const p = new SseParser();
    expect(p.push("event: response.chunk\ndata: {\"del")).toEqual([]);
    const events = p.push('ta\":\"hi\"}\n\n');
    expect(events).toEqual([
      { event: "response.chunk", data: '{"delta":"hi"}' },
    ]);
  });
});

describe("extractDelta", () => {
  it("finds text under several plausible shapes", () => {
    expect(extractDelta({ delta: "a" })).toBe("a");
    expect(extractDelta({ text: "b" })).toBe("b");
    expect(extractDelta({ delta: { text: "c" } })).toBe("c");
    expect(extractDelta({ nope: 1 })).toBe("");
  });
});

async function runStream(events: string): Promise<string[]> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(events));
      controller.close();
    },
  }).pipeThrough(agentStreamToSonarStream("sonar-pro"));
  const chunks: string[] = [];
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value));
  }
  return chunks;
}

describe("agentStreamToSonarStream", () => {
  it("translates chunks and terminates with [DONE] carrying citations", async () => {
    const out = await runStream(
      [
        'event: response.started\ndata: {}\n\n',
        'event: response.chunk\ndata: {"delta":"Hello "}\n\n',
        'event: response.search_results\ndata: {"results":[{"title":"A","url":"https://a.com"}]}\n\n',
        'event: response.chunk\ndata: {"delta":"world"}\n\n',
        'event: response.completed\ndata: {"response":{"usage":{"input_tokens":10,"output_tokens":2}}}\n\n',
      ].join(""),
    );
    const joined = out.join("");
    expect(joined).toContain('"content":"Hello "');
    expect(joined).toContain('"content":"world"');
    expect(joined).toContain('"role":"assistant"');
    expect(joined).toContain('"citations":["https://a.com"]');
    expect(joined).toContain('"finish_reason":"stop"');
    expect(joined.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("terminates on response.failed instead of hanging", async () => {
    const out = await runStream(
      'event: response.failed\ndata: {"error":{"message":"boom"}}\n\n',
    );
    expect(out.join("")).toContain("data: [DONE]");
  });

  it("terminates when upstream closes without a terminal event", async () => {
    const out = await runStream(
      'event: response.chunk\ndata: {"delta":"partial"}\n\n',
    );
    const joined = out.join("");
    expect(joined).toContain("partial");
    expect(joined).toContain("data: [DONE]");
  });
});
