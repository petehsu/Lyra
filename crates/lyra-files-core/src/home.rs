use std::path::PathBuf;

use sysinfo::System;

use crate::directory_host::create_location;
use crate::paths::path_to_string;
use crate::preferences::{
    ensure_storage_root, read_favorites_from_storage, read_recent_from_storage,
};
use crate::volumes::{read_disks, read_unmounted_devices};
use crate::wire::{
    FileManagerFavorite, FileManagerHostInfo, FileManagerLocation, FileManagerReadHomeResponse,
    FileManagerRecentLocation,
};

fn favorite_from_core(favorite: crate::preferences::FileManagerFavorite) -> FileManagerFavorite {
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
    location: crate::preferences::FileManagerRecentLocation,
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
    if let Some(location) =
        existing_special_location("Pictures", "pictures", dirs::picture_dir(), "special")
    {
        locations.push(location);
    }
    if let Some(location) =
        existing_special_location("Videos", "videos", dirs::video_dir(), "special")
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

fn read_host_info() -> FileManagerHostInfo {
    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_cpu_all();
    let cpu_brand = sys
        .cpus()
        .first()
        .map(|cpu| cpu.brand().trim().to_string())
        .filter(|value| value.is_empty() == false)
        .unwrap_or_default();
    let architecture = System::cpu_arch();

    FileManagerHostInfo {
        name: System::host_name().unwrap_or_else(|| "This PC".to_string()),
        os_name: System::long_os_version()
            .or_else(System::name)
            .unwrap_or_else(|| std::env::consts::OS.to_string()),
        architecture: if architecture.is_empty() {
            std::env::consts::ARCH.to_string()
        } else {
            architecture
        },
        cpu_brand,
        memory_total_bytes: sys.total_memory() as f64,
        memory_used_bytes: sys.used_memory() as f64,
    }
}

pub fn read_home(storage_root: &str) -> crate::Result<FileManagerReadHomeResponse> {
    let storage_root = ensure_storage_root(storage_root)?;
    let favorites = read_favorites_from_storage(&storage_root)?;
    let recent_locations = read_recent_from_storage(&storage_root)?;

    Ok(FileManagerReadHomeResponse {
        location: create_location(
            "home".to_string(),
            "This PC".to_string(),
            "home",
            None,
            Some("home"),
        ),
        host_info: read_host_info(),
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
