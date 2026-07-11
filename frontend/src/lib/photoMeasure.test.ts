import { describe, expect, it } from "vitest";

import {
  areCornersDegenerate,
  computeHomography,
  computeHomographyFromCorners,
  distanceInches,
  invertMatrix3x3,
  projectPoint,
  type Matrix3x3,
  type Pt,
  PhotoMeasureError,
} from "./photoMeasure";

const PX_PER_IN = 100;

describe("photoMeasure", () => {
  it("identity-ish: scaled world points → distance 6.75 in", () => {
    const world: Pt[] = [
      { x: 0, y: 0 },
      { x: 8.5, y: 0 },
      { x: 8.5, y: 11 },
      { x: 0, y: 11 },
    ];
    const image = world.map((p) => ({ x: p.x * PX_PER_IN, y: p.y * PX_PER_IN }));
    const h = computeHomography(image, world);

    const a = { x: 0, y: 6.75 * PX_PER_IN };
    const b = { x: 0, y: 0 };
    expect(distanceInches(h, a, b)).toBeCloseTo(6.75, 6);
  });

  it("perspective: recover homography and match world distance", () => {
    // Known projective map world → image (non-affine perspective).
    const worldToImage: Matrix3x3 = [
      [120, 15, 80],
      [8, 105, 60],
      [0.012, 0.004, 1],
    ];

    const worldCorners: Pt[] = [
      { x: 0, y: 0 },
      { x: 8.5, y: 0 },
      { x: 8.5, y: 11 },
      { x: 0, y: 11 },
    ];
    const imageCorners = worldCorners.map((p) => projectPoint(worldToImage, p));
    const imageToWorld = invertMatrix3x3(worldToImage);
    const h = computeHomography(imageCorners, worldCorners);

    const worldA = { x: 2.25, y: 4.5 };
    const worldB = { x: 6.75, y: 4.5 };
    const trueDist = 4.5;
    const imgA = projectPoint(worldToImage, worldA);
    const imgB = projectPoint(worldToImage, worldB);

    expect(distanceInches(h, imgA, imgB)).toBeCloseTo(trueDist, 6);
    expect(distanceInches(imageToWorld, imgA, imgB)).toBeCloseTo(trueDist, 6);
  });

  it("corner-order robustness: permuted corners give identical distances", () => {
    const worldToImage: Matrix3x3 = [
      [95, -12, 140],
      [18, 88, 35],
      [0.009, 0.006, 1],
    ];

    const worldCorners: Pt[] = [
      { x: 0, y: 0 },
      { x: 8.5, y: 0 },
      { x: 8.5, y: 11 },
      { x: 0, y: 11 },
    ];
    const imageCorners = worldCorners.map((p) => projectPoint(worldToImage, p));

    const orderA = [imageCorners[0]!, imageCorners[1]!, imageCorners[2]!, imageCorners[3]!];
    const orderB = [imageCorners[2]!, imageCorners[3]!, imageCorners[0]!, imageCorners[1]!];

    const hA = computeHomographyFromCorners(orderA);
    const hB = computeHomographyFromCorners(orderB);

    const imgP1 = projectPoint(worldToImage, { x: 1.5, y: 3 });
    const imgP2 = projectPoint(worldToImage, { x: 5.25, y: 3 });

    expect(distanceInches(hA, imgP1, imgP2)).toBeCloseTo(distanceInches(hB, imgP1, imgP2), 6);
    expect(distanceInches(hA, imgP1, imgP2)).toBeCloseTo(3.75, 6);
  });

  it("credit card reference: scaled world points → distance 3.37 in", () => {
    const world: Pt[] = [
      { x: 0, y: 0 },
      { x: 3.37, y: 0 },
      { x: 3.37, y: 2.125 },
      { x: 0, y: 2.125 },
    ];
    const image = world.map((p) => ({ x: p.x * PX_PER_IN, y: p.y * PX_PER_IN }));
    const h = computeHomography(image, world);

    const a = { x: 0, y: 1 * PX_PER_IN };
    const b = { x: 3.37 * PX_PER_IN, y: 1 * PX_PER_IN };
    expect(distanceInches(h, a, b)).toBeCloseTo(3.37, 6);
  });

  it("degenerate input: three collinear corners throw", () => {
    const collinear: Pt[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 40, y: 2 },
    ];
    expect(areCornersDegenerate(collinear)).toBe(true);
    expect(() => computeHomography(collinear, collinear)).toThrow(PhotoMeasureError);
    expect(() => computeHomographyFromCorners(collinear)).toThrow(PhotoMeasureError);
  });
});
