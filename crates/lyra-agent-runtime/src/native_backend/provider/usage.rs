use super::*;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct ProviderResponseMeta {
    pub(crate) response_id: Option<String>,
    pub(crate) usage: ProviderTokenUsage,
}

impl ProviderResponseMeta {
    pub(crate) fn merge(&mut self, newer: Self) {
        if newer.response_id.is_some() {
            self.response_id = newer.response_id;
        }
        self.usage.merge(newer.usage);
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct ProviderTokenUsage {
    pub(crate) input_total_tokens: Option<u64>,
    pub(crate) input_uncached_tokens: Option<u64>,
    pub(crate) cache_read_input_tokens: Option<u64>,
    pub(crate) cache_write_input_tokens: Option<u64>,
    pub(crate) output_tokens: Option<u64>,
    pub(crate) reasoning_tokens: Option<u64>,
}

impl ProviderTokenUsage {
    pub(crate) fn merge(&mut self, newer: Self) {
        macro_rules! overwrite_present {
            ($field:ident) => {
                if newer.$field.is_some() {
                    self.$field = newer.$field;
                }
            };
        }
        overwrite_present!(input_total_tokens);
        overwrite_present!(input_uncached_tokens);
        overwrite_present!(cache_read_input_tokens);
        overwrite_present!(cache_write_input_tokens);
        overwrite_present!(output_tokens);
        overwrite_present!(reasoning_tokens);
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct ProviderUsageAggregate {
    call_count: u64,
    input_total: u64,
    input_uncached: u64,
    cache_read: u64,
    cache_write: u64,
    output: u64,
    reasoning: u64,
    hit_request_count: u64,
    telemetry_incomplete: bool,
}

impl ProviderUsageAggregate {
    pub(crate) fn observe(&mut self, usage: &ProviderTokenUsage) {
        self.call_count = self.call_count.saturating_add(1);
        self.telemetry_incomplete |=
            usage.input_total_tokens.is_none() || usage.output_tokens.is_none();
        let cache_read = usage.cache_read_input_tokens.unwrap_or(0);
        let cache_write = usage.cache_write_input_tokens.unwrap_or(0);
        let input_uncached = usage.input_uncached_tokens.unwrap_or_else(|| {
            usage
                .input_total_tokens
                .unwrap_or(0)
                .saturating_sub(cache_read)
                .saturating_sub(cache_write)
        });
        self.input_total = self
            .input_total
            .saturating_add(usage.input_total_tokens.unwrap_or(0));
        self.input_uncached = self.input_uncached.saturating_add(input_uncached);
        self.cache_read = self.cache_read.saturating_add(cache_read);
        self.cache_write = self.cache_write.saturating_add(cache_write);
        self.output = self.output.saturating_add(usage.output_tokens.unwrap_or(0));
        self.reasoning = self
            .reasoning
            .saturating_add(usage.reasoning_tokens.unwrap_or(0));
        if cache_read > 0 {
            self.hit_request_count = self.hit_request_count.saturating_add(1);
        }
    }

    pub(crate) fn as_json(&self) -> Value {
        json!({
            "callCount": self.call_count,
            "inputTotal": self.input_total,
            "inputUncached": self.input_uncached,
            "cacheRead": self.cache_read,
            "cacheWrite": self.cache_write,
            "output": self.output,
            "reasoning": self.reasoning,
            "hitRequestCount": self.hit_request_count,
            "cacheReadShare": if self.input_total == 0 {
                0.0
            } else {
                self.cache_read as f64 / self.input_total as f64
            },
            "telemetryIncomplete": self.telemetry_incomplete,
        })
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct ModelLoopObservations {
    pub(crate) usage: ProviderUsageAggregate,
    pub(crate) latest_response_id: Option<String>,
    pub(crate) warnings: Vec<Value>,
}

impl ModelLoopObservations {
    pub(crate) fn observe(&mut self, reply: &ModelReply) {
        self.usage.observe(&reply.response_meta.usage);
        self.latest_response_id = reply.response_meta.response_id.clone();
    }

    pub(crate) fn warning(&mut self, kind: &str, parameter: &str, message: &str) {
        self.warnings.push(json!({
            "kind": kind,
            "parameter": parameter,
            "message": message,
        }));
    }
}
