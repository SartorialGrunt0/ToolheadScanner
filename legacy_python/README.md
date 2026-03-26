# Legacy Python Scanner

The original desktop and scheduled Python implementation now lives in this folder.

## Contents

- `scanner_ui.py`: Tkinter GUI for manual scans and adding extra GitHub locations.
- `scan_toolheads.py`: Core parser and scanner pipeline.
- `automated_scanner.py`: Local scheduler loop plus SMTP email notifications.
- `data/`: Reference JSON files used by the Python version.

## Run from the repository root

**Windows**
```bat
python legacy_python\scanner_ui.py
python legacy_python\automated_scanner.py --once
```

**Linux**
```bash
python3 legacy_python/scanner_ui.py
python3 legacy_python/automated_scanner.py --once
```

## Run from inside this folder

**Windows**
```bat
python scanner_ui.py
python automated_scanner.py --once
```

**Linux**
```bash
python3 scanner_ui.py
python3 automated_scanner.py --once
```

## Notes

- Copy `.env.example` to `.env` in this folder if you want to keep using the legacy SMTP email flow.
- The new root project is the Cloudflare Worker version intended for cron-triggered deployment.
- Dashboard features such as the Toolhead Editor and GitHub PR creation are only available in the Cloudflare Worker version.