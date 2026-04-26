use crate::ClientNotification;
use crate::ClientRequest;
use crate::ServerNotification;
use crate::ServerRequest;
use crate::export_client_notification_schemas;
use crate::export_client_param_schemas;
use crate::export_client_response_schemas;
use crate::export_client_responses;
use crate::export_server_notification_schemas;
use crate::export_server_param_schemas;
use crate::export_server_response_schemas;
use crate::export_server_responses;
use anyhow::Context;
use anyhow::Result;
use anyhow::anyhow;
use lyra_protocol::protocol::RolloutLine;
use schemars::JsonSchema;
use schemars::schema_for;
use serde::Serialize;
use serde_json::Map;
use serde_json::Value;
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::collections::HashSet;
use std::ffi::OsStr;
use std::fs;
use std::io::Read;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::thread;
use ts_rs::TS;

pub(crate) const GENERATED_TS_HEADER: &str = "// GENERATED CODE! DO NOT MODIFY BY HAND!\n\n";
const IGNORED_DEFINITIONS: &[&str] = &["Option<()>"];
const JSON_V1_ALLOWLIST: &[&str] = &["InitializeParams", "InitializeResponse"];
const SPECIAL_DEFINITIONS: &[&str] = &[
    "ClientNotification",
    "ClientRequest",
    "ServerNotification",
    "ServerRequest",
];
const FLAT_V2_SHARED_DEFINITIONS: &[&str] = &["ClientRequest", "ServerNotification"];
const V1_CLIENT_REQUEST_METHODS: &[&str] = &[];
const EXCLUDED_SERVER_NOTIFICATION_METHODS_FOR_JSON: &[&str] = &[];

#[derive(Clone)]
pub struct GeneratedSchema {
    namespace: Option<String>,
    logical_name: String,
    value: Value,
    in_v1_dir: bool,
}

impl GeneratedSchema {
    fn namespace(&self) -> Option<&str> {
        self.namespace.as_deref()
    }

    fn logical_name(&self) -> &str {
        &self.logical_name
    }

    fn value(&self) -> &Value {
        &self.value
    }
}

type JsonSchemaEmitter = fn(&Path) -> Result<GeneratedSchema>;
pub fn generate_types(out_dir: &Path, prettier: Option<&Path>) -> Result<()> {
    generate_ts(out_dir, prettier)?;
    generate_json(out_dir)?;
    Ok(())
}

#[derive(Clone, Copy, Debug)]
pub struct GenerateTsOptions {
    pub generate_indices: bool,
    pub ensure_headers: bool,
    pub run_prettier: bool,
}

impl Default for GenerateTsOptions {
    fn default() -> Self {
        Self {
            generate_indices: true,
            ensure_headers: true,
            run_prettier: true,
        }
    }
}

pub fn generate_ts(out_dir: &Path, prettier: Option<&Path>) -> Result<()> {
    generate_ts_with_options(out_dir, prettier, GenerateTsOptions::default())
}

pub fn generate_ts_with_options(
    out_dir: &Path,
    prettier: Option<&Path>,
    options: GenerateTsOptions,
) -> Result<()> {
    let v2_out_dir = out_dir.join("v2");
    ensure_dir(out_dir)?;
    ensure_dir(&v2_out_dir)?;

    ClientRequest::export_all_to(out_dir)?;
    export_client_responses(out_dir)?;
    ClientNotification::export_all_to(out_dir)?;

    ServerRequest::export_all_to(out_dir)?;
    export_server_responses(out_dir)?;
    ServerNotification::export_all_to(out_dir)?;

    if options.generate_indices {
        generate_index_ts(out_dir)?;
        generate_index_ts(&v2_out_dir)?;
    }

    // Ensure our header is present on all TS files (root + subdirs like v2/).
    let ts_files = ts_files_in_recursive(out_dir)?;

    if options.ensure_headers {
        let worker_count = thread::available_parallelism()
            .map_or(1, usize::from)
            .min(ts_files.len().max(1));
        let chunk_size = ts_files.len().div_ceil(worker_count);
        thread::scope(|scope| -> Result<()> {
            let mut workers = Vec::new();
            for chunk in ts_files.chunks(chunk_size.max(1)) {
                workers.push(scope.spawn(move || -> Result<()> {
                    for file in chunk {
                        prepend_header_if_missing(file)?;
                    }
                    Ok(())
                }));
            }

            for worker in workers {
                worker
                    .join()
                    .map_err(|_| anyhow!("TypeScript header worker panicked"))??;
            }

            Ok(())
        })?;
    }

    // Optionally run Prettier on all generated TS files.
    if options.run_prettier
        && let Some(prettier_bin) = prettier
        && !ts_files.is_empty()
    {
        let status = Command::new(prettier_bin)
            .arg("--write")
            .arg("--log-level")
            .arg("warn")
            .args(ts_files.iter().map(|p| p.as_os_str()))
            .status()
            .with_context(|| format!("Failed to invoke Prettier at {}", prettier_bin.display()))?;
        if !status.success() {
            return Err(anyhow!("Prettier failed with status {status}"));
        }
    }

    trim_trailing_whitespace_in_ts_files(&ts_files)?;

    Ok(())
}

pub fn generate_json(out_dir: &Path) -> Result<()> {
    ensure_dir(out_dir)?;
    let envelope_emitters: Vec<JsonSchemaEmitter> = vec![
        |d| write_json_schema_with_return::<crate::RequestId>(d, "RequestId"),
        |d| write_json_schema_with_return::<crate::JSONRPCMessage>(d, "JSONRPCMessage"),
        |d| write_json_schema_with_return::<crate::JSONRPCRequest>(d, "JSONRPCRequest"),
        |d| write_json_schema_with_return::<crate::JSONRPCNotification>(d, "JSONRPCNotification"),
        |d| write_json_schema_with_return::<crate::JSONRPCResponse>(d, "JSONRPCResponse"),
        |d| write_json_schema_with_return::<crate::JSONRPCError>(d, "JSONRPCError"),
        |d| write_json_schema_with_return::<crate::JSONRPCErrorError>(d, "JSONRPCErrorError"),
        |d| write_json_schema_with_return::<crate::ClientRequest>(d, "ClientRequest"),
        |d| write_json_schema_with_return::<crate::ServerRequest>(d, "ServerRequest"),
        |d| write_json_schema_with_return::<crate::ClientNotification>(d, "ClientNotification"),
        |d| write_json_schema_with_return::<crate::ServerNotification>(d, "ServerNotification"),
    ];

    let mut schemas: Vec<GeneratedSchema> = Vec::new();
    for emit in &envelope_emitters {
        schemas.push(emit(out_dir)?);
    }

    schemas.extend(export_client_param_schemas(out_dir)?);
    schemas.extend(export_client_response_schemas(out_dir)?);
    schemas.extend(export_server_param_schemas(out_dir)?);
    schemas.extend(export_server_response_schemas(out_dir)?);
    schemas.extend(export_client_notification_schemas(out_dir)?);
    schemas.extend(export_server_notification_schemas(out_dir)?);
    schemas
        .retain(|schema| !schema.in_v1_dir || JSON_V1_ALLOWLIST.contains(&schema.logical_name()));

    let bundle = build_schema_bundle(schemas)?;
    write_pretty_json(
        out_dir.join("lyra_app_server_protocol.schemas.json"),
        &bundle,
    )?;
    let flat_v2_bundle = build_flat_v2_schema(&bundle)?;
    write_pretty_json(
        out_dir.join("lyra_app_server_protocol.v2.schemas.json"),
        &flat_v2_bundle,
    )?;

    Ok(())
}

pub fn generate_internal_json_schema(out_dir: &Path) -> Result<()> {
    ensure_dir(out_dir)?;
    write_json_schema::<RolloutLine>(out_dir, "RolloutLine")?;
    Ok(())
}

fn build_schema_bundle(schemas: Vec<GeneratedSchema>) -> Result<Value> {
    let namespaced_types = collect_namespaced_types(&schemas);
    let mut definitions = Map::new();

    for schema in schemas {
        let GeneratedSchema {
            namespace,
            logical_name,
            mut value,
            in_v1_dir,
        } = schema;

        if IGNORED_DEFINITIONS.contains(&logical_name.as_str()) {
            continue;
        }

        if let Some(ref ns) = namespace {
            rewrite_refs_to_namespace(&mut value, ns);
        } else {
            rewrite_refs_to_known_namespaces(&mut value, &namespaced_types);
        }

        let mut forced_namespace_refs: Vec<(String, String)> = Vec::new();
        if let Value::Object(ref mut obj) = value
            && let Some(defs) = obj.remove("definitions")
            && let Value::Object(defs_obj) = defs
        {
            for (def_name, mut def_schema) in defs_obj {
                if IGNORED_DEFINITIONS.contains(&def_name.as_str()) {
                    continue;
                }
                if SPECIAL_DEFINITIONS.contains(&def_name.as_str()) {
                    continue;
                }
                annotate_schema(&mut def_schema, Some(def_name.as_str()));
                let target_namespace = match namespace {
                    Some(ref ns) => Some(ns.clone()),
                    None => namespace_for_definition(&def_name, &namespaced_types)
                        .cloned()
                        .filter(|_| !in_v1_dir),
                };
                if let Some(ref ns) = target_namespace {
                    if namespace.as_deref() == Some(ns.as_str()) {
                        rewrite_refs_to_namespace(&mut def_schema, ns);
                        insert_into_namespace(&mut definitions, ns, def_name.clone(), def_schema)?;
                    } else if !forced_namespace_refs
                        .iter()
                        .any(|(name, existing_ns)| name == &def_name && existing_ns == ns)
                    {
                        forced_namespace_refs.push((def_name.clone(), ns.clone()));
                    }
                } else {
                    definitions.insert(def_name, def_schema);
                }
            }
        }

        for (name, ns) in forced_namespace_refs {
            rewrite_named_ref_to_namespace(&mut value, &ns, &name);
        }

        if let Some(ref ns) = namespace {
            insert_into_namespace(&mut definitions, ns, logical_name.clone(), value)?;
        } else {
            definitions.insert(logical_name, value);
        }
    }

    let mut root = Map::new();
    root.insert(
        "$schema".to_string(),
        Value::String("http://json-schema.org/draft-07/schema#".into()),
    );
    root.insert(
        "title".to_string(),
        Value::String("LyraAppServerProtocol".into()),
    );
    root.insert("type".to_string(), Value::String("object".into()));
    root.insert("definitions".to_string(), Value::Object(definitions));

    Ok(Value::Object(root))
}

/// Build a datamodel-code-generator-friendly v2 bundle from the mixed export.
///
/// The full bundle keeps v2 schemas nested under `definitions.v2`, plus a few
/// shared root definitions like `ClientRequest` and `ServerNotification`.
/// Python codegen only walks one definitions map level, so
/// a direct feed would treat `v2` itself as a schema and miss unreferenced v2
/// leaves. This helper flattens all v2 definitions to the root definitions map,
/// then pulls in the shared root schemas and any non-v2 transitive deps they
/// still reference. Keep the shared root unions intact here: some valid
/// request/notification/event variants are inline or only reference shared root
/// helpers, so filtering them by the presence of a `#/definitions/v2/` ref
/// would silently drop real API surface from the flat bundle.
fn build_flat_v2_schema(bundle: &Value) -> Result<Value> {
    let Value::Object(root) = bundle else {
        return Err(anyhow!("expected bundle root to be an object"));
    };
    let definitions = root
        .get("definitions")
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow!("expected bundle definitions map"))?;
    let v2_definitions = definitions
        .get("v2")
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow!("expected v2 namespace in bundle definitions"))?;

    let mut flat_root = root.clone();
    let title = root
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("LyraAppServerProtocol");
    let mut flat_definitions = v2_definitions.clone();
    let mut shared_definitions = Map::new();
    let mut non_v2_refs = HashSet::new();

    for shared in FLAT_V2_SHARED_DEFINITIONS {
        let Some(shared_schema) = definitions.get(*shared) else {
            continue;
        };
        let shared_schema = shared_schema.clone();
        non_v2_refs.extend(collect_non_v2_refs(&shared_schema));
        shared_definitions.insert((*shared).to_string(), shared_schema);
    }

    for name in collect_definition_dependencies(definitions, non_v2_refs) {
        if name == "v2" || flat_definitions.contains_key(&name) {
            continue;
        }
        if let Some(schema) = definitions.get(&name) {
            flat_definitions.insert(name, schema.clone());
        }
    }

    flat_definitions.extend(shared_definitions);
    flat_root.insert("title".to_string(), Value::String(format!("{title}V2")));
    flat_root.insert("definitions".to_string(), Value::Object(flat_definitions));
    let mut flat_bundle = Value::Object(flat_root);
    rewrite_ref_prefix(&mut flat_bundle, "#/definitions/v2/", "#/definitions/");
    ensure_no_ref_prefix(&flat_bundle, "#/definitions/v2/", "flat v2")?;
    ensure_referenced_definitions_present(&flat_bundle, "flat v2")?;
    Ok(flat_bundle)
}

fn collect_non_v2_refs(value: &Value) -> HashSet<String> {
    let mut refs = HashSet::new();
    collect_non_v2_refs_inner(value, &mut refs);
    refs
}

fn collect_non_v2_refs_inner(value: &Value, refs: &mut HashSet<String>) {
    match value {
        Value::Object(obj) => {
            if let Some(Value::String(reference)) = obj.get("$ref")
                && let Some(name) = reference.strip_prefix("#/definitions/")
                && !reference.starts_with("#/definitions/v2/")
            {
                refs.insert(name.to_string());
            }
            for child in obj.values() {
                collect_non_v2_refs_inner(child, refs);
            }
        }
        Value::Array(items) => {
            for child in items {
                collect_non_v2_refs_inner(child, refs);
            }
        }
        _ => {}
    }
}

fn collect_definition_dependencies(
    definitions: &Map<String, Value>,
    names: HashSet<String>,
) -> HashSet<String> {
    let mut seen = HashSet::new();
    let mut to_process: Vec<String> = names.into_iter().collect();
    while let Some(name) = to_process.pop() {
        if !seen.insert(name.clone()) {
            continue;
        }
        let Some(schema) = definitions.get(&name) else {
            continue;
        };
        for dep in collect_non_v2_refs(schema) {
            if !seen.contains(&dep) {
                to_process.push(dep);
            }
        }
    }
    seen
}

fn rewrite_ref_prefix(value: &mut Value, prefix: &str, replacement: &str) {
    match value {
        Value::Object(obj) => {
            if let Some(Value::String(reference)) = obj.get_mut("$ref") {
                *reference = reference.replace(prefix, replacement);
            }
            for child in obj.values_mut() {
                rewrite_ref_prefix(child, prefix, replacement);
            }
        }
        Value::Array(items) => {
            for child in items {
                rewrite_ref_prefix(child, prefix, replacement);
            }
        }
        _ => {}
    }
}

fn ensure_no_ref_prefix(value: &Value, prefix: &str, label: &str) -> Result<()> {
    if let Some(reference) = first_ref_with_prefix(value, prefix) {
        return Err(anyhow!(
            "{label} schema still references namespaced definitions; found {reference}"
        ));
    }
    Ok(())
}

fn first_ref_with_prefix(value: &Value, prefix: &str) -> Option<String> {
    match value {
        Value::Object(obj) => {
            if let Some(Value::String(reference)) = obj.get("$ref")
                && reference.starts_with(prefix)
            {
                return Some(reference.clone());
            }
            obj.values()
                .find_map(|child| first_ref_with_prefix(child, prefix))
        }
        Value::Array(items) => items
            .iter()
            .find_map(|child| first_ref_with_prefix(child, prefix)),
        _ => None,
    }
}

fn ensure_referenced_definitions_present(schema: &Value, label: &str) -> Result<()> {
    let definitions = schema
        .get("definitions")
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow!("expected definitions map in {label} schema"))?;
    let mut missing = HashSet::new();
    collect_missing_definitions(schema, definitions, &mut missing);
    if missing.is_empty() {
        return Ok(());
    }
    let mut missing_names: Vec<String> = missing.into_iter().collect();
    missing_names.sort();
    Err(anyhow!(
        "{label} schema missing definitions: {}",
        missing_names.join(", ")
    ))
}

fn collect_missing_definitions(
    value: &Value,
    definitions: &Map<String, Value>,
    missing: &mut HashSet<String>,
) {
    match value {
        Value::Object(obj) => {
            if let Some(Value::String(reference)) = obj.get("$ref")
                && let Some(name) = reference.strip_prefix("#/definitions/")
            {
                let name = name.split('/').next().unwrap_or(name);
                if !definitions.contains_key(name) {
                    missing.insert(name.to_string());
                }
            }
            for child in obj.values() {
                collect_missing_definitions(child, definitions, missing);
            }
        }
        Value::Array(items) => {
            for child in items {
                collect_missing_definitions(child, definitions, missing);
            }
        }
        _ => {}
    }
}

fn insert_into_namespace(
    definitions: &mut Map<String, Value>,
    namespace: &str,
    name: String,
    schema: Value,
) -> Result<()> {
    let entry = definitions
        .entry(namespace.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    match entry {
        Value::Object(map) => {
            insert_definition(map, name, schema, &format!("namespace `{namespace}`"))
        }
        _ => Err(anyhow!("expected namespace {namespace} to be an object")),
    }
}

fn insert_definition(
    definitions: &mut Map<String, Value>,
    name: String,
    schema: Value,
    location: &str,
) -> Result<()> {
    if let Some(existing) = definitions.get(&name) {
        if existing == &schema {
            return Ok(());
        }

        let existing_title = existing
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("<untitled>");
        let new_title = schema
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("<untitled>");
        return Err(anyhow!(
            "schema definition collision in {location}: {name} (existing title: {existing_title}, new title: {new_title}); use #[schemars(rename = \"...\")] to rename one of the conflicting schema definitions"
        ));
    }

    definitions.insert(name, schema);
    Ok(())
}

fn write_json_schema_with_return<T>(out_dir: &Path, name: &str) -> Result<GeneratedSchema>
where
    T: JsonSchema,
{
    let file_stem = name.trim();
    let (raw_namespace, logical_name) = split_namespace(file_stem);
    let include_in_json_codegen =
        raw_namespace != Some("v1") || JSON_V1_ALLOWLIST.contains(&logical_name);
    let schema = schema_for!(T);
    let mut schema_value = serde_json::to_value(schema)?;
    if include_in_json_codegen {
        if file_stem == "ClientRequest" {
            strip_v1_client_request_variants_from_json_schema(&mut schema_value);
        } else if file_stem == "ServerNotification" {
            strip_v1_server_notification_variants_from_json_schema(&mut schema_value);
        }
        enforce_numbered_definition_collision_overrides(file_stem, &mut schema_value);
        annotate_schema(&mut schema_value, Some(file_stem));
    }
    // If the name looks like a namespaced path (e.g., "v2::Type"), mirror
    // the TypeScript layout and write to out_dir/v2/Type.json. Otherwise
    // write alongside the legacy files.
    let out_path = if let Some(ns) = raw_namespace {
        let dir = out_dir.join(ns);
        ensure_dir(&dir)?;
        dir.join(format!("{logical_name}.json"))
    } else {
        out_dir.join(format!("{file_stem}.json"))
    };

    if include_in_json_codegen && !IGNORED_DEFINITIONS.contains(&logical_name) {
        write_pretty_json(out_path, &schema_value)
            .with_context(|| format!("Failed to write JSON schema for {file_stem}"))?;
    }

    let namespace = match raw_namespace {
        Some("v1") | None => None,
        Some(ns) => Some(ns.to_string()),
    };
    Ok(GeneratedSchema {
        in_v1_dir: raw_namespace == Some("v1"),
        namespace,
        logical_name: logical_name.to_string(),
        value: schema_value,
    })
}

fn enforce_numbered_definition_collision_overrides(schema_name: &str, schema: &mut Value) {
    for defs_key in ["definitions", "$defs"] {
        let Some(defs) = schema.get(defs_key).and_then(Value::as_object) else {
            continue;
        };
        detect_numbered_definition_collisions(schema_name, defs_key, defs);
    }
}

fn strip_v1_client_request_variants_from_json_schema(schema: &mut Value) {
    let v1_methods: HashSet<&str> = V1_CLIENT_REQUEST_METHODS.iter().copied().collect();
    strip_method_variants_from_json_schema(schema, &v1_methods);
}

fn strip_v1_server_notification_variants_from_json_schema(schema: &mut Value) {
    let methods: HashSet<&str> = EXCLUDED_SERVER_NOTIFICATION_METHODS_FOR_JSON
        .iter()
        .copied()
        .collect();
    strip_method_variants_from_json_schema(schema, &methods);
}

fn strip_method_variants_from_json_schema(schema: &mut Value, methods_to_remove: &HashSet<&str>) {
    {
        let Some(root) = schema.as_object_mut() else {
            return;
        };
        let Some(Value::Array(variants)) = root.get_mut("oneOf") else {
            return;
        };
        variants.retain(|variant| !is_method_variant_in_set(variant, methods_to_remove));
    }

    let reachable = reachable_local_definitions(schema, "definitions");
    let Some(root) = schema.as_object_mut() else {
        return;
    };
    if let Some(definitions) = root.get_mut("definitions").and_then(Value::as_object_mut) {
        definitions.retain(|name, _| reachable.contains(name));
    }
}

fn is_method_variant_in_set(value: &Value, methods: &HashSet<&str>) -> bool {
    let Value::Object(map) = value else {
        return false;
    };
    let Some(properties) = map.get("properties").and_then(Value::as_object) else {
        return false;
    };
    let Some(method_schema) = properties.get("method") else {
        return false;
    };
    let Some(method) = string_literal(method_schema) else {
        return false;
    };
    methods.contains(method)
}

fn reachable_local_definitions(schema: &Value, defs_key: &str) -> HashSet<String> {
    let Some(definitions) = schema.get(defs_key).and_then(Value::as_object) else {
        return HashSet::new();
    };
    let mut queue: Vec<String> = Vec::new();
    let mut reachable: HashSet<String> = HashSet::new();

    collect_local_definition_refs_excluding_maps(schema, defs_key, &mut queue, &mut reachable);

    while let Some(name) = queue.pop() {
        if let Some(def_schema) = definitions.get(&name) {
            collect_local_definition_refs(def_schema, defs_key, &mut queue, &mut reachable);
        }
    }
    reachable
}

fn collect_local_definition_refs_excluding_maps(
    value: &Value,
    defs_key: &str,
    queue: &mut Vec<String>,
    reachable: &mut HashSet<String>,
) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                if key == defs_key || key == "$defs" || key == "definitions" {
                    continue;
                }
                collect_local_definition_refs_excluding_maps(child, defs_key, queue, reachable);
            }
        }
        Value::Array(items) => {
            for child in items {
                collect_local_definition_refs_excluding_maps(child, defs_key, queue, reachable);
            }
        }
        _ => {}
    }
    collect_local_definition_ref_here(value, defs_key, queue, reachable);
}

fn collect_local_definition_refs(
    value: &Value,
    defs_key: &str,
    queue: &mut Vec<String>,
    reachable: &mut HashSet<String>,
) {
    collect_local_definition_ref_here(value, defs_key, queue, reachable);
    match value {
        Value::Object(map) => {
            for child in map.values() {
                collect_local_definition_refs(child, defs_key, queue, reachable);
            }
        }
        Value::Array(items) => {
            for child in items {
                collect_local_definition_refs(child, defs_key, queue, reachable);
            }
        }
        _ => {}
    }
}

fn collect_local_definition_ref_here(
    value: &Value,
    defs_key: &str,
    queue: &mut Vec<String>,
    reachable: &mut HashSet<String>,
) {
    let Some(reference) = value
        .as_object()
        .and_then(|obj| obj.get("$ref"))
        .and_then(Value::as_str)
    else {
        return;
    };
    let Some(name) = reference.strip_prefix(&format!("#/{defs_key}/")) else {
        return;
    };
    let name = name.split('/').next().unwrap_or(name);
    if reachable.insert(name.to_string()) {
        queue.push(name.to_string());
    }
}

fn detect_numbered_definition_collisions(
    schema_name: &str,
    defs_key: &str,
    defs: &Map<String, Value>,
) {
    for generated_name in defs.keys() {
        let base_name = generated_name.trim_end_matches(|c: char| c.is_ascii_digit());
        if base_name == generated_name || !defs.contains_key(base_name) {
            continue;
        }

        panic!(
            "Numbered definition naming collision detected: schema={schema_name}|container={defs_key}|generated={generated_name}|base={base_name}"
        );
    }
}

pub(crate) fn write_json_schema<T>(out_dir: &Path, name: &str) -> Result<GeneratedSchema>
where
    T: JsonSchema,
{
    write_json_schema_with_return::<T>(out_dir, name)
}

fn write_pretty_json(path: PathBuf, value: &impl Serialize) -> Result<()> {
    let json = serde_json::to_vec_pretty(value)
        .with_context(|| format!("Failed to serialize JSON schema to {}", path.display()))?;
    fs::write(&path, json).with_context(|| format!("Failed to write {}", path.display()))?;
    Ok(())
}

/// Split a fully-qualified type name like "v2::Type" into its namespace and logical name.
fn split_namespace(name: &str) -> (Option<&str>, &str) {
    name.split_once("::")
        .map_or((None, name), |(ns, rest)| (Some(ns), rest))
}

/// Recursively rewrite $ref values that point at "#/definitions/..." so that
/// they point to a namespaced location under the bundle.
fn rewrite_refs_to_namespace(value: &mut Value, ns: &str) {
    match value {
        Value::Object(obj) => {
            if let Some(Value::String(r)) = obj.get_mut("$ref")
                && let Some(suffix) = r.strip_prefix("#/definitions/")
            {
                let prefix = format!("{ns}/");
                if !suffix.starts_with(&prefix) {
                    *r = format!("#/definitions/{ns}/{suffix}");
                }
            }
            for v in obj.values_mut() {
                rewrite_refs_to_namespace(v, ns);
            }
        }
        Value::Array(items) => {
            for v in items.iter_mut() {
                rewrite_refs_to_namespace(v, ns);
            }
        }
        _ => {}
    }
}

/// Recursively rewrite bare root definition refs to the namespace that owns the
/// referenced type in the bundle.
///
/// The mixed export contains shared root helper schemas that are intentionally
/// left outside the `v2` namespace, but some of their extracted child
/// definitions still contain refs like `#/definitions/ThreadId`. When the real
/// schema only exists under `#/definitions/v2/ThreadId`, those refs become
/// dangling and downstream codegen falls back to placeholder `Any` models. This
/// rewrite keeps the shared helpers at the root while retargeting their refs to
/// the namespaced definitions that actually exist.
fn rewrite_refs_to_known_namespaces(value: &mut Value, types: &HashMap<String, String>) {
    match value {
        Value::Object(obj) => {
            if let Some(Value::String(reference)) = obj.get_mut("$ref")
                && let Some(suffix) = reference.strip_prefix("#/definitions/")
            {
                let (name, tail) = suffix
                    .split_once('/')
                    .map_or((suffix, None), |(name, tail)| (name, Some(tail)));
                if let Some(ns) = namespace_for_definition(name, types) {
                    let tail = tail.map_or(String::new(), |rest| format!("/{rest}"));
                    *reference = format!("#/definitions/{ns}/{name}{tail}");
                }
            }
            for v in obj.values_mut() {
                rewrite_refs_to_known_namespaces(v, types);
            }
        }
        Value::Array(items) => {
            for v in items.iter_mut() {
                rewrite_refs_to_known_namespaces(v, types);
            }
        }
        _ => {}
    }
}

fn collect_namespaced_types(schemas: &[GeneratedSchema]) -> HashMap<String, String> {
    let mut types = HashMap::new();
    for schema in schemas {
        if let Some(ns) = schema.namespace() {
            types
                .entry(schema.logical_name().to_string())
                .or_insert_with(|| ns.to_string());
            if let Some(Value::Object(defs)) = schema.value().get("definitions") {
                for key in defs.keys() {
                    types.entry(key.clone()).or_insert_with(|| ns.to_string());
                }
            }
            if let Some(Value::Object(defs)) = schema.value().get("$defs") {
                for key in defs.keys() {
                    types.entry(key.clone()).or_insert_with(|| ns.to_string());
                }
            }
        }
    }
    types
}

fn namespace_for_definition<'a>(
    name: &str,
    types: &'a HashMap<String, String>,
) -> Option<&'a String> {
    if let Some(ns) = types.get(name) {
        return Some(ns);
    }
    let trimmed = name.trim_end_matches(|c: char| c.is_ascii_digit());
    if trimmed != name {
        return types.get(trimmed);
    }
    None
}

fn variant_definition_name(base: &str, variant: &Value) -> Option<String> {
    if let Some(props) = variant.get("properties").and_then(Value::as_object) {
        if let Some(method_literal) = literal_from_property(props, "method") {
            let pascal = to_pascal_case(method_literal);
            return Some(match base {
                "ClientRequest" | "ServerRequest" => format!("{pascal}Request"),
                "ClientNotification" | "ServerNotification" => format!("{pascal}Notification"),
                _ => format!("{pascal}{base}"),
            });
        }

        if let Some(type_literal) = literal_from_property(props, "type") {
            let pascal = to_pascal_case(type_literal);
            return Some(match base {
                "EventMsg" => format!("{pascal}EventMsg"),
                _ => format!("{pascal}{base}"),
            });
        }

        if props.len() == 1
            && let Some(key) = props.keys().next()
        {
            let pascal = props
                .get(key)
                .and_then(string_literal)
                .map(to_pascal_case)
                .unwrap_or_else(|| to_pascal_case(key));
            return Some(format!("{pascal}{base}"));
        }
    }

    if let Some(required) = variant.get("required").and_then(Value::as_array)
        && required.len() == 1
        && let Some(key) = required[0].as_str()
    {
        let pascal = to_pascal_case(key);
        return Some(format!("{pascal}{base}"));
    }

    None
}

fn literal_from_property<'a>(props: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    props.get(key).and_then(string_literal)
}

fn string_literal(value: &Value) -> Option<&str> {
    value.get("const").and_then(Value::as_str).or_else(|| {
        value
            .get("enum")
            .and_then(Value::as_array)
            .and_then(|arr| arr.first())
            .and_then(Value::as_str)
    })
}

fn annotate_schema(value: &mut Value, base: Option<&str>) {
    match value {
        Value::Object(map) => annotate_object(map, base),
        Value::Array(items) => {
            for item in items {
                annotate_schema(item, base);
            }
        }
        _ => {}
    }
}

fn annotate_object(map: &mut Map<String, Value>, base: Option<&str>) {
    let owner = map.get("title").and_then(Value::as_str).map(str::to_owned);
    if let Some(owner) = owner.as_deref()
        && let Some(Value::Object(props)) = map.get_mut("properties")
    {
        set_discriminator_titles(props, owner);
    }

    if let Some(Value::Array(variants)) = map.get_mut("oneOf") {
        annotate_variant_list(variants, base);
    }
    if let Some(Value::Array(variants)) = map.get_mut("anyOf") {
        annotate_variant_list(variants, base);
    }

    if let Some(Value::Object(defs)) = map.get_mut("definitions") {
        for (name, schema) in defs.iter_mut() {
            annotate_schema(schema, Some(name.as_str()));
        }
    }

    if let Some(Value::Object(defs)) = map.get_mut("$defs") {
        for (name, schema) in defs.iter_mut() {
            annotate_schema(schema, Some(name.as_str()));
        }
    }

    if let Some(Value::Object(props)) = map.get_mut("properties") {
        for value in props.values_mut() {
            annotate_schema(value, base);
        }
    }

    if let Some(items) = map.get_mut("items") {
        annotate_schema(items, base);
    }

    if let Some(additional) = map.get_mut("additionalProperties") {
        annotate_schema(additional, base);
    }

    for (key, child) in map.iter_mut() {
        match key.as_str() {
            "oneOf"
            | "anyOf"
            | "definitions"
            | "$defs"
            | "properties"
            | "items"
            | "additionalProperties" => {}
            _ => annotate_schema(child, base),
        }
    }
}

fn annotate_variant_list(variants: &mut [Value], base: Option<&str>) {
    let mut seen = HashSet::new();

    for variant in variants.iter() {
        if let Some(name) = variant_title(variant) {
            seen.insert(name.to_owned());
        }
    }

    for variant in variants.iter_mut() {
        let mut variant_name = variant_title(variant).map(str::to_owned);

        if variant_name.is_none()
            && let Some(base_name) = base
            && let Some(name) = variant_definition_name(base_name, variant)
        {
            let candidate = name.clone();
            if seen.contains(&candidate) {
                let collision_key = variant_title_collision_key(base_name, &name, variant);
                panic!(
                    "Variant title naming collision detected: {collision_key} (generated name: {name})"
                );
            }
            if let Some(obj) = variant.as_object_mut() {
                obj.insert("title".into(), Value::String(candidate.clone()));
            }
            seen.insert(candidate.clone());
            variant_name = Some(candidate);
        }

        if let Some(name) = variant_name.as_deref()
            && let Some(obj) = variant.as_object_mut()
            && let Some(Value::Object(props)) = obj.get_mut("properties")
        {
            set_discriminator_titles(props, name);
        }

        annotate_schema(variant, base);
    }
}

fn variant_title_collision_key(base: &str, generated_name: &str, variant: &Value) -> String {
    let mut parts = vec![
        format!("base={base}"),
        format!("generated={generated_name}"),
    ];

    if let Some(props) = variant.get("properties").and_then(Value::as_object) {
        for key in DISCRIMINATOR_KEYS {
            if let Some(value) = literal_from_property(props, key) {
                parts.push(format!("{key}={value}"));
            }
        }
        for (key, value) in props {
            if DISCRIMINATOR_KEYS.contains(&key.as_str()) {
                continue;
            }
            if let Some(literal) = string_literal(value) {
                parts.push(format!("literal:{key}={literal}"));
            }
        }

        if props.len() == 1
            && let Some(key) = props.keys().next()
        {
            parts.push(format!("only_property={key}"));
        }
    }

    if let Some(required) = variant.get("required").and_then(Value::as_array)
        && required.len() == 1
        && let Some(key) = required[0].as_str()
    {
        parts.push(format!("required_only={key}"));
    }

    if parts.len() == 2 {
        parts.push(format!("variant={variant}"));
    }

    parts.join("|")
}

const DISCRIMINATOR_KEYS: &[&str] = &["type", "method", "mode", "status", "role", "reason"];

fn set_discriminator_titles(props: &mut Map<String, Value>, owner: &str) {
    for key in DISCRIMINATOR_KEYS {
        if let Some(prop_schema) = props.get_mut(*key)
            && string_literal(prop_schema).is_some()
            && let Value::Object(prop_obj) = prop_schema
        {
            if prop_obj.contains_key("title") {
                continue;
            }
            let suffix = to_pascal_case(key);
            prop_obj.insert("title".into(), Value::String(format!("{owner}{suffix}")));
        }
    }
}

fn variant_title(value: &Value) -> Option<&str> {
    value
        .as_object()
        .and_then(|obj| obj.get("title"))
        .and_then(Value::as_str)
}

fn to_pascal_case(input: &str) -> String {
    let mut result = String::new();
    let mut capitalize_next = true;

    for c in input.chars() {
        if c == '_' || c == '-' {
            capitalize_next = true;
            continue;
        }

        if capitalize_next {
            result.extend(c.to_uppercase());
            capitalize_next = false;
        } else {
            result.push(c);
        }
    }

    result
}

fn ensure_dir(dir: &Path) -> Result<()> {
    fs::create_dir_all(dir)
        .with_context(|| format!("Failed to create output directory {}", dir.display()))
}

fn rewrite_named_ref_to_namespace(value: &mut Value, ns: &str, name: &str) {
    let direct = format!("#/definitions/{name}");
    let prefixed = format!("{direct}/");
    let replacement = format!("#/definitions/{ns}/{name}");
    let replacement_prefixed = format!("{replacement}/");
    match value {
        Value::Object(obj) => {
            if let Some(Value::String(reference)) = obj.get_mut("$ref") {
                if reference == &direct {
                    *reference = replacement;
                } else if let Some(rest) = reference.strip_prefix(&prefixed) {
                    *reference = format!("{replacement_prefixed}{rest}");
                }
            }
            for child in obj.values_mut() {
                rewrite_named_ref_to_namespace(child, ns, name);
            }
        }
        Value::Array(items) => {
            for child in items {
                rewrite_named_ref_to_namespace(child, ns, name);
            }
        }
        _ => {}
    }
}

fn prepend_header_if_missing(path: &Path) -> Result<()> {
    let mut content = String::new();
    {
        let mut f = fs::File::open(path)
            .with_context(|| format!("Failed to open {} for reading", path.display()))?;
        f.read_to_string(&mut content)
            .with_context(|| format!("Failed to read {}", path.display()))?;
    }

    if content.starts_with(GENERATED_TS_HEADER) {
        return Ok(());
    }

    let mut f = fs::File::create(path)
        .with_context(|| format!("Failed to open {} for writing", path.display()))?;
    f.write_all(GENERATED_TS_HEADER.as_bytes())
        .with_context(|| format!("Failed to write header to {}", path.display()))?;
    f.write_all(content.as_bytes())
        .with_context(|| format!("Failed to write content to {}", path.display()))?;
    Ok(())
}

fn ts_files_in(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    for entry in
        fs::read_dir(dir).with_context(|| format!("Failed to read dir {}", dir.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() && path.extension() == Some(OsStr::new("ts")) {
            files.push(path);
        }
    }
    files.sort();
    Ok(files)
}

fn ts_files_in_recursive(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for entry in
            fs::read_dir(&d).with_context(|| format!("Failed to read dir {}", d.display()))?
        {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.is_file() && path.extension() == Some(OsStr::new("ts")) {
                files.push(path);
            }
        }
    }
    files.sort();
    Ok(files)
}

fn trim_trailing_whitespace_in_ts_files(paths: &[PathBuf]) -> Result<()> {
    for path in paths {
        let content = fs::read_to_string(path)
            .with_context(|| format!("Failed to read {}", path.display()))?;
        let trimmed = trim_trailing_line_whitespace(&content);
        if trimmed != content {
            fs::write(path, trimmed)
                .with_context(|| format!("Failed to write {}", path.display()))?;
        }
    }
    Ok(())
}

pub(crate) fn trim_trailing_line_whitespace(content: &str) -> String {
    let mut trimmed = String::with_capacity(content.len());
    for line in content.split_inclusive('\n') {
        if let Some(line_without_newline) = line.strip_suffix('\n') {
            trimmed.push_str(line_without_newline.trim_end_matches([' ', '\t']));
            trimmed.push('\n');
        } else {
            trimmed.push_str(line.trim_end_matches([' ', '\t']));
        }
    }
    trimmed
}

/// Generate an index.ts file that re-exports all generated types.
/// This allows consumers to import all types from a single file.
fn generate_index_ts(out_dir: &Path) -> Result<PathBuf> {
    let content = generated_index_ts_with_header(index_ts_entries(
        &ts_files_in(out_dir)?
            .iter()
            .map(PathBuf::as_path)
            .collect::<Vec<_>>(),
        ts_files_in(&out_dir.join("v2"))
            .map(|v| !v.is_empty())
            .unwrap_or(false),
    ));

    let index_path = out_dir.join("index.ts");
    let mut f = fs::File::create(&index_path)
        .with_context(|| format!("Failed to create {}", index_path.display()))?;
    f.write_all(content.as_bytes())
        .with_context(|| format!("Failed to write {}", index_path.display()))?;
    Ok(index_path)
}

pub(crate) fn generate_index_ts_tree(tree: &mut BTreeMap<PathBuf, String>) {
    let root_entries = tree
        .keys()
        .filter(|path| path.components().count() == 1)
        .map(PathBuf::as_path)
        .collect::<Vec<_>>();
    let has_v2_ts = tree.keys().any(|path| {
        path.parent()
            .is_some_and(|parent| parent == Path::new("v2"))
            && path.extension() == Some(OsStr::new("ts"))
            && path.file_stem().is_some_and(|stem| stem != "index")
    });
    tree.insert(
        PathBuf::from("index.ts"),
        index_ts_entries(&root_entries, has_v2_ts),
    );

    let v2_entries = tree
        .keys()
        .filter(|path| {
            path.parent()
                .is_some_and(|parent| parent == Path::new("v2"))
        })
        .map(PathBuf::as_path)
        .collect::<Vec<_>>();
    if !v2_entries.is_empty() {
        tree.insert(
            PathBuf::from("v2").join("index.ts"),
            index_ts_entries(&v2_entries, /*has_v2_ts*/ false),
        );
    }
}

fn generated_index_ts_with_header(content: String) -> String {
    let mut with_header = String::with_capacity(GENERATED_TS_HEADER.len() + content.len());
    with_header.push_str(GENERATED_TS_HEADER);
    with_header.push_str(&content);
    with_header
}

fn index_ts_entries(paths: &[&Path], has_v2_ts: bool) -> String {
    let mut stems: Vec<String> = paths
        .iter()
        .filter(|path| path.extension() == Some(OsStr::new("ts")))
        .filter_map(|path| {
            let stem = path.file_stem()?.to_string_lossy().into_owned();
            if stem == "index" { None } else { Some(stem) }
        })
        .filter(|stem| stem != "EventMsg")
        .collect();
    stems.sort();
    stems.dedup();

    let mut entries = String::new();
    for name in stems {
        entries.push_str(&format!("export type {{ {name} }} from \"./{name}\";\n"));
    }
    if has_v2_ts {
        entries.push_str("export * as v2 from \"./v2\";\n");
    }
    entries
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema_fixtures::read_schema_fixture_subtree;
    use anyhow::Context;
    use anyhow::Result;
    use pretty_assertions::assert_eq;
    use std::collections::BTreeSet;
    use std::path::Path;
    use std::path::PathBuf;

    #[test]
    fn generated_ts_optional_nullable_fields_only_in_params() -> Result<()> {
        // Assert that "?: T | null" only appears in generated *Params types.
        let fixture_tree = read_schema_fixture_subtree(&schema_root()?, "typescript")?;

        let typescript_index = std::str::from_utf8(
            fixture_tree
                .get(Path::new("index.ts"))
                .ok_or_else(|| anyhow::anyhow!("missing index.ts fixture"))?,
        )?;
        assert_eq!(typescript_index.contains("export type { EventMsg }"), false);
        let mut undefined_offenders = Vec::new();
        let mut optional_nullable_offenders = BTreeSet::new();
        for (path, contents) in &fixture_tree {
            if !matches!(path.extension().and_then(|ext| ext.to_str()), Some("ts")) {
                continue;
            }

            // Only allow "?: T | null" in objects representing JSON-RPC requests,
            // which we assume are called "*Params".
            let allow_optional_nullable = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .is_some_and(|stem| {
                    stem.ends_with("Params")
                        || stem == "InitializeCapabilities"
                        || matches!(
                            stem,
                            "CollabAgentRef"
                                | "CollabAgentStatusEntry"
                                | "CollabAgentSpawnEndEvent"
                                | "CollabAgentInteractionEndEvent"
                                | "CollabCloseEndEvent"
                                | "CollabResumeBeginEvent"
                                | "CollabResumeEndEvent"
                        )
                });

            let contents = std::str::from_utf8(contents)?;
            if contents.contains("| undefined") {
                undefined_offenders.push(path.clone());
            }

            const SKIP_PREFIXES: &[&str] = &[
                "const ",
                "let ",
                "var ",
                "export const ",
                "export let ",
                "export var ",
            ];

            let mut search_start = 0;
            while let Some(idx) = contents[search_start..].find("| null") {
                let abs_idx = search_start + idx;
                // Find the property-colon for this field by scanning forward
                // from the start of the segment and ignoring nested braces,
                // brackets, and parens. This avoids colons inside nested
                // type literals like `{ [k in string]?: string }`.

                let line_start_idx = contents[..abs_idx].rfind('\n').map(|i| i + 1).unwrap_or(0);

                let mut segment_start_idx = line_start_idx;
                if let Some(rel_idx) = contents[line_start_idx..abs_idx].rfind(',') {
                    segment_start_idx = segment_start_idx.max(line_start_idx + rel_idx + 1);
                }
                if let Some(rel_idx) = contents[line_start_idx..abs_idx].rfind('{') {
                    segment_start_idx = segment_start_idx.max(line_start_idx + rel_idx + 1);
                }
                if let Some(rel_idx) = contents[line_start_idx..abs_idx].rfind('}') {
                    segment_start_idx = segment_start_idx.max(line_start_idx + rel_idx + 1);
                }

                // Scan forward for the colon that separates the field name from its type.
                let mut level_brace = 0_i32;
                let mut level_brack = 0_i32;
                let mut level_paren = 0_i32;
                let mut in_single = false;
                let mut in_double = false;
                let mut escape = false;
                let mut prop_colon_idx = None;
                for (i, ch) in contents[segment_start_idx..abs_idx].char_indices() {
                    let idx_abs = segment_start_idx + i;
                    if escape {
                        escape = false;
                        continue;
                    }
                    match ch {
                        '\\' => {
                            if in_single || in_double {
                                escape = true;
                            }
                        }
                        '\'' => {
                            if !in_double {
                                in_single = !in_single;
                            }
                        }
                        '"' => {
                            if !in_single {
                                in_double = !in_double;
                            }
                        }
                        '{' if !in_single && !in_double => level_brace += 1,
                        '}' if !in_single && !in_double => level_brace -= 1,
                        '[' if !in_single && !in_double => level_brack += 1,
                        ']' if !in_single && !in_double => level_brack -= 1,
                        '(' if !in_single && !in_double => level_paren += 1,
                        ')' if !in_single && !in_double => level_paren -= 1,
                        ':' if !in_single
                            && !in_double
                            && level_brace == 0
                            && level_brack == 0
                            && level_paren == 0 =>
                        {
                            prop_colon_idx = Some(idx_abs);
                            break;
                        }
                        _ => {}
                    }
                }

                let Some(colon_idx) = prop_colon_idx else {
                    search_start = abs_idx + 5;
                    continue;
                };

                let mut field_prefix = contents[segment_start_idx..colon_idx].trim();
                if field_prefix.is_empty() {
                    search_start = abs_idx + 5;
                    continue;
                }

                if let Some(comment_idx) = field_prefix.rfind("*/") {
                    field_prefix = field_prefix[comment_idx + 2..].trim_start();
                }

                if field_prefix.is_empty() {
                    search_start = abs_idx + 5;
                    continue;
                }

                if SKIP_PREFIXES
                    .iter()
                    .any(|prefix| field_prefix.starts_with(prefix))
                {
                    search_start = abs_idx + 5;
                    continue;
                }

                if field_prefix.contains('(') {
                    search_start = abs_idx + 5;
                    continue;
                }

                // If the last non-whitespace before ':' is '?', then this is an
                // optional field with a nullable type (i.e., "?: T | null").
                // These are only allowed in *Params types.
                if field_prefix.chars().rev().find(|c| !c.is_whitespace()) == Some('?')
                    && !allow_optional_nullable
                {
                    let line_number =
                        contents[..abs_idx].chars().filter(|c| *c == '\n').count() + 1;
                    let offending_line_end = contents[line_start_idx..]
                        .find('\n')
                        .map(|i| line_start_idx + i)
                        .unwrap_or(contents.len());
                    let offending_snippet = contents[line_start_idx..offending_line_end].trim();

                    optional_nullable_offenders.insert(format!(
                        "{}:{}: {offending_snippet}",
                        path.display(),
                        line_number
                    ));
                }

                search_start = abs_idx + 5;
            }
        }

        assert!(
            undefined_offenders.is_empty(),
            "Generated TypeScript still includes unions with `undefined` in {undefined_offenders:?}"
        );

        // If this assertion fails, it means a field was generated as "?: T | null",
        // which is both optional (undefined) and nullable (null), for a type not ending
        // in "Params" (which represent JSON-RPC requests).
        assert!(
            optional_nullable_offenders.is_empty(),
            "Generated TypeScript has optional nullable fields outside *Params types (disallowed '?: T | null'):\n{optional_nullable_offenders:?}"
        );

        Ok(())
    }

    fn schema_root() -> Result<PathBuf> {
        let typescript_index = lyra_utils_cargo_bin::find_resource!("schema/typescript/index.ts")
            .context("resolve TypeScript schema index.ts")?;
        let schema_root = typescript_index
            .parent()
            .and_then(|parent| parent.parent())
            .context("derive schema root from schema/typescript/index.ts")?
            .to_path_buf();
        Ok(schema_root)
    }

    #[test]
    fn build_schema_bundle_rewrites_root_helper_refs_to_namespaced_defs() -> Result<()> {
        let bundle = build_schema_bundle(vec![
            GeneratedSchema {
                namespace: None,
                logical_name: "LegacyEnvelope".to_string(),
                in_v1_dir: false,
                value: serde_json::json!({
                    "title": "LegacyEnvelope",
                    "type": "object",
                    "properties": {
                        "current_thread": { "$ref": "#/definitions/ThreadId" },
                        "turn_item": { "$ref": "#/definitions/TurnItem" }
                    },
                    "definitions": {
                        "TurnItem": {
                            "type": "object",
                            "properties": {
                                "thread_id": { "$ref": "#/definitions/ThreadId" },
                                "phase": { "$ref": "#/definitions/MessagePhase" },
                                "content": {
                                    "type": "array",
                                    "items": { "$ref": "#/definitions/UserInput" }
                                }
                            }
                        }
                    }
                }),
            },
            GeneratedSchema {
                namespace: Some("v2".to_string()),
                logical_name: "ThreadId".to_string(),
                in_v1_dir: false,
                value: serde_json::json!({
                    "title": "ThreadId",
                    "type": "string"
                }),
            },
            GeneratedSchema {
                namespace: Some("v2".to_string()),
                logical_name: "MessagePhase".to_string(),
                in_v1_dir: false,
                value: serde_json::json!({
                    "title": "MessagePhase",
                    "type": "string"
                }),
            },
            GeneratedSchema {
                namespace: Some("v2".to_string()),
                logical_name: "UserInput".to_string(),
                in_v1_dir: false,
                value: serde_json::json!({
                    "title": "UserInput",
                    "type": "string"
                }),
            },
        ])?;

        assert_eq!(
            bundle["definitions"]["LegacyEnvelope"]["properties"]["current_thread"]["$ref"],
            serde_json::json!("#/definitions/v2/ThreadId")
        );
        assert_eq!(
            bundle["definitions"]["LegacyEnvelope"]["properties"]["turn_item"]["$ref"],
            serde_json::json!("#/definitions/TurnItem")
        );
        assert_eq!(
            bundle["definitions"]["TurnItem"]["properties"]["thread_id"]["$ref"],
            serde_json::json!("#/definitions/v2/ThreadId")
        );
        assert_eq!(
            bundle["definitions"]["TurnItem"]["properties"]["phase"]["$ref"],
            serde_json::json!("#/definitions/v2/MessagePhase")
        );
        assert_eq!(
            bundle["definitions"]["TurnItem"]["properties"]["content"]["items"]["$ref"],
            serde_json::json!("#/definitions/v2/UserInput")
        );

        Ok(())
    }

    #[test]
    fn build_flat_v2_schema_keeps_shared_root_schemas_and_dependencies() -> Result<()> {
        let bundle = serde_json::json!({
            "$schema": "http://json-schema.org/draft-07/schema#",
            "title": "LyraAppServerProtocol",
            "type": "object",
            "definitions": {
                "ClientRequest": {
                    "oneOf": [
                        {
                            "title": "StartRequest",
                            "type": "object",
                            "properties": {
                                "params": { "$ref": "#/definitions/v2/ThreadStartParams" },
                                "shared": { "$ref": "#/definitions/SharedHelper" }
                            }
                        },
                        {
                            "title": "InitializeRequest",
                            "type": "object",
                            "properties": {
                                "params": { "$ref": "#/definitions/InitializeParams" }
                            }
                        },
                        {
                            "title": "LogoutRequest",
                            "type": "object",
                            "properties": {
                                "params": { "type": "null" }
                            }
                        }
                    ]
                },
                "EventMsg": {
                    "oneOf": [
                        { "$ref": "#/definitions/v2/ThreadStartedEventMsg" },
                        {
                            "title": "WarningEventMsg",
                            "type": "object",
                            "properties": {
                                "message": { "type": "string" },
                                "type": {
                                    "enum": ["warning"],
                                    "type": "string"
                                }
                            },
                            "required": ["message", "type"]
                        }
                    ]
                },
                "ServerNotification": {
                    "oneOf": [
                        { "$ref": "#/definitions/v2/ThreadStartedNotification" },
                        {
                            "title": "ServerRequestResolvedNotification",
                            "type": "object",
                            "properties": {
                                "params": { "$ref": "#/definitions/ServerRequestResolvedNotificationPayload" }
                            }
                        }
                    ]
                },
                "SharedHelper": {
                    "type": "object",
                    "properties": {
                        "leaf": { "$ref": "#/definitions/SharedLeaf" }
                    }
                },
                "SharedLeaf": {
                    "title": "SharedLeaf",
                    "type": "string"
                },
                "InitializeParams": {
                    "title": "InitializeParams",
                    "type": "string"
                },
                "ServerRequestResolvedNotificationPayload": {
                    "title": "ServerRequestResolvedNotificationPayload",
                    "type": "string"
                },
                "v2": {
                    "ThreadStartParams": {
                        "title": "ThreadStartParams",
                        "type": "object",
                        "properties": {
                            "cwd": { "type": "string" }
                        }
                    },
                    "ThreadStartResponse": {
                        "title": "ThreadStartResponse",
                        "type": "object",
                        "properties": {
                            "ok": { "type": "boolean" }
                        }
                    },
                    "ThreadStartedEventMsg": {
                        "title": "ThreadStartedEventMsg",
                        "type": "object",
                        "properties": {
                            "thread_id": { "type": "string" }
                        }
                    },
                    "ThreadStartedNotification": {
                        "title": "ThreadStartedNotification",
                        "type": "object",
                        "properties": {
                            "thread_id": { "type": "string" }
                        }
                    }
                }
            }
        });

        let flat_bundle = build_flat_v2_schema(&bundle)?;
        let definitions = flat_bundle["definitions"]
            .as_object()
            .expect("flat v2 schema should include definitions");

        assert_eq!(
            flat_bundle["title"],
            serde_json::json!("LyraAppServerProtocolV2")
        );
        assert_eq!(definitions.contains_key("v2"), false);
        assert_eq!(definitions.contains_key("ThreadStartParams"), true);
        assert_eq!(definitions.contains_key("ThreadStartResponse"), true);
        assert_eq!(definitions.contains_key("ThreadStartedNotification"), true);
        assert_eq!(definitions.contains_key("SharedHelper"), true);
        assert_eq!(definitions.contains_key("SharedLeaf"), true);
        assert_eq!(definitions.contains_key("InitializeParams"), true);
        assert_eq!(
            definitions.contains_key("ServerRequestResolvedNotificationPayload"),
            true
        );
        let client_request_titles: BTreeSet<String> = definitions["ClientRequest"]["oneOf"]
            .as_array()
            .expect("ClientRequest should remain a oneOf")
            .iter()
            .map(|variant| {
                variant["title"]
                    .as_str()
                    .expect("ClientRequest variant should have a title")
                    .to_string()
            })
            .collect();
        assert_eq!(
            client_request_titles,
            BTreeSet::from([
                "InitializeRequest".to_string(),
                "LogoutRequest".to_string(),
                "StartRequest".to_string(),
            ])
        );
        let notification_titles: BTreeSet<String> = definitions["ServerNotification"]["oneOf"]
            .as_array()
            .expect("ServerNotification should remain a oneOf")
            .iter()
            .map(|variant| {
                variant
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string()
            })
            .collect();
        assert_eq!(
            notification_titles,
            BTreeSet::from([
                "".to_string(),
                "ServerRequestResolvedNotification".to_string(),
            ])
        );
        assert_eq!(
            first_ref_with_prefix(&flat_bundle, "#/definitions/v2/").is_none(),
            true
        );

        Ok(())
    }
}
