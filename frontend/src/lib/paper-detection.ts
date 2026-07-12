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
const MIN_AREA_FRACTION = 0.08;
const MAX_AREA_FRACTION = 0.97;
const WORK_MAX_DIM = 900;
// Debug mode (?detectDebug=1) relaxes the area floor so near-miss candidates
// are still visible, but a genuinely noisy photo can produce hundreds of
// spurious micro-contours -- floor and cap those out so the overlay (and
// the extra Mat work behind it) stays usable. `logAll` (diagnostic script
// use only, not the live UI) bypasses both, since evidence-gathering needs
// the full picture.
const DEBUG_MIN_AREA_FRACTION = 0.02;
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
// dance; keep it narrowly typed to what we actually call.
type OpenCv = typeof import("@techstark/opencv-js");

async function loadCv(): Promise<OpenCv> {
  if (!cvPromise) {
    cvPromise = (async () => {
      const imported = (await import("@techstark/opencv-js")) as unknown as Record<string, unknown>;
      // webpack's CJS/ESM interop for this UMD build doesn't reliably land
      // the emscripten module at `.default` -- fall back to the namespace
      // object itself when `.default` isn't populated.
      const cvModule = (imported.default ?? imported) as unknown;
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

  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
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
    cv.dilate(edges, edges, kernel);
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
