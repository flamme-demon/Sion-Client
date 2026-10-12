# Sion `libwebrtc` extension

Based on the published `libwebrtc` **0.3.50** crate used by LiveKit 0.9.3
(rebased from 0.3.46 on 02/10, patches unchanged).
The original sources and notices are retained.

Sion adds `RtcAudioTrack::set_volume`, a safe forwarding method to the local
playback gain exposed by the vendored `webrtc-sys` bridge. It is used for the
volume slider of received screen-share audio. The accepted application range
is 0 to 1; WebRTC itself supports 0 to 10.

On an SDK update, remove this patch if upstream exposes the same operation. If
it remains necessary, verify the native and outer `RtcAudioTrack` wrappers and
run the native voice tests.

## Capture d'écran Wayland : contexte GLib privé

`src/native/desktop_capturer.rs` (`start`) : sous Wayland, la feature
`glib-main-loop` créait un `MainLoop` sur le **contexte GLib global**. Avec une
UI GTK/Tauri (WRY), ce contexte appartient à GTK : les réponses D-Bus du
portail ScreenCast (OpenPipeWireRemote) ne sont jamais dispatchées. Le
sélecteur d'écran s'affiche et la sélection aboutit, mais aucune frame
PipeWire n'arrive (erreurs temporaires en boucle, partage vide).

Le patch crée un `MainContext` privé, le pousse en thread-default le temps de
`Start` (c'est ce contexte que GDBus capture pour le proxy du portail), puis
l'itère sur son propre thread. Indépendant de GTK, donc fonctionnel quel que
soit le runtime de la fenêtre.

## SDP distant : normalisation des paramètres stéréo Opus (collision BUNDLE)

`src/native/peer_connection.rs` (`set_remote_description`) : le SFU LiveKit
annonce parfois `sprop-stereo=1` **ou `stereo=1`** sur une seule des m-lines
opus, alors que les autres ne l'ont pas, tout en réutilisant le même
payload type (111 dans les logs du 10/10). libwebrtc valide le BUNDLE et rejette la
description avec `A BUNDLE group contains a codec collision ...` /
`INVALID_PARAMETER` — observé à la connexion et à chaque renégociation
(début/arrêt de partage).

`src/native/opus_sdp.rs` aligne `stereo` et `sprop-stereo` uniquement entre
sections audio du **même groupe BUNDLE**, avec le **même payload** Opus/48000/2.
Un `1` explicite est conservé pour préserver la négociation stéréo. Un `0`
explicite et une absence sont aussi rendus identiques quand ils coexistent.
Un fmtp absent est créé si nécessaire. Les autres paramètres, codecs et
transports restent inchangés ; une description déjà cohérente est conservée.
Les sections rejetées sont ignorées, sauf les sections `bundle-only` à port
zéro qui continuent de proposer du média. Les valeurs invalides ne sont pas
réparées par ce correctif.

La description corrigée est re-parsée via `SessionDescription::parse` avant
`set_remote_description`. Un échec conserve la description originale. Le
journal indique la normalisation sans exposer le SDP, les candidats ICE ou
les identifiants de session.

Références : [RFC 8843 §9.1.1](https://www.rfc-editor.org/rfc/rfc8843.html#section-9.1.1)
pour l'identité des configurations partageant un payload ;
[RFC 7587 §6](https://www.rfc-editor.org/rfc/rfc7587.html#section-6) pour les
paramètres et la capacité des décodeurs à recevoir mono et stéréo.

Les huit tests reproduisent la collision observée, vérifient les deux
paramètres, les fmtp absents, les groupes et payloads indépendants, les
autres codecs, l'idempotence et les fins de ligne. Le module est inclus dans
les tests de `voice_engine` pour couvrir aussi le fork, hors du workspace.
Depuis `src-tauri` :

```sh
cargo test --lib voice_engine::opus_sdp_tests
cargo test --test opus_bundle
```

Le test d'intégration `tests/opus_bundle.rs` crée une vraie offre WebRTC,
reproduit les trois variantes de paramètres hétérogènes, passe par le
`set_remote_description` de production, puis génère et applique la réponse.
Il vérifie les paramètres effectivement appliqués. Sans piste micro ni
serveur ICE, avec la politique relay-only, il ne rejoint aucun appel réel.

Vérification rapide de ce même module sans relier tout le client (depuis la
racine du dépôt) :

```sh
rustc --edition 2021 --test src-tauri/vendor/libwebrtc/src/native/opus_sdp.rs -o /tmp/sion-opus-sdp-tests
/tmp/sion-opus-sdp-tests
```

À retirer si le SFU cesse d'émettre des fmtp opus hétérogènes, ou si
libwebrtc/LiveKit normalise côté serveur.

## Statistiques : plus de panique sur un JSON refusé

`src/native/{rtp_receiver,rtp_sender,peer_connection}.rs` (`get_stats`) : le
code d'origine décodait le JSON des statistiques par
`serde_json::from_str(&stats).unwrap()`, **dans le rappel C++**. Le 23/09, un
`RemoteVideoTrack::get_stats()` a reçu un JSON que serde refuse (« key must be
a string ») : panique, abandon du processus, Sion fermé en plein appel.

Le patch passe par `native::parse_stats` (exposé dans `lib.rs` pour être testé
depuis Sion — ce crate, hors de l'espace de travail, ne lance pas ses propres
tests) : un JSON illisible devient une `RtcError` dont le message et le
journal portent l'erreur et une centaine d'octets autour de l'endroit fautif.
Test : `voice_engine::tests::des_statistiques_illisibles_ne_font_plus_planter`.

**Cause trouvée le 02/10** : libwebrtc écrit ses nombres décimaux avec
printf, dans la locale du processus. Sous fr_FR :
`"priority":9,114756780671369e+18` — virgule décimale, JSON invalide.
Remettre `LC_NUMERIC` en « C » ne tient pas (rdev refait
`setlocale(LC_ALL, "")` en démarrant). `parse_stats` répare donc le JSON
quand il ne se lit pas (`virgules_decimales_en_points` : dans un objet,
une virgule suivie d'un chiffre juste après une valeur numérique est
décimale ; tableaux et chaînes intacts), puis le relit. Test :
`voice_engine::tests::des_statistiques_a_virgule_decimale_se_lisent`.

À une mise à jour du SDK : retirer si l'amont ne fait plus `unwrap()`.
