use std::collections::BTreeMap;
use std::env;
use std::path::PathBuf;

use configparser::ini::Ini;
use napi::Result;

use crate::error::to_error;
use crate::profile::types::AiProviderProfile;
use crate::provider::types::secret_value;

#[derive(Clone, Debug)]
pub struct AwsCredentials {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: Option<String>,
}

#[derive(Clone, Debug)]
pub enum BedrockAuth {
    ApiKey(String),
    Aws(AwsCredentials),
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

fn secret_or_auth_value(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
    key: &str,
) -> Option<String> {
    secret_value(secrets, key)
        .map(str::to_string)
        .or_else(|| auth_config_value(profile, key))
}

fn aws_dir() -> Result<PathBuf> {
    let home = env::var("HOME").map_err(|_| to_error("HOME is not set for AWS profile lookup"))?;
    Ok(PathBuf::from(home).join(".aws"))
}

fn read_ini(path: PathBuf) -> Result<Ini> {
    let mut ini = Ini::new();
    ini.load(path.to_string_lossy().as_ref())
        .map_err(|error| to_error(format!("failed to read AWS profile file: {error}")))?;
    Ok(ini)
}

fn load_from_profile_files(profile_name: &str) -> Result<AwsCredentials> {
    let aws_dir = aws_dir()?;
    let credentials = read_ini(aws_dir.join("credentials"))?;
    let config = read_ini(aws_dir.join("config"))?;
    let config_section = if profile_name == "default" {
        "default".to_string()
    } else {
        format!("profile {profile_name}")
    };

    let access_key_id = credentials
        .get(profile_name, "aws_access_key_id")
        .or_else(|| config.get(&config_section, "aws_access_key_id"))
        .ok_or_else(|| {
            to_error(format!(
                "AWS profile '{profile_name}' is missing aws_access_key_id"
            ))
        })?;
    let secret_access_key = credentials
        .get(profile_name, "aws_secret_access_key")
        .or_else(|| config.get(&config_section, "aws_secret_access_key"))
        .ok_or_else(|| {
            to_error(format!(
                "AWS profile '{profile_name}' is missing aws_secret_access_key"
            ))
        })?;
    let session_token = credentials
        .get(profile_name, "aws_session_token")
        .or_else(|| config.get(&config_section, "aws_session_token"))
        .filter(|value| value.trim().is_empty() == false);

    Ok(AwsCredentials {
        access_key_id,
        secret_access_key,
        session_token,
    })
}

fn load_static_credentials(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<AwsCredentials> {
    let access_key_id = auth_config_value(profile, "accessKeyId")
        .ok_or_else(|| to_error("accessKeyId is required for Amazon Bedrock static credentials"))?;
    let secret_access_key =
        secret_or_auth_value(profile, secrets, "secretAccessKey").ok_or_else(|| {
            to_error("secretAccessKey is required for Amazon Bedrock static credentials")
        })?;
    let session_token = secret_or_auth_value(profile, secrets, "sessionToken");
    Ok(AwsCredentials {
        access_key_id,
        secret_access_key,
        session_token,
    })
}

pub fn load_bedrock_auth(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<BedrockAuth> {
    let auth_method =
        auth_config_value(profile, "authMethod").unwrap_or_else(|| "named_profile".to_string());

    match auth_method.as_str() {
        "api_key" => secret_or_auth_value(profile, secrets, "apiKey")
            .map(BedrockAuth::ApiKey)
            .ok_or_else(|| to_error("apiKey is required for Amazon Bedrock API key auth")),
        "static_credentials" => load_static_credentials(profile, secrets).map(BedrockAuth::Aws),
        _ => {
            let profile_name =
                auth_config_value(profile, "profile").unwrap_or_else(|| "default".to_string());
            load_from_profile_files(&profile_name).map(BedrockAuth::Aws)
        }
    }
}
