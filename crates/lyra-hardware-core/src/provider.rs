use crate::{
    HardwareActionRequest, HardwareActionResponse, HardwareDevice, HardwareDeviceFilter,
    HardwareError, HardwareProviderStatus,
};

pub trait HardwareProvider: Send + Sync {
    fn id(&self) -> &'static str;

    fn list_devices(
        &self,
        filter: &HardwareDeviceFilter,
    ) -> Result<Vec<HardwareDevice>, HardwareError>;

    fn invoke(
        &self,
        _request: &HardwareActionRequest,
    ) -> Result<Option<HardwareActionResponse>, HardwareError> {
        Ok(None)
    }

    fn status(&self) -> HardwareProviderStatus {
        HardwareProviderStatus {
            provider_id: self.id().to_string(),
            status: "available".to_string(),
            detail: None,
        }
    }
}

pub fn unsupported_provider_status(
    provider_id: &str,
    detail: impl Into<String>,
) -> HardwareProviderStatus {
    HardwareProviderStatus {
        provider_id: provider_id.to_string(),
        status: "unsupported".to_string(),
        detail: Some(detail.into()),
    }
}
