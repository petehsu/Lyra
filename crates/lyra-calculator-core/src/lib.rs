use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_double, c_int, c_uint};
use std::time::Instant;

const DEFAULT_PRECISION: u32 = 50;
const MAX_PRECISION: u32 = 1000;
const NATIVE_SIGNIFICANT_DIGITS: u32 = 17;
const MAX_EXPRESSION_BYTES: usize = 20_000;

#[repr(C)]
struct LyraCalcVariable {
    name: *const c_char,
    real: c_double,
    imaginary: c_double,
    is_complex: c_int,
}

#[repr(C)]
struct LyraCalcNativeResult {
    ok: c_int,
    is_complex: c_int,
    real: c_double,
    imaginary: c_double,
    error: *mut c_char,
}

unsafe extern "C" {
    fn lyra_calculator_eval(
        expression: *const c_char,
        variables: *const LyraCalcVariable,
        variable_count: usize,
        precision: c_uint,
        out_result: *mut LyraCalcNativeResult,
    ) -> c_int;
    fn lyra_calculator_free_result(result: *mut LyraCalcNativeResult);
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeEvaluateRequest {
    pub expression: String,
    #[serde(default)]
    pub variables: BTreeMap<String, VariableValue>,
    pub precision: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum VariableValue {
    Number(f64),
    Text(String),
    Complex {
        real: f64,
        #[serde(default)]
        imaginary: f64,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeEvaluateResponse {
    pub ok: bool,
    pub engine: &'static str,
    pub result: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decimal: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub real: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imaginary: Option<f64>,
    pub warnings: Vec<String>,
    pub elapsed_ms: u128,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeEvaluateErrorResponse {
    pub ok: bool,
    pub engine: &'static str,
    pub code: &'static str,
    pub message: String,
    pub warnings: Vec<String>,
    pub elapsed_ms: u128,
}

struct PreparedVariables {
    _names: Vec<CString>,
    variables: Vec<LyraCalcVariable>,
}

pub fn evaluate_native_json(payload: &str) -> Result<String, String> {
    let request: NativeEvaluateRequest =
        serde_json::from_str(payload).map_err(|error| format!("invalid request JSON: {error}"))?;
    let response = evaluate_native(request);
    serde_json::to_string(&response).map_err(|error| format!("failed to serialize result: {error}"))
}

pub fn evaluate_native(request: NativeEvaluateRequest) -> serde_json::Value {
    let started_at = Instant::now();
    let precision = request
        .precision
        .unwrap_or(DEFAULT_PRECISION)
        .clamp(1, MAX_PRECISION);
    let mut warnings = Vec::new();
    if precision > NATIVE_SIGNIFICANT_DIGITS {
        warnings.push(format!(
            "native engine uses f64 output; requested precision {precision} is routed with about {NATIVE_SIGNIFICANT_DIGITS} significant digits"
        ));
    }

    if request.expression.trim().is_empty() {
        return error_response(
            "INVALID_EXPRESSION",
            "expression is required",
            warnings,
            started_at,
        );
    }
    if request.expression.len() > MAX_EXPRESSION_BYTES {
        return error_response(
            "EXPRESSION_TOO_LARGE",
            format!("expression exceeds {MAX_EXPRESSION_BYTES} bytes"),
            warnings,
            started_at,
        );
    }

    let expression = match CString::new(request.expression.as_str()) {
        Ok(value) => value,
        Err(_) => {
            return error_response(
                "INVALID_EXPRESSION",
                "expression contains an interior NUL byte",
                warnings,
                started_at,
            );
        }
    };
    let prepared = match prepare_variables(&request.variables) {
        Ok(value) => value,
        Err(message) => {
            return error_response("INVALID_VARIABLES", message, warnings, started_at);
        }
    };

    let mut native_result = LyraCalcNativeResult {
        ok: 0,
        is_complex: 0,
        real: 0.0,
        imaginary: 0.0,
        error: std::ptr::null_mut(),
    };
    let status = unsafe {
        lyra_calculator_eval(
            expression.as_ptr(),
            prepared.variables.as_ptr(),
            prepared.variables.len(),
            precision,
            &mut native_result,
        )
    };
    let elapsed_ms = started_at.elapsed().as_millis();
    let value = if status == 1 && native_result.ok == 1 {
        let response = success_response(&native_result, warnings, elapsed_ms);
        serde_json::to_value(response).unwrap_or_else(|error| {
            serde_json::json!({
                "ok": false,
                "engine": "native",
                "code": "SERIALIZE_FAILED",
                "message": error.to_string(),
                "warnings": [],
                "elapsedMs": elapsed_ms
            })
        })
    } else {
        let message = native_error_message(&native_result);
        serde_json::to_value(NativeEvaluateErrorResponse {
            ok: false,
            engine: "native",
            code: "NATIVE_EVALUATION_FAILED",
            message,
            warnings,
            elapsed_ms,
        })
        .unwrap_or_else(|error| {
            serde_json::json!({
                "ok": false,
                "engine": "native",
                "code": "SERIALIZE_FAILED",
                "message": error.to_string(),
                "warnings": [],
                "elapsedMs": elapsed_ms
            })
        })
    };
    unsafe {
        lyra_calculator_free_result(&mut native_result);
    }
    value
}

fn prepare_variables(input: &BTreeMap<String, VariableValue>) -> Result<PreparedVariables, String> {
    let mut names = Vec::with_capacity(input.len());
    let mut variables = Vec::with_capacity(input.len());
    for (name, value) in input {
        if name.trim().is_empty() {
            return Err("variable names cannot be empty".to_string());
        }
        let name = CString::new(name.as_str())
            .map_err(|_| format!("variable name contains an interior NUL byte: {name}"))?;
        let (real, imaginary, is_complex) = variable_to_parts(value)?;
        variables.push(LyraCalcVariable {
            name: name.as_ptr(),
            real,
            imaginary,
            is_complex: if is_complex { 1 } else { 0 },
        });
        names.push(name);
    }
    Ok(PreparedVariables {
        _names: names,
        variables,
    })
}

fn variable_to_parts(value: &VariableValue) -> Result<(f64, f64, bool), String> {
    match value {
        VariableValue::Number(number) => require_finite(*number).map(|real| (real, 0.0, false)),
        VariableValue::Text(text) => {
            let real = text
                .trim()
                .parse::<f64>()
                .map_err(|_| format!("unsupported variable string value: {text}"))?;
            require_finite(real).map(|real| (real, 0.0, false))
        }
        VariableValue::Complex { real, imaginary } => {
            let real = require_finite(*real)?;
            let imaginary = require_finite(*imaginary)?;
            Ok((real, imaginary, imaginary != 0.0))
        }
    }
}

fn require_finite(value: f64) -> Result<f64, String> {
    if value.is_finite() {
        Ok(value)
    } else {
        Err("variables must be finite numbers".to_string())
    }
}

fn native_error_message(result: &LyraCalcNativeResult) -> String {
    if result.error.is_null() {
        return "native calculation failed".to_string();
    }
    unsafe { CStr::from_ptr(result.error) }
        .to_string_lossy()
        .into_owned()
}

fn success_response(
    result: &LyraCalcNativeResult,
    warnings: Vec<String>,
    elapsed_ms: u128,
) -> NativeEvaluateResponse {
    let real = normalize_zero(result.real);
    let imaginary = normalize_zero(result.imaginary);
    if result.is_complex == 1 {
        let result_text = format_complex(real, imaginary);
        NativeEvaluateResponse {
            ok: true,
            engine: "native",
            result: result_text.clone(),
            decimal: Some(result_text),
            real: Some(real),
            imaginary: Some(imaginary),
            warnings,
            elapsed_ms,
        }
    } else {
        let result_text = format_number(real);
        NativeEvaluateResponse {
            ok: true,
            engine: "native",
            result: result_text.clone(),
            decimal: Some(result_text),
            real: Some(real),
            imaginary: None,
            warnings,
            elapsed_ms,
        }
    }
}

fn error_response(
    code: &'static str,
    message: impl Into<String>,
    warnings: Vec<String>,
    started_at: Instant,
) -> serde_json::Value {
    serde_json::to_value(NativeEvaluateErrorResponse {
        ok: false,
        engine: "native",
        code,
        message: message.into(),
        warnings,
        elapsed_ms: started_at.elapsed().as_millis(),
    })
    .unwrap_or_else(|error| {
        serde_json::json!({
            "ok": false,
            "engine": "native",
            "code": "SERIALIZE_FAILED",
            "message": error.to_string(),
            "warnings": [],
            "elapsedMs": 0
        })
    })
}

fn normalize_zero(value: f64) -> f64 {
    if value == 0.0 { 0.0 } else { value }
}

fn format_complex(real: f64, imaginary: f64) -> String {
    if real == 0.0 {
        return format!("{}i", format_number(imaginary));
    }
    let sign = if imaginary < 0.0 { "-" } else { "+" };
    format!(
        "{} {} {}i",
        format_number(real),
        sign,
        format_number(imaginary.abs())
    )
}

fn format_number(value: f64) -> String {
    if value == 0.0 {
        return "0".to_string();
    }
    let abs = value.abs();
    let raw = if !(1e-6..1e18).contains(&abs) {
        format!("{value:.16e}")
    } else {
        format!("{value:.16}")
    };
    trim_number(raw)
}

fn trim_number(input: String) -> String {
    if let Some((mantissa, exponent)) = input.split_once('e') {
        return format!(
            "{}e{}",
            trim_decimal(mantissa.to_string()),
            exponent.trim_start_matches('+')
        );
    }
    trim_decimal(input)
}

fn trim_decimal(mut input: String) -> String {
    if input.contains('.') {
        while input.ends_with('0') {
            input.pop();
        }
        if input.ends_with('.') {
            input.pop();
        }
    }
    if input == "-0" {
        "0".to_string()
    } else {
        input
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;
    use serde_json::json;

    fn evaluate(payload: serde_json::Value) -> serde_json::Value {
        let raw = evaluate_native_json(&payload.to_string()).expect("native JSON result");
        serde_json::from_str(&raw).expect("valid JSON")
    }

    #[test]
    fn evaluates_operator_precedence() {
        let result = evaluate(json!({ "expression": "2 + 3 * 4 ^ 2" }));
        assert_eq!(result["ok"], true);
        assert_eq!(result["result"], "50");
    }

    #[test]
    fn keeps_exponent_higher_than_unary_minus() {
        let result = evaluate(json!({ "expression": "-2^2" }));
        assert_eq!(result["ok"], true);
        assert_eq!(result["result"], "-4");
    }

    #[test]
    fn evaluates_functions_and_constants() {
        let result = evaluate(json!({ "expression": "round(sin(pi / 2) * 1000)" }));
        assert_eq!(result["ok"], true);
        assert_eq!(result["result"], "1000");
    }

    #[test]
    fn evaluates_variables() {
        let result = evaluate(json!({
            "expression": "x * y + 1",
            "variables": { "x": 6, "y": 7 }
        }));
        assert_eq!(result["ok"], true);
        assert_eq!(result["result"], "43");
    }

    #[test]
    fn evaluates_complex_values() {
        let result = evaluate(json!({ "expression": "(1 + 2*i) * (3 - i)" }));
        assert_eq!(result["ok"], true);
        assert_eq!(result["result"], "5 + 5i");
        assert_eq!(result["real"], 5.0);
        assert_eq!(result["imaginary"], 5.0);
    }

    #[test]
    fn reports_unknown_identifier() {
        let result = evaluate(json!({ "expression": "missing + 1" }));
        assert_eq!(result["ok"], false);
        assert_eq!(result["code"], "NATIVE_EVALUATION_FAILED");
    }
}
