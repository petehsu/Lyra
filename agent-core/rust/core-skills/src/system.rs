pub(crate) use lyra_skills::install_system_skills;
pub(crate) use lyra_skills::system_cache_root_dir;

use lyra_utils_absolute_path::AbsolutePathBuf;

pub(crate) fn uninstall_system_skills(lyra_home: &AbsolutePathBuf) {
    let _ = std::fs::remove_dir_all(system_cache_root_dir(lyra_home));
}
