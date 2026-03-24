"""
scan_toolheads.py

Pipeline:
    1. Download README files from GitHub pages listed in data/toolheads.json
         and write them to toolhead_scan.temp.
    2. Parse each README for mentions of compatible hotends, extruders, probes,
         and toolhead boards using data/alias.json for name normalisation.
    3. Compare found items against the existing toolheads.json entries.
    4. Write Updated_Toolheads.json for any toolheads that have new information.
    5. Log a human-readable summary to the terminal.
    6. Delete toolhead_scan.temp.
"""

import json
import re
import urllib.request
import urllib.error
import hashlib
import sys
from copy import deepcopy
from pathlib import Path

BASE_DIR       = Path(__file__).parent
DATA_DIR       = BASE_DIR / "data"
DATA_FILE      = DATA_DIR / "toolheads.json"
EXTRUDERS_FILE = DATA_DIR / "extruders.json"
HOTENDS_FILE   = DATA_DIR / "hotends.json"
PROBES_FILE    = DATA_DIR / "probes.json"
ALIAS_FILE     = DATA_DIR / "alias.json"
TEMP_FILE      = BASE_DIR / "toolhead_scan.temp"
OUTPUT_FILE    = BASE_DIR / "Updated_Toolheads.json"
HASH_FILE      = BASE_DIR / "Last Updated.json"
EXTRA_GITHUB_FILE = BASE_DIR / "extra_github_locations.json"

BRANCH_CANDIDATES  = ["main", "master"]
PLACEHOLDER_VALUES = {"unknown", "unknow", "other", "na", "n/a", "none", ""}

# Upstream data source
DATA_SOURCE_BASE = ("https://raw.githubusercontent.com/"
                    "SartorialGrunt0/ToolheadBuilder/main/src/data")
DATA_FILES_TO_SYNC = {
    "extruders.json": EXTRUDERS_FILE,
    "hotends.json":   HOTENDS_FILE,
    "probes.json":    PROBES_FILE,
    "toolheads.json": DATA_FILE,
}

FAN_PATTERNS = [
    ("CPAP", [r"\bcpap\b", r"\b7040\b", r"\b70\s*[xX]\s*40\b"]),
    ("5015", [r"\b5015\b"]),
    ("4010", [r"\b4010\b"]),
    ("4020", [r"\b4020\b"]),
    ("4015", [r"\b4015\b"]),
    ("3010", [r"\b3010\b"]),
    ("3007", [r"\b3007\b"]),
    ("2510", [r"\b2510\b"]),
]

PART_COOLING_CONTEXT_PATTERNS = [
    r"\bpart\s*cool(?:ing)?\b",
    r"\bblower\b",
    r"\bcpap\b",
    r"\bduct\b",
    r"\bradial\b",
]

HOTEND_CONTEXT_PATTERNS = [
    r"\bhot\s*end\b",
    r"\bhotend\b",
    r"\bheatsink\b",
    r"\bheat\s*break\b",
    r"\baxial\b",
]

FILAMENT_CUTTER_PATTERNS = [
    r"\bfilament\s*cutter\b",
    r"\bcutter\b.{0,24}\bfilament\b",
    r"\bfilament\b.{0,24}\bcutter\b",
    r"\bercf\b.{0,24}\bcutter\b",
]


def github_raw_readme_urls(github_url):
    # Strip trailing slash / .git
    url = github_url.rstrip("/").removesuffix(".git")

    # Pattern: .../tree/<branch>/path  or  .../blob/<branch>/path
    tree_match = re.search(
        r"github\.com/([^/]+)/([^/]+)/(?:tree|blob)/([^/]+)(?:/(.*))?", url
    )
    if tree_match:
        owner, repo, branch, subpath = tree_match.groups()
        subpath = subpath or ""
        base = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}"
        prefix = f"{subpath}/" if subpath else ""
        return [
            f"{base}/{prefix}README.md",
            f"{base}/{prefix}readme.md",
        ]

    # Pattern: base repo URL  https://github.com/owner/repo
    repo_match = re.search(r"github\.com/([^/]+)/([^/]+)$", url)
    if repo_match:
        owner, repo = repo_match.groups()
        urls = []
        for branch in BRANCH_CANDIDATES:
            base = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}"
            urls += [f"{base}/README.md", f"{base}/readme.md"]
        return urls

    return []


def github_raw_file_url(github_url):
    """Convert a GitHub URL to a direct raw content URL when possible."""
    url = github_url.rstrip("/").removesuffix(".git")

    # Pattern: .../blob/<branch>/path/to/file
    blob_match = re.search(r"github\.com/([^/]+)/([^/]+)/blob/([^/]+)/(.*)$", url)
    if blob_match:
        owner, repo, branch, file_path = blob_match.groups()
        return f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{file_path}"

    # Pattern: .../tree/<branch>/path/to/file_or_dir
    tree_match = re.search(r"github\.com/([^/]+)/([^/]+)/tree/([^/]+)/(.*)$", url)
    if tree_match:
        owner, repo, branch, path = tree_match.groups()
        return f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"

    # Already a raw file URL
    if "raw.githubusercontent.com" in url:
        return url

    return None


def github_content_candidates(github_url, source_file):
    """Build candidate raw-content URLs for a target location.

    For extra_github_locations entries we try direct file content first,
    then fall back to README discovery if needed.
    """
    candidates = []

    if source_file == "extra_github_locations.json":
        direct_raw = github_raw_file_url(github_url)
        if direct_raw:
            candidates.append(direct_raw)

    candidates.extend(github_raw_readme_urls(github_url))

    # Deduplicate while preserving order.
    seen = set()
    return [u for u in candidates if not (u in seen or seen.add(u))]


def fetch_text(url: str, timeout: int = 15) -> str | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ToolheadScanner/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                return resp.read().decode("utf-8", errors="replace")
    except (urllib.error.HTTPError, urllib.error.URLError):
        pass
    return None


# ── Reference-data loading ─────────────────────────────────────────────────────

def sync_data_files(log=print):
    """Download latest data files from the ToolheadBuilder repo."""
    log("Syncing data files from ToolheadBuilder ...")
    for filename, local_path in DATA_FILES_TO_SYNC.items():
        url = f"{DATA_SOURCE_BASE}/{filename}"
        content = fetch_text(url)
        if content is None:
            log(f"  [FAIL]  Could not download {filename}")
            continue
        # Validate it's proper JSON before overwriting
        try:
            json.loads(content)
        except json.JSONDecodeError:
            log(f"  [FAIL]  {filename} is not valid JSON, skipping")
            continue
        local_path.write_text(content, encoding="utf-8")
        log(f"  [OK]    {filename}")
    log("")


def load_reference_names():
    with open(EXTRUDERS_FILE, encoding="utf-8") as f:
        extruder_names = [e["name"] for e in json.load(f)["extruders"]]
    with open(HOTENDS_FILE, encoding="utf-8") as f:
        hotend_names   = [h["name"] for h in json.load(f)["hotends"]]
    with open(PROBES_FILE, encoding="utf-8") as f:
        probe_names    = [p["name"] for p in json.load(f)["probes"]]
    return extruder_names, hotend_names, probe_names


def load_aliases():
    if ALIAS_FILE.exists():
        with open(ALIAS_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return {k: v for k, v in data.items() if not k.startswith("_")}
    return {"extruders": {}, "hotends": {}, "probes": {}, "boards": {}}


def load_extra_locations():
    """Load optional user-provided extra GitHub locations."""
    if not EXTRA_GITHUB_FILE.exists():
        return []
    try:
        with open(EXTRA_GITHUB_FILE, encoding="utf-8") as f:
            data = json.load(f)
        entries = data.get("extra_locations", [])
        cleaned = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            toolhead = str(entry.get("toolhead", "")).strip()
            url = str(entry.get("url", "")).strip()
            if toolhead and url:
                cleaned.append({"toolhead": toolhead, "url": url})
        return cleaned
    except (json.JSONDecodeError, OSError):
        return []


def save_extra_locations(locations):
    """Persist extra GitHub locations to disk."""
    with open(EXTRA_GITHUB_FILE, "w", encoding="utf-8") as f:
        json.dump({"extra_locations": locations}, f, indent=2)


def add_extra_location(toolhead, url):
    """Add an extra GitHub location and associate it with a toolhead."""
    toolhead = str(toolhead).strip()
    url = str(url).strip()
    if not toolhead:
        raise ValueError("Toolhead name is required")
    if "github.com" not in url:
        raise ValueError("URL must be a GitHub URL")

    existing = load_extra_locations()
    for entry in existing:
        if entry["toolhead"].lower() == toolhead.lower() and entry["url"] == url:
            return False

    existing.append({"toolhead": toolhead, "url": url})
    save_extra_locations(existing)
    return True


def get_toolhead_names():
    with open(DATA_FILE, encoding="utf-8") as f:
        toolheads_data = json.load(f)
    return sorted(t["name"] for t in toolheads_data.get("toolheads", []) if "name" in t)


def build_scan_targets(toolheads, extra_locations, log=print):
    """Build URL targets from toolheads.json + extra_github_locations.json."""
    targets = []
    for toolhead in toolheads:
        targets.append({
            "name": toolhead.get("name", "Unknown"),
            "url": toolhead.get("url", "").strip(),
            "source": "toolheads.json",
        })

    for entry in extra_locations:
        targets.append({
            "name": entry["toolhead"],
            "url": entry["url"],
            "source": "extra_github_locations.json",
        })

    if extra_locations:
        log(f"Loaded {len(extra_locations)} extra GitHub location(s)")
    return targets


# ── Search-table construction ──────────────────────────────────────────────────
def build_search_table(canonical_names, alias_map):
    entries = {}
    for name in canonical_names:
        entries[name.lower()] = name
    for alias, canonical in alias_map.items():
        entries[alias.lower()] = canonical
    return sorted(entries.items(), key=lambda x: len(x[0]), reverse=True)


def build_board_search_table(board_alias_map):
    entries = {}
    for alias, canonical in board_alias_map.items():
        entries[alias.lower()] = canonical
    return sorted(entries.items(), key=lambda x: len(x[0]), reverse=True)


# ── README download phase ──────────────────────────────────────────────────────
def download_readmes(scan_targets, hash_cache, skip_unchanged=True, log=print):
    """Download text content for scan targets, optionally skipping unchanged ones."""
    blocks = []
    updated_hashes = {}
    sep = "=" * 72
    
    for target in scan_targets:
        name = target.get("name", "Unknown")
        url  = target.get("url", "").strip()
        source_file = target.get("source", "toolheads.json")
        if "github.com" not in url:
            log(f"  [SKIP]  {name}  (not a GitHub URL)")
            blocks.append(f"{sep}\nTOOLHEAD: {name}\nURL: {url}\nSTATUS: Not a GitHub URL\n{sep}\n\n")
            continue
        
        readme_text = fetched_from = None
        for candidate in github_content_candidates(url, source_file):
            text = fetch_text(candidate)
            if text is not None:
                readme_text  = text
                fetched_from = candidate
                break
        
        if readme_text is None:
            log(f"  [FAIL]  {name}  (no README found)")
            blocks.append(f"{sep}\nTOOLHEAD: {name}\nURL: {url}\nSTATUS: README not found\n{sep}\n\n")
        else:
            # Calculate and potentially skip based on hash
            current_hash = get_content_hash(readme_text)
            updated_hashes[url] = current_hash
            
            if skip_unchanged and should_skip_readme(url, readme_text, hash_cache):
                log(f"  [SKIP]  {name}  (README unchanged)")
                blocks.append(f"{sep}\nTOOLHEAD: {name}\nURL: {url}\nSTATUS: README unchanged, skipping parse\n{sep}\n\n")
            else:
                log(f"  [OK]    {name}")
                blocks.append(
                    f"{sep}\nTOOLHEAD: {name}\nURL: {url}\nSOURCE FILE: {source_file}\nREADME SOURCE: {fetched_from}\n{sep}\n\n"
                    f"{readme_text}\n\n"
                )
    
    TEMP_FILE.write_text("\n".join(blocks), encoding="utf-8")
    return updated_hashes


# ── Temp-file parsing ──────────────────────────────────────────────────────────
def parse_temp_file(temp_path):
    text   = temp_path.read_text(encoding="utf-8")
    pieces = re.split(r"={72}\n", text)
    result = {}
    i = 0
    while i < len(pieces):
        piece        = pieces[i]
        name_match   = re.search(r"^TOOLHEAD:\s*(.+)$", piece, re.MULTILINE)
        status_match = re.search(r"^STATUS:",            piece, re.MULTILINE)
        if name_match and not status_match:
            name         = name_match.group(1).strip()
            content      = pieces[i + 1] if i + 1 < len(pieces) else ""
            if name in result:
                result[name] += "\n\n" + content
            else:
                result[name] = content
            i += 2
        else:
            i += 1
    return result


def _is_part_cooling_context(local_text):
    return any(
        re.search(pattern, local_text, flags=re.IGNORECASE)
        for pattern in PART_COOLING_CONTEXT_PATTERNS
    )


def _is_hotend_context(local_text):
    return any(
        re.search(pattern, local_text, flags=re.IGNORECASE)
        for pattern in HOTEND_CONTEXT_PATTERNS
    )


def find_fans(text):
    """Find hotend and part-cooling fan mentions with source tracking."""
    hotend_fans = []
    part_cooling_fans = []
    hotend_sources = {}
    part_cooling_sources = {}

    for line in text.splitlines():
        line_lower = line.lower()
        context_is_fan = any(word in line_lower for word in ["fan", "blower", "cpap", "axial"])

        for canonical, patterns in FAN_PATTERNS:
            for pattern in patterns:
                for match in re.finditer(pattern, line, flags=re.IGNORECASE):
                    # For numeric fan sizes, require some fan context on the line.
                    if canonical != "CPAP" and not context_is_fan:
                        continue

                    start = max(0, match.start() - 48)
                    end = min(len(line), match.end() + 48)
                    local_context = line[start:end]

                    is_part = _is_part_cooling_context(local_context)
                    is_hotend = _is_hotend_context(local_context)

                    if is_part and canonical not in part_cooling_fans:
                        part_cooling_fans.append(canonical)
                        part_cooling_sources[canonical] = line.strip()

                    if is_hotend and canonical not in hotend_fans:
                        hotend_fans.append(canonical)
                        hotend_sources[canonical] = line.strip()

                    # CPAP should map to part cooling when no explicit context is present.
                    if canonical == "CPAP" and not is_part and not is_hotend:
                        if canonical not in part_cooling_fans:
                            part_cooling_fans.append(canonical)
                            part_cooling_sources[canonical] = line.strip()

                    # If no specific context is present for a non-CPAP fan, ignore it.
                    break
                else:
                    continue
                break

    return hotend_fans, part_cooling_fans, hotend_sources, part_cooling_sources


def find_filament_cutter_source(text):
    """Return the first line that indicates filament cutter support."""
    for line in text.splitlines():
        for pattern in FILAMENT_CUTTER_PATTERNS:
            if re.search(pattern, line, flags=re.IGNORECASE):
                return line.strip()
    return None


def find_new_simple(found_items, existing_value):
    """Find new items without alias-canonical lookup."""
    existing_norm = normalize_field(existing_value)
    return [item for item in found_items if item.lower() not in existing_norm]


def get_existing_fan_field(toolhead, plural_key, singular_key):
    """Read fan data from either plural or singular schema keys."""
    if plural_key in toolhead:
        return toolhead.get(plural_key), plural_key
    return toolhead.get(singular_key), singular_key


# ── Text matching ──────────────────────────────────────────────────────────────
def find_matches(text, search_table):
    """Find matches with word boundaries and source tracking."""
    text_lower  = text.lower()
    found_lower = set()
    found_names = []
    found_sources = {}
    matched_spans = []
    
    for term_lower, canonical in search_table:
        # Skip "bmg" term completely
        if term_lower.lower() == "bmg":
            continue
            
        pattern = r"\b" + re.escape(term_lower) + r"\b"

        for match in re.finditer(pattern, text_lower):
            span_start, span_end = match.start(), match.end()
            overlaps = any(span_start < end and span_end > start for start, end in matched_spans)
            if overlaps:
                continue

            key = canonical.lower()
            if key in found_lower:
                break

            found_lower.add(key)
            found_names.append(canonical)
            matched_spans.append((span_start, span_end))

            # Store the full source line containing the first accepted match.
            line_start = max(0, text_lower.rfind('\n', 0, span_start) + 1)
            line_end = text_lower.find('\n', span_end)
            if line_end == -1:
                line_end = len(text_lower)
            found_sources[canonical] = text[line_start:line_end].strip()
            break
    
    return found_names, found_sources


# ── Comparison helpers ─────────────────────────────────────────────────────────
def normalize_field(value):
    if value is None:
        return set()
    if isinstance(value, list):
        return {
            v.lower().strip()
            for v in value
            if isinstance(v, str) and v.lower().strip() not in PLACEHOLDER_VALUES
        }
    if isinstance(value, str):
        v = value.lower().strip()
        return set() if v in PLACEHOLDER_VALUES else {v}
    return set()


def canonical_lookup(values, search_table):
    reverse_map = {term: canonical.lower() for term, canonical in search_table}
    return {reverse_map.get(v, v) for v in values}


def find_new_items(found_canonicals, existing_field_value, search_table):
    existing_norm  = normalize_field(existing_field_value)
    existing_canon = canonical_lookup(existing_norm, search_table)
    return [item for item in found_canonicals if item.lower() not in existing_canon]


# ── Merging helpers ────────────────────────────────────────────────────────────
def merge_field(existing, new_items):
    if not new_items:
        return existing
    if existing is None or (
        isinstance(existing, str) and existing.lower().strip() in PLACEHOLDER_VALUES
    ):
        return new_items if len(new_items) > 1 else new_items[0]
    existing_list = existing if isinstance(existing, list) else [existing]
    return existing_list + new_items

# ── Hash tracking for README changes ───────────────────────────────────────────
def load_hash_cache():
    """Load previously cached README hashes."""
    if HASH_FILE.exists():
        with open(HASH_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_hash_cache(hash_cache):
    """Save README hashes to file."""
    with open(HASH_FILE, "w", encoding="utf-8") as f:
        json.dump(hash_cache, f, indent=2)


def get_content_hash(content: str) -> str:
    """Calculate SHA256 hash of content."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def should_skip_readme(url: str, content: str, hash_cache: dict) -> bool:
    """Check if README content hasn't changed since last run."""
    current_hash = get_content_hash(content)
    cached_hash = hash_cache.get(url)
    return cached_hash == current_hash


# ── Core scan logic ────────────────────────────────────────────────────────────
def run_scan(recheck=False, log=print):
    """Run the full scan pipeline.

    Args:
        recheck: If True, ignore hash cache and re-parse all READMEs.
        log:     Callable(str) for status messages.

    Returns:
        A list of dicts, one per toolhead with updates.  Each dict has:
            name, new_extruders, new_hotends, new_probes, new_boards,
            new_hotend_fans, new_part_cooling_fans,
            sources  (item -> readme line),
            updated  (full merged toolhead dict).
        Returns an empty list when nothing changed.
    """
    skip_unchanged = not recheck
    if recheck:
        log("[INFO] Rechecking all READMEs\n")

    # Update data files from upstream
    sync_data_files(log=log)

    hash_cache = load_hash_cache()

    extruder_names, hotend_names, probe_names = load_reference_names()
    aliases = load_aliases()

    extruder_table = build_search_table(extruder_names, aliases.get("extruders", {}))
    hotend_table   = build_search_table(hotend_names,   aliases.get("hotends",   {}))
    probe_table    = build_search_table(probe_names,    aliases.get("probes",    {}))
    board_table    = build_board_search_table(          aliases.get("boards",    {}))

    with open(DATA_FILE, encoding="utf-8") as f:
        toolheads_data = json.load(f)
    toolheads    = toolheads_data["toolheads"]
    toolhead_map = {t["name"]: t for t in toolheads}
    extra_locations = load_extra_locations()
    scan_targets = build_scan_targets(toolheads, extra_locations, log=log)

    # Wipe output file at the start of each run
    if OUTPUT_FILE.exists():
        OUTPUT_FILE.unlink()

    log(f"Downloading READMEs for {len(scan_targets)} source location(s) ...")
    updated_hashes = download_readmes(scan_targets, hash_cache,
                                      skip_unchanged=skip_unchanged, log=log)
    log("")

    readme_blocks = parse_temp_file(TEMP_FILE)

    results        = []   # structured results for UI
    updates_needed = []

    for name, readme_text in readme_blocks.items():
        toolhead = toolhead_map.get(name)
        if not toolhead:
            continue

        found_extruders, ext_sources = find_matches(readme_text, extruder_table)
        found_hotends, hotend_sources = find_matches(readme_text, hotend_table)
        found_probes, probe_sources = find_matches(readme_text, probe_table)
        found_boards, board_sources = find_matches(readme_text, board_table)
        found_hotend_fans, found_part_cooling_fans, hotend_fan_sources, part_cooling_fan_sources = find_fans(readme_text)
        filament_cutter_source = find_filament_cutter_source(readme_text)

        # Filter out "BMG"
        found_extruders = [e for e in found_extruders if e.lower() != "bmg"]
        ext_sources = {k: v for k, v in ext_sources.items() if k.lower() != "bmg"}
        found_boards = [b for b in found_boards if b.lower() != "bmg"]
        board_sources = {k: v for k, v in board_sources.items() if k.lower() != "bmg"}

        # Treat bare "HextrudORT" as "Vz HextrudORT"
        found_extruders = ["Vz HextrudORT" if e == "HextrudORT" else e for e in found_extruders]
        if "HextrudORT" in ext_sources:
            ext_sources.setdefault("Vz HextrudORT", ext_sources.pop("HextrudORT"))

        # Deduplicate while preserving order
        seen = set()
        found_extruders = [x for x in found_extruders if not (x in seen or seen.add(x))]

        new_extruders = find_new_items(found_extruders, toolhead.get("extruders"), extruder_table)
        new_hotends   = find_new_items(found_hotends,   toolhead.get("hotend"),    hotend_table)
        new_probes    = find_new_items(found_probes,    toolhead.get("probe"),     probe_table)
        new_boards    = find_new_items(found_boards,    toolhead.get("boards"),    board_table)
        existing_hotend_fan, hotend_fan_key = get_existing_fan_field(
            toolhead, "hotend_fans", "hotend_fan"
        )
        existing_part_fan, part_fan_key = get_existing_fan_field(
            toolhead, "part_cooling_fans", "part_cooling_fan"
        )

        new_hotend_fans = find_new_simple(found_hotend_fans, existing_hotend_fan)
        new_part_cooling_fans = find_new_simple(found_part_cooling_fans, existing_part_fan)

        existing_cutter = str(toolhead.get("filament_cutter", "")).lower().strip()
        new_filament_cutter = bool(
            filament_cutter_source and existing_cutter in PLACEHOLDER_VALUES
        )

        if not any([
            new_extruders,
            new_hotends,
            new_probes,
            new_boards,
            new_hotend_fans,
            new_part_cooling_fans,
            new_filament_cutter,
        ]):
            continue

        # Build source map for new items
        name_sources = {}
        for item in new_extruders:
            name_sources[item] = ext_sources.get(item, "Unknown source")
        for item in new_hotends:
            name_sources[item] = hotend_sources.get(item, "Unknown source")
        for item in new_probes:
            name_sources[item] = probe_sources.get(item, "Unknown source")
        for item in new_boards:
            name_sources[item] = board_sources.get(item, "Unknown source")
        for item in new_hotend_fans:
            name_sources[f"hotend_fan::{item}"] = hotend_fan_sources.get(item, "Unknown source")
        for item in new_part_cooling_fans:
            name_sources[f"part_cooling_fan::{item}"] = part_cooling_fan_sources.get(item, "Unknown source")
        if new_filament_cutter:
            name_sources["filament_cutter"] = filament_cutter_source or "Unknown source"

        # Log to console/UI
        log(f"Toolhead : {name}")
        for label, items in [("Extruders", new_extruders), ("Hotends", new_hotends),
                             ("Probes", new_probes), ("Boards", new_boards),
                             ("Hotend Fans", new_hotend_fans),
                             ("Part Cooling Fans", new_part_cooling_fans)]:
            if items:
                log(f"  NEW {label:10s}: {', '.join(items)}")
                for item in items:
                    if label == "Hotend Fans":
                        source_key = f"hotend_fan::{item}"
                    elif label == "Part Cooling Fans":
                        source_key = f"part_cooling_fan::{item}"
                    else:
                        source_key = item
                    log(f"    -> From: {name_sources.get(source_key, 'Unknown')}")
        if new_filament_cutter:
            log("  NEW Filament Cutter: supported")
            log(f"    -> From: {name_sources.get('filament_cutter', 'Unknown')}")

        updated = deepcopy(toolhead)
        if new_extruders:
            updated["extruders"] = merge_field(toolhead.get("extruders"), new_extruders)
        if new_hotends:
            updated["hotend"]    = merge_field(toolhead.get("hotend"),    new_hotends)
        if new_probes:
            updated["probe"]     = merge_field(toolhead.get("probe"),     new_probes)
        if new_boards:
            updated["boards"]    = merge_field(toolhead.get("boards"),    new_boards)
        if new_hotend_fans:
            updated[hotend_fan_key] = merge_field(existing_hotend_fan, new_hotend_fans)
        if new_part_cooling_fans:
            updated[part_fan_key] = merge_field(existing_part_fan, new_part_cooling_fans)
        if new_filament_cutter:
            updated["filament_cutter"] = "supported"
        updated["_new_item_sources"] = name_sources
        updates_needed.append(updated)

        results.append({
            "name":           name,
            "new_extruders":  new_extruders,
            "new_hotends":    new_hotends,
            "new_probes":     new_probes,
            "new_boards":     new_boards,
            "new_hotend_fans": new_hotend_fans,
            "new_part_cooling_fans": new_part_cooling_fans,
            "new_filament_cutter": new_filament_cutter,
            "sources":        name_sources,
            "updated":        updated,
            "original":       toolhead,
        })

    if updates_needed:
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump({"toolheads": updates_needed}, f, indent=2)
        log(f"\nUpdated entries written to: {OUTPUT_FILE}")
    else:
        log("No Updates Needed")

    # Update and save hash cache
    hash_cache.update(updated_hashes)
    save_hash_cache(hash_cache)

    TEMP_FILE.unlink(missing_ok=True)
    log(f"[Saved hash cache to {HASH_FILE.name}]")

    return results


# ── CLI entry point ────────────────────────────────────────────────────────────
def main():
    recheck = "--recheck" in sys.argv

    def cli_log(msg):
        try:
            print(msg)
        except UnicodeEncodeError:
            safe = str(msg).encode("ascii", errors="replace").decode("ascii")
            print(safe)

    run_scan(recheck=recheck, log=cli_log)


if __name__ == "__main__":
    main()
