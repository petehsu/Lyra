use std::path::Path;

use lyra_arg0::Arg0DispatchPaths;
use lyra_arg0::Arg0PathEntryGuard;
use lyra_arg0::arg0_dispatch;
use tempfile::TempDir;

pub struct TestBinaryDispatchGuard {
    _lyra_home: TempDir,
    arg0: Arg0PathEntryGuard,
    _previous_lyra_home: Option<std::ffi::OsString>,
}

impl TestBinaryDispatchGuard {
    pub fn paths(&self) -> &Arg0DispatchPaths {
        self.arg0.paths()
    }
}

pub enum TestBinaryDispatchMode {
    DispatchArg0Only,
    Skip,
    InstallAliases,
}

pub fn configure_test_binary_dispatch<F>(
    lyra_home_prefix: &str,
    classify: F,
) -> Option<TestBinaryDispatchGuard>
where
    F: FnOnce(&str, Option<&str>) -> TestBinaryDispatchMode,
{
    let mut args = std::env::args_os();
    let argv0 = args.next().unwrap_or_default();
    let exe_name = Path::new(&argv0)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let argv1 = args.next();
    match classify(exe_name, argv1.as_deref().and_then(|arg| arg.to_str())) {
        TestBinaryDispatchMode::DispatchArg0Only => {
            let _ = arg0_dispatch();
            None
        }
        TestBinaryDispatchMode::Skip => None,
        TestBinaryDispatchMode::InstallAliases => {
            let lyra_home = match tempfile::Builder::new().prefix(lyra_home_prefix).tempdir() {
                Ok(lyra_home) => lyra_home,
                Err(error) => panic!("failed to create test LYRA_HOME: {error}"),
            };
            let previous_lyra_home = std::env::var_os("LYRA_HOME");
            // Safety: this runs from a test ctor before test threads begin.
            unsafe {
                std::env::set_var("LYRA_HOME", lyra_home.path());
            }

            let arg0 = match arg0_dispatch() {
                Some(arg0) => arg0,
                None => panic!("failed to configure arg0 dispatch aliases for test binary"),
            };
            match previous_lyra_home.as_ref() {
                Some(value) => unsafe {
                    std::env::set_var("LYRA_HOME", value);
                },
                None => unsafe {
                    std::env::remove_var("LYRA_HOME");
                },
            }

            Some(TestBinaryDispatchGuard {
                _lyra_home: lyra_home,
                arg0,
                _previous_lyra_home: previous_lyra_home,
            })
        }
    }
}
