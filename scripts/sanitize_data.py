#!/usr/bin/env python3
"""
Hilfsskript, um sensible lokale Daten vor Git- oder Docker-Operationen zu entfernen.

Das Skript löscht SQLite-Dumps im Verzeichnis backend/data und legt anschließend
die .gitkeep-Datei wieder an, damit das Verzeichnis im Repo verbleibt.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "backend" / "data"
PLACEHOLDER = DATA_DIR / ".gitkeep"
PATTERNS = ("*.db", "*.sqlite", "*.sqlite3")


def wipe_data(dry_run: bool = False) -> None:
    if not DATA_DIR.exists():
        print(f"[INFO] Datenverzeichnis {DATA_DIR} existiert nicht – nichts zu tun.")
        return

    removed_any = False
    for pattern in PATTERNS:
        for file in DATA_DIR.glob(pattern):
            if file == PLACEHOLDER:
                continue
            removed_any = True
            if dry_run:
                print(f"[DRY-RUN] Würde löschen: {file}")
            else:
                file.unlink(missing_ok=True)
                print(f"[OK] Gelöscht: {file}")

    if not removed_any:
        print("[INFO] Keine Datenbanken gefunden.")

    if not PLACEHOLDER.exists():
        if dry_run:
            print(f"[DRY-RUN] Würde Platzhalter schreiben: {PLACEHOLDER}")
        else:
            PLACEHOLDER.write_text(
                "Dieses Platzhalter-File verhindert, dass reale Paperless-Daten "
                "versehentlich mit eingecheckt werden.\n"
                "Vor einem Commit oder Docker-Build bitte sicherstellen, dass hier "
                "nur Test- oder keine Daten liegen.\n",
                encoding="utf-8",
            )
            print(f"[OK] Platzhalter erstellt: {PLACEHOLDER}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Lokale Paperless-Datenbanken vor Commits/Bildaufbau löschen."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Keine Dateien löschen, nur anzeigen, was passieren würde.",
    )
    args = parser.parse_args(argv)
    wipe_data(dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())

