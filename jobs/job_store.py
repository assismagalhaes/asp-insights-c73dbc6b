from __future__ import annotations

import json
import threading
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

JobStatus = Literal["PENDENTE", "RODANDO", "CONCLUIDA", "ERRO"]

ROOT = Path(__file__).resolve().parents[1]
JOBS_DIR = ROOT / "outputs" / "jobs"
RAW_DIR = ROOT / "outputs" / "raw"
NORMALIZED_DIR = ROOT / "outputs" / "normalized"
LOGS_DIR = ROOT / "logs"

for directory in (JOBS_DIR, RAW_DIR, NORMALIZED_DIR, LOGS_DIR):
    directory.mkdir(parents=True, exist_ok=True)

_LOCK = threading.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class JobRecord:
    job_id: str
    status: JobStatus
    params: dict[str, Any]
    created_at: str
    updated_at: str
    raw_path: str | None = None
    normalized_path: str | None = None
    log_path: str | None = None
    erro: str | None = None
    logs: list[str] = field(default_factory=list)


class JobStore:
    def _path(self, job_id: str) -> Path:
        return JOBS_DIR / f"{job_id}.json"

    def create(self, job_id: str, params: dict[str, Any]) -> JobRecord:
        record = JobRecord(
            job_id=job_id,
            status="PENDENTE",
            params=params,
            created_at=now_iso(),
            updated_at=now_iso(),
            log_path=str(LOGS_DIR / f"{job_id}.log"),
        )
        self.save(record)
        self.append_log(job_id, "Job criado.")
        return record

    def get(self, job_id: str) -> JobRecord:
        path = self._path(job_id)
        if not path.exists():
            raise KeyError(job_id)
        data = json.loads(path.read_text(encoding="utf-8"))
        return JobRecord(**data)

    def save(self, record: JobRecord) -> None:
        record.updated_at = now_iso()
        with _LOCK:
            self._path(record.job_id).write_text(
                json.dumps(asdict(record), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

    def update(self, job_id: str, **changes: Any) -> JobRecord:
        record = self.get(job_id)
        for key, value in changes.items():
            setattr(record, key, value)
        self.save(record)
        return record

    def append_log(self, job_id: str, message: str) -> None:
        timestamped = f"{now_iso()} {message}"
        record = self.get(job_id)
        record.logs.append(timestamped)
        if record.log_path:
            Path(record.log_path).parent.mkdir(parents=True, exist_ok=True)
            with Path(record.log_path).open("a", encoding="utf-8") as fh:
                fh.write(timestamped + "\n")
        self.save(record)

    def save_raw(self, job_id: str, payload: Any) -> str:
        path = RAW_DIR / f"{job_id}.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        self.update(job_id, raw_path=str(path))
        return str(path)

    def save_normalized(self, job_id: str, payload: Any) -> str:
        path = NORMALIZED_DIR / f"{job_id}.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        self.update(job_id, normalized_path=str(path))
        return str(path)


store = JobStore()
