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
 * Returns null on any failure (no candidate found, opencv.js failed to
 * load, coordinates degenerate) — callers must fall back to manual corner
 * placement silently, never surface an error for this.
 */
export async function detectPaperCorners(
  image: HTMLImageElement,
  aspect: PaperAspect,
): Promise<Point[] | null> {
  let cv: OpenCv;
  try {
    cv = await loadCv();
  } catch {
    return null;
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
    if (!ctx) return null;
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
      if (areaFraction < MIN_AREA_FRACTION || areaFraction > MAX_AREA_FRACTION) {
        contour.delete();
        continue;
      }

      const peri = cv.arcLength(contour, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, 0.02 * peri, true);

      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const rawPts: Point[] = [];
        for (let r = 0; r < 4; r++) {
          rawPts.push({ x: approx.data32S[r * 2]! / scale, y: approx.data32S[r * 2 + 1]! / scale });
        }
        const sorted = sortCornersByAngle(rawPts) as Point[];
        const side0 = Math.hypot(sorted[1]!.x - sorted[0]!.x, sorted[1]!.y - sorted[0]!.y);
        const side1 = Math.hypot(sorted[2]!.x - sorted[1]!.x, sorted[2]!.y - sorted[1]!.y);
        const long = Math.max(side0, side1);
        const short = Math.min(side0, side1);

        if (short > 0) {
          const measuredRatio = long / short;
          const ratioError = Math.abs(measuredRatio - aspect.ratio) / aspect.ratio;
          if (ratioError <= ASPECT_TOLERANCE_RATIO) {
            const score = ratioError - areaFraction * 0.1;
            if (!best || score < best.score) best = { pts: sorted, score };
          }
        }
      }

      approx.delete();
      contour.delete();
    }

    return best ? best.pts : null;
  } catch {
    return null;
  } finally {
    kernel.delete();
    src?.delete();
    gray.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
  }
}
