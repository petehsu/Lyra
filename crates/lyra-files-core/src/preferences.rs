use std::fs;
use std::path::{Path, PathBuf};

use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::paths::{canonical_directory_path, location_path_key, path_to_string, title_for_path};
use crate::{FilesCoreError, Result};

pub const FAVORITES_FILE_NAME: &str = "favorites.json";
pub const RECENT_LOCATIONS_FILE_NAME: &str = "recent-locations.json";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerFavorite {
    pub id: String,
    pub title: String,
    pub path: String,
    pub special_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerRecentLocation {
    pub id: String,
    pub title: String,
    pub path: String,
    pub last_opened_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerFavoritesPayload {
    pub favorites: Vec<FileManagerFavorite>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerRecentLocationsPayload {
    pub recent_locations: Vec<FileManagerRecentLocation>,
}

fn io_error(context: impl Into<String>, source: std::io::Error) -> FilesCoreError {
    FilesCoreError::Io {
        context: context.into(),
        source,
    }
}

pub fn ensure_storage_root(path: &str) -> Result<PathBuf> {
    let root = PathBuf::from(path);
    fs::create_dir_all(&root).map_err(|error| io_error("failed to create storage root", error))?;
    Ok(root)
}

pub fn storage_file(storage_root: &Path, file_name: &str) -> PathBuf {
    storage_root.join(file_name)
}

pub fn read_json_file<T>(path: &Path) -> Result<T>
where
    T: DeserializeOwned + Default,
{
    if !path.exists() {
        return Ok(T::default());
    }

    let bytes = fs::read(path)
        .map_err(|error| io_error(format!("failed to read {}", path.display()), error))?;
    serde_json::from_slice(&bytes).map_err(|error| {
        FilesCoreError::InvalidArgument(format!("failed to parse {}: {}", path.display(), error))
    })
}

pub fn write_json_file<T>(path: &Path, value: &T) -> Result<()>
where
    T: Serialize,
{
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| io_error(format!("failed to create {}", parent.display()), error))?;
    }

    let payload = serde_json::to_vec_pretty(value).map_err(|error| {
        FilesCoreError::InvalidArgument(format!(
            "failed to serialize {}: {}",
            path.display(),
            error
        ))
    })?;
    fs::write(path, payload)
        .map_err(|error| io_error(format!("failed to write {}", path.display()), error))
}

pub fn sanitize_favorites(payload: FileManagerFavoritesPayload) -> FileManagerFavoritesPayload {
    let mut seen = std::collections::HashSet::new();
    let favorites = payload
        .favorites
        .into_iter()
        .filter_map(|favorite| {
            let canonical_path = canonical_directory_path(&favorite.path).ok()?;
            let key = location_path_key(&canonical_path);
            if seen.insert(key) == false {
                return None;
            }

            Some(FileManagerFavorite {
                id: favorite.id,
                title: if favorite.title.trim().is_empty() {
                    title_for_path(&canonical_path)
                } else {
                    favorite.title
                },
                path: path_to_string(&canonical_path),
                special_id: favorite.special_id,
            })
        })
        .collect();

    FileManagerFavoritesPayload { favorites }
}

pub fn sanitize_recent_locations(
    payload: FileManagerRecentLocationsPayload,
) -> FileManagerRecentLocationsPayload {
    let mut seen = std::collections::HashSet::new();
    let recent_locations = payload
        .recent_locations
        .into_iter()
        .filter_map(|location| {
            let canonical_path = canonical_directory_path(&location.path).ok()?;
            let key = location_path_key(&canonical_path);
            if seen.insert(key) == false {
                return None;
            }

            Some(FileManagerRecentLocation {
                id: location.id,
                title: if location.title.trim().is_empty() {
                    title_for_path(&canonical_path)
                } else {
                    location.title
                },
                path: path_to_string(&canonical_path),
                last_opened_at: location.last_opened_at,
            })
        })
        .collect();

    FileManagerRecentLocationsPayload { recent_locations }
}

pub fn read_favorites_from_storage(storage_root: &Path) -> Result<FileManagerFavoritesPayload> {
    read_json_file(&storage_file(storage_root, FAVORITES_FILE_NAME)).map(sanitize_favorites)
}

pub fn write_favorites_to_storage(
    storage_root: &Path,
    payload: &FileManagerFavoritesPayload,
) -> Result<FileManagerFavoritesPayload> {
    let path = storage_file(storage_root, FAVORITES_FILE_NAME);
    let sanitized = sanitize_favorites(payload.clone());
    write_json_file(&path, &sanitized)?;
    Ok(sanitized)
}

pub fn read_recent_from_storage(storage_root: &Path) -> Result<FileManagerRecentLocationsPayload> {
    read_json_file(&storage_file(storage_root, RECENT_LOCATIONS_FILE_NAME))
        .map(sanitize_recent_locations)
}

pub fn write_recent_to_storage(
    storage_root: &Path,
    payload: &FileManagerRecentLocationsPayload,
) -> Result<FileManagerRecentLocationsPayload> {
    let path = storage_file(storage_root, RECENT_LOCATIONS_FILE_NAME);
    let sanitized = sanitize_recent_locations(payload.clone());
    write_json_file(&path, &sanitized)?;
    Ok(sanitized)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "lyra-files-core-preferences-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn favorites_are_canonicalized_deduped_and_missing_paths_dropped() {
        let root = temp_dir();
        let kept = root.join("kept");
        fs::create_dir_all(&kept).unwrap();

        let sanitized = sanitize_favorites(FileManagerFavoritesPayload {
            favorites: vec![
                FileManagerFavorite {
                    id: "first".to_string(),
                    title: "".to_string(),
                    path: path_to_string(&kept),
                    special_id: None,
                },
                FileManagerFavorite {
                    id: "duplicate".to_string(),
                    title: "Duplicate".to_string(),
                    path: path_to_string(&kept),
                    special_id: None,
                },
                FileManagerFavorite {
                    id: "missing".to_string(),
                    title: "Missing".to_string(),
                    path: path_to_string(&root.join("missing")),
                    special_id: None,
                },
            ],
        });

        assert_eq!(sanitized.favorites.len(), 1);
        assert_eq!(sanitized.favorites[0].id, "first");
        assert_eq!(sanitized.favorites[0].title, "kept");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recent_locations_are_canonicalized_and_deduped() {
        let root = temp_dir();
        let kept = root.join("recent");
        fs::create_dir_all(&kept).unwrap();

        let sanitized = sanitize_recent_locations(FileManagerRecentLocationsPayload {
            recent_locations: vec![
                FileManagerRecentLocation {
                    id: "first".to_string(),
                    title: "".to_string(),
                    path: path_to_string(&kept),
                    last_opened_at: "1".to_string(),
                },
                FileManagerRecentLocation {
                    id: "duplicate".to_string(),
                    title: "Duplicate".to_string(),
                    path: path_to_string(&kept),
                    last_opened_at: "2".to_string(),
                },
            ],
        });

        assert_eq!(sanitized.recent_locations.len(), 1);
        assert_eq!(sanitized.recent_locations[0].id, "first");
        assert_eq!(sanitized.recent_locations[0].title, "recent");

        fs::remove_dir_all(root).unwrap();
    }
}
