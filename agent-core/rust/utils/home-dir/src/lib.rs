use lyra_utils_absolute_path::AbsolutePathBuf;
use dirs::home_dir;
use std::path::PathBuf;

/// Returns the path to the Lyra runtime home, which can be specified by the
/// `LYRA_HOME` environment variable.
/// If not set, defaults to `~/.lyra`.
///
/// - If `LYRA_HOME` is set, the value must exist and be a directory. The value
///   will be canonicalized and this function will Err otherwise.
/// - If neither variable is set, this function does not verify that the
///   directory exists.
pub fn find_lyra_home() -> std::io::Result<AbsolutePathBuf> {
    let lyra_home_env = std::env::var("LYRA_HOME").ok().filter(|val| !val.is_empty());
    find_lyra_home_from_env(lyra_home_env.as_deref())
}

fn default_lyra_home() -> std::io::Result<AbsolutePathBuf> {
    let mut p = home_dir().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "Could not find home directory")
    })?;
    p.push(".lyra");
    AbsolutePathBuf::from_absolute_path(p)
}

fn find_lyra_home_from_env(lyra_home_env: Option<&str>) -> std::io::Result<AbsolutePathBuf> {
    match lyra_home_env {
        Some(val) => {
            let path = PathBuf::from(val);
            let metadata = std::fs::metadata(&path).map_err(|err| match err.kind() {
                std::io::ErrorKind::NotFound => std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    format!("configured Lyra runtime home points to {val:?}, but that path does not exist"),
                ),
                _ => std::io::Error::new(
                    err.kind(),
                    format!("failed to read configured Lyra runtime home {val:?}: {err}"),
                ),
            })?;

            if !metadata.is_dir() {
                Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!("configured Lyra runtime home points to {val:?}, but that path is not a directory"),
                ))
            } else {
                let canonical = path.canonicalize().map_err(|err| {
                    std::io::Error::new(
                        err.kind(),
                        format!("failed to canonicalize configured Lyra runtime home {val:?}: {err}"),
                    )
                })?;
                AbsolutePathBuf::from_absolute_path(canonical)
            }
        }
        None => default_lyra_home(),
    }
}

#[cfg(test)]
mod tests {
    use super::find_lyra_home_from_env;
    use lyra_utils_absolute_path::AbsolutePathBuf;
    use dirs::home_dir;
    use pretty_assertions::assert_eq;
    use std::fs;
    use std::io::ErrorKind;
    use tempfile::TempDir;

    #[test]
    fn find_lyra_home_env_missing_path_is_fatal() {
        let temp_home = TempDir::new().expect("temp home");
        let missing = temp_home.path().join("missing-lyra-home");
        let missing_str = missing
            .to_str()
            .expect("missing Lyra home path should be valid utf-8");

        let err = find_lyra_home_from_env(Some(missing_str)).expect_err("missing LYRA_HOME");
        assert_eq!(err.kind(), ErrorKind::NotFound);
        assert!(
            err.to_string().contains("configured Lyra runtime home"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn find_lyra_home_env_file_path_is_fatal() {
        let temp_home = TempDir::new().expect("temp home");
        let file_path = temp_home.path().join("lyra-home.txt");
        fs::write(&file_path, "not a directory").expect("write temp file");
        let file_str = file_path
            .to_str()
            .expect("file Lyra home path should be valid utf-8");

        let err = find_lyra_home_from_env(Some(file_str)).expect_err("file LYRA_HOME");
        assert_eq!(err.kind(), ErrorKind::InvalidInput);
        assert!(
            err.to_string().contains("not a directory"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn find_lyra_home_env_valid_directory_canonicalizes() {
        let temp_home = TempDir::new().expect("temp home");
        let temp_str = temp_home
            .path()
            .to_str()
            .expect("temp Lyra home path should be valid utf-8");

        let resolved = find_lyra_home_from_env(Some(temp_str)).expect("valid LYRA_HOME");
        let expected = temp_home
            .path()
            .canonicalize()
            .expect("canonicalize temp home");
        let expected = AbsolutePathBuf::from_absolute_path(expected).expect("absolute home");
        assert_eq!(resolved, expected);
    }

    #[test]
    fn find_lyra_home_without_env_uses_default_home_dir() {
        let resolved =
            find_lyra_home_from_env(/*lyra_home_env*/ None).expect("default LYRA runtime home");
        let mut expected = home_dir().expect("home dir");
        expected.push(".lyra");
        let expected = AbsolutePathBuf::from_absolute_path(expected).expect("absolute home");
        assert_eq!(resolved, expected);
    }
}
