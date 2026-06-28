use std::path::PathBuf;

use crate::directory::create_location;
use crate::dto::{
    FileManagerFavorite, FileManagerLocation, FileManagerReadHomeResponse,
    FileManagerRecentLocation,
};
use crate::error::{core_error, NapiResult};
use crate::volumes::{read_disks, read_unmounted_devices};
use lyra_files_core::paths::path_to_string;
use lyra_files_core::preferences::{
    ensure_storage_root, read_favorites_from_storage, read_recent_from_storage,
};

fn favorite_from_core(
    favorite: lyra_files_core::preferences::FileManagerFavorite,
) -> FileManagerFavorite {
    FileManagerFavorite {
        id: favorite.id,
        title: favorite.title,
        path: favorite.path,
        kind: favorite.kind,
        special_id: favorite.special_id,
        url: favorite.url,
        favicon_url: favorite.favicon_url,
        session_id: favorite.session_id,
        working_dir: favorite.working_dir,
    }
}

fn recent_location_from_core(
    location: lyra_files_core::preferences::FileManagerRecentLocation,
) -> FileManagerRecentLocation {
    FileManagerRecentLocation {
        id: location.id,
        title: location.title,
        path: location.path,
        last_opened_at: location.last_opened_at,
    }
}

fn existing_special_location(
    title: &str,
    special_id: &str,
    path: Option<PathBuf>,
    kind: &str,
) -> Option<FileManagerLocation> {
    match path {
        Some(value) if value.exists() => Some(create_location(
            format!("special:{}", special_id),
            title.to_string(),
            kind,
            Some(path_to_string(&value)),
            Some(special_id),
        )),
        Some(_) if special_id == "trash" => Some(create_location(
            format!("special:{}", special_id),
            title.to_string(),
            kind,
            None,
            Some(special_id),
        )),
        None if special_id == "trash" => Some(create_location(
            format!("special:{}", special_id),
            title.to_string(),
            kind,
            None,
            Some(special_id),
        )),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn mac_trash_root() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".Trash"))
}

#[cfg(not(target_os = "macos"))]
fn mac_trash_root() -> Option<PathBuf> {
    None
}

pub fn system_locations() -> Vec<FileManagerLocation> {
    let mut locations = Vec::new();

    if let Some(home_dir) = dirs::home_dir() {
        locations.push(create_location(
            "special:home".to_string(),
            "Home".to_string(),
            "special",
            Some(path_to_string(&home_dir)),
            Some("home"),
        ));
    }

    if let Some(location) =
        existing_special_location("Desktop", "desktop", dirs::desktop_dir(), "special")
    {
        locations.push(location);
    }
    if let Some(location) =
        existing_special_location("Documents", "documents", dirs::document_dir(), "special")
    {
        locations.push(location);
    }
    if let Some(location) =
        existing_special_location("Downloads", "downloads", dirs::download_dir(), "special")
    {
        locations.push(location);
    }

    if let Some(location) = existing_special_location("Trash", "trash", mac_trash_root(), "trash") {
        locations.push(location);
    } else {
        locations.push(create_location(
            "special:trash".to_string(),
            "Trash".to_string(),
            "trash",
            None,
            Some("trash"),
        ));
    }

    locations
}

pub fn read_home(storage_root: &str) -> NapiResult<FileManagerReadHomeResponse> {
    let storage_root = ensure_storage_root(storage_root).map_err(core_error)?;
    let favorites = read_favorites_from_storage(&storage_root).map_err(core_error)?;
    let recent_locations = read_recent_from_storage(&storage_root).map_err(core_error)?;

    Ok(FileManagerReadHomeResponse {
        location: create_location(
            "home".to_string(),
            "File Manager".to_string(),
            "home",
            None,
            Some("home"),
        ),
        system_locations: system_locations(),
        favorites: favorites
            .favorites
            .into_iter()
            .map(favorite_from_core)
            .collect(),
        recent_locations: recent_locations
            .recent_locations
            .into_iter()
            .map(recent_location_from_core)
            .collect(),
        disks: read_disks(),
        devices: read_unmounted_devices(),
    })
}
