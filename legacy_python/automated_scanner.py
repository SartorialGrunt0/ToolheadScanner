"""
automated_scanner.py

Runs the toolhead scanner on a schedule and emails a summary when changes
are detected.  Uses Gmail SMTP by default.

Configuration is loaded from environment variables (or a .env file in the
same directory).  See .env.example for the full list.

Usage:
    python automated_scanner.py              # run loop (default: once per day)
    python automated_scanner.py --once       # run a single scan then exit
"""

import os
import sys
import time
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
from pathlib import Path

import scan_toolheads

# ── Logging ────────────────────────────────────────────────────────────────────

LOG_DIR = Path(__file__).parent / "logs"
LOG_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    handlers=[
        logging.FileHandler(LOG_DIR / "automated_scanner.log", encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("automated_scanner")

# ── .env loader (no third-party deps) ─────────────────────────────────────────

def load_dotenv(path: Path | None = None):
    """Read a .env file and inject its values into os.environ."""
    env_path = path or Path(__file__).parent / ".env"
    if not env_path.exists():
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip("\"'")
            os.environ.setdefault(key, value)


load_dotenv()

# ── Configuration ─────────────────────────────────────────────────────────────

SMTP_SERVER   = os.environ.get("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT     = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER     = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")       # Gmail App Password
EMAIL_TO      = os.environ.get("EMAIL_TO", SMTP_USER)     # default: send to self
EMAIL_FROM    = os.environ.get("EMAIL_FROM", SMTP_USER)

# How often to run, in hours.  Default = 24 (once per day).
SCAN_INTERVAL_HOURS = float(os.environ.get("SCAN_INTERVAL_HOURS", "24"))


# ── Email formatting ──────────────────────────────────────────────────────────

def _field_as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value]
    return [str(value)]


def build_email_body(results: list[dict]) -> tuple[str, str]:
    """Return (plain_text, html) email body from scan results."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    # ── Plain text ─────────────────────────────────────────────────────────
    lines = [
        f"Toolhead Scanner – changes detected at {now}",
        f"{'=' * 56}",
        f"{len(results)} toolhead(s) with updates:\n",
    ]

    for entry in results:
        name = entry["name"]
        lines.append(f"  {name}")
        lines.append(f"  {'-' * len(name)}")

        sections = [
            ("Extruders",          entry["new_extruders"]),
            ("Hotends",            entry["new_hotends"]),
            ("Probes",             entry["new_probes"]),
            ("Boards",             entry["new_boards"]),
            ("Hotend Fans",        entry.get("new_hotend_fans", [])),
            ("Part Cooling Fans",  entry.get("new_part_cooling_fans", [])),
        ]
        for label, items in sections:
            if items:
                lines.append(f"    NEW {label}: {', '.join(items)}")

        if entry.get("new_filament_cutter"):
            lines.append("    NEW Filament Cutter: supported")

        lines.append("")

    plain = "\n".join(lines)

    # ── HTML ───────────────────────────────────────────────────────────────
    html_parts = [
        "<html><body style='font-family:Consolas,monospace;font-size:14px;'>",
        f"<h2>Toolhead Scanner &mdash; changes detected</h2>",
        f"<p style='color:#888;'>{now}</p>",
        f"<p><strong>{len(results)}</strong> toolhead(s) with updates:</p>",
    ]

    for entry in results:
        name = entry["name"]
        html_parts.append(f"<h3 style='color:#61afef;'>{name}</h3>")
        html_parts.append("<table style='border-collapse:collapse;margin-left:16px;'>")

        sections = [
            ("Extruders",          entry["new_extruders"]),
            ("Hotends",            entry["new_hotends"]),
            ("Probes",             entry["new_probes"]),
            ("Boards",             entry["new_boards"]),
            ("Hotend Fans",        entry.get("new_hotend_fans", [])),
            ("Part Cooling Fans",  entry.get("new_part_cooling_fans", [])),
        ]
        for label, items in sections:
            if items:
                html_parts.append(
                    f"<tr>"
                    f"<td style='padding:2px 12px 2px 0;color:#c678dd;'>{label}</td>"
                    f"<td style='color:#98c379;'>{', '.join(items)}</td>"
                    f"</tr>"
                )

        if entry.get("new_filament_cutter"):
            html_parts.append(
                "<tr>"
                "<td style='padding:2px 12px 2px 0;color:#c678dd;'>Filament Cutter</td>"
                "<td style='color:#98c379;'>supported</td>"
                "</tr>"
            )

        html_parts.append("</table>")

    html_parts.append("</body></html>")
    html = "\n".join(html_parts)

    return plain, html


# ── Email sending ─────────────────────────────────────────────────────────────

def send_email(results: list[dict]):
    """Send a single consolidated email for all changed toolheads."""
    if not SMTP_USER or not SMTP_PASSWORD:
        log.error("SMTP_USER or SMTP_PASSWORD not set – skipping email")
        return False

    plain, html = build_email_body(results)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Toolhead Scanner: {len(results)} toolhead(s) changed"
    msg["From"]    = EMAIL_FROM
    msg["To"]      = EMAIL_TO
    msg.attach(MIMEText(plain, "plain"))
    msg.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT, timeout=30) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(EMAIL_FROM, [EMAIL_TO], msg.as_string())
        log.info("Email sent to %s", EMAIL_TO)
        return True
    except Exception:
        log.exception("Failed to send email")
        return False


# ── Single scan cycle ─────────────────────────────────────────────────────────

def run_once():
    """Execute one scan cycle. Returns True if changes were found."""
    log.info("Starting scan cycle")
    try:
        results = scan_toolheads.run_scan(recheck=False, log=lambda m: log.info(m))
    except Exception:
        log.exception("Scan failed")
        return False

    if not results:
        log.info("No changes detected – no email sent")
        return False

    log.info("Changes detected in %d toolhead(s) – sending email", len(results))
    send_email(results)
    return True


# ── Scheduler loop ────────────────────────────────────────────────────────────

def run_loop():
    interval_seconds = SCAN_INTERVAL_HOURS * 3600
    log.info(
        "Automated scanner started – interval: %.1f hour(s)",
        SCAN_INTERVAL_HOURS,
    )

    while True:
        run_once()
        next_run = datetime.now().timestamp() + interval_seconds
        next_str = datetime.fromtimestamp(next_run).strftime("%Y-%m-%d %H:%M:%S")
        log.info("Next scan at %s", next_str)
        try:
            time.sleep(interval_seconds)
        except KeyboardInterrupt:
            log.info("Shutting down")
            break


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if "--once" in sys.argv:
        run_once()
    else:
        run_loop()
