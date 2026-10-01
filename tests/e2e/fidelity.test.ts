import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Browser } from "playwright";
import type { Replay } from "../../src/format.ts";
import { canonical, fixturePage, launch, ORIGIN } from "./harness.ts";

type Capture = { t: number; html: string; ops?: string[] };

let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser?.close();
});

/** Random DOM changes, a capture of the page after each round. Runs in the page. */
async function fuzz({ seed, rounds, gapMs }: { seed: number; rounds: number; gapMs: number }): Promise<Capture[]> {
  const SVG = "http://www.w3.org/2000/svg";
  let state = seed;
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const pick = <T>(items: T[]): T => items[Math.floor(rand() * items.length)];
  const arena = document.getElementById("arena") as HTMLElement;
  const NOT_CONTAINERS = new Set(["script", "input", "select", "option", "textarea", "br"]);
  const all = () => Array.from(arena.querySelectorAll("*"));
  const containers = (): Element[] => [
    arena,
    document.body,
    ...all().filter((el) => !NOT_CONTAINERS.has(el.localName) && el.namespaceURI === "http://www.w3.org/1999/xhtml"),
  ];
  const words = ["alpha", "beta", " ", "émoji 🎉", "<tag>", '"quoted"', "\n  "];
  const make = (depth: number): Node => {
    const r = rand();
    if (r < 0.25) return document.createTextNode(pick(words));
    if (r < 0.3) return document.createComment("c");
    if (r < 0.36) {
      const svg = document.createElementNS(SVG, "svg");
      svg.setAttribute("width", "20");
      const rect = document.createElementNS(SVG, "rect");
      rect.setAttribute("width", "5");
      svg.appendChild(rect);
      return svg;
    }
    const el = document.createElement(pick(["div", "span", "p", "ul", "li", "b", "section"]));
    if (rand() < 0.5) el.className = pick(["a", "b c", "box"]);
    if (rand() < 0.3) el.setAttribute("data-k", pick(words));
    const children = depth < 3 ? Math.floor(rand() * 3) : 0;
    for (let i = 0; i < children; i++) el.appendChild(make(depth + 1));
    return el;
  };
  const textNodes = () => {
    const walker = document.createTreeWalker(arena, NodeFilter.SHOW_TEXT);
    const out: Text[] = [];
    while (walker.nextNode()) {
      const parent = (walker.currentNode as Text).parentElement?.localName;
      if (parent !== "script" && parent !== "textarea") out.push(walker.currentNode as Text);
    }
    return out;
  };
  const position = (parent: Element) => pick([null, ...Array.from(parent.childNodes)]);
  const ops: (() => void)[] = [
    () => {
      const parent = pick(containers());
      parent.insertBefore(make(0), position(parent));
    },
    () => pick(all())?.remove(),
    () => {
      const node = pick([...all(), ...textNodes()]);
      const parent = pick(containers());
      if (node && !node.contains(parent)) parent.insertBefore(node, position(parent));
    },
    () => {
      const el = pick(all());
      if (!el) return;
      if (rand() < 0.3) el.removeAttribute(pick(["class", "title", "data-k"]));
      else el.setAttribute(pick(["class", "data-k", "title", "style"]), pick(["x", "y z", "color: red", ""]));
    },
    () => {
      const text = pick(textNodes());
      if (text) text.data = pick(words) + rand().toFixed(2);
    },
    () => {
      const input = document.getElementById("name") as HTMLInputElement | null;
      if (input) input.value = pick(words);
    },
    () => {
      const box = document.getElementById("agree") as HTMLInputElement | null;
      if (box) box.checked = !box.checked;
    },
    () => {
      const select = document.getElementById("pick") as HTMLSelectElement | null;
      if (select) select.value = pick(["x", "y"]);
    },
    () => {
      const sheet = (document.getElementById("cssom") as HTMLStyleElement).sheet as CSSStyleSheet;
      if (rand() < 0.7 || !sheet.cssRules.length) {
        sheet.insertRule(
          `.r${Math.floor(rand() * 1000)} { color: red; }`,
          Math.floor(rand() * (sheet.cssRules.length + 1)),
        );
      } else {
        sheet.deleteRule(Math.floor(rand() * sheet.cssRules.length));
      }
    },
    () => {
      const el = pick(all().filter((e) => !NOT_CONTAINERS.has(e.localName)));
      if (el && el.namespaceURI === "http://www.w3.org/1999/xhtml")
        el.innerHTML = '<i>new</i> text <!--x--> <span class="s">s</span>';
    },
    () => {
      // Added and removed, or added and moved, before the observer reports.
      const node = make(1);
      arena.appendChild(node);
      if (rand() < 0.5) node.parentNode?.removeChild(node);
      else {
        const parent = pick(containers());
        if (!node.contains(parent)) parent.insertBefore(node, position(parent));
      }
    },
    () => {
      // A new element whose subtree changes before the observer reports.
      const wrapper = document.createElement("div");
      pick(containers()).appendChild(wrapper);
      wrapper.appendChild(make(0));
      wrapper.setAttribute("class", "late");
      const moved = pick(all());
      if (moved && !moved.contains(wrapper)) wrapper.appendChild(moved);
    },
  ];
  const captures: Capture[] = [];
  const canonicalOf = (window as unknown as { canonical: (doc: Document) => string }).canonical;
  for (let round = 0; round < rounds; round++) {
    const count = 1 + Math.floor(rand() * 8);
    const log: string[] = [];
    for (let i = 0; i < count; i++) {
      try {
        const op = pick(ops);
        log.push(String(ops.indexOf(op)));
        op();
      } catch {
        // An impossible move (into its own subtree): skip it.
      }
      if (rand() < 0.2) {
        log.push("await");
        await Promise.resolve();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    captures.push({ t: Math.round(performance.timeOrigin + performance.now()), html: canonicalOf(document), ops: log });
    await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
  return captures;
}

async function record(options: { seed: number; rounds: number; gapMs: number; bufferMs: number }) {
  const page = await fixturePage(browser);
  await page.addInitScript(`window.canonical = ${canonical.toString()};`);
  await page.goto(`${ORIGIN}/`);
  await page.addScriptTag({ url: `${ORIGIN}/recorder.js` });
  await page.evaluate((bufferMs) => {
    const w = window as unknown as Record<string, any>;
    w.rec = w.Chronos.record({ transports: [], privacy: { maskInputs: false }, bufferMs });
  }, options.bufferMs);
  // Some typing too, through real key events.
  await page.click("#name");
  await page.keyboard.type(" typed", { delay: 5 });
  await page.selectOption("#pick", "x");
  await page.click("#agree");
  const captures = await page.evaluate(fuzz, options);
  const replay = (await page.evaluate(() => (window as unknown as Record<string, any>).rec.takeReplay())) as Replay;
  await page.close();
  return { captures, replay };
}

async function replayAt(replay: Replay, captures: Capture[]) {
  const page = await fixturePage(browser);
  await page.addInitScript(`window.canonical = ${canonical.toString()};`);
  await page.goto(`${ORIGIN}/player.html`);
  await page.addScriptTag({ url: `${ORIGIN}/player.js` });
  const result = await page.evaluate(
    async ({ replay, captures }) => {
      const w = window as unknown as Record<string, any>;
      const player = new w.ChronosPlayer.ChronosPlayer(document.getElementById("root"), replay, { skipIdle: false });
      await player.ready;
      const iframe = document.querySelector("iframe") as HTMLIFrameElement;
      const doc = iframe.contentDocument as Document;
      const mismatches: { index: number; expected: string; actual: string }[] = [];
      captures.forEach((capture, index) => {
        player.seek(capture.t - replay.ts);
        const actual = w.canonical(doc);
        if (actual !== capture.html) mismatches.push({ index, expected: capture.html, actual });
      });
      // Seeking backwards rebuilds from a snapshot and must land on the same state.
      const middle = captures[Math.floor(captures.length / 2)];
      player.seek(capture0(captures).t - replay.ts);
      player.seek(middle.t - replay.ts);
      const backAndForth = w.canonical(doc) === middle.html;
      function capture0(list: Capture[]) {
        return list[0];
      }
      return {
        mismatches: mismatches.slice(0, 3),
        count: mismatches.length,
        backAndForth,
        scriptRan: (iframe.contentWindow as unknown as Record<string, unknown>).inlineScriptRan === true,
        actions: player.actions.length,
      };
    },
    { replay, captures },
  );
  await page.close();
  return result;
}

function firstDifference(expected: string, actual: string): string {
  let i = 0;
  while (i < expected.length && expected[i] === actual[i]) i++;
  return `at ${i}:\n  expected …${expected.slice(Math.max(0, i - 120), i + 120)}\n  actual   …${actual.slice(Math.max(0, i - 120), i + 120)}`;
}

describe("fidelity", () => {
  const seeds = process.env.CHRONOS_SEEDS
    ? Array.from({ length: Number(process.env.CHRONOS_SEEDS) }, (_, i) => i + 1)
    : [1, 7, 42, 1234];
  for (const seed of seeds) {
    test(`random DOM changes replay exactly (seed ${seed})`, async () => {
      const { captures, replay } = await record({
        seed,
        rounds: Number(process.env.CHRONOS_ROUNDS ?? 120),
        gapMs: 2,
        bufferMs: 3_600_000,
      });
      const result = await replayAt(replay, captures);
      if (result.count) {
        console.error(
          `capture ${result.mismatches[0].index}:`,
          firstDifference(result.mismatches[0].expected, result.mismatches[0].actual),
        );
        if (process.env.CHRONOS_DEBUG)
          await Bun.write(
            `${process.env.CHRONOS_DEBUG}/seed-${seed}.json`,
            JSON.stringify({ replay, captures, mismatch: result.mismatches[0] }),
          );
      }
      expect(result.count).toBe(0);
      expect(result.backAndForth).toBe(true);
      expect(result.scriptRan).toBe(false);
      expect(result.actions).toBeGreaterThan(2);
    });
  }

  test("checkpoints keep the replay short and still exact", async () => {
    const { captures, replay } = await record({ seed: 99, rounds: 80, gapMs: 12, bufferMs: 400 });
    const snapshots = replay.e.filter((event) => event[1] === 1).length;
    expect(snapshots).toBeGreaterThanOrEqual(2);
    const inReplay = captures.filter((capture) => capture.t >= replay.ts);
    expect(inReplay.length).toBeLessThan(captures.length);
    const result = await replayAt(replay, inReplay);
    if (result.count) console.error(firstDifference(result.mismatches[0].expected, result.mismatches[0].actual));
    expect(result.count).toBe(0);
  });
});
