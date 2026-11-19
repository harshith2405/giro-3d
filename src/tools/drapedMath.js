// src/tools/drapedMath.js
// High-precision terrain-draping and interpolation math for 3D polylines and polygons

import { Vector3 } from "three";
import { state } from "../core/state.js";

/**
 * Generates terrain-clamped (draped) 3D points along the perimeter of a polygon.
 * Interpolates sub-points along each segment and samples real-world elevations from the terrain mesh.
 */
export function getDrapedPolygon3DPoints(rawPoints, isClosed = true) {
  if (!rawPoints || rawPoints.length === 0) return [];
  if (rawPoints.length === 1) {
    const p0 = rawPoints[0];
    const px = p0.coord ? p0.coord.x : p0.point ? p0.point.x : p0.x;
    const py = p0.coord ? p0.coord.y : p0.point ? p0.point.y : p0.y;
    const pz = p0.coord ? (p0.coord.z || 0) : p0.point ? (p0.point.z || 0) : (p0.z || 0);
    return [new Vector3(px, py, pz)];
  }

  const map = state.map;
  const count = rawPoints.length;
  const numEdges = isClosed ? count : count - 1;
  const draped = [];

  for (let i = 0; i < numEdges; i++) {
    const p1 = rawPoints[i];
    const p2 = rawPoints[(i + 1) % count];

    const x1 = p1.coord ? p1.coord.x : p1.point ? p1.point.x : p1.x;
    const y1 = p1.coord ? p1.coord.y : p1.point ? p1.point.y : p1.y;
    const z1 = p1.coord ? (p1.coord.z || 0) : p1.point ? (p1.point.z || 0) : (p1.z || 0);

    const x2 = p2.coord ? p2.coord.x : p2.point ? p2.point.x : p2.x;
    const y2 = p2.coord ? p2.coord.y : p2.point ? p2.point.y : p2.y;
    const z2 = p2.coord ? (p2.coord.z || 0) : p2.point ? (p2.point.z || 0) : (p2.z || 0);

    const segDist = Math.hypot(x2 - x1, y2 - y1);
    // Sample every ~2 meters, capped between 1 and 25 steps per edge for optimal 60fps performance
    const steps = Math.max(1, Math.min(25, Math.ceil(segDist / 2.0)));

    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const x = x1 + t * (x2 - x1);
      const y = y1 + t * (y2 - y1);

      let z = z1 + t * (z2 - z1);
      if (map && typeof map.getElevationFast === "function") {
        const sample = map.getElevationFast(x, y);
        if (sample && sample.elevation !== undefined && !isNaN(sample.elevation)) {
          z = sample.elevation;
        }
      }
      draped.push(new Vector3(x, y, z));
    }
  }

  // Add the final point for unclosed lines or to perfectly close the ring
  const lastP = isClosed ? rawPoints[0] : rawPoints[count - 1];
  const lx = lastP.coord ? lastP.coord.x : lastP.point ? lastP.point.x : lastP.x;
  const ly = lastP.coord ? lastP.coord.y : lastP.point ? lastP.point.y : lastP.y;
  let lz = lastP.coord ? (lastP.coord.z || 0) : lastP.point ? (lastP.point.z || 0) : (lastP.z || 0);
  if (map && typeof map.getElevationFast === "function") {
    const sample = map.getElevationFast(lx, ly);
    if (sample && sample.elevation !== undefined && !isNaN(sample.elevation)) {
      lz = sample.elevation;
    }
  }
  draped.push(new Vector3(lx, ly, lz));

  return draped;
}

/**
 * Reconstructs high-density draped 3D points between two endpoints given an elevation array.
 */
export function buildProfile3DPointsFromElevations(startPt, endPt, elevationsArray) {
  if (!startPt || !endPt || !elevationsArray || elevationsArray.length < 2) return [];
  const count = elevationsArray.length;
  const pts = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const x = startPt.x + t * (endPt.x - startPt.x);
    const y = startPt.y + t * (endPt.y - startPt.y);
    const rawZ = Number(elevationsArray[i]);
    const fallbackZ = (startPt.z || 0) + t * ((endPt.z || 0) - (startPt.z || 0));
    const z = (!isNaN(rawZ) && typeof rawZ === "number") ? rawZ : fallbackZ;
    pts.push(new Vector3(x, y, z + 0.35));
  }
  return pts;
}

/**
 * Serialize [ [x,y], ... ] into an SVG points string.
 */
export function pointsToString(points) {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}
