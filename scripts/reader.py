#!/usr/bin/env python3
"""Start Reader directly from a checkout or packaged runtime."""
import sys
from pathlib import Path

# Direct script execution puts scripts/, rather than the runtime root, on sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.reader import server

if __name__ == "__main__":
    raise SystemExit(server.main())
