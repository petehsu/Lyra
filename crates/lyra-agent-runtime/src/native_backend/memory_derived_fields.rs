use super::*;
use chrono::{Datelike, NaiveDate, Utc};

const DERIVED_AGE_KIND: &str = "age_years";
const DERIVED_TENURE_KIND: &str = "tenure_years";
const DERIVED_LOCALE_KIND: &str = "normalized_locale";
const DERIVED_INITIALS_KIND: &str = "name_initials";
const DERIVED_EMAIL_DOMAIN_KIND: &str = "email_domain";

pub(crate) fn apply_derived_fields_to_content(content: &mut Value) {
    let Some(map) = content.as_object_mut() else {
        return;
    };
    let kind = map
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let mut derived_fields = map
        .get("derivedFields")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    match kind.as_str() {
        "date_of_birth" => {
            if let Some(age) =
                derive_age_from_dob(map.get("dateOfBirth").or_else(|| map.get("dob")))
            {
                map.insert("derivedAgeYears".to_string(), json!(age));
                upsert_derived_field(
                    &mut derived_fields,
                    DERIVED_AGE_KIND,
                    json!(age),
                    "date_of_birth",
                );
            }
        }
        "full_name" | "legal_name" => {
            if let Some(initials) = derive_name_initials(
                map.get("fullName")
                    .or_else(|| map.get("legalName"))
                    .or_else(|| map.get("name")),
            ) {
                map.insert("derivedNameInitials".to_string(), json!(initials));
                upsert_derived_field(
                    &mut derived_fields,
                    DERIVED_INITIALS_KIND,
                    json!(initials),
                    &kind,
                );
            }
        }
        "contact_email" => {
            if let Some(domain) = derive_email_domain(
                map.get("email")
                    .or_else(|| map.get("contactEmail"))
                    .or_else(|| map.get("value")),
            ) {
                map.insert("derivedEmailDomain".to_string(), json!(domain));
                upsert_derived_field(
                    &mut derived_fields,
                    DERIVED_EMAIL_DOMAIN_KIND,
                    json!(domain),
                    "contact_email",
                );
            }
        }
        "start_date" | "employment_start" => {
            if let Some(tenure) = derive_tenure_years(
                map.get("startDate")
                    .or_else(|| map.get("employmentStart"))
                    .or_else(|| map.get("date")),
            ) {
                map.insert("derivedTenureYears".to_string(), json!(tenure));
                upsert_derived_field(
                    &mut derived_fields,
                    DERIVED_TENURE_KIND,
                    json!(tenure),
                    &kind,
                );
            }
        }
        "preferred_language" | "locale" => {
            if let Some(locale) = derive_normalized_locale(
                map.get("preferredLanguage")
                    .or_else(|| map.get("language"))
                    .or_else(|| map.get("locale")),
            ) {
                map.insert("derivedNormalizedLocale".to_string(), json!(locale));
                upsert_derived_field(
                    &mut derived_fields,
                    DERIVED_LOCALE_KIND,
                    json!(locale),
                    &kind,
                );
            }
        }
        _ => {}
    }

    if !derived_fields.is_empty() {
        map.insert("derivedFields".to_string(), Value::Array(derived_fields));
    }
}

pub(crate) fn apply_derived_fields_to_record(record: &mut LongTermMemoryRecord) {
    apply_derived_fields_to_content(&mut record.content);
}

fn upsert_derived_field(fields: &mut Vec<Value>, field: &str, value: Value, source: &str) {
    fields.retain(|entry| entry.get("field").and_then(Value::as_str) != Some(field));
    fields.push(json!({
        "field": field,
        "value": value,
        "source": source,
        "updatedAt": now(),
    }));
}

fn derive_age_from_dob(value: Option<&Value>) -> Option<u32> {
    let text = value.and_then(Value::as_str)?.trim();
    if text.is_empty() {
        return None;
    }
    let date = NaiveDate::parse_from_str(text, "%Y-%m-%d")
        .or_else(|_| NaiveDate::parse_from_str(text, "%Y/%m/%d"))
        .ok()?;
    years_since(date)
}

fn derive_tenure_years(value: Option<&Value>) -> Option<u32> {
    let text = value.and_then(Value::as_str)?.trim();
    if text.is_empty() {
        return None;
    }
    let date = NaiveDate::parse_from_str(text, "%Y-%m-%d")
        .or_else(|_| NaiveDate::parse_from_str(text, "%Y/%m/%d"))
        .ok()?;
    years_since(date)
}

fn years_since(date: NaiveDate) -> Option<u32> {
    let today = Utc::now().date_naive();
    let mut years = today.year() - date.year();
    if (today.month(), today.day()) < (date.month(), date.day()) {
        years -= 1;
    }
    (years >= 0).then_some(years as u32)
}

fn derive_name_initials(value: Option<&Value>) -> Option<String> {
    let text = value.and_then(Value::as_str)?.trim();
    if text.is_empty() {
        return None;
    }
    let initials = text
        .split_whitespace()
        .filter_map(|part| part.chars().next())
        .collect::<String>()
        .to_uppercase();
    (!initials.is_empty()).then_some(initials)
}

fn derive_email_domain(value: Option<&Value>) -> Option<String> {
    let email = value.and_then(Value::as_str)?.trim();
    let domain = email.rsplit('@').next()?.trim();
    (!domain.is_empty()).then(|| domain.to_lowercase())
}

fn derive_normalized_locale(value: Option<&Value>) -> Option<String> {
    let locale = value.and_then(Value::as_str)?.trim().to_lowercase();
    if locale.is_empty() {
        return None;
    }
    let normalized = locale.replace('_', "-");
    Some(normalized)
}
