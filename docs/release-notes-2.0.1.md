# Sion Client 2.0.1

This update improves audio routing, media messages and shared libraries, and
fixes background processes that could remain after a failed media import.

## Devices and sessions

- Session names now identify Desktop or Mobile, the operating system and the
  client version. Android devices are correctly recognized instead of being
  labelled Linux.
- Existing automatic names update when that device starts the new client;
  personal device names are preserved.

## Audio and voice

- Notification sounds, soundboard previews, chat audio and mobile meme audio
  now use native playback. During a call, their output contributes to the
  voice engine's echo-cancellation reference.
- Short sounds no longer depend on background webview timers to keep playing.
  Audio interruptions cancel outdated cues instead of replaying them later.
- Additional checks prevent stale join and leave sounds from playing after
  the participant or voice session has changed.
- Repeated clicks on a received screen share no longer queue conflicting
  fullscreen requests or leave fullscreen controls stuck until Escape.

## Chat and memeboard

- Editing the caption of an image, video, audio clip or file preserves the
  attachment, its encryption information and its media metadata.
- Deleting an edited message targets the original message. Concurrent delete
  requests are combined, and delayed timeline snapshots cannot bring a
  successfully deleted message back.
- Fullscreen image viewing shows filenames and offers a Reply action that
  returns to the correct message and room.
- Memeboard video previews keep a still image when playback stops, fixing
  grey tiles after hovering or switching between Top and All.

## Shared libraries in Spaces

- Soundboard and memeboard membership management moves into the Space's
  dedicated library settings.
- Create the library room and invite members from the same place. Existing
  libraries show current members, pending invitations and Space members who
  have not yet been invited, with lists available from the counts.
- Authorized moderators can remove or ban abusive library members, restore
  access and send a new invitation. Actions respect the library room's
  Matrix power levels.

## Media imports and local models

- Link analysis cancels when its dialog closes or the URL changes. Superseded
  requests cannot start later, and version checks share one subprocess.
- Link probes and version checks have execution deadlines and bounded output.
  Cancellation, failure and application shutdown clean up yt-dlp and ffmpeg
  process trees, including Windows bootloader and encoder children.
- TTS, voice cloning and local summary generation keep ownership of their
  workers until cancellation and process cleanup finish.
- Meeting and file transcription share one model owner. Stopping or cancelling
  transcription releases capture taps, joins workers and unloads model state
  before another job can use the engine.

## Android

- Automatic headset routing and a themed manual output selector support switching
  between Bluetooth, supported wired/USB devices and the phone's outputs.
- Android 14 and newer use Telecom call integration for supported headset
  call controls. Hanging up from the headset leaves the Sion voice room;
  supported play/pause buttons have a configurable microphone or leave action.
- Mute synchronization preserves Sion's microphone state during headset and
  output changes. A system mute reset during disconnection is no longer
  treated as an instruction to open the microphone. Muted calls resynchronize
  a newly connected headset on Android 15 and newer.
- Phone calls and audio-priority interruptions suspend native call audio.
  The output selector can explicitly request audio resumption.
- Mobile memes decode audio without opening a webview audio output, preventing
  them from taking audio priority away from the voice call.
- Microphone tests check runtime permission before creating a native recorder,
  preventing a crash when microphone access has not been granted.

Headset controls depend on Android and headset support. The latest Shokz
first-press mute correction still needs confirmation on the physical headset.

## Downloads

Linux x86-64 AppImage, Windows x64 installer and Android ARM64 APK.
