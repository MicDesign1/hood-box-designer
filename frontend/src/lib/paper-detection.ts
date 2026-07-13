/**
 * Browser-side automatic detection of a rectangular reference sheet (Letter
 * or A4) in a photo, using opencv.js loaded lazily and only on the client.
 *
 * This module's only job is finding 4 corner points of the paper in the
 * photo. It does not do any homography or measurement math itself — the
 * detected corners are handed to the existing, already-tested calibration
 * pipeline in photo-calibration.ts exactly as if the user had tapped them
 * manually.
 */
import type { Point } from "@/lib/photo-calibration";
import { sortCornersByAngle } from "@/lib/photoMeasure";

export interface PaperAspect {
  /** long-side / short-side ratio, e.g. 11 / 8.5 for Letter. */
  ratio: number;
}

export const PAPER_ASPECT: Record<string, PaperAspect> = {
  sheet: { ratio: 11 / 8.5 },
  a4: { ratio: 11.693 / 8.268 },
};

const ASPECT_TOLERANCE_RATIO = 0.12;
// Field-photo evidence (5 real photos, logged via frontend/scripts/detect-debug.mjs):
// a real, clean, convex 4-point sheet candidate was rejected here at 5.3%
// (BoxMeasure3.jpg) and 6.7% (BoxMeasure5.jpg) of frame -- both real photos
// where the frame also had to fit the whole cardboard blank, not just the
// sheet. 0.08 was tuned against paper-only test shots and didn't leave room
// for that. 0.03 sits with margin below both observed failures rather than
// just barely clearing them.
const MIN_AREA_FRACTION = 0.03;
const MAX_AREA_FRACTION = 0.97;
const WORK_MAX_DIM = 900;
// Debug mode (?detectDebug=1) relaxes the area floor so near-miss candidates
// are still visible, but a genuinely noisy photo can produce hundreds of
// spurious micro-contours -- floor and cap those out so the overlay (and
// the extra Mat work behind it) stays usable. `logAll` (diagnostic script
// use only, not the live UI) bypasses both, since evidence-gathering needs
// the full picture. Kept proportional to MIN_AREA_FRACTION so debug mode
// still shows a meaningful window of near-misses below the real floor.
const DEBUG_MIN_AREA_FRACTION = 0.0075;
const DEBUG_MAX_CANDIDATES = 40;

/** Every contour opencv considered, kept only when opts.collectDebug or
 * opts.logAll is set — for visualizing/logging why detection picked what it
 * picked, or rejected everything. `points` holds whatever approxPolyDP
 * produced (not necessarily 4), in full-resolution image coordinates. */
export interface PaperCandidate {
  points: Point[];
  pointCount: number;
  areaPx: number;
  areaFraction: number;
  isConvex: boolean;
  /** long/short side ratio of the fitted quad; null unless pointCount === 4. */
  measuredRatio: number | null;
  ratioError: number | null;
  accepted: boolean;
  reason: string;
}

export interface PaperDetectionDiagnostics {
  workWidth: number;
  workHeight: number;
  /** full-res-to-working-image scale factor (1 = no downscale). */
  scale: number;
  /** total contours returned by findContours, before any filtering. */
  contoursTotal: number;
  /** contours whose approxPolyDP result had exactly 4 points, regardless of convexity. */
  fourPointCount: number;
  /** of those, how many were also convex (i.e. real quad candidates). */
  quadCount: number;
}

export interface PaperDetectionResult {
  corners: Point[] | null;
  candidates: PaperCandidate[];
  diagnostics: PaperDetectionDiagnostics;
}

let cvPromise: Promise<OpenCv> | null = null;

// opencv.js's emscripten module doesn't ship useful types for this loading
// dance; keep it narrowly typed to what we actually call. `import type`-only
// usage (typeof, never a value import) -- TypeScript erases this at compile
// time, so it costs nothing at runtime and doesn't reintroduce the bundled
// dependency loadCv() below deliberately avoids.
type OpenCv = typeof import("@techstark/opencv-js");

// Pinned to the exact version (and file) @techstark/opencv-js@5.0.0-release.1
// ships as dist/opencv.js -- same build, same detection behavior, just
// fetched from jsDelivr's npm mirror at runtime instead of bundled as a
// local Next.js asset. That local chunk was 25.4 MiB, over Cloudflare
// Pages' 25 MiB per-file limit; loading it from a CDN means it's never part
// of the Pages deploy at all. Bump this version deliberately, not by
// floating to `@latest`, if opencv-js is ever upgraded.
const OPENCV_VERSION = "5.0.0-release.1";
const OPENCV_CDN_URL = `https://cdn.jsdelivr.net/npm/@techstark/opencv-js@${OPENCV_VERSION}/dist/opencv.js`;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)));
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function loadCv(): Promise<OpenCv> {
  if (!cvPromise) {
    cvPromise = (async () => {
      await loadScript(OPENCV_CDN_URL);
      // The UMD build's browser-global branch sets `window.cv` to whatever
      // its async factory returns -- always a Promise the first time
      // (resolves once the WASM runtime initializes), never the module
      // synchronously. Same resolution dance the old bundled-import path
      // already had to handle, just fed from `window.cv` instead of a
      // dynamic import's namespace object.
      const cvModule = (window as unknown as { cv?: unknown }).cv;
      if (cvModule instanceof Promise) return (await cvModule) as OpenCv;
      const mod = cvModule as { Mat?: unknown; onRuntimeInitialized?: () => void };
      if (mod.Mat) return cvModule as OpenCv;
      await new Promise<void>((resolve) => {
        mod.onRuntimeInitialized = () => resolve();
      });
      return cvModule as OpenCv;
    })();
  }
  return cvPromise;
}

const emptyDiagnostics = (workWidth = 0, workHeight = 0, scale = 1): PaperDetectionDiagnostics => ({
  workWidth,
  workHeight,
  scale,
  contoursTotal: 0,
  fourPointCount: 0,
  quadCount: 0,
});

/**
 * Finds the best paper-shaped quadrilateral in an image and returns its 4
 * corners in full-resolution image-pixel coordinates, angle-sorted (see
 * sortCornersByAngle) so they can be fed straight into computeCalibration().
 * `corners` is null on any failure (no candidate found, opencv.js failed to
 * load, coordinates degenerate) — callers must fall back to manual corner
 * placement silently, never surface a blocking error for this.
 *
 * Pass `collectDebug: true` to also get every 4-point quad opencv considered
 * with its accept/reject reason (dev-only debug overlay use; capped/floored
 * to stay usable on noisy photos). Pass `logAll: true` (diagnostic script
 * use, not the live UI) to additionally bypass that cap/floor and classify
 * every contour findContours returned, regardless of point count or size —
 * this is slower and only meant for offline evidence-gathering.
 */
export async function detectPaperCorners(
  image: HTMLImageElement,
  aspect: PaperAspect,
  opts: { collectDebug?: boolean; logAll?: boolean } = {},
): Promise<PaperDetectionResult> {
  const wantDebug = !!(opts.collectDebug || opts.logAll);
  const candidates: PaperCandidate[] = [];
  let cv: OpenCv;
  try {
    cv = await loadCv();
  } catch {
    return { corners: null, candidates, diagnostics: emptyDiagnostics() };
  }

  const kernel = cv.Mat.ones(7, 7, cv.CV_8U);
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let src: InstanceType<OpenCv["Mat"]> | null = null;

  try {
    const scale = Math.min(1, WORK_MAX_DIM / Math.max(image.naturalWidth, image.naturalHeight));
    const workW = Math.max(1, Math.round(image.naturalWidth * scale));
    const workH = Math.max(1, Math.round(image.naturalHeight * scale));
    const diagnostics = emptyDiagnostics(workW, workH, scale);

    const canvas = document.createElement("canvas");
    canvas.width = workW;
    canvas.height = workH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { corners: null, candidates, diagnostics };
    ctx.drawImage(image, 0, 0, workW, workH);

    src = cv.imread(canvas);
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    cv.Canny(gray, edges, 50, 150);
    // Morphological closing (dilate then erode, same kernel) bridges small
    // gaps/kinks along the sheet's boundary -- grout lines crossing it,
    // shadow edges running parallel to it, a slight paper curl -- without
    // permanently growing the boundary outward the way a bare dilate does.
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    diagnostics.contoursTotal = contours.size();
    const workArea = workW * workH;
    let best: { pts: Point[]; score: number } | null = null;

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      const areaFraction = area / workArea;
      const areaOk = areaFraction >= MIN_AREA_FRACTION && areaFraction <= MAX_AREA_FRACTION;
      const worthDebugging =
        opts.logAll ||
        (opts.collectDebug && areaFraction >= DEBUG_MIN_AREA_FRACTION && candidates.length < DEBUG_MAX_CANDIDATES);
      if (!areaOk && !worthDebugging) {
        contour.delete();
        continue;
      }

      const peri = cv.arcLength(contour, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, 0.02 * peri, true);
      const pointCount = approx.rows;
      const isConvex = cv.isContourConvex(approx);
      if (pointCount === 4) {
        diagnostics.fourPointCount += 1;
        if (isConvex) diagnostics.quadCount += 1;
      }
      const isQuad = pointCount === 4 && isConvex;

      const polyPts: Point[] = [];
      for (let r = 0; r < pointCount; r++) {
        polyPts.push({ x: approx.data32S[r * 2]! / scale, y: approx.data32S[r * 2 + 1]! / scale });
      }

      let measuredRatio: number | null = null;
      let ratioError: number | null = null;
      let accepted = false;
      let reason: string;
      let sorted = polyPts;

      if (!isQuad) {
        reason = !isConvex && pointCount === 4 ? "not convex" : `not a quad (${pointCount} pts)`;
      } else {
        sorted = sortCornersByAngle(polyPts) as Point[];
        const side0 = Math.hypot(sorted[1]!.x - sorted[0]!.x, sorted[1]!.y - sorted[0]!.y);
        const side1 = Math.hypot(sorted[2]!.x - sorted[1]!.x, sorted[2]!.y - sorted[1]!.y);
        const long = Math.max(side0, side1);
        const short = Math.min(side0, side1);

        if (!areaOk) {
          reason = areaFraction < MIN_AREA_FRACTION ? "area too small" : "area too large";
        } else if (short <= 0) {
          reason = "degenerate (zero-length side)";
        } else {
          measuredRatio = long / short;
          ratioError = Math.abs(measuredRatio - aspect.ratio) / aspect.ratio;
          if (ratioError > ASPECT_TOLERANCE_RATIO) {
            reason = `aspect ratio mismatch (Δ=${(ratioError * 100).toFixed(0)}%)`;
          } else {
            const score = ratioError - areaFraction * 0.1;
            if (!best || score < best.score) {
              best = { pts: sorted, score };
              accepted = true;
              reason = "accepted (best so far)";
            } else {
              reason = "matched, but lower score than another candidate";
            }
          }
        }
      }

      if (wantDebug && (opts.logAll || candidates.length < DEBUG_MAX_CANDIDATES)) {
        candidates.push({
          points: sorted,
          pointCount,
          areaPx: area,
          areaFraction,
          isConvex,
          measuredRatio,
          ratioError,
          accepted,
          reason,
        });
      }

      approx.delete();
      contour.delete();
    }

    // second pass: only the true best-scoring candidate should read as
    // "accepted" once every candidate has been scored (the loop above marks
    // provisional bests as it goes, which can be superseded later) -- fix up
    // any provisional candidate's reason text so it doesn't still claim
    // "accepted (best so far)" once accepted has flipped back to false.
    if (wantDebug) {
      for (const c of candidates) {
        const isFinalBest = best != null && c.pointCount === 4 && c.points === best.pts;
        if (c.accepted && !isFinalBest) {
          c.reason = "matched, but a later candidate scored higher";
        }
        c.accepted = isFinalBest;
      }
    }

    return { corners: best ? best.pts : null, candidates, diagnostics };
  } catch {
    return { corners: null, candidates, diagnostics: emptyDiagnostics() };
  } finally {
    kernel.delete();
    src?.delete();
    gray.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
  }
}
