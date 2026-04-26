use crate::spawn::SpawnChildRequest;
use crate::spawn::StdioPolicy;
use crate::spawn::spawn_child_async;
use lyra_network_proxy::NetworkProxy;
use lyra_protocol::permissions::FileSystemSandboxPolicy;
use lyra_protocol::permissions::NetworkSandboxPolicy;
use lyra_protocol::protocol::SandboxPolicy;
use lyra_sandboxing::landlock::LYRA_LINUX_SANDBOX_ARG0;
use lyra_sandboxing::landlock::allow_network_for_proxy;
use lyra_sandboxing::landlock::create_linux_sandbox_command_args_for_policies;
use lyra_utils_absolute_path::AbsolutePathBuf;
use std::collections::HashMap;
use std::path::Path;
use tokio::process::Child;

/// Spawn a shell tool command under the Linux sandbox helper
/// (lyra-linux-sandbox), which defaults to bubblewrap for filesystem
/// isolation plus seccomp for network restrictions.
///
/// Unlike macOS Seatbelt where we directly embed the policy text, the Linux
/// helper is a separate executable. We pass the legacy [`SandboxPolicy`] plus
/// split filesystem/network policies as JSON so the helper can migrate
/// incrementally without breaking older call sites.
#[allow(clippy::too_many_arguments)]
pub async fn spawn_command_under_linux_sandbox<P>(
    lyra_linux_sandbox_exe: P,
    command: Vec<String>,
    command_cwd: AbsolutePathBuf,
    sandbox_policy: &SandboxPolicy,
    sandbox_policy_cwd: &AbsolutePathBuf,
    use_classic_landlock: bool,
    stdio_policy: StdioPolicy,
    network: Option<&NetworkProxy>,
    env: HashMap<String, String>,
) -> std::io::Result<Child>
where
    P: AsRef<Path>,
{
    let file_system_sandbox_policy =
        FileSystemSandboxPolicy::from_sandbox_policy(sandbox_policy, sandbox_policy_cwd);
    let network_sandbox_policy = NetworkSandboxPolicy::from(sandbox_policy);
    let args = create_linux_sandbox_command_args_for_policies(
        command,
        command_cwd.as_path(),
        sandbox_policy,
        &file_system_sandbox_policy,
        network_sandbox_policy,
        sandbox_policy_cwd,
        use_classic_landlock,
        allow_network_for_proxy(/*enforce_managed_network*/ false),
    );
    let lyra_linux_sandbox_exe = lyra_linux_sandbox_exe.as_ref();
    // Preserve the helper alias when we already have it; otherwise force argv0
    // so arg0 dispatch still reaches the Linux sandbox path.
    let arg0 = if lyra_linux_sandbox_exe
        .file_name()
        .and_then(|name| name.to_str())
        == Some(LYRA_LINUX_SANDBOX_ARG0)
    {
        // Old bubblewrap builds without `--argv0` need a real helper path whose
        // basename still dispatches to the Linux sandbox entrypoint.
        lyra_linux_sandbox_exe.to_string_lossy().into_owned()
    } else {
        LYRA_LINUX_SANDBOX_ARG0.to_string()
    };
    spawn_child_async(SpawnChildRequest {
        program: lyra_linux_sandbox_exe.to_path_buf(),
        args,
        arg0: Some(&arg0),
        cwd: command_cwd,
        network_sandbox_policy,
        network,
        stdio_policy,
        env,
    })
    .await
}
