# Remote Thread Store

- The Rust protobuf output in `proto/lyra.thread_store.v1.rs` is checked in.
- Do not add build-time protobuf generation to `lyra-thread-store` unless the Bazel/Cargo story is intentionally changed.
- When `proto/lyra.thread_store.v1.proto` changes, regenerate the Rust file manually and include both files in the same commit.

Run this from the repository root:

```sh
./lyra-rs/thread-store/scripts/generate-proto.sh
```

The command requires `protoc` to be available on `PATH`.
