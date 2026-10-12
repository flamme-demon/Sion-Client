pub mod v1 {
    use ruma::{
        OwnedRoomId,
        api::{auth_scheme::AccessToken, request, response},
        metadata,
    };
    use serde_json::Value;
    metadata! { method: POST, rate_limited: true, authentication: AccessToken, history: { 1.0 => "/_continuwuity/sion/conservation/v1", } }
    #[request]
    pub struct Request {
        pub action: String,
        #[serde(rename = "scopeId")]
        pub scope_id: OwnedRoomId,
        #[serde(default)]
        pub changes: Vec<Value>,
        pub revision: Option<String>,
    }
    #[response]
    pub struct Response {
        #[ruma_api(body)]
        pub body: Value,
    }
    impl Response {
        pub fn new(body: Value) -> Self {
            Self { body }
        }
    }
}
