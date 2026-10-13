# Code cleanup and English comments — 2026-10-13

The cleanup removes confirmed unused application code and consolidates the Tauri
command registry. It preserves the existing working-tree changes, native platform
implementations, active fallbacks and dependency forks. The 1.x Matrix migration
has since been retired with 2.0.0-beta.6 established as the minimum upgrade source.

## Changes

- Removed the orphan `useMatrix` hook, three unused icons, unused admin/configuration
  types, an unused panel helper and the unused top-level-await/global-shortcut JS
  packages. The Rust global-shortcut plugin remains active.
- Made exports private when only their containing module uses them.
- Removed the old single-source native PIP commands and frontend wrappers. Active
  camera/share PIP uses the multi-stream commands. Hardware test helpers remain
  test-only.
- Removed the unused AV1 webview probe. Actual native playback and external-video
  import still perform their own codec/size checks.
- Removed unused prototype data payloads, an unused click ID and the never-sent
  overlay shutdown event. Existing overlay hiding and resource teardown remain.
- Removed Windows branches from the winit overlay host, which is compiled only
  outside Linux/Windows. Windows uses the dedicated Win32 host.
- Removed a redundant Wayland connection field after verifying that `EventQueue`
  owns its `Connection`.
- Removed broad dead-code suppression in the native voice modules. RMS helpers
  used only by tests are test-only; cursor publishers remain Windows-only because
  the native Windows video surface uses them.
- Replaced separate desktop/Android IPC registration lists with one list using
  platform attributes. Compared command names and feature attributes against the
  snapshot taken before cleanup: desktop retains 245 commands after four unused
  removals; Android retains 174 after one unused removal.
- Added `bun run code:check` with Knip and included it in frontend CI.

## English comments

Translated or condensed 938 comment blocks during the pass, across 24 changed
source files. Some obsolete comments were subsequently removed with their code.
Retained thread, memory, E2EE, audio-lifecycle and platform explanations, and
corrected outdated descriptions of the PIP, microphone mute and key sizes.

The translation pass compared every non-comment parser token before and after:
code and string literals were unchanged. Remaining French-like detector output
in these files was only the font name `DejaVu Sans`.

`CONTRIBUTING.md` now requires English for new comments and API documentation and
translation of comments when changing existing code. This pass covers the files
changed by cleanup; French comments elsewhere in the repository still exist.
Stable command names, persisted keys and Matrix fields retain their identifiers.

## Size after the first cleanup pass

Comparison is against the working-tree snapshot at the start of this cleanup,
including the dependency updates and earlier fixes, rather than against Git HEAD.
Counts include tests and comments, after Rust formatting. Vendor source, generated
projects, lockfiles and downloaded models are excluded.

| Application source | Before | After | Net reduction |
| --- | ---: | ---: | ---: |
| Frontend (`src/`) | 66,809 | 66,550 | 259 |
| Native app (`src-tauri/src/`) | 37,848 | 36,715 | 1,133 |
| Matrix core | 12,022 | 12,022 | 0 |
| Native audio | 557 | 557 | 0 |
| Camera effects | 1,823 | 1,823 | 0 |
| **Total** | **119,059** | **117,667** | **1,392 (1.17%)** |

The total includes comment condensation. It is a maintenance-size improvement,
not a measured runtime speedup. Removing comments does not reduce machine-code
execution cost, and deleting unused exports often has no bundle effect because
the bundler already removes them.

## Can the project shrink by 30–50%?

The initial exact-duplication scan found 27 clones and 593 duplicated lines
among 101,192 scanned lines, about 0.59%. It ignores comment/formatting differences
and excludes frontend tests. This is evidence about exact duplication, not an
estimate of all possible architectural simplifications. The largest command-list
duplication has now been consolidated.

A 30–50% reduction across all application source would remove about 35,700–59,500
lines. The current audit does not justify that target while retaining the same
features and platforms. Some individual modules can shrink substantially:

1. Share lifecycle logic between the embedded renderer, cursor overlay and PIP
   while preserving each OS event loop, resource ownership and shutdown rules.
2. Extract repeated admin list/dialog behavior into small shared components.
3. Consolidate model-download and subprocess handling used by transcription,
   summaries and TTS after verifying their cancellation and progress contracts.
4. Isolate the active browser/development Matrix JS adapter. Its removal would
   retire that runtime. The separate 1.x migration boundary has now been removed.

These require targeted behavior checks and measurements. Line counts alone do
not establish improved CPU use, memory consumption, latency or reliability.

## Validation of the first cleanup pass

- `bun run code:check`: passes without findings or configuration hints.
- `bun run build`: TypeScript and production frontend build pass.
- `bun run lint`: no errors; 33 existing React-hook warnings remain.
- Frontend tests: 893 pass, five opt-in tests skipped.
- Rust workspace library tests: 395 pass, six integration/hardware tests ignored.
- Linux workspace `cargo check`: passes with no application dead-code warnings.
  WRY upstream warnings and the missing CUDA-header diagnostic remain.
- Android `aarch64-linux-android` check: passes; platform-unused desktop helpers
  still produce 24 warnings in that build. They are not globally dead code.
- Windows API harness: passes against the actual Windows modules. This checks API
  compatibility, not a complete Windows build or runtime/hardware behavior.

Knip's production-only mode also reports helpers exported for tests and a test
support file. Inspection confirmed that these helpers either have internal
production callers or serve the existing tests; they were retained. The normal
CI check includes test entry points and detects genuinely unused exports/files.

## Follow-up: minimum beta.6 and missing UI choices

The native 1.x migration path, its Tauri command, frontend bridge, temporary key
import/export code and dedicated cross-migration scripts/tests have been removed.
Login and resume now use the current Rust session directly. The migration notice
has been removed from sign-in and both locales. Current SQLite stores, system
keyring data and the separate browser/development Matrix JS runtime remain active.

Authentication tests now cover resuming the current device without a fresh login,
preserving its local profile while offline, preserving metadata when the keyring
is locked, and ignoring obsolete 1.x profile metadata. The README documents the
minimum upgrade source and actual runtime dependencies.

Space room creation now exposes the existing encryption parameter for text and
voice rooms. Tests exercise the UI choice and its propagation to the native core,
including invitation-only room creation.

Update download progress keeps byte counts visible while adding total size and
percentage when available. A custom rounded track replaces the browser's default
progress control. Unknown totals use an indeterminate indicator; reduced-motion
preferences are respected. Units and decimal separators follow the UI locale.
Visual checks render the actual component in Chromium at 1200 and 390 pixels,
with known/unknown totals and French/English text; neither viewport overflows.

Follow-up validation: 900 frontend tests pass (four opt-in tests skipped), 395 Rust
library tests pass (six opt-in tests ignored), Knip is clean, TypeScript/production
build and Linux workspace check pass. ESLint still reports its 33 existing
warnings and no errors.
