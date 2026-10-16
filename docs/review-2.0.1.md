# Sion 2.0.1 release review

Reviewed on 2026-10-15 against `v2.0.0` (`7367020`). The scope includes
native local audio, process and model lifetime, media edits/deletion,
memeboard previews, Space library management, Android headset integration,
screen-share fullscreen controls and device/session labels.

## Findings addressed

- Custom cue caching retained every historical trim and decoded files after
  their removal from settings. The cache now keeps one trim per configured
  file and prunes unused files during playback/preloading. Late decoding
  cannot restore an evicted entry. Regression tests cover successive trims
  and removing a file while decoding is pending.
- Android user agents contain `Linux`, so the previous platform detection
  labelled Android sessions as Linux. Names now include Desktop/Mobile, OS
  and version from the initial native login and subsequent startup refresh.
  Personal names are preserved in both Matrix adapters. The session list
  wraps long names instead of hiding the platform suffix. Tests cover Android,
  iPhone, iPad desktop user agents, desktop OSes and migration eligibility.
- The full native suite exposed interference between summary subprocess tests
  and process-registry lifecycle assertions. Summary tests now use the same
  test-only gate as the other subprocess fixtures; registry destruction and
  engine reservation assertions remain unchanged.

## Local validation

- Production TypeScript/Vite build passes.
- Frontend suite: 1,082 passed, four skipped; no unhandled exceptions.
- ESLint: zero errors, 30 existing hook warnings. Knip passes.
- Android JVM suite: 27 passed, including repeated headset routing, mute
  synchronization and call teardown. Release lint analysis passes.
- Build-script suite: five passed.
- Rust workspace suite: 425 passed, 17 ignored. This includes the real APM
  bridge and repeated playback, subprocess and inference cleanup tests.
  Ignored cases require external servers, a display or downloaded model data.
  The Matrix HTTP fixture passes with loopback access outside the sandbox.
- Package, Cargo and Tauri versions agree on `2.0.1`. The Android build script
  derives stable version code `20001999`, above `2.0.0`'s `20000999`.

## Native ownership and practical limits

Reviewed the changed C++/Rust bridge under
`src-tauri/vendor/webrtc-sys/AGENTS.md`. The render processor owns its sample
buffers and resamplers through values/unique pointers. The render registry
keeps weak references to sources. Playback workers capture their stream and
completion state, while the player owns and joins the worker; workers do not
capture their player. No new strong callback/back-reference cycle is present.
Repeated tests exercise successful rendering, cancellation, failed/partial
initialization, source expiry and APM instance counts returning to baseline.

Subprocess owners retain their process tree and pipe readers through cleanup;
inference reservations outlive process cancellation. Tests use real fixture
processes for timeout, cancellation, descendants, closed pipes and shutdown.
Windows ownership modules were cross-checked, but execution on Windows still
depends on the platform build and hardware testing.

The latest Shokz first-press mute correction is covered by coordinator tests
and installed in the development APK, but still needs physical confirmation.
Headset firmware and Android support determine which hardware controls are
reported. The desktop video player's separate native audio clock is unchanged;
it does not yet feed the shared local-source AEC registry.

The release workflow is launched as an artifact build without publication.
Linux/Windows/Android packaging, signing and bundled-resource checks run in
their respective CI jobs before a final release tag is published.

## CI follow-up on 2026-10-16

The initial [artifact build](https://github.com/flamme-demon/Sion-Client/actions/runs/38806917023)
passed for Linux, Windows and Android. The separate
[CI run](https://github.com/flamme-demon/Sion-Client/actions/runs/38806917774)
failed its theme guard on a hardcoded shadow in the Android output selector;
its Rust checks passed.

The shadow now uses a theme token. The local guard had missed the violation
when reading sources through Vite's eager raw imports. It now scans source
files directly from disk at test time. Before fixing the shadow, this scan
reproduced the exact CI violation locally. A regression test checks newly
created and edited source files and preserves the test/theme exclusions.

Follow-up validation: 1,083 frontend tests passed, four skipped. The production
TypeScript/Vite build, ESLint and Knip pass.
