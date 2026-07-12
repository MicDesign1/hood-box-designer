#!/usr/bin/env node
/**
 * Evidence-gathering tool for the paper-detection pipeline
 * (src/lib/paper-detection.ts). Drives the real app -- not a
 * reimplementation -- against a static photo and prints exactly what the
 * detector saw: every contour it considered, why each was accepted or
 * rejected, and whether any ever reached the 4-point approxPolyDP stage.
 *
 * Requires the dev server running (npm run dev) and the `playwright`
 * package with a Chromium browser installed:
 *   npm install -D playwright && npx playwright install chromium
 *
 * Usage:
 *   node scripts/detect-debug.mjs <photo-path> [--ref=sheet|a4] [--base-url=http://localhost:3000]
 */
import path from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const photoPath = args.find((a) => !a.startsWith("--"));
const refArg = args.find((a) => a.startsWith("--ref="))?.split("=")[1] ?? "sheet";
const baseUrl = args.find((a) => a.startsWith("--base-url="))?.split("=")[1] ?? "http://localhost:3000";

if (!photoPath) {
  console.error("Usage: node scripts/detect-debug.mjs <photo-path> [--ref=sheet|a4] [--base-url=...]");
  process.exit(1);
}
const absPhotoPath = path.resolve(process.cwd(), photoPath);

function formatCandidate(c) {
  return {
    pointCount: c.pointCount,
    areaPx: Math.round(c.areaPx),
    "area%": (c.areaFraction * 100).toFixed(1),
    convex: c.isConvex,
    ratio: c.measuredRatio != null ? c.measuredRatio.toFixed(3) : "—",
    ratioErrPct: c.ratioError != null ? (c.ratioError * 100).toFixed(0) : "—",
    accepted: c.accepted,
    reason: c.reason,
  };
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push("PAGEERROR: " + err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto(`${baseUrl}/sample?detectDebug=1&detectLogAll=1`, { waitUntil: "networkidle" });
  await page.getByText("Flaps top & bottom", { exact: false }).click();
  await page.getByText("No — taped", { exact: false }).click();
  await page.getByText("C-flute", { exact: false }).click();
  await page.waitForSelector("text=Measure panel creases");
  await page.locator("button", { hasText: /Take or choose photo|Open photo/ }).first().click();
  await page.waitForSelector("text=Measure from photo");

  if (refArg === "a4") {
    await page.locator("#reference-object").click();
    await page.locator('[role="option"]', { hasText: "A4 sheet" }).click();
  }

  await page.locator('input[type="file"]').nth(1).setInputFiles(absPhotoPath);
  await page.waitForSelector("text=Scale reference");

  await page
    .waitForFunction(() => !document.body.innerText.includes("Detecting sheet"), { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => window.__paperDetectDebug ?? null);
  const bodyText = await page.textContent("body");
  const uiState = bodyText.includes("Paper detected")
    ? "detected"
    : bodyText.includes("Couldn't detect the sheet automatically")
      ? "not-detected"
      : bodyText.includes("Detecting sheet")
        ? "still-detecting (timed out waiting)"
        : "unknown";

  console.log("=".repeat(70));
  console.log(`Photo: ${absPhotoPath}`);
  console.log(`Reference: ${refArg}`);
  console.log(`Final UI state: ${uiState}`);
  console.log("=".repeat(70));

  if (!result) {
    console.log("No __paperDetectDebug result was captured (detection may not have run at all).");
  } else {
    const d = result.diagnostics;
    console.log(`Working image: ${d.workWidth}x${d.workHeight} (scale ${d.scale.toFixed(4)} from full-res)`);
    console.log(`Total contours from findContours: ${d.contoursTotal}`);
    console.log(`Contours reaching exactly 4 points (approxPolyDP): ${d.fourPointCount}`);
    console.log(`Of those, convex (real quad candidates): ${d.quadCount}`);
    if (d.fourPointCount === 0) {
      console.log(">>> ZERO contours ever reached the 4-point stage. <<<");
    }
    console.log(`Corners returned: ${result.corners ? "yes" : "no"}`);
    console.log("");
    console.log(`Candidates logged (${result.candidates.length}):`);
    console.table(result.candidates.map(formatCandidate));
  }

  if (consoleErrors.length) {
    console.log("");
    console.log("Console errors during the run:");
    for (const e of consoleErrors) console.log(" -", e);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
