use std::path::PathBuf;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DriveKind {
    Fixed,
    Other,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DriveCandidate {
    pub letter: char,
    pub kind: DriveKind,
    pub free_bytes: u64,
}

pub fn pick_windows_install_letter(system_letter: char, drives: &[DriveCandidate]) -> char {
    let system = system_letter.to_ascii_uppercase();
    let fixed = drives
        .iter()
        .copied()
        .filter(|drive| drive.kind == DriveKind::Fixed)
        .map(|mut drive| {
            drive.letter = drive.letter.to_ascii_uppercase();
            drive
        })
        .collect::<Vec<_>>();

    if let Some(drive) = fixed
        .iter()
        .find(|drive| drive.letter == 'D' && drive.letter != system)
    {
        return drive.letter;
    }

    let mut best: Option<DriveCandidate> = None;
    for drive in fixed.iter().copied().filter(|drive| drive.letter != system) {
        match best {
            Some(current) if drive.free_bytes <= current.free_bytes => {}
            _ => best = Some(drive),
        }
    }
    best.map(|drive| drive.letter).unwrap_or(system)
}

pub fn program_root_on_letter(letter: char) -> PathBuf {
    PathBuf::from(format!(r"{}:\Lyra", letter.to_ascii_uppercase()))
}

#[cfg(target_os = "windows")]
pub fn preferred_windows_program_root() -> PathBuf {
    let system = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_string());
    let system_letter = system.chars().next().unwrap_or('C');
    program_root_on_letter(pick_windows_install_letter(
        system_letter,
        &enumerate_windows_drives(),
    ))
}

#[cfg(target_os = "windows")]
fn enumerate_windows_drives() -> Vec<DriveCandidate> {
    const DRIVE_FIXED: u32 = 3;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetLogicalDrives() -> u32;
        fn GetDriveTypeW(root_path_name: *const u16) -> u32;
        fn GetDiskFreeSpaceExW(
            directory: *const u16,
            free_bytes_available: *mut u64,
            total_number_of_bytes: *mut u64,
            total_number_of_free_bytes: *mut u64,
        ) -> i32;
    }

    let mask = unsafe { GetLogicalDrives() };
    let mut drives = Vec::new();
    for index in 0..26u32 {
        if mask & (1 << index) == 0 {
            continue;
        }
        let letter = char::from(b'A' + index as u8);
        let mut root: Vec<u16> = format!(r"{letter}:\").encode_utf16().collect();
        root.push(0);
        let kind = unsafe { GetDriveTypeW(root.as_ptr()) };
        let mut free_available = 0_u64;
        let mut total = 0_u64;
        let mut total_free = 0_u64;
        let ok = unsafe {
            GetDiskFreeSpaceExW(
                root.as_ptr(),
                &mut free_available,
                &mut total,
                &mut total_free,
            )
        };
        drives.push(DriveCandidate {
            letter,
            kind: if kind == DRIVE_FIXED {
                DriveKind::Fixed
            } else {
                DriveKind::Other
            },
            free_bytes: if ok != 0 { free_available } else { 0 },
        });
    }
    drives
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_d_when_it_is_a_nonsystem_fixed_disk() {
        let drives = [
            DriveCandidate {
                letter: 'C',
                kind: DriveKind::Fixed,
                free_bytes: 200_000_000_000,
            },
            DriveCandidate {
                letter: 'D',
                kind: DriveKind::Fixed,
                free_bytes: 10_000_000,
            },
        ];
        assert_eq!(pick_windows_install_letter('C', &drives), 'D');
        assert_eq!(program_root_on_letter('D'), PathBuf::from(r"D:\Lyra"));
    }

    #[test]
    fn skips_d_when_it_is_the_system_volume() {
        let drives = [
            DriveCandidate {
                letter: 'D',
                kind: DriveKind::Fixed,
                free_bytes: 10,
            },
            DriveCandidate {
                letter: 'E',
                kind: DriveKind::Fixed,
                free_bytes: 50,
            },
            DriveCandidate {
                letter: 'F',
                kind: DriveKind::Fixed,
                free_bytes: 80,
            },
        ];
        assert_eq!(pick_windows_install_letter('D', &drives), 'F');
    }

    #[test]
    fn chooses_largest_nonsystem_fixed_disk_without_d() {
        let drives = [
            DriveCandidate {
                letter: 'C',
                kind: DriveKind::Fixed,
                free_bytes: 20,
            },
            DriveCandidate {
                letter: 'E',
                kind: DriveKind::Fixed,
                free_bytes: 40,
            },
            DriveCandidate {
                letter: 'F',
                kind: DriveKind::Fixed,
                free_bytes: 90,
            },
            DriveCandidate {
                letter: 'G',
                kind: DriveKind::Other,
                free_bytes: 500,
            },
        ];
        assert_eq!(pick_windows_install_letter('C', &drives), 'F');
    }

    #[test]
    fn falls_back_to_the_system_drive() {
        let drives = [DriveCandidate {
            letter: 'C',
            kind: DriveKind::Fixed,
            free_bytes: 12,
        }];
        assert_eq!(pick_windows_install_letter('C', &drives), 'C');
    }
}
