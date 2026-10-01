import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Browser, Page } from "playwright";
import { launch, replayIds, startDemo, waitForReplay } from "./harness.ts";

/**
 * Is the replay 1:1? Screenshots of the live page at moments of a session are
 * compared, pixel by pixel, with the replay at the same moments at real size.
 * `CHRONOS_SHOTS=<dir>` saves the live, replayed and diff images.
 */
const shots = process.env.CHRONOS_SHOTS;
const VIEWPORT = { width: 1280, height: 800 };
/**
 * Share of pixels allowed to differ. What remains is drawn by the browser for
 * real focus or hover only, which a replay can't give without taking the
 * viewer's focus: a search field's clear button, a native checkbox's hover shade.
 */
const TOLERANCE = Number(
  process.env.CHRONOS_VISUAL_TOLERANCE ??
    // Firefox and WebKit also place a transformed element (a hovered card)
    // inside a scrolled iframe one pixel off now and then.
    (["firefox", "webkit"].includes(process.env.CHRONOS_BROWSER ?? "") ? 0.003 : 0.0003),
);

let demo: Awaited<ReturnType<typeof startDemo>>;
let browser: Browser;

beforeAll(async () => {
  demo = await startDemo(Number(process.env.VISUAL_PORT ?? 3111));
  browser = await launch();
});

afterAll(async () => {
  await browser?.close();
  await demo?.stop();
});

interface Moment {
  name: string;
  t: number;
  png: Buffer;
}

/** No CSS transition, animation or (smooth) scroll running: the page shows a settled state. */
async function settled(page: Page, frame?: string) {
  await page.waitForTimeout(150);
  await page.waitForFunction(async (selector) => {
    const doc = selector ? (document.querySelector(selector) as HTMLIFrameElement).contentDocument : document;
    const view = doc?.defaultView;
    if (!doc || !view) return false;
    const before = view.scrollY;
    await new Promise((resolve) => setTimeout(resolve, 100));
    return view.scrollY === before && doc.getAnimations().every((animation) => animation.playState !== "running");
  }, frame);
}

async function moment(page: Page, moments: Moment[], name: string) {
  await settled(page);
  const t = await page.evaluate(() => Math.round(performance.timeOrigin + performance.now()));
  moments.push({ name, t, png: await page.screenshot() });
}

interface Diff {
  ratio: number;
  sizes: number[];
  image: string;
}

/** Compare two PNGs in a browser canvas. */
async function diff(page: Page, a: Buffer, b: Buffer): Promise<Diff> {
  return page.evaluate(
    async ({ a, b }) => {
      const load = async (data: string) =>
        createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const width = Math.min(ia.width, ib.width);
      const height = Math.min(ia.height, ib.height);
      const pixels = (image: ImageBitmap) => {
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, width, height).data;
      };
      const pa = pixels(ia);
      const pb = pixels(ib);
      const out = new OffscreenCanvas(width, height);
      const context = out.getContext("2d") as OffscreenCanvasRenderingContext2D;
      const image = context.createImageData(width, height);
      let different = 0;
      for (let i = 0; i < pa.length; i += 4) {
        const delta = Math.max(
          Math.abs(pa[i] - pb[i]),
          Math.abs(pa[i + 1] - pb[i + 1]),
          Math.abs(pa[i + 2] - pb[i + 2]),
        );
        const gray = (pa[i] + pa[i + 1] + pa[i + 2]) / 3;
        if (delta > 32) {
          different++;
          image.data.set([255, 0, 60, 255], i);
        } else {
          image.data.set([gray, gray, gray, 70], i);
        }
      }
      context.putImageData(image, 0, 0);
      const blob = await out.convertToBlob({ type: "image/png" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return {
        ratio: different / (width * height),
        sizes: [ia.width, ia.height, ib.width, ib.height],
        image: btoa(binary),
      };
    },
    { a: a.toString("base64"), b: b.toString("base64") },
  );
}

/** Replay `moments` at real size, compare each with the live screenshot. */
async function compareReplay(
  replayId: string,
  moments: Moment[],
  viewerScheme: "light" | "dark",
  prefix: string,
): Promise<{ name: string; ratio: number }[]> {
  const viewer = await browser.newPage({ viewport: { width: 1800, height: 1200 }, colorScheme: viewerScheme });
  await viewer.goto(`${demo.base}/replays/${replayId}?source=http`);
  await viewer.waitForFunction(() => "chronosPlayer" in window);
  await viewer.evaluate(() => (window as any).chronosPlayer.ready);
  await viewer.addStyleTag({ content: ".chronos-cursor,.chronos-ripple,.chronos-banner{visibility:hidden!important}" });
  await viewer.evaluate(() => {
    const player = (window as any).chronosPlayer;
    player.pause();
    player.setZoom(1);
  });
  const compare = await browser.newPage();
  const results: { name: string; ratio: number }[] = [];
  for (const m of moments) {
    await viewer.evaluate((t) => {
      const player = (window as any).chronosPlayer;
      player.seek(t - player.replay.ts);
    }, m.t);
    await viewer.waitForTimeout(600); // stylesheets, images, and a scroll Firefox applies on its next frame
    await settled(viewer, ".chronos-frame iframe");
    if (process.env.CHRONOS_DEBUG) {
      console.info(
        m.name,
        await viewer.evaluate(() => {
          const p = (window as any).chronosPlayer;
          const doc = (document.querySelector(".chronos-frame iframe") as HTMLIFrameElement)
            .contentDocument as Document;
          const frame = p.cursor.at(p.time);
          return JSON.stringify({
            at: p.time,
            xy: [frame.x, frame.y, frame.visible],
            scrollY: doc.defaultView?.scrollY,
            hovered: Array.from(doc.querySelectorAll("[data-chronos-hover]"), (e) => e.localName).join(">"),
          });
        }),
      );
    }
    const box = await viewer.locator(".chronos-frame iframe").boundingBox();
    if (!box) throw new Error("no player iframe");
    const png = await viewer.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
    const result = await diff(compare, m.png, png);
    results.push({ name: `${prefix}${m.name}`, ratio: result.ratio });
    if (shots) {
      await Bun.write(`${shots}/${prefix}${m.name}-live.png`, m.png);
      await Bun.write(`${shots}/${prefix}${m.name}-replay.png`, png);
      await Bun.write(`${shots}/${prefix}${m.name}-diff.png`, Buffer.from(result.image, "base64"));
    }
    expect(result.sizes).toEqual([VIEWPORT.width, VIEWPORT.height, VIEWPORT.width, VIEWPORT.height]);
  }
  await viewer.close();
  await compare.close();
  console.info(results.map((r) => `${r.name.padEnd(24)} ${(r.ratio * 100).toFixed(3)}% different`).join("\n"));
  return results;
}

async function livePage(colorScheme: "light" | "dark"): Promise<Page> {
  const page = await browser.newPage({ viewport: VIEWPORT, colorScheme });
  await page.addInitScript(() => sessionStorage.setItem("demo:unmask", "1"));
  page.on("pageerror", (error) => console.error("page error:", error.message));
  return page;
}

describe("visual fidelity", () => {
  test("the replay looks like the live page at every moment", async () => {
    const page = await livePage("light");
    const moments: Moment[] = [];
    await page.goto(demo.base);
    await moment(page, moments, "01-shop");
    await page.getByRole("button", { name: "Add to cart" }).nth(1).click();
    await moment(page, moments, "02-added-hover");
    await page.getByLabel("Search products").click();
    await page.getByLabel("Search products").pressSequentially("lamp", { delay: 40 });
    await moment(page, moments, "03-search-focus");
    await page.getByLabel("Search products").fill("");
    await page.mouse.wheel(0, 300);
    await moment(page, moments, "04-scrolled");
    await page.getByRole("button", { name: /Cart, 1 items/ }).click();
    await moment(page, moments, "05-drawer");
    await page.getByRole("link", { name: "Go to checkout" }).click();
    await page.waitForURL(`${demo.base}/checkout`);
    await moment(page, moments, "06-checkout");
    await page.getByLabel("Full name").pressSequentially("Kari Nordmann", { delay: 30 });
    await moment(page, moments, "07-typing");
    await page.getByLabel("Email").fill("kari@example.com");
    await page.getByLabel("Card number").fill("4111 1111 1111 1111");
    await page.getByLabel("Expiry").fill("12/29");
    await page.getByLabel("Country").selectOption("SE");
    await page.getByLabel("Save my details for next time").check();
    await moment(page, moments, "08-checked");
    await page.getByRole("button", { name: /^Pay/ }).click();
    await page.getByText("Payment failed.").waitFor();
    await moment(page, moments, "09-failed");
    const replay = await waitForReplay(demo.base, /POST \/api\/pay/);
    await page.close();
    for (const r of await compareReplay(replay.id, moments, "light", ""))
      expect(r.ratio).toBeLessThanOrEqual(TOLERANCE);
  });

  test("a user in dark mode is replayed in dark mode to a viewer in light mode", async () => {
    const before = await replayIds(demo.base);
    const page = await livePage("dark");
    const moments: Moment[] = [];
    await page.goto(`${demo.base}/checkout`);
    await moment(page, moments, "01-checkout");
    await page.getByLabel("Full name").fill("Kari Nordmann");
    await page.getByLabel("Email").fill("kari@example.com");
    await page.getByLabel("Card number").fill("4111 1111 1111 1111");
    await page.getByLabel("Expiry").fill("12/29");
    await page.getByLabel("Country").selectOption("DK");
    await page.mouse.move(5, 790);
    await moment(page, moments, "02-filled");
    await page.getByRole("button", { name: /^Pay/ }).click();
    await page.getByText("Payment failed.").waitFor();
    await page.mouse.move(5, 790);
    await moment(page, moments, "03-failed");
    const replay = await waitForReplay(demo.base, /POST \/api\/pay/, before);
    await page.close();
    for (const r of await compareReplay(replay.id, moments, "light", "dark-")) {
      expect(r.ratio).toBeLessThanOrEqual(TOLERANCE);
    }
  });
});
