# AGENTS.md

Guidance for AI coding agents in this repository. `CLAUDE.md` imports this file. The user-facing documentation is `README.md`.

## Rules

- Bun only: `bun install`, `bun run`, `bun test`, `bun --bun next`. No npm, pnpm, yarn or Node runners. Browser tests use the `playwright` library from `bun test`, not the Playwright test runner.
- `bun run check` passing is the definition of done. Run `bun run e2e` for any change to the recorder, the format or the player.
- Biome formats and lints (`bun run fix`).
- The library is the root package. `dist/` is never committed: apps install the tarball attached to each GitHub release (`https://github.com/evolvedmesh/chronosjs/releases/download/vX.Y.Z/chronosjs-X.Y.Z.tgz`).
- Releases are semantic-release, as in the rest of the org (`.releaserc.json`, `.github/workflows/release.yml`): every push to `main` (or `dev`, as `-dev` prereleases) reads the Conventional Commits since the last tag. When they call for a release, `scripts/pack.ts` stamps the version, builds and packs, `ci(release): X.Y.Z [skip ci]` commits `package.json` (as the evolvedmesh-release-bot App, the rulesets' bypass actor), and the tarball is attached to the release. So commit subjects decide versions: `fix:` patch, `feat:` minor, `BREAKING CHANGE` major. Never bump `package.json` by hand.
- Changes reach `main` only through pull requests (org ruleset); CI (`ci.yml`) checks them.
- The demo (`examples/next-demo`) imports the built `dist/` through tsconfig paths, so build before running it (`bun run demo` does).

## How it fits together

- `src/format.ts` is the contract between the recorder and the player. Event codes and `$` state keys are append-only: a replay recorded today must play later.
- Node ids are never written in a snapshot. The recorder (`recorder/serialize.ts`) and the player (`player/rebuild.ts`) number nodes in the same pre-order. Any node one side creates and the other doesn't (or a namespace the parent doesn't imply, see `$ns`) breaks every later event. The fidelity fuzzer (`tests/e2e/fidelity.test.ts`) exists to catch exactly that. Add an operation there when you add a kind of change.
- Mutation batches are encoded as final state: removals first, then outermost added nodes in document order placed after their final previous sibling, then attribute and text changes of nodes that already existed.
- Anything the recorder records after the DOM already changed must be idempotent, or must call `prepare()` before the change (see the CSSOM patch), so a snapshot taken in between doesn't apply it twice.
- The player's nodes belong to the iframe's window: test `nodeType`, never `instanceof`.
- Form state is recorded only where it differs from the attributes (`$v`, `$c`), so a rebuilt control is "dirty" exactly when the live one is.
- Mouse movement is synthesized (`player/cursor.ts`); the recorder only records where the mouse rested and when it set off (`E.Pointer`).
- What the DOM doesn't hold is emulated in `player/emulate.ts`: state pseudo-classes get a `[data-chronos-…]` twin in the same rule (never a new rule: CSSOM rule indices must not move) and preference media queries are rewritten from the `E.Meta` env letters.
- The player rebuilds the page only after its iframe's own `srcdoc` document has loaded (`player.ready`). Writing into the initial about:blank document races with it in Firefox, which drops the stylesheet requests and shows the page unstyled.
- At 100% the frame is placed with `left`/`top` on whole device pixels, never a transform: Firefox renders text differently inside a transformed layer.
- Test player changes in Chromium, Firefox and WebKit (`CHRONOS_BROWSER=firefox|webkit bun test --timeout 180000 tests/e2e`).
- `tests/e2e/visual.test.ts` is the 1:1 check: live screenshots against the replay at real size, pixel by pixel, light and dark. Any change to the player or the recorder should keep it passing.
