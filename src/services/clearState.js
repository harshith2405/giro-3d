// src/services/clearState.js
// Centralized state reset and full-map restoration utilities

import { state } from "../core/state.js";
import { hideRoiWorkspaceBadge, hideRoiWorkspaceNotice, resetRoiState } from "../tools/roiState.js";
import { getActiveProjectConfig } from "../config/projects.js";

/**
 * Restores full unclipped terrain view if currently restricted by a bounding box or polygon ROI.
 */
export function restoreFullMapIfClipped() {
  hideRoiWorkspaceBadge();
  hideRoiWorkspaceNotice();
  const map = state.map;
  const hasClipping = state.isTerrainClippedToRoi || (map && map.clippingPlanes && map.clippingPlanes.length > 0) || (state.roiPolyPoints && state.roiPolyPoints.length > 0) || state.measureMode === "ROI_POLY" || state.measureState === "FINISHED_ROI_POLY";

  if (hasClipping) {
    state.isTerrainClippedToRoi = false;
    if (map) map.clippingPlanes = [];
    resetRoiState();

    const roiSvg = document.getElementById("roiSvg");
    const roiPolySvg = document.getElementById("roiPolySvg");
    const roiPolyPolygonOverlay = document.getElementById("roiPolyPolygonOverlay");
    const roiPolyVerticesOverlay = document.getElementById("roiPolyVerticesOverlay");
    const volumePolygonSvg = document.getElementById("volumePolygonOverlay");
    const volumeVerticesSvg = document.getElementById("volumeVerticesOverlay");
    const volumeSvg = document.getElementById("volumeSvg");
    const resetRoiBtn = document.getElementById("resetROI");

    if (roiSvg) roiSvg.style.display = "none";
    if (roiPolySvg) roiPolySvg.style.display = "none";
    if (roiPolyPolygonOverlay) roiPolyPolygonOverlay.style.display = "none";
    if (roiPolyVerticesOverlay) roiPolyVerticesOverlay.innerHTML = "";
    state.roiPolyPoints = [];
    if (volumePolygonSvg) volumePolygonSvg.style.display = "none";
    if (volumeVerticesSvg) volumeVerticesSvg.style.display = "none";
    if (volumeSvg) volumeSvg.style.display = "none";

    if (state.measureMode === "ROI_POLY" || state.measureState === "FINISHED_ROI_POLY") {
      state.measureState = "IDLE";
      state.measureMode = "NONE";
    }

    if (resetRoiBtn) resetRoiBtn.disabled = true;

    const clipProject = state.activeProject || getActiveProjectConfig();
    if (typeof window.loadProject === "function" && clipProject) {
      window.loadProject(clipProject, null);
    }
  }
}

/**
 * Left Panel Exclusive State: only one feature can be active at a time.
 * Clears measurements, drawn volumes, points, and active selections.
 */
export function clearAllLeftPanelState(skipRestoreMap = true) {
  // 1. Clear Profile/Line & Distance Measurements
  const btnClearProfile = document.getElementById('btnClearProfile');
  if (btnClearProfile) {
    btnClearProfile.disabled = false;
    btnClearProfile.click();
  }
  if (typeof window.clearMeasure === "function") window.clearMeasure();
  const measureSvg = document.getElementById("measureSvg");
  if (measureSvg) measureSvg.style.display = "none";
  state.currentProfilePoints3D = [];
  state.currentProfileData = [];

  // 2. Clear Volume/Polygon
  const btnClearVolume = document.getElementById('btnClearVolume');
  if (btnClearVolume) {
    btnClearVolume.disabled = false;
    btnClearVolume.click();
  }
  if (typeof window.resetVolumeKmlBadge === 'function') window.resetVolumeKmlBadge();
  state.volumePoints = [];
  state.volumeMousePoint = null;
  const volumeSvg = document.getElementById("volumeSvg");
  if (volumeSvg) volumeSvg.style.display = "none";

  // 3. Clear Simple Measure
  const btnClearMeasureSimple = document.getElementById('btnClearMeasureSimple');
  if (btnClearMeasureSimple) {
    btnClearMeasureSimple.disabled = false;
    btnClearMeasureSimple.click();
  }

  // 4. Clear Points
  const pointMiniContainer = document.getElementById('pointMiniContainer');
  const pointSvg = document.getElementById('pointSvg');
  if (pointMiniContainer) pointMiniContainer.classList.add('hidden');
  state.pointDrawPoint = null;
  state.pointDrawCoord = null;
  if (pointSvg) pointSvg.style.display = 'none';

  // 5. Clear multi-selected overlay maps & SVG groups
  state.multiSelectedReportsMap.clear();
  state.multiSelectedVolumesMap.clear();
  const multiPolygonsGroup = document.getElementById("multiPolygonsGroup");
  const multiLinesGroup = document.getElementById("multiLinesGroup");
  const multiBadgesGroup = document.getElementById("multiBadgesGroup");
  if (multiPolygonsGroup) multiPolygonsGroup.innerHTML = "";
  if (multiLinesGroup) multiLinesGroup.innerHTML = "";
  if (multiBadgesGroup) multiBadgesGroup.innerHTML = "";
  if (typeof window.updateMultiOverlaySvg === 'function') window.updateMultiOverlaySvg();

  // 6. Reset all View All switches (master and subfolders)
  const toggleViewAllReports = document.getElementById("toggleViewAllReports");
  const toggleViewAllVolumes = document.getElementById("toggleViewAllVolumes");
  if (toggleViewAllReports) toggleViewAllReports.checked = false;
  if (toggleViewAllVolumes) toggleViewAllVolumes.checked = false;
  document.querySelectorAll(".toggle-folder-view-reports, .toggle-folder-view-volumes").forEach(cb => cb.checked = false);

  // 7. Hide Info Panel & clear current viewing feature
  const unifiedInfoPanel = document.getElementById("unifiedInfoPanel");
  if (unifiedInfoPanel) unifiedInfoPanel.classList.add("hidden");
  const infoInlineRenameContainer = document.getElementById("infoInlineRenameContainer");
  if (infoInlineRenameContainer) infoInlineRenameContainer.classList.add("hidden");
  state.currentViewingFeature = null;

  // 8. Remove active list highlights
  document.querySelectorAll(".saved-report-item.active, .saved-item-card.active, .drawn-feature-item.active, .selected-item").forEach(el => {
    el.classList.remove("active", "selected-item");
  });

  // 9. Restore full unclipped map ONLY if explicitly requested
  if (skipRestoreMap === false) {
    restoreFullMapIfClipped();
  }
}

// Global attachments
window.restoreFullMapIfClipped = restoreFullMapIfClipped;
window.clearAllLeftPanelState = clearAllLeftPanelState;
window.clearAllViewingState = clearAllLeftPanelState;
