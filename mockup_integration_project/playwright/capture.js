#!/usr/bin/env node
/**
 * Reusable evidence capture for the mockup integration audit.
 *
 * - Loads mockup_integration_project/mobile-mockup.html via file:// (cross-platform)
 * - Can capture Next.js app at http://localhost:3000 (start server separately)
 * - Produces stable paired names under screenshots/
 * - No hard-coded absolute paths from any developer's machine
 *
 * Usage examples:
 *   node mockup_integration_project/playwright/capture.js
 *   node mockup_integration_project/playwright/capture.js --target mockup --viewport 390,844 --state default
 *   node mockup_integration_project/playwright/capture.js --target app --app-url http://localhost:3000
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve repo root from this script's location (walk up until package.json found)
function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 8; i += 1) {
    const pkg = path.join(dir, "package.json");
    if (fsSyncExists(pkg)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: assume cwd is root or parent of mockup_integration_project
  if (fsSyncExists(path.join(process.cwd(), "package.json"))) return process.cwd();
  if (fsSyncExists(path.join(process.cwd(), "..", "package.json"))) return path.resolve(process.cwd(), "..");
  return process.cwd();
}

function fsSyncExists(p) {
  try {
    return fsSync.existsSync(p);
  } catch {
    return false;
  }
}

const repoRoot = findRepoRoot(__dirname);
const MOCKUP_RELATIVE = "mockup_integration_project/mobile-mockup.html";
const MOCKUP_PATH = path.join(repoRoot, MOCKUP_RELATIVE);
const DEFAULT_OUT_DIR = path.join(repoRoot, "mockup_integration_project/screenshots");

function toFileUrl(absPath) {
  // Cross-platform file:// URL (handles spaces, special chars)
  const normalized = path.resolve(absPath);
  // On Windows file:// needs 3 slashes + drive; on POSIX file:///abs
  if (process.platform === "win32") {
    return "file:///" + normalized.replace(/\\/g, "/");
  }
  return "file://" + normalized;
}

const VIEWPORTS = {
  mobile: { width: 390, height: 844, name: "mobile_390x844" },
  mobileLarge: { width: 428, height: 926, name: "mobile_428x926" },
  tablet: { width: 768, height: 1024, name: "tablet_768x1024" },
  desktop: { width: 1440, height: 900, name: "desktop_1440x900" },
};

const DEFAULT_STATES = ["default", "populated", "sheet-full", "preview-only"];

async function waitForStable(page, timeout = 1200) {
  await page.waitForTimeout(200);
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(timeout);
}

async function disableAnimations(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        transition: none !important;
        animation: none !important;
        animation-duration: 0s !important;
      }
    `,
  });
}

async function captureMockupState({ browser, viewportKey, state, outDir }) {
  const vp = VIEWPORTS[viewportKey] || VIEWPORTS.mobile;
  const page = await browser.newPage();
  const fileUrl = toFileUrl(MOCKUP_PATH);

  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.goto(fileUrl, { waitUntil: "domcontentloaded" });

  await disableAnimations(page);
  await waitForStable(page, 800);

  const frame = page.locator(".app-frame");

  // Ensure initial state per mockup JS (narrow forces board+peek)
  if (vp.width < 1024) {
    await page.evaluate(() => {
      const app = document.querySelector(".app-frame");
      if (app) {
        app.classList.remove("show-preview");
        app.classList.add("show-board");
        app.dataset.snap = "peek";
      }
    });
    await waitForStable(page, 300);
  }

  if ((state === "preview-only" || state === "board-only") && vp.width < 1024) {
    await page.evaluate((wantPreview) => {
      const app = document.querySelector(".app-frame");
      if (!app) return;
      if (wantPreview) {
        app.classList.add("show-preview");
        app.classList.remove("show-board");
      } else {
        app.classList.remove("show-preview");
        app.classList.add("show-board");
      }
    }, state === "preview-only");
    await waitForStable(page, 400);
  }

  if (state === "sheet-full" || state === "sheet-expanded") {
    // For mockup use direct data attr (2 states: peek/full). Click can be unreliable in headless due to layout/visibility.
    await page.evaluate(() => {
      const app = document.querySelector(".app-frame");
      if (app) {
        app.dataset.snap = "full";
        const h = document.querySelector("[data-sheet-handle]");
        if (h) h.setAttribute("aria-label", "Collapse settings panel");
      }
    });
    await waitForStable(page, 600);
  }

  // For "populated" — mockup always loads embedded sample on init.
  // The "default" capture is effectively populated for board.
  // We keep both names for matrix parity with app (app default=blank).

  const filename = `mockup_${vp.name}_${state}.png`;
  const outPath = path.join(outDir, filename);
  await frame.screenshot({ path: outPath });
  await page.close();
  console.log(`[mockup] captured ${filename}`);
  return { target: "mockup", viewport: vp.name, state, path: outPath };
}

async function captureAppState({ browser, viewportKey, state, outDir, appUrl }) {
  const vp = VIEWPORTS[viewportKey] || VIEWPORTS.mobile;
  const page = await browser.newPage();
  const url = appUrl || "http://localhost:3000";

  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForStable(page, 1200);

  await disableAnimations(page);

  if (state === "populated" || state === "default") {
    // Try to find and click Load sample if present (only affects default->populated)
    const loadBtn = page.getByRole("button", { name: /load sample/i }).first();
    if ((state === "populated") && (await loadBtn.count() > 0)) {
      await loadBtn.click();
      await page.waitForTimeout(1800); // allow upload + render
      await waitForStable(page, 600);
    }
  }

  if (state === "sheet-expanded" || state === "sheet-full") {
    // The sheet handle button on mobile (lg:hidden)
    const handle = page.locator(".side-panel > button").first();
    if (await handle.count() > 0) {
      await handle.click();
      await waitForStable(page, 500);
      // click again for full if 3-state
      if (state === "sheet-full") {
        await handle.click();
        await waitForStable(page, 500);
      }
    }
  }

  if (state === "preview-only") {
    // Toggle off board if controls present
    const boardToggle = page.locator('[data-wsview="board"], button:has-text("Word board")').first();
    if (await boardToggle.count() > 0) {
      const isActive = await boardToggle.evaluate((el) => el.classList.contains("is-active") || el.getAttribute("aria-pressed") === "true");
      if (isActive) await boardToggle.click();
      await waitForStable(page, 400);
    }
  }

  const filename = `app_${vp.name}_${state}.png`;
  const outPath = path.join(outDir, filename);
  await page.screenshot({ path: outPath, fullPage: false });
  await page.close();
  console.log(`[app] captured ${filename}`);
  return { target: "app", viewport: vp.name, state, path: outPath };
}

async function main() {
  const args = process.argv.slice(2);
  let target = "both";
  let viewportKey = "mobile";
  let states = [...DEFAULT_STATES];
  let appUrl = null;
  let outDir = DEFAULT_OUT_DIR;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--target" && args[i+1]) { target = args[++i]; continue; }
    if (a === "--viewport" && args[i+1]) {
      const [w, h] = args[++i].split(",").map(Number);
      viewportKey = (w === 390 && h === 844) ? "mobile"
        : (w === 428 && h === 926) ? "mobileLarge"
        : (w === 768 && h === 1024) ? "tablet"
        : (w === 1440 && h === 900) ? "desktop" : "mobile";
      continue;
    }
    if (a === "--state" && args[i+1]) { states = [args[++i]]; continue; }
    if (a === "--app-url" && args[i+1]) { appUrl = args[++i]; continue; }
    if (a === "--out-dir" && args[i+1]) { outDir = path.resolve(args[++i]); continue; }
  }

  await fs.mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  const results = [];

  const targets = target === "both" ? ["mockup", "app"] : [target];

  for (const t of targets) {
    for (const st of states) {
      try {
        if (t === "mockup") {
          // Always possible (file://)
          const r = await captureMockupState({ browser, viewportKey, state: st, outDir });
          results.push(r);
        } else if (t === "app") {
          const r = await captureAppState({ browser, viewportKey, state: st, outDir, appUrl });
          results.push(r);
        }
      } catch (err) {
        console.error(`Failed ${t} ${st}:`, err.message);
      }
    }
  }

  await browser.close();

  console.log("\nCapture complete. Results:");
  for (const r of results) console.log(`  ${r.target} ${r.viewport} ${r.state} -> ${path.relative(repoRoot, r.path)}`);
  console.log(`\nRepo root resolved to: ${repoRoot}`);
  console.log(`Mockup loaded from: ${MOCKUP_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
