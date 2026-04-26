use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::collections::HashSet;
use std::future::Future;
use std::sync::Arc;
use std::sync::OnceLock;
use std::sync::RwLock;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;

use crate::config_api::ConfigApi;
use crate::error_code::INVALID_REQUEST_ERROR_CODE;
use crate::fs_api::FsApi;
use crate::fs_watch::FsWatchManager;
use crate::lyra_ai_config_api::LyraAiConfigApi;
use crate::lyra_message_processor::LyraMessageProcessor;
use crate::lyra_message_processor::LyraMessageProcessorArgs;
use crate::lyra_runtime_api::LyraRuntimeApi;
use crate::lyra_runtime_api::strip_persona_context_block;
use crate::outgoing_message::ConnectionId;
use crate::outgoing_message::ConnectionRequestId;
use crate::outgoing_message::OutgoingMessageSender;
use crate::outgoing_message::RequestContext;
use crate::transport::AppServerTransport;
use axum::http::HeaderValue;
use futures::FutureExt;
use lyra_analytics::AnalyticsEventsClient;
use lyra_analytics::AppServerRpcTransport;
use lyra_app_server_protocol::ClientInfo;
use lyra_app_server_protocol::ClientNotification;
use lyra_app_server_protocol::ClientRequest;
use lyra_app_server_protocol::ConfigBatchWriteParams;
use lyra_app_server_protocol::ConfigReadParams;
use lyra_app_server_protocol::ConfigValueWriteParams;
use lyra_app_server_protocol::ConfigWarningNotification;
use lyra_app_server_protocol::FsCopyParams;
use lyra_app_server_protocol::FsCreateDirectoryParams;
use lyra_app_server_protocol::FsGetMetadataParams;
use lyra_app_server_protocol::FsReadDirectoryParams;
use lyra_app_server_protocol::FsReadFileParams;
use lyra_app_server_protocol::FsRemoveParams;
use lyra_app_server_protocol::FsUnwatchParams;
use lyra_app_server_protocol::FsWatchParams;
use lyra_app_server_protocol::FsWriteFileParams;
use lyra_app_server_protocol::InitializeResponse;
use lyra_app_server_protocol::JSONRPCError;
use lyra_app_server_protocol::JSONRPCErrorError;
use lyra_app_server_protocol::JSONRPCNotification;
use lyra_app_server_protocol::JSONRPCRequest;
use lyra_app_server_protocol::JSONRPCResponse;
use lyra_app_server_protocol::LyraConfigProfileDeleteParams;
use lyra_app_server_protocol::LyraConfigProfileSetDefaultParams;
use lyra_app_server_protocol::LyraConfigProfileUpsertParams;
use lyra_app_server_protocol::LyraHostToolsRemoveParams;
use lyra_app_server_protocol::LyraHostToolsSyncParams;
use lyra_app_server_protocol::LyraPersonaContextParams;
use lyra_app_server_protocol::ServerNotification;
use lyra_arg0::Arg0DispatchPaths;
use lyra_core::ThreadManager;
use lyra_core::config::Config;
use lyra_core::config_loader::CloudRequirementsLoader;
use lyra_core::config_loader::LoaderOverrides;
use lyra_exec_server::EnvironmentManager;
use lyra_features::Feature;
use lyra_login::AuthManager;
use lyra_login::default_client::USER_AGENT_SUFFIX;
use lyra_login::default_client::get_lyra_user_agent;
use lyra_models_manager::collaboration_mode_presets::CollaborationModesConfig;
use lyra_protocol::ThreadId;
use lyra_protocol::dynamic_tools::DynamicToolSpec as CoreDynamicToolSpec;
use lyra_protocol::protocol::SessionSource;
use lyra_protocol::protocol::W3cTraceContext;
use lyra_state::log_db::LogDbLayer;
use tokio::sync::broadcast;
use tokio::sync::watch;
use toml::Value as TomlValue;
use tracing::Instrument;

pub(crate) struct MessageProcessor {
    outgoing: Arc<OutgoingMessageSender>,
    lyra_message_processor: LyraMessageProcessor,
    thread_manager: Arc<ThreadManager>,
    config_api: ConfigApi,
    lyra_ai_config_api: LyraAiConfigApi,
    lyra_runtime_api: LyraRuntimeApi,
    fs_api: FsApi,
    auth_manager: Arc<AuthManager>,
    analytics_events_client: AnalyticsEventsClient,
    fs_watch_manager: FsWatchManager,
    config: Arc<Config>,
    config_warnings: Arc<Vec<ConfigWarningNotification>>,
    rpc_transport: AppServerRpcTransport,
}

#[derive(Debug, Default)]
pub(crate) struct ConnectionSessionState {
    initialized: OnceLock<InitializedConnectionSessionState>,
}

#[derive(Debug)]
struct InitializedConnectionSessionState {
    opted_out_notification_methods: HashSet<String>,
    app_server_client_name: String,
    client_version: String,
}

impl ConnectionSessionState {
    pub(crate) fn initialized(&self) -> bool {
        self.initialized.get().is_some()
    }

    pub(crate) fn opted_out_notification_methods(&self) -> HashSet<String> {
        self.initialized
            .get()
            .map(|session| session.opted_out_notification_methods.clone())
            .unwrap_or_default()
    }

    pub(crate) fn app_server_client_name(&self) -> Option<&str> {
        self.initialized
            .get()
            .map(|session| session.app_server_client_name.as_str())
    }

    pub(crate) fn client_version(&self) -> Option<&str> {
        self.initialized
            .get()
            .map(|session| session.client_version.as_str())
    }

    fn initialize(&self, session: InitializedConnectionSessionState) -> Result<(), ()> {
        self.initialized.set(session).map_err(|_| ())
    }
}

pub(crate) struct MessageProcessorArgs {
    pub(crate) outgoing: Arc<OutgoingMessageSender>,
    pub(crate) arg0_paths: Arg0DispatchPaths,
    pub(crate) config: Arc<Config>,
    pub(crate) environment_manager: Arc<EnvironmentManager>,
    pub(crate) cli_overrides: Vec<(String, TomlValue)>,
    pub(crate) loader_overrides: LoaderOverrides,
    pub(crate) cloud_requirements: CloudRequirementsLoader,
    pub(crate) log_db: Option<LogDbLayer>,
    pub(crate) config_warnings: Vec<ConfigWarningNotification>,
    pub(crate) session_source: SessionSource,
    pub(crate) auth_manager: Arc<AuthManager>,
    pub(crate) rpc_transport: AppServerRpcTransport,
}

impl MessageProcessor {
    /// Create a new `MessageProcessor`, retaining a handle to the outgoing
    /// `Sender` so handlers can enqueue messages to be written to stdout.
    pub(crate) fn new(args: MessageProcessorArgs) -> Self {
        let MessageProcessorArgs {
            outgoing,
            arg0_paths,
            config,
            environment_manager,
            cli_overrides,
            loader_overrides,
            cloud_requirements,
            log_db,
            config_warnings,
            session_source,
            auth_manager,
            rpc_transport,
        } = args;
        let analytics_events_client =
            AnalyticsEventsClient::new(Arc::clone(&auth_manager), config.analytics_enabled);
        let thread_manager = Arc::new(ThreadManager::new(
            config.as_ref(),
            auth_manager.clone(),
            session_source,
            CollaborationModesConfig {
                default_mode_request_user_input: config
                    .features
                    .enabled(Feature::DefaultModeRequestUserInput),
            },
            environment_manager,
            Some(analytics_events_client.clone()),
        ));
        thread_manager
            .plugins_manager()
            .set_analytics_events_client(analytics_events_client.clone());

        let cli_overrides = Arc::new(RwLock::new(cli_overrides));
        let runtime_feature_enablement = Arc::new(RwLock::new(BTreeMap::new()));
        let cloud_requirements = Arc::new(RwLock::new(cloud_requirements));
        let lyra_runtime_api = LyraRuntimeApi::new();
        let lyra_message_processor = LyraMessageProcessor::new(LyraMessageProcessorArgs {
            auth_manager: auth_manager.clone(),
            thread_manager: Arc::clone(&thread_manager),
            outgoing: outgoing.clone(),
            analytics_events_client: analytics_events_client.clone(),
            arg0_paths,
            config: Arc::clone(&config),
            lyra_runtime_api: lyra_runtime_api.clone(),
            cli_overrides: cli_overrides.clone(),
            runtime_feature_enablement: runtime_feature_enablement.clone(),
            cloud_requirements: cloud_requirements.clone(),
            log_db,
        });
        // Keep plugin startup warmups aligned at app-server startup.
        // TODO(xl): Move into PluginManager once this no longer depends on config feature gating.
        thread_manager
            .plugins_manager()
            .maybe_start_plugin_startup_tasks_for_config(&config);
        let config_api = ConfigApi::new(
            config.lyra_home.to_path_buf(),
            cli_overrides,
            runtime_feature_enablement,
            loader_overrides,
            cloud_requirements,
            thread_manager.clone(),
            analytics_events_client.clone(),
        );
        let lyra_ai_config_api = LyraAiConfigApi::new(config.lyra_home.to_path_buf());
        let fs_api = FsApi::default();
        let fs_watch_manager = FsWatchManager::new(outgoing.clone());

        Self {
            outgoing,
            lyra_message_processor,
            thread_manager: Arc::clone(&thread_manager),
            config_api,
            lyra_ai_config_api,
            lyra_runtime_api,
            fs_api,
            auth_manager,
            analytics_events_client,
            fs_watch_manager,
            config,
            config_warnings: Arc::new(config_warnings),
            rpc_transport,
        }
    }

    pub(crate) fn clear_runtime_references(&self) {
        self.auth_manager.clear_external_auth();
    }

    pub(crate) async fn process_request(
        self: &Arc<Self>,
        connection_id: ConnectionId,
        request: JSONRPCRequest,
        transport: AppServerTransport,
        session: Arc<ConnectionSessionState>,
    ) {
        let request_method = request.method.as_str();
        tracing::trace!(
            ?connection_id,
            request_id = ?request.id,
            "app-server request: {request_method}"
        );
        let request_id = ConnectionRequestId {
            connection_id,
            request_id: request.id.clone(),
        };
        let request_span =
            crate::app_server_tracing::request_span(&request, transport, connection_id, &session);
        let request_trace = request.trace.as_ref().map(|trace| W3cTraceContext {
            traceparent: trace.traceparent.clone(),
            tracestate: trace.tracestate.clone(),
        });
        let request_context = RequestContext::new(request_id.clone(), request_span, request_trace);
        Self::run_request_with_context(
            Arc::clone(&self.outgoing),
            request_context.clone(),
            async {
                let request_json = match serde_json::to_value(&request) {
                    Ok(request_json) => request_json,
                    Err(err) => {
                        let error = JSONRPCErrorError {
                            code: INVALID_REQUEST_ERROR_CODE,
                            message: format!("Invalid request: {err}"),
                            data: None,
                        };
                        self.outgoing.send_error(request_id.clone(), error).await;
                        return;
                    }
                };

                let lyra_request = match serde_json::from_value::<ClientRequest>(request_json) {
                    Ok(lyra_request) => lyra_request,
                    Err(err) => {
                        let error = JSONRPCErrorError {
                            code: INVALID_REQUEST_ERROR_CODE,
                            message: format!("Invalid request: {err}"),
                            data: None,
                        };
                        self.outgoing.send_error(request_id.clone(), error).await;
                        return;
                    }
                };
                // Websocket callers finalize outbound readiness in lib.rs after mirroring
                // session state into outbound state and sending initialize notifications to
                // this specific connection. Passing `None` avoids marking the connection
                // ready too early from inside the shared request handler.
                self.handle_client_request(
                    request_id.clone(),
                    lyra_request,
                    Arc::clone(&session),
                    /*outbound_initialized*/ None,
                    request_context.clone(),
                )
                .await;
            },
        )
        .await;
    }

    /// Handles a typed request path used by in-process embedders.
    ///
    /// This bypasses JSON request deserialization but keeps identical request
    /// semantics by delegating to `handle_client_request`.
    pub(crate) async fn process_client_request(
        self: &Arc<Self>,
        connection_id: ConnectionId,
        request: ClientRequest,
        session: Arc<ConnectionSessionState>,
        outbound_initialized: &AtomicBool,
    ) {
        let request_id = ConnectionRequestId {
            connection_id,
            request_id: request.id().clone(),
        };
        let request_span =
            crate::app_server_tracing::typed_request_span(&request, connection_id, &session);
        let request_context =
            RequestContext::new(request_id.clone(), request_span, /*parent_trace*/ None);
        tracing::trace!(
            ?connection_id,
            request_id = ?request_id.request_id,
            "app-server typed request"
        );
        Self::run_request_with_context(
            Arc::clone(&self.outgoing),
            request_context.clone(),
            async {
                // In-process clients do not have the websocket transport loop that performs
                // post-initialize bookkeeping, so they still finalize outbound readiness in
                // the shared request handler.
                self.handle_client_request(
                    request_id.clone(),
                    request,
                    Arc::clone(&session),
                    Some(outbound_initialized),
                    request_context.clone(),
                )
                .await;
            },
        )
        .await;
    }

    pub(crate) async fn process_notification(&self, notification: JSONRPCNotification) {
        // Currently, we do not expect to receive any notifications from the
        // client, so we just log them.
        tracing::info!("<- notification: {:?}", notification);
    }

    /// Handles typed notifications from in-process clients.
    pub(crate) async fn process_client_notification(&self, notification: ClientNotification) {
        // Currently, we do not expect to receive any typed notifications from
        // in-process clients, so we just log them.
        tracing::info!("<- typed notification: {:?}", notification);
    }

    async fn run_request_with_context<F>(
        outgoing: Arc<OutgoingMessageSender>,
        request_context: RequestContext,
        request_fut: F,
    ) where
        F: Future<Output = ()>,
    {
        outgoing
            .register_request_context(request_context.clone())
            .await;
        request_fut.instrument(request_context.span()).await;
    }

    pub(crate) fn thread_created_receiver(&self) -> broadcast::Receiver<ThreadId> {
        self.lyra_message_processor.thread_created_receiver()
    }

    pub(crate) async fn send_initialize_notifications_to_connection(
        &self,
        connection_id: ConnectionId,
    ) {
        for notification in self.config_warnings.iter().cloned() {
            self.outgoing
                .send_server_notification_to_connections(
                    &[connection_id],
                    ServerNotification::ConfigWarning(notification),
                )
                .await;
        }
    }

    pub(crate) async fn connection_initialized(&self, connection_id: ConnectionId) {
        self.lyra_message_processor
            .connection_initialized(connection_id)
            .await;
    }

    pub(crate) async fn send_initialize_notifications(&self) {
        for notification in self.config_warnings.iter().cloned() {
            self.outgoing
                .send_server_notification(ServerNotification::ConfigWarning(notification))
                .await;
        }
    }

    pub(crate) async fn try_attach_thread_listener(
        &self,
        thread_id: ThreadId,
        connection_ids: Vec<ConnectionId>,
    ) {
        self.lyra_message_processor
            .try_attach_thread_listener(thread_id, connection_ids)
            .await;
    }

    pub(crate) async fn drain_background_tasks(&self) {
        self.lyra_message_processor.drain_background_tasks().await;
    }

    pub(crate) async fn clear_all_thread_listeners(&self) {
        self.lyra_message_processor
            .clear_all_thread_listeners()
            .await;
    }

    pub(crate) async fn shutdown_threads(&self) {
        self.lyra_message_processor.shutdown_threads().await;
    }

    pub(crate) async fn connection_closed(&self, connection_id: ConnectionId) {
        self.outgoing.connection_closed(connection_id).await;
        self.fs_watch_manager.connection_closed(connection_id).await;
        self.lyra_message_processor
            .connection_closed(connection_id)
            .await;
    }

    pub(crate) fn subscribe_running_assistant_turn_count(&self) -> watch::Receiver<usize> {
        self.lyra_message_processor
            .subscribe_running_assistant_turn_count()
    }

    /// Handle a standalone JSON-RPC response originating from the peer.
    pub(crate) async fn process_response(&self, response: JSONRPCResponse) {
        tracing::info!("<- response: {:?}", response);
        let JSONRPCResponse { id, result, .. } = response;
        self.outgoing.notify_client_response(id, result).await
    }

    /// Handle an error object received from the peer.
    pub(crate) async fn process_error(&self, err: JSONRPCError) {
        tracing::error!("<- error: {:?}", err);
        self.outgoing.notify_client_error(err.id, err.error).await;
    }

    async fn handle_client_request(
        self: &Arc<Self>,
        connection_request_id: ConnectionRequestId,
        lyra_request: ClientRequest,
        session: Arc<ConnectionSessionState>,
        // `Some(...)` means the caller wants initialize to immediately mark the
        // connection outbound-ready. Websocket JSON-RPC calls pass `None` so
        // lib.rs can deliver connection-scoped initialize notifications first.
        outbound_initialized: Option<&AtomicBool>,
        request_context: RequestContext,
    ) {
        let connection_id = connection_request_id.connection_id;
        if let ClientRequest::Initialize { request_id, params } = lyra_request {
            // Handle Initialize internally so LyraMessageProcessor does not have to concern
            // itself with the `initialized` bool.
            let connection_request_id = ConnectionRequestId {
                connection_id,
                request_id,
            };
            if session.initialized() {
                let error = JSONRPCErrorError {
                    code: INVALID_REQUEST_ERROR_CODE,
                    message: "Already initialized".to_string(),
                    data: None,
                };
                self.outgoing.send_error(connection_request_id, error).await;
                return;
            }

            let analytics_initialize_params = params.clone();
            let opt_out_notification_methods = match params.capabilities {
                Some(capabilities) => capabilities
                    .opt_out_notification_methods
                    .unwrap_or_default(),
                None => Vec::new(),
            };
            let ClientInfo {
                name,
                title: _title,
                version,
            } = params.client_info;
            // Validate before committing so client metadata remains safe for
            // downstream user-agent/header serialization.
            if HeaderValue::from_str(&name).is_err() {
                let error = JSONRPCErrorError {
                    code: INVALID_REQUEST_ERROR_CODE,
                    message: format!(
                        "Invalid clientInfo.name: '{name}'. Must be a valid HTTP header value."
                    ),
                    data: None,
                };
                self.outgoing
                    .send_error(connection_request_id.clone(), error)
                    .await;
                return;
            }
            let user_agent_suffix = format!("{name}; {version}");
            let lyra_home = self.config.lyra_home.clone();
            if session
                .initialize(InitializedConnectionSessionState {
                    opted_out_notification_methods: opt_out_notification_methods
                        .into_iter()
                        .collect(),
                    app_server_client_name: name.clone(),
                    client_version: version,
                })
                .is_err()
            {
                let error = JSONRPCErrorError {
                    code: INVALID_REQUEST_ERROR_CODE,
                    message: "Already initialized".to_string(),
                    data: None,
                };
                self.outgoing.send_error(connection_request_id, error).await;
                return;
            }

            if self.config.features.enabled(Feature::GeneralAnalytics) {
                self.analytics_events_client.track_initialize(
                    connection_id.0,
                    analytics_initialize_params,
                    name.clone(),
                    self.rpc_transport,
                );
            }
            if let Ok(mut suffix) = USER_AGENT_SUFFIX.lock() {
                *suffix = Some(user_agent_suffix);
            }

            let user_agent = get_lyra_user_agent();
            let response = InitializeResponse {
                user_agent,
                lyra_home,
                platform_family: std::env::consts::FAMILY.to_string(),
                platform_os: std::env::consts::OS.to_string(),
            };

            self.outgoing
                .send_response(connection_request_id, response)
                .await;

            if let Some(outbound_initialized) = outbound_initialized {
                // In-process clients can complete readiness immediately here. The
                // websocket path defers this until lib.rs finishes transport-layer
                // initialize handling for the specific connection.
                outbound_initialized.store(true, Ordering::Release);
                self.lyra_message_processor
                    .connection_initialized(connection_id)
                    .await;
            }
            return;
        }

        self.dispatch_initialized_client_request(
            connection_request_id,
            lyra_request,
            session,
            request_context,
        )
        .await;
    }

    async fn dispatch_initialized_client_request(
        self: &Arc<Self>,
        connection_request_id: ConnectionRequestId,
        lyra_request: ClientRequest,
        session: Arc<ConnectionSessionState>,
        request_context: RequestContext,
    ) {
        if !session.initialized() {
            let error = JSONRPCErrorError {
                code: INVALID_REQUEST_ERROR_CODE,
                message: "Not initialized".to_string(),
                data: None,
            };
            self.outgoing.send_error(connection_request_id, error).await;
            return;
        }

        let connection_id = connection_request_id.connection_id;
        if self.config.features.enabled(Feature::GeneralAnalytics)
            && let ClientRequest::TurnStart { request_id, .. }
            | ClientRequest::TurnSteer { request_id, .. } = &lyra_request
        {
            self.analytics_events_client.track_request(
                connection_id.0,
                request_id.clone(),
                lyra_request.clone(),
            );
        }

        let app_server_client_name = session.app_server_client_name().map(str::to_string);
        let client_version = session.client_version().map(str::to_string);
        Arc::clone(self)
            .handle_initialized_client_request(
                connection_request_id,
                lyra_request,
                request_context,
                app_server_client_name,
                client_version,
            )
            .await;
    }

    async fn handle_initialized_client_request(
        self: Arc<Self>,
        connection_request_id: ConnectionRequestId,
        lyra_request: ClientRequest,
        request_context: RequestContext,
        app_server_client_name: Option<String>,
        client_version: Option<String>,
    ) {
        let connection_id = connection_request_id.connection_id;

        match lyra_request {
            ClientRequest::ConfigRead { request_id, params } => {
                self.handle_config_read(
                    ConnectionRequestId {
                        connection_id,
                        request_id,
                    },
                    params,
                )
                .await;
            }
            ClientRequest::ConfigValueWrite { request_id, params } => {
                self.handle_config_value_write(
                    ConnectionRequestId {
                        connection_id,
                        request_id,
                    },
                    params,
                )
                .await;
            }
            ClientRequest::ConfigBatchWrite { request_id, params } => {
                self.handle_config_batch_write(
                    ConnectionRequestId {
                        connection_id,
                        request_id,
                    },
                    params,
                )
                .await;
            }
            ClientRequest::LyraConfigProfilesList {
                request_id,
                params: _,
            } => {
                self.handle_lyra_config_profiles_list(ConnectionRequestId {
                    connection_id,
                    request_id,
                })
                .await;
            }
            ClientRequest::LyraConfigProfilesUpsert { request_id, params } => {
                self.handle_lyra_config_profiles_upsert(
                    ConnectionRequestId {
                        connection_id,
                        request_id,
                    },
                    params,
                )
                .await;
            }
            ClientRequest::LyraConfigProfilesDelete { request_id, params } => {
                self.handle_lyra_config_profiles_delete(
                    ConnectionRequestId {
                        connection_id,
                        request_id,
                    },
                    params,
                )
                .await;
            }
            ClientRequest::LyraConfigProfilesSetDefault { request_id, params } => {
                self.handle_lyra_config_profiles_set_default(
                    ConnectionRequestId {
                        connection_id,
                        request_id,
                    },
                    params,
                )
                .await;
            }
            ClientRequest::LyraConfigProvidersCatalogRead {
                request_id,
                params: _,
            } => {
                self.handle_lyra_config_providers_catalog_read(ConnectionRequestId {
                    connection_id,
                    request_id,
                })
                .await;
            }
            ClientRequest::LyraHostToolsSync { request_id, params } => {
                self.handle_lyra_host_tools_sync(
                    ConnectionRequestId {
                        connection_id,
                        request_id,
                    },
                    params,
                )
                .await;
            }
            ClientRequest::LyraHostToolsRemove { request_id, params } => {
                self.handle_lyra_host_tools_remove(
                    ConnectionRequestId {
                        connection_id,
                        request_id,
                    },
                    params,
                )
                .await;
            }
            ClientRequest::LyraPersonaContextSet { request_id, params } => {
                self.handle_lyra_persona_context_set(
                    ConnectionRequestId {
                        connection_id,
                        request_id,
                    },
                    params,
                )
                .await;
            }
            ClientRequest::ConfigRequirementsRead {
                request_id,
                params: _,
            } => {
                self.handle_config_requirements_read(ConnectionRequestId {
                    connection_id,
                    request_id,
                })
                .await;
            }
            ClientRequest::FsReadFile { request_id, params } => {
                self.handle_fs_read_file(
                    ConnectionRequestId {
                        connection_id,
                        request_id,
                    },
                    params,
                )
                .await;
            }
            ClientRequest::FsWriteFile { request_id, params } => {
                self.handle_fs_write_file(
                    ConnectionRequestId {
                        connection_id,
                        request_id,
                    },
                    params,
                )
                .await;
            }
            ClientRequest::FsCreateDirectory { request_id, params } => {
                self.handle_fs_create_directory(
                    ConnectionRequestId {
                        connection_id,
                        request_id,
                    },
                    params,
                )
                .await;
            }
            ClientRequest::FsGetMetadata { request_id, params } => {
                self.handle_fs_get_metadata(
                    ConnectionRequestId {
                        connection_id,
                        request_id,
                    },
                    params,
                )
                .await;
            }
            ClientRequest::FsReadDirectory { request_id, params } => {
                self.handle_fs_read_directory(
                    ConnectionRequestId {
                        connection_id,
                        request_id,
                    },
                    params,
                )
                .await;
            }
            ClientRequest::FsRemove { request_id, params } => {
                self.handle_fs_remove(
                    ConnectionRequestId {
                        connection_id,
                        request_id,
                    },
                    params,
                )
                .await;
            }
            ClientRequest::FsCopy { request_id, params } => {
                self.handle_fs_copy(
                    ConnectionRequestId {
                        connection_id,
                        request_id,
                    },
                    params,
                )
                .await;
            }
            ClientRequest::FsWatch { request_id, params } => {
                self.handle_fs_watch(
                    ConnectionRequestId {
                        connection_id,
                        request_id,
                    },
                    connection_id,
                    params,
                )
                .await;
            }
            ClientRequest::FsUnwatch { request_id, params } => {
                self.handle_fs_unwatch(
                    ConnectionRequestId {
                        connection_id,
                        request_id,
                    },
                    connection_id,
                    params,
                )
                .await;
            }
            other => {
                // Box the delegated future so this wrapper's async state machine does not
                // inline the full `LyraMessageProcessor::process_request` future, which
                // can otherwise push worker-thread stack usage over the edge.
                self.lyra_message_processor
                    .process_request(
                        connection_id,
                        other,
                        app_server_client_name,
                        client_version,
                        request_context,
                    )
                    .boxed()
                    .await;
            }
        }
    }

    async fn handle_config_read(&self, request_id: ConnectionRequestId, params: ConfigReadParams) {
        match self.config_api.read(params).await {
            Ok(response) => self.outgoing.send_response(request_id, response).await,
            Err(error) => self.outgoing.send_error(request_id, error).await,
        }
    }

    async fn handle_config_value_write(
        &self,
        request_id: ConnectionRequestId,
        params: ConfigValueWriteParams,
    ) {
        let result = self.config_api.write_value(params).await;
        self.handle_config_mutation_result(request_id, result).await
    }

    async fn handle_config_batch_write(
        &self,
        request_id: ConnectionRequestId,
        params: ConfigBatchWriteParams,
    ) {
        let result = self.config_api.batch_write(params).await;
        self.handle_config_mutation_result(request_id, result).await;
    }

    async fn handle_lyra_config_profiles_list(&self, request_id: ConnectionRequestId) {
        match self.lyra_ai_config_api.list_profiles().await {
            Ok(response) => self.outgoing.send_response(request_id, response).await,
            Err(error) => self.outgoing.send_error(request_id, error).await,
        }
    }

    async fn handle_lyra_config_profiles_upsert(
        &self,
        request_id: ConnectionRequestId,
        params: LyraConfigProfileUpsertParams,
    ) {
        match self.lyra_ai_config_api.upsert_profile(params).await {
            Ok(response) => self.outgoing.send_response(request_id, response).await,
            Err(error) => self.outgoing.send_error(request_id, error).await,
        }
    }

    async fn handle_lyra_config_profiles_delete(
        &self,
        request_id: ConnectionRequestId,
        params: LyraConfigProfileDeleteParams,
    ) {
        match self.lyra_ai_config_api.delete_profile(params).await {
            Ok(response) => self.outgoing.send_response(request_id, response).await,
            Err(error) => self.outgoing.send_error(request_id, error).await,
        }
    }

    async fn handle_lyra_config_profiles_set_default(
        &self,
        request_id: ConnectionRequestId,
        params: LyraConfigProfileSetDefaultParams,
    ) {
        match self.lyra_ai_config_api.set_default_profile(params).await {
            Ok(response) => self.outgoing.send_response(request_id, response).await,
            Err(error) => self.outgoing.send_error(request_id, error).await,
        }
    }

    async fn handle_lyra_config_providers_catalog_read(&self, request_id: ConnectionRequestId) {
        match self.lyra_ai_config_api.read_provider_catalog().await {
            Ok(response) => self.outgoing.send_response(request_id, response).await,
            Err(error) => self.outgoing.send_error(request_id, error).await,
        }
    }

    async fn handle_lyra_host_tools_sync(
        &self,
        request_id: ConnectionRequestId,
        params: LyraHostToolsSyncParams,
    ) {
        let previous_names = self.lyra_runtime_api.current_host_tool_names();
        let response = self.lyra_runtime_api.sync_host_tools(params);
        self.refresh_loaded_threads_after_host_tools_change(previous_names)
            .await;
        self.outgoing.send_response(request_id, response).await;
    }

    async fn handle_lyra_host_tools_remove(
        &self,
        request_id: ConnectionRequestId,
        params: LyraHostToolsRemoveParams,
    ) {
        let previous_names = self.lyra_runtime_api.current_host_tool_names();
        let response = self.lyra_runtime_api.remove_host_tools(params);
        self.refresh_loaded_threads_after_host_tools_change(previous_names)
            .await;
        self.outgoing.send_response(request_id, response).await;
    }

    async fn handle_lyra_persona_context_set(
        &self,
        request_id: ConnectionRequestId,
        params: LyraPersonaContextParams,
    ) {
        self.lyra_runtime_api.set_persona_context(params);
        self.refresh_loaded_threads_after_persona_change().await;
        self.outgoing
            .send_response(
                request_id,
                lyra_app_server_protocol::LyraPersonaContextSetResponse {},
            )
            .await;
    }

    async fn handle_config_mutation_result<T: serde::Serialize>(
        &self,
        request_id: ConnectionRequestId,
        result: std::result::Result<T, JSONRPCErrorError>,
    ) {
        match result {
            Ok(response) => {
                self.handle_config_mutation().await;
                self.outgoing.send_response(request_id, response).await;
            }
            Err(error) => self.outgoing.send_error(request_id, error).await,
        }
    }

    async fn handle_config_mutation(&self) {
        self.lyra_message_processor.handle_config_mutation();
    }

    async fn handle_config_requirements_read(&self, request_id: ConnectionRequestId) {
        match self.config_api.config_requirements_read().await {
            Ok(response) => self.outgoing.send_response(request_id, response).await,
            Err(error) => self.outgoing.send_error(request_id, error).await,
        }
    }

    async fn refresh_loaded_threads_after_host_tools_change(
        &self,
        previous_host_tool_names: BTreeSet<String>,
    ) {
        let next_api_tools = self.lyra_runtime_api.current_host_tools();
        let next_host_tool_names = next_api_tools
            .iter()
            .map(|tool| tool.name.clone())
            .collect::<BTreeSet<_>>();
        let next_core_tools = next_api_tools
            .into_iter()
            .map(api_dynamic_tool_to_core)
            .collect::<Vec<_>>();

        for thread_id in self.thread_manager.list_thread_ids().await {
            let Ok(thread) = self.thread_manager.get_thread(thread_id).await else {
                continue;
            };
            let mut preserved = thread
                .dynamic_tools_snapshot()
                .await
                .into_iter()
                .filter(|tool| {
                    !previous_host_tool_names.contains(&tool.name)
                        && !next_host_tool_names.contains(&tool.name)
                })
                .collect::<Vec<_>>();
            preserved.extend(next_core_tools.iter().cloned());
            let _ = thread.set_dynamic_tools(preserved).await;
        }
    }

    async fn refresh_loaded_threads_after_persona_change(&self) {
        for thread_id in self.thread_manager.list_thread_ids().await {
            let Ok(thread) = self.thread_manager.get_thread(thread_id).await else {
                continue;
            };
            let merged =
                self.lyra_runtime_api
                    .merge_developer_instructions(strip_persona_context_block(
                        thread.developer_instructions_snapshot().await,
                    ));
            let _ = thread.set_developer_instructions(merged).await;
        }
    }

    async fn handle_fs_read_file(&self, request_id: ConnectionRequestId, params: FsReadFileParams) {
        match self.fs_api.read_file(params).await {
            Ok(response) => self.outgoing.send_response(request_id, response).await,
            Err(error) => self.outgoing.send_error(request_id, error).await,
        }
    }

    async fn handle_fs_write_file(
        &self,
        request_id: ConnectionRequestId,
        params: FsWriteFileParams,
    ) {
        match self.fs_api.write_file(params).await {
            Ok(response) => self.outgoing.send_response(request_id, response).await,
            Err(error) => self.outgoing.send_error(request_id, error).await,
        }
    }

    async fn handle_fs_create_directory(
        &self,
        request_id: ConnectionRequestId,
        params: FsCreateDirectoryParams,
    ) {
        match self.fs_api.create_directory(params).await {
            Ok(response) => self.outgoing.send_response(request_id, response).await,
            Err(error) => self.outgoing.send_error(request_id, error).await,
        }
    }

    async fn handle_fs_get_metadata(
        &self,
        request_id: ConnectionRequestId,
        params: FsGetMetadataParams,
    ) {
        match self.fs_api.get_metadata(params).await {
            Ok(response) => self.outgoing.send_response(request_id, response).await,
            Err(error) => self.outgoing.send_error(request_id, error).await,
        }
    }

    async fn handle_fs_read_directory(
        &self,
        request_id: ConnectionRequestId,
        params: FsReadDirectoryParams,
    ) {
        match self.fs_api.read_directory(params).await {
            Ok(response) => self.outgoing.send_response(request_id, response).await,
            Err(error) => self.outgoing.send_error(request_id, error).await,
        }
    }

    async fn handle_fs_remove(&self, request_id: ConnectionRequestId, params: FsRemoveParams) {
        match self.fs_api.remove(params).await {
            Ok(response) => self.outgoing.send_response(request_id, response).await,
            Err(error) => self.outgoing.send_error(request_id, error).await,
        }
    }

    async fn handle_fs_copy(&self, request_id: ConnectionRequestId, params: FsCopyParams) {
        match self.fs_api.copy(params).await {
            Ok(response) => self.outgoing.send_response(request_id, response).await,
            Err(error) => self.outgoing.send_error(request_id, error).await,
        }
    }

    async fn handle_fs_watch(
        &self,
        request_id: ConnectionRequestId,
        connection_id: ConnectionId,
        params: FsWatchParams,
    ) {
        match self.fs_watch_manager.watch(connection_id, params).await {
            Ok(response) => self.outgoing.send_response(request_id, response).await,
            Err(error) => self.outgoing.send_error(request_id, error).await,
        }
    }

    async fn handle_fs_unwatch(
        &self,
        request_id: ConnectionRequestId,
        connection_id: ConnectionId,
        params: FsUnwatchParams,
    ) {
        match self.fs_watch_manager.unwatch(connection_id, params).await {
            Ok(response) => self.outgoing.send_response(request_id, response).await,
            Err(error) => self.outgoing.send_error(request_id, error).await,
        }
    }
}

fn api_dynamic_tool_to_core(
    tool: lyra_app_server_protocol::DynamicToolSpec,
) -> CoreDynamicToolSpec {
    CoreDynamicToolSpec {
        namespace: tool.namespace,
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
        defer_loading: tool.defer_loading,
    }
}
