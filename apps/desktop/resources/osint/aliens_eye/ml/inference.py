"""ML inference — adapted for Lyra (local data path)."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

from aliens_eye.core.features import FEATURE_SCHEMA, vectorize_features

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
MODEL_RESOURCE = "model.json"


class ModelError(ValueError):
    pass


@dataclass
class MLModel:
    feature_schema: list[str]
    mean: list[float]
    scale: list[float]
    coef: list[float]
    intercept: float
    version: str = "unknown"
    found_threshold: float = 0.6
    not_found_threshold: float = 0.35
    ml_weight: float = 0.4

    @classmethod
    def from_dict(cls, data: dict) -> MLModel:
        try:
            thresholds = data.get("thresholds", {})
            model = cls(
                feature_schema=list(data["feature_schema"]),
                mean=[float(x) for x in data["mean"]],
                scale=[float(x) for x in data["scale"]],
                coef=[float(x) for x in data["coef"]],
                intercept=float(data["intercept"]),
                version=str(data.get("version", "unknown")),
                found_threshold=float(thresholds.get("found", 0.6)),
                not_found_threshold=float(thresholds.get("not_found", 0.35)),
                ml_weight=float(data.get("ml_weight", 0.4)),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ModelError(f"Malformed model file: {exc}") from exc

        n = len(model.feature_schema)
        if model.feature_schema != FEATURE_SCHEMA:
            raise ModelError(
                "Model feature schema does not match the current FEATURE_SCHEMA; retrain the model."
            )
        if not (len(model.mean) == len(model.scale) == len(model.coef) == n):
            raise ModelError("Model vector lengths do not match the feature schema.")
        if any(s == 0 for s in model.scale):
            raise ModelError("Model scale vector contains zeros.")
        return model

    @classmethod
    def load(cls, path: Path | None = None) -> MLModel:
        if path is not None:
            text = Path(path).read_text(encoding="utf-8")
        else:
            text = (_DATA_DIR / MODEL_RESOURCE).read_text("utf-8")
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ModelError(f"Model file is not valid JSON: {exc}") from exc
        return cls.from_dict(data)

    def predict_proba(self, features: dict[str, float]) -> float:
        x = vectorize_features(features)
        z = self.intercept
        for value, mean, scale, coef in zip(x, self.mean, self.scale, self.coef, strict=True):
            z += coef * ((value - mean) / scale)
        return _sigmoid(z)


def _sigmoid(z: float) -> float:
    z = max(-50.0, min(50.0, z))
    return 1.0 / (1.0 + math.exp(-z))