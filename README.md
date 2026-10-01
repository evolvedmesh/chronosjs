# chronosjs

Records what a user did in a web app as a small replay file, the way a game records a match, and sends it to your telemetry service when they hit an error. A player rebuilds the page exactly as they saw it and plays it back with a moving cursor, a timeline and a plain-language list of what happened.

- **Accurate:** the recorder captures the page's DOM once, then every change to it (elements, attributes, text, form values, scroll, CSS-in-JS rules inserted through the CSSOM). The player rebuilds that page in a sandboxed iframe, so the replay is the real page with its own CSS, not a video or a guess.
- **1:1, and checked:** a test compares screenshots of the live page with the replay at the same moments, pixel by pixel. They are identical apart from a few pixels the browser draws itself (see below). That includes what the DOM doesn't hold: hover, press and focus states, and the user's dark mode or reduced motion.
- **Small:** a 9-second checkout session with 160 events is about 3 KB compressed and fits in one Application Insights telemetry item. Mouse movement is not recorded, only where the mouse came to rest and when it set off again. The player draws the path in between.
- **Sent on error only:** a rolling buffer (60 s by default) stays in the browser until something fails: an uncaught error, an unhandled rejection, an HTTP 5xx, an error boundary, or a call to `captureError()`.
- **Private by default:** typed values are masked (`****`, same length), passwords always are. Scripts and event handlers are never recorded and never run in the player.

Application Insights is supported first. Other services are a `Transport` away.

## Installing

chronosjs installs from GitHub; pin a release tag:

```sh
bun add github:evolvedmesh/chronosjs#v0.2.0
```

The built `dist/` is committed, so installing needs no build step. Imports: `chronosjs` (recorder and transports, for the app being recorded), `chronosjs/player` (decoding and playing, for the app that shows replays) and `chronosjs/react` (components for both).

## Quick start (Next.js)

```tsx
// app/recorder.tsx
"use client";
import { appInsightsTransport, record, stopRecording } from "chronosjs";
import { useEffect } from "react";

export function Recorder() {
  useEffect(() => {
    record({
      meta: { app: "my-app", release: process.env.NEXT_PUBLIC_VERSION },
      transports: [appInsightsTransport({ connectionString: process.env.NEXT_PUBLIC_APPINSIGHTS_CONNECTION_STRING! })],
    });
    return () => stopRecording();
  }, []);
  return null;
}
```

Put `<Recorder />` in the root layout. Errors a boundary catches never reach the browser's error handler, so report them:

```tsx
// app/error.tsx
"use client";
import { useChronosError } from "chronosjs/react";

export default function Error({ error }: { error: Error }) {
  useChronosError(error);
  return <p>Something went wrong.</p>;
}
```

Anywhere else: `captureError(error)` from `chronosjs`.

### Already using the Application Insights SDK?

Pass the instance instead of a connection string. Replays then share its session, user and operation ids, and its telemetry initializers (redaction rules) run on them too:

```ts
appInsightsTransport({ sdk: appInsights });
```

## Options

| Option                         | Default                  | What it does                                                                                                                         |
| ------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `transports`                   | (required)               | Where replays go. Each transport gets each replay.                                                                                   |
| `meta`                         | `{}`                     | `app`, `release`, `sessionId`, `userId`, `tags`: stored in the replay.                                                               |
| `bufferMs`                     | `60000`                  | History kept before the error, at least. A full snapshot is taken every `bufferMs / 2` while something happens, older history is dropped. |
| `tailMs`                       | `1500`                   | Recording kept after the error, so the replay shows how the page reacted.                                                           |
| `maxReplays`                   | `5`                      | Replays per page load. The same error within 30 s is not sent twice.                                                                 |
| `httpError(status, url)`       | `status >= 500`          | Which responses trigger a replay. Every fetch and XHR is recorded (method, path without query string, status, duration).            |
| `captureConsoleErrors`         | `false`                  | Treat `console.error` as an error.                                                                                                   |
| `ignoreErrors`                 | `[]`                     | Strings or patterns: matching errors are recorded but never trigger a replay.                                                       |
| `persist`                      | `true`                   | Keep the buffer across full page loads in the same tab (sessionStorage), so a replay can span pages.                                |
| `inlineStylesheets`            | `false`                  | Copy same-origin stylesheets into the replay. Bigger replays, but they still look right after a deployment removes the old CSS files. |
| `privacy`                      | see below                | Masking and blocking.                                                                                                                |
| `beforeSend(replay)`           |                          | Change the replay, or return `null` to drop it.                                                                                      |

### Privacy

| Setting            | Default                  | Effect                                                                                     |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------------ |
| `maskInputs`       | `true`                   | Text fields are recorded as `*` of the same length. Passwords are always masked.          |
| `unmaskSelector`   | `[data-chronos-unmask]`  | Fields inside matching elements are recorded as typed (a search box, say).                |
| `maskTextSelector` | `[data-chronos-mask]`    | Text inside matching elements is recorded as `*`.                                          |
| `blockSelector`    | `[data-chronos-block]`   | Matching elements are recorded as an empty box of the same size, with nothing inside.     |

URLs are recorded without query strings or fragments. Hidden inputs, `<script>` content, `on*` attributes, `<meta>` tags and the content of iframes are never recorded.

**Pages that must never be recorded** (sealed bids, secrets): pass `pauseOn: (path) => …`. It is checked on load and on every navigation. While it matches, nothing is recorded, and everything recorded before is discarded, so no replay or saved buffer can hold what was on that page. Leaving the page, recording starts again from a fresh snapshot, taken once the next page has had 500 ms to render. `pauseRecording()` and `resumeRecording()` do the same from code.

## Application Insights

A replay is sent as `customEvents` named `chronos.replay`. Application Insights caps a property value at 8,192 characters and an item at 64 KB, so the compressed replay is base64-encoded into parts of 8,000 characters (`d0`…`d6`), seven per item. Most replays are one item. Each item carries `chronosId`, `chronosSeq` and `chronosTotal`. The first item also carries `chronosError`, `chronosErrorKind`, `chronosBytes` and `chronosStart`.

To read them back (Log Analytics or the Application Insights query API):

```kusto
customEvents
| where name == "chronos.replay"
| extend id = tostring(customDimensions.chronosId), seq = toint(customDimensions.chronosSeq)
| project timestamp, id, seq, customDimensions, session_Id, user_Id, cloud_RoleName
| order by timestamp desc, id, seq asc
```

```ts
import { assembleReplays, readAssembled } from "chronosjs/player";

const [assembled] = assembleReplays(rows); // groups rows by replay and joins the parts
const replay = await readAssembled(assembled);
```

Ad blockers sometimes block the Azure ingestion endpoint. To avoid that, point the connection string's `IngestionEndpoint` at a proxy on your own domain that forwards `/v2/track`.

## Playing a replay

```ts
import { ChronosPlayer, decodeReplay } from "chronosjs/player";

const replay = await decodeReplay(bytes);
const player = new ChronosPlayer(document.getElementById("player")!, replay, { autoplay: true });
await player.ready; // the iframe has loaded and shows the page; calls made earlier apply then
```

Or in React: `<ReplayPlayer replay={replay} autoplay />` from `chronosjs/react`.

The player is a sandboxed iframe (`allow-same-origin`, no scripts), scaled to fit or at real size ("100%"), with:

- a cursor that moves between where the mouse rested and clicked, along a natural path;
- the states the user saw: what the cursor is over is hovered, a click presses, the recorded focus is focused (`:hover`, `:active`, `:focus`, `:focus-visible`, `:focus-within`), and media queries on the user's preferences (`prefers-color-scheme`, `prefers-reduced-motion`, `pointer`, `hover`) answer as they did for the user. The player adds an attribute twin to each such CSS rule (`.card:hover` also matches `.card[data-chronos-hover]`) and rewrites those media queries, so the cascade is unchanged;
- a timeline with markers for clicks, pages and errors;
- play/pause, speed (0.5× to 8×), "Skip idle" and "Jump to error";
- the list of what happened: pages, clicks, typing (one line per field), choices, keys, network calls and errors, each one a seek target.

Player options:

| Option | Default | What it does |
| --- | --- | --- |
| `autoplay`, `speed`, `skipIdle`, `startAt` | off, 1, on, 0 | Playback |
| `zoom` | `"fit"` | `"fit"`, or a fixed scale (`1` is real size) |
| `controls` | `true` | `false` gives just the page and the cursor (headless), for a host that draws its own controls with the API: `play()`, `pause()`, `seek(ms)`, `setSpeed()`, `setZoom()`, `on("time" \| "play" \| "pause" \| "end" \| "error")`, `duration`, `currentTime`, `actions` |
| `showActions` | `true` | The list of what happened |
| `resolveUrl(url)` | | Where to load the recorded page's images, stylesheets and fonts from. Gets each absolute URL (attributes, `srcset`, inline styles, style sheets, CSSOM rules), returns another: a proxy on your own origin, say. |
| `maxNodes` | 500,000 | Nodes a replay may create; beyond it the player stops and emits `error` |

**Replays are untrusted input.** Anyone with an app's ingestion key (it is in every browser bundle) can send one, so the player:

- builds no `<script>`, `<base>`, `<meta>`, `<object>`, `<embed>` or `<frame>`;
- sets no `on*` attribute, `srcdoc`, form action, or `javascript:`/`data:text/html` address, and no `src` on an iframe;
- loads only `http(s)` addresses, through `resolveUrl` when you give one;
- caps the number of nodes, and `decodeReplay()` caps the decoded size (64 MB by default, `{ maxBytes }`).

Without `resolveUrl`, images, stylesheets and fonts load from the recorded app's URLs, through a `<base>` set to the page that was recorded. The viewer's Content Security Policy must allow them (`img-src`, `style-src`, `font-src`). When the viewer runs on another origin than the app:

- fonts need the app to send `Access-Control-Allow-Origin`;
- hover, focus and dark-mode emulation can only adapt stylesheets the viewer may read. Inline styles and CSS-in-JS rules always work. For CSS files, send `Access-Control-Allow-Origin` with them, or record with `inlineStylesheets: true`.

## The file format

`src/format.ts` documents it. In short: `{ v, id, ts, meta, reason, assets?, e: [[dt, type, ...payload], …] }`, where:

- times are deltas;
- a snapshot is a nested-array tree with no node ids (both sides number nodes in document order);
- a mutation batch is `[firstNewId, removes, adds, attrs, texts]`;
- the whole document is JSON compressed with `deflate-raw` (`CompressionStream`, built into browsers).

Event codes are append-only, so old replays keep playing.

## What it doesn't capture (yet)

- Shadow DOM contents, canvas, video frames, cross-origin iframes and constructable stylesheets (`adoptedStyleSheets`).
- Parts the browser draws only for real focus or hover: the text caret, a search field's clear button, a native checkbox's hover shade, an open native `<select>` list. Giving the replay real focus would take it from whoever is watching.
- The exact mouse path between resting points, and hover over elements the mouse only passed over.
- The user's fonts, when the page uses system fonts (`system-ui`) and the viewer runs another operating system.
- Server state: the replay shows what the user saw and did, not why the server answered as it did. Correlate with the request telemetry through the session id, or through the operation id when replays are sent through the SDK.

## Repository

```
src/  test/  dist/       the library (recorder, transports, player, React bindings); dist/ is committed, see Installing
examples/next-demo/      a Next.js shop that breaks three ways, a mock Application Insights endpoint and a replay viewer
tests/e2e/               Playwright (run by bun test): DOM fidelity fuzzing, pixel comparison of live and replayed pages, the demo end to end
```

| Command          | What it does                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| `bun install`    | Install                                                                                            |
| `bun run demo`   | Build the library, start the demo on http://localhost:3100 (replays at `/replays`)                |
| `bun run check`  | Lint, typecheck, unit tests                                                                        |
| `bun run e2e`    | Build everything, then run the browser tests (random DOM changes replayed exactly; the demo end to end) |
| `bun run build`  | Build `dist/` (commit it with the source change; CI checks it matches)                             |

`CHRONOS_BROWSER=firefox` (or `webkit`) runs the browser tests in another engine; all three pass. `CHRONOS_SEEDS=40 CHRONOS_ROUNDS=250 bun test --timeout 120000 tests/e2e/fidelity.test.ts` runs a longer fuzz. `CHRONOS_SHOTS=<dir>` saves screenshots of the demo test and the live, replayed and diff images of the visual test (`tests/e2e/visual.test.ts`).
