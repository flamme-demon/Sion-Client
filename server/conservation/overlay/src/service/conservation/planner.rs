//! Plan de conservation sans accès à la base, au réseau ou au disque.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub(crate) const DAY: u64 = 86_400_000;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "lowercase", deny_unknown_fields)]
pub(crate) enum Policy {
    Unlimited,
    Days { days: u64 },
    Inherit { parent: String },
}
impl Default for Policy {
    fn default() -> Self {
        Self::Unlimited
    }
}
impl Policy {
    pub(crate) fn valid(&self) -> bool {
        match self {
            Self::Days { days } => (1..=36500).contains(days),
            Self::Inherit { parent } => {
                parent.starts_with('!')
                    && parent.len() > 1
                    && !parent.chars().any(char::is_whitespace)
            }
            Self::Unlimited => true,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Change {
    pub(crate) room_id: String,
    pub(crate) policy: Policy,
}
#[derive(Clone, Debug, Default)]
pub(crate) struct Room {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) space: bool,
    pub(crate) library: bool,
    pub(crate) parents: BTreeSet<String>,
    pub(crate) children: BTreeSet<String>,
    pub(crate) policy: Policy,
    pub(crate) author: String,
    pub(crate) members: BTreeMap<String, i64>,
    pub(crate) redact_level: i64,
    pub(crate) redact_own_level: i64,
    pub(crate) state_id: String,
    pub(crate) pins: BTreeSet<String>,
}
#[derive(Clone, Debug)]
pub(crate) struct Message {
    pub(crate) room: String,
    pub(crate) id: String,
    pub(crate) sender: String,
    pub(crate) ts: u64,
    pub(crate) urls: BTreeSet<String>,
}
#[derive(Clone, Debug, Default)]
pub(crate) struct World {
    pub(crate) rooms: BTreeMap<String, Room>,
    pub(crate) messages: Vec<Message>,
    pub(crate) permanent: BTreeSet<String>,
    pub(crate) opaque: bool,
}
#[derive(Default, Debug)]
pub(crate) struct Plan {
    pub(crate) events: Vec<(String, String, String)>,
    pub(crate) files: BTreeSet<String>,
    pub(crate) protected_files: BTreeSet<String>,
    pub(crate) uncertain_files: BTreeSet<String>,
    pub(crate) blocked: usize,
}

pub(crate) fn urls(value: &Value, into: &mut BTreeSet<String>) {
    match value {
        Value::String(s) => {
            // Les émoticônes personnalisées et images intégrées peuvent
            // référencer le média dans formatted_body, sans champ url séparé.
            if s.starts_with("mxc://") {
                into.insert(s.clone());
            }
            for (start, _) in s.match_indices("mxc://") {
                let url = s[start..]
                    .split(|c: char| {
                        c.is_whitespace()
                            || matches!(
                                c,
                                '\"' | '\''
                                    | '<'
                                    | '>'
                                    | '('
                                    | ')'
                                    | '{'
                                    | '}'
                                    | '\\'
                                    | '&'
                                    | '?'
                                    | '#'
                            )
                    })
                    .next()
                    .unwrap_or("");
                if !url.is_empty() {
                    into.insert(url.to_owned());
                }
            }
        }
        Value::Array(a) => {
            for v in a {
                urls(v, into);
            }
        }
        Value::Object(o) => {
            for v in o.values() {
                urls(v, into);
            }
        }
        _ => (),
    }
}
pub(crate) fn parent<'a>(world: &'a World, room: &Room) -> Option<&'a Room> {
    if room.parents.len() != 1 {
        return None;
    }
    world
        .rooms
        .get(room.parents.first()?)
        .filter(|p| p.space && p.children.contains(&room.id))
}
pub(crate) fn effective<'a>(world: &'a World, room: &'a Room) -> (Option<u64>, &'a str) {
    match &room.policy {
        Policy::Days { days } if room.policy.valid() => (Some(*days), &room.author),
        Policy::Inherit { parent: id } => match parent(world, room).filter(|p| &p.id == id) {
            Some(p) => match p.policy {
                Policy::Days { days } if p.policy.valid() => (Some(days), &p.author),
                _ => (None, ""),
            },
            None => (None, ""),
        },
        _ => (None, ""),
    }
}
pub(crate) fn allowed(world: &World, room: &Room, actor: &str) -> bool {
    // L'auteur de la règle doit être encore administrateur de l'espace ou
    // du salon. La suppression exige aussi les permissions du salon cible.
    let owner = if matches!(room.policy, Policy::Inherit { .. }) {
        parent(world, room)
    } else {
        Some(room)
    };
    owner.is_some_and(|r| r.members.get(actor).copied().unwrap_or(-1) >= 100)
}
pub(crate) fn validate(
    world: &World,
    scope: &str,
    actor: &str,
    changes: &[Change],
) -> Result<(), &'static str> {
    let root = world.rooms.get(scope).ok_or("M_NOT_FOUND")?;
    if !root.members.contains_key(actor) {
        return Err("M_FORBIDDEN");
    }
    let mut seen = BTreeSet::new();
    if changes.is_empty() || changes.len() > 100 {
        return Err("M_INVALID_PARAM");
    }
    for c in changes {
        let room = world.rooms.get(&c.room_id).ok_or("M_NOT_FOUND")?;
        if !seen.insert(&c.room_id)
            || !c.policy.valid()
            || room.library
            || (room.id != scope
                && (!root.space || !root.children.contains(&room.id) || room.space))
        {
            return Err("M_INVALID_PARAM");
        }
        if room.members.get(actor).copied().unwrap_or(-1) < 100 {
            return Err("M_FORBIDDEN");
        }
        if let Policy::Inherit { parent: id } = &c.policy {
            if room.space || !parent(world, room).is_some_and(|p| &p.id == id) {
                return Err("M_INVALID_PARAM");
            }
        }
    }
    Ok(())
}
pub(crate) fn modified(world: &World, actor: &str, changes: &[Change]) -> World {
    let mut new = world.clone();
    for c in changes {
        if let Some(r) = new.rooms.get_mut(&c.room_id) {
            r.policy = c.policy.clone();
            r.author = actor.to_owned();
        }
    }
    new
}
pub(crate) fn plan(world: &World, now: u64, local_server: &str, scope: Option<&str>) -> Plan {
    let mut out = Plan::default();
    let mut kept = world.permanent.clone();
    let target = |room: &Room| {
        scope.is_none_or(|s| {
            room.id == s
                || world
                    .rooms
                    .get(s)
                    .is_some_and(|r| r.space && r.children.contains(&room.id))
        })
    };
    for m in &world.messages {
        let Some(room) = world.rooms.get(&m.room) else {
            kept.extend(m.urls.clone());
            continue;
        };
        let (days, actor) = effective(world, room);
        let expired = days.is_some_and(|d| m.ts > 0 && m.ts < now.saturating_sub(d * DAY));
        let level = room.members.get(actor).copied().unwrap_or(-1);
        let authorised = allowed(world, room, actor)
            && level >= 0
            && level >= room.redact_own_level
            && (m.sender == actor || level >= room.redact_level);
        if target(room)
            && !room.space
            && !room.library
            && !room.pins.contains(&m.id)
            && expired
            && authorised
        {
            out.events
                .push((room.id.clone(), m.id.clone(), actor.to_owned()));
            for url in &m.urls {
                if url
                    .strip_prefix("mxc://")
                    .and_then(|s| s.split_once('/'))
                    .is_some_and(|(server, id)| server == local_server && !id.is_empty())
                {
                    out.files.insert(url.clone());
                } else {
                    out.protected_files.insert(url.clone());
                }
            }
        } else {
            if target(room)
                && expired
                && !room.space
                && !room.library
                && !room.pins.contains(&m.id)
                && !authorised
            {
                out.blocked += 1;
            }
            kept.extend(m.urls.clone());
        }
    }
    let reused: Vec<_> = out.files.intersection(&kept).cloned().collect();
    for url in reused {
        out.files.remove(&url);
        out.protected_files.insert(url);
    }
    if world.opaque {
        out.uncertain_files = std::mem::take(&mut out.files);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    fn world() -> World {
        let root = Room {
            id: "!space:hs".into(),
            name: "Equipe".into(),
            space: true,
            children: BTreeSet::from(["!chat:hs".into(), "!board:hs".into()]),
            policy: Policy::Days { days: 90 },
            author: "@admin:hs".into(),
            members: BTreeMap::from([("@admin:hs".into(), 100)]),
            ..Room::default()
        };
        let room = Room {
            id: "!chat:hs".into(),
            parents: BTreeSet::from([root.id.clone()]),
            policy: Policy::Inherit {
                parent: root.id.clone(),
            },
            members: root.members.clone(),
            redact_level: 50,
            ..Room::default()
        };
        let board = Room {
            id: "!board:hs".into(),
            library: true,
            policy: Policy::Days { days: 1 },
            author: root.author.clone(),
            members: root.members.clone(),
            ..Room::default()
        };
        World {
            rooms: [root, room, board]
                .into_iter()
                .map(|r| (r.id.clone(), r))
                .collect(),
            messages: vec![Message {
                room: "!chat:hs".into(),
                id: "$old".into(),
                sender: "@user:hs".into(),
                ts: DAY,
                urls: BTreeSet::from(["mxc://hs/file".into()]),
            }],
            ..World::default()
        }
    }
    #[test]
    fn opaque_v12_parent_is_valid() {
        let mut w = world();
        let mut space = w.rooms.remove("!space:hs").unwrap();
        space.id = "!opaque-matrix-space".into();
        w.rooms.insert(space.id.clone(), space);
        let room = w.rooms.get_mut("!chat:hs").unwrap();
        room.parents = BTreeSet::from(["!opaque-matrix-space".into()]);
        let change = Change {
            room_id: room.id.clone(),
            policy: Policy::Inherit {
                parent: "!opaque-matrix-space".into(),
            },
        };
        assert!(validate(&w, "!opaque-matrix-space", "@admin:hs", &[change]).is_ok());
    }
    #[test]
    fn inherit_and_default_unlimited() {
        let mut w = world();
        assert_eq!(plan(&w, 100 * DAY, "hs", None).events.len(), 1);
        w.rooms.get_mut("!space:hs").unwrap().policy = Policy::Unlimited;
        assert!(plan(&w, 100 * DAY, "hs", None).events.is_empty());
    }
    #[test]
    fn library_messages_and_reused_files_survive() {
        let mut w = world();
        let mut m = w.messages[0].clone();
        m.room = "!board:hs".into();
        m.id = "$sound".into();
        w.messages.push(m);
        let p = plan(&w, 100 * DAY, "hs", None);
        assert_eq!(p.events.len(), 1);
        assert!(p.files.is_empty());
        assert_eq!(p.protected_files.len(), 1);
    }
    #[test]
    fn avatars_and_state_references_are_permanent() {
        let mut w = world();
        w.permanent.insert("mxc://hs/file".into());
        assert!(plan(&w, 100 * DAY, "hs", None).files.is_empty());
    }
    #[test]
    fn encrypted_or_incomplete_references_prevent_file_deletion() {
        let mut w = world();
        w.opaque = true;
        let p = plan(&w, 100 * DAY, "hs", None);
        assert_eq!(p.events.len(), 1);
        assert!(p.files.is_empty());
        assert_eq!(p.uncertain_files.len(), 1);
    }
    #[test]
    fn pinned_messages_survive() {
        let mut w = world();
        w.rooms
            .get_mut("!chat:hs")
            .unwrap()
            .pins
            .insert("$old".into());
        assert!(plan(&w, 100 * DAY, "hs", None).events.is_empty());
    }
    #[test]
    fn explicit_room_override_wins() {
        let mut w = world();
        let r = w.rooms.get_mut("!chat:hs").unwrap();
        r.policy = Policy::Unlimited;
        assert!(plan(&w, 100 * DAY, "hs", None).events.is_empty());
    }
    #[test]
    fn expired_administrator_permissions_stop_cleanup() {
        let mut w = world();
        w.rooms.get_mut("!space:hs").unwrap().members.clear();
        let p = plan(&w, 100 * DAY, "hs", None);
        assert!(p.events.is_empty());
        assert_eq!(p.blocked, 1);
    }
    #[test]
    fn missing_room_permission_preserves_message_and_file() {
        let mut w = world();
        w.rooms.get_mut("!chat:hs").unwrap().members.clear();
        let p = plan(&w, 100 * DAY, "hs", None);
        assert!(p.events.is_empty());
        assert!(p.files.is_empty());
    }
    #[test]
    fn redaction_event_permission_is_required_for_own_messages_too() {
        let mut w = world();
        w.messages[0].sender = "@admin:hs".into();
        w.rooms.get_mut("!chat:hs").unwrap().redact_own_level = 150;
        let p = plan(&w, 100 * DAY, "hs", None);
        assert!(p.events.is_empty());
        assert_eq!(p.blocked, 1);
    }
    #[test]
    fn unrelated_scope_does_not_expire_files() {
        let w = world();
        let p = plan(&w, 100 * DAY, "hs", Some("!other:hs"));
        assert!(p.events.is_empty());
        assert!(p.files.is_empty());
    }
    #[test]
    fn ambiguous_parent_disables_inheritance() {
        let mut w = world();
        w.rooms
            .get_mut("!chat:hs")
            .unwrap()
            .parents
            .insert("!other:hs".into());
        assert!(plan(&w, 100 * DAY, "hs", None).events.is_empty());
    }
    #[test]
    fn mismatched_links_disable_inheritance() {
        let mut w = world();
        w.rooms.get_mut("!space:hs").unwrap().children.clear();
        assert!(plan(&w, 100 * DAY, "hs", None).events.is_empty());
    }
    #[test]
    fn preview_change_does_not_mutate_saved_world() {
        let w = world();
        let changes = vec![Change {
            room_id: "!chat:hs".into(),
            policy: Policy::Unlimited,
        }];
        let new = modified(&w, "@admin:hs", &changes);
        assert!(plan(&new, 100 * DAY, "hs", None).events.is_empty());
        assert_eq!(plan(&w, 100 * DAY, "hs", None).events.len(), 1);
    }
    #[test]
    fn invalid_days_and_library_changes_rejected() {
        let w = world();
        for (id, days) in [("!chat:hs", 0), ("!chat:hs", 36501), ("!board:hs", 30)] {
            assert!(
                validate(
                    &w,
                    "!space:hs",
                    "@admin:hs",
                    &[Change {
                        room_id: id.into(),
                        policy: Policy::Days { days }
                    }]
                )
                .is_err()
            );
        }
    }
    #[test]
    fn non_admin_and_scope_escape_rejected() {
        let w = world();
        assert!(
            validate(
                &w,
                "!space:hs",
                "@user:hs",
                &[Change {
                    room_id: "!chat:hs".into(),
                    policy: Policy::Unlimited
                }]
            )
            .is_err()
        );
        assert!(
            validate(
                &w,
                "!chat:hs",
                "@admin:hs",
                &[Change {
                    room_id: "!space:hs".into(),
                    policy: Policy::Unlimited
                }]
            )
            .is_err()
        );
    }
    #[test]
    fn foreign_media_is_never_deleted() {
        let mut w = world();
        w.messages[0].urls = BTreeSet::from(["mxc://elsewhere/file".into()]);
        assert!(plan(&w, 100 * DAY, "hs", None).files.is_empty());
    }
    #[test]
    fn future_and_boundary_timestamps_survive() {
        let mut w = world();
        w.messages[0].ts = 10 * DAY;
        assert!(plan(&w, 100 * DAY, "hs", None).events.is_empty());
        w.messages[0].ts = 110 * DAY;
        assert!(plan(&w, 100 * DAY, "hs", None).events.is_empty());
    }
    #[test]
    fn nested_media_and_thumbnails_are_found() {
        let mut u = BTreeSet::new();
        urls(
            &serde_json::json!({"file":{"url":"mxc://hs/main"},"info":{"thumbnail_file":{"url":"mxc://hs/thumb"}},"portrait":"mxc://hs/avatar"}),
            &mut u,
        );
        assert_eq!(u.len(), 3);
    }
    #[test]
    fn inline_emoji_references_preserve_reused_media() {
        let mut w = world();
        urls(
            &serde_json::json!({"formatted_body":"Salut <img data-mx-emoticon src=\"mxc://hs/file\" alt=\":rire:\">"}),
            &mut w.permanent,
        );
        assert!(plan(&w, 100 * DAY, "hs", None).files.is_empty());
    }
}
