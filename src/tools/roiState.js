// src/tools/roiState.js
// Spatial scoping, notice banners, and active ROI checks

import { state } from "../core/state.js";

let roiNoticeTimeout = null;

export function showRoiWorkspaceNotice(message, onRestore) {
  const hud = document.getElementById("roiWorkspaceNoticeHud");
  const textEl = document.getElementById("roiWorkspaceNoticeText");
  const restoreBtn = document.getElementById("btnRestoreMapFromNotice");
  const closeBtn = document.getElementById("btnCloseRoiNotice");
  if (!hud || !textEl) return;

  textEl.textContent = message;
  hud.classList.remove("hidden");

  if (restoreBtn) {
    restoreBtn.onclick = () => {
      hideRoiWorkspaceNotice();
      if (typeof onRestore === 'function') onRestore();
    };
  }
  if (closeBtn) {
    closeBtn.onclick = () => hideRoiWorkspaceNotice();
  }

  if (roiNoticeTimeout) clearTimeout(roiNoticeTimeout);
  roiNoticeTimeout = setTimeout(() => {
    hideRoiWorkspaceNotice();
  }, 6000);
}

export function hideRoiWorkspaceNotice() {
  const hud = document.getElementById("roiWorkspaceNoticeHud");
  if (hud) hud.classList.add("hidden");
  if (roiNoticeTimeout) {
    clearTimeout(roiNoticeTimeout);
    roiNoticeTimeout = null;
  }
}

export function updateRoiWorkspaceBadge(name) {
  // Pill removed per user preference; function kept for clean no-op compatibility
}

export function hideRoiWorkspaceBadge() {
  // Pill removed per user preference; function kept for clean no-op compatibility
}

export function isPointInsidePolygonCoords(px, py, polyCoords) {
  let inside = false;
  for (let i = 0, j = polyCoords.length - 1; i < polyCoords.length; j = i++) {
    const xi = polyCoords[i].x, yi = polyCoords[i].y;
    const xj = polyCoords[j].x, yj = polyCoords[j].y;
    const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function isFeatureInsideActiveRoi(rawPoints) {
  if (!state.isTerrainClippedToRoi || !rawPoints || rawPoints.length === 0) return true;
  const map = state.map;
  if (!map || !map.extent) return true;

  const e = map.extent;
  const eMinX = Math.min(e.minX, e.maxX);
  const eMaxX = Math.max(e.minX, e.maxX);
  const eMinY = Math.min(e.minY, e.maxY);
  const eMaxY = Math.max(e.minY, e.maxY);

  // Precision tolerance (5cm)
  const eps = 0.05;

  const pts = [];
  for (const p of rawPoints) {
    const px = p.coord ? p.coord.x : p.x;
    const py = p.coord ? p.coord.y : p.y;
    if (isNaN(px) || isNaN(py)) continue;
    pts.push({ x: px, y: py });
  }
  if (pts.length === 0) return true;

  // 1. STRICT: ALL points MUST be inside the active terrain bounding box!
  for (const pt of pts) {
    if (pt.x < eMinX - eps || pt.x > eMaxX + eps || pt.y < eMinY - eps || pt.y > eMaxY + eps) {
      return false; // Point is in the void outside the clipped terrain!
    }
  }

  // 2. If active ROI is a custom Polygon ROI, ALL points MUST also be inside the polygon!
  if (state.roiPolyPoints && state.roiPolyPoints.length >= 3 && map.clippingPlanes && map.clippingPlanes.length > 0) {
    const roiCoords = state.roiPolyPoints.map(p => ({ x: p.coord ? p.coord.x : p.x, y: p.coord ? p.coord.y : p.y }));
    for (const pt of pts) {
      if (!isPointInsidePolygonCoords(pt.x, pt.y, roiCoords)) {
        return false;
      }
    }
  }

  return true;
}

export function resetRoiState() {
  state.roiState = "IDLE";
  state.roiDragging = false;
  state.roiStart = null;
  state.roiEnd = null;
  document.body.classList.remove("roi-selecting");
  const selectROI = document.getElementById("selectROI");
  const roiHint = document.getElementById("roiHint");
  const roiMetrics = document.getElementById("roiMetrics");
  const mainRoiBtn = document.getElementById("mainRoiBtn");
  const optRoiRect = document.getElementById("optRoiRect");
  const optRoiPoly = document.getElementById("optRoiPoly");
  const optRoiKml = document.getElementById("optRoiKml");
  const btnLeftBoxRoi = document.getElementById("btnLeftBoxRoi");
  const btnLeftPolyRoi = document.getElementById("btnLeftPolyRoi");
  const btnLeftKmlRoi = document.getElementById("btnLeftKmlRoi");
  const roiSvg = document.getElementById("roiSvg");

  if (selectROI) selectROI.classList.remove("active");
  if (roiHint) roiHint.textContent = "Click 'Select ROI' to start drawing a rectangle.";
  if (roiMetrics) roiMetrics.classList.add("hidden");
  if (state.controls) state.controls.enabled = true;

  if (mainRoiBtn) {
    mainRoiBtn.classList.remove("active", "overlay-active");
  }
  [optRoiRect, optRoiPoly, optRoiKml, btnLeftBoxRoi, btnLeftPolyRoi, btnLeftKmlRoi].forEach(btn => btn?.classList.remove("active"));
  if (roiSvg) roiSvg.style.display = "none";
}
