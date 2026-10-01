import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Browser, Page } from "playwright";
import { deltaEvents, E, type Replay, type ReplayEvent } from "../../src/format.ts";
import { fixturePage, launch, ORIGIN } from "./harness.ts";

let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser?.close();
});

/** A replay someone crafted by hand and sent with the app's public ingestion key. */
function craftedReplay(extra: ReplayEvent[] = []): Replay {
  const events: ReplayEvent[] = [
    [1000, E.Meta, "https://app.test/page", 800, 600],
    [
      1000,
      E.Snapshot,
      [
        "html",
        [
          "head",
          ["meta", { "http-equiv": "refresh", content: "0;url=https://evil.test/" }],
          ["base", { href: "https://evil.test/" }],
          ["script", "window.ran = true"],
          ["style", "body{background:url(/bg.png)}"],
          ["link", { rel: "prefetch", href: "https://evil.test/x" }],
        ],
        [
          "body",
          { onload: "window.ran = true" },
          ["a", { id: "js", href: "javascript:window.ran=true" }, "link"],
          ["img", { id: "img", src: "/logo.png", srcset: "/a.png 1x, /b.png 2x", onerror: "window.ran = true" }],
          ["iframe", { id: "frame", src: "https://evil.test/", srcdoc: "<script>window.ran=true</script>" }],
          ["object", { data: "https://evil.test/x.swf" }],
          ["div", { id: "styled", style: "background-image:url('/s.png')" }, "styled"],
          ["form", { id: "form", action: "https://evil.test/steal" }],
        ],
      ],
      0,
      0,
    ],
    ...extra,
  ];
  const { ts, e } = deltaEvents(events);
  return { v: 1, id: "c".repeat(32), ts, meta: {}, e };
}

async function playerPage(): Promise<Page> {
  const page = await fixturePage(browser);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  (page as unknown as { requests: string[] }).requests = requests;
  await page.goto(`${ORIGIN}/player.html`);
  await page.addScriptTag({ url: `${ORIGIN}/player.js` });
  return page;
}

describe("player", () => {
  test("a crafted replay can't run script, navigate or load from where it likes", async () => {
    const page = await playerPage();
    const result = await page.evaluate(async (replay) => {
      const w = window as unknown as Record<string, any>;
      const player = new w.ChronosPlayer.ChronosPlayer(document.getElementById("root"), replay, {
        resolveUrl: (url: string) => `/proxy?u=${encodeURIComponent(url)}`,
      });
      await player.ready;
      await new Promise((resolve) => setTimeout(resolve, 600));
      const frame = document.querySelector(".chronos-frame iframe") as HTMLIFrameElement;
      const doc = frame.contentDocument as Document;
      return {
        ran: (frame.contentWindow as unknown as Record<string, unknown>).ran === true,
        url: doc.URL,
        tags: Array.from(doc.querySelectorAll("meta,base[href*=evil],script,object,embed"), (el) => el.outerHTML),
        href: doc.getElementById("js")?.getAttribute("href"),
        img: doc.getElementById("img")?.getAttribute("src"),
        srcset: doc.getElementById("img")?.getAttribute("srcset"),
        onerror: doc.getElementById("img")?.getAttribute("onerror"),
        frameSrc: doc.getElementById("frame")?.getAttribute("src"),
        srcdoc: doc.getElementById("frame")?.getAttribute("srcdoc"),
        style: doc.getElementById("styled")?.getAttribute("style"),
        css: doc.querySelector("style")?.textContent,
        action: doc.getElementById("form")?.getAttribute("action"),
        prefetch: doc.querySelector("link")?.getAttribute("href"),
      };
    }, craftedReplay());
    expect(result.ran).toBe(false);
    expect(result.url).toBe("about:srcdoc");
    expect(result.tags).toEqual([]);
    expect(result.href).toBeNull();
    expect(result.img).toBe(`/proxy?u=${encodeURIComponent("https://app.test/logo.png")}`);
    expect(result.srcset).toContain(`/proxy?u=${encodeURIComponent("https://app.test/b.png")} 2x`);
    expect(result.onerror).toBeNull();
    expect(result.frameSrc).toBeNull();
    expect(result.srcdoc).toBeNull();
    expect(result.style).toContain(encodeURIComponent("https://app.test/s.png"));
    expect(result.css).toContain(encodeURIComponent("https://app.test/bg.png"));
    expect(result.action).toBeNull();
    expect(result.prefetch).toBeNull();
    const requests = (page as unknown as { requests: string[] }).requests;
    expect(requests.filter((url) => url.includes("evil.test") || url.startsWith("https://app.test"))).toEqual([]);
  });

  test("headless: just the page, driven by the API", async () => {
    const page = await playerPage();
    const result = await page.evaluate(async (replay) => {
      const w = window as unknown as Record<string, any>;
      const player = new w.ChronosPlayer.ChronosPlayer(document.getElementById("root"), replay, { controls: false });
      await player.ready;
      player.seek(0);
      return {
        controls: document.querySelectorAll(".chronos-controls, .chronos-actions").length,
        duration: player.duration,
        iframe: !!document.querySelector(".chronos-frame iframe"),
      };
    }, craftedReplay());
    expect(result).toEqual({ controls: 0, duration: 600, iframe: true });
  });

  test("a replay that creates too many nodes stops with an error", async () => {
    const page = await playerPage();
    const result = await page.evaluate(async (replay) => {
      const w = window as unknown as Record<string, any>;
      const player = new w.ChronosPlayer.ChronosPlayer(document.getElementById("root"), replay, { maxNodes: 10 });
      let errored = false;
      player.on("error", () => {
        errored = true;
      });
      await player.ready;
      return {
        errored,
        failure: player.failure?.message,
        banner: document.querySelector(".chronos-banner")?.textContent,
      };
    }, craftedReplay());
    expect(result.errored).toBe(true);
    expect(result.failure).toContain("too large");
    expect(result.banner).toContain("can't be shown");
  });
});

describe("recorder pauseOn", () => {
  test("nothing from a paused page is ever in a replay", async () => {
    const page = await fixturePage(browser);
    await page.goto(`${ORIGIN}/`);
    await page.addScriptTag({ url: `${ORIGIN}/recorder.js` });
    const replay = (await page.evaluate(async () => {
      const w = window as unknown as Record<string, any>;
      const rec = w.Chronos.record({ transports: [], pauseOn: (path: string) => path.startsWith("/sealed") });
      const arena = document.getElementById("arena") as HTMLElement;
      const add = (text: string) => {
        const p = document.createElement("p");
        p.textContent = text;
        arena.appendChild(p);
      };
      add("before the sealed page");
      await new Promise((resolve) => setTimeout(resolve, 20));
      add("SECRET BID 4,200,000");
      history.pushState({}, "", "/sealed/42");
      await new Promise((resolve) => setTimeout(resolve, 20));
      add("MORE SECRET 9,999");
      await new Promise((resolve) => setTimeout(resolve, 20));
      for (const p of Array.from(arena.querySelectorAll("p"))) if (/SECRET/.test(p.textContent ?? "")) p.remove();
      history.pushState({}, "", "/after");
      await new Promise((resolve) => setTimeout(resolve, 700));
      add("after the sealed page");
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { replay: rec.takeReplay(), paused: rec.isPaused };
    })) as { replay: Replay; paused: boolean };
    const text = JSON.stringify(replay.replay);
    expect(replay.paused).toBe(false);
    expect(text).not.toContain("SECRET");
    // History from before the pause is discarded: the replay starts at the fresh snapshot after it.
    expect(replay.replay.e[0]).toEqual([0, E.Meta, "http://chronos.test/after", 1024, 700]);
    expect(replay.replay.e.filter((event) => event[1] === E.Snapshot)).toHaveLength(1);
    expect(text).toContain("after the sealed page");
  });
});
