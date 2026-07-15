"""Pure payload normalizers selected by the frozen endpoint registry."""

from .baseball import normalize_baseball
from .football import normalize_football

__all__ = ["normalize_baseball", "normalize_football"]
