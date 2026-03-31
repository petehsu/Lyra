from dataclasses import dataclass


@dataclass(frozen=True)
class EngineHealth:
    status: str


def healthcheck() -> EngineHealth:
    return EngineHealth(status="ok")
