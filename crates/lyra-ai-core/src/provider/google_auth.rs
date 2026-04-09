use std::collections::BTreeMap;
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use napi::Result;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::to_error;
use crate::profile::types::AiProviderProfile;
use crate::provider::types::secret_value;

const GOOGLE_CLOUD_PLATFORM_SCOPE: &str = "https://www.googleapis.com/auth/cloud-platform";
const GOOGLE_TOKEN_URI: &str = "https://oauth2.googleapis.com/token";

#[derive(Debug, Deserialize)]
struct GoogleServiceAccount {
    client_email: String,
    private_key: String,
    #[serde(default = "default_token_uri")]
    token_uri: String,
}

#[derive(Debug, Serialize)]
struct GoogleJwtClaims<'a> {
    iss: &'a str,
    sub: &'a str,
    aud: &'a str,
    scope: &'a str,
    iat: u64,
    exp: u64,
}

fn default_token_uri() -> String {
    GOOGLE_TOKEN_URI.to_string()
}

fn auth_config_value(profile: &AiProviderProfile, key: &str) -> Option<String> {
    profile
        .auth_config
        .get(key)
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| value.is_empty() == false)
        .map(str::to_string)
}

fn read_service_account_payload(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<String> {
    let inline_json = secret_value(secrets, "serviceAccountJson")
        .map(str::to_string)
        .or_else(|| auth_config_value(profile, "serviceAccountJson"));
    let file_path = auth_config_value(profile, "serviceAccountFile");

    match (inline_json, file_path) {
        (Some(_), Some(_)) => Err(to_error(
            "Vertex AI credentials can use either serviceAccountJson or serviceAccountFile, not both",
        )),
        (Some(json), None) => Ok(json),
        (None, Some(path)) => fs::read_to_string(&path)
            .map_err(|error| to_error(format!("failed to read Vertex AI service account file: {error}"))),
        (None, None) => Err(to_error(
            "Vertex AI requires serviceAccountJson or serviceAccountFile",
        )),
    }
}

fn load_service_account(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<GoogleServiceAccount> {
    let payload = read_service_account_payload(profile, secrets)?;
    serde_json::from_str::<GoogleServiceAccount>(&payload).map_err(|error| {
        to_error(format!(
            "failed to parse Vertex AI service account JSON: {error}"
        ))
    })
}

pub fn fetch_service_account_access_token(
    client: &Client,
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<String> {
    let service_account = load_service_account(profile, secrets)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| to_error(format!("failed to read system time: {error}")))?
        .as_secs();
    let claims = GoogleJwtClaims {
        iss: &service_account.client_email,
        sub: &service_account.client_email,
        aud: &service_account.token_uri,
        scope: GOOGLE_CLOUD_PLATFORM_SCOPE,
        iat: now,
        exp: now + 3_500,
    };
    let assertion = jsonwebtoken::encode(
        &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256),
        &claims,
        &jsonwebtoken::EncodingKey::from_rsa_pem(service_account.private_key.as_bytes())
            .map_err(|error| to_error(format!("failed to read Vertex AI private key: {error}")))?,
    )
    .map_err(|error| to_error(format!("failed to sign Vertex AI JWT: {error}")))?;

    let response = client
        .post(&service_account.token_uri)
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            ("assertion", assertion.as_str()),
        ])
        .send()
        .map_err(|error| to_error(format!("failed to request Vertex AI access token: {error}")))?;

    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "Vertex AI OAuth token request failed ({status}): {body}"
        )));
    }

    let payload = response
        .json::<Value>()
        .map_err(|error| to_error(format!("failed to parse Vertex AI token response: {error}")))?;
    payload
        .get("access_token")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| to_error("Vertex AI token response did not include access_token"))
}
