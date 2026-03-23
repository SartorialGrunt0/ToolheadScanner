# ToolheadScanner

A tool for toolhead builders to check for changes to documents and parse for missing content.

---

## Table of Contents

- [GUI Tool](#gui-tool)
- [Automated Scanner](#automated-scanner)
  - [Email Setup (.env)](#email-setup-env)
  - [Running on Windows](#running-on-windows)
  - [Running on Linux](#running-on-linux)

---

## GUI Tool

The GUI lets you manually trigger scans, view results, and manage extra GitHub locations.

**Requirements:** Python 3.11+ with Tkinter (included in all standard Python installers).

### Start the GUI

**Windows**
```bat
python scanner_ui.py
```

**Linux**
```bash
python3 scanner_ui.py
```

> If Tkinter is missing on Linux, install it with:
> ```bash
> sudo apt install python3-tk   # Debian/Ubuntu
> sudo dnf install python3-tkinter  # Fedora
> ```

### GUI Features

| Button | What it does |
|---|---|
| **Update Toolheads** | Scan only toolheads whose README has changed since the last run |
| **Update (Recheck All)** | Force-rescan every toolhead, ignoring the hash cache |
| **Refresh Toolheads** | Reload the toolhead list from `data/toolheads.json` |
| **View: Parsed / View: JSON** | Toggle the results panel between a human-readable view and the raw JSON output |
| **Add Location** | Associate an extra GitHub URL with a toolhead for scanning |

Results are shown in the right panel. New items are highlighted in green. Click **View: JSON** to copy the raw updated JSON for pasting back into `data/toolheads.json`.

---

## Automated Scanner

`automated_scanner.py` runs the scanner on a schedule and emails you a summary whenever changes are detected. It uses Gmail SMTP by default and requires no third-party packages.

### Email Setup (.env)

1. Copy the example file:

   **Windows**
   ```bat
   copy .env.example .env
   ```
   **Linux**
   ```bash
   cp .env.example .env
   ```

2. Open `.env` and fill in your values:

   ```env
   SMTP_SERVER=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=you@gmail.com
   SMTP_PASSWORD=your-app-password-here
   EMAIL_TO=you@gmail.com
   EMAIL_FROM=you@gmail.com

   # How often to scan, in hours (default: 24)
   SCAN_INTERVAL_HOURS=24
   ```

3. **Gmail users:** `SMTP_PASSWORD` must be a [Gmail App Password](https://myaccount.google.com/apppasswords), **not** your regular account password. Enable 2-factor authentication on your Google account first, then generate an App Password for "Mail".

> **Security note:** `.env` is listed in `.gitignore` and will never be committed to the repository.

### Send a test email

Before running the full schedule, verify your credentials work:

```bash
python automated_scanner.py --once
```

This runs one scan cycle immediately. If changes are detected, the email is sent. To force a test email without waiting for real changes, see [Troubleshooting](#troubleshooting) below.

---

### Running on Windows

#### Option A – Run manually in a terminal

```bat
python automated_scanner.py
```

The script loops indefinitely, scanning every `SCAN_INTERVAL_HOURS` hours. Keep the window open or run it minimised.

#### Option B – Run as a scheduled background task (recommended)

Use **Windows Task Scheduler** to launch the scanner automatically, even when no terminal is open.

1. Open **Task Scheduler** → **Create Basic Task**
2. **Name:** `ToolheadScanner`
3. **Trigger:** Daily → set your preferred time
4. **Action:** Start a program
   - **Program/script:** full path to your Python executable, e.g.
     `C:\git\ToolheadScanner\.venv\Scripts\python.exe`
   - **Add arguments:** `automated_scanner.py --once`
   - **Start in:** `C:\git\ToolheadScanner`
5. Finish the wizard, then right-click the new task → **Properties** → **General** → tick **Run whether user is logged on or not**

Using `--once` with Task Scheduler is the cleanest approach — Windows handles the scheduling and the script exits cleanly after each run.

---

### Running on Linux

#### Option A – Run manually

```bash
python3 automated_scanner.py
```

#### Option B – Run as a systemd service (persistent loop)

Create a service file at `/etc/systemd/system/toolheadscanner.service`:

```ini
[Unit]
Description=Toolhead Scanner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/path/to/ToolheadScanner
ExecStart=/path/to/ToolheadScanner/.venv/bin/python3 automated_scanner.py
Restart=on-failure
RestartSec=60

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable toolheadscanner
sudo systemctl start toolheadscanner
sudo systemctl status toolheadscanner   # check it's running
```

#### Option C – Run via cron (one-shot, no service needed)

```bash
crontab -e
```

Add a line to run once a day at 08:00:

```cron
0 8 * * * cd /path/to/ToolheadScanner && /path/to/.venv/bin/python3 automated_scanner.py --once >> logs/cron.log 2>&1
```

---

## Troubleshooting

**Force a test email without waiting for scan changes:**
```python
python -c "
import automated_scanner as a
sample = [{
    'name': 'Test Toolhead',
    'new_extruders': ['Test Extruder'],
    'new_hotends': ['Test Hotend'],
    'new_probes': [],
    'new_boards': [],
    'new_hotend_fans': [],
    'new_part_cooling_fans': [],
    'new_filament_cutter': False,
}]
a.send_email(sample)
"
```

**Gmail authentication error:** Make sure you are using an [App Password](https://myaccount.google.com/apppasswords) and not your regular password.

**Logs:** All scan output is written to `logs/automated_scanner.log` in addition to the terminal.

