"""Minimal Highlightly client used by ASP Insights evaluation probes.

The API key is deliberately read from the environment by callers. Never commit it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


DEFAULT_BASE_URL = "https://sports.highlightly.net"
DEFAULT_USER_AGENT = "ASP-Insights/0.1 (+https://highlightly.net)"


class HighlightlyError(RuntimeError):
    """Raised for transport errors or non-success API responses."""

    def __init__(self, message: str, *, status: int | None = None, body: Any = None):
        super().__init__(message)
        self.status = status
        self.body = body


@dataclass(frozen=True)
class HighlightlyResponse:
    status: int
    data: Any
    rate_limit: int | None
    rate_remaining: int | None
    content_type: str | None


def _integer_header(headers: Mapping[str, str], name: str) -> int | None:
    value = headers.get(name)
    try:
        return int(value) if value is not None else None
    except ValueError:
        return None


class HighlightlyClient:
    def __init__(self, api_key: str, *, base_url: str = DEFAULT_BASE_URL, timeout: float = 20.0):
        if not api_key.strip():
            raise ValueError("Highlightly API key must not be empty")
        self.api_key = api_key.strip()
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def get(self, path: str, params: Mapping[str, Any] | None = None) -> HighlightlyResponse:
        clean_path = "/" + path.lstrip("/")
        query = urlencode(
            [(key, value) for key, value in (params or {}).items() if value is not None],
            doseq=True,
        )
        url = f"{self.base_url}{clean_path}" + (f"?{query}" if query else "")
        request = Request(
            url,
            headers={
                "x-rapidapi-key": self.api_key,
                "accept": "application/json",
                "user-agent": DEFAULT_USER_AGENT,
            },
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
                payload = json.loads(raw) if raw else None
                headers = {key.lower(): value for key, value in response.headers.items()}
                return HighlightlyResponse(
                    status=response.status,
                    data=payload,
                    rate_limit=_integer_header(headers, "x-ratelimit-requests-limit"),
                    rate_remaining=_integer_header(headers, "x-ratelimit-requests-remaining"),
                    content_type=headers.get("content-type"),
                )
        except HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                body = json.loads(raw)
            except json.JSONDecodeError:
                body = raw
            raise HighlightlyError(f"Highlightly returned HTTP {exc.code}", status=exc.code, body=body) from exc
        except URLError as exc:
            raise HighlightlyError(f"Could not reach Highlightly: {exc.reason}") from exc
