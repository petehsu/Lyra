#!/usr/bin/env python3
import ast
import json
import math
import re
import statistics
import sys
import time


FORBIDDEN = (
    "__",
    "import",
    "open(",
    "exec(",
    "eval(",
    "compile(",
    "globals(",
    "locals(",
    "os.",
    "sys.",
    "subprocess",
    "socket",
)


def now_ms(started):
    return int((time.perf_counter() - started) * 1000)


def emit(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")))


def failure(code, message, started, warnings=None):
    emit({
        "ok": False,
        "engine": "python",
        "code": code,
        "message": message,
        "warnings": warnings or [],
        "elapsedMs": now_ms(started),
    })


def success(result, started, **extra):
    payload = {
        "ok": True,
        "engine": "python",
        "result": str(result),
        "warnings": extra.pop("warnings", []),
        "elapsedMs": now_ms(started),
    }
    payload.update({key: value for key, value in extra.items() if value is not None})
    emit(payload)


def read_request():
    raw = sys.stdin.read(1_000_000)
    if not raw:
        raise ValueError("empty request")
    return json.loads(raw)


def reject_unsafe(expression):
    lowered = expression.lower()
    for token in FORBIDDEN:
        if token in lowered:
            raise ValueError(f"forbidden token: {token}")


def parse_literal_list(text):
    value = ast.literal_eval(text)
    if not isinstance(value, (list, tuple)):
        raise ValueError("expected a list")
    numbers = []
    for entry in value:
        if not isinstance(entry, (int, float)):
            raise ValueError("statistics inputs must be numeric")
        numbers.append(float(entry))
    return numbers


def try_statistics(expression, started):
    match = re.fullmatch(r"\s*(mean|median|stdev|pstdev|variance|pvariance)\s*\((.*)\)\s*", expression, re.I)
    if not match:
        return False
    func = match.group(1).lower()
    values = parse_literal_list(match.group(2))
    if func == "mean":
        value = statistics.fmean(values)
    elif func == "median":
        value = statistics.median(values)
    elif func == "stdev":
        value = statistics.stdev(values)
    elif func == "pstdev":
        value = statistics.pstdev(values)
    elif func == "variance":
        value = statistics.variance(values)
    else:
        value = statistics.pvariance(values)
    success(value, started, decimal=str(value))
    return True


def try_units(expression, started):
    match = re.fullmatch(
        r"\s*([-+]?\d+(?:\.\d+)?)\s+([A-Za-z_][A-Za-z0-9_*/^ -]*)\s+(?:to|in)\s+([A-Za-z_][A-Za-z0-9_*/^ -]*)\s*",
        expression,
        re.I,
    )
    if not match:
        return False
    try:
        import pint
    except Exception:
        failure("PYTHON_DEPENDENCY_MISSING", "Pint is required for unit conversions", started)
        return True
    registry = pint.UnitRegistry()
    quantity = float(match.group(1)) * registry(match.group(2).strip())
    converted = quantity.to(match.group(3).strip())
    success(converted, started, decimal=str(converted.magnitude), units=str(converted.units))
    return True


def sympy_local_dict(sympy, variables):
    allowed = [
        "Abs", "E", "I", "Matrix", "N", "Rational", "Symbol", "acos", "asin", "atan",
        "ceiling", "cos", "cosh", "det", "diff", "erf", "exp", "expand", "factor",
        "factorial", "floor", "integrate", "limit", "log", "pi", "simplify", "sin",
        "sinh", "solve", "sqrt", "tan", "tanh",
    ]
    local = {name: getattr(sympy, name) for name in allowed if hasattr(sympy, name)}
    local.update({"i": sympy.I, "j": sympy.I, "ln": sympy.log})
    for name, value in variables.items():
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
            continue
        if isinstance(value, dict):
            real = value.get("real", 0)
            imaginary = value.get("imaginary", 0)
            local[name] = sympy.sympify(real) + sympy.sympify(imaginary) * sympy.I
        else:
            local[name] = sympy.sympify(value)
    return local


def evaluate_sympy(request, started):
    try:
        import sympy
        from sympy.parsing.sympy_parser import (
            convert_xor,
            implicit_multiplication_application,
            parse_expr,
            standard_transformations,
        )
    except Exception:
        failure("PYTHON_DEPENDENCY_MISSING", "SymPy is required for advanced calculator modes", started)
        return

    expression = request["expression"]
    precision = int(request.get("precision") or 50)
    mode = request.get("mode") or "auto"
    variables = request.get("variables") or {}
    transformations = standard_transformations + (implicit_multiplication_application, convert_xor)
    global_dict = {
        "__builtins__": {},
        "Symbol": sympy.Symbol,
        "Integer": sympy.Integer,
        "Float": sympy.Float,
        "Rational": sympy.Rational,
        "Function": sympy.Function,
    }
    expr = parse_expr(
        expression,
        local_dict=sympy_local_dict(sympy, variables),
        global_dict=global_dict,
        transformations=transformations,
        evaluate=True,
    )
    simplified = sympy.simplify(expr) if mode in ("auto", "exact", "symbolic") else expr
    numeric = sympy.N(simplified, precision)
    exact = str(simplified)
    result = exact if mode in ("exact", "symbolic", "matrix") else str(numeric)
    success(
        result,
        started,
        exact=exact,
        decimal=str(numeric),
        latex=sympy.latex(simplified),
    )


def main():
    started = time.perf_counter()
    try:
        request = read_request()
        expression = str(request.get("expression") or "").strip()
        if not expression:
            failure("INVALID_EXPRESSION", "expression is required", started)
            return
        reject_unsafe(expression)
        request["expression"] = expression
        mode = request.get("mode") or "auto"
        if mode == "statistics" or re.match(r"\s*(mean|median|stdev|pstdev|variance|pvariance)\s*\(", expression, re.I):
            if try_statistics(expression, started):
                return
        if mode == "unit" or re.search(r"\s(?:to|in)\s", expression, re.I):
            if try_units(expression, started):
                return
        evaluate_sympy(request, started)
    except Exception as error:
        failure("PYTHON_CALCULATION_FAILED", str(error), started)


if __name__ == "__main__":
    main()
