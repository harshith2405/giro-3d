// src/tools/measure.js
// 3D Distance Measurement, Real-time Triangulation, SVG Line Overlays

import { state, setLiveGuidance } from "../core/state.js";
import { projectToScreen } from "../core/camera.js";
import { resetRoiState } from "./roiState.js";
import { clearAllLeftPanelState } from "../services/clearState.js";
import { updateProfileHoverSvg, clearProfilePinnedPoint } from "./profile.js";

/** Clear the current measurement overlay + points */
export function clearMeasure() {
  const measureSvg = document.getElementById("measureSvg");
  const measureSvgPolylineHalo = document.getElementById("measureSvgPolylineHalo");
  const measureSvgPolyline = document.getElementById("measureSvgPolyline");
  const measureSvgLineHalo = document.getElementById("measureSvgLineHalo");
  const measureSvgLine = document.getElementById("measureSvgLine");
  const elevationMiniContainer = document.getElementById("elevationMiniContainer");
  const compMetrics = document.getElementById("profileComparisonMetrics");

  if (measureSvg) measureSvg.style.display = "none";
  if (measureSvgPolylineHalo) measureSvgPolylineHalo.style.display = "none";
  if (measureSvgPolyline) measureSvgPolyline.style.display = "none";
  if (measureSvgLineHalo) measureSvgLineHalo.style.display = "none";
  if (measureSvgLine) measureSvgLine.style.display = "none";
  if (elevationMiniContainer) elevationMiniContainer.classList.add("hidden");
  if (compMetrics) compMetrics.classList.add("hidden");

  state.currentProfileComparisonData = null;

  if (state.miniChart && state.miniChart.data?.datasets?.length > 1) {
    state.miniChart.data.datasets.splice(1, 1);
    try { state.miniChart.update("none"); } catch (e) {}
  }
  if (state.fullChart && state.fullChart.data?.datasets?.length > 1) {
    state.fullChart.data.datasets.splice(1, 1);
    if (state.fullChart.options?.plugins) state.fullChart.options.plugins.legend = { display: false };
    try { state.fullChart.update("none"); } catch (e) {}
  }

  state.measureStartPoint = null;
  state.measureEndPoint = null;
  state.measureStartCoord = null;
  state.measureEndCoord = null;
  state.currentProfilePoints3D = [];

  clearProfilePinnedPoint();
}

/** Redraw the measurement line so it "sticks" to the terrain as the camera moves */
export function updateMeasureSvg() {
  const measureSvg = document.getElementById("measureSvg");
  const measureSvgStart = document.getElementById("measureSvgStart");
  const measureSvgEnd = document.getElementById("measureSvgEnd");
  const measureSvgPolylineHalo = document.getElementById("measureSvgPolylineHalo");
  const measureSvgPolyline = document.getElementById("measureSvgPolyline");
  const measureSvgLineHalo = document.getElementById("measureSvgLineHalo");
  const measureSvgLine = document.getElementById("measureSvgLine");

  if (state.isMultiSelectReports && state.measureMode === "PROFILE") {
    if (measureSvg) measureSvg.style.display = "none";
    return;
  }

  const canvas = state.instance?.domElement;
  if (!canvas) return;

  if (
    (state.measureMode === "SIMPLE" || state.measureMode === "PROFILE") &&
    state.measureStartPoint &&
    state.measureEndPoint
  ) {
    const cachedRect = canvas.getBoundingClientRect();
    const start = projectToScreen(state.measureStartPoint, cachedRect);
    const end = projectToScreen(state.measureEndPoint, cachedRect);

    // If both endpoints are behind the camera, hide overlay completely
    if ((start.isBehind && end.isBehind) || (start.z > 1 && end.z > 1)) {
      if (measureSvg) measureSvg.style.display = "none";
      return;
    }
    if (measureSvg) measureSvg.style.display = "block";

    // Update Start/End marker dots only if in front of the camera
    if (measureSvgStart) {
      if (start.isBehind || start.z > 1) {
        measureSvgStart.style.display = "none";
      } else {
        measureSvgStart.setAttribute("cx", start.x.toFixed(1));
        measureSvgStart.setAttribute("cy", start.y.toFixed(1));
        measureSvgStart.style.display = "block";
      }
    }

    if (measureSvgEnd) {
      if (end.isBehind || end.z > 1) {
        measureSvgEnd.style.display = "none";
      } else {
        measureSvgEnd.setAttribute("cx", end.x.toFixed(1));
        measureSvgEnd.setAttribute("cy", end.y.toFixed(1));
        measureSvgEnd.style.display = "block";
      }
    }

    // If finished profile with high-density draped terrain points, render smooth SVG polyline
    if (state.measureMode === "PROFILE" && state.currentProfilePoints3D.length >= 2) {
      let ptsStr = "";
      let visibleCount = 0;
      for (let i = 0; i < state.currentProfilePoints3D.length; i++) {
        const ptScreen = projectToScreen(state.currentProfilePoints3D[i], cachedRect);
        if (!ptScreen.isBehind && ptScreen.z <= 1) {
          ptsStr += `${ptScreen.x.toFixed(1)},${ptScreen.y.toFixed(1)} `;
          visibleCount++;
        }
      }
      if (visibleCount >= 2) {
        const cleanPts = ptsStr.trim();
        if (measureSvgPolylineHalo) {
          measureSvgPolylineHalo.setAttribute("points", cleanPts);
          measureSvgPolylineHalo.style.display = "block";
        }
        if (measureSvgPolyline) {
          measureSvgPolyline.setAttribute("points", cleanPts);
          measureSvgPolyline.style.display = "block";
        }
      } else {
        if (measureSvgPolylineHalo) measureSvgPolylineHalo.style.display = "none";
        if (measureSvgPolyline) measureSvgPolyline.style.display = "none";
      }
      if (measureSvgLineHalo) measureSvgLineHalo.style.display = "none";
      if (measureSvgLine) measureSvgLine.style.display = "none";
    } else {
      // Active dragging or simple distance measurement
      if (measureSvgPolylineHalo) measureSvgPolylineHalo.style.display = "none";
      if (measureSvgPolyline) measureSvgPolyline.style.display = "none";

      if (!start.isBehind && !end.isBehind && start.z <= 1 && end.z <= 1) {
        if (measureSvgLineHalo) {
          measureSvgLineHalo.style.display = "block";
          measureSvgLineHalo.setAttribute("x1", start.x.toFixed(1));
          measureSvgLineHalo.setAttribute("y1", start.y.toFixed(1));
          measureSvgLineHalo.setAttribute("x2", end.x.toFixed(1));
          measureSvgLineHalo.setAttribute("y2", end.y.toFixed(1));
        }
        if (measureSvgLine) {
          measureSvgLine.style.display = "block";
          measureSvgLine.setAttribute("x1", start.x.toFixed(1));
          measureSvgLine.setAttribute("y1", start.y.toFixed(1));
          measureSvgLine.setAttribute("x2", end.x.toFixed(1));
          measureSvgLine.setAttribute("y2", end.y.toFixed(1));
        }
      } else {
        if (measureSvgLineHalo) measureSvgLineHalo.style.display = "none";
        if (measureSvgLine) measureSvgLine.style.display = "none";
      }
    }
  } else if (measureSvg) {
    measureSvg.style.display = "none";
  }

  updateProfileHoverSvg();
}

/** Initialize Simple Measurement Tool DOM event bindings */
export function initMeasureUI() {
  const measureSimpleHeader = document.getElementById("measureSimpleHeader");
  const measureSimpleCarrot = document.getElementById("measureSimpleCarrot");
  const measureSimpleSettings = document.getElementById("measureSimpleSettings");
  const btnMeasureSimple = document.getElementById("btnMeasureSimple");
  const btnClearMeasureSimple = document.getElementById("btnClearMeasureSimple");
  const measureSimpleResults = document.getElementById("measureSimpleResults");
  const measureSimpleHoriz = document.getElementById("measureSimpleHoriz");
  const measureSimpleVert = document.getElementById("measureSimpleVert");
  const measureSimple3D = document.getElementById("measureSimple3D");
  const measureSimpleHint = document.getElementById("measureSimpleHint");

  measureSimpleHeader?.addEventListener("click", () => {
    if (!measureSimpleSettings) return;
    const show = measureSimpleSettings.style.display === "none";
    measureSimpleSettings.style.display = show ? "block" : "none";
    if (measureSimpleCarrot) measureSimpleCarrot.textContent = show ? "▲" : "▼";
  });

  btnMeasureSimple?.addEventListener("click", () => {
    resetRoiState();
    clearAllLeftPanelState(true);
    state.measureState = "SELECTING";
    state.measureMode = "SIMPLE";
    setLiveGuidance("📐", "Click start point on map, then drag or click end point to measure.");
    window.measureHasFirstTap = false;
    if (state.controls) state.controls.enabled = false;
    document.body.classList.add("roi-selecting");
    btnMeasureSimple.classList.add("active");
    btnMeasureSimple.textContent = "Click to start";
    if (measureSimpleHint) measureSimpleHint.textContent = "Click on the map to place the start point, then drag or tap.";
    if (btnClearMeasureSimple) btnClearMeasureSimple.disabled = false;
    if (measureSimpleResults) measureSimpleResults.classList.remove("hidden");
    clearMeasure();
    if (measureSimpleHoriz) measureSimpleHoriz.textContent = "0.00";
    if (measureSimpleVert) measureSimpleVert.textContent = "0.00";
    if (measureSimple3D) measureSimple3D.textContent = "0.00";
  });

  btnClearMeasureSimple?.addEventListener("click", () => {
    setLiveGuidance(null, null);
    state.measureState = "IDLE";
    state.measureMode = "NONE";
    if (state.controls) state.controls.enabled = true;
    document.body.classList.remove("roi-selecting");
    if (btnMeasureSimple) {
      btnMeasureSimple.classList.remove("active");
      btnMeasureSimple.textContent = "Measure Distance";
    }
    if (measureSimpleHint) measureSimpleHint.textContent = "Click 'Measure Distance' then click and drag on the map.";
    if (measureSimpleResults) measureSimpleResults.classList.add("hidden");
    clearMeasure();
    if (btnClearMeasureSimple) btnClearMeasureSimple.disabled = true;
  });

  // Attach to window for global access / inline onclick handlers
  window.clearMeasure = clearMeasure;
  window.updateMeasureSvg = updateMeasureSvg;
}
