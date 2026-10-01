import { rm } from "node:fs/promises";
import { type Browser, chromium, firefox, type Page, webkit } from "playwright";

const fixtures = new URL("../fixtures/", import.meta.url).pathname;
export const ORIGIN = "http://chronos.test";

/** `CHRONOS_BROWSER=firefox|webkit` runs the browser tests in another engine (Chromium by default). */
export async function launch(): Promise<Browser> {
  const name = process.env.CHRONOS_BROWSER ?? "chromium";
  return ({ chromium, firefox, webkit }[name] ?? chromium).launch();
}

/** A page whose requests to http://chronos.test are served from tests/fixtures. */
export async function fixturePage(browser: Browser, viewport = { width: 1024, height: 700 }): Promise<Page> {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (error) => console.error("page error:", error.message));
  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/style.css") {
      return route.fulfill({ contentType: "text/css", body: "h1 { color: rgb(20, 60, 160); } .box { margin: 6px; }" });
    }
    if (path === "/collect") return route.fulfill({ status: 204 });
    const file = Bun.file(fixtures + (path === "/" ? "page.html" : path.slice(1)));
    if (!(await file.exists())) return route.fulfill({ status: 404 });
    const type = path.endsWith(".js") ? "text/javascript" : "text/html";
    return route.fulfill({ contentType: type, body: await file.text() });
  });
  return page;
}

/**
 * A canonical text form of a document, for comparing the live page with the
 * replayed one. It leaves out what the recorder drops on purpose (scripts,
 * metadata, the player's <base>) and includes live state (values, CSSOM).
 */
export function canonical(doc: Document): string {
  const skip = new Set(["script", "noscript", "meta", "link", "base"]);
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      out.push(JSON.stringify((node as Text).data));
      return;
    }
    if (node.nodeType === 8) {
      out.push("<!>");
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.localName;
    if (skip.has(tag)) return;
    const attrs = Array.from(el.attributes)
      // The player's hover and focus emulation, not part of the page.
      .filter((a) => !/^data-chronos-(hover|active|focus)/.test(a.name))
      .map((a) => `${a.name}=${JSON.stringify(a.value)}`)
      .sort()
      .join(" ");
    let state = "";
    if (tag === "input") {
      const input = el as HTMLInputElement;
      state =
        input.type === "checkbox" || input.type === "radio"
          ? `checked=${input.checked}`
          : `value=${JSON.stringify(input.value)}`;
    } else if (tag === "textarea" || tag === "select") {
      state = `value=${JSON.stringify((el as HTMLTextAreaElement).value)}`;
    } else if (tag === "style" && !(el.textContent ?? "").trim()) {
      const rules = (el as HTMLStyleElement).sheet?.cssRules;
      state = `cssom=${JSON.stringify(rules ? Array.from(rules, (r) => r.cssText) : [])}`;
    }
    out.push(`<${el.namespaceURI === "http://www.w3.org/2000/svg" ? "svg:" : ""}${tag} ${attrs} ${state}>`);
    for (let child = el.firstChild; child; child = child.nextSibling) walk(child);
    out.push(`</${tag}>`);
  };
  walk(doc.documentElement);
  return out.join("");
}

const demoDir = new URL("../../examples/next-demo/", import.meta.url).pathname;

/**
 * Starts the sample app's production build (`bun --bun next start`) on its
 * own port and data folder. Needs `bun run --cwd examples/next-demo build`.
 */
export async function startDemo(port: number): Promise<{ base: string; data: string; stop: () => Promise<void> }> {
  const data = `${demoDir}.data/test-${port}`;
  await rm(data, { recursive: true, force: true });
  const server = Bun.spawn(["bun", "--bun", "next", "start", "-p", String(port)], {
    cwd: demoDir,
    env: { ...process.env, DEMO_DATA_DIR: data },
    stdout: "ignore",
    stderr: "inherit",
  });
  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/api/replays`)).ok) break;
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(200);
  }
  return {
    base,
    data,
    stop: async () => {
      server.kill();
      await server.exited;
    },
  };
}

export interface ReplaySummary {
  id: string;
  source: "http" | "appinsights";
  bytes: number;
  error?: string;
  items?: number;
  complete: boolean;
}

/** Wait until a replay whose error matches arrived through both transports (one not seen before). */
export async function waitForReplay(base: string, match: RegExp, seen = new Set<string>()): Promise<ReplaySummary> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const list = (await (await fetch(`${base}/api/replays`)).json()) as ReplaySummary[];
    const ai = list.find(
      (r) => r.source === "appinsights" && match.test(r.error ?? "") && r.complete && !seen.has(r.id),
    );
    if (ai && list.some((r) => r.source === "http" && r.id === ai.id)) return ai;
    await Bun.sleep(250);
  }
  throw new Error(`no replay matching ${match} arrived`);
}

export async function replayIds(base: string): Promise<Set<string>> {
  const list = (await (await fetch(`${base}/api/replays`)).json()) as ReplaySummary[];
  return new Set(list.map((r) => r.id));
}
