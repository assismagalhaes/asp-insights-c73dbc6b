"""Pure payload normalizers selected by the frozen endpoint registry."""

from .football import normalize_football

__all__ = ["normalize_football"]
