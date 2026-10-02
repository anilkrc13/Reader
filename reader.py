#!/usr/bin/env python3
"""Compatible Reader command and import entrypoint."""
import sys

from src.reader import server as implementation

if __name__ == "__main__":
    raise SystemExit(implementation.main())
else:
    sys.modules[__name__] = implementation
