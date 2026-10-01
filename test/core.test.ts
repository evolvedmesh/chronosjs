import { describe, expect, test } from "bun:test";
import { decodeReplay, encodeReplay } from "../src/codec.ts";
import { absoluteEvents, deltaEvents, E, type Replay, type ReplayEvent } from "../src/format.ts";
import { assembleReplays, readAssembled } from "../src/player/appinsights.ts";
import { CursorPath } from "../src/player/cursor.ts";
import { parseEnv, rewriteMedia, rewriteSelector } from "../src/player/emulate.ts";
import { rebaseCssUrls } from "../src/recorder/recorder.ts";
import { PART_CHARS, PARTS_PER_ITEM, parseConnectionString, replayItems } from "../src/transports/appinsights.ts";

function sampleReplay(events = 50): Replay {
  const absolute: ReplayEvent[] = [
    [1000, E.Meta, "https://app.test/shop", 1280, 720],
    [1000, E.Snapshot, ["html", ["head"], ["body", ["h1", "Shop"], ["button", { class: "buy" }, "Buy"]]], 0, 0],
  ];
  for (let i = 0; i < events; i++) absolute.push([1100 + i * 37, E.Click, 4, 10 + i, 20 + i]);
  const { ts, e } = deltaEvents(absolute);
  return { v: 1, id: "a".repeat(32), ts, meta: { app: "demo" }, reason: { kind: "error", message: "Boom" }, e };
}

describe("format", () => {
  test("delta and absolute times are inverses", () => {
    const replay = sampleReplay(5);
    expect(replay.ts).toBe(1000);
    const absolute = absoluteEvents(replay);
    expect(absolute.map((event) => event[0])).toEqual([0, 0, 100, 137, 174, 211, 248]);
  });
});

describe("codec", () => {
  test("round trips and compresses", async () => {
    const replay = sampleReplay(500);
    const encoded = await encodeReplay(replay);
    expect(encoded.codec).toBe("deflate-raw");
    expect(encoded.bytes.length).toBeLessThan(JSON.stringify(replay).length / 3);
    expect(await decodeReplay(encoded.bytes, encoded.codec)).toEqual(replay);
    expect(await decodeReplay(encoded.bytes)).toEqual(replay);
  });

  test("decodes plain JSON", async () => {
    const replay = sampleReplay(2);
    const bytes = new TextEncoder().encode(JSON.stringify(replay));
    expect(await decodeReplay(bytes)).toEqual(replay);
  });
});

describe("application insights", () => {
  test("parses connection strings", () => {
    expect(
      parseConnectionString(
        "InstrumentationKey=00000000-0000-0000-0000-000000000001;IngestionEndpoint=https://westeurope-5.in.applicationinsights.azure.com/;LiveEndpoint=https://x/",
      ),
    ).toEqual({
      instrumentationKey: "00000000-0000-0000-0000-000000000001",
      ingestionEndpoint: "https://westeurope-5.in.applicationinsights.azure.com",
    });
    expect(parseConnectionString("InstrumentationKey=k").ingestionEndpoint).toBe(
      "https://dc.services.visualstudio.com",
    );
    expect(() => parseConnectionString("IngestionEndpoint=https://x")).toThrow();
  });

  test("splits a large replay into items within the limits and joins it back", async () => {
    const replay = sampleReplay(1);
    const big = new Uint8Array(150_000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 7919) % 251;
    const items = replayItems(replay, { bytes: big, codec: "deflate-raw" });
    expect(items.length).toBe(Math.ceil(Math.ceil((big.length / 3) * 4) / (PART_CHARS * PARTS_PER_ITEM)));
    for (const item of items) {
      for (const value of Object.values(item)) expect(value.length).toBeLessThanOrEqual(8192);
      expect(JSON.stringify(item).length).toBeLessThan(64_000);
    }
    expect(items[0].chronosError).toBe("Boom");
    // Rows arrive in any order, as Log Analytics returns them.
    const rows = [...items]
      .reverse()
      .map((customDimensions) => ({ customDimensions: JSON.stringify(customDimensions) }));
    const [assembled] = assembleReplays(rows);
    expect(assembled.received).toBe(items.length);
    expect(assembled.data?.bytes).toEqual(big);
  });

  test("a real replay survives the trip", async () => {
    const replay = sampleReplay(300);
    const encoded = await encodeReplay(replay);
    const [assembled] = assembleReplays(replayItems(replay, encoded).map((customDimensions) => ({ customDimensions })));
    expect(await readAssembled(assembled)).toEqual(replay);
  });

  test("an incomplete replay says what is missing", async () => {
    const replay = sampleReplay(1);
    const items = replayItems(replay, { bytes: new Uint8Array(120_000), codec: "deflate-raw" });
    const [assembled] = assembleReplays(items.slice(1).map((customDimensions) => ({ customDimensions })));
    expect(assembled.data).toBeUndefined();
    await expect(readAssembled(assembled)).rejects.toThrow(/of 3 parts/);
  });
});

describe("cursor", () => {
  const keys = [
    { t: 2000, x: 100, y: 100 },
    { t: 5000, x: 700, y: 400 },
    { t: 5300, x: 720, y: 420 },
  ];
  const path = new CursorPath(keys);

  test("is on each click when it happens", () => {
    for (const key of keys) {
      const frame = path.at(key.t);
      expect(frame.x).toBeCloseTo(key.x, 5);
      expect(frame.y).toBeCloseTo(key.y, 5);
      expect(frame.ripple).toBe(0);
    }
  });

  test("resting points pin it without a ripple", () => {
    const rested = new CursorPath([
      { t: 1000, x: 10, y: 10, click: false },
      { t: 4000, x: 10, y: 10, click: false },
      { t: 4300, x: 500, y: 300, click: false },
    ]);
    expect(rested.at(3900)).toMatchObject({ x: 10, y: 10, ripple: -1 });
    expect(rested.at(4300)).toMatchObject({ x: 500, y: 300, ripple: -1 });
    const midway = rested.at(4150);
    expect(midway.x).toBeGreaterThan(10);
    expect(midway.x).toBeLessThan(500);
  });

  test("waits, then moves smoothly without jumps", () => {
    expect(path.at(3000)).toMatchObject({ x: 100, y: 100 });
    let previous = path.at(2000);
    for (let t = 2000; t <= 5000; t += 16) {
      const frame = path.at(t);
      expect(Math.hypot(frame.x - previous.x, frame.y - previous.y)).toBeLessThan(40);
      previous = frame;
    }
  });

  test("is hidden until its first known position, and absent without any", () => {
    expect(path.at(0).visible).toBe(false);
    expect(path.at(1990).visible).toBe(false);
    expect(path.at(2000).visible).toBe(true);
    expect(new CursorPath([]).at(100).visible).toBe(false);
  });
});

test("inlined stylesheets keep their urls working", () => {
  const css = `a{background:url(../img/a.png)} b{background:url("/abs.png")} c{background:url(data:image/png;base64,xx)} d{background:url('https://cdn.test/x.png')}`;
  expect(rebaseCssUrls(css, "https://app.test/_next/static/css/app.css")).toBe(
    `a{background:url(https://app.test/_next/static/img/a.png)} b{background:url("https://app.test/abs.png")} c{background:url(data:image/png;base64,xx)} d{background:url('https://cdn.test/x.png')}`,
  );
});

describe("state emulation", () => {
  test("state pseudo-classes get an attribute twin, the rule keeps its place", () => {
    expect(rewriteSelector(".card:hover")).toBe(".card:hover, .card[data-chronos-hover]");
    expect(rewriteSelector("input:focus, a:focus-visible")).toBe(
      "input:focus, a:focus-visible, input[data-chronos-focus], a[data-chronos-focus-visible]",
    );
    expect(rewriteSelector(".menu:focus-within > li:active")).toBe(
      ".menu:focus-within > li:active, .menu[data-chronos-focus-within] > li[data-chronos-active]",
    );
    expect(rewriteSelector(".card .title")).toBeUndefined();
    expect(rewriteSelector(".a:hovering")).toBeUndefined();
  });

  test("media queries answer as they did for the user", () => {
    const dark = parseEnv("d");
    const light = parseEnv("");
    expect(rewriteMedia("(prefers-color-scheme: dark)", dark)).toBe("(min-width: 0px)");
    expect(rewriteMedia("(prefers-color-scheme: dark)", light)).toBe("(max-width: 0px)");
    expect(rewriteMedia("screen and (prefers-color-scheme: light) and (min-width: 600px)", light)).toBe(
      "screen and (min-width: 0px) and (min-width: 600px)",
    );
    expect(rewriteMedia("(hover: hover) and (pointer: fine)", parseEnv("cn"))).toBe(
      "(max-width: 0px) and (max-width: 0px)",
    );
    expect(rewriteMedia("(min-width: 600px)", dark)).toBe("(min-width: 600px)");
  });
});
