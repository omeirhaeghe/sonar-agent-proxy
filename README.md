# sonar-agent-proxy

A small cloud proxy for migrating off Perplexity's Sonar API without touching
your app. It exposes the **Sonar chat-completions contract** your app already
calls (`POST /chat/completions`), and translates each call to the new
**Agent API** (`POST https://api.perplexity.ai/v1/agent`) behind the scenes.

Sonar endpoints retire on **September 27, 2026**. Point your backend's
Perplexity base URL at this proxy before then and nothing else changes.

```
your app ──► your backend route ──► sonar-agent-proxy ──► Agent API
             (unchanged: sends            (translates
              sonar-pro chat              request/response
              completions)                both ways)
```

## What it translates

Request (Sonar → Agent API):

| Sonar field | Agent API field |
|---|---|
| `model: "sonar-pro"` | `preset: "low"` (sonar→fast, sonar-reasoning-pro→medium, sonar-deep-research→high; override with `MODEL_TO_PRESET`) |
| `messages` (system) | `instructions` |
| `messages` (user/assistant) | `input` |
| `max_tokens` | `max_output_tokens` |
| `temperature`, `top_p`, `presence_penalty`, `frequency_penalty` | same names |
| `search_domain_filter`, `search_recency_filter` | `tools: [{type: "web_search", filters: {...}}]` |
| anything else (`return_related_questions`, `return_citations`, ...) | **dropped** — the Agent API rejects unknown fields with HTTP 400; drops are logged |

Response (Agent API → Sonar): the `output` array's `message` item becomes
`choices[0].message.content`, `search_results` items become the top-level
`citations` (deduped URLs) and `search_results` arrays, `usage` token counts
map back, and `status: "incomplete"` with `max_output_tokens` becomes
`finish_reason: "length"`. A run that comes back HTTP 200 but
`status: "failed"` is surfaced as an HTTP 502 error, not a fake success.

Streaming: the Agent API's typed SSE events (`response.chunk`,
`response.search_results`, `response.completed/failed/incomplete/cancelled`)
are re-emitted as `chat.completion.chunk` SSE ending in `data: [DONE]`. Every
terminal event — and even an upstream hang-up — closes the stream, so your
client never hangs.

Auth: the proxy **passes your app's `Authorization: Bearer` header through**
to Perplexity — it stores no secrets. Optionally set `PPLX_API_KEY` on the
proxy and it fills in the auth when the caller sends none.

## Configuration (env vars, all optional)

- `UPSTREAM_URL` — default `https://api.perplexity.ai/v1/agent`
- `PPLX_API_KEY` — fallback key when the caller sends no Authorization header
- `MODEL_TO_PRESET` — JSON merged over the default mapping, e.g. `{"sonar-pro":"medium"}`
- `INPUT_MODE` — `array` (default: messages become Responses-style input items)
  or `string` (conversation flattened to one prompt)

## Run locally

```bash
npm install
npm run dev                       # listens on :8080
PPLX_API_KEY=pplx-... npm run smoke              # non-streaming shape check
PPLX_API_KEY=pplx-... node scripts/smoke.mjs http://localhost:8080 --stream
```

No Perplexity key handy? `node scripts/stub-upstream.mjs` starts a fake Agent
API on :9090; run the proxy with `UPSTREAM_URL=http://localhost:9090`.

## Deploy

**Option A — Cloudflare Workers** (fastest; free tier is fine for a proxy):

```bash
npx wrangler login
npm run deploy:workers
# optional: npx wrangler secret put PPLX_API_KEY
```

**Option B — any container platform** (Cloud Run, Fly.io, Railway, ...):

```bash
# Cloud Run
gcloud run deploy sonar-agent-proxy --source . --region us-central1 --allow-unauthenticated
# or Fly.io
fly launch
```

The Dockerfile serves on `$PORT` (default 8080).

**Option C — Azure (Container Apps)**:

```bash
az login
az extension add --name containerapp --upgrade

# Builds the Dockerfile in Azure and deploys in one command — creates the
# resource group, container registry, and Container Apps environment for you.
az containerapp up \
  --name sonar-agent-proxy \
  --resource-group sonar-agent-proxy-rg \
  --location eastus \
  --source . \
  --ingress external \
  --target-port 8080
```

The command prints the app URL (`https://sonar-agent-proxy.<...>.azurecontainerapps.io`)
— that's your proxy base URL. Verify with `curl https://<url>/health`.

Optional env vars / secrets:

```bash
az containerapp secret set -n sonar-agent-proxy -g sonar-agent-proxy-rg \
  --secrets pplx-api-key=pplx-...
az containerapp update -n sonar-agent-proxy -g sonar-agent-proxy-rg \
  --set-env-vars PPLX_API_KEY=secretref:pplx-api-key INPUT_MODE=array
```

Notes for this workload:
- Container Apps supports SSE, so streaming works; the default HTTP idle
  timeout (240s) is far above any Agent API response time.
- Scale-to-zero is the default. First request after idle takes a few seconds
  of cold start; to avoid it, pin a warm instance:
  `az containerapp update -n sonar-agent-proxy -g sonar-agent-proxy-rg --min-replicas 1`
- Prefer App Service instead? The same Dockerfile works:
  `az webapp up --runtime NODE:22-lts` also runs it, but Container Apps is
  the better fit for a stateless streaming proxy.

## Cutover plan

1. Deploy the proxy; hit `GET /health`.
2. Shape check while Sonar is still live (before Sep 27) — run the same
   request against both and diff:
   ```bash
   PPLX_API_KEY=... node scripts/smoke.mjs https://api.perplexity.ai
   PPLX_API_KEY=... node scripts/smoke.mjs https://<your-proxy>
   ```
3. In your backend route, change the Perplexity base URL from
   `https://api.perplexity.ai` to your proxy URL. Path, body, headers, and
   response handling stay identical.
4. Watch proxy logs for `dropped unsupported sonar fields: ...` — those are
   Sonar features your app sends that have no Agent API equivalent.

## Things to verify against the live API

The Agent API is new and its docs are still settling; three mappings are
best-effort and worth one live smoke test each:

1. **`input` as a message array** — if the live API rejects the array form,
   set `INPUT_MODE=string`.
2. **Filter field names** under `tools[web_search].filters` — the proxy sends
   Sonar's names (`search_domain_filter`, `search_recency_filter`); a 400
   naming that field means Perplexity renamed it (check
   [the migration guide](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar)).
   Only matters if your app uses those filters.
3. **Streaming chunk payload shape** — `extractDelta()` in
   `src/translate.ts` tolerates several shapes (`delta`, `text`,
   `output_text`, nested), but run one `--stream` smoke test to confirm.
   Only matters if your app streams.

`npm test` covers the translation logic (12 tests).
