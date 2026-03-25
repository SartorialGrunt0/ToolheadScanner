import {
  addExtraLocation,
  buildEmailBodies,
  loadExtraLocations,
  removeExtraLocation,
  runScan,
  saveExtraLocations,
  type Env,
  type ExtraLocation,
  type ScanReport,
} from "./scanner";

const LAST_RUN_KEY = "last-run";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ToolheadScanner Dashboard</title>
  <style>
    :root {
      --bg: #f4f1e8;
      --panel: #fffaf0;
      --ink: #232323;
      --muted: #6b665b;
      --line: #d7cfbf;
      --brand: #1f6a5a;
      --brand-2: #c95f3f;
      --ok: #2f7a45;
      --error: #b2362f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      background: radial-gradient(circle at 20% -20%, #f8f4ec 0, var(--bg) 42%, #ebe4d4 100%);
      color: var(--ink);
    }
    .wrap { max-width: 1120px; margin: 0 auto; padding: 24px; }
    .hero {
      background: linear-gradient(120deg, #fef7ec, #f2e9d7);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 20px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
      margin-bottom: 16px;
    }
    h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: 0.2px; }
    .muted { color: var(--muted); }
    .grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 14px;
    }
    @media (min-width: 960px) {
      .grid { grid-template-columns: 1.1fr 0.9fr; }
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--panel);
      padding: 14px;
    }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    label { font-size: 13px; color: var(--muted); display: block; margin-bottom: 4px; }
    input, textarea {
      width: 100%;
      border: 1px solid #cfc5b1;
      border-radius: 8px;
      padding: 10px;
      font: inherit;
      background: #fffefb;
    }
    textarea { min-height: 120px; }
    button {
      border: 1px solid #1b5b4d;
      background: var(--brand);
      color: white;
      border-radius: 8px;
      padding: 9px 14px;
      font-weight: 600;
      cursor: pointer;
    }
    button.alt {
      border-color: #b25236;
      background: var(--brand-2);
    }
    button.ghost {
      background: transparent;
      color: var(--ink);
      border-color: #b8ad99;
    }
    button:disabled { opacity: 0.5; cursor: default; }
    .status {
      margin-top: 8px;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: #f9f5eb;
      font-size: 13px;
    }
    .status.ok { border-color: #7fb08c; color: var(--ok); background: #eef8ef; }
    .status.error { border-color: #dc9a96; color: var(--error); background: #fff0ef; }
    .list { margin-top: 8px; border-top: 1px dashed var(--line); }
    .item {
      display: grid;
      gap: 6px;
      grid-template-columns: 1fr auto;
      align-items: start;
      border-bottom: 1px dashed var(--line);
      padding: 9px 0;
    }
    .small { font-size: 12px; color: var(--muted); }
    pre {
      margin: 0;
      padding: 10px;
      border-radius: 8px;
      background: #161616;
      color: #f0f0f0;
      overflow: auto;
      max-height: 420px;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>ToolheadScanner Dashboard</h1>
      <p class="muted">Run scans, inspect last cron/manual result, and manage extra GitHub locations.</p>
      <div>
        <label for="token">Manual Run Token (Bearer)</label>
        <div class="row">
          <input id="token" type="password" placeholder="Paste MANUAL_RUN_TOKEN" />
          <button class="ghost" id="saveToken">Save</button>
          <button class="ghost" id="clearToken">Clear</button>
        </div>
      </div>
      <div id="status" class="status">Ready.</div>
    </section>

    <div class="grid">
      <section class="card">
        <h2>Scan Controls</h2>
        <div class="row" style="margin-bottom: 10px;">
          <button id="runScan">Run Scan</button>
          <button class="alt" id="runRecheck">Run Full Recheck</button>
          <button class="ghost" id="loadLast">Refresh Last Run</button>
        </div>
        <p class="small">Run Scan respects hash cache. Run Full Recheck ignores hash cache.</p>
        <h3>Last Run Output</h3>
        <pre id="lastRun">No data loaded yet.</pre>
      </section>

      <section class="card">
        <h2>Extra GitHub Locations</h2>
        <div>
          <label for="toolhead">Toolhead</label>
          <input id="toolhead" type="text" placeholder="Hypernova" />
        </div>
        <div style="margin-top: 8px;">
          <label for="url">GitHub URL</label>
          <input id="url" type="url" placeholder="https://github.com/org/repo/blob/main/path/readme.md" />
        </div>
        <div class="row" style="margin-top: 10px;">
          <button id="addLocation">Add Location</button>
          <button class="ghost" id="refreshLocations">Refresh List</button>
        </div>
        <div id="locations" class="list"></div>
      </section>
    </div>
  </div>

  <script>
    const statusEl = document.getElementById("status");
    const tokenEl = document.getElementById("token");
    const lastRunEl = document.getElementById("lastRun");
    const locationsEl = document.getElementById("locations");

    const toolheadEl = document.getElementById("toolhead");
    const urlEl = document.getElementById("url");

    const saved = localStorage.getItem("toolheadscanner_token") || "";
    tokenEl.value = saved;

    function setStatus(message, type) {
      statusEl.textContent = message;
      statusEl.classList.remove("ok", "error");
      if (type) statusEl.classList.add(type);
    }

    function authHeaders(json = true) {
      const token = tokenEl.value.trim();
      const headers = {};
      if (token) {
        headers["Authorization"] = "Bearer " + token;
      }
      if (json) {
        headers["Content-Type"] = "application/json";
      }
      return headers;
    }

    async function requestJson(path, options = {}) {
      const response = await fetch(path, options);
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = { raw: text };
      }
      if (!response.ok) {
        throw new Error((payload && payload.error) ? payload.error : ("HTTP " + response.status));
      }
      return payload;
    }

    async function loadLastRun() {
      setStatus("Loading last run...", null);
      try {
        const data = await requestJson("/last-run", { method: "GET", headers: authHeaders(false) });
        lastRunEl.textContent = JSON.stringify(data, null, 2);
        setStatus("Loaded last run.", "ok");
      } catch (error) {
        setStatus("Failed to load last run: " + error.message, "error");
      }
    }

    async function runScan(recheck) {
      setStatus(recheck ? "Running full recheck..." : "Running scan...", null);
      try {
        const suffix = recheck ? "?recheck=1" : "";
        const data = await requestJson("/run" + suffix, { method: "POST", headers: authHeaders(false) });
        lastRunEl.textContent = JSON.stringify(data, null, 2);
        setStatus("Scan finished.", "ok");
        await loadLocations();
      } catch (error) {
        setStatus("Scan failed: " + error.message, "error");
      }
    }

    async function loadLocations() {
      try {
        const data = await requestJson("/extra-locations", { method: "GET", headers: authHeaders(false) });
        const items = Array.isArray(data.extra_locations) ? data.extra_locations : [];
        if (!items.length) {
          locationsEl.innerHTML = "<p class=\"small\">No extra locations configured.</p>";
          return;
        }

        locationsEl.innerHTML = "";
        for (const entry of items) {
          const row = document.createElement("div");
          row.className = "item";

          const left = document.createElement("div");
          const title = document.createElement("div");
          title.textContent = entry.toolhead;
          title.style.fontWeight = "600";
          const url = document.createElement("div");
          url.className = "small";
          url.textContent = entry.url;
          left.appendChild(title);
          left.appendChild(url);

          const del = document.createElement("button");
          del.className = "ghost";
          del.textContent = "Delete";
          del.addEventListener("click", async () => {
            setStatus("Deleting location...", null);
            try {
              await requestJson("/extra-locations", {
                method: "DELETE",
                headers: authHeaders(true),
                body: JSON.stringify({ toolhead: entry.toolhead, url: entry.url }),
              });
              setStatus("Location deleted.", "ok");
              await loadLocations();
            } catch (error) {
              setStatus("Delete failed: " + error.message, "error");
            }
          });

          row.appendChild(left);
          row.appendChild(del);
          locationsEl.appendChild(row);
        }
      } catch (error) {
        setStatus("Failed to load locations: " + error.message, "error");
      }
    }

    async function addLocation() {
      const toolhead = toolheadEl.value.trim();
      const url = urlEl.value.trim();
      if (!toolhead || !url) {
        setStatus("Toolhead and URL are required.", "error");
        return;
      }

      setStatus("Adding location...", null);
      try {
        await requestJson("/extra-locations", {
          method: "POST",
          headers: authHeaders(true),
          body: JSON.stringify({ toolhead, url }),
        });
        toolheadEl.value = "";
        urlEl.value = "";
        setStatus("Location added.", "ok");
        await loadLocations();
      } catch (error) {
        setStatus("Add failed: " + error.message, "error");
      }
    }

    document.getElementById("saveToken").addEventListener("click", () => {
      localStorage.setItem("toolheadscanner_token", tokenEl.value.trim());
      setStatus("Token saved in browser storage.", "ok");
    });

    document.getElementById("clearToken").addEventListener("click", () => {
      tokenEl.value = "";
      localStorage.removeItem("toolheadscanner_token");
      setStatus("Token cleared.", "ok");
    });

    document.getElementById("runScan").addEventListener("click", () => runScan(false));
    document.getElementById("runRecheck").addEventListener("click", () => runScan(true));
    document.getElementById("loadLast").addEventListener("click", loadLastRun);

    document.getElementById("addLocation").addEventListener("click", addLocation);
    document.getElementById("refreshLocations").addEventListener("click", loadLocations);

    loadLocations();
    loadLastRun();
  </script>
</body>
</html>`;
}

function isAuthorized(request: Request, env: Env): boolean {
  const expected = env.MANUAL_RUN_TOKEN?.trim();
  if (!expected) {
    return false;
  }

  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${expected}`;
}

function requireAuthorization(request: Request, env: Env): Response | null {
  if (!env.MANUAL_RUN_TOKEN?.trim()) {
    return jsonResponse({ error: "MANUAL_RUN_TOKEN is not configured." }, 503);
  }
  if (!isAuthorized(request, env)) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }
  return null;
}

async function saveLastRun(env: Env, report: ScanReport): Promise<void> {
  await env.SCANNER_STATE.put(LAST_RUN_KEY, JSON.stringify(report, null, 2));
}

async function getLastRun(env: Env): Promise<ScanReport | null> {
  return await env.SCANNER_STATE.get(LAST_RUN_KEY, "json");
}

async function maybeSendNotification(env: Env, report: ScanReport): Promise<{ delivered: boolean; reason?: string }> {
  if (!report.ok || !report.changed || report.results.length === 0) {
    return { delivered: false, reason: "No change notification needed." };
  }

  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.NOTIFY_EMAIL_FROM?.trim();
  const to = env.NOTIFY_EMAIL_TO?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
  if (!apiKey || !from || to.length === 0) {
    return { delivered: false, reason: "Notification settings are incomplete." };
  }

  const bodies = buildEmailBodies(report.results);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: `Toolhead Scanner: ${report.changeCount} toolhead(s) changed`,
      text: bodies.text,
      html: bodies.html,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Notification send failed: ${response.status} ${message}`);
  }

  return { delivered: true };
}

async function runAndPersist(env: Env, trigger: string, recheck = false): Promise<ScanReport> {
  const report = await runScan(env, {
    trigger,
    recheck,
    log: (message) => console.log(`[${trigger}] ${message}`),
  });

  try {
    const notification = await maybeSendNotification(env, report);
    report.logs.push(
      notification.delivered
        ? "Notification delivered"
        : `Notification skipped: ${notification.reason ?? "unknown reason"}`,
    );
  } catch (error) {
    report.logs.push(`Notification error: ${error instanceof Error ? error.message : String(error)}`);
  }

  await saveLastRun(env, report);
  return report;
}

async function handleExtraLocations(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    return jsonResponse({ extra_locations: await loadExtraLocations(env) });
  }

  const payload = (await request.json()) as Partial<ExtraLocation> & { extra_locations?: ExtraLocation[] };

  if (request.method === "POST") {
    const added = await addExtraLocation(env, String(payload.toolhead ?? ""), String(payload.url ?? ""));
    return jsonResponse({ added, extra_locations: await loadExtraLocations(env) }, added ? 201 : 200);
  }

  if (request.method === "DELETE") {
    const removed = await removeExtraLocation(env, String(payload.toolhead ?? ""), String(payload.url ?? ""));
    return jsonResponse({ removed, extra_locations: await loadExtraLocations(env) });
  }

  if (request.method === "PUT") {
    await saveExtraLocations(env, payload.extra_locations ?? []);
    return jsonResponse({ extra_locations: await loadExtraLocations(env) });
  }

  return jsonResponse({ error: "Method not allowed." }, 405);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ ok: true, service: "toolheadscanner", time: new Date().toISOString() });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return textResponse([
        "ToolheadScanner Cloudflare Worker",
        "",
        "GET  /dashboard             Web dashboard for scanner operations",
        "POST /run?recheck=1         Trigger a manual scan",
        "GET  /last-run              Fetch the last stored scan report",
        "GET  /extra-locations       List KV-backed extra GitHub locations",
        "POST /extra-locations       Add one extra location",
        "DELETE /extra-locations     Remove one extra location",
      ].join("\n"));
    }

    if (request.method === "GET" && url.pathname === "/dashboard") {
      return htmlResponse(dashboardHtml());
    }

    if (url.pathname === "/run" && request.method === "POST") {
      const authError = requireAuthorization(request, env);
      if (authError) {
        return authError;
      }

      const recheck = url.searchParams.get("recheck") === "1" || url.searchParams.get("recheck") === "true";
      const report = await runAndPersist(env, "manual", recheck);
      return jsonResponse(report, report.ok ? 200 : 500);
    }

    if (url.pathname === "/last-run" && request.method === "GET") {
      const authError = requireAuthorization(request, env);
      if (authError) {
        return authError;
      }

      const report = await getLastRun(env);
      return jsonResponse(report ?? { message: "No scan has run yet." });
    }

    if (url.pathname === "/extra-locations") {
      const authError = requireAuthorization(request, env);
      if (authError) {
        return authError;
      }

      return await handleExtraLocations(request, env);
    }

    return jsonResponse({ error: "Not found." }, 404);
  },

  async scheduled(_event, env, ctx): Promise<void> {
    ctx.waitUntil(runAndPersist(env, "cron", false));
  },
} satisfies ExportedHandler<Env>;