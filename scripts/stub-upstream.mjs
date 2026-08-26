#!/usr/bin/env node
// Fake Agent API for local end-to-end testing (no Perplexity account needed).
import http from "node:http";

const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const parsed = JSON.parse(body);
  console.log("stub received:", JSON.stringify(parsed));

  if (parsed.stream) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    const write = (event, data) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    write("response.started", {});
    write("response.chunk", { delta: "Streamed " });
    write("response.search_results", {
      results: [{ title: "Src", url: "https://src.example" }],
    });
    write("response.chunk", { delta: "answer." });
    write("response.completed", {
      response: { usage: { input_tokens: 5, output_tokens: 2 } },
    });
    res.end();
    return;
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      id: "resp_stub",
      created_at: 1771891464,
      model: "perplexity/sonar",
      object: "response",
      status: "completed",
      output: [
        {
          type: "search_results",
          queries: ["q"],
          results: [{ id: 1, title: "Src", url: "https://src.example", date: "2026-08-01" }],
        },
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "Stub answer." }],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 },
      error: null,
    }),
  );
});

server.listen(9090, () => console.log("stub upstream on :9090"));
