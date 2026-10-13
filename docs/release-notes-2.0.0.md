# Sion Client 2.0.0

Sion 2.0 brings a native Rust foundation, a modular interface, Matrix Spaces
and a shared camera/screen-share view to Linux, Windows and Android.

These are the major changes since **1.6.4**.

## Native voice and Matrix

- Voice now runs in the native LiveKit/WebRTC engine, outside the webview.
  The desktop app uses the system webview instead of bundling Chromium.
- Matrix sync, encryption, media access and voice memberships move into the
  Rust core. Call encryption keys pass directly from Matrix to the voice engine.
- RNNoise, echo cancellation and automatic gain run together in the native
  microphone pipeline. Audio tests and soundboard playback use the same output
  path as the call, including when you are alone in a room.
- More reliable microphone switching on Linux, including recovery of detached
  PulseAudio/PipeWire streams, and improved call priority under heavy Windows load.
- One account can join from desktop and phone simultaneously, with separate
  microphone and deafen states for each device.

## A modular interface and Matrix Spaces

- A redesigned interface with movable modules, tabs and floating panels. Arrange
  members, pinned messages, transcription, soundboard, memeboard and Spaces
  around the chat, and save the layout that suits you.
- Sion Dark, Sion Light and AMOLED themes, custom accents, theme previews and
  importable themes. Export or import layouts, appearance and sounds as a
  `.sionprofil` profile.
- Create or join Matrix Spaces, manage members and roles, share invitations and
  choose which rooms to join, including rooms hosted on other Matrix servers.
- Create text or voice rooms inside a Space, with common or invitation-only
  access and an explicit end-to-end encryption option.
- Sound and meme libraries follow your active voice room and its Space. Their
  modules appear when connected to voice, and the member panel now has search.

## Cameras, screen sharing and video

- Desktop webcam sharing with a preview, background blur or replacement,
  filters, accessories and automatic framing. Effects are processed locally.
- Cameras and screen shares share one view: a grid, or a main stream with the
  others alongside it. Select participants, close individual streams or use
  an always-on-top system picture-in-picture window on desktop.
- Screen-share video is rendered natively on desktop, with hardware codec
  support where available. Viewers can point and click on a share; those
  pointers also appear on the sharer's screen.
- A native desktop chat-video player with bundled ffmpeg, fullscreen controls,
  seeking, volume and cached posters.
- External video import checks available formats and upload limits, keeps a
  suitable original codec and offers encoding when needed. Video thumbnails
  are uploaded separately, including encrypted thumbnails in encrypted rooms.
- The memeboard adds short video memes to the existing soundboard, with
  categories, playback controls and per-Space libraries.

## Chat, notifications and local transcription

- Immediate local text-message feedback, better reconciliation with server
  echoes and a bounded message view for busy rooms.
- Reworked unread tracking and a new-message marker that preserves messages
  received while you are away. Desktop notifications return for mentions,
  replies and direct messages; KDE supports replying from the notification.
- Typing indicators, read receipts, message reporting, ignored users and richer
  member profiles. Images sent together form a compact gallery; selected
  messages can be deleted together after confirmation.
- Local meeting transcription gains Silero voice activity detection, with a
  fallback detector, to segment speech before Whisper or Parakeet transcription.
  Consent, session history and local meeting summaries remain available.

## Android and updates

- Native voice and Matrix on Android, with push-to-talk, encrypted chat,
  soundboard, memeboard and received screen shares.
- Phone sign-in by scanning a desktop QR code, followed by device verification.
  Mobile navigation uses swipes and dedicated module sheets; received videos
  and screen shares support fullscreen and landscape viewing.
- Background notifications without Google services, through Sion's ntfy gateway.
- Integrated updates: download, inspect the release notes, then explicitly
  install. Desktop update packages are verified with signatures. Download
  progress keeps transferred size visible alongside the percentage.
- Bounded media caches and a cache-purge action that preserves the current
  session and encryption keys.

## Installation and compatibility

Download the **Linux x86-64 AppImage**, **Windows x64 installer** or
**Android ARM64 APK** attached to this release.

Upgrades from **2.0.0-beta.6 or later** retain the current native session.
Automatic migration of the old 1.x key store has been retired. If you are still
on 1.6.4, keep your recovery key and a verified device available before moving
to 2.0; signing in on a new device requires verification and key recovery.

Screen-share transmission and the system picture-in-picture window are desktop
features; Android can receive shares. Desktop webcam effects use CPU resources
and can be disabled. Background Android notifications may show generic text for
encrypted messages while Sion is closed.

Per-Space and per-room retention settings require the compatible Continuwuity
server extension; updating the client does not install it on the server.

Sion is now free software under your choice of **MIT or Apache-2.0**.
