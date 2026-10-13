# Contributing to Sion

Use English for new code comments, API documentation and contribution descriptions.
When changing existing code, translate its French comments and remove obsolete notes.
Explain invariants, platform constraints and the reason for non-obvious behavior;
keep useful links and examples, and avoid narrating what the code already says.

Do not rename persisted keys, Matrix event fields or Tauri command identifiers
just to change their language: these names are compatibility contracts.
Keep user-facing text in `public/locales/` and update both French and English.

Before submitting a change, run the checks relevant to it:

```bash
bun install --frozen-lockfile
bun run code:check
bunx tsc -b
bun run lint
bun run test
cd src-tauri
cargo test --locked --workspace --lib -j4
```

Knip checks unused frontend files, exports and dependencies. Confirm dynamic
imports and CSS usage before removing a reported item. Rust's `dead_code` lint
checks each compiled target; verify other platforms and features before deleting
native code. Keep platform-specific exceptions narrow and explain their purpose.

Retain the behavior of local dependency forks and consult their `SION_PATCH.md`
and any applicable `AGENTS.md` before modifying vendored code. Vendor source,
generated files and downloaded models are separate from Sion-owned code metrics.

Contributions are dual-licensed under MIT and Apache-2.0, as described in README.md.
