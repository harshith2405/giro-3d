// src/tools/roi.js
// 2.5D Rectangular Bounding Box ROI & Arbitrary Polygon Terrain Clipping

import { Vector3, Vector2, Plane } from "three";
import proj4 from "proj4";
import Extent from "@giro3d/giro3d/core/geographic/Extent.js";
import Coordinates from "@giro3d/giro3d/core/geographic/Coordinates.js";
import { giroCrs } from "../config/crs.js";
import { state, updateStatus, setLiveGuidance } from "../core/state.js";
import { getActiveProjectConfig } from "../config/projects.js";
import { loadProject } from "../core/projectLoader.js";
import { projectToScreen, setCameraTopDown } from "../core/camera.js";
import { getDrapedPolygon3DPoints, pointsToString } from "./drapedMath.js";
import { resetRoiState, updateRoiWorkspaceBadge } from "./roiState.js";
import { showUnifiedInfoPanel, updateInfoPanelRenameTrigger } from "../ui/infoPanel.js";
import { showCustomAlert } from "../ui/dialogs.js";
import { API_BASE } from "../services/api.js";
import { getReportsFolder } from "../ui/roleGating.js";
import { fetchSavedRois } from "../services/savedRois.js";

const DEPTH_X = 22;
const DEPTH_Y = -18;

/** Draw 2.5D isometric extruded bounding box between two screen points */
export function drawRoiBox(x1, y1, x2, y2) {
  const roiSvg = document.getElementById("roiSvg");
  const roiFaceTop = document.getElementById("roiFaceTop");
  const roiFaceRight = document.getElementById("roiFaceRight");
  const roiFaceBottom = document.getElementById("roiFaceBottom");
  const roiDepthEdges = document.getElementById("roiDepthEdges");
  const roiCornerDots = document.getElementById("roiCornerDots");

  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  const width = right - left;
  const height = bottom - top;

  if (width < 3 || height < 3) {
    if (roiSvg) roiSvg.style.display = "none";
    return;
  }

  const tl = [left, top];
  const tr = [right, top];
  const br = [right, bottom];
  const bl = [left, bottom];

  const tlBack = [left + DEPTH_X, top + DEPTH_Y];
  const trBack = [right + DEPTH_X, top + DEPTH_Y];
  const brBack = [right + DEPTH_X, bottom + DEPTH_Y];

  if (roiFaceTop) {
    roiFaceTop.setAttribute("points", pointsToString([tl, tr, br, bl]));
    roiFaceTop.setAttribute("fill", "none");
  }
  if (roiFaceRight) {
    roiFaceRight.setAttribute("points", pointsToString([tr, trBack, brBack, br]));
    roiFaceRight.setAttribute("fill", "none");
  }
  if (roiFaceBottom) {
    roiFaceBottom.setAttribute("points", pointsToString([tl, tlBack, trBack, tr]));
    roiFaceBottom.setAttribute("fill", "none");
  }

  if (roiDepthEdges) {
    roiDepthEdges.innerHTML = [
      `<line x1="${tl[0]}" y1="${tl[1]}" x2="${tlBack[0]}" y2="${tlBack[1]}"/>`,
      `<line x1="${tr[0]}" y1="${tr[1]}" x2="${trBack[0]}" y2="${trBack[1]}"/>`,
      `<line x1="${br[0]}" y1="${br[1]}" x2="${brBack[0]}" y2="${brBack[1]}"/>`
    ].join("");
  }

  if (roiCornerDots) {
    roiCornerDots.innerHTML = [tl, tr, br, bl]
      .map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="4"/>`)
      .join("");
  }

  if (roiSvg) roiSvg.style.display = "block";
}

/** Update perimeter / area readout from world-space Box ROI coordinates */
export function updateRoiMetrics() {
  const roiMetrics = document.getElementById("roiMetrics");
  const roiPerimeter = document.getElementById("roiPerimeter");
  const roiArea = document.getElementById("roiArea");

  if (!state.roiStart || !state.roiEnd) return;
  const minX = Math.min(state.roiStart.x, state.roiEnd.x);
  const maxX = Math.max(state.roiStart.x, state.roiEnd.x);
  const minY = Math.min(state.roiStart.y, state.roiEnd.y);
  const maxY = Math.max(state.roiStart.y, state.roiEnd.y);
  const w = maxX - minX;
  const h = maxY - minY;
  const area = w * h;
  const perimeter = 2 * (w + h);
  if (area > 0) {
    if (roiMetrics) roiMetrics.classList.remove("hidden");
    if (roiPerimeter) roiPerimeter.textContent = perimeter.toFixed(1);
    if (roiArea) roiArea.textContent = area.toFixed(1);
  }
}

/** Redraw polygon ROI boundary overlay with draped perimeter points */
export function updateRoiPolySvg() {
  const roiPolySvg = document.getElementById("roiPolySvg");
  const roiPolyPolygonOverlay = document.getElementById("roiPolyPolygonOverlay");
  const roiPolyVerticesOverlay = document.getElementById("roiPolyVerticesOverlay");

  const canvas = state.instance?.domElement;
  if (!canvas) return;

  if (
    (state.measureMode === "ROI_POLY" || state.measureState === "FINISHED_ROI_POLY" || state.isTerrainClippedToRoi) &&
    state.roiPolyPoints.length > 0
  ) {
    const cachedRect = canvas.getBoundingClientRect();
    let pointsAttr = "";
    if (roiPolyVerticesOverlay) roiPolyVerticesOverlay.innerHTML = "";

    // Primary anchor dots on clicked vertices
    for (const p of state.roiPolyPoints) {
      const screenP = projectToScreen(p.point, cachedRect);
      if (!screenP.isBehind && screenP.z <= 1 && roiPolyVerticesOverlay) {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", screenP.x.toFixed(1));
        circle.setAttribute("cy", screenP.y.toFixed(1));
        circle.setAttribute("r", "4");
        circle.setAttribute("fill", "#ffff00");
        circle.setAttribute("stroke", "#000");
        circle.setAttribute("stroke-width", "1.5");
        roiPolyVerticesOverlay.appendChild(circle);
      }
    }

    const isClosed = (state.measureState === "FINISHED_ROI_POLY" || state.isTerrainClippedToRoi) && state.roiPolyPoints.length >= 3;
    const activePoints = (state.roiPolyMousePoint && state.measureState === "SELECTING")
      ? [...state.roiPolyPoints, { point: state.roiPolyMousePoint, coord: state.roiPolyMousePoint }]
      : state.roiPolyPoints;

    const drapedPts = getDrapedPolygon3DPoints(activePoints, isClosed);
    for (const pt of drapedPts) {
      const sp = projectToScreen(pt, cachedRect);
      if (!sp.isBehind && sp.z <= 1) {
        pointsAttr += `${sp.x.toFixed(1)},${sp.y.toFixed(1)} `;
      }
    }

    if (roiPolyPolygonOverlay) {
      roiPolyPolygonOverlay.setAttribute("points", pointsAttr.trim());
      roiPolyPolygonOverlay.setAttribute("fill", "none");
      roiPolyPolygonOverlay.style.fill = "none";
      roiPolyPolygonOverlay.style.display = "block";
    }
    if (roiPolyVerticesOverlay) roiPolyVerticesOverlay.style.display = "block";
    if (roiPolySvg) roiPolySvg.style.display = "block";
  } else {
    if (roiPolyPolygonOverlay) roiPolyPolygonOverlay.style.display = "none";
    if (roiPolyVerticesOverlay) roiPolyVerticesOverlay.style.display = "none";
    if (roiPolySvg) roiPolySvg.style.display = "none";
  }
}

/** Calculate 2D Area and Perimeter of Polygon ROI */
export function calculateRoiPolyMetrics() {
  const roiArea = document.getElementById("roiArea");
  const roiPerimeter = document.getElementById("roiPerimeter");
  const roiMetrics = document.getElementById("roiMetrics");

  if (state.roiPolyPoints.length < 3) return { area: 0, perimeter: 0 };
  let area = 0, perimeter = 0;
  for (let i = 0; i < state.roiPolyPoints.length; i++) {
    const p1 = state.roiPolyPoints[i].coord;
    const p2 = state.roiPolyPoints[(i + 1) % state.roiPolyPoints.length].coord;
    area += p1.x * p2.y - p2.x * p1.y;
    perimeter += Math.hypot(p2.x - p1.x, p2.y - p1.y);
  }
  area = Math.abs(area) / 2;
  if (roiArea) roiArea.textContent = area.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (roiPerimeter) roiPerimeter.textContent = perimeter.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (roiMetrics) roiMetrics.classList.remove("hidden");
  return { area, perimeter };
}

/** Clip Giro3D terrain to the exact Polygon ROI boundary using centered planes */
export function applyRoiPolyClipping() {
  if (state.roiPolyPoints.length < 3) return;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of state.roiPolyPoints) {
    if (p.coord.x < minX) minX = p.coord.x;
    if (p.coord.x > maxX) maxX = p.coord.x;
    if (p.coord.y < minY) minY = p.coord.y;
    if (p.coord.y > maxY) maxY = p.coord.y;
  }

  const clipExtent = new Extent(giroCrs, minX, maxX, minY, maxY);
  const clipProject = state.activeProject || getActiveProjectConfig();

  const numPoints = state.roiPolyPoints.length;
  let cx = 0, cy = 0;
  for (const p of state.roiPolyPoints) { cx += p.coord.x; cy += p.coord.y; }
  cx /= numPoints; cy /= numPoints;

  const dims = clipExtent.dimensions();
  const size = Math.max(dims.x, dims.y);
  const zOffset = clipProject?.zOffset || 0;

  if (state.instance?.view?.camera && state.controls) {
    state.instance.view.camera.position.set(cx, cy, zOffset + size * 2.4);
    state.controls.target.set(cx, cy, zOffset);
    state.controls.update();
    state.instance.view.camera.updateMatrixWorld(true);
    state.instance.notifyChange(state.instance.view.camera);
  }
  updateRoiPolySvg();

  updateStatus("Clipping Terrain to Polygon ROI...");

  loadProject(clipProject, clipExtent).then(() => {
    const map = state.map;
    if (!map) return;

    const pts2d = state.roiPolyPoints.map(p => ({ x: p.coord.x - cx, y: p.coord.y - cy }));

    let signedArea = 0;
    for (let i = 0; i < numPoints; i++) {
      const p1 = pts2d[i];
      const p2 = pts2d[(i + 1) % numPoints];
      signedArea += (p1.x * p2.y - p2.x * p1.y);
    }
    const isCCW = signedArea > 0;

    const planes = [];
    for (let i = 0; i < numPoints; i++) {
      const p1 = pts2d[i];
      const p2 = pts2d[(i + 1) % numPoints];

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;

      let nx = isCCW ? dy : -dy;
      let ny = isCCW ? -dx : dx;

      const length = Math.hypot(nx, ny);
      if (length === 0) continue;
      nx /= length;
      ny /= length;

      const normal = new Vector3(nx, ny, 0);
      const constant = -(nx * p1.x + ny * p1.y);
      planes.push(new Plane(normal, constant));
    }

    const mapCenter = map.worldToLocal(new Vector3(cx, cy, 0));
    for (const plane of planes) {
      plane.constant -= plane.normal.dot(mapCenter);
    }

    map.clippingPlanes = planes;
    state.isTerrainClippedToRoi = true;
    updateRoiWorkspaceBadge("Polygon ROI");

    updateRoiPolySvg();
    requestAnimationFrame(() => {
      if (state.instance?.view?.camera) state.instance.view.camera.updateMatrixWorld(true);
      updateRoiPolySvg();
    });

    const polyArea = Math.abs(signedArea) / 2;
    let polyPerim = 0;
    for (let i = 0; i < numPoints; i++) {
      const p1 = state.roiPolyPoints[i].coord;
      const p2 = state.roiPolyPoints[(i + 1) % numPoints].coord;
      polyPerim += Math.hypot(p2.x - p1.x, p2.y - p1.y);
    }

    const polyPerimEl = document.getElementById("polyRoiPerim");
    const polyAreaEl = document.getElementById("polyRoiArea");
    if (polyPerimEl) polyPerimEl.textContent = polyPerim.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " m";
    if (polyAreaEl) polyAreaEl.textContent = polyArea.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " m²";

    if (window.currentViewingFeature && (window.currentViewingFeature.type === "POLY_ROI" || window.currentViewingFeature.type === "ROI")) {
      showUnifiedInfoPanel("POLY_ROI", window.currentViewingFeature.name, window.currentViewingFeature.metadata || { points: state.roiPolyPoints, area: polyArea, perim: polyPerim }, true);
      updateInfoPanelRenameTrigger(window.currentViewingFeature.name);
    } else {
      showUnifiedInfoPanel("POLY_ROI", "POLYGON ROI ANALYSIS", { points: state.roiPolyPoints, area: polyArea, perim: polyPerim });
    }
  });
}

const ROI_ICONS = {
  RECT: `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line>`,
  POLY: `<polygon points="12 2 22 8.5 18 20 6 20 2 8.5 12 2"></polygon>`,
  KML: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line>`
};

let activeRoiMode = "RECT";
let kmlWorldPoints = [];

export function setActiveRoiSubMode(mode) {
  activeRoiMode = mode;
  const mainRoiIcon = document.getElementById("mainRoiIcon");
  if (mainRoiIcon && ROI_ICONS[mode]) {
    mainRoiIcon.innerHTML = ROI_ICONS[mode];
  }
}

export function highlightLeftRoiBtn(activeBtn) {
  const btnLeftBoxRoi = document.getElementById("btnLeftBoxRoi");
  const btnLeftPolyRoi = document.getElementById("btnLeftPolyRoi");
  const btnLeftKmlRoi = document.getElementById("btnLeftKmlRoi");
  [btnLeftBoxRoi, btnLeftPolyRoi, btnLeftKmlRoi].forEach(b => b?.classList.remove("active"));
  if (activeBtn) activeBtn.classList.add("active");
}

export function triggerRectRoi() {
  const mainRoiBtn = document.getElementById("mainRoiBtn");
  const selectROI = document.getElementById("selectROI");
  const optRoiRect = document.getElementById("optRoiRect");
  const resetROI = document.getElementById("resetROI");
  const roiHint = document.getElementById("roiHint");
  if (mainRoiBtn && mainRoiBtn.classList.contains("overlay-active") && state.roiState === "SELECTING") {
    resetRoiState();
    return;
  }
  resetRoiState();
  state.roiState = "SELECTING";
  state.measureState = "IDLE";
  if (state.controls) state.controls.enabled = false;
  document.body.classList.add("roi-selecting");
  if (mainRoiBtn) mainRoiBtn.classList.add("active", "overlay-active");
  if (optRoiRect) optRoiRect.classList.add("active");
  if (selectROI) selectROI.classList.add("active");
  if (roiHint) roiHint.textContent = "Click and drag on the terrain to draw a clipping rectangle.";
  if (resetROI) resetROI.disabled = false;
  setLiveGuidance("📐", "Click and drag over the map to draw a rectangular clipping box.");
}

export function startRoiPolyDrawing(e) {
  const mainRoiBtn = document.getElementById("mainRoiBtn");
  const btn = mainRoiBtn || (e ? e.currentTarget : null);
  if (btn && btn.classList.contains("active") && state.measureMode === "ROI_POLY") {
    resetRoiState();
    state.measureState = "IDLE";
    state.measureMode = "NONE";
    btn.classList.remove("active");
    document.body.classList.remove("roi-selecting");
    if (state.controls) state.controls.enabled = true;
    state.roiPolyPoints = [];
    updateRoiPolySvg();
    return;
  }
  resetRoiState();
  state.measureState = "SELECTING";
  state.measureMode = "ROI_POLY";
  if (state.controls) state.controls.enabled = false;
  document.body.classList.add("roi-selecting");
  state.roiPolyPoints = [];
  state.roiPolyMousePoint = null;
  updateRoiPolySvg();
  const roiMiniContainer = document.getElementById("roiMiniContainer");
  if (roiMiniContainer) roiMiniContainer.classList.add("hidden");
  if (btn) btn.classList.add("active");
  setLiveGuidance("✂️", "Click points on map to build clipping polygon. Double-click to clip terrain.");
}

export function updateKmlSvg() {
  const kmlSvg = document.getElementById("kmlSvg");
  const kmlLine = document.getElementById("kmlLine");
  if (!kmlWorldPoints.length) {
    if (kmlSvg) kmlSvg.style.display = "none";
    return;
  }
  if (!state.instance?.view?.camera) return;

  const testProj = kmlWorldPoints[0].clone().project(state.instance.view.camera);
  if (testProj.z > 1) {
    if (kmlSvg) kmlSvg.style.display = "none";
    return;
  }

  if (kmlSvg) kmlSvg.style.display = "block";
  const canvas = state.instance?.domElement;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();

  const screenPoints = kmlWorldPoints.map(wp => {
    const p = wp.clone().project(state.instance.view.camera);
    const sx = ((p.x + 1) / 2) * rect.width;
    const sy = ((-p.y + 1) / 2) * rect.height;
    return `${sx},${sy}`;
  });

  if (kmlLine) {
    kmlLine.setAttribute("d", "M " + screenPoints.join(" L ") + " Z");
  }
}

/** Initialize ROI User Interface & canvas interactions */
export function initRoiUI() {
  const canvas = state.instance?.domElement;
  const mainRoiBtn = document.getElementById("mainRoiBtn");
  const roiHorizontalBar = document.getElementById("roiHorizontalBar");
  const roiWrapper = document.getElementById("roiWrapper");
  const selectROI = document.getElementById("selectROI");
  const optRoiRect = document.getElementById("optRoiRect");
  const optRoiPoly = document.getElementById("optRoiPoly");
  const optRoiKml = document.getElementById("optRoiKml");
  const btnDrawPolyRoi = document.getElementById("btnDrawPolyRoi");
  const resetROI = document.getElementById("resetROI");
  const roiHint = document.getElementById("roiHint");
  const roiSvg = document.getElementById("roiSvg");
  const roiPolySvg = document.getElementById("roiPolySvg");

  const btnLeftBoxRoi = document.getElementById("btnLeftBoxRoi");
  const btnLeftPolyRoi = document.getElementById("btnLeftPolyRoi");
  const btnLeftKmlRoi = document.getElementById("btnLeftKmlRoi");
  const btnResetRoiLeft = document.getElementById("btnResetRoiLeft");
  const leftRoisHeader = document.getElementById("leftRoisHeader");
  const leftRoisContent = document.getElementById("leftRoisContent");
  const leftRoisCarrot = document.getElementById("leftRoisCarrot");

  const btnUploadKml = document.getElementById("btnUploadKml");
  const kmlUpload = document.getElementById("kmlUpload");

  const roiHeader = document.getElementById("roiHeader");
  const roiSettings = document.getElementById("roiSettings");
  const roiCarrot = document.getElementById("roiCarrot");

  const roiMiniContainer = document.getElementById("roiMiniContainer");
  const closeRoiMiniBtn = document.getElementById("closeRoiMiniBtn");
  const btnConfirmRoiSave = document.getElementById("btnConfirmRoiSave");
  const roiSaveName = document.getElementById("roiSaveName");

  // Top ROI Bar dropdown
  mainRoiBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (roiHorizontalBar) {
      const isOpen = roiHorizontalBar.classList.toggle("open");
      if (isOpen) {
        const unifiedInfoPanel = document.getElementById("unifiedInfoPanel");
        if (unifiedInfoPanel) unifiedInfoPanel.classList.add("hidden");
      }
    }
  });

  document.addEventListener("click", (e) => {
    if (roiWrapper && !roiWrapper.contains(e.target)) {
      roiHorizontalBar?.classList.remove("open");
    }
  });

  selectROI?.addEventListener("click", () => {
    setActiveRoiSubMode("RECT");
    triggerRectRoi();
  });

  optRoiRect?.addEventListener("click", (e) => {
    e.stopPropagation();
    roiHorizontalBar?.classList.remove("open");
    setActiveRoiSubMode("RECT");
    triggerRectRoi();
  });

  optRoiPoly?.addEventListener("click", (e) => {
    e.stopPropagation();
    roiHorizontalBar?.classList.remove("open");
    setActiveRoiSubMode("POLY");
    startRoiPolyDrawing(e);
  });

  optRoiKml?.addEventListener("click", (e) => {
    e.stopPropagation();
    roiHorizontalBar?.classList.remove("open");
    setActiveRoiSubMode("KML");
    document.getElementById("kmlUpload")?.click();
  });

  btnDrawPolyRoi?.addEventListener("click", (e) => {
    setActiveRoiSubMode("POLY");
    startRoiPolyDrawing(e);
  });

  document.getElementById("btnDrawFeatureRoi")?.addEventListener("click", (e) => startRoiPolyDrawing(e));

  // Left sidebar ROI buttons
  btnLeftBoxRoi?.addEventListener("click", () => {
    setActiveRoiSubMode("BOX");
    highlightLeftRoiBtn(btnLeftBoxRoi);
    triggerRectRoi();
  });

  btnLeftPolyRoi?.addEventListener("click", (e) => {
    setActiveRoiSubMode("POLY");
    highlightLeftRoiBtn(btnLeftPolyRoi);
    startRoiPolyDrawing(e);
  });

  btnLeftKmlRoi?.addEventListener("click", () => {
    setActiveRoiSubMode("KML");
    highlightLeftRoiBtn(btnLeftKmlRoi);
    document.getElementById("kmlUpload")?.click();
  });

  btnResetRoiLeft?.addEventListener("click", () => {
    highlightLeftRoiBtn(null);
    if (resetROI) resetROI.click();
    if (state.map) state.map.clippingPlanes = [];
  });

  leftRoisHeader?.addEventListener("click", () => {
    if (!leftRoisContent) return;
    const isHidden = leftRoisContent.style.display === "none";
    leftRoisContent.style.display = isHidden ? "block" : "none";
    if (leftRoisCarrot) leftRoisCarrot.textContent = isHidden ? "▼" : "▲";
  });

  roiHeader?.addEventListener("click", () => {
    if (!roiSettings) return;
    const show = roiSettings.style.display === "none";
    roiSettings.style.display = show ? "block" : "none";
    if (roiCarrot) roiCarrot.textContent = show ? "▼" : "▲";
  });

  // KML upload & rendering
  btnUploadKml?.addEventListener("click", () => {
    kmlUpload?.click();
  });

  kmlUpload?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target.result;
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, "text/xml");

      const coordsTags = xmlDoc.getElementsByTagName("coordinates");
      if (!coordsTags || coordsTags.length === 0) {
        await showCustomAlert("No coordinates found in KML file.", "KML Parse Error", "error");
        return;
      }

      let minX = Infinity, minY = Infinity;
      let maxX = -Infinity, maxY = -Infinity;
      let hasValidCoords = false;
      kmlWorldPoints = [];

      for (let i = 0; i < coordsTags.length; i++) {
        const coordsText = coordsTags[i].textContent.trim();
        if (!coordsText) continue;

        const points = coordsText.split(/\s+/);
        for (const pt of points) {
          const parts = pt.split(",");
          if (parts.length >= 2) {
            const lon = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            if (isNaN(lon) || isNaN(lat)) continue;

            const [x, y] = proj4("WGS84", "EPSG:3395", [lon, lat]);
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            hasValidCoords = true;
            kmlWorldPoints.push(new Vector3(x, y, state.activeProject?.zOffset || 0));
          }
        }
      }

      if (hasValidCoords) {
        resetRoiState();
        if (roiSvg) roiSvg.style.display = "none";
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const span = Math.max(maxX - minX, maxY - minY, 80);
        setCameraTopDown(cx, cy, span);

        updateKmlSvg();
        if (roiHint) roiHint.textContent = "KML loaded! Red boundary is now visible. Click 'Reset' to clear.";
        if (resetROI) resetROI.disabled = false;
      } else {
        await showCustomAlert("Could not parse coordinates from KML.", "KML Parse Error", "error");
      }
    };
    reader.readAsText(file);
    kmlUpload.value = "";
  });

  if (state.controls) {
    state.controls.addEventListener("change", updateKmlSvg);
  }

  // Mini ROI container close & save
  closeRoiMiniBtn?.addEventListener("click", () => {
    if (roiMiniContainer) roiMiniContainer.classList.add("hidden");
    state.roiPolyPoints = [];
    updateRoiPolySvg();
    state.measureMode = "IDLE";
    state.measureState = "IDLE";
    if (state.activeProject) loadProject(state.activeProject, null);
  });

  btnConfirmRoiSave?.addEventListener("click", async () => {
    const name = roiSaveName ? roiSaveName.value.trim() : "";
    if (!name) {
      await showCustomAlert("Please enter an ROI name.", "Name Required", "warning");
      return;
    }

    btnConfirmRoiSave.disabled = true;
    btnConfirmRoiSave.textContent = "Saving...";

    try {
      if (!state.activeProject) throw new Error("No active project");
      const metrics = calculateRoiPolyMetrics();
      const data = {
        name,
        isOfficial: !window.isDumpDraw,
        timestamp: new Date().toISOString(),
        area2D: metrics.area,
        perimeter: metrics.perimeter,
        points: state.roiPolyPoints.map(p => ({
          x: p.coord ? p.coord.x : p.x,
          y: p.coord ? p.coord.y : p.y,
          z: p.coord ? p.coord.z : (p.z || 0)
        }))
      };

      const jsonStr = JSON.stringify(data, null, 2);
      const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const fileName = `${safeName}_${Date.now()}.json`;

      const response = await fetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: state.activeProject.folderName,
          surveyId: state.activeProject.surveyId,
          type: "rois",
          fileName,
          folder: getReportsFolder()
        })
      });
      if (!response.ok) throw new Error("Failed to get upload URL");
      const { uploadUrl } = await response.json();

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: jsonStr
      });
      if (!putRes.ok) throw new Error("Failed to upload ROI data");

      if (roiMiniContainer) roiMiniContainer.classList.add("hidden");
      await showCustomAlert("ROI saved successfully!", "Saved", "success");
      fetchSavedRois();
    } catch (err) {
      console.error(err);
      await showCustomAlert("Error saving ROI: " + err.message, "Save Error", "error");
    } finally {
      btnConfirmRoiSave.disabled = false;
      btnConfirmRoiSave.textContent = "Save ROI";
    }
  });

  // Reset ROI
  resetROI?.addEventListener("click", () => {
    state.isTerrainClippedToRoi = false;
    if (state.map) state.map.clippingPlanes = [];
    resetRoiState();
    if (roiSvg) roiSvg.style.display = "none";
    if (roiPolySvg) roiPolySvg.style.display = "none";
    state.roiPolyPoints = [];
    if (state.measureMode === "ROI_POLY" || state.measureState === "FINISHED_ROI_POLY") {
      state.measureState = "IDLE";
      state.measureMode = "NONE";
    }
    updateRoiPolySvg();
    kmlWorldPoints = [];
    updateKmlSvg();

    loadProject(state.activeProject || getActiveProjectConfig(), null);
    if (resetROI) resetROI.disabled = true;
    if (roiHint) roiHint.textContent = "Click 'Select ROI' to crop the terrain.";
  });

  // Canvas selection drag handlers
  canvas?.addEventListener("mousedown", (e) => {
    if (state.roiState !== "SELECTING") return;
    const rect = canvas.getBoundingClientRect();
    const mouse = new Vector2(e.clientX - rect.left, e.clientY - rect.top);
    const picked = state.map?.pick(mouse);
    if (!picked || picked.length === 0) return;
    state.roiDragging = true;
    state.roiDragStartScreen = { x: e.clientX, y: e.clientY };
    state.roiStart = picked[0].coord.clone();
    state.roiEnd = state.roiStart.clone();
    drawRoiBox(e.clientX, e.clientY, e.clientX, e.clientY);
  });

  canvas?.addEventListener("mousemove", (e) => {
    if (state.roiState !== "SELECTING" || !state.roiDragging) return;
    const rect = canvas.getBoundingClientRect();
    const mouse = new Vector2(e.clientX - rect.left, e.clientY - rect.top);
    const picked = state.map?.pick(mouse);
    drawRoiBox(state.roiDragStartScreen.x, state.roiDragStartScreen.y, e.clientX, e.clientY);
    if (picked && picked.length > 0) {
      state.roiEnd = picked[0].coord.clone();
      updateRoiMetrics();
    }
  });

  canvas?.addEventListener("mouseup", () => {
    if (state.roiState !== "SELECTING" || !state.roiDragging) return;
    state.roiDragging = false;
    if (roiSvg) roiSvg.style.display = "none";
    if (!state.roiStart || !state.roiEnd) {
      resetRoiState();
      return;
    }
    const minX = Math.min(state.roiStart.x, state.roiEnd.x);
    const maxX = Math.max(state.roiStart.x, state.roiEnd.x);
    const minY = Math.min(state.roiStart.y, state.roiEnd.y);
    const maxY = Math.max(state.roiStart.y, state.roiEnd.y);
    if (Math.abs(maxX - minX) < 1 || Math.abs(maxY - minY) < 1) {
      resetRoiState();
      return;
    }

    const clipExtent = new Extent(giroCrs, minX, maxX, minY, maxY);
    const clipProject = getActiveProjectConfig();
    state.isTerrainClippedToRoi = true;

    const center = clipExtent.centerAsVector3();
    const dims = clipExtent.dimensions();
    const size = Math.max(dims.x, dims.y);
    const zOffset = clipProject?.zOffset || 0;
    if (state.instance?.view?.camera && state.controls) {
      state.instance.view.camera.position.set(center.x, center.y, zOffset + size * 2.4);
      state.controls.target.set(center.x, center.y, zOffset);
      state.controls.update();
      state.instance.view.camera.updateMatrixWorld(true);
      state.instance.notifyChange(state.instance.view.camera);
    }

    loadProject(clipProject, clipExtent);
    updateRoiWorkspaceBadge("Box ROI");

    state.roiState = "IDLE";
    document.body.classList.remove("roi-selecting");
    if (mainRoiBtn) mainRoiBtn.classList.remove("active");
    if (selectROI) selectROI.classList.remove("active");
    if (state.controls) state.controls.enabled = true;
    if (resetROI) resetROI.disabled = false;
    if (roiHint) roiHint.textContent = "Terrain clipped! Click 'Reset' to restore the full view.";

    const boxW = Math.abs(maxX - minX);
    const boxH = Math.abs(maxY - minY);
    const boxArea = boxW * boxH;
    const boxPerim = 2 * (boxW + boxH);

    window._lastBoxRoiBounds = { minX, maxX, minY, maxY };
    window._lastBoxRoiArea = boxArea;
    window._lastBoxRoiPerim = boxPerim;

    const boxPerimEl = document.getElementById("boxRoiPerim");
    const boxAreaEl = document.getElementById("boxRoiArea");
    if (boxPerimEl) boxPerimEl.textContent = boxPerim.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " m";
    if (boxAreaEl) boxAreaEl.textContent = boxArea.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " m²";

    showUnifiedInfoPanel("BOX_ROI", "BOX ROI ANALYSIS", {
      minX, maxX, minY, maxY,
      bounds: { minX, maxX, minY, maxY },
      area: boxArea,
      perim: boxPerim,
      area2D: boxArea,
      perimeter: boxPerim
    });
  });

  // Attach to window
  window.drawRoiBox = drawRoiBox;
  window.updateRoiPolySvg = updateRoiPolySvg;
  window.applyRoiPolyClipping = applyRoiPolyClipping;
  window.updateKmlSvg = updateKmlSvg;
  window.setActiveRoiSubMode = setActiveRoiSubMode;
  window.triggerRectRoi = triggerRectRoi;
  window.startRoiPolyDrawing = startRoiPolyDrawing;
}
