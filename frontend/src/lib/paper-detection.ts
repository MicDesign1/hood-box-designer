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
// the extra Mat work behind it) stays usable.
const DEBUG_MIN_AREA_FRACTION = 0.02;
const DEBUG_MAX_CANDIDATES = 40;

/** A 4-point quad opencv considered, kept only when opts.collectDebug is set
 * (see ?detectDebug=1 in PhotoMeasureSession) — for visualizing why
 * detection picked what it picked, or rejected everything. */
export interface PaperCandidate {
  points: Point[];
  areaFraction: number;
  ratioError: number | null;
  accepted: boolean;
  reason: string;
}

export interface PaperDetectionResult {
  corners: Point[] | null;
  candidates: PaperCandidate[];
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

/**
 * Finds the best paper-shaped quadrilateral in an image and returns its 4
 * corners in full-resolution image-pixel coordinates, angle-sorted (see
 * sortCornersByAngle) so they can be fed straight into computeCalibration().
 * `corners` is null on any failure (no candidate found, opencv.js failed to
 * load, coordinates degenerate) — callers must fall back to manual corner
 * placement silently, never surface a blocking error for this.
 *
 * Pass `collectDebug: true` to also get every 4-point quad opencv considered
 * with its accept/reject reason (dev-only debug overlay use; skipped by
 * default since it does extra work classifying rejects that production
 * doesn't need).
 */
export async function detectPaperCorners(
  image: HTMLImageElement,
  aspect: PaperAspect,
  opts: { collectDebug?: boolean } = {},
): Promise<PaperDetectionResult> {
  const candidates: PaperCandidate[] = [];
  let cv: OpenCv;
  try {
    cv = await loadCv();
  } catch {
    return { corners: null, candidates };
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

    const canvas = document.createElement("canvas");
    canvas.width = workW;
    canvas.height = workH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { corners: null, candidates };
    ctx.drawImage(image, 0, 0, workW, workH);

    src = cv.imread(canvas);
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    cv.Canny(gray, edges, 50, 150);
    cv.dilate(edges, edges, kernel);
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const workArea = workW * workH;
    let best: { pts: Point[]; score: number } | null = null;

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      const areaFraction = area / workArea;
      const areaOk = areaFraction >= MIN_AREA_FRACTION && areaFraction <= MAX_AREA_FRACTION;
      const worthDebugging = opts.collectDebug && areaFraction >= DEBUG_MIN_AREA_FRACTION && candidates.length < DEBUG_MAX_CANDIDATES;
      if (!areaOk && !worthDebugging) {
        contour.delete();
        continue;
      }

      const peri = cv.arcLength(contour, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, 0.02 * peri, true);
      const isQuad = approx.rows === 4 && cv.isContourConvex(approx);

      if (isQuad) {
        const rawPts: Point[] = [];
        for (let r = 0; r < 4; r++) {
          rawPts.push({ x: approx.data32S[r * 2]! / scale, y: approx.data32S[r * 2 + 1]! / scale });
        }
        const sorted = sortCornersByAngle(rawPts) as Point[];
        const side0 = Math.hypot(sorted[1]!.x - sorted[0]!.x, sorted[1]!.y - sorted[0]!.y);
        const side1 = Math.hypot(sorted[2]!.x - sorted[1]!.x, sorted[2]!.y - sorted[1]!.y);
        const long = Math.max(side0, side1);
        const short = Math.min(side0, side1);

        let ratioError: number | null = null;
        let accepted = false;
        let reason = "";

        if (!areaOk) {
          reason = areaFraction < MIN_AREA_FRACTION ? "area too small" : "area too large";
        } else if (short <= 0) {
          reason = "degenerate (zero-length side)";
        } else {
          const measuredRatio = long / short;
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

        if (opts.collectDebug && candidates.length < DEBUG_MAX_CANDIDATES) {
          candidates.push({ points: sorted, areaFraction, ratioError, accepted, reason });
        }
      } else if (opts.collectDebug && areaOk && candidates.length < DEBUG_MAX_CANDIDATES) {
        candidates.push({
          points: [],
          areaFraction,
          ratioError: null,
          accepted: false,
          reason: approx.rows === 4 ? "not convex" : `not a quad (${approx.rows} pts)`,
        });
      }

      approx.delete();
      contour.delete();
    }

    // second pass: only the true best-scoring candidate should read as
    // "accepted" once every candidate has been scored (the loop above marks
    // provisional bests as it goes, which can be superseded later).
    if (opts.collectDebug) {
      for (const c of candidates) {
        c.accepted = best != null && c.points.length === 4 && c.points === best.pts;
      }
    }

    return { corners: best ? best.pts : null, candidates };
  } catch {
    return { corners: null, candidates };
  } finally {
    kernel.delete();
    src?.delete();
    gray.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
  }
}
