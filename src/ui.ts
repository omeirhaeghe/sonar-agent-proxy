// Demo page served at GET /. Self-contained except Google Fonts; client JS
// avoids template literals so this file can hold it in one.
export const DEMO_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>sonar-agent-proxy — trace</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Space+Grotesk:wght@500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --ink: #0e141b;
    --panel: #151d26;
    --panel-edge: #24303c;
    --text: #d9e2ea;
    --muted: #7f8fa0;
    --sonar: #e2a84b;      /* legacy protocol: amber */
    --sonar-dim: #4a3a1e;
    --agent: #35b8c6;      /* Agent API: Perplexity turquoise */
    --agent-dim: #14424a;
    --err: #e0685f;
    --ok: #6fbf8f;
    --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    --disp: "Space Grotesk", system-ui, sans-serif;
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    background: var(--ink);
    color: var(--text);
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.55;
    padding: 0 20px 80px;
  }
  .wrap { max-width: 860px; margin: 0 auto; }

  header {
    display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap;
    padding: 26px 0 6px;
  }
  header h1 { font-family: var(--disp); font-size: 21px; font-weight: 600; letter-spacing: -0.01em; }
  header .legend { margin-left: auto; display: flex; gap: 16px; color: var(--muted); font-size: 12px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: 1px; }
  .dot.s { background: var(--sonar); } .dot.a { background: var(--agent); }
  header + p { color: var(--muted); font-size: 12.5px; max-width: 62ch; }

  form {
    margin: 26px 0 8px;
    background: var(--panel);
    border: 1px solid var(--panel-edge);
    border-radius: 10px;
    padding: 16px;
    display: grid; gap: 10px;
  }
  label { color: var(--muted); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
  textarea, select, input[type=password], input[type=text], input[type=number] {
    width: 100%;
    background: var(--ink);
    color: var(--text);
    border: 1px solid var(--panel-edge);
    border-radius: 6px;
    font: inherit;
    padding: 10px 12px;
  }
  select { appearance: auto; }
  textarea { resize: vertical; min-height: 64px; }
  textarea:focus, select:focus, input:focus, button:focus-visible { outline: 2px solid var(--agent); outline-offset: 1px; }
  .row { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; }
  .row > div { flex: 1 1 220px; }
  .row > div.narrow { flex: 0 1 130px; min-width: 110px; }
  button {
    font-family: var(--disp); font-weight: 600; font-size: 14px;
    background: var(--agent); color: #06272b;
    border: 0; border-radius: 6px; padding: 10px 22px; cursor: pointer;
  }
  button:disabled { opacity: 0.55; cursor: wait; }
  .hint { color: var(--muted); font-size: 11.5px; }
  .hint a { color: var(--agent); }

  #status { min-height: 22px; color: var(--muted); font-size: 12px; padding: 4px 2px; }
  #status.err { color: var(--err); }

  /* Answer card */
  #answer {
    display: none;
    background: var(--panel);
    border: 1px solid var(--panel-edge);
    border-left: 3px solid var(--sonar);
    border-radius: 10px;
    padding: 16px 18px;
    margin: 18px 0;
    font-size: 13.5px;
  }
  #answer .body.plain { white-space: pre-wrap; }
  #answer .body.md { font-family: var(--disp); font-size: 14px; line-height: 1.6; }
  #answer .body.md h1, #answer .body.md h2, #answer .body.md h3, #answer .body.md h4 {
    font-family: var(--disp); font-weight: 600; margin: 14px 0 6px; line-height: 1.3;
  }
  #answer .body.md h1 { font-size: 17px; } #answer .body.md h2 { font-size: 15.5px; }
  #answer .body.md h3, #answer .body.md h4 { font-size: 14px; }
  #answer .body.md > :first-child { margin-top: 0; }
  #answer .body.md p { margin: 8px 0; }
  #answer .body.md ul, #answer .body.md ol { margin: 8px 0; padding-left: 22px; }
  #answer .body.md li { margin: 3px 0; }
  #answer .body.md a { color: var(--agent); }
  #answer .body.md strong { color: #fff; font-weight: 600; }
  #answer .body.md code {
    font-family: var(--mono); font-size: 12px;
    background: var(--ink); border: 1px solid var(--panel-edge);
    border-radius: 4px; padding: 1px 5px;
  }
  #answer .body.md pre { margin: 8px 0; max-height: 260px; }
  #answer .body.md pre code { border: 0; background: none; padding: 0; }
  #answer .body.md blockquote {
    border-left: 3px solid var(--panel-edge); margin: 8px 0; padding: 2px 12px;
    color: var(--muted);
  }
  #answer .body.md table { border-collapse: collapse; margin: 10px 0; display: block; overflow-x: auto; }
  #answer .body.md th, #answer .body.md td {
    border: 1px solid var(--panel-edge); padding: 5px 10px; text-align: left; font-size: 13px;
  }
  #answer .body.md th { color: var(--muted); font-weight: 500; }
  #answer .cites { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; }
  #answer .cites a {
    color: var(--agent); text-decoration: none; font-size: 11.5px;
    border: 1px solid var(--agent-dim); border-radius: 999px; padding: 2px 10px;
    max-width: 34ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  #answer .stats {
    margin-top: 12px; padding-top: 10px;
    border-top: 1px solid var(--panel-edge);
    color: var(--muted); font-size: 11.5px; white-space: normal;
  }
  #answer .stats b { color: var(--text); font-weight: 500; }

  /* The trace rail */
  #trace { display: none; margin-top: 10px; }
  .stage { position: relative; padding: 0 0 18px 30px; }
  .stage::before {                     /* rail */
    content: ""; position: absolute; left: 8px; top: 20px; bottom: -2px;
    width: 2px; background: var(--panel-edge);
  }
  .stage:last-child::before { display: none; }
  .stage::after {                      /* node */
    content: ""; position: absolute; left: 3px; top: 8px;
    width: 12px; height: 12px; border-radius: 50%;
    background: var(--ink); border: 3px solid var(--muted);
  }
  .stage.s::after { border-color: var(--sonar); }
  .stage.a::after { border-color: var(--agent); }
  .stage.pending::after { border-color: var(--panel-edge); }
  @keyframes pulse { 0%,100% { opacity: 0.35; } 50% { opacity: 1; } }
  .inflight .stage.pending::after { animation: pulse 1.1s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { .inflight .stage.pending::after { animation: none; } }

  .stage h2 {
    font-family: var(--disp); font-size: 13.5px; font-weight: 600;
    display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
    padding-top: 2px;
  }
  .stage.s h2 .proto { color: var(--sonar); }
  .stage.a h2 .proto { color: var(--agent); }
  .proto { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.08em;
    border: 1px solid currentColor; border-radius: 4px; padding: 1px 6px; }
  .stage h2 .meta { color: var(--muted); font-weight: 400; font-family: var(--mono); font-size: 11.5px; }
  .stage .desc { color: var(--muted); font-size: 12px; margin: 2px 0 8px; }
  .warn { color: var(--sonar); }
  pre {
    background: var(--panel);
    border: 1px solid var(--panel-edge);
    border-radius: 8px;
    padding: 12px 14px;
    overflow-x: auto;
    font-size: 12px;
    max-height: 340px;
    overflow-y: auto;
  }
  .stage.s pre { border-left: 3px solid var(--sonar-dim); }
  .stage.a pre { border-left: 3px solid var(--agent-dim); }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>sonar-agent-proxy</h1>
    <div class="legend">
      <span><span class="dot s"></span>Sonar shape (your app)</span>
      <span><span class="dot a"></span>Agent API shape (Perplexity)</span>
    </div>
  </header>
  <p>Send one prompt and watch it cross the proxy: your app keeps speaking the
  retired Sonar contract; Perplexity hears the new Agent API.</p>

  <form id="f">
    <div>
      <label for="prompt">Prompt</label>
      <textarea id="prompt" required placeholder="What happened in AI this week?"></textarea>
    </div>
    <div class="row">
      <div>
        <label for="system">System message (optional)</label>
        <input type="text" id="system" placeholder="Answer in detail.">
      </div>
      <div class="narrow">
        <label for="maxtok">Max tokens</label>
        <input type="number" id="maxtok" min="16" max="8192" step="1" value="4096">
      </div>
      <div>
        <label for="key">Perplexity API key</label>
        <input type="password" id="key" placeholder="pplx-... (kept in this browser only)">
      </div>
      <button id="go" type="submit">Send through proxy</button>
    </div>
    <div class="row">
      <div>
        <label for="route">Route to (Agent API preset or model)</label>
        <select id="route">
          <optgroup label="Presets (effort tiers)">
            <option value="">low — default sonar-pro mapping</option>
            <option value="fast">fast — old sonar tier</option>
            <option value="medium">medium — old sonar-reasoning-pro tier, fuller answers</option>
            <option value="high">high — old sonar-deep-research tier</option>
            <option value="xhigh">xhigh — deepest research</option>
          </optgroup>
          <optgroup label="Direct models">
            <option value="perplexity/sonar">perplexity/sonar + web_search</option>
            <option value="custom">custom model id…</option>
          </optgroup>
        </select>
      </div>
      <div id="customwrap" style="display:none">
        <label for="custommodel">Custom model id</label>
        <input type="text" id="custommodel" placeholder="e.g. anthropic/claude-... (see Perplexity docs)">
      </div>
    </div>
    <div class="hint">The key goes straight from this page to the proxy to
    Perplexity and is stored only in your browser. Leave it empty if the server
    has PPLX_API_KEY set.</div>
  </form>

  <div id="status" role="status"></div>
  <div id="answer"></div>

  <div id="trace">
    <div class="stage s" id="st1">
      <h2><span class="proto">SONAR</span> Request from your app <span class="meta" id="m1"></span></h2>
      <div class="desc">POST /chat/completions — unchanged legacy contract</div>
      <pre id="j1"></pre>
    </div>
    <div class="stage a" id="st2">
      <h2><span class="proto">AGENT</span> Translated request <span class="meta" id="m2"></span></h2>
      <div class="desc" id="d2">POST https://api.perplexity.ai/v1/agent — model becomes a preset, messages become input/instructions</div>
      <pre id="j2"></pre>
    </div>
    <div class="stage a" id="st3">
      <h2><span class="proto">AGENT</span> Upstream response <span class="meta" id="m3"></span></h2>
      <div class="desc">Typed output array: search_results steps + a message step</div>
      <pre id="j3"></pre>
    </div>
    <div class="stage s" id="st4">
      <h2><span class="proto">SONAR</span> Response to your app <span class="meta" id="m4"></span></h2>
      <div class="desc">chat.completion with choices, citations, search_results, usage — exactly what your app already parses</div>
      <pre id="j4"></pre>
    </div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/marked@15/marked.min.js" defer></script>
<script src="https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js" defer></script>
<script>
(function () {
  var f = document.getElementById("f");
  var go = document.getElementById("go");
  var status = document.getElementById("status");
  var trace = document.getElementById("trace");
  var answer = document.getElementById("answer");
  var keyInput = document.getElementById("key");

  var routeSel = document.getElementById("route");
  var customWrap = document.getElementById("customwrap");

  try { keyInput.value = localStorage.getItem("pplx_key") || ""; } catch (e) {}
  try {
    var savedRoute = localStorage.getItem("pplx_route");
    if (savedRoute) routeSel.value = savedRoute;
    document.getElementById("custommodel").value =
      localStorage.getItem("pplx_custom_model") || "";
  } catch (e) {}

  function syncCustom() {
    customWrap.style.display = routeSel.value === "custom" ? "" : "none";
  }
  routeSel.addEventListener("change", syncCustom);
  syncCustom();

  function show(id, obj) {
    document.getElementById(id).textContent =
      obj === undefined ? "—" : JSON.stringify(obj, null, 2);
  }
  function meta(id, text) { document.getElementById(id).textContent = text || ""; }
  function esc(s) {
    var d = document.createElement("span"); d.textContent = s; return d.innerHTML;
  }

  f.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var prompt = document.getElementById("prompt").value;
    var system = document.getElementById("system").value;
    var maxTok = parseInt(document.getElementById("maxtok").value, 10);
    var key = keyInput.value.trim();
    var customModel = document.getElementById("custommodel").value.trim();
    var target = routeSel.value === "custom" ? customModel : routeSel.value;
    try {
      localStorage.setItem("pplx_key", key);
      localStorage.setItem("pplx_route", routeSel.value);
      localStorage.setItem("pplx_custom_model", customModel);
    } catch (e) {}

    go.disabled = true;
    status.className = "";
    status.textContent = "In flight…";
    trace.style.display = "block";
    trace.classList.add("inflight");
    answer.style.display = "none";
    ["st3", "st4"].forEach(function (id) {
      document.getElementById(id).classList.add("pending");
    });
    ["j1", "j2", "j3", "j4"].forEach(function (id) { show(id, undefined); });
    ["m1", "m2", "m3", "m4"].forEach(function (id) { meta(id, ""); });

    var headers = { "content-type": "application/json" };
    if (key) headers["authorization"] = "Bearer " + key;
    var t0 = Date.now();

    fetch("/inspect", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        prompt: prompt,
        system: system,
        max_tokens: isNaN(maxTok) ? undefined : maxTok,
        target: target || undefined,
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var total = Date.now() - t0;
        show("j1", d.sonar_request);
        show("j2", d.agent_request);
        var droppedNote = document.getElementById("d2");
        if (d.dropped_fields && d.dropped_fields.length) {
          droppedNote.innerHTML =
            'Dropped fields the Agent API would reject: <span class="warn">' +
            esc(d.dropped_fields.join(", ")) + "</span>";
        }
        if (d.agent_response) {
          show("j3", d.agent_response);
          meta("m3", (d.latency_ms || 0) + " ms upstream");
          document.getElementById("st3").classList.remove("pending");
        }
        if (d.sonar_response) {
          show("j4", d.sonar_response);
          meta("m4", total + " ms end to end");
          document.getElementById("st4").classList.remove("pending");
          var msg = d.sonar_response.choices[0].message.content;
          var cites = d.sonar_response.citations || [];
          var usage = d.sonar_response.usage || {};
          var finish = d.sonar_response.choices[0].finish_reason;
          answer.innerHTML = "";
          var bodyDiv = document.createElement("div");
          if (window.marked && window.DOMPurify) {
            bodyDiv.className = "body md";
            bodyDiv.innerHTML = window.DOMPurify.sanitize(
              window.marked.parse(msg),
              { FORBID_TAGS: ["style", "form", "input"] }
            );
            bodyDiv.querySelectorAll("a").forEach(function (a) {
              a.target = "_blank"; a.rel = "noreferrer";
            });
          } else {
            bodyDiv.className = "body plain";
            bodyDiv.textContent = msg;
          }
          answer.appendChild(bodyDiv);
          var stats = document.createElement("div");
          stats.className = "stats";
          stats.innerHTML =
            "Answer length: <b>" + msg.length.toLocaleString() + " chars</b>" +
            " \\u00b7 <b>" + (usage.completion_tokens || 0).toLocaleString() +
            "</b> of " + (isNaN(maxTok) ? "?" : maxTok.toLocaleString()) +
            " max completion tokens" +
            (finish === "length"
              ? ' \\u00b7 <span class="warn">cut off at max tokens \\u2014 raise Max tokens above</span>'
              : "");
          answer.appendChild(stats);
          if (cites.length) {
            var box = document.createElement("div");
            box.className = "cites";
            cites.forEach(function (u) {
              var a = document.createElement("a");
              a.href = u; a.textContent = u.replace(/^https?:\\/\\//, "");
              a.target = "_blank"; a.rel = "noreferrer";
              box.appendChild(a);
            });
            answer.appendChild(box);
          }
          answer.style.display = "block";
          status.textContent = "Completed in " + total + " ms.";
        }
        if (d.error) {
          status.className = "err";
          status.textContent = d.error;
        }
      })
      .catch(function (e) {
        status.className = "err";
        status.textContent = "Request failed: " + e;
      })
      .finally(function () {
        go.disabled = false;
        trace.classList.remove("inflight");
      });
  });
})();
</script>
</body>
</html>
`;
