from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import re
from typing import Any, Mapping
from uuid import UUID, uuid5


CANONICAL_NAMESPACE = UUID("7392e777-3dab-5bd5-a983-0ae14bf0f9b5")
_SLUG = re.compile(r"[^a-z0-9]+")


def stable_id(*parts: Any) -> str:
    return str(uuid5(CANONICAL_NAMESPACE, ":".join(str(part) for part in parts)))


def slug(value: Any) -> str:
    return _SLUG.sub("_", str(value or "").strip().casefold()).strip("_") or "unknown"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def items(payload: Any) -> list[Mapping[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, Mapping)]
    if not isinstance(payload, Mapping):
        return []
    data = payload.get("data")
    if isinstance(data, list):
        return [item for item in data if isinstance(item, Mapping)]
    if isinstance(data, Mapping):
        return [data]
    return [payload]


def schema_fingerprint(payload: Any) -> str:
    def shape(value: Any) -> Any:
        if isinstance(value, Mapping):
            return {str(key): shape(item) for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))}
        if isinstance(value, list):
            unique = {json.dumps(shape(item), sort_keys=True, ensure_ascii=True) for item in value[:100]}
            return [json.loads(item) for item in sorted(unique)]
        if value is None:
            return "null"
        if isinstance(value, bool):
            return "boolean"
        if isinstance(value, (int, float)):
            return "number"
        return "string"

    encoded = json.dumps(shape(payload), sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class NormalizationContext:
    provider_id: str
    sport_id: str
    sport: str
    endpoint_key: str
    normalizer: str
    request_params: Mapping[str, Any]
    raw_object_id: str
    captured_at: str
    bookmaker_ids: Mapping[str, str]


@dataclass(frozen=True)
class TablePatch:
    table: str
    filters: Mapping[str, Any]
    values: Mapping[str, Any]


@dataclass
class NormalizedBatch:
    received: int = 0
    rejected: int = 0
    rows: dict[str, dict[str, dict[str, Any]]] = field(default_factory=dict)
    conflicts: dict[str, str] = field(default_factory=dict)
    odds_quotes: list[dict[str, Any]] = field(default_factory=list)
    patches: list[TablePatch] = field(default_factory=list)
    issues: list[dict[str, Any]] = field(default_factory=list)

    def add(self, table: str, row: Mapping[str, Any], *, conflict: str = "id", key: str | None = None) -> None:
        materialized = dict(row)
        identity = key or str(materialized.get("id") or json.dumps(materialized, sort_keys=True, default=str))
        self.rows.setdefault(table, {})[identity] = materialized
        self.conflicts[table] = conflict

    @property
    def normalized_count(self) -> int:
        return sum(len(rows) for rows in self.rows.values()) + len(self.odds_quotes) + len(self.patches)

    def table_rows(self, table: str) -> list[dict[str, Any]]:
        return list(self.rows.get(table, {}).values())

    def issue(self, code: str, message: str, *, severity: str = "high", context: Mapping[str, Any] | None = None) -> None:
        self.issues.append(
            {
                "id": stable_id("quality", self.raw_issue_key(code, context or {})),
                "code": code,
                "severity": severity,
                "message": message,
                "context": dict(context or {}),
            }
        )

    def raw_issue_key(self, code: str, context: Mapping[str, Any]) -> str:
        return hashlib.sha256(
            json.dumps([code, context], sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")
        ).hexdigest()


def typed_value(value: Any) -> dict[str, Any]:
    if isinstance(value, bool):
        return {"boolean_value": value}
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return {"numeric_value": value}
    if isinstance(value, (dict, list)):
        return {"json_value": value}
    return {"text_value": str(value)}


def flatten_metrics(value: Any, prefix: str = "") -> list[tuple[str, Any]]:
    flattened: list[tuple[str, Any]] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            flattened.extend(flatten_metrics(item, path))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            path = f"{prefix}.{index}" if prefix else str(index)
            flattened.extend(flatten_metrics(item, path))
    elif value is not None:
        flattened.append((prefix or "value", value))
    return flattened


def add_provider_mapping(
    batch: NormalizedBatch,
    context: NormalizationContext,
    entity_type: str,
    external_id: Any,
    canonical_id: str,
    payload: Mapping[str, Any],
) -> None:
    batch.add(
        "sports_provider_entities",
        {
            "provider_id": context.provider_id,
            "sport_id": context.sport_id,
            "entity_type": entity_type,
            "external_id": str(external_id),
            "canonical_id": canonical_id,
            "provider_payload": dict(payload),
            "last_seen_at": context.captured_at,
        },
        conflict="provider_id,sport_id,entity_type,external_id",
        key=f"{entity_type}:{external_id}",
    )


def add_metric_definition(
    batch: NormalizedBatch,
    context: NormalizationContext,
    *,
    resource: str,
    provider_key: str,
    display_name: str | None = None,
    group_name: str = "",
    value: Any,
) -> str:
    metric_id = stable_id(context.provider_id, context.sport_id, "metric", resource, group_name, provider_key)
    value_type = (
        "boolean" if isinstance(value, bool) else
        "integer" if isinstance(value, int) else
        "decimal" if isinstance(value, float) else
        "json" if isinstance(value, (dict, list)) else
        "text"
    )
    batch.add(
        "hl_metric_definitions",
        {
            "id": metric_id,
            "provider_id": context.provider_id,
            "sport_id": context.sport_id,
            "resource": resource,
            "group_name": group_name,
            "provider_key": provider_key,
            "canonical_key": slug(provider_key),
            "display_name": display_name or provider_key,
            "value_type": value_type,
            "status": "needs_review",
            "observed_count": 1,
            "first_seen_at": context.captured_at,
            "last_seen_at": context.captured_at,
        },
    )
    return metric_id
