"""Compatible import name for Reader's document backend."""
import sys

from src.reader import backend as implementation

sys.modules[__name__] = implementation
