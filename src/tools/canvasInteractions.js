// src/tools/canvasInteractions.js
// Canvas Mouse/Pointer Handlers, Global Keyboard Shortcuts, Navigation & Toolbar Sync

import { Vector2, Vector3 } from "three";
import proj4 from "proj4";
import { state, setLiveGuidance } from "../core/state.js";
import { projectToScreen } from "../core/camera.js";
import { showUnifiedInfoPanel } from "../ui/infoPanel.js";
import { showCustomAlert } from "../ui/dialogs.js";
import { resetRoiState } from "./roiState.js";
import { clearMeasure, updateMeasureSvg } from "./measure.js";
import { updateProfileHoverSvg, updateProfilePinnedSvg, updateElevationProfile } from "./profile.js";
import { updateVolumeSvg, calculateVolumeMetrics } from "./volume.js";
import { updateRoiPolySvg, calculateRoiPolyMetrics, applyRoiPolyClipping } from "./roi.js";
import { updateMultiOverlaySvg } from "./multiOverlay.js";
import { renderElevations } from "./elevationsGrid.js";
import { setHeatmapMode } from "./slopeHeatmap.js";
import { regenerateContours } from "./contours.js";
import { loadProject } from "../core/projectLoader.js";

let measureDragScreenStart = null;
let isCtrlPanActive = false;

// Arrow key velocity state for smooth keyboard camera navigation
const arrowKeysPressed = {
  ArrowUp: false,
  ArrowDown: false,
  ArrowLeft: false,
  ArrowRight: false
};
let camVelocityX = 0;
let camVelocityY = 0;
let animFrameId = null;

/** Redraw point marker SVG on screen */
export function updatePointSvg() {
  const pointSvg = document.getElementById("pointSvg");
  const pointSvgMarker = document.getElementById("pointSvgMarker");
  if (!pointSvg || !pointSvgMarker) return;

  if (
    (state.measureMode === "POINT" || state.measureState === "FINISHED_POINT") &&
    state.pointDrawPoint
  ) {
    const p = projectToScreen(state.pointDrawPoint);
    if (p.isBehind || p.z > 1) {
      pointSvg.style.display = "none";
      return;
    }
    pointSvgMarker.setAttribute("cx", p.x.toFixed(1));
    pointSvgMarker.setAttribute("cy", p.y.toFixed(1));
    pointSvg.style.display = "block";
  } else {
    pointSvg.style.display = "none";
  }
}

function startSmoothCamLoop() {
  if (animFrameId) return;

  function updateCamVelocity() {
    const controls = state.controls;
    const map = state.map;
    const instance = state.instance;

    if (!controls || !map || !instance) {
      animFrameId = null;
      return;
    }

    const cameraObj = controls.object || instance.view?.camera;
    if (!cameraObj || !controls.target) {
      animFrameId = null;
      return;
    }

    const isAnyKeyPressed = Object.values(arrowKeysPressed).some(Boolean);

    let targetVelX = 0;
    let targetVelY = 0;

    if (isAnyKeyPressed) {
      const dist = cameraObj.position.distanceTo(controls.target);
      const maxSpeed = Math.max(0.05, Math.min(6, dist * 0.0006));
      const azimuth = controls.getAzimuthalAngle ? controls.getAzimuthalAngle() : 0;
      const sinAz = Math.sin(azimuth);
      const cosAz = Math.cos(azimuth);

      if (arrowKeysPressed.ArrowUp) {
        targetVelX += -maxSpeed * sinAz;
        targetVelY += maxSpeed * cosAz;
      }
      if (arrowKeysPressed.ArrowDown) {
        targetVelX += maxSpeed * sinAz;
        targetVelY += -maxSpeed * cosAz;
      }
      if (arrowKeysPressed.ArrowLeft) {
        targetVelX += -maxSpeed * cosAz;
        targetVelY += -maxSpeed * sinAz;
      }
      if (arrowKeysPressed.ArrowRight) {
        targetVelX += maxSpeed * cosAz;
        targetVelY += maxSpeed * sinAz;
      }
    }

    const lerpFactor = 0.05;
    camVelocityX += (targetVelX - camVelocityX) * lerpFactor;
    camVelocityY += (targetVelY - camVelocityY) * lerpFactor;

    const currentSpeedSq = camVelocityX * camVelocityX + camVelocityY * camVelocityY;

    if (currentSpeedSq > 0.0001) {
      controls.target.x += camVelocityX;
      controls.target.y += camVelocityY;
      cameraObj.position.x += camVelocityX;
      cameraObj.position.y += camVelocityY;

      controls.update();
      instance.notifyChange();

      animFrameId = requestAnimationFrame(updateCamVelocity);
    } else {
      camVelocityX = 0;
      camVelocityY = 0;
      animFrameId = null;
    }
  }

  animFrameId = requestAnimationFrame(updateCamVelocity);
}

/** Initialize Canvas mouse, touch, wheel and global keyboard shortcuts */
export function initCanvasInteractions() {
  const canvas = state.instance?.domElement;
  if (!canvas) return;

  const btnMeasureSimple = document.getElementById("btnMeasureSimple");
  const btnClearMeasureSimple = document.getElementById("btnClearMeasureSimple");
  const measureSimpleHint = document.getElementById("measureSimpleHint");
  const measureSimpleHoriz = document.getElementById("measureSimpleHoriz");
  const measureSimpleVert = document.getElementById("measureSimpleVert");
  const measureSimple3D = document.getElementById("measureSimple3D");

  const btnProfile = document.getElementById("btnProfile");
  const btnClearProfile = document.getElementById("btnClearProfile");
  const profileHint = document.getElementById("profileHint");
  const profileHoriz = document.getElementById("profileHoriz");
  const profileVert = document.getElementById("profileVert");
  const profile3D = document.getElementById("profile3D");

  const btnDrawVolume = document.getElementById("btnDrawVolume");
  const btnDrawVolumeText = document.getElementById("btnDrawVolumeText");
  const btnFinishVolume = document.getElementById("btnFinishVolume");
  const btnClearVolume = document.getElementById("btnClearVolume");
  const volumeHint = document.getElementById("volumeHint");

  const btnDrawPolyRoi = document.getElementById("btnDrawPolyRoi");
  const roiMiniContainer = document.getElementById("roiMiniContainer");

  // Controls change bindings to re-project SVG HUD elements at 60fps
  if (state.controls) {
    state.controls.addEventListener("change", updateMeasureSvg);
    state.controls.addEventListener("change", updateProfileHoverSvg);
    state.controls.addEventListener("change", updateProfilePinnedSvg);
    state.controls.addEventListener("change", updateVolumeSvg);
    state.controls.addEventListener("change", updateRoiPolySvg);
    state.controls.addEventListener("change", updateMultiOverlaySvg);
    state.controls.addEventListener("change", updatePointSvg);
    state.controls.addEventListener("change", () => {
      if (state.isGridOverlayActive) renderElevations();
    });
  }

  // Double click handler
  canvas.addEventListener("dblclick", () => {
    if (state.measureState === "SELECTING" && state.measureMode === "VOLUME") {
      if (btnFinishVolume) btnFinishVolume.click();
    }
    if (state.measureState === "SELECTING" && state.measureMode === "ROI_POLY") {
      if (state.roiPolyPoints.length < 3) {
        showCustomAlert("Please draw at least 3 points for a polygon ROI.", "Incomplete ROI", "warning");
        return;
      }
      state.measureState = "FINISHED_ROI_POLY";
      if (state.controls) state.controls.enabled = true;
      document.body.classList.remove("roi-selecting");
      if (btnDrawPolyRoi) btnDrawPolyRoi.classList.remove("active");
      const featRoiBtn = document.getElementById("btnDrawFeatureRoi");
      if (featRoiBtn) featRoiBtn.classList.remove("active");
      state.roiPolyMousePoint = null;
      updateRoiPolySvg();
      calculateRoiPolyMetrics();
      applyRoiPolyClipping();
      if (roiMiniContainer) roiMiniContainer.classList.remove("hidden");
    }
  });

  // Mousedown handler
  canvas.addEventListener("mousedown", (e) => {
    if (e.ctrlKey || isCtrlPanActive) return;

    if (state.measureMode === "POINT" && state.measureState === "SELECTING_POINT") {
      const rect = canvas.getBoundingClientRect();
      const mouse = new Vector2(e.clientX - rect.left, e.clientY - rect.top);
      const picked = state.map?.pick(mouse);
      if (picked && picked.length > 0) {
        state.pointDrawPoint = picked[0].point.clone();
        state.pointDrawCoord = picked[0].coord.clone();
        state.measureState = "FINISHED_POINT";
        if (state.controls) state.controls.enabled = true;
        document.body.classList.remove("roi-selecting");

        const pCoord = state.pointDrawCoord.as(proj4("EPSG:4326"));
        const lon = pCoord.x.toFixed(6) + "°";
        const lat = pCoord.y.toFixed(6) + "°";
        const elev = state.pointDrawPoint.z.toFixed(2) + " m";

        const ptLonEl = document.getElementById("pointMiniLon");
        const ptLatEl = document.getElementById("pointMiniLat");
        const ptElevEl = document.getElementById("pointMiniElev");
        if (ptLonEl) ptLonEl.textContent = lon;
        if (ptLatEl) ptLatEl.textContent = lat;
        if (ptElevEl) ptElevEl.textContent = elev;

        showUnifiedInfoPanel("POINT", "SAVE POINT", { lon: pCoord.x, lat: pCoord.y, z: state.pointDrawPoint.z, point: state.pointDrawPoint });
        updatePointSvg();
      }
      return;
    }

    if (state.measureState === "SELECTING") {
      const rect = canvas.getBoundingClientRect();
      const mouse = new Vector2(e.clientX - rect.left, e.clientY - rect.top);
      measureDragScreenStart = { x: e.clientX, y: e.clientY };
      const picked = state.map?.pick(mouse);
      if (picked && picked.length > 0) {
        if (state.measureMode === "ROI_POLY") {
          state.roiPolyPoints.push({ point: picked[0].point.clone(), coord: picked[0].coord.clone() });
          setLiveGuidance("✂️", `Polygon ROI: ${state.roiPolyPoints.length} Points Placed — Double-click to finish clipping`);
          updateRoiPolySvg();
          return;
        }
        if (state.measureMode === "VOLUME") {
          state.volumePoints.push({
            point: picked[0].point.clone(),
            coord: picked[0].coord.clone()
          });
          measureDragScreenStart = null;
          setLiveGuidance("📦", `Volume Drawing: ${state.volumePoints.length} Points Placed — Click map for next point, or Finish`);
          updateVolumeSvg();
          return;
        }

        if (!state.measureStartPoint) {
          state.measureStartPoint = picked[0].point.clone();
          state.measureStartCoord = picked[0].coord.clone();
          state.measureEndPoint = state.measureStartPoint.clone();
          state.measureEndCoord = state.measureStartCoord.clone();
          updateMeasureSvg();

          if (state.measureMode === "SIMPLE" && measureSimpleHint) {
            measureSimpleHint.textContent = "Drag to measure, or tap again to set the end point.";
          } else if (state.measureMode === "PROFILE" && profileHint) {
            profileHint.textContent = "Drag to measure, or tap again to set the end point.";
          }
        } else {
          state.measureEndPoint = picked[0].point.clone();
          state.measureEndCoord = picked[0].coord.clone();
          updateMeasureSvg();
        }
      }
    }
  });

  // Mousemove handler
  canvas.addEventListener("mousemove", (e) => {
    if (state.measureState === "SELECTING") {
      const rect = canvas.getBoundingClientRect();
      const mouse = new Vector2(e.clientX - rect.left, e.clientY - rect.top);
      const picked = state.map?.pick(mouse);

      if (picked && picked.length > 0) {
        if (state.measureMode === "VOLUME") {
          state.volumeMousePoint = picked[0].point.clone();
          updateVolumeSvg();
          return;
        }
        if (state.measureMode === "ROI_POLY") {
          state.roiPolyMousePoint = picked[0].point.clone();
          updateRoiPolySvg();
          return;
        }

        if (state.measureStartPoint) {
          state.measureEndPoint = picked[0].point.clone();
          state.measureEndCoord = picked[0].coord.clone();
          updateMeasureSvg();

          const dx = state.measureEndCoord.x - state.measureStartCoord.x;
          const dy = state.measureEndCoord.y - state.measureStartCoord.y;
          const dz = state.measureEndCoord.z - state.measureStartCoord.z;
          const horizontal = Math.sqrt(dx * dx + dy * dy);
          const vertical = Math.abs(dz);
          const distance3D = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (state.measureMode === "SIMPLE") {
            if (measureSimpleHoriz) measureSimpleHoriz.textContent = horizontal.toFixed(2);
            if (measureSimpleVert) measureSimpleVert.textContent = vertical.toFixed(2);
            if (measureSimple3D) measureSimple3D.textContent = distance3D.toFixed(2);
          } else if (state.measureMode === "PROFILE") {
            if (profileHoriz) profileHoriz.textContent = horizontal.toFixed(2);
            if (profileVert) profileVert.textContent = vertical.toFixed(2);
            if (profile3D) profile3D.textContent = distance3D.toFixed(2);
            updateElevationProfile(true);
          }
        }
      }
    }
  });

  // Mouseup handler
  canvas.addEventListener("mouseup", (e) => {
    if (state.measureState === "SELECTING" && state.measureStartPoint && measureDragScreenStart) {
      const dx = e.clientX - measureDragScreenStart.x;
      const dy = e.clientY - measureDragScreenStart.y;
      const dragDist = Math.sqrt(dx * dx + dy * dy);

      if (dragDist > 5) {
        state.measureState = "FINISHED";
        if (state.controls) state.controls.enabled = true;
        document.body.classList.remove("roi-selecting");

        if (state.measureMode === "SIMPLE") {
          if (btnMeasureSimple) {
            btnMeasureSimple.classList.remove("active");
            btnMeasureSimple.textContent = "Measure Distance";
          }
          if (measureSimpleHint) {
            measureSimpleHint.textContent = "Measurement complete. Rotate the map to see the line stick! Click 'Clear' to remove.";
          }
        } else if (state.measureMode === "PROFILE") {
          if (btnProfile) {
            btnProfile.classList.remove("active");
            btnProfile.textContent = "Draw Path Profile";
          }
          const ibmStartText = document.getElementById("btnIbmStartProfileText");
          if (ibmStartText && state.isIbmProfileComparison) ibmStartText.textContent = "Click 2 Points on Map";
          if (profileHint) {
            profileHint.textContent = "Path Profile complete. Rotate the map to see the line stick! Click 'Clear' to remove.";
          }
          updateElevationProfile();
        }
      } else {
        if (!window.measureHasFirstTap) {
          window.measureHasFirstTap = true;
          if (state.measureMode === "SIMPLE" && measureSimpleHint) {
            measureSimpleHint.textContent = "First point set. Tap elsewhere to set the second point.";
          } else if (state.measureMode === "PROFILE" && profileHint) {
            profileHint.textContent = "First point set. Tap elsewhere to set the second point.";
          }
        } else {
          state.measureState = "FINISHED";
          if (state.controls) state.controls.enabled = true;
          document.body.classList.remove("roi-selecting");

          if (state.measureMode === "SIMPLE") {
            if (btnMeasureSimple) {
              btnMeasureSimple.classList.remove("active");
              btnMeasureSimple.textContent = "Measure Distance";
            }
            if (measureSimpleHint) {
              measureSimpleHint.textContent = "Measurement complete. Rotate the map to see the line stick! Click 'Clear' to remove.";
            }
          } else if (state.measureMode === "PROFILE") {
            if (btnProfile) {
              btnProfile.classList.remove("active");
              btnProfile.textContent = "Draw Path Profile";
            }
            const ibmStartText = document.getElementById("btnIbmStartProfileText");
            if (ibmStartText && state.isIbmProfileComparison) ibmStartText.textContent = "Click 2 Points on Map";
            if (profileHint) {
              profileHint.textContent = "Path Profile complete. Rotate the map to see the line stick! Click 'Clear' to remove.";
            }
            updateElevationProfile();
          }
        }
      }
    }
  });

  // Wheel zoom interceptor during drawing modes
  canvas.addEventListener("wheel", (e) => {
    if (state.controls && !state.controls.enabled) {
      e.preventDefault();
      e.stopPropagation();

      const zoomFactor = e.deltaY < 0 ? 0.88 : 1.14;
      const camera = state.instance?.view?.camera;
      if (camera && state.controls.target) {
        const offset = camera.position.clone().sub(state.controls.target);
        offset.multiplyScalar(zoomFactor);
        const dist = offset.length();
        if (dist >= (state.controls.minDistance || 20) && dist <= (state.controls.maxDistance || 150000)) {
          camera.position.copy(state.controls.target).add(offset);
          state.controls.update();
        }
      }

      if (state.instance?.view?.camera) state.instance.view.camera.updateMatrixWorld(true);
      state.instance.notifyChange();

      if (state.measureState === "SELECTING" && state.map) {
        const rect = canvas.getBoundingClientRect();
        const mouse = new Vector2(e.clientX - rect.left, e.clientY - rect.top);
        const picked = state.map.pick(mouse);
        if (picked && picked.length > 0) {
          if (state.measureMode === "VOLUME") state.volumeMousePoint = picked[0].point.clone();
          if (state.measureMode === "ROI_POLY") state.roiPolyMousePoint = picked[0].point.clone();
        }
      }

      updateVolumeSvg();
      updateRoiPolySvg();
      updateMeasureSvg();
      updatePointSvg();
    }
  }, { passive: false });

  // Global Keyboard Shortcuts (ESC, Arrow keys, CTRL pan)
  window.addEventListener("keydown", (e) => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.tagName === "SELECT")) {
      return;
    }

    if ((e.key === "Control" || e.ctrlKey) && !isCtrlPanActive) {
      if (state.measureState === "SELECTING" || state.roiState === "SELECTING") {
        isCtrlPanActive = true;
        if (state.controls) state.controls.enabled = true;
        document.body.classList.remove("roi-selecting");
        setLiveGuidance("🗺️", "CTRL Held: Drag mouse to pan/rotate map • Release CTRL to resume drawing");
      }
    }

    // ESC Key Reset Handler
    if (e.key === "Escape") {
      e.preventDefault();

      state.measureState = "IDLE";
      state.measureMode = "NONE";
      if (state.controls) state.controls.enabled = true;
      document.body.classList.remove("roi-selecting");

      [btnMeasureSimple, btnProfile, btnDrawVolume, btnDrawPolyRoi].forEach(b => b?.classList.remove("active"));
      if (btnDrawVolumeText) btnDrawVolumeText.textContent = "Draw Area";
      if (btnClearMeasureSimple) btnClearMeasureSimple.disabled = true;
      if (btnClearProfile) btnClearProfile.disabled = true;
      if (btnClearVolume) btnClearVolume.disabled = true;
      if (btnFinishVolume) btnFinishVolume.classList.add("hidden");

      clearMeasure();
      state.volumePoints = [];
      state.volumeMousePoint = null;
      updateVolumeSvg();
      state.roiPolyPoints = [];
      state.roiPolyMousePoint = null;
      updateRoiPolySvg();

      state.pointDrawPoint = null;
      state.pointDrawCoord = null;
      const pointSvg = document.getElementById("pointSvg");
      if (pointSvg) pointSvg.style.display = "none";
      if (state.map) state.map.clippingPlanes = [];

      document.querySelectorAll("#reportsList .saved-report-item, #volumesList .saved-report-item, .saved-report-item").forEach(el => el.classList.remove("selected-item"));

      state.multiSelectedReportsMap.clear();
      state.multiSelectedVolumesMap.clear();
      state.isMultiSelectReports = false;
      state.isMultiSelectVolumes = false;
      const toggleReportsEl = document.getElementById("toggleViewAllReports");
      const toggleVolumesEl = document.getElementById("toggleViewAllVolumes");
      if (toggleReportsEl) toggleReportsEl.checked = false;
      if (toggleVolumesEl) toggleVolumesEl.checked = false;
      state.activeFocusedFeatureId = null;
      updateMultiOverlaySvg();

      const unifiedInfoPanel = document.getElementById("unifiedInfoPanel");
      if (unifiedInfoPanel) unifiedInfoPanel.classList.add("hidden");
      const universalSaveModal = document.getElementById("universalSaveModal");
      if (universalSaveModal) universalSaveModal.classList.add("hidden");
      const elevationModal = document.getElementById("elevationModal");
      if (elevationModal) elevationModal.classList.add("hidden");

      setLiveGuidance(null, null);
      return;
    }

    if (e.key in arrowKeysPressed) {
      e.preventDefault();
      arrowKeysPressed[e.key] = true;
      startSmoothCamLoop();
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.key in arrowKeysPressed) {
      arrowKeysPressed[e.key] = false;
    }
    if (e.key === "Control" || !e.ctrlKey) {
      if (isCtrlPanActive) {
        isCtrlPanActive = false;
        if (state.measureState === "SELECTING" || state.roiState === "SELECTING") {
          if (state.controls) state.controls.enabled = false;
          document.body.classList.add("roi-selecting");

          if (state.measureMode === "VOLUME") {
            setLiveGuidance("📦", `Volume Drawing: ${state.volumePoints.length} Points Placed — Click map for next point, or Finish`);
          } else if (state.measureMode === "PROFILE") {
            setLiveGuidance("📏", "Click on the map to place start point, then drag or tap end point.");
          } else if (state.measureMode === "ROI_POLY") {
            setLiveGuidance("✂️", `Polygon ROI: ${state.roiPolyPoints.length} Points Placed — Double-click to finish clipping`);
          } else if (state.roiState === "SELECTING") {
            setLiveGuidance("📐", "Click and drag over the map to draw a rectangular clipping box.");
          } else if (state.measureMode === "SIMPLE") {
            setLiveGuidance("📐", "Click start point on map, then drag or click end point to measure.");
          }
        }
      }
    }
  });

  // Orthophoto Toggle Button
  const btnToggleOrtho = document.getElementById("btnToggleOrtho");
  btnToggleOrtho?.addEventListener("click", () => {
    if (state.orthoLayer) {
      if (btnToggleOrtho.classList.contains("active")) {
        btnToggleOrtho.classList.remove("active");
        state.orthoLayer.opacity = 0;
        state.orthoLayer.visible = false;
      } else {
        btnToggleOrtho.classList.add("active");
        state.orthoLayer.opacity = 1;
        state.orthoLayer.visible = true;
      }
      state.instance.notifyChange();
    }
  });

  // Reset Map Button
  const btnResetMap = document.getElementById("btnResetMap");
  btnResetMap?.addEventListener("click", () => {
    state.isTerrainClippedToRoi = false;
    if (state.map) state.map.clippingPlanes = [];

    resetRoiState();
    const roiSvg = document.getElementById("roiSvg");
    if (roiSvg) roiSvg.style.display = "none";
    const roiPolySvg = document.getElementById("roiPolySvg");
    if (roiPolySvg) roiPolySvg.style.display = "none";
    const roiPolyPolygonOverlay = document.getElementById("roiPolyPolygonOverlay");
    if (roiPolyPolygonOverlay) roiPolyPolygonOverlay.style.display = "none";
    const roiPolyVerticesOverlay = document.getElementById("roiPolyVerticesOverlay");
    if (roiPolyVerticesOverlay) roiPolyVerticesOverlay.innerHTML = "";
    state.roiPolyPoints = [];
    updateRoiPolySvg();

    state.kmlWorldPoints = [];
    clearMeasure();

    if (state.activeProject) {
      loadProject(state.activeProject, null);
    }
  });

  // Right Toolbar Overlay Toggles (Grid, Heatmap, Contours)
  const btnRightGrid = document.getElementById("btnRightGrid");
  const btnRightHeatmap = document.getElementById("btnRightHeatmap");
  const btnRightContour = document.getElementById("btnRightContour");
  const unifiedInfoPanel = document.getElementById("unifiedInfoPanel");

  btnRightGrid?.addEventListener("click", () => {
    if (state.isGridOverlayActive) {
      state.isGridOverlayActive = false;
      btnRightGrid.classList.remove("overlay-active");
      const btnDisableElevations = document.getElementById("btnDisableElevations");
      if (btnDisableElevations && !btnDisableElevations.disabled) btnDisableElevations.click();
      if (unifiedInfoPanel) unifiedInfoPanel.classList.add("hidden");
    } else {
      showUnifiedInfoPanel("GRID", "ELEVATIONS GRID", null, false);
      const origSpacing = document.getElementById("elevationsSpacing");
      const infoSpacing = document.getElementById("infoElevationsSpacing");
      const infoSpacingVal = document.getElementById("infoElevationsSpacingVal");
      if (origSpacing && infoSpacing) {
        infoSpacing.value = origSpacing.value;
        if (infoSpacingVal) infoSpacingVal.textContent = origSpacing.value + "m";
      }
    }
  });

  btnRightHeatmap?.addEventListener("click", () => {
    if (state.isHeatmapOverlayActive) {
      state.isHeatmapOverlayActive = false;
      btnRightHeatmap.classList.remove("overlay-active");
      const btnDisableHeatmap = document.getElementById("btnDisableHeatmap");
      if (btnDisableHeatmap && !btnDisableHeatmap.disabled) btnDisableHeatmap.click();
      if (unifiedInfoPanel) unifiedInfoPanel.classList.add("hidden");
    } else {
      showUnifiedInfoPanel("HEATMAP", "SLOPE HEATMAP", null, false);
      document.getElementById("infoHeatmapExportCard")?.classList.toggle("hidden", !state.isHeatmapOverlayActive);
      const origOpacity = document.getElementById("heatmapOpacity");
      const infoOpacity = document.getElementById("infoHeatmapOpacity");
      const infoOpacityVal = document.getElementById("infoHeatmapOpacityVal");
      if (origOpacity && infoOpacity) {
        infoOpacity.value = origOpacity.value;
        if (infoOpacityVal) infoOpacityVal.textContent = Math.round(parseFloat(origOpacity.value) * 100) + "%";
      }
    }
  });

  btnRightContour?.addEventListener("click", () => {
    if (state.isContourOverlayActive) {
      state.isContourOverlayActive = false;
      btnRightContour.classList.remove("overlay-active");
      const btnDisableContours = document.getElementById("btnDisableContours");
      if (btnDisableContours && !btnDisableContours.disabled) btnDisableContours.click();
      if (unifiedInfoPanel) unifiedInfoPanel.classList.add("hidden");
    } else {
      showUnifiedInfoPanel("CONTOUR", "TOPOGRAPHIC CONTOURS", null, false);
      document.getElementById("infoContourExportCard")?.classList.toggle("hidden", !state.isContourOverlayActive);
      const syncContourField = (origId, infoId) => {
        const orig = document.getElementById(origId);
        const info = document.getElementById(infoId);
        if (orig && info) info.value = orig.value;
      };
      syncContourField("contourPreset", "infoContourPreset");
      syncContourField("contourInterval", "infoContourInterval");
      syncContourField("majorInterval", "infoMajorInterval");
      syncContourField("contourColor", "infoContourColor");
      syncContourField("contourWidth", "infoContourWidth");
      syncContourField("contourOpacity", "infoContourOpacity");
      const infoOpacityVal = document.getElementById("infoContourOpacityVal");
      const origOpacity = document.getElementById("contourOpacity");
      if (infoOpacityVal && origOpacity) infoOpacityVal.textContent = origOpacity.value;
      const infoRange = document.getElementById("infoContourRange");
      const origRange = document.getElementById("contourRange");
      if (infoRange && origRange) infoRange.textContent = origRange.textContent;
    }
  });

  // Sync info panel contour controls -> original controls
  const syncInfoToOrigContour = (infoId, origId) => {
    document.getElementById(infoId)?.addEventListener("input", (e) => {
      const orig = document.getElementById(origId);
      if (orig) {
        orig.value = e.target.value;
        orig.dispatchEvent(new Event("input"));
        orig.dispatchEvent(new Event("change"));
      }
    });
    document.getElementById(infoId)?.addEventListener("change", (e) => {
      const orig = document.getElementById(origId);
      if (orig) {
        orig.value = e.target.value;
        orig.dispatchEvent(new Event("change"));
      }
    });
  };
  syncInfoToOrigContour("infoContourPreset", "contourPreset");
  syncInfoToOrigContour("infoContourInterval", "contourInterval");
  syncInfoToOrigContour("infoMajorInterval", "majorInterval");
  syncInfoToOrigContour("infoContourColor", "contourColor");
  syncInfoToOrigContour("infoContourWidth", "contourWidth");
  syncInfoToOrigContour("infoContourOpacity", "contourOpacity");

  document.getElementById("infoContourOpacity")?.addEventListener("input", (e) => {
    const val = document.getElementById("infoContourOpacityVal");
    if (val) val.textContent = e.target.value;
  });

  // Sync info panel grid spacing -> original slider
  document.getElementById("infoElevationsSpacing")?.addEventListener("input", (e) => {
    const origSpacing = document.getElementById("elevationsSpacing");
    const infoSpacingVal = document.getElementById("infoElevationsSpacingVal");
    if (origSpacing) {
      origSpacing.value = e.target.value;
      origSpacing.dispatchEvent(new Event("input"));
    }
    if (infoSpacingVal) infoSpacingVal.textContent = e.target.value + "m";
  });

  // Sync info panel heatmap opacity -> original slider
  document.getElementById("infoHeatmapOpacity")?.addEventListener("input", (e) => {
    const origOpacity = document.getElementById("heatmapOpacity");
    const infoOpacityVal = document.getElementById("infoHeatmapOpacityVal");
    if (origOpacity) {
      origOpacity.value = e.target.value;
      origOpacity.dispatchEvent(new Event("input"));
    }
    if (infoOpacityVal) infoOpacityVal.textContent = Math.round(parseFloat(e.target.value) * 100) + "%";
  });

  // Attach to window
  window.updatePointSvg = updatePointSvg;
}
