import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const outRoot = path.join(appRoot, ".visual-parity");

const referenceUrl =
  process.env.REFERENCE_URL ?? "http://localhost:4173/index_new.html";
const currentUrl = process.env.CURRENT_URL ?? "http://localhost:3000";
const hindiLinesFixturePath = path.join(appRoot, "samples", "aaj-se-teri.json");
let hindiLinesFixtureBody = null;
const browserCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Users/adamaldridge/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell",
].filter(Boolean);

const scenarios = [
  { name: "desktop-1440-initial", viewport: { width: 1440, height: 900 } },
  { name: "desktop-1280-initial", viewport: { width: 1280, height: 800 } },
  { name: "compact-1000-initial", viewport: { width: 1000, height: 800 } },
  { name: "compact-999-initial", viewport: { width: 999, height: 800 } },
  { name: "mobile-390-initial", viewport: { width: 390, height: 844 } },
  {
    name: "mobile-390-board",
    viewport: { width: 390, height: 844 },
    action: "board",
  },
  {
    name: "mobile-390-preview",
    viewport: { width: 390, height: 844 },
    action: "preview",
  },
  {
    name: "desktop-1440-modal",
    viewport: { width: 1440, height: 900 },
    action: "modal",
  },
  {
    name: "desktop-1440-word-selected",
    viewport: { width: 1440, height: 900 },
    action: "word",
  },
  {
    name: "desktop-1440-play",
    viewport: { width: 1440, height: 900 },
    action: "play",
  },
];

const selectors = [
  ".app-responsive",
  ".top-frame",
  ".work-area",
  ".side-panel",
  ".workspace-panel",
  ".workspace-grid",
  ".preview-col",
  ".preview-screen",
  ".wb-slot",
  ".transport",
  ".transport-inner",
];

async function ensureDirs() {
  await Promise.all(
    ["reference", "current", "diff"].map((folder) =>
      fs.mkdir(path.join(outRoot, folder), { recursive: true }),
    ),
  );
}

async function firstExistingPath(paths) {
  for (const candidate of paths) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next local browser candidate.
    }
  }
  return null;
}

function tokenize(value) {
  return String(value ?? "")
    .replace(/[.,!?;:()]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

async function getHindiLinesFixtureBody() {
  if (hindiLinesFixtureBody) {
    return hindiLinesFixtureBody;
  }

  const rawFixture = JSON.parse(await fs.readFile(hindiLinesFixturePath, "utf8"));
  hindiLinesFixtureBody = JSON.stringify({
    ...rawFixture,
    lines: (rawFixture.lines ?? []).map((line, index) => ({
      ...line,
      id: line.id ?? `fixture-line-${index + 1}`,
      romanization: line.romanization ?? "",
      words:
        Array.isArray(line.words) && line.words.length
          ? line.words
          : tokenize(line.original).map((text) => ({ text })),
    })),
  });

  return hindiLinesFixtureBody;
}

async function settle(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  });
}

async function clickFirst(page, locators) {
  for (const locator of locators) {
    const target = page.locator(locator).first();
    if ((await target.count()) === 0) {
      continue;
    }
    if (!(await target.isVisible().catch(() => false))) {
      continue;
    }
    if (await target.isDisabled().catch(() => false)) {
      continue;
    }
    try {
      await target.click({ timeout: 1800 });
    } catch {
      await target.click({ force: true, timeout: 1800 });
    }
    await settle(page);
    return true;
  }
  return false;
}

async function applyScenario(page, scenario) {
  if (scenario.action === "board") {
    await clickFirst(page, [
      "[data-wsview='board']",
      ".mobile-view-toggle button:has-text('Word board')",
    ]);
  }

  if (scenario.action === "preview") {
    await clickFirst(page, [
      "[data-wsview='preview']",
      ".mobile-view-toggle button:has-text('Preview')",
    ]);
  }

  if (scenario.action === "modal") {
    await clickFirst(page, [
      "[data-action='preview']",
      "button[aria-label='Open full-screen preview']",
      "button:has-text('Preview')",
    ]);
  }

  if (scenario.action === "word") {
    await clickFirst(page, [
      ".word-button >> nth=3",
      ".word-tile >> nth=3",
      "[data-word-id] button >> nth=3",
    ]);
  }

  if (scenario.action === "play") {
    await clickFirst(page, [
      "[data-transport='play']",
      ".play-button",
      "button:has-text('Play')",
    ]);
  }
}

async function collectBoxes(page) {
  return page.evaluate((requestedSelectors) => {
    return Object.fromEntries(
      requestedSelectors.map((selector) => {
        const element = document.querySelector(selector);
        if (!element) {
          return [selector, null];
        }
        const rect = element.getBoundingClientRect();
        const styles = getComputedStyle(element);
        return [
          selector,
          {
            backgroundColor: styles.backgroundColor,
            borderColor: styles.borderColor,
            borderRadius: styles.borderRadius,
            boxShadow: styles.boxShadow,
            display: styles.display,
            height: Number(rect.height.toFixed(2)),
            left: Number(rect.left.toFixed(2)),
            top: Number(rect.top.toFixed(2)),
            width: Number(rect.width.toFixed(2)),
          },
        ];
      }),
    );
  }, selectors);
}

async function captureTarget(browser, target, scenario) {
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    viewport: scenario.viewport,
  });
  const page = await context.newPage();
  if (target.folder === "reference") {
    await page.route("**/Hindi_Lines.json", async (route) =>
      route.fulfill({
        body: await getHindiLinesFixtureBody(),
        contentType: "application/json",
      }),
    );
  }
  await page.goto(target.url);
  await settle(page);
  await applyScenario(page, scenario);

  const screenshotPath = path.join(outRoot, target.folder, `${scenario.name}.png`);
  await page.screenshot({ fullPage: false, path: screenshotPath });
  const boxes = await collectBoxes(page);
  await context.close();

  return { boxes, screenshotPath };
}

async function compareImages(scenario) {
  const referencePath = path.join(outRoot, "reference", `${scenario.name}.png`);
  const currentPath = path.join(outRoot, "current", `${scenario.name}.png`);
  const diffPath = path.join(outRoot, "diff", `${scenario.name}.png`);

  const refImage = sharp(referencePath).ensureAlpha();
  const curImage = sharp(currentPath).ensureAlpha();
  const [refMeta, curMeta] = await Promise.all([refImage.metadata(), curImage.metadata()]);
  const width = Math.min(refMeta.width ?? 0, curMeta.width ?? 0);
  const height = Math.min(refMeta.height ?? 0, curMeta.height ?? 0);

  const [reference, current] = await Promise.all([
    sharp(referencePath)
      .extract({ left: 0, top: 0, width, height })
      .ensureAlpha()
      .raw()
      .toBuffer(),
    sharp(currentPath)
      .extract({ left: 0, top: 0, width, height })
      .ensureAlpha()
      .raw()
      .toBuffer(),
  ]);

  const diff = Buffer.alloc(width * height * 4);
  let changed = 0;
  let totalDelta = 0;
  const threshold = 24;

  for (let index = 0; index < reference.length; index += 4) {
    const delta =
      Math.abs(reference[index] - current[index]) +
      Math.abs(reference[index + 1] - current[index + 1]) +
      Math.abs(reference[index + 2] - current[index + 2]) +
      Math.abs(reference[index + 3] - current[index + 3]);

    totalDelta += delta;

    const pixel = index / 4;
    const out = pixel * 4;
    if (delta > threshold) {
      changed += 1;
      diff[out] = 220;
      diff[out + 1] = 32;
      diff[out + 2] = 32;
      diff[out + 3] = 255;
    } else {
      diff[out] = Math.round(reference[index] * 0.18 + current[index] * 0.18);
      diff[out + 1] = Math.round(reference[index + 1] * 0.18 + current[index + 1] * 0.18);
      diff[out + 2] = Math.round(reference[index + 2] * 0.18 + current[index + 2] * 0.18);
      diff[out + 3] = 255;
    }
  }

  await sharp(diff, { raw: { channels: 4, height, width } }).png().toFile(diffPath);

  const pixels = width * height || 1;
  return {
    changedPixels: changed,
    diffPath,
    meanChannelDelta: Number((totalDelta / pixels / 4).toFixed(2)),
    mismatchRatio: Number((changed / pixels).toFixed(5)),
  };
}

async function run() {
  await ensureDirs();
  const executablePath = await firstExistingPath(browserCandidates);
  const browser = await chromium.launch(
    executablePath ? { executablePath } : undefined,
  );
  const summary = [];

  try {
    for (const scenario of scenarios) {
      const reference = await captureTarget(
        browser,
        { folder: "reference", url: referenceUrl },
        scenario,
      );
      const current = await captureTarget(
        browser,
        { folder: "current", url: currentUrl },
        scenario,
      );
      const diff = await compareImages(scenario);
      summary.push({
        ...scenario,
        currentBoxes: current.boxes,
        diff,
        referenceBoxes: reference.boxes,
      });
      console.log(
        `${scenario.name}: ${(diff.mismatchRatio * 100).toFixed(2)}% mismatch, mean delta ${diff.meanChannelDelta}`,
      );
    }
  } finally {
    await browser.close();
  }

  await fs.writeFile(
    path.join(outRoot, "summary.json"),
    `${JSON.stringify({ currentUrl, referenceUrl, scenarios: summary }, null, 2)}\n`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
