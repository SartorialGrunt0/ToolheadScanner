import {
  addExtraLocation,
  buildEmailBodies,
  loadEditorData,
  loadExtraLocations,
  removeExtraLocation,
  runScan,
  saveExtraLocations,
  type Env,
  type ExtraLocation,
  type ScanReport,
  type ToolheadEntry,
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
      --bg: #0b0f16;
      --panel: #141b26;
      --ink: #e8ecf4;
      --muted: #a1adbf;
      --line: #2a3547;
      --brand: #3c82f6;
      --brand-2: #0ea5a0;
      --ok: #3ccf8e;
      --error: #ff7474;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      background: radial-gradient(circle at 15% -10%, #1d283b 0, var(--bg) 44%, #070a10 100%);
      color: var(--ink);
    }
    .wrap { max-width: 1120px; margin: 0 auto; padding: 24px; }
    .hero {
      background: linear-gradient(120deg, #182131, #111824);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 20px;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
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
    .grid > * { min-width: 0; }
    .card {
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--panel);
      padding: 14px;
      min-width: 0;
    }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    label { font-size: 13px; color: var(--muted); display: block; margin-bottom: 4px; }
    input, textarea {
      width: 100%;
      border: 1px solid #32425c;
      border-radius: 8px;
      padding: 10px;
      font: inherit;
      background: #0d1420;
      color: var(--ink);
    }
    textarea { min-height: 120px; }
    button {
      border: 1px solid #2f6ad0;
      background: var(--brand);
      color: white;
      border-radius: 8px;
      padding: 9px 14px;
      font-weight: 600;
      cursor: pointer;
    }
    button.alt {
      border-color: #0d8f8b;
      background: var(--brand-2);
    }
    button.ghost {
      background: transparent;
      color: var(--ink);
      border-color: #4c5f7e;
    }
    button:disabled { opacity: 0.5; cursor: default; }
    .status {
      margin-top: 8px;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: #121a27;
      font-size: 13px;
    }
    .status.ok { border-color: #3f8b68; color: var(--ok); background: #11241b; }
    .status.error { border-color: #8b3f3f; color: var(--error); background: #261315; }
    .list { margin-top: 8px; border-top: 1px dashed var(--line); }
    .item {
      display: grid;
      gap: 6px;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      border-bottom: 1px dashed var(--line);
      padding: 9px 0;
    }
    .item-main {
      min-width: 0;
    }
    .item-link {
      display: block;
      min-width: 0;
      max-width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #8cb3ff;
      text-decoration: none;
    }
    .item-link:hover {
      text-decoration: underline;
      color: #b8d0ff;
    }
    .small { font-size: 12px; color: var(--muted); }
    pre {
      margin: 0;
      padding: 10px;
      border-radius: 8px;
      background: #080c13;
      color: #e2e8f0;
      overflow-x: auto;
      overflow-y: auto;
      width: 100%;
      max-width: 100%;
      height: 420px;
      white-space: pre;
      font-size: 12px;
      border: 1px solid #27344a;
    }
    /* Tabs */
    .tabs { display: flex; gap: 0; margin-bottom: 16px; }
    .tab-btn {
      padding: 10px 20px;
      border: 1px solid var(--line);
      border-bottom: none;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      border-radius: 8px 8px 0 0;
      font-weight: 600;
      font-size: 14px;
    }
    .tab-btn.active { background: var(--panel); color: var(--ink); border-color: var(--brand); }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    /* Editor */
    .editor-toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; }
    .editor-toolbar select { flex: 1; min-width: 180px; }
    select {
      border: 1px solid #32425c;
      border-radius: 8px;
      padding: 10px;
      font: inherit;
      background: #0d1420;
      color: var(--ink);
      appearance: auto;
    }
    .field-grid { display: grid; gap: 10px; }
    .field-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #0e1520;
    }
    .field-label {
      min-width: 130px;
      font-weight: 600;
      font-size: 13px;
      color: var(--brand);
      padding-top: 2px;
    }
    .field-value { flex: 1; min-width: 0; }
    .field-actions { display: flex; gap: 6px; flex-shrink: 0; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 12px;
      background: #1c2a3f;
      border: 1px solid #2c3e5a;
      font-size: 12px;
      color: var(--ink);
    }
    .chip.unknown { opacity: 0.5; font-style: italic; }
    .text-val { font-size: 13px; color: var(--ink); word-break: break-all; }
    .text-val.empty { color: var(--muted); font-style: italic; }
    /* Modal */
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      z-index: 100;
      align-items: center;
      justify-content: center;
    }
    .modal-overlay.open { display: flex; }
    .modal {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 20px;
      width: 90%;
      max-width: 520px;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    .modal h3 { margin: 0 0 12px; font-size: 16px; }
    .modal-items { margin-bottom: 12px; }
    .modal-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 0;
      border-bottom: 1px dashed var(--line);
    }
    .modal-item span { font-size: 13px; }
    .modal-add { display: flex; gap: 8px; margin-bottom: 12px; }
    .modal-add select { flex: 1; }
    .btn-sm { padding: 4px 10px; font-size: 12px; border-radius: 6px; }
    .btn-danger { background: #8b3f3f; border-color: #a04848; color: white; }
    .btn-danger:hover { background: #a04848; }
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

    <div class="tabs">
      <button class="tab-btn active" data-tab="scanner">Scanner</button>
      <button class="tab-btn" data-tab="editor">Toolhead Editor</button>
    </div>

    <div id="tab-scanner" class="tab-content active">
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

    <div id="tab-editor" class="tab-content">
      <section class="card">
        <h2>Toolhead Editor</h2>
        <div class="editor-toolbar">
          <select id="editorSelect"><option value="">-- Load reference data first --</option></select>
          <button id="editorNewBtn">+ New</button>
          <button id="editorLoadBtn" class="alt">Load Data</button>
          <button id="editorPRBtn" class="ghost" disabled>Create Pull Request</button>
        </div>
        <div id="editorDetail"><p class="small">Click "Load Data" to fetch the current toolhead reference data.</p></div>
      </section>
    </div>
  </div>

  <div class="modal-overlay" id="modalOverlay">
    <div class="modal" id="modalContent"></div>
  </div>

  <script>
    const statusEl = document.getElementById("status");
    const tokenEl = document.getElementById("token");
    const lastRunEl = document.getElementById("lastRun");
    const locationsEl = document.getElementById("locations");

    const toolheadEl = document.getElementById("toolhead");
    const urlEl = document.getElementById("url");

    function loadSavedToken() {
      try {
        return localStorage.getItem("toolheadscanner_token") || "";
      } catch {
        return "";
      }
    }

    function saveTokenValue(value) {
      try {
        localStorage.setItem("toolheadscanner_token", value);
        return true;
      } catch {
        return false;
      }
    }

    function clearTokenValue() {
      try {
        localStorage.removeItem("toolheadscanner_token");
        return true;
      } catch {
        return false;
      }
    }

    tokenEl.value = loadSavedToken();

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

    function abbreviateUrl(rawUrl) {
      try {
        const parsed = new URL(rawUrl);
        const compact = parsed.host + parsed.pathname;
        return compact.length > 72 ? compact.slice(0, 69) + "..." : compact;
      } catch {
        return rawUrl.length > 72 ? rawUrl.slice(0, 69) + "..." : rawUrl;
      }
    }

    async function loadLocations() {
      try {
        const data = await requestJson("/extra-locations", { method: "GET", headers: authHeaders(false) });
        const items = Array.isArray(data.extra_locations) ? data.extra_locations : [];
        if (!items.length) {
          locationsEl.innerHTML = "<p class='small'>No extra locations configured.</p>";
          return;
        }

        locationsEl.innerHTML = "";
        for (const entry of items) {
          const row = document.createElement("div");
          row.className = "item";

          const left = document.createElement("div");
          left.className = "item-main";
          const title = document.createElement("div");
          title.textContent = entry.toolhead;
          title.style.fontWeight = "600";
          const link = document.createElement("a");
          link.className = "small item-link";
          link.href = entry.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.title = entry.url;
          link.textContent = abbreviateUrl(entry.url);
          left.appendChild(title);
          left.appendChild(link);

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
      const saved = saveTokenValue(tokenEl.value.trim());
      setStatus(saved ? "Token saved in browser storage." : "Token set for this session only (browser storage unavailable).", saved ? "ok" : null);
    });

    document.getElementById("clearToken").addEventListener("click", () => {
      tokenEl.value = "";
      clearTokenValue();
      setStatus("Token cleared.", "ok");
    });

    document.getElementById("runScan").addEventListener("click", () => runScan(false));
    document.getElementById("runRecheck").addEventListener("click", () => runScan(true));
    document.getElementById("loadLast").addEventListener("click", loadLastRun);

    document.getElementById("addLocation").addEventListener("click", addLocation);
    document.getElementById("refreshLocations").addEventListener("click", loadLocations);

    // --- Toolhead Editor ---
    var editorData = null;
    var workingToolheads = [];
    var selectedIdx = -1;
    var pendingImages = {};

    var FIELD_META = {
      name: { type: "text", label: "Name" },
      title: { type: "text", label: "Title" },
      url: { type: "text", label: "URL" },
      description: { type: "text", label: "Description" },
      category: { type: "enum", label: "Category", optionsKey: "categoryOptions" },
      image: { type: "image", label: "Image" },
      configurator: { type: "boolean", label: "Configurator" },
      extruders: { type: "list", label: "Extruders", optionsKey: "extruders" },
      hotend: { type: "list", label: "Hotends", optionsKey: "hotends" },
      probe: { type: "list", label: "Probes", optionsKey: "probes" },
      boards: { type: "list", label: "Boards", optionsKey: "boards" },
      hotend_fan: { type: "list", label: "Hotend Fan", optionsKey: "fans" },
      part_cooling_fan: { type: "list", label: "Part Cooling Fan", optionsKey: "fans" },
      filament_cutter: { type: "enum", label: "Filament Cutter", optionsKey: "filamentCutterOptions" }
    };

    var FIELD_ORDER = ["name", "title", "url", "description", "category", "image", "configurator",
      "extruders", "hotend", "probe", "boards", "hotend_fan", "part_cooling_fan", "filament_cutter"];

    function toArray(v) {
      if (v === null || v === undefined) return [];
      if (Array.isArray(v)) return v;
      return [String(v)];
    }

    function isPlaceholder(v) {
      if (!v) return true;
      var s = String(v).toLowerCase().trim();
      return s === "unknown" || s === "unknow" || s === "other" || s === "na" || s === "n/a" || s === "none" || s === "";
    }

    function cleanFieldForSave(arr) {
      var clean = arr.filter(function(v) { return !isPlaceholder(v); });
      if (clean.length === 0) return "unknown";
      if (clean.length === 1) return clean[0];
      return clean;
    }

    function esc(s) {
      return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function getField(th, key) {
      if (key === "hotend_fan" && th.hotend_fans !== undefined) return th.hotend_fans;
      if (key === "part_cooling_fan" && th.part_cooling_fans !== undefined) return th.part_cooling_fans;
      return th[key];
    }

    function setField(th, key, val) {
      if (key === "hotend_fan" && "hotend_fans" in th) { th.hotend_fans = val; return; }
      if (key === "part_cooling_fan" && "part_cooling_fans" in th) { th.part_cooling_fans = val; return; }
      th[key] = val;
    }

    async function editorLoad() {
      setStatus("Loading reference data...", null);
      try {
        editorData = await requestJson("/api/reference-data", { method: "GET", headers: authHeaders(false) });
        workingToolheads = JSON.parse(JSON.stringify(editorData.toolheads));
        editorPopulate();
        setStatus("Reference data loaded (" + workingToolheads.length + " toolheads).", "ok");
      } catch (err) {
        setStatus("Failed to load reference data: " + err.message, "error");
      }
    }

    function editorPopulate() {
      var sel = document.getElementById("editorSelect");
      sel.innerHTML = '<option value="">-- Select a toolhead --</option>';
      workingToolheads.sort(function(a, b) { return a.name.localeCompare(b.name); });
      for (var i = 0; i < workingToolheads.length; i++) {
        var o = document.createElement("option");
        o.value = String(i);
        o.textContent = workingToolheads[i].name;
        sel.appendChild(o);
      }
      selectedIdx = -1;
      editorRender();
    }

    function editorRender() {
      var c = document.getElementById("editorDetail");
      if (selectedIdx < 0 || selectedIdx >= workingToolheads.length) {
        c.innerHTML = '<p class="small">Select a toolhead or click "+ New" to create one.</p>';
        document.getElementById("editorPRBtn").disabled = true;
        return;
      }
      document.getElementById("editorPRBtn").disabled = false;
      var th = workingToolheads[selectedIdx];
      var h = '<div class="field-grid">';
      for (var i = 0; i < FIELD_ORDER.length; i++) {
        var key = FIELD_ORDER[i];
        var meta = FIELD_META[key];
        var val = getField(th, key);
        h += '<div class="field-row"><div class="field-label">' + meta.label + '</div><div class="field-value">';
        if (meta.type === "list") {
          var arr = toArray(val);
          if (!arr.length) { h += '<span class="text-val empty">none</span>'; }
          else {
            h += '<div class="chips">';
            for (var j = 0; j < arr.length; j++) {
              h += '<span class="chip' + (isPlaceholder(arr[j]) ? ' unknown' : '') + '">' + esc(arr[j]) + '</span>';
            }
            h += '</div>';
          }
        } else if (meta.type === "boolean") {
          h += '<span class="text-val">' + (val ? "true" : "false") + '</span>';
        } else if (meta.type === "enum") {
          h += '<span class="text-val">' + esc(String(val || "unknown")) + '</span>';
        } else {
          h += val ? '<span class="text-val">' + esc(String(val)) + '</span>' : '<span class="text-val empty">empty</span>';
        }
        h += '</div><div class="field-actions">';
        if (meta.type === "list") h += '<button class="ghost btn-sm" data-modify="' + key + '">Modify</button>';
        else if (meta.type === "boolean") h += '<button class="ghost btn-sm" data-toggle="' + key + '">Toggle</button>';
        else if (meta.type === "enum") h += '<button class="ghost btn-sm" data-enum="' + key + '">Change</button>';
        else if (meta.type === "image") h += '<button class="ghost btn-sm" data-edit="' + key + '">Edit</button> <button class="ghost btn-sm" data-upload="image">Upload</button>';
        else h += '<button class="ghost btn-sm" data-edit="' + key + '">Edit</button>';
        h += '</div></div>';
      }
      h += '</div>';
      c.innerHTML = h;

      c.querySelectorAll("[data-edit]").forEach(function(b) {
        b.addEventListener("click", function() { editorTextEdit(b.getAttribute("data-edit")); });
      });
      c.querySelectorAll("[data-upload]").forEach(function(b) {
        b.addEventListener("click", editorImageUpload);
      });
      c.querySelectorAll("[data-toggle]").forEach(function(b) {
        b.addEventListener("click", function() {
          var k = b.getAttribute("data-toggle");
          workingToolheads[selectedIdx][k] = !workingToolheads[selectedIdx][k];
          editorRender();
        });
      });
      c.querySelectorAll("[data-enum]").forEach(function(b) {
        b.addEventListener("click", function() { editorEnumEdit(b.getAttribute("data-enum")); });
      });
      c.querySelectorAll("[data-modify]").forEach(function(b) {
        b.addEventListener("click", function() { editorListModify(b.getAttribute("data-modify")); });
      });
    }

    function openModal(html) {
      document.getElementById("modalContent").innerHTML = html;
      document.getElementById("modalOverlay").classList.add("open");
    }

    function closeModal() {
      document.getElementById("modalOverlay").classList.remove("open");
    }

    function editorTextEdit(key) {
      var th = workingToolheads[selectedIdx];
      var cur = getField(th, key) || "";
      var big = key === "description" || key === "url";
      var inp = big
        ? '<textarea id="modalInput" style="width:100%;min-height:80px;">' + esc(cur) + '</textarea>'
        : '<input id="modalInput" type="text" value="' + esc(cur) + '" />';
      openModal(
        '<h3>Edit ' + FIELD_META[key].label + '</h3>' + inp +
        '<div class="row" style="margin-top:12px;"><button id="modalSave">Save</button> <button class="ghost" id="modalCancel">Cancel</button></div>'
      );
      document.getElementById("modalSave").addEventListener("click", function() {
        setField(th, key, document.getElementById("modalInput").value);
        closeModal(); editorRender();
      });
      document.getElementById("modalCancel").addEventListener("click", closeModal);
    }

    function editorEnumEdit(key) {
      var th = workingToolheads[selectedIdx];
      var cur = getField(th, key) || "unknown";
      var opts = editorData[FIELD_META[key].optionsKey] || [];
      var oh = "";
      for (var i = 0; i < opts.length; i++) {
        oh += '<option value="' + esc(opts[i]) + '"' + (opts[i] === cur ? " selected" : "") + '>' + esc(opts[i]) + '</option>';
      }
      openModal(
        '<h3>Change ' + FIELD_META[key].label + '</h3>' +
        '<select id="modalSelect" style="width:100%;">' + oh + '</select>' +
        '<div class="row" style="margin-top:12px;"><button id="modalSave">Save</button> <button class="ghost" id="modalCancel">Cancel</button></div>'
      );
      document.getElementById("modalSave").addEventListener("click", function() {
        setField(th, key, document.getElementById("modalSelect").value);
        closeModal(); editorRender();
      });
      document.getElementById("modalCancel").addEventListener("click", closeModal);
    }

    function editorListModify(key) {
      var th = workingToolheads[selectedIdx];
      var arr = toArray(getField(th, key)).slice();
      var allOpts = editorData[FIELD_META[key].optionsKey] || [];

      function renderListModal() {
        var ih = "";
        for (var i = 0; i < arr.length; i++) {
          ih += '<div class="modal-item"><span>' + esc(arr[i]) + '</span>' +
            '<button class="ghost btn-sm btn-danger" data-del="' + i + '">Remove</button></div>';
        }
        if (!arr.length) ih = '<p class="small">No items.</p>';

        var avail = allOpts.filter(function(o) {
          return arr.map(function(a) { return a.toLowerCase(); }).indexOf(o.toLowerCase()) < 0;
        });
        var oh = '<option value="">-- Select --</option>';
        for (var j = 0; j < avail.length; j++) {
          oh += '<option value="' + esc(avail[j]) + '">' + esc(avail[j]) + '</option>';
        }

        openModal(
          '<h3>Modify ' + FIELD_META[key].label + '</h3>' +
          '<div class="modal-items">' + ih + '</div>' +
          '<div class="modal-add"><select id="modalAddSel">' + oh + '</select>' +
          '<button id="modalAddBtn" class="alt btn-sm">Add</button></div>' +
          '<div class="row"><button id="modalDone">Done</button></div>'
        );

        document.querySelectorAll("[data-del]").forEach(function(b) {
          b.addEventListener("click", function() {
            arr.splice(parseInt(b.getAttribute("data-del")), 1);
            renderListModal();
          });
        });
        document.getElementById("modalAddBtn").addEventListener("click", function() {
          var v = document.getElementById("modalAddSel").value;
          if (!v) return;
          arr = arr.filter(function(x) { return !isPlaceholder(x); });
          arr.push(v);
          renderListModal();
        });
        document.getElementById("modalDone").addEventListener("click", function() {
          setField(th, key, cleanFieldForSave(arr));
          closeModal(); editorRender();
        });
      }
      renderListModal();
    }

    function editorImageUpload() {
      var fi = document.createElement("input");
      fi.type = "file";
      fi.accept = "image/*";
      fi.addEventListener("change", function() {
        var f = fi.files[0];
        if (!f) return;
        var th = workingToolheads[selectedIdx];
        var toolheadName = th.name.replace(/[^a-zA-Z0-9_-]/g, "_");
        var destFilename = toolheadName + ".webp";
        setStatus("Optimizing image...", null);

        var img = new Image();
        img.onload = function() {
          var MAX_WIDTH = 1200;
          var w = img.width;
          var h = img.height;
          if (w > MAX_WIDTH) {
            h = Math.round(h * MAX_WIDTH / w);
            w = MAX_WIDTH;
          }
          var canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(function(blob) {
            var reader = new FileReader();
            reader.onload = function() {
              pendingImages[selectedIdx] = { filename: destFilename, content: reader.result.split(",")[1] };
              th.image = "/" + destFilename;
              editorRender();
              setStatus("Image staged: " + destFilename + " (optimized to WebP)", "ok");
            };
            reader.readAsDataURL(blob);
          }, "image/webp", 0.80);
        };
        img.onerror = function() {
          setStatus("Failed to load image for optimization.", "error");
        };
        var objectUrl = URL.createObjectURL(f);
        img.src = objectUrl;
      });
      fi.click();
    }

    function editorNewToolhead() {
      if (!editorData) { setStatus("Load reference data first.", "error"); return; }
      var name = prompt("Enter new toolhead name:");
      if (!name || !name.trim()) return;
      name = name.trim();
      for (var i = 0; i < workingToolheads.length; i++) {
        if (workingToolheads[i].name.toLowerCase() === name.toLowerCase()) {
          setStatus("Toolhead already exists: " + name, "error");
          return;
        }
      }
      workingToolheads.push({
        name: name, title: name, url: "", description: "", category: "",
        image: "", configurator: false, extruders: "unknown", hotend: "unknown",
        probe: "unknown", boards: "unknown", hotend_fan: "unknown",
        part_cooling_fan: "unknown", filament_cutter: "unknown"
      });
      editorPopulate();
      var sel = document.getElementById("editorSelect");
      for (var j = 0; j < sel.options.length; j++) {
        if (sel.options[j].textContent === name) {
          sel.value = sel.options[j].value;
          selectedIdx = parseInt(sel.options[j].value);
          break;
        }
      }
      editorRender();
      setStatus("New toolhead added: " + name, "ok");
    }

    async function editorCreatePR() {
      if (!workingToolheads.length) return;
      setStatus("Creating pull request...", null);
      try {
        var images = [];
        for (var key in pendingImages) {
          if (pendingImages.hasOwnProperty(key)) {
            images.push(pendingImages[key]);
          }
        }
        var body = { toolheads: workingToolheads };
        if (images.length) body.images = images;
        var res = await requestJson("/api/create-pr", {
          method: "POST",
          headers: authHeaders(true),
          body: JSON.stringify(body)
        });
        setStatus("Pull request created!", "ok");
        openModal(
          '<h3>Pull Request Created</h3>' +
          '<p><a href="' + esc(res.pr_url) + '" target="_blank" rel="noopener" style="color:#8cb3ff;">' + esc(res.pr_url) + '</a></p>' +
          '<div class="row" style="margin-top:12px;"><button id="modalDone">Close</button></div>'
        );
        document.getElementById("modalDone").addEventListener("click", closeModal);
        pendingImages = {};
      } catch (err) {
        setStatus("PR failed: " + err.message, "error");
      }
    }

    // Tab switching
    document.querySelectorAll(".tab-btn").forEach(function(b) {
      b.addEventListener("click", function() {
        document.querySelectorAll(".tab-btn").forEach(function(x) { x.classList.remove("active"); });
        document.querySelectorAll(".tab-content").forEach(function(x) { x.classList.remove("active"); });
        b.classList.add("active");
        document.getElementById("tab-" + b.getAttribute("data-tab")).classList.add("active");
      });
    });

    // Editor event bindings
    document.getElementById("editorSelect").addEventListener("change", function() {
      selectedIdx = this.value ? parseInt(this.value) : -1;
      editorRender();
    });
    document.getElementById("editorNewBtn").addEventListener("click", editorNewToolhead);
    document.getElementById("editorLoadBtn").addEventListener("click", editorLoad);
    document.getElementById("editorPRBtn").addEventListener("click", editorCreatePR);
    document.getElementById("modalOverlay").addEventListener("click", function(e) {
      if (e.target === this) closeModal();
    });

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

  if (report.ok && report.changed && report.updatedPayload.toolheads.length > 0 && env.GITHUB_TOKEN?.trim()) {
    try {
      const changedNames = report.results.map((r) => r.name).join(", ");
      const prResult = await createToolheadPR(env, report.updatedPayload.toolheads, {
        message: `ToolheadScanner: update ${report.changeCount} toolhead(s) — ${changedNames}`,
      });
      report.logs.push(`PR created: ${prResult.pr_url}`);
    } catch (error) {
      report.logs.push(`PR creation error: ${error instanceof Error ? error.message : String(error)}`);
    }
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

async function handleReferenceData(env: Env): Promise<Response> {
  const data = await loadEditorData(env.TOOLHEAD_DATA_SOURCE_BASE);
  return jsonResponse(data);
}

async function createToolheadPR(
  env: Env,
  toolheads: ToolheadEntry[],
  options?: { message?: string; images?: Array<{ filename: string; content: string }> },
): Promise<{ pr_url: string; pr_number: number; branch: string }> {
  const githubToken = env.GITHUB_TOKEN?.trim();
  if (!githubToken) {
    throw new Error("GITHUB_TOKEN is not configured.");
  }

  if (!Array.isArray(toolheads) || toolheads.length === 0) {
    throw new Error("toolheads array is required.");
  }

  const UPSTREAM_OWNER = "SartorialGrunt0";
  const UPSTREAM_REPO = "ToolheadBuilder";
  const FILE_PATH = "src/data/toolheads.json";

  async function gh(path: string, reqOptions: RequestInit = {}): Promise<Record<string, unknown>> {
    const resp = await fetch(`https://api.github.com${path}`, {
      ...reqOptions,
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ToolheadScannerWorker/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        ...(reqOptions.headers as Record<string, string> ?? {}),
      },
    });
    const text = await resp.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = { raw: text };
    }
    if (!resp.ok) {
      throw new Error(`GitHub API ${resp.status}: ${typeof data.message === "string" ? data.message : JSON.stringify(data)}`);
    }
    return data;
  }

  // 1. Fork the repo (idempotent - returns existing fork)
  try {
    await gh(`/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/forks`, { method: "POST", body: "{}" });
  } catch {
    // Fork may already exist
  }

  // 2. Get authenticated user
  const user = await gh("/user");
  const forkOwner = user.login as string;

  // 3. Sync fork with upstream
  try {
    await gh(`/repos/${forkOwner}/${UPSTREAM_REPO}/merge-upstream`, {
      method: "POST",
      body: JSON.stringify({ branch: "main" }),
    });
  } catch {
    // Already synced or just forked
  }

  // 4. Get fork main HEAD SHA
  const mainRef = await gh(`/repos/${forkOwner}/${UPSTREAM_REPO}/git/ref/heads/main`);
  const baseSha = ((mainRef.object as Record<string, unknown>).sha) as string;

  // 5. Create a new branch
  const branchName = `toolhead-update-${Date.now()}`;
  await gh(`/repos/${forkOwner}/${UPSTREAM_REPO}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
  });

  // 6. Create blob for toolheads.json
  const fileContent = JSON.stringify({ toolheads }, null, 2) + "\n";
  const fileBlob = await gh(`/repos/${forkOwner}/${UPSTREAM_REPO}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content: fileContent, encoding: "utf-8" }),
  });

  // 7. Build tree entries
  const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [
    { path: FILE_PATH, mode: "100644", type: "blob", sha: fileBlob.sha as string },
  ];

  // 8. Upload image blobs
  if (options?.images && options.images.length > 0) {
    for (const img of options.images) {
      if (img.content && img.filename) {
        const sanitized = img.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
        const imageBlob = await gh(`/repos/${forkOwner}/${UPSTREAM_REPO}/git/blobs`, {
          method: "POST",
          body: JSON.stringify({ content: img.content, encoding: "base64" }),
        });
        treeEntries.push({ path: `public/${sanitized}`, mode: "100644", type: "blob", sha: imageBlob.sha as string });
      }
    }
  }

  // 9. Get base commit tree
  const baseCommit = await gh(`/repos/${forkOwner}/${UPSTREAM_REPO}/git/commits/${baseSha}`);
  const baseTreeSha = ((baseCommit.tree as Record<string, unknown>).sha) as string;

  // 10. Create new tree
  const newTree = await gh(`/repos/${forkOwner}/${UPSTREAM_REPO}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });

  // 11. Create commit
  const commitMessage = options?.message || "Update toolheads.json via ToolheadScanner";
  const newCommit = await gh(`/repos/${forkOwner}/${UPSTREAM_REPO}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message: commitMessage, tree: newTree.sha as string, parents: [baseSha] }),
  });

  // 12. Update branch ref
  await gh(`/repos/${forkOwner}/${UPSTREAM_REPO}/git/refs/heads/${branchName}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: newCommit.sha as string }),
  });

  // 13. Create pull request
  const pr = await gh(`/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: commitMessage,
      head: `${forkOwner}:${branchName}`,
      base: "main",
      body: "Automated update from ToolheadScanner Dashboard.",
    }),
  });

  return { pr_url: pr.html_url as string, pr_number: pr.number as number, branch: branchName };
}

async function handleCreatePR(request: Request, env: Env): Promise<Response> {
  const payload = (await request.json()) as {
    toolheads: ToolheadEntry[];
    message?: string;
    images?: Array<{ filename: string; content: string }>;
  };

  try {
    const result = await createToolheadPR(env, payload.toolheads, {
      message: payload.message,
      images: payload.images,
    });
    return jsonResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("not configured") ? 503 : 400;
    return jsonResponse({ error: message }, status);
  }
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
        "GET  /api/reference-data    Fetch toolhead reference data for editor",
        "POST /api/create-pr         Create a GitHub PR with toolhead changes",
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

    if (url.pathname === "/api/reference-data" && request.method === "GET") {
      const authError = requireAuthorization(request, env);
      if (authError) {
        return authError;
      }

      return await handleReferenceData(env);
    }

    if (url.pathname === "/api/create-pr" && request.method === "POST") {
      const authError = requireAuthorization(request, env);
      if (authError) {
        return authError;
      }

      return await handleCreatePR(request, env);
    }

    return jsonResponse({ error: "Not found." }, 404);
  },

  async scheduled(_event, env, ctx): Promise<void> {
    ctx.waitUntil(runAndPersist(env, "cron", false));
  },
} satisfies ExportedHandler<Env>;