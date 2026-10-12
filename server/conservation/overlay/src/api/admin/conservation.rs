use crate::Ruma;
use axum::extract::State;
use conduwuit::Result;
use ruminuwuity::admin::continuwuity::conservation::v1;

pub(crate) async fn request(
    State(services): State<crate::State>,
    body: Ruma<v1::Request>,
) -> Result<v1::Response> {
    let user = body.identity.expect_sender_user()?;
    let result = services
        .conservation
        .request(
            user,
            &body.scope_id,
            &body.action,
            &body.changes,
            body.revision.as_deref(),
        )
        .await?;
    Ok(v1::Response::new(result))
}
