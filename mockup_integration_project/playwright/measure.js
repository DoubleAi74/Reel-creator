#!/usr/bin/env node
/**
 * Measurement collector for the audit.
 * Records bounding rects, computed styles, overflow info for key selectors.
 * Outputs JSON to measurements/ with metadata.
 *
 * Resolves mockup_integration_project/mobile-mockup.html relative to repo (no hard-coded paths).
 *
 * Example:
 *   node mockup_integration_project/playwright/measure.js --target mockup --viewport 390,844 --state default
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (fsSync.existsSync(path.join(dir, "package.json"))) return dir;
    const p = path.dirname(dir);
    if (p === dir) break;
    dir = p;
  }
  return process.cwd();
}
const repoRoot = findRepoRoot(__dirname);
const MOCKUP_PATH = path.join(repoRoot, "mockup_integration_project/mobile-mockup.html");

function toFileUrl(p) {
  const n = path.resolve(p);
  return process.platform === "win32" ? "file:///" + n.replace(/\\/g, "/") : "file://" + n;
}

const VIEWPORTS = {
  "390x844": { width: 390, height: 844 },
  "428x926": { width: 428, height: 926 },
  "768x1024": { width: 768, height: 1024 },
  "1440x900": { width: 1440, height: 900 },
};

const KEY_SELECTORS = [
  ".app-frame",
  ".app-responsive",
  ".top-frame",
  ".work-area",
  ".workspace-panel",
  ".workspace-grid",
  ".preview-col",
  ".preview-screen",
  ".wb-slot",
  ".side-panel",
  ".sheet-handle",
  ".transport",
  ".transport-inner",
  ".editor-panel-content",
  "[data-snap]",
];

async function measureTarget({ browser, target, viewportStr, state, appUrl }) {
  const vp = VIEWPORTS[viewportStr] || VIEWPORTS["390x844"];
  const page = await browser.newPage();
  await page.setViewportSize({ width: vp.width, height: vp.height });

  let url, note;
  if (target === "mockup") {
    url = toFileUrl(MOCKUP_PATH);
    note = "file url from mockup_integration_project/mobile-mockup.html";
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    await page.evaluate(() => document.fonts?.ready);

    // Apply representative state
    if (vp.width < 1024) {
      const isFull = state === "sheet-full";
      const isPreview = state === "preview-only";
      await page.evaluate(({ isFullSnap, isPrev }) => {
        const app = document.querySelector(".app-frame");
        if (app) {
          app.classList.remove("show-preview");
          app.classList.add("show-board");
          app.dataset.snap = isFullSnap ? "full" : "peek";
          if (isPrev) { app.classList.add("show-preview"); app.classList.remove("show-board"); }
        }
      }, { isFullSnap: isFull, isPrev: isPreview });
    }
    await page.waitForTimeout(400);
  } else {
    url = appUrl || "http://localhost:3000";
    note = `app at ${url}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    // best effort for populated
    if (state === "populated") {
      const btn = page.getByRole("button", { name: /load sample/i }).first();
      if (await btn.count()) { await btn.click(); await page.waitForTimeout(1600); }
    }
    if (state && state.includes("sheet")) {
      const h = page.locator(".side-panel > button").first();
      if (await h.count()) await h.click();
      if (state.includes("full")) { await page.waitForTimeout(200); if (await h.count()) await h.click(); }
    }
    await page.waitForTimeout(400);
  }

  const results = {};
  for (const sel of KEY_SELECTORS) {
    const loc = page.locator(sel).first();
    const count = await loc.count();
    if (count === 0) { results[sel] = { present: false }; continue; }
    const rect = await loc.boundingBox();
    const styles = await loc.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        position: cs.position,
        top: cs.top,
        height: cs.height,
        minHeight: cs.minHeight,
        overflow: cs.overflow,
        overflowY: cs.overflowY,
        zIndex: cs.zIndex,
        background: cs.backgroundColor,
        borderRadius: cs.borderTopLeftRadius,
      };
    }).catch(() => ({}));
    results[sel] = { present: true, rect, styles };
  }

  // Extra: viewport + body info + note on tall elements
  const extra = await page.evaluate(() => ({
    innerHeight: window.innerHeight,
    scrollHeight: document.body.scrollHeight,
    appFrameRect: document.querySelector(".app-frame")?.getBoundingClientRect?.(),
  }));

  await page.close();

  return {
    target,
    authoritativeMockup: target === "mockup" ? "mockup_integration_project/mobile-mockup.html" : null,
    viewport: `${vp.width}x${vp.height}`,
    browser: "chromium-headless",
    deviceScaleFactor: 1,
    uiState: state || "default",
    urlOrPath: url,
    note,
    timestamp: new Date().toISOString(),
    selectors: results,
    extra,
  };
}

async function main() {
  const args = process.argv.slice(2);
  let target = "mockup";
  let viewportStr = "390x844";
  let state = "default";
  let appUrl = null;
  let outPath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--target") target = args[++i];
    else if (args[i] === "--viewport") viewportStr = args[++i];
    else if (args[i] === "--state") state = args[++i];
    else if (args[i] === "--app-url") appUrl = args[++i];
    else if (args[i] === "--out") outPath = path.resolve(args[++i]);
  }

  const browser = await chromium.launch({ headless: true });
  const data = await measureTarget({ browser, target, viewportStr, state, appUrl });
  await browser.close();

  if (!outPath) {
    const dir = path.join(repoRoot, "mockup_integration_project/measurements");
    await fs.mkdir(dir, { recursive: true });
    const safe = `${target}_${viewportStr}_${state}.json`;
    outPath = path.join(dir, safe);
  }
  await fs.writeFile(outPath, JSON.stringify(data, null, 2));
  console.log("Measurement written:", path.relative(repoRoot, outPath));
  // Warn on suspicious tall content
  const side = data.selectors[".side-panel"];
  if (side && side.rect && side.rect.height > 1200) {
    console.log("  NOTE: .side-panel content height much larger than viewport (", side.rect.height, ") — check min-height vs measured vs scroll.");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
