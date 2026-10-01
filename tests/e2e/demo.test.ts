import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Browser, Page } from "playwright";
import { launch, type ReplaySummary, startDemo, waitForReplay as waitFor } from "./harness.ts";

/**
 * Runs the sample Next.js app (production build, `bun --bun next start`) and
 * breaks it the three ways the demo offers, then checks what reached the mock
 * Application Insights endpoint and that the viewer plays it back.
 *
 * Needs `bun run --cwd examples/next-demo build` first (`bun run e2e` does it).
 */
const shots = process.env.CHRONOS_SHOTS;

let demo: Awaited<ReturnType<typeof startDemo>>;
let BASE = "";
let browser: Browser;
const waitForReplay = (match: RegExp) => waitFor(BASE, match);

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}

beforeAll(async () => {
  demo = await startDemo(Number(process.env.DEMO_PORT ?? 3110));
  BASE = demo.base;
  browser = await launch();
});

afterAll(async () => {
  await browser?.close();
  await demo?.stop();
});

describe("next demo", () => {
  let payReplay: ReplaySummary;

  test("a failed payment sends a replay to Application Insights", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(BASE);
    await page.waitForTimeout(400);
    await page.getByLabel("Search products").pressSequentially("chair", { delay: 60 });
    await page.waitForTimeout(500);
    await page.getByLabel("Search products").fill("");
    await page.waitForTimeout(300);
    const add = page.getByRole("button", { name: "Add to cart" });
    await add.nth(0).click();
    await page.waitForTimeout(600);
    await add.nth(3).click();
    await page.waitForTimeout(500);
    await add.nth(1).click();
    await page.waitForTimeout(500);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: /Cart, 3 items/ }).click();
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: "Remove Stoneware mug" }).click();
    await page.waitForTimeout(500);
    await page.getByRole("link", { name: "Go to checkout" }).click();
    await page.waitForURL(`${BASE}/checkout`);
    await page.waitForTimeout(400);
    await page.getByLabel("Full name").pressSequentially("Kari Nordmann", { delay: 40 });
    await page.getByLabel("Email").pressSequentially("kari@example.com", { delay: 30 });
    await page.getByLabel("Card number").pressSequentially("4111 1111 1111 1111", { delay: 30 });
    await page.getByLabel("Expiry").pressSequentially("12/29", { delay: 40 });
    await page.getByLabel("Country").selectOption("SE");
    await page.getByLabel("Save my details for next time").check();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: /^Pay/ }).click();
    await page.getByText("Payment failed.").waitFor();
    await shot(page, "1-live-checkout-failed");
    payReplay = await waitForReplay(/POST \/api\/pay failed with 502/);
    expect(errors).toEqual([]);
    await page.close();
  });

  test("the telemetry items stay within Application Insights limits", async () => {
    const rows = (await Bun.file(`${demo.data}/appinsights.jsonl`).text())
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const items = rows.filter((row) => row.customDimensions.chronosId === payReplay.id);
    expect(items.length).toBe(payReplay.items);
    for (const item of items) {
      expect(item.name).toBe("chronos.replay");
      expect(item.tags["ai.cloud.role"]).toBe("next-demo");
      expect(item.tags["ai.session.id"]).toBeTruthy();
      for (const value of Object.values(item.customDimensions)) expect(String(value).length).toBeLessThanOrEqual(8192);
      expect(JSON.stringify(item).length).toBeLessThan(64 * 1024);
    }
    console.info(
      `pay replay: ${(payReplay.bytes / 1024).toFixed(1)} KB compressed, ${payReplay.items} telemetry item(s)`,
    );
  });

  test("a crash in a click handler sends a replay", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${BASE}/checkout`);
    await page.getByLabel("Coupon code").pressSequentially("SAVE50", { delay: 50 });
    await page.getByRole("button", { name: "Apply" }).click();
    const replay = await waitForReplay(/TypeError/);
    expect(replay.error).toContain("percent");
    await page.close();
  });

  test("a render error after a full page load sends a replay of both pages", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(BASE);
    await page.getByRole("button", { name: "Add to cart" }).first().click();
    await page.waitForTimeout(400);
    // A full page load, not a client-side navigation: the buffer survives in sessionStorage.
    await page.goto(`${BASE}/reports`);
    await page.getByRole("button", { name: "Load report" }).click();
    await page.getByRole("heading", { name: "Something went wrong" }).waitFor();
    const replay = await waitForReplay(/rows/);
    await page.close();

    const viewer = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await viewer.goto(`${BASE}/replays/${replay.id}?source=appinsights`);
    const actions = viewer.locator(".chronos-actions li");
    await actions.first().waitFor();
    const labels = await actions.allTextContents();
    expect(labels.some((label) => label.includes("Opened /reports"))).toBe(true);
    expect(labels.some((label) => label.includes("Clicked “Add to cart”"))).toBe(true);
    expect(labels.some((label) => label.includes("Clicked “Load report”"))).toBe(true);
    await viewer.close();
  });

  test("the viewer plays the payment replay back", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${BASE}/replays/${payReplay.id}?source=appinsights`);
    const actions = page.locator(".chronos-actions li");
    await actions.first().waitFor();
    const labels = await actions.allTextContents();
    for (const expected of [
      "Clicked “Add to cart”",
      "Typed in “Search products”",
      "Clicked “Remove Stoneware mug”",
      "Went to /checkout",
      "Typed in “Full name”",
      "Chose “Sweden” in “Country”",
      "Checked “Save my details for next time”",
      "Clicked “Pay $238.00”",
      "POST /api/pay",
      "POST /api/pay failed with 502",
    ]) {
      if (!labels.some((label) => label.includes(expected))) console.error(`missing "${expected}" in`, labels);
      expect(labels.some((label) => label.includes(expected))).toBe(true);
    }

    const frame = page.frameLocator(".chronos-frame iframe");
    // Pause and look at moments of the replay.
    await page.getByRole("button", { name: "Pause" }).click();
    await page.getByLabel("Playback speed").selectOption("1");
    const at = async (label: string, name: string, wait = 1250) => {
      await actions.filter({ hasText: label }).first().click();
      await page.getByRole("button", { name: "Play" }).click();
      await page.waitForTimeout(wait);
      await page.getByRole("button", { name: "Pause" }).click();
      await shot(page, name);
    };
    await at("Clicked “Add to cart”", "2-replay-shop", 1300);
    await expect(frame.locator(".badge").textContent()).resolves.toBe("1");
    await at("Clicked “Remove Stoneware mug”", "3-replay-cart-drawer", 1300);
    await expect(frame.getByRole("button", { name: "Remove Lounge chair" }).count()).resolves.toBe(1);
    await at("Checked “Save my details", "4-replay-checkout-form", 1300);
    // Typed values are masked: same length, no content.
    const name = await frame.getByLabel("Full name").inputValue();
    expect(name).toBe("**** ********");
    expect(name.length).toBe("Kari Nordmann".length);
    expect(await frame.getByLabel("Email").inputValue()).not.toContain("@example");

    await page.getByRole("button", { name: "Jump to error" }).click();
    await page.waitForTimeout(5200);
    await shot(page, "5-replay-error");
    await expect(page.locator(".chronos-banner").textContent()).resolves.toContain("502");
    await expect(frame.locator(".alert").textContent()).resolves.toContain("Payment failed");
    // Nothing from the recording ran in the viewer.
    expect(errors).toEqual([]);
    await page.close();
  });
});
