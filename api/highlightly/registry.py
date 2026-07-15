from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
from typing import Any, Mapping


DEFAULT_REGISTRY = Path(__file__).resolve().parents[2] / "config" / "highlightly" / "endpoint-registry.json"
_PATH_PARAMETER = re.compile(r"\{([^}]+)\}")


@dataclass(frozen=True)
class EndpointDefinition:
    key: str
    sport: str
    path: str
    resource: str
    normalizer: str
    priority: int
    paginated: bool
    raw_retention_class: str
    parameter_names: frozenset[str]

    def request(self, params: Mapping[str, Any]) -> tuple[str, dict[str, Any]]:
        path_names = set(_PATH_PARAMETER.findall(self.path))
        missing = sorted(name for name in path_names if params.get(name) is None)
        if missing:
            raise ValueError(f"Missing path parameters for {self.key}: {', '.join(missing)}")
        path = self.path
        for name in path_names:
            path = path.replace("{" + name + "}", str(params[name]))
        query = {
            key: value
            for key, value in params.items()
            if key not in path_names and key in self.parameter_names and value is not None
        }
        return path, query


class EndpointRegistry:
    def __init__(self, path: Path = DEFAULT_REGISTRY):
        document = json.loads(path.read_text(encoding="utf-8"))
        self.contract_version = str(document["contract_version"])
        self.contract_sha256 = str(document["contract_sha256"])
        self.daily_limit = int(document["quota"]["daily_limit"])
        self.reserve = int(document["quota"]["reserve"])
        self.operations: dict[str, EndpointDefinition] = {}
        for operation in document["operations"]:
            definition = EndpointDefinition(
                key=str(operation["key"]),
                sport=str(operation["sport"]),
                path=str(operation["path"]),
                resource=str(operation["resource"]),
                normalizer=str(operation["normalizer"]),
                priority=int(operation["priority"]),
                paginated=bool(operation["paginated"]),
                raw_retention_class=str(operation["raw_retention_class"]),
                parameter_names=frozenset(str(item["name"]) for item in operation["parameters"]),
            )
            self.operations[definition.key] = definition

    def get(self, endpoint_key: str, *, sport: str | None = None) -> EndpointDefinition:
        try:
            definition = self.operations[endpoint_key]
        except KeyError as exc:
            raise ValueError(f"Unknown Highlightly endpoint: {endpoint_key}") from exc
        if sport and definition.sport != sport:
            raise ValueError(f"Endpoint {endpoint_key} belongs to {definition.sport}, not {sport}")
        return definition
