//! Extension optionnelle Sion : état Matrix pour les règles, aperçu obligatoire,
//! worker indépendant du client et collecte conservatrice des références média.
mod planner;

use crate::{Dep, globals, media, rooms, users};
use async_trait::async_trait;
use conduwuit::{Err, Event, PduEvent, Result, Server, err, pdu::PartialPdu, utils};
use database::{Database, Deserialized, Json};
use futures::{TryStreamExt, pin_mut};
use planner::{Change, Message, Policy, Room, World};
use ruma::{
    EventId, OwnedEventId, OwnedRoomId, RoomAliasId, RoomId, UserId,
    events::{
        MessageLikeEventType,
        room::{power_levels::UserPowerLevel, redaction::RoomRedactionEventContent},
    },
};
use serde_json::{Value, json, value::to_raw_value};
use std::{
    collections::{BTreeMap, BTreeSet},
    hash::{Hash, Hasher},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::{Mutex, Notify, RwLock};

// Les écritures normales prennent ce verrou seulement pendant leur commit.
// Le worker prend try_write après son audit et abandonne les fichiers si une
// référence a changé entre-temps. Il ne bloque jamais le chat pour un scan.
pub(crate) static MEDIA_BARRIER: RwLock<()> = RwLock::const_new(());
pub(crate) static MEDIA_EPOCH: AtomicU64 = AtomicU64::new(0);
const RULE: &str = "com.sion.retention";
const HEALTH: &str = "sion.conservation.health.v1";
const PENDING: &str = "sion.conservation.pending-media.v1";
const LIBRARIES: &str = "sion.conservation.protected-rooms.v1";
const MAX_SCAN: usize = 200_000;

pub struct Service {
    server: Arc<Server>,
    db: Arc<Database>,
    timeline: Dep<rooms::timeline::Service>,
    state: Dep<rooms::state::Service>,
    accessor: Dep<rooms::state_accessor::Service>,
    short: Dep<rooms::short::Service>,
    alias: Dep<rooms::alias::Service>,
    users: Dep<users::Service>,
    media: Dep<media::Service>,
    globals: Dep<globals::Service>,
    serial: Mutex<()>,
    previews: Mutex<BTreeMap<String, Preview>>,
    stop: Notify,
}
struct Preview {
    actor: String,
    scope: String,
    changes: Vec<Change>,
    fingerprint: u64,
    expires: u64,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[async_trait]
impl crate::Service for Service {
    fn build(args: crate::Args<'_>) -> Result<Arc<Self>> {
        Ok(Arc::new(Self {
            server: args.server.clone(),
            db: args.db.clone(),
            timeline: args.depend("rooms::timeline"),
            state: args.depend("rooms::state"),
            accessor: args.depend("rooms::state_accessor"),
            short: args.depend("rooms::short"),
            users: args.depend("users"),
            media: args.depend("media"),
            globals: args.depend("globals"),
            alias: args.depend("rooms::alias"),
            serial: Mutex::new(()),
            previews: Mutex::new(BTreeMap::new()),
            stop: Notify::new(),
        }))
    }
    async fn worker(self: Arc<Self>) -> Result<()> {
        if !self.server.config.sion_conservation_enabled {
            return Ok(());
        }
        let mut ticker = tokio::time::interval(Duration::from_secs(3600));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                _ = self.stop.notified() => break,
                _ = ticker.tick() => {
                    if !self.server.running() { break; }
                    // Une erreur d'audit arrête ce cycle, jamais le homeserver.
                    if self.run().await.is_err() { self.db["global"].put(HEALTH, Json(json!({"lastRun":now(), "failed":true}))); }
                }
            }
        }
        Ok(())
    }
    fn interrupt(&self) {
        self.stop.notify_one();
    }
    fn name(&self) -> &str {
        crate::service::make_name(std::module_path!())
    }
}

impl Service {
    async fn world(&self, full: bool) -> Result<World> {
        self.world_for(full, None).await
    }
    async fn world_for(&self, full: bool, selected: Option<Vec<OwnedRoomId>>) -> Result<World> {
        let mut world = World::default();
        let mut count = 0_usize;
        let mut room_prefixes = BTreeMap::new();
        let ids: Vec<OwnedRoomId> = match selected {
            Some(ids) => ids,
            None => {
                self.db["roomid_shortstatehash"]
                    .keys::<OwnedRoomId>()
                    .try_collect()
                    .await?
            }
        };
        let mut library_ids: BTreeSet<String> = match self.db["global"].get(LIBRARIES).await {
            Ok(raw) => raw
                .deserialized()
                .map_err(|_| err!("Conservation: invalid library registry"))?,
            Err(e) if e.is_not_found() => BTreeSet::new(),
            Err(e) => return Err(e),
        };
        let legacy = RoomAliasId::parse(format!("#soundboard:{}", self.globals.server_name()))
            .map_err(|_| err!("Conservation: invalid local alias"))?;
        match self.alias.resolve_local_alias(&legacy).await {
            Ok(id) => {
                library_ids.insert(id.to_string());
            }
            Err(e) if e.is_not_found() => (),
            Err(e) => return Err(e),
        }
        for id in ids {
            self.server.check_running()?;
            if full {
                room_prefixes.insert(self.short.get_shortroomid(&id).await?, id.to_string());
            }
            let mut room = Room {
                id: id.to_string(),
                name: id.to_string(),
                redact_level: 50,
                ..Room::default()
            };
            let mut joined = BTreeSet::new();
            let mut saved_rule = None;
            let hash = self.state.get_room_shortstatehash(&id).await?;
            let stream = self.accessor.state_full_shortids(hash);
            pin_mut!(stream);
            while let Some((_, short_id)) = stream.try_next().await? {
                let event_id: OwnedEventId = self.short.get_eventid_from_short(short_id).await?;
                let event = self.timeline.get_pdu(&event_id).await?;
                count += 1;
                if count > MAX_SCAN {
                    return Err!("Conservation: state scan limit reached");
                }
                let content: Value = serde_json::from_str(event.content().get())
                    .map_err(|_| err!("Conservation: invalid state"))?;
                planner::urls(&content, &mut world.permanent);
                match event.kind().to_string().as_str() {
                    "m.room.create" => room.space = content["type"] == "m.space",
                    "m.room.name" => {
                        if let Some(name) = content["name"].as_str() {
                            room.name = name.to_owned();
                        }
                    }
                    "m.room.type" => room.library |= content["type"] == "com.sion.board",
                    "com.sion.space" => {
                        if let Some(board) = content["board_room_id"].as_str() {
                            library_ids.insert(board.to_owned());
                        }
                    }
                    "m.room.encryption" => world.opaque = true,
                    "m.room.member" if content["membership"] == "join" => {
                        if let Some(user) = event.state_key() {
                            joined.insert(user.to_owned());
                        }
                    }
                    "m.room.pinned_events" => {
                        if let Some(pins) = content["pinned"].as_array() {
                            room.pins
                                .extend(pins.iter().filter_map(Value::as_str).map(str::to_owned));
                        }
                    }
                    "m.space.parent"
                        if content["canonical"] == true
                            && content["via"].as_array().is_some_and(|a| !a.is_empty()) =>
                    {
                        if let Some(parent) = event.state_key() {
                            room.parents.insert(parent.to_owned());
                        }
                    }
                    "m.space.child" if content["via"].as_array().is_some_and(|a| !a.is_empty()) => {
                        if let Some(child) = event.state_key() {
                            room.children.insert(child.to_owned());
                        }
                    }
                    RULE => {
                        room.state_id = event.event_id().to_string();
                        room.author = event.sender().to_string();
                        saved_rule = Some(content);
                    }
                    _ => (),
                }
            }
            let levels = self.accessor.get_room_power_levels(&id).await;
            room.redact_own_level =
                i64::from(levels.for_message(MessageLikeEventType::RoomRedaction));
            room.redact_level = i64::from(levels.redact).max(room.redact_own_level);
            for user in joined {
                let parsed =
                    UserId::parse(&user).map_err(|_| err!("Conservation: invalid member"))?;
                let level = match levels.for_user(&parsed) {
                    UserPowerLevel::Infinite => i64::MAX,
                    UserPowerLevel::Int(n) => i64::from(n),
                    _ => -1,
                };
                // Un auteur suspendu, verrouillé ou désactivé ne continue pas
                // à faire appliquer une règle destructive avec ses pouvoirs.
                let eligible = UserId::parse(&user)
                    .ok()
                    .is_some_and(|u| self.globals.user_is_local(&u));
                let active = if eligible {
                    let u = UserId::parse(&user).unwrap();
                    self.users.status(&u).await.is_active()
                        && !self.users.is_suspended(&u).await.unwrap_or(true)
                        && !self.users.is_locked(&u).await.unwrap_or(true)
                } else {
                    false
                };
                room.members.insert(user, if active { level } else { -1 });
            }
            if let Some(content) = saved_rule {
                room.policy = serde_json::from_value(content["policy"].clone()).unwrap_or_default();
                if !room.policy.valid() {
                    room.policy = Policy::Unlimited;
                }
            } else if room.parents.len() == 1 && !room.space {
                room.policy = Policy::Inherit {
                    parent: room.parents.first().unwrap().clone(),
                };
            }
            world.rooms.insert(room.id.clone(), room);
            tokio::task::yield_now().await;
        }
        if full {
            // Lire toute la timeline brute, y compris les salons sans état
            // courant. Une référence ne disparaît pas parce qu'un salon n'est
            // plus présent dans la liste des salons accessibles.
            let events = self.db["pduid_pdu"].raw_stream();
            pin_mut!(events);
            while let Some((key, raw)) = events.try_next().await? {
                self.server.check_running()?;
                count += 1;
                if count > MAX_SCAN {
                    return Err!("Conservation: event scan limit reached");
                }
                let event: PduEvent = serde_json::from_slice(raw)
                    .map_err(|_| err!("Conservation: invalid timeline event"))?;
                if let Some(unsigned) = event.unsigned() {
                    let value: Value = serde_json::from_str(unsigned.get())
                        .map_err(|_| err!("Conservation: invalid unsigned event data"))?;
                    planner::urls(&value, &mut world.permanent);
                }
                let content: Value = serde_json::from_str(event.content().get())
                    .map_err(|_| err!("Conservation: invalid event content"))?;
                let mut urls = BTreeSet::new();
                planner::urls(&content, &mut urls);
                let kind = event.kind().to_string();
                if kind == "m.room.encrypted" {
                    world.opaque = true;
                }
                // Les PDUs des salons v12 omettent room_id. Le préfixe de la
                // clé persistée fournit le contexte, aussi pour le backfill.
                if !matches!(key.len(), 16 | 24) {
                    return Err!("Conservation: invalid timeline key");
                }
                let short_room = u64::from_be_bytes(
                    key[..8]
                        .try_into()
                        .map_err(|_| err!("Conservation: invalid room prefix"))?,
                );
                let Some(room_id) = room_prefixes.get(&short_room) else {
                    world.permanent.extend(urls);
                    continue;
                };
                if event.room_id().is_some_and(|id| id.as_str() != room_id) {
                    return Err!("Conservation: inconsistent room context");
                }
                if let Some(room) = world.rooms.get_mut(room_id.as_str()) {
                    room.library |= content.get("com.sion.soundboard").is_some()
                        || content.get("com.sion.meme").is_some();
                }
                if !world.rooms.contains_key(room_id.as_str())
                    || event.state_key().is_some()
                    || !matches!(
                        kind.as_str(),
                        "m.room.message" | "m.room.encrypted" | "org.matrix.msc3381.poll.start"
                    )
                    || event.is_redacted()
                {
                    world.permanent.extend(urls);
                } else {
                    world.messages.push(Message {
                        room: room_id.to_string(),
                        id: event.event_id().to_string(),
                        sender: event.sender().to_string(),
                        ts: u64::from(event.origin_server_ts().0),
                        urls,
                    });
                }
            }
            library_ids.extend(
                world
                    .rooms
                    .values()
                    .filter(|r| r.library)
                    .map(|r| r.id.clone()),
            );
            self.db["global"].put(LIBRARIES, Json(&library_ids));
            // Les outliers peuvent contenir des références absentes du fil.
            let outliers = self.db["eventid_outlierpdu"].raw_stream();
            pin_mut!(outliers);
            while let Some((_, raw)) = outliers.try_next().await? {
                count += 1;
                if count > MAX_SCAN {
                    return Err!("Conservation: outlier scan limit reached");
                }
                let event: Value = serde_json::from_slice(raw)
                    .map_err(|_| err!("Conservation: invalid outlier"))?;
                planner::urls(&event, &mut world.permanent);
                if event["type"] == "m.room.encrypted" {
                    world.opaque = true;
                }
            }
            let avatars = self.db["userid_avatarurl"].raw_stream();
            pin_mut!(avatars);
            while let Some((_, raw)) = avatars.try_next().await? {
                count += 1;
                if count > MAX_SCAN {
                    return Err!("Conservation: avatar scan limit reached");
                }
                let url = std::str::from_utf8(raw)
                    .map_err(|_| err!("Conservation: invalid avatar URL"))?;
                planner::urls(&Value::String(url.to_owned()), &mut world.permanent);
            }
            let profiles = self.db["useridprofilekey_value"].raw_stream();
            pin_mut!(profiles);
            while let Some((_, raw)) = profiles.try_next().await? {
                count += 1;
                if count > MAX_SCAN {
                    return Err!("Conservation: profile scan limit reached");
                }
                let value: Value = serde_json::from_slice(raw)
                    .map_err(|_| err!("Conservation: invalid profile value"))?;
                planner::urls(&value, &mut world.permanent);
            }
            let account_data = self.db["roomuserdataid_accountdata"].raw_stream();
            pin_mut!(account_data);
            while let Some((_, raw)) = account_data.try_next().await? {
                count += 1;
                if count > MAX_SCAN {
                    return Err!("Conservation: account data scan limit reached");
                }
                let value: Value = serde_json::from_slice(raw)
                    .map_err(|_| err!("Conservation: invalid account data"))?;
                planner::urls(&value, &mut world.permanent);
            }
        }
        for id in &library_ids {
            if let Some(r) = world.rooms.get_mut(id) {
                r.library = true;
            }
        }
        Ok(world)
    }
    fn check_scope<'a>(&self, world: &'a World, user: &UserId, scope: &RoomId) -> Result<&'a Room> {
        let room = world
            .rooms
            .get(scope.as_str())
            .ok_or_else(|| err!(Request(NotFound("Room not found"))))?;
        if !room.members.contains_key(user.as_str()) {
            return Err!(Request(Forbidden("Room membership required")));
        }
        Ok(room)
    }
    fn room_view(&self, world: &World, room: &Room, user: &UserId) -> Value {
        let parent = planner::parent(world, room);
        json!({"id":room.id,"name":room.name,"isSpace":room.space,"policy":room.policy,
            "effectiveDays":planner::effective(world,room).0,"parentId":parent.map(|p|&p.id),"parentName":parent.map(|p|&p.name),
            "editable":room.members.get(user.as_str()).copied().unwrap_or(-1)>=100 && !room.library,"protected":room.library})
    }
    async fn view(&self, world: &World, user: &UserId, scope: &RoomId) -> Result<Value> {
        let root = self.check_scope(world, user, scope)?;
        let status: Value = self.db["global"]
            .get(HEALTH)
            .await
            .deserialized()
            .unwrap_or(Value::Null);
        Ok(
            json!({"available":self.server.config.sion_conservation_enabled,"applying":self.server.config.sion_conservation_apply && self.server.config.sion_conservation_enabled,"lastRun":status["lastRun"],"lastFailed":status["failed"]==true,
            "scope":self.room_view(world,root,user),"rooms":world.rooms.values().filter(|r|root.space && root.children.contains(&r.id) && !r.space && r.members.contains_key(user.as_str())).map(|r|self.room_view(world,r,user)).collect::<Vec<_>>()}),
        )
    }
    fn fingerprint(world: &World, scope: &RoomId, actor: &UserId, changes: &[Change]) -> u64 {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        scope.hash(&mut h);
        actor.hash(&mut h);
        for r in world.rooms.values() {
            r.id.hash(&mut h);
            r.state_id.hash(&mut h);
            r.members.hash(&mut h);
            r.parents.hash(&mut h);
            r.children.hash(&mut h);
            r.library.hash(&mut h);
            r.pins.hash(&mut h);
            r.redact_level.hash(&mut h);
            r.redact_own_level.hash(&mut h);
        }
        serde_json::to_string(changes).unwrap().hash(&mut h);
        h.finish()
    }
    pub async fn request(
        &self,
        user: &UserId,
        scope: &RoomId,
        action: &str,
        changes: &[Value],
        revision: Option<&str>,
    ) -> Result<Value> {
        if !self.server.config.sion_conservation_enabled && action != "read" {
            return Err!(Request(Forbidden("Sion retention service is disabled")));
        }
        let _serial = self.serial.lock().await;
        if action == "read" {
            let w = self.world(false).await?;
            return self.view(&w, user, scope).await;
        }
        if !matches!(action, "preview" | "save") {
            return Err!(Request(InvalidParam("Unknown retention action")));
        }
        let changes: Vec<Change> = changes
            .iter()
            .cloned()
            .map(serde_json::from_value)
            .collect::<std::result::Result<_, _>>()
            .map_err(|_| err!(Request(InvalidParam("Invalid retention policy"))))?;
        let world = self.world(false).await?;
        self.check_scope(&world, user, scope)?;
        if let Err(code) = planner::validate(&world, scope.as_str(), user.as_str(), &changes) {
            return if code == "M_FORBIDDEN" {
                Err!(Request(Forbidden("Administrator permissions required")))
            } else {
                Err!(Request(InvalidParam("Invalid room or retention policy")))
            };
        }
        let world = if action == "preview" {
            let full = self.world(true).await?;
            self.check_scope(&full, user, scope)?;
            planner::validate(&full, scope.as_str(), user.as_str(), &changes)
                .map_err(|_| err!(Request(Forbidden("Permissions or room state changed"))))?;
            full
        } else {
            world
        };
        let fingerprint = Self::fingerprint(&world, scope, user, &changes);
        if action == "preview" {
            let mut visible = planner::modified(&world, user.as_str(), &changes);
            // Les références restent dans l'audit global, mais les messages
            // d'un salon privé non rejoint ne contribuent pas aux compteurs.
            for m in &visible.messages {
                if !visible.rooms[&m.room].members.contains_key(user.as_str()) {
                    visible
                        .rooms
                        .get_mut(&m.room)
                        .unwrap()
                        .pins
                        .insert(m.id.clone());
                }
            }
            let plan = planner::plan(
                &visible,
                now(),
                self.globals.server_name().as_str(),
                Some(scope.as_str()),
            );
            let revision = utils::random_string(32);
            let expires = now() + 300_000;
            let mut cache = self.previews.lock().await;
            cache.retain(|_, p| p.expires > now());
            if cache.len() >= 32 {
                cache.clear();
            }
            cache.insert(
                revision.clone(),
                Preview {
                    actor: user.to_string(),
                    scope: scope.to_string(),
                    changes,
                    fingerprint,
                    expires,
                },
            );
            return Ok(
                json!({"revision":revision,"expiresAt":expires,"messages":plan.events.len(),"files":plan.files.len(),
                "protectedFiles":plan.protected_files.len(),"uncertainFiles":plan.uncertain_files.len(),"blockedMessages":plan.blocked}),
            );
        }
        let preview = self
            .previews
            .lock()
            .await
            .remove(revision.unwrap_or(""))
            .ok_or_else(|| err!(Request(InvalidParam("M_SION_PREVIEW_STALE"), CONFLICT)))?;
        if preview.expires <= now()
            || preview.actor != user.as_str()
            || preview.scope != scope.as_str()
            || preview.changes != changes
            || preview.fingerprint != fingerprint
        {
            return Err!(Request(InvalidParam("M_SION_PREVIEW_STALE"), CONFLICT));
        }
        for change in &changes {
            let room = RoomId::parse(&change.room_id)
                .map_err(|_| err!(Request(InvalidParam("Invalid room ID"))))?;
            let lock = self.state.mutex.lock(&room).await;
            self.timeline
                .build_and_append_pdu(
                    PartialPdu {
                        event_type: RULE.into(),
                        state_key: Some("".into()),
                        content: to_raw_value(&json!({"policy":change.policy})).unwrap(),
                        ..PartialPdu::default()
                    },
                    user,
                    Some(&room),
                    &lock,
                )
                .await?;
        }
        self.view(&self.world(false).await?, user, scope).await
    }
    async fn run(&self) -> Result<()> {
        let _serial = self.serial.lock().await;
        let world = self.world(true).await?;
        let plan = planner::plan(&world, now(), self.globals.server_name().as_str(), None);
        let mut pending: BTreeMap<String, u64> = match self.db["global"].get(PENDING).await {
            Ok(raw) => raw
                .deserialized()
                .map_err(|_| err!("Conservation: invalid pending media registry"))?,
            Err(e) if e.is_not_found() => BTreeMap::new(),
            Err(e) => return Err(e),
        };
        if !self.server.config.sion_conservation_apply {
            self.db["global"].put(HEALTH,Json(json!({"lastRun":now(),"messages":plan.events.len(),"files":plan.files.len(),"preview":true})));
            return Ok(());
        }
        let mut failures = 0_usize;
        let mut removed = 0_usize;
        for (room_id, event_id, actor) in plan.events.iter().take(500) {
            self.server.check_running()?;
            // Avant chaque message, revalider toutes les règles et les droits.
            let mut recheck = vec![RoomId::parse(room_id).unwrap()];
            if let Some(parent) = world
                .rooms
                .get(room_id)
                .and_then(|r| planner::parent(&world, r))
            {
                recheck.push(RoomId::parse(&parent.id).unwrap());
            }
            recheck.sort();
            recheck.dedup();
            let mut locks = Vec::new();
            for id in &recheck {
                locks.push(self.state.mutex.lock(id).await);
            }
            let lock = &locks[recheck
                .iter()
                .position(|id| id.as_str() == room_id)
                .unwrap()];
            let latest = self.world_for(false, Some(recheck.clone())).await?;
            let Some(room) = latest.rooms.get(room_id) else {
                continue;
            };
            if room.library || room.space || room.pins.contains(event_id) {
                continue;
            }
            let (days, current_actor) = planner::effective(&latest, room);
            if current_actor != actor || !planner::allowed(&latest, room, actor) {
                continue;
            }
            let id = EventId::parse(event_id).map_err(|_| err!("Invalid event"))?;
            let event = self.timeline.get_non_outlier_pdu(&id).await?;
            if event.is_redacted()
                || days.is_none_or(|d| {
                    u64::from(event.origin_server_ts().0) >= now().saturating_sub(d * planner::DAY)
                })
            {
                continue;
            }
            let content = event.get_content_as_value();
            if content.get("com.sion.soundboard").is_some()
                || content.get("com.sion.meme").is_some()
            {
                continue;
            }
            let mut candidates = BTreeSet::new();
            planner::urls(&content, &mut candidates);
            // Un fichier incertain ou réutilisé n'entre jamais dans la file de
            // suppression. À saturation, conserver le média et poursuivre les
            // messages : l'incertitude ne doit pas devenir une suppression.
            for url in candidates {
                if plan.files.contains(&url) && pending.len() < 5000 {
                    pending.entry(url).or_insert_with(now);
                }
            }
            // Persisté avant la redaction pour pouvoir reprendre après crash.
            self.db["global"].put(PENDING, Json(&pending));
            let room_id = RoomId::parse(room_id).unwrap();
            let sender = UserId::parse(actor).unwrap();
            let mut content = RoomRedactionEventContent::new_v1();
            content.redacts = Some(id.clone());
            content.reason = Some("Conversation retention policy".into());
            let result = self
                .timeline
                .build_and_append_pdu(
                    PartialPdu {
                        redacts: Some(id),
                        ..PartialPdu::timeline(&content)
                    },
                    &sender,
                    Some(&room_id),
                    lock,
                )
                .await;
            if result.is_ok() {
                removed += 1;
            } else {
                failures += 1;
            }
        }
        // Ne supprimer que des fichiers issus de messages expirés, après un
        // délai de grâce de 48 h et un NOUVEL audit complet après les redactions.
        let epoch = MEDIA_EPOCH.load(Ordering::Acquire);
        let remaining = self.world(true).await?;
        let mut referenced = remaining.permanent.clone();
        for message in &remaining.messages {
            referenced.extend(message.urls.clone());
        }
        let mut files_removed = 0_usize;
        if !remaining.opaque {
            if let Ok(_write) = MEDIA_BARRIER.try_write() {
                if epoch == MEDIA_EPOCH.load(Ordering::Acquire) {
                    let ready: Vec<_> = pending
                        .iter()
                        .filter(|(url, ts)| {
                            !referenced.contains(*url)
                                && now().saturating_sub(**ts) >= 2 * planner::DAY
                        })
                        .take(10)
                        .map(|(url, _)| url.clone())
                        .collect();
                    for url in ready {
                        if let Ok(mxc) = url.as_str().try_into() {
                            if self.media.delete(&mxc).await.is_ok() {
                                pending.remove(&url);
                                files_removed += 1;
                            } else {
                                failures += 1;
                            }
                        }
                    }
                }
            }
        }
        self.db["global"].put(PENDING, Json(&pending));
        self.db["global"].put(HEALTH,Json(json!({"lastRun":now(),"messagesRemoved":removed,"filesRemoved":files_removed,"failures":failures,"failed":failures>0,"uncertain":remaining.opaque})));
        Ok(())
    }
}
