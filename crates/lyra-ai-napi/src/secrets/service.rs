use uuid::Uuid;

pub fn create_secret_ref_id() -> String {
    format!("ai-secret-{}", Uuid::new_v4())
}
