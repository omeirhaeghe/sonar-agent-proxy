#!/usr/bin/env node
// Smoke test: send a Sonar-shaped request to the proxy and print the reply.
//
//   PPLX_API_KEY=pplx-... node scripts/smoke.mjs [proxy-url] [--stream]
//
// Defaults to http://localhost:8080. To A/B against the real Sonar API while
// it is still live, run it twice:
//   node scripts/smoke.mjs https://api.perplexity.ai
//   node scripts/smoke.mjs http://localhost:8080

const base = process.argv[2] ?? "http://localhost:8080";
const stream = process.argv.includes("--stream");
const key = process.env.PPLX_API_KEY;
if (!key) {
  console.error("Set PPLX_API_KEY");
  process.exit(1);
}

const body = {
  model: "sonar-pro",
  stream,
  messages: [
    { role: "system", content: "Answer in one short paragraph." },
    { role: "user", content: "What happened in AI this week?" },
  ],
  max_tokens: 300,
};

const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${key}`,
  },
  body: JSON.stringify(body),
});

console.log(`HTTP ${res.status}`);
if (!stream) {
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
  const shapeOk =
    json.object === "chat.completion" &&
    typeof json.choices?.[0]?.message?.content === "string" &&
    Array.isArray(json.citations) &&
    Array.isArray(json.search_results) &&
    typeof json.usage?.total_tokens === "number";
  console.log(shapeOk ? "\nSHAPE OK" : "\nSHAPE MISMATCH");
  process.exit(shapeOk ? 0 : 1);
}

const decoder = new TextDecoder();
for await (const chunk of res.body) {
  process.stdout.write(decoder.decode(chunk, { stream: true }));
}
