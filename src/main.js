// src/main.js
// Main Application Bootstrap & Module Orchestration for Polygon 3D Geospatial Viewer

import { initProj4 } from "./config/crs.js";
import { getActiveProjectConfig } from "./config/projects.js";
import { state } from "./core/state.js";
import { initEngine } from "./core/engine.js";
import { initCamera, initCameraUI } from "./core/camera.js";
import { loadProject } from "./core/projectLoader.js";
import { initDialogs } from "./ui/dialogs.js";
import { initCoordinateReadout } from "./ui/coordinates.js";
import { applyIbmRoleGating } from "./ui/roleGating.js";
import { initViewportUI } from "./ui/viewport.js";
import { initInfoPanelUI } from "./ui/infoPanel.js";
import { initCharts } from "./tools/profileChart.js";
import { initMeasureUI } from "./tools/measure.js";
import { initProfileUI } from "./tools/profile.js";
import { initVolumeUI } from "./tools/volume.js";
import { initRoiUI } from "./tools/roi.js";
import { initHeatmapUI } from "./tools/heatmap.js";
import { initSlopeHeatmapUI } from "./tools/slopeHeatmap.js";
import { initContoursUI } from "./tools/contours.js";
import { initElevationsGridUI } from "./tools/elevationsGrid.js";
import { initSavedReportsUI, fetchSavedReports } from "./services/savedReports.js";
import { initSavedVolumesUI, fetchSavedVolumes } from "./services/savedVolumes.js";
import { initSavedRoisUI, fetchSavedRois } from "./services/savedRois.js";
import { initMultiOverlayUI } from "./tools/multiOverlay.js";
import { initCanvasInteractions } from "./tools/canvasInteractions.js";

async function bootstrap() {
  console.log("🚀 Initializing Polygon 3D Geospatial Viewer...");

  // 1. Initialize CRS Projections & Purge Cache
  initProj4();

  // 2. Initialize UI Modals, Role Gating & Viewports
  initDialogs();
  applyIbmRoleGating();
  initViewportUI();

  // 3. Initialize 3D Engine & Camera Controls
  const instance = initEngine();
  initCamera(instance);
  initCameraUI();
  initCoordinateReadout();

  // 4. Initialize Tools & Graphs
  initCharts();
  initMeasureUI();
  initProfileUI();
  initVolumeUI();
  initRoiUI();
  initHeatmapUI();
  initSlopeHeatmapUI();
  initContoursUI();
  initElevationsGridUI();
  initInfoPanelUI();
  initSavedReportsUI();
  initSavedVolumesUI();
  initSavedRoisUI();
  initMultiOverlayUI();
  initCanvasInteractions();

  // 5. Load Active Project Config
  const activeProject = getActiveProjectConfig();
  state.activeProject = activeProject;
  window.activeProject = activeProject;

  await loadProject(activeProject);

  // 6. Fetch Saved Features from Cloud Storage
  fetchSavedReports();
  fetchSavedVolumes();
  fetchSavedRois();

  console.log("✅ Polygon 3D Viewer initialized successfully!");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
