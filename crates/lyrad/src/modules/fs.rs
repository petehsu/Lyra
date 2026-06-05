pub fn search_local_json(request_json: String) -> Result<String, String> {
    lyra_search_core::search_local_json(request_json)
}

pub fn search_local_stream_start_json(request_json: String) -> Result<String, String> {
    lyra_search_core::search_local_stream_start_json(request_json)
}

pub fn search_local_stream_read_json(request_json: String) -> Result<String, String> {
    lyra_search_core::search_local_stream_read_json(request_json)
}

pub fn search_local_stream_cancel_json(request_json: String) -> Result<String, String> {
    lyra_search_core::search_local_stream_cancel_json(request_json)
}

pub fn rebuild_search_index_json(request_json: String) -> Result<String, String> {
    lyra_search_core::rebuild_search_index_json(request_json)
}

pub fn read_search_index_status_json(request_json: String) -> Result<String, String> {
    lyra_search_core::read_search_index_status_json(request_json)
}

#[allow(dead_code)]
pub fn read_status() -> &'static str {
    "fs:ok"
}
