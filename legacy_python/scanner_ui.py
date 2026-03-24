"""
scanner_ui.py

Tkinter UI for the Toolhead Scanner.

Provides:
    - "Update Toolheads" / "Update (Recheck All)" buttons.
    - A scrollable log window showing real-time progress.
    - A results panel showing each toolhead's component list with
      newly-added items highlighted in green, plus the README source line.
"""

import threading
import tkinter as tk
from tkinter import ttk, messagebox
import json

import scan_toolheads


# ── Helpers ────────────────────────────────────────────────────────────────────

def _field_as_list(value):
    """Normalise a toolhead field value to a list of strings."""
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value]
    return [str(value)]


def _fan_field_as_list(toolhead, singular_key, plural_key):
    """Read fan values from either singular or plural field names."""
    if plural_key in toolhead:
        return _field_as_list(toolhead.get(plural_key))
    return _field_as_list(toolhead.get(singular_key))


# ── Application ───────────────────────────────────────────────────────────────

class ToolheadScannerApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Toolhead Scanner")
        self.geometry("1100x750")
        self.minsize(800, 500)
        self.toolhead_names = []
        self._build_ui()
        self._refresh_toolhead_names()
        self._scan_running = False
        self._last_results = []
        self._view_mode = "parsed"

    # ── Layout ─────────────────────────────────────────────────────────────

    def _build_ui(self):
        # Top button bar
        btn_frame = ttk.Frame(self, padding=6)
        btn_frame.pack(fill=tk.X)

        self.btn_update = ttk.Button(
            btn_frame, text="Update Toolheads", command=self._on_update
        )
        self.btn_update.pack(side=tk.LEFT, padx=(0, 4))

        self.btn_recheck = ttk.Button(
            btn_frame, text="Update (Recheck All)", command=self._on_recheck
        )
        self.btn_recheck.pack(side=tk.LEFT, padx=(0, 4))

        self.btn_refresh_toolheads = ttk.Button(
            btn_frame, text="Refresh Toolheads", command=self._refresh_toolhead_names
        )
        self.btn_refresh_toolheads.pack(side=tk.LEFT, padx=(8, 4))

        self.btn_toggle_view = ttk.Button(
            btn_frame, text="View: Parsed", command=self._toggle_view
        )
        self.btn_toggle_view.pack(side=tk.LEFT, padx=(8, 4))

        self.status_var = tk.StringVar(value="Ready")
        ttk.Label(btn_frame, textvariable=self.status_var).pack(side=tk.RIGHT)

        # Add extra GitHub location panel
        extra_frame = ttk.LabelFrame(self, text="Add Extra GitHub Location", padding=6)
        extra_frame.pack(fill=tk.X, padx=6, pady=(0, 6))

        ttk.Label(extra_frame, text="Toolhead").pack(side=tk.LEFT)
        self.toolhead_var = tk.StringVar()
        self.toolhead_combo = ttk.Combobox(
            extra_frame,
            textvariable=self.toolhead_var,
            state="readonly",
            width=28,
            values=self.toolhead_names,
        )
        self.toolhead_combo.pack(side=tk.LEFT, padx=(6, 12))

        ttk.Label(extra_frame, text="GitHub URL").pack(side=tk.LEFT)
        self.extra_url_var = tk.StringVar()
        self.extra_url_entry = ttk.Entry(extra_frame, textvariable=self.extra_url_var, width=70)
        self.extra_url_entry.pack(side=tk.LEFT, padx=(6, 8), fill=tk.X, expand=True)

        self.btn_add_extra = ttk.Button(
            extra_frame, text="Add Location", command=self._on_add_extra_location
        )
        self.btn_add_extra.pack(side=tk.LEFT)

        # Horizontal paned window: log on the left, results on the right
        pane = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        pane.pack(fill=tk.BOTH, expand=True, padx=6, pady=(0, 6))

        # ── Log panel ──────────────────────────────────────────────────────
        log_frame = ttk.LabelFrame(pane, text="Log", padding=4)
        pane.add(log_frame, weight=1)

        self.log_text = tk.Text(
            log_frame, wrap=tk.WORD, state=tk.DISABLED,
            font=("Consolas", 9), bg="#1e1e1e", fg="#cccccc",
            insertbackground="#cccccc"
        )
        log_scroll = ttk.Scrollbar(log_frame, command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=log_scroll.set)
        log_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.log_text.pack(fill=tk.BOTH, expand=True)

        # ── Results panel ──────────────────────────────────────────────────
        result_frame = ttk.LabelFrame(pane, text="Results", padding=4)
        pane.add(result_frame, weight=2)

        self.result_text = tk.Text(
            result_frame, wrap=tk.WORD, state=tk.DISABLED,
            font=("Consolas", 9), bg="#1e1e1e", fg="#cccccc",
            insertbackground="#cccccc"
        )
        res_scroll = ttk.Scrollbar(result_frame, command=self.result_text.yview)
        self.result_text.configure(yscrollcommand=res_scroll.set)
        res_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.result_text.pack(fill=tk.BOTH, expand=True)

        # Tag styles for the results panel
        self.result_text.tag_configure("heading",   font=("Consolas", 10, "bold"),
                                       foreground="#61afef")
        self.result_text.tag_configure("section",   font=("Consolas", 9, "bold"),
                                       foreground="#c678dd")
        self.result_text.tag_configure("existing",  foreground="#abb2bf")
        self.result_text.tag_configure("new_item",  foreground="#98c379",
                                       font=("Consolas", 9, "bold"))
        self.result_text.tag_configure("source",    foreground="#5c6370",
                                       font=("Consolas", 8, "italic"))

    # ── Actions ────────────────────────────────────────────────────────────

    def _set_buttons(self, enabled: bool):
        state = tk.NORMAL if enabled else tk.DISABLED
        self.btn_update.configure(state=state)
        self.btn_recheck.configure(state=state)
        self.btn_refresh_toolheads.configure(state=state)
        self.btn_add_extra.configure(state=state)
        self.btn_toggle_view.configure(state=state)

    def _toggle_view(self):
        self._view_mode = "json" if self._view_mode == "parsed" else "parsed"
        self.btn_toggle_view.configure(
            text="View: JSON" if self._view_mode == "json" else "View: Parsed"
        )
        self._show_results(self._last_results)

    def _refresh_toolhead_names(self):
        try:
            self.toolhead_names = scan_toolheads.get_toolhead_names()
            self.toolhead_combo.configure(values=self.toolhead_names)
            if self.toolhead_names and not self.toolhead_var.get():
                self.toolhead_var.set(self.toolhead_names[0])
            self.status_var.set(f"Loaded {len(self.toolhead_names)} toolheads")
        except Exception as exc:
            messagebox.showerror("Toolhead Scanner", f"Failed to load toolheads:\n{exc}")

    def _on_add_extra_location(self):
        toolhead = self.toolhead_var.get().strip()
        url = self.extra_url_var.get().strip()
        if not toolhead:
            messagebox.showwarning("Toolhead Scanner", "Please choose a toolhead.")
            return
        if "github.com" not in url:
            messagebox.showwarning("Toolhead Scanner", "Please enter a valid GitHub URL.")
            return

        try:
            added = scan_toolheads.add_extra_location(toolhead, url)
            if added:
                self._log(f"[EXTRA] Added URL for {toolhead}: {url}")
                self.extra_url_var.set("")
                self.status_var.set("Extra location saved")
            else:
                self.status_var.set("Location already exists")
                messagebox.showinfo("Toolhead Scanner", "That toolhead+URL entry already exists.")
        except Exception as exc:
            messagebox.showerror("Toolhead Scanner", f"Failed to save location:\n{exc}")

    def _on_update(self):
        self._start_scan(recheck=False)

    def _on_recheck(self):
        self._start_scan(recheck=True)

    def _start_scan(self, recheck: bool):
        if self._scan_running:
            return
        self._scan_running = True
        self._set_buttons(False)
        self._clear_log()
        self._clear_results()
        self.status_var.set("Scanning...")
        thread = threading.Thread(target=self._run_scan, args=(recheck,), daemon=True)
        thread.start()

    def _run_scan(self, recheck: bool):
        try:
            results = scan_toolheads.run_scan(recheck=recheck, log=self._log)
            self.after(0, self._show_results, results)
        except Exception as exc:
            self._log(f"\n[ERROR] {exc}")
        finally:
            self.after(0, self._scan_finished)

    def _scan_finished(self):
        self._scan_running = False
        self._set_buttons(True)
        self._refresh_toolhead_names()
        self.status_var.set("Done")

    # ── Log helpers ────────────────────────────────────────────────────────

    def _clear_log(self):
        self.log_text.configure(state=tk.NORMAL)
        self.log_text.delete("1.0", tk.END)
        self.log_text.configure(state=tk.DISABLED)

    def _log(self, msg: str):
        """Thread-safe append to the log widget."""
        def _append():
            self.log_text.configure(state=tk.NORMAL)
            self.log_text.insert(tk.END, msg + "\n")
            self.log_text.see(tk.END)
            self.log_text.configure(state=tk.DISABLED)
        self.after(0, _append)

    # ── Results rendering ──────────────────────────────────────────────────

    def _clear_results(self):
        self.result_text.configure(state=tk.NORMAL)
        self.result_text.delete("1.0", tk.END)
        self.result_text.configure(state=tk.DISABLED)

    def _show_results(self, results):
        self._last_results = results

        if self._view_mode == "json":
            self._show_results_json(results)
        else:
            self._show_results_parsed(results)

    def _show_results_parsed(self, results):
        rt = self.result_text
        rt.configure(state=tk.NORMAL)
        rt.delete("1.0", tk.END)

        if not results:
            rt.insert(tk.END, "No new updates found.\n", "existing")
            rt.configure(state=tk.DISABLED)
            return

        rt.insert(tk.END, f"Updates found for {len(results)} toolhead(s)\n\n",
                  "heading")

        for entry in results:
            name       = entry["name"]
            original   = entry["original"]
            sources    = entry["sources"]
            new_ext    = set(entry["new_extruders"])
            new_hot    = set(entry["new_hotends"])
            new_prb    = set(entry["new_probes"])
            new_brd    = set(entry["new_boards"])
            new_hot_fan = set(entry.get("new_hotend_fans", []))
            new_part_fan = set(entry.get("new_part_cooling_fans", []))
            new_cut    = bool(entry.get("new_filament_cutter", False))

            rt.insert(tk.END, f"{'═' * 60}\n", "heading")
            rt.insert(tk.END, f"  {name}\n", "heading")
            rt.insert(tk.END, f"{'═' * 60}\n\n", "heading")

            sections = [
                ("Extruders", "extruders", new_ext),
                ("Hotends",   "hotend",    new_hot),
                ("Probes",    "probe",     new_prb),
                ("Boards",    "boards",    new_brd),
                ("Hotend Fans", "hotend_fan", new_hot_fan),
                ("Part Cooling Fans", "part_cooling_fan", new_part_fan),
            ]

            for label, field_key, new_set in sections:
                if field_key == "hotend_fan":
                    existing = _fan_field_as_list(original, "hotend_fan", "hotend_fans")
                elif field_key == "part_cooling_fan":
                    existing = _fan_field_as_list(
                        original, "part_cooling_fan", "part_cooling_fans"
                    )
                else:
                    existing = _field_as_list(original.get(field_key))
                if not existing and not new_set:
                    continue

                rt.insert(tk.END, f"  {label}:\n", "section")

                # Show existing items
                for item in existing:
                    rt.insert(tk.END, f"    • {item}\n", "existing")

                # Show new items highlighted
                for item in sorted(new_set):
                    rt.insert(tk.END, f"    + {item}", "new_item")
                    rt.insert(tk.END, "  (NEW)\n", "new_item")
                    # Show the source line that triggered it
                    source_key = item
                    if field_key == "hotend_fan":
                        source_key = f"hotend_fan::{item}"
                    elif field_key == "part_cooling_fan":
                        source_key = f"part_cooling_fan::{item}"
                    source_line = sources.get(source_key, "")
                    if source_line:
                        # Truncate very long source lines for readability
                        display = source_line if len(source_line) <= 200 else source_line[:200] + "…"
                        rt.insert(tk.END, f"      ↳ {display}\n", "source")

                rt.insert(tk.END, "\n")

            # Filament cutter section (single-value field)
            existing_cutter = str(original.get("filament_cutter", "unknown"))
            if existing_cutter or new_cut:
                rt.insert(tk.END, "  Filament Cutter:\n", "section")
                rt.insert(tk.END, f"    • {existing_cutter}\n", "existing")
                if new_cut:
                    rt.insert(tk.END, "    + supported  (NEW)\n", "new_item")
                    source_line = sources.get("filament_cutter", "")
                    if source_line:
                        display = source_line if len(source_line) <= 200 else source_line[:200] + "…"
                        rt.insert(tk.END, f"      ↳ {display}\n", "source")
                rt.insert(tk.END, "\n")

        rt.configure(state=tk.DISABLED)

    def _show_results_json(self, results):
        rt = self.result_text
        rt.configure(state=tk.NORMAL)
        rt.delete("1.0", tk.END)

        if not results:
            rt.insert(tk.END, "{\n  \"toolheads\": []\n}\n", "existing")
            rt.configure(state=tk.DISABLED)
            return

        payload = {"toolheads": [entry["updated"] for entry in results]}
        rt.insert(tk.END, json.dumps(payload, indent=2), "existing")
        rt.insert(tk.END, "\n")
        rt.configure(state=tk.DISABLED)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app = ToolheadScannerApp()
    app.mainloop()
