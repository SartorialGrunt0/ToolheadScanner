import aliasSeed from "./data/alias.json";
import extraLocationsSeed from "./data/extra_github_locations.seed.json";
import extrudersSeed from "./data/extruders.json";
import hotendsSeed from "./data/hotends.json";
import probesSeed from "./data/probes.json";
import toolheadsSeed from "./data/toolheads.json";

const BRANCH_CANDIDATES = ["main", "master"];
const PLACEHOLDER_VALUES = new Set(["unknown", "unknow", "other", "na", "n/a", "none", ""]);
const DEFAULT_DATA_SOURCE_BASE = "https://raw.githubusercontent.com/SartorialGrunt0/ToolheadBuilder/main/src/data";

const FAN_PATTERNS: Array<[string, string[]]> = [
  ["CPAP", ["\\bcpap\\b", "\\b7040\\b", "\\b70\\s*[xX]\\s*40\\b"]],
  ["5015", ["\\b5015\\b"]],
  ["4010", ["\\b4010\\b"]],
  ["4020", ["\\b4020\\b"]],
  ["4015", ["\\b4015\\b"]],
  ["3010", ["\\b3010\\b"]],
  ["3007", ["\\b3007\\b"]],
  ["2510", ["\\b2510\\b"]],
];

const PART_COOLING_CONTEXT_PATTERNS = [
  "\\bpart\\s*cool(?:ing)?\\b",
  "\\bblower\\b",
  "\\bcpap\\b",
  "\\bduct\\b",
  "\\bradial\\b",
];

const HOTEND_CONTEXT_PATTERNS = [
  "\\bhot\\s*end\\b",
  "\\bhotend\\b",
  "\\bheatsink\\b",
  "\\bheat\\s*break\\b",
  "\\baxial\\b",
];

const FILAMENT_CUTTER_PATTERNS = [
  "\\bfilament\\s*cutter\\b",
  "\\bcutter\\b.{0,24}\\bfilament\\b",
  "\\bfilament\\b.{0,24}\\bcutter\\b",
  "\\bercf\\b.{0,24}\\bcutter\\b",
];

const PRINTER_PATTERNS: Array<[string, string[]]> = [
  ["V0", ["\\bv0\\b", "\\bvoron\\s*0\\b", "\\bvoron\\s*zero\\b", "\\bv0\\.\\d\\b"]],
  ["V2.4", ["\\bv2\\.4\\b", "\\bvoron\\s*2\\.4\\b", "\\bvoron\\s*2\\b(?!\\.[^4])"]],
  ["Trident", ["\\btrident\\b", "\\bvt\\b"]],
  ["Switchwire", ["\\bswitchwire\\b"]],
  ["Enderwire", ["\\benderwire\\b"]],
  ["SV08", ["\\bsv08\\b", "\\bsovol\\s*sv08\\b"]],
];

const PRINTER_TO_BELT_PATH: Record<string, string> = {
  "V0": "Voron coreXY",
  "V2.4": "Voron coreXY",
  "Trident": "Voron coreXY",
  "Switchwire": "Voron coreXZ",
  "Enderwire": "Voron coreXZ",
  "SV08": "unknown",
};

const BELT_PATH_PATTERNS: Array<[string, string[]]> = [
  ["Monolith coreXY", ["\\bmonolith\\b"]],
];

const SCAN_FETCH_BUDGET = 33;

export interface Env {
  HASH_CACHE: KVNamespace;
  SCANNER_STATE: KVNamespace;
  TOOLHEAD_DATA_SOURCE_BASE?: string;
  MANUAL_RUN_TOKEN?: string;
  RESEND_API_KEY?: string;
  NOTIFY_EMAIL_FROM?: string;
  NOTIFY_EMAIL_TO?: string;
  GITHUB_TOKEN?: string;
}

type ToolheadField = string | string[] | null | undefined;

export interface ToolheadEntry {
  name: string;
  url: string;
  extruders?: ToolheadField;
  hotend?: ToolheadField;
  probe?: ToolheadField;
  boards?: ToolheadField;
  hotend_fan?: ToolheadField;
  hotend_fans?: ToolheadField;
  part_cooling_fan?: ToolheadField;
  part_cooling_fans?: ToolheadField;
  filament_cutter?: string | null;
  printer_compatibility?: ToolheadField;
  belt_path?: ToolheadField;
  [key: string]: unknown;
}

export interface NamedEntry {
  name: string;
  [key: string]: unknown;
}

interface ReferenceData {
  extruders: NamedEntry[];
  hotends: NamedEntry[];
  probes: NamedEntry[];
  toolheads: ToolheadEntry[];
}

interface AliasData {
  extruders?: Record<string, string>;
  hotends?: Record<string, string>;
  probes?: Record<string, string>;
  boards?: Record<string, string>;
  printers?: Record<string, string>;
  [key: string]: unknown;
}

export interface ExtraLocation {
  toolhead: string;
  url: string;
}

interface ScanTarget {
  name: string;
  url: string;
  source: string;
}

type SearchTableEntry = [string, string];

export interface ScanResult {
  name: string;
  new_extruders: string[];
  new_hotends: string[];
  new_probes: string[];
  new_boards: string[];
  new_hotend_fans: string[];
  new_part_cooling_fans: string[];
  new_filament_cutter: boolean;
  new_printers: string[];
  new_belt_paths: string[];
  sources: Record<string, string>;
  updated: ToolheadEntry;
  original: ToolheadEntry;
}

export interface ScanReport {
  ok: boolean;
  trigger: string;
  recheck: boolean;
  startedAt: string;
  finishedAt: string;
  changed: boolean;
  changeCount: number;
  summary: string;
  results: ScanResult[];
  updatedPayload: { toolheads: ToolheadEntry[] };
  logs: string[];
  error?: string;
}

interface RunOptions {
  trigger: string;
  recheck?: boolean;
  log?: (message: string) => void;
}

function sanitizeAliasSection(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key, mapped]) => !key.startsWith("_") && typeof mapped === "string")
      .map(([key, mapped]) => [key, mapped as string]),
  );
}

function sanitizeAliases(seed: unknown): Required<Pick<AliasData, "extruders" | "hotends" | "probes" | "boards" | "printers">> {
  const raw = (seed ?? {}) as AliasData;
  return {
    extruders: sanitizeAliasSection(raw.extruders),
    hotends: sanitizeAliasSection(raw.hotends),
    probes: sanitizeAliasSection(raw.probes),
    boards: sanitizeAliasSection(raw.boards),
    printers: sanitizeAliasSection(raw.printers),
  };
}

function cleanExtraLocations(entries: unknown): ExtraLocation[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  const cleaned: ExtraLocation[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const toolhead = String((entry as Record<string, unknown>).toolhead ?? "").trim();
    const url = String((entry as Record<string, unknown>).url ?? "").trim();
    if (toolhead && url) {
      cleaned.push({ toolhead, url });
    }
  }

  return cleaned;
}

export async function loadExtraLocations(env: Env): Promise<ExtraLocation[]> {
  const stored = await env.SCANNER_STATE.get("extra-locations", "json");
  if (stored && typeof stored === "object") {
    const storedLocations = cleanExtraLocations((stored as { extra_locations?: unknown }).extra_locations);
    if (storedLocations.length > 0) {
      return storedLocations;
    }
  }

  const seedLocations = cleanExtraLocations((extraLocationsSeed as { extra_locations?: unknown }).extra_locations);
  if (seedLocations.length > 0) {
    await saveExtraLocations(env, seedLocations);
  }
  return seedLocations;
}

export async function saveExtraLocations(env: Env, locations: ExtraLocation[]): Promise<void> {
  const deduped = dedupeExtraLocations(cleanExtraLocations(locations));
  await env.SCANNER_STATE.put(
    "extra-locations",
    JSON.stringify({ extra_locations: deduped }, null, 2),
  );
}

export async function addExtraLocation(env: Env, toolhead: string, url: string): Promise<boolean> {
  const normalizedToolhead = toolhead.trim();
  const normalizedUrl = url.trim();

  if (!normalizedToolhead) {
    throw new Error("Toolhead name is required.");
  }
  if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
    throw new Error("URL must be an HTTP or HTTPS URL.");
  }

  const existing = await loadExtraLocations(env);
  const alreadyExists = existing.some(
    (entry) => entry.toolhead.toLowerCase() === normalizedToolhead.toLowerCase() && entry.url === normalizedUrl,
  );
  if (alreadyExists) {
    return false;
  }

  existing.push({ toolhead: normalizedToolhead, url: normalizedUrl });
  await saveExtraLocations(env, existing);
  return true;
}

export async function removeExtraLocation(env: Env, toolhead: string, url: string): Promise<boolean> {
  const existing = await loadExtraLocations(env);
  const filtered = existing.filter(
    (entry) => !(entry.toolhead.toLowerCase() === toolhead.trim().toLowerCase() && entry.url === url.trim()),
  );
  if (filtered.length === existing.length) {
    return false;
  }

  await saveExtraLocations(env, filtered);
  return true;
}

function dedupeExtraLocations(entries: ExtraLocation[]): ExtraLocation[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.toolhead.toLowerCase()}::${entry.url}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function githubRawReadmeUrls(githubUrl: string): string[] {
  const url = githubUrl.replace(/\/$/, "").replace(/\.git$/, "");

  const treeMatch = /github\.com\/([^/]+)\/([^/]+)\/(?:tree|blob)\/([^/]+)(?:\/(.*))?$/i.exec(url);
  if (treeMatch) {
    const [, owner, repo, branch, subpath] = treeMatch;
    const prefix = subpath ? `${subpath}/` : "";
    const base = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;
    return [`${base}/${prefix}README.md`];
  }

  const repoMatch = /github\.com\/([^/]+)\/([^/]+)$/i.exec(url);
  if (repoMatch) {
    const [, owner, repo] = repoMatch;
    return BRANCH_CANDIDATES.map((branch) =>
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`,
    );
  }

  return [];
}

function githubRawFileUrl(githubUrl: string): string | null {
  const url = githubUrl.replace(/\/$/, "").replace(/\.git$/, "");

  const blobMatch = /github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.*)$/i.exec(url);
  if (blobMatch) {
    const [, owner, repo, branch, filePath] = blobMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  }

  const treeMatch = /github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.*)$/i.exec(url);
  if (treeMatch) {
    const [, owner, repo, branch, filePath] = treeMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  }

  if (url.includes("raw.githubusercontent.com")) {
    return url;
  }

  return null;
}

function githubContentCandidates(githubUrl: string, sourceFile: string): string[] {
  const candidates: string[] = [];

  if (sourceFile === "extra_github_locations.json") {
    const directRaw = githubRawFileUrl(githubUrl);
    if (directRaw) {
      candidates.push(directRaw);
    }
  }

  candidates.push(...githubRawReadmeUrls(githubUrl));
  return [...new Set(candidates)];
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "ToolheadScannerWorker/1.0" },
      redirect: "follow",
    });
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const text = await fetchText(url);
  if (text === null) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function hasNamedArray(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entries = (value as Record<string, unknown>)[key];
  return Array.isArray(entries);
}

export async function loadReferenceData(log: (message: string) => void, dataSourceBase?: string, useLocalOnly = false): Promise<ReferenceData> {
  if (useLocalOnly) {
    log("Using bundled seed data (local-only mode)");
    return {
      extruders: (extrudersSeed as { extruders: NamedEntry[] }).extruders,
      hotends: (hotendsSeed as { hotends: NamedEntry[] }).hotends,
      probes: (probesSeed as { probes: NamedEntry[] }).probes,
      toolheads: (toolheadsSeed as { toolheads: ToolheadEntry[] }).toolheads,
    };
  }

  const base = dataSourceBase || DEFAULT_DATA_SOURCE_BASE;
  log(`Syncing reference data from ${base}`);

  const [remoteExtruders, remoteHotends, remoteProbes, remoteToolheads] = await Promise.all([
    fetchJson<{ extruders: NamedEntry[] }>(`${base}/extruders.json`),
    fetchJson<{ hotends: NamedEntry[] }>(`${base}/hotends.json`),
    fetchJson<{ probes: NamedEntry[] }>(`${base}/probes.json`),
    fetchJson<{ toolheads: ToolheadEntry[] }>(`${base}/toolheads.json`),
  ]);

  return {
    extruders: hasNamedArray(remoteExtruders, "extruders")
      ? remoteExtruders!.extruders
      : (extrudersSeed as { extruders: NamedEntry[] }).extruders,
    hotends: hasNamedArray(remoteHotends, "hotends")
      ? remoteHotends!.hotends
      : (hotendsSeed as { hotends: NamedEntry[] }).hotends,
    probes: hasNamedArray(remoteProbes, "probes")
      ? remoteProbes!.probes
      : (probesSeed as { probes: NamedEntry[] }).probes,
    toolheads: hasNamedArray(remoteToolheads, "toolheads")
      ? remoteToolheads!.toolheads
      : (toolheadsSeed as { toolheads: ToolheadEntry[] }).toolheads,
  };
}

function buildScanTargets(toolheads: ToolheadEntry[], extraLocations: ExtraLocation[], log: (message: string) => void): ScanTarget[] {
  const targets: ScanTarget[] = toolheads.map((toolhead) => ({
    name: toolhead.name,
    url: String(toolhead.url ?? "").trim(),
    source: "toolheads.json",
  }));

  for (const entry of extraLocations) {
    targets.push({
      name: entry.toolhead,
      url: entry.url,
      source: "extra_github_locations.json",
    });
  }

  if (extraLocations.length > 0) {
    log(`Loaded ${extraLocations.length} extra GitHub location(s)`);
  }
  return targets;
}

function stripHtmlTags(html: string): string {
  let text = html;
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ");
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(?:p|div|li|tr|h[1-6]|td|th|dt|dd|section|article)>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/&nbsp;/gi, " ");
  text = text.replace(/&amp;/gi, "&");
  text = text.replace(/&lt;/gi, "<");
  text = text.replace(/&gt;/gi, ">");
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#39;/gi, "'");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function isHtmlContent(text: string): boolean {
  return /<!doctype\s+html|<html[\s>]/i.test(text.slice(0, 500));
}

async function collectReadmeBlocks(
  env: Env,
  scanTargets: ScanTarget[],
  skipUnchanged: boolean,
  log: (message: string) => void,
): Promise<{ readmeBlocks: Record<string, string>; updatedHashes: Array<[string, string]> }> {
  const readmeBlocks: Record<string, string> = {};
  const updatedHashes: Array<[string, string]> = [];
  let fetchBudget = SCAN_FETCH_BUDGET;

  for (const target of scanTargets) {
    const name = target.name || "Unknown";
    const url = target.url.trim();
    const isGitHub = url.includes("github.com");

    if (fetchBudget <= 0) {
      log(`  [SKIP]  ${name}  (fetch budget exhausted)`);
      continue;
    }

    let readmeText: string | null = null;

    if (isGitHub) {
      for (const candidate of githubContentCandidates(url, target.source)) {
        if (fetchBudget <= 0) break;
        fetchBudget--;
        readmeText = await fetchText(candidate);
        if (readmeText !== null) {
          break;
        }
      }
    } else if (url.startsWith("http://") || url.startsWith("https://")) {
      fetchBudget--;
      const rawResponse = await fetchText(url);
      if (rawResponse !== null) {
        readmeText = isHtmlContent(rawResponse) ? stripHtmlTags(rawResponse) : rawResponse;
      }
    }

    if (readmeText === null) {
      log(`  [FAIL]  ${name}  (no content found)`);
      continue;
    }

    const currentHash = await sha256Hex(readmeText);
    updatedHashes.push([url, currentHash]);

    if (skipUnchanged) {
      const cachedHash = await env.HASH_CACHE.get(hashKey(url));
      if (cachedHash === currentHash) {
        log(`  [SKIP]  ${name}  (content unchanged)`);
        continue;
      }
    }

    log(`  [OK]    ${name}${isGitHub ? "" : "  (HTML page)"}`);
    readmeBlocks[name] = readmeBlocks[name] ? `${readmeBlocks[name]}\n\n${readmeText}` : readmeText;
  }

  if (fetchBudget <= 0) {
    log(`[WARN] Fetch budget (${SCAN_FETCH_BUDGET}) exhausted — some sources were skipped`);
  }

  return { readmeBlocks, updatedHashes };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSearchTable(canonicalNames: string[], aliasMap: Record<string, string>): SearchTableEntry[] {
  const entries = new Map<string, string>();
  for (const name of canonicalNames) {
    entries.set(name.toLowerCase(), name);
  }
  for (const [alias, canonical] of Object.entries(aliasMap)) {
    entries.set(alias.toLowerCase(), canonical);
  }
  return [...entries.entries()].sort((left, right) => right[0].length - left[0].length);
}

function buildBoardSearchTable(boardAliasMap: Record<string, string>): SearchTableEntry[] {
  return Object.entries(boardAliasMap)
    .map(([alias, canonical]) => [alias.toLowerCase(), canonical] as SearchTableEntry)
    .sort((left, right) => right[0].length - left[0].length);
}

function findMatches(text: string, searchTable: SearchTableEntry[]): { foundNames: string[]; foundSources: Record<string, string> } {
  const textLower = text.toLowerCase();
  const foundLower = new Set<string>();
  const foundNames: string[] = [];
  const foundSources: Record<string, string> = {};
  const matchedSpans: Array<[number, number]> = [];

  for (const [termLower, canonical] of searchTable) {
    if (termLower === "bmg") {
      continue;
    }

    const pattern = new RegExp(`\\b${escapeRegExp(termLower)}\\b`, "g");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(textLower)) !== null) {
      const spanStart = match.index;
      const spanEnd = spanStart + match[0].length;
      const overlaps = matchedSpans.some(([start, end]) => spanStart < end && spanEnd > start);
      if (overlaps) {
        continue;
      }

      const key = canonical.toLowerCase();
      if (foundLower.has(key)) {
        break;
      }

      foundLower.add(key);
      foundNames.push(canonical);
      matchedSpans.push([spanStart, spanEnd]);

      const lineStart = text.lastIndexOf("\n", spanStart - 1) + 1;
      const rawLineEnd = text.indexOf("\n", spanEnd);
      const lineEnd = rawLineEnd === -1 ? text.length : rawLineEnd;
      foundSources[canonical] = text.slice(lineStart, lineEnd).trim();
      break;
    }
  }

  return { foundNames, foundSources };
}

function isPartCoolingContext(localText: string): boolean {
  return PART_COOLING_CONTEXT_PATTERNS.some((pattern) => new RegExp(pattern, "i").test(localText));
}

function isHotendContext(localText: string): boolean {
  return HOTEND_CONTEXT_PATTERNS.some((pattern) => new RegExp(pattern, "i").test(localText));
}

function findFans(text: string): {
  hotendFans: string[];
  partCoolingFans: string[];
  hotendSources: Record<string, string>;
  partCoolingSources: Record<string, string>;
} {
  const hotendFans: string[] = [];
  const partCoolingFans: string[] = [];
  const hotendSources: Record<string, string> = {};
  const partCoolingSources: Record<string, string> = {};

  for (const line of text.split(/\r?\n/)) {
    const lineLower = line.toLowerCase();
    const contextIsFan = ["fan", "blower", "cpap", "axial"].some((word) => lineLower.includes(word));

    for (const [canonical, patterns] of FAN_PATTERNS) {
      let matched = false;
      for (const pattern of patterns) {
        const regex = new RegExp(pattern, "ig");
        let match: RegExpExecArray | null;
        while ((match = regex.exec(line)) !== null) {
          if (canonical !== "CPAP" && !contextIsFan) {
            continue;
          }

          const start = Math.max(0, match.index - 48);
          const end = Math.min(line.length, match.index + match[0].length + 48);
          const localContext = line.slice(start, end);
          const isPart = isPartCoolingContext(localContext);
          const isHotend = isHotendContext(localContext);

          if (isPart && !partCoolingFans.includes(canonical)) {
            partCoolingFans.push(canonical);
            partCoolingSources[canonical] = line.trim();
          }

          if (isHotend && !hotendFans.includes(canonical)) {
            hotendFans.push(canonical);
            hotendSources[canonical] = line.trim();
          }

          if (canonical === "CPAP" && !isPart && !isHotend && !partCoolingFans.includes(canonical)) {
            partCoolingFans.push(canonical);
            partCoolingSources[canonical] = line.trim();
          }

          matched = true;
          break;
        }

        if (matched) {
          break;
        }
      }
    }
  }

  return { hotendFans, partCoolingFans, hotendSources, partCoolingSources };
}

function findFilamentCutterSource(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    for (const pattern of FILAMENT_CUTTER_PATTERNS) {
      if (new RegExp(pattern, "i").test(line)) {
        return line.trim();
      }
    }
  }
  return null;
}

function findPrinters(text: string, printerAliasMap: Record<string, string>): {
  printers: string[];
  printerSources: Record<string, string>;
} {
  const found = new Set<string>();
  const printers: string[] = [];
  const printerSources: Record<string, string> = {};

  for (const [canonical, patterns] of PRINTER_PATTERNS) {
    if (found.has(canonical)) continue;
    for (const pattern of patterns) {
      const regex = new RegExp(pattern, "ig");
      const match = regex.exec(text);
      if (match) {
        found.add(canonical);
        printers.push(canonical);
        const lineStart = text.lastIndexOf("\n", match.index - 1) + 1;
        const rawLineEnd = text.indexOf("\n", match.index + match[0].length);
        const lineEnd = rawLineEnd === -1 ? text.length : rawLineEnd;
        printerSources[canonical] = text.slice(lineStart, lineEnd).trim();
        break;
      }
    }
  }

  for (const [alias, canonical] of Object.entries(printerAliasMap)) {
    if (found.has(canonical)) continue;
    const aliasPattern = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "ig");
    const match = aliasPattern.exec(text);
    if (match) {
      found.add(canonical);
      printers.push(canonical);
      const lineStart = text.lastIndexOf("\n", match.index - 1) + 1;
      const rawLineEnd = text.indexOf("\n", match.index + match[0].length);
      const lineEnd = rawLineEnd === -1 ? text.length : rawLineEnd;
      printerSources[canonical] = text.slice(lineStart, lineEnd).trim();
    }
  }

  return { printers, printerSources };
}

function findDirectBeltPaths(text: string): {
  beltPaths: string[];
  beltPathSources: Record<string, string>;
} {
  const found = new Set<string>();
  const beltPaths: string[] = [];
  const beltPathSources: Record<string, string> = {};

  for (const [canonical, patterns] of BELT_PATH_PATTERNS) {
    if (found.has(canonical)) continue;
    for (const pattern of patterns) {
      const regex = new RegExp(pattern, "ig");
      const match = regex.exec(text);
      if (match) {
        found.add(canonical);
        beltPaths.push(canonical);
        const lineStart = text.lastIndexOf("\n", match.index - 1) + 1;
        const rawLineEnd = text.indexOf("\n", match.index + match[0].length);
        const lineEnd = rawLineEnd === -1 ? text.length : rawLineEnd;
        beltPathSources[canonical] = text.slice(lineStart, lineEnd).trim();
        break;
      }
    }
  }

  return { beltPaths, beltPathSources };
}

function deriveBeltPaths(printers: string[]): string[] {
  const pathSet = new Set<string>();
  for (const printer of printers) {
    const belt = PRINTER_TO_BELT_PATH[printer];
    if (belt && belt !== "unknown") {
      pathSet.add(belt);
    }
  }
  return [...pathSet];
}

function normalizeField(value: ToolheadField): Set<string> {
  if (value === null || value === undefined) {
    return new Set<string>();
  }

  if (Array.isArray(value)) {
    return new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.toLowerCase().trim())
        .filter((entry) => !PLACEHOLDER_VALUES.has(entry)),
    );
  }

  if (typeof value === "string") {
    const normalized = value.toLowerCase().trim();
    return PLACEHOLDER_VALUES.has(normalized) ? new Set<string>() : new Set<string>([normalized]);
  }

  return new Set<string>();
}

function canonicalLookup(values: Set<string>, searchTable: SearchTableEntry[]): Set<string> {
  const reverseMap = new Map<string, string>(searchTable.map(([term, canonical]) => [term, canonical.toLowerCase()]));
  return new Set([...values].map((value) => reverseMap.get(value) ?? value));
}

function findNewItems(foundCanonicals: string[], existingFieldValue: ToolheadField, searchTable: SearchTableEntry[]): string[] {
  const existingNormalized = normalizeField(existingFieldValue);
  const existingCanonical = canonicalLookup(existingNormalized, searchTable);
  return foundCanonicals.filter((item) => !existingCanonical.has(item.toLowerCase()));
}

function findNewSimple(foundItems: string[], existingValue: ToolheadField): string[] {
  const existingNormalized = normalizeField(existingValue);
  return foundItems.filter((item) => !existingNormalized.has(item.toLowerCase()));
}

function mergeField(existing: ToolheadField, newItems: string[]): ToolheadField {
  if (newItems.length === 0) {
    return existing;
  }

  if (existing === null || existing === undefined) {
    return newItems.length === 1 ? newItems[0] : newItems;
  }

  if (typeof existing === "string" && PLACEHOLDER_VALUES.has(existing.toLowerCase().trim())) {
    return newItems.length === 1 ? newItems[0] : newItems;
  }

  const existingList = Array.isArray(existing) ? existing : [existing];
  return [...existingList, ...newItems];
}

function getExistingFanField(toolhead: ToolheadEntry, pluralKey: "hotend_fans" | "part_cooling_fans", singularKey: "hotend_fan" | "part_cooling_fan"): { value: ToolheadField; key: typeof pluralKey | typeof singularKey } {
  if (pluralKey in toolhead) {
    return { value: toolhead[pluralKey] as ToolheadField, key: pluralKey };
  }
  return { value: toolhead[singularKey] as ToolheadField, key: singularKey };
}

function hashKey(url: string): string {
  return `hash:${url}`;
}

async function sha256Hex(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function stableClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function buildEmailBodies(results: ScanResult[]): { text: string; html: string } {
  const now = new Date().toISOString();
  const lines = [
    `Toolhead Scanner - changes detected at ${now}`,
    "========================================================",
    `${results.length} toolhead(s) with updates:`,
    "",
  ];

  for (const entry of results) {
    const name = entry.name;
    lines.push(`  ${name}`);
    lines.push(`  ${"-".repeat(name.length)}`);

    const sections: Array<[string, string[]]> = [
      ["Extruders", entry.new_extruders],
      ["Hotends", entry.new_hotends],
      ["Probes", entry.new_probes],
      ["Boards", entry.new_boards],
      ["Hotend Fans", entry.new_hotend_fans],
      ["Part Cooling Fans", entry.new_part_cooling_fans],
      ["Printers", entry.new_printers],
      ["Belt Paths", entry.new_belt_paths],
    ];

    for (const [label, items] of sections) {
      if (items.length > 0) {
        lines.push(`    NEW ${label}: ${items.join(", ")}`);
      }
    }

    if (entry.new_filament_cutter) {
      lines.push("    NEW Filament Cutter: supported");
    }
    lines.push("");
  }

  const htmlParts = [
    "<html><body style='font-family:Consolas,monospace;font-size:14px;'>",
    "<h2>Toolhead Scanner &mdash; changes detected</h2>",
    `<p style='color:#888;'>${escapeHtml(now)}</p>`,
    `<p><strong>${results.length}</strong> toolhead(s) with updates:</p>`,
  ];

  for (const entry of results) {
    htmlParts.push(`<h3 style='color:#61afef;'>${escapeHtml(entry.name)}</h3>`);
    htmlParts.push("<table style='border-collapse:collapse;margin-left:16px;'>");

    const sections: Array<[string, string[]]> = [
      ["Extruders", entry.new_extruders],
      ["Hotends", entry.new_hotends],
      ["Probes", entry.new_probes],
      ["Boards", entry.new_boards],
      ["Hotend Fans", entry.new_hotend_fans],
      ["Part Cooling Fans", entry.new_part_cooling_fans],
      ["Printers", entry.new_printers],
      ["Belt Paths", entry.new_belt_paths],
    ];

    for (const [label, items] of sections) {
      if (items.length === 0) {
        continue;
      }
      htmlParts.push(
        `<tr><td style='padding:2px 12px 2px 0;color:#c678dd;'>${escapeHtml(label)}</td><td style='color:#98c379;'>${escapeHtml(items.join(", "))}</td></tr>`,
      );
    }

    if (entry.new_filament_cutter) {
      htmlParts.push("<tr><td style='padding:2px 12px 2px 0;color:#c678dd;'>Filament Cutter</td><td style='color:#98c379;'>supported</td></tr>");
    }

    htmlParts.push("</table>");
  }

  htmlParts.push("</body></html>");
  return { text: lines.join("\n"), html: htmlParts.join("\n") };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function runScan(env: Env, options: RunOptions): Promise<ScanReport> {
  const startedAt = new Date().toISOString();
  const logs: string[] = [];
  const recheck = options.recheck ?? false;
  const log = (message: string) => {
    logs.push(message);
    options.log?.(message);
  };

  try {
    if (recheck) {
      log("[INFO] Rechecking all READMEs");
    }

    const referenceData = await loadReferenceData(log, env.TOOLHEAD_DATA_SOURCE_BASE);
    const aliases = sanitizeAliases(aliasSeed);
    const extraLocations = await loadExtraLocations(env);
    const scanTargets = buildScanTargets(referenceData.toolheads, extraLocations, log);
    const toolheadMap = new Map(referenceData.toolheads.map((toolhead) => [toolhead.name, toolhead]));

    log(`Downloading READMEs for ${scanTargets.length} source location(s) ...`);
    const { readmeBlocks, updatedHashes } = await collectReadmeBlocks(env, scanTargets, !recheck, log);
    log("");

    const extruderTable = buildSearchTable(referenceData.extruders.map((entry) => entry.name), aliases.extruders);
    const hotendTable = buildSearchTable(referenceData.hotends.map((entry) => entry.name), aliases.hotends);
    const probeTable = buildSearchTable(referenceData.probes.map((entry) => entry.name), aliases.probes);
    const boardTable = buildBoardSearchTable(aliases.boards);

    const results: ScanResult[] = [];
    const updatesNeeded: ToolheadEntry[] = [];

    for (const [name, readmeText] of Object.entries(readmeBlocks)) {
      const toolhead = toolheadMap.get(name);
      if (!toolhead) {
        continue;
      }

      const { foundNames: foundExtruders, foundSources: extruderSources } = findMatches(readmeText, extruderTable);
      const { foundNames: foundHotends, foundSources: hotendMatchSources } = findMatches(readmeText, hotendTable);
      const { foundNames: foundProbes, foundSources: probeSources } = findMatches(readmeText, probeTable);
      const { foundNames: foundBoards, foundSources: boardSources } = findMatches(readmeText, boardTable);
      const { hotendFans, partCoolingFans, hotendSources: hotendFanSources, partCoolingSources } = findFans(readmeText);
      const filamentCutterSource = findFilamentCutterSource(readmeText);

      const filteredExtruders = foundExtruders.filter((entry) => entry.toLowerCase() !== "bmg");
      const filteredBoards = foundBoards.filter((entry) => entry.toLowerCase() !== "bmg");
      const trimmedExtruderSources = Object.fromEntries(
        Object.entries(extruderSources).filter(([key]) => key.toLowerCase() !== "bmg"),
      );
      const trimmedBoardSources = Object.fromEntries(
        Object.entries(boardSources).filter(([key]) => key.toLowerCase() !== "bmg"),
      );

      const normalizedExtruders = filteredExtruders.map((entry) => (entry === "HextrudORT" ? "Vz HextrudORT" : entry));
      if (trimmedExtruderSources.HextrudORT) {
        trimmedExtruderSources["Vz HextrudORT"] = trimmedExtruderSources.HextrudORT;
        delete trimmedExtruderSources.HextrudORT;
      }

      const dedupedExtruders = normalizedExtruders.filter((entry, index) => normalizedExtruders.indexOf(entry) === index);

      const newExtruders = findNewItems(dedupedExtruders, toolhead.extruders, extruderTable);
      const newHotends = findNewItems(foundHotends, toolhead.hotend, hotendTable);
      const newProbes = findNewItems(foundProbes, toolhead.probe, probeTable);
      const newBoards = findNewItems(filteredBoards, toolhead.boards, boardTable);

      const existingHotendFan = getExistingFanField(toolhead, "hotend_fans", "hotend_fan");
      const existingPartCoolingFan = getExistingFanField(toolhead, "part_cooling_fans", "part_cooling_fan");
      const newHotendFans = findNewSimple(hotendFans, existingHotendFan.value);
      const newPartCoolingFans = findNewSimple(partCoolingFans, existingPartCoolingFan.value);

      const existingCutter = String(toolhead.filament_cutter ?? "").toLowerCase().trim();
      const newFilamentCutter = Boolean(filamentCutterSource && PLACEHOLDER_VALUES.has(existingCutter));

      const { printers: foundPrinters, printerSources } = findPrinters(readmeText, aliases.printers);
      const newPrinters = findNewSimple(foundPrinters, toolhead.printer_compatibility);
      const allPrinters = [...new Set([
        ...Array.isArray(toolhead.printer_compatibility) ? toolhead.printer_compatibility : (toolhead.printer_compatibility && !PLACEHOLDER_VALUES.has(String(toolhead.printer_compatibility).toLowerCase().trim()) ? [String(toolhead.printer_compatibility)] : []),
        ...newPrinters,
      ])];
      const derivedBeltPaths = deriveBeltPaths(allPrinters);
      const { beltPaths: directBeltPaths, beltPathSources: directBeltSources } = findDirectBeltPaths(readmeText);
      const allFoundBeltPaths = [...new Set([...derivedBeltPaths, ...directBeltPaths])];
      const newBeltPaths = findNewSimple(allFoundBeltPaths, toolhead.belt_path);

      if (!newExtruders.length && !newHotends.length && !newProbes.length && !newBoards.length && !newHotendFans.length && !newPartCoolingFans.length && !newFilamentCutter && !newPrinters.length && !newBeltPaths.length) {
        continue;
      }

      const sources: Record<string, string> = {};
      for (const item of newExtruders) {
        sources[item] = trimmedExtruderSources[item] ?? "Unknown source";
      }
      for (const item of newHotends) {
        sources[item] = hotendMatchSources[item] ?? "Unknown source";
      }
      for (const item of newProbes) {
        sources[item] = probeSources[item] ?? "Unknown source";
      }
      for (const item of newBoards) {
        sources[item] = trimmedBoardSources[item] ?? "Unknown source";
      }
      for (const item of newHotendFans) {
        sources[`hotend_fan::${item}`] = hotendFanSources[item] ?? "Unknown source";
      }
      for (const item of newPartCoolingFans) {
        sources[`part_cooling_fan::${item}`] = partCoolingSources[item] ?? "Unknown source";
      }
      if (newFilamentCutter) {
        sources.filament_cutter = filamentCutterSource ?? "Unknown source";
      }
      for (const item of newPrinters) {
        sources[`printer::${item}`] = printerSources[item] ?? "Unknown source";
      }
      for (const item of newBeltPaths) {
        sources[`belt_path::${item}`] = directBeltSources[item] ?? "Derived from printer compatibility";
      }

      log(`Toolhead : ${name}`);
      const logSections: Array<[string, string[]]> = [
        ["Extruders", newExtruders],
        ["Hotends", newHotends],
        ["Probes", newProbes],
        ["Boards", newBoards],
        ["Hotend Fans", newHotendFans],
        ["Part Cooling Fans", newPartCoolingFans],
        ["Printers", newPrinters],
        ["Belt Paths", newBeltPaths],
      ];
      for (const [label, items] of logSections) {
        if (!items.length) {
          continue;
        }
        log(`  NEW ${label}: ${items.join(", ")}`);
      }
      if (newFilamentCutter) {
        log("  NEW Filament Cutter: supported");
      }

      const updated = stableClone(toolhead);
      if (newExtruders.length) {
        updated.extruders = mergeField(toolhead.extruders, newExtruders);
      }
      if (newHotends.length) {
        updated.hotend = mergeField(toolhead.hotend, newHotends);
      }
      if (newProbes.length) {
        updated.probe = mergeField(toolhead.probe, newProbes);
      }
      if (newBoards.length) {
        updated.boards = mergeField(toolhead.boards, newBoards);
      }
      if (newHotendFans.length) {
        updated[existingHotendFan.key] = mergeField(existingHotendFan.value, newHotendFans);
      }
      if (newPartCoolingFans.length) {
        updated[existingPartCoolingFan.key] = mergeField(existingPartCoolingFan.value, newPartCoolingFans);
      }
      if (newFilamentCutter) {
        updated.filament_cutter = "supported";
      }
      if (newPrinters.length) {
        updated.printer_compatibility = mergeField(toolhead.printer_compatibility, newPrinters);
      }
      if (newBeltPaths.length) {
        updated.belt_path = mergeField(toolhead.belt_path, newBeltPaths);
      }
      updatesNeeded.push(updated);
      results.push({
        name,
        new_extruders: newExtruders,
        new_hotends: newHotends,
        new_probes: newProbes,
        new_boards: newBoards,
        new_hotend_fans: newHotendFans,
        new_part_cooling_fans: newPartCoolingFans,
        new_filament_cutter: newFilamentCutter,
        new_printers: newPrinters,
        new_belt_paths: newBeltPaths,
        sources,
        updated,
        original: stableClone(toolhead),
      });
    }

    await Promise.all(updatedHashes.map(async ([url, hash]) => env.HASH_CACHE.put(hashKey(url), hash)));

    const finishedAt = new Date().toISOString();
    const changed = updatesNeeded.length > 0;
    const summary = changed
      ? `${updatesNeeded.length} toolhead(s) changed`
      : "No changes detected";

    if (changed) {
      log(`Updated entries prepared for ${updatesNeeded.length} toolhead(s)`);
    } else {
      log("No Updates Needed");
    }

    // Build full merged toolheads list: all toolheads from ToolheadBuilder with
    // updated entries replacing their corresponding originals, and any internal
    // metadata fields (_new_item_sources) stripped from every entry.
    const updatesMap = new Map(updatesNeeded.map((t) => [t.name, t]));
    const mergedToolheads = referenceData.toolheads.map((t) => {
      const entry = updatesMap.get(t.name) ?? t;
      const { _new_item_sources: _, ...clean } = entry as Record<string, unknown>;
      return clean as ToolheadEntry;
    });

    return {
      ok: true,
      trigger: options.trigger,
      recheck,
      startedAt,
      finishedAt,
      changed,
      changeCount: updatesNeeded.length,
      summary,
      results,
      updatedPayload: { toolheads: mergedToolheads },
      logs,
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    return {
      ok: false,
      trigger: options.trigger,
      recheck,
      startedAt,
      finishedAt,
      changed: false,
      changeCount: 0,
      summary: "Scan failed",
      results: [],
      updatedPayload: { toolheads: [] },
      logs,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function getToolheadNames(seed: unknown = toolheadsSeed): string[] {
  const toolheads = (seed as { toolheads?: ToolheadEntry[] }).toolheads ?? [];
  return toolheads.map((entry) => entry.name).filter(Boolean).sort((left, right) => left.localeCompare(right));
}

export async function loadEditorData(dataSourceBase?: string): Promise<{
  toolheads: ToolheadEntry[];
  extruderNames: string[];
  hotendNames: string[];
  probeNames: string[];
  extruders: NamedEntry[];
  hotends: NamedEntry[];
  probes: NamedEntry[];
  boards: string[];
  fans: string[];
  filamentCutterOptions: string[];
  categoryOptions: string[];
  printerOptions: string[];
  beltPathOptions: string[];
}> {
  const ref = await loadReferenceData(() => {}, dataSourceBase);
  const aliases = sanitizeAliases(aliasSeed);
  const boardNames = [...new Set(Object.values(aliases.boards))].sort();

  return {
    toolheads: ref.toolheads,
    extruderNames: ref.extruders.map((e) => e.name).sort(),
    hotendNames: ref.hotends.map((e) => e.name).sort(),
    probeNames: ref.probes.map((e) => e.name).sort(),
    extruders: ref.extruders,
    hotends: ref.hotends,
    probes: ref.probes,
    boards: boardNames,
    fans: FAN_PATTERNS.map(([name]) => name),
    filamentCutterOptions: ["native", "mod", "unknown", "unsupported"],
    categoryOptions: ["Printers for Ants", "Full Size Printers"],
    printerOptions: PRINTER_PATTERNS.map(([name]) => name).sort(),
    beltPathOptions: [...new Set([...Object.values(PRINTER_TO_BELT_PATH).filter((v) => v !== "unknown"), ...BELT_PATH_PATTERNS.map(([name]) => name)])].sort(),
  };
}

export interface SingleScanResult {
  extruders: string[];
  hotends: string[];
  probes: string[];
  boards: string[];
  hotend_fans: string[];
  part_cooling_fans: string[];
  filament_cutter: string | null;
  printer_compatibility: string[];
  belt_path: string[];
  sources: Record<string, string>;
}

export async function scanSingleToolhead(url: string): Promise<SingleScanResult> {
  const ref = await loadReferenceData(() => {}, undefined, true);
  const aliases = sanitizeAliases(aliasSeed);

  const trimmedUrl = url.trim();
  const isGitHub = trimmedUrl.includes("github.com");
  let readmeText: string | null = null;

  if (isGitHub) {
    const dummyTarget: ScanTarget = { name: "", url: trimmedUrl, source: "toolheads.json" };
    for (const candidate of githubContentCandidates(trimmedUrl, dummyTarget.source)) {
      readmeText = await fetchText(candidate);
      if (readmeText !== null) break;
    }
  } else if (trimmedUrl.startsWith("http://") || trimmedUrl.startsWith("https://")) {
    const rawResponse = await fetchText(trimmedUrl);
    if (rawResponse !== null) {
      readmeText = isHtmlContent(rawResponse) ? stripHtmlTags(rawResponse) : rawResponse;
    }
  }

  if (readmeText === null) {
    return {
      extruders: [], hotends: [], probes: [], boards: [],
      hotend_fans: [], part_cooling_fans: [],
      filament_cutter: null, printer_compatibility: [], belt_path: [],
      sources: {},
    };
  }

  const extruderTable = buildSearchTable(ref.extruders.map((e) => e.name), aliases.extruders);
  const hotendTable = buildSearchTable(ref.hotends.map((e) => e.name), aliases.hotends);
  const probeTable = buildSearchTable(ref.probes.map((e) => e.name), aliases.probes);
  const boardTable = buildBoardSearchTable(aliases.boards);

  const { foundNames: foundExtruders, foundSources: extruderSources } = findMatches(readmeText, extruderTable);
  const { foundNames: foundHotends, foundSources: hotendSources } = findMatches(readmeText, hotendTable);
  const { foundNames: foundProbes, foundSources: probeSources } = findMatches(readmeText, probeTable);
  const { foundNames: foundBoards, foundSources: boardSources } = findMatches(readmeText, boardTable);
  const { hotendFans, partCoolingFans, hotendSources: hotendFanSources, partCoolingSources } = findFans(readmeText);
  const filamentCutterSource = findFilamentCutterSource(readmeText);

  const filteredExtruders = foundExtruders.filter((e) => e.toLowerCase() !== "bmg");
  const filteredBoards = foundBoards.filter((e) => e.toLowerCase() !== "bmg");

  const normalizedExtruders = filteredExtruders.map((e) => (e === "HextrudORT" ? "Vz HextrudORT" : e));
  const dedupedExtruders = normalizedExtruders.filter((e, i) => normalizedExtruders.indexOf(e) === i);

  const { printers, printerSources } = findPrinters(readmeText, aliases.printers);
  const derivedBeltPaths = deriveBeltPaths(printers);
  const { beltPaths: directBeltPaths, beltPathSources: directBeltSources } = findDirectBeltPaths(readmeText);
  const allBeltPaths = [...new Set([...derivedBeltPaths, ...directBeltPaths])];

  const sources: Record<string, string> = {};
  for (const item of dedupedExtruders) sources[item] = extruderSources[item === "Vz HextrudORT" ? "HextrudORT" : item] ?? extruderSources[item] ?? "";
  for (const item of foundHotends) sources[item] = hotendSources[item] ?? "";
  for (const item of foundProbes) sources[item] = probeSources[item] ?? "";
  for (const item of filteredBoards) sources[item] = boardSources[item] ?? "";
  for (const item of hotendFans) sources[`hotend_fan::${item}`] = hotendFanSources[item] ?? "";
  for (const item of partCoolingFans) sources[`part_cooling_fan::${item}`] = partCoolingSources[item] ?? "";
  if (filamentCutterSource) sources.filament_cutter = filamentCutterSource;
  for (const item of printers) sources[`printer::${item}`] = printerSources[item] ?? "";
  for (const item of allBeltPaths) sources[`belt_path::${item}`] = directBeltSources[item] ?? "Derived from printer compatibility";

  return {
    extruders: dedupedExtruders,
    hotends: foundHotends,
    probes: foundProbes,
    boards: filteredBoards,
    hotend_fans: hotendFans,
    part_cooling_fans: partCoolingFans,
    filament_cutter: filamentCutterSource ? "supported" : null,
    printer_compatibility: printers,
    belt_path: allBeltPaths,
    sources,
  };
}