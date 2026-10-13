# Sion 2.0.0 release review

Reviewed on 2026-10-13 against `v2.0.0-beta.10`, with release highlights
checked against the `v1.6.4` baseline. The review covers the pending dependency
updates, native SDK patches, chat and voice fixes, cleanup, removal of the 1.x
session migration, encrypted room creation and the approved updater design.

## Findings addressed before publication

- Chat positioning callbacks survived a room switch or unmount. Their animation
  frames and timers now have room/account ownership and are cancelled on
  cleanup. Regression tests cover each scheduling stage, room switches and
  React Strict Mode's effect replay.
- The Silero VAD model was missing from the manually assembled AppImage, and
  NSIS's flattened resource layout did not match its lookup path. Linux now
  includes the model and MIT notice; runtime lookup supports both layouts.
  Release builds check the required resources before packaging/upload.
- A stable release could previously publish without Android. The final
  publisher now requires successful Linux, Windows and Android jobs. Manual
  dispatch defaults to building artifacts without publishing, allowing a
  preflight before creating the final tag.
- A literal NUL in the video-import filename sanitizer made Git treat the
  TypeScript source as binary. Equivalent escaped control-character bounds
  restore a reviewable text diff.
- A voice lifecycle test counted all framework timers and occasionally failed
  under load. It now waits for an explicit status-read barrier and checks that
  closing the session prevents heartbeat installation.
- The pre-push hook's early-exit grep could break its input pipe on a large
  change and incorrectly skip native tests. It now consumes the full file list.
- Android release lint crashed when analyzing Tauri's applied Kotlin dependency
  script. The generated dependency calls are applied as Groovy, preserving
  automatic plugin discovery and all lint checks. Local
  `:app:lintVitalAnalyzeUniversalRelease` passes with AGP 9.4.1. The failure
  matches the [upstream K2 script analysis fix](https://android.googlesource.com/platform/tools/base/+/44330ad8b855e38930c70ca44f65e781dd95d1ab).
- The Linux workflow still tried to install a GStreamer AV1 plugin for the
  retired desktop web player. Desktop chat and memes already use bundled
  ffmpeg with libdav1d. Removed that obsolete installation and packaging path;
  the release gate now encodes an AV1 sample and decodes it with the exact
  ffmpeg binary extracted from the AppImage.

## Local validation

- Production TypeScript/Vite build passes.
- Frontend suite: 905 passed, four skipped; no unhandled exceptions.
- Rust workspace suite: 396 passed, 16 ignored. Ignored tests require external
  Matrix/LiveKit servers, display access or a downloaded ASR model.
- Native WebRTC bridge suite: nine passed, including dropped encoded-frame
  chains and concurrent capture ordering. The unchanged crate sources were
  tested in an isolated temporary workspace because this vendored crate is
  not a workspace member.
- Build-script tests: five passed. Shell syntax and release YAML validate.
- Knip reports no unused code/dependencies; ESLint reports zero errors and
  32 existing hook warnings. Workspace-wide rustfmt still reports formatting
  differences in existing files; formatting unrelated code is deferred.
- Bundled camera and VAD weights match their documented SHA-256 checksums;
  their attribution/license notices are present.
- Package, Cargo and Tauri versions agree on `2.0.0`. Android's final version
  code is greater than the beta version codes.
- First preflight: Linux and Windows packaging/signing pass. Both updater
  signatures verify with the public key shipped in the client. The extracted
  AppImage contains the correct VAD weights; the NSIS installer contains the
  model and notices at the flattened paths supported by runtime lookup.
- The AV1 sample decodes successfully with libdav1d from the shipped Linux
  ffmpeg. The final cloud build is rerun with the Android lint correction and
  the Linux decoder check before publication.

## Native ownership and practical limits

Reviewed the changed WebRTC callbacks, shared-pointer edges, video sinks,
native handles and thread ownership under the vendored crate's `AGENTS.md`.
Frame reference-chain changes add counters and a non-owning stream identity;
they do not add owner-capturing callbacks. Test workers join before sinks are
removed. Transcription ingestion stops its tap and joins its worker. VAAPI
initialization failure follows the native display's cleanup path.

These tests do not establish leak-free operation on every GPU or audio device.
Windows and Android binaries, signing and packaging are validated by the
release workflow; hardware-dependent behavior still requires those devices.
Existing local WRY deprecation/cfg warnings and missing local NVIDIA headers
are not evidence of an NVIDIA-enabled release build: release jobs install
CUDA headers and verify NVIDIA codec markers in the actual shipped binary.

The live browser/development Matrix adapter remains reachable. Only the
retired 1.x migration/key store was removed; current native session stores and
encryption keys are preserved. Release notes explicitly describe the upgrade
boundary at beta.6 and the verification/recovery required for 1.x users.
