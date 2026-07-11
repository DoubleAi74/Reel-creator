import { chromium, devices } from "playwright";
const shotDir = "/private/tmp/claude-501/-Users-adamaldridge-Desktop-Reel-Creator-Transcribe-2-Main-current-Main-version-/b9948478-7435-481f-beda-be85b6e8423e/scratchpad";

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["iPhone 13 Pro"] });
const page = await context.newPage();
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.waitForTimeout(3500);
await page.locator('.transport-tabs button:visible', { hasText: "Audio" }).first().click();
await page.waitForTimeout(400);
const sample = page.getByRole("button", { name: "Load sample" });
if (await sample.count()) { await sample.first().click(); await page.waitForTimeout(4000); }
await page.locator('.transport-tabs button:visible', { hasText: "Lyrics" }).first().click();
await page.waitForTimeout(900);

const d = await page.evaluate(() => {
  const rect = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top) }; };
  const panel = document.querySelector(".side-panel");
  const pill = [...document.querySelectorAll(".side-panel button")].find((b) => /Set times manually|Hide times/.test(b.textContent));
  return {
    padTop: getComputedStyle(document.querySelector(".editor-panel-content")).paddingTop,
    whiteGap: rect(pill).top - rect(panel).top,
  };
});
console.log("content padding-top:", d.padTop, " white band (panel top -> pill top):", d.whiteGap, "px  (expect ~29)");

const box = await page.locator('.side-panel').first().boundingBox();
await page.screenshot({
  path: `${shotDir}/lyrics-topband-after.png`,
  clip: { x: box.x, y: box.y - 8, width: box.width, height: 130 },
});
await browser.close();
