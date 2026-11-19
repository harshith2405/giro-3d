// src/core/projectLoader.js
// Dynamic project and survey streaming, layer attachment, and extent framing

import Map from "@giro3d/giro3d/entities/Map.js";
import Extent from "@giro3d/giro3d/core/geographic/Extent.js";
import GeoTIFFSource from "@giro3d/giro3d/sources/GeoTIFFSource.js";
import ElevationLayer from "@giro3d/giro3d/core/layer/ElevationLayer.js";
import ColorLayer from "@giro3d/giro3d/core/layer/ColorLayer.js";
import ColorMap, { ColorMapMode } from "@giro3d/giro3d/core/ColorMap.js";
import { DoubleSide, Color } from "three";
import { giroCrs } from "../config/crs.js";
import { state, updateStatus } from "./state.js";
import { frameCameraOnExtent } from "./camera.js";
import { syncFolderDropdowns } from "../ui/infoPanel.js";

export function formatSurveyTitle(rawId) {
  if (!rawId) return "Selected Survey";
  return rawId
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function showSurveyNotAvailableUI(surveyId, folderName) {
  const formatted = formatSurveyTitle(surveyId);
  updateStatus("3D model not available");

  // Hide loading spinners
  const loadingIndicators = document.querySelectorAll(".spinner, #infoHeatmapLoading, #infoContourLoading");
  loadingIndicators.forEach(el => el.classList.add("hidden"));

  // Hide left and right tool panels so they don't block the screen
  const toolFlyout = document.querySelector(".flyout-panel");
  if (toolFlyout) toolFlyout.classList.remove("active");
  const unifiedInfo = document.getElementById("unifiedInfoPanel");
  if (unifiedInfo) unifiedInfo.classList.add("hidden");
  const rightSidebar = document.querySelector(".right-sidebar");
  if (rightSidebar) rightSidebar.style.opacity = "0.3";

  // Create or show the glassmorphism card
  let modal = document.getElementById("surveyNotAvailableModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "surveyNotAvailableModal";
    modal.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle at center, rgba(15, 23, 42, 0.90), rgba(10, 15, 30, 0.98));
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      padding: 24px;
    `;
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 24px; padding: 36px 32px; max-width: 460px; width: 100%; text-align: center; box-shadow: 0 30px 60px rgba(0, 0, 0, 0.7), 0 0 50px rgba(94, 25, 234, 0.2); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="width: 68px; height: 68px; margin: 0 auto 18px; border-radius: 18px; background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(245, 158, 11, 0.18)); border: 1px solid rgba(239, 68, 68, 0.35); display: flex; align-items: center; justify-content: center; font-size: 30px; box-shadow: 0 8px 24px rgba(239, 68, 68, 0.2);">
        🏔️
      </div>
      <div style="display: inline-block; padding: 4px 12px; border-radius: 999px; background: rgba(94, 25, 234, 0.25); border: 1px solid rgba(139, 92, 246, 0.45); color: #c4b5fd; font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 12px;">
        3D Surface Model
      </div>
      <h2 style="margin: 0 0 10px; color: #ffffff; font-size: 22px; font-weight: 700; letter-spacing: -0.3px;">
        3D Model Not Available
      </h2>
      <p style="margin: 0 0 24px; color: #94a3b8; font-size: 13.5px; line-height: 1.6;">
        3D terrain elevation and orthophoto models have not been processed yet for <span style="color: #f8fafc; font-weight: 600;">${formatted}</span>.<br>
        Only 2D map views are currently active for this period.
      </p>
      <div style="display: flex; flex-direction: column; gap: 10px;">
        <button id="btnSwitchToLatest3D" style="width: 100%; padding: 12px 20px; border-radius: 12px; border: none; background: linear-gradient(135deg, #5e19ea, #8b5cf6); color: #ffffff; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 16px rgba(94, 25, 234, 0.4); transition: transform 0.15s ease;">
          View Latest 3D Survey (October 2026) →
        </button>
        <button id="btnStayOn2D" style="width: 100%; padding: 10px 20px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.18); background: rgba(255, 255, 255, 0.04); color: #cbd5e1; font-size: 12.5px; font-weight: 500; cursor: pointer; transition: background 0.15s ease;">
          Return to 2D Map
        </button>
      </div>
    </div>
  `;

  document.getElementById("btnSwitchToLatest3D")?.addEventListener("click", () => {
    const url = new URL(window.location.href);
    url.searchParams.set("survey", "october_2026");
    window.location.href = url.toString();
  });

  document.getElementById("btnStayOn2D")?.addEventListener("click", () => {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "CLOSE_3D_VIEWER" }, "*");
      } else {
        window.history.back();
      }
    } catch (e) {
      window.history.back();
    }
  });
}

export async function loadProject(project, extentOverride = null) {
  try {
    updateStatus("Cleaning up previous project...");

    if (!extentOverride) {
      if (project) state.activeProject = project;
      state.knownProfileFolders.clear();
      state.knownVolumeFolders.clear();
      state.sessionCreatedProfileFolders.clear();
      state.sessionCreatedVolumeFolders.clear();
      syncFolderDropdowns();
      if (typeof window.fetchSavedReports === "function") window.fetchSavedReports();
      if (typeof window.fetchSavedVolumes === "function") window.fetchSavedVolumes();
      if (typeof window.fetchSavedRois === "function") window.fetchSavedRois();
      if (typeof window.populateIbmSurveys === "function") window.populateIbmSurveys();
    }

    const instance = state.instance;
    // Remove any previously loaded map entity.
    if (state.map && instance) {
      instance.remove(state.map);
      state.map = null;
    }

    const extent = extentOverride || new Extent(giroCrs, ...project.extent);

    const map = new Map({
      extent,
      lighting: false,
      side: DoubleSide,
      discardNoData: true,
      maxSubdivisionLevel: 14,
    });
    map.backgroundColor = 0x1e2229;
    instance.add(map);
    state.map = map;

    // Instantiate fresh sources per load to ensure clean WebGL layer binding
    project.elevationSource = new GeoTIFFSource({
      url: new URL(project.elevationUrl, window.location.href).href,
      crs: giroCrs,
      retries: 5,
      httpTimeout: 30000,
    });

    project.orthoSource = new GeoTIFFSource({
      url: new URL(project.orthoUrl, window.location.href).href,
      crs: giroCrs,
      retries: 5,
      httpTimeout: 30000,
    });

    // Elevation (DSM/DTM)
    updateStatus("Loading Elevation Model…");
    const slopeColorMap = new ColorMap({
      colors: [new Color('green'), new Color('yellow'), new Color('orange'), new Color('red'), new Color('darkred')],
      opacities: new Array(5).fill(0.35),
      min: 0,
      max: 90,
      mode: ColorMapMode.Slope
    });
    slopeColorMap.active = false;
    state.slopeColorMap = slopeColorMap;

    const elevationLayer = new ElevationLayer({
      name: "Elevation",
      extent,
      source: project.elevationSource,
      noDataOptions: { replaceNoData: true },
      minmax: { min: 0, max: 4000 },
      colorMap: slopeColorMap,
    });
    state.elevationLayer = elevationLayer;

    try {
      await map.addLayer(elevationLayer);
      console.log("Elevation loaded ✅");
    } catch (err) {
      console.error("Failed to load Elevation layer (Check S3 404/403 errors):", err);
    }

    // Orthophoto (color imagery)
    updateStatus("Loading orthophoto…");
    const orthoLayer = new ColorLayer({
      name: "Orthophoto",
      extent,
      source: project.orthoSource,
      opacity: 1,
      preloadImages: true,
      noDataOptions: { replaceNoData: false },
    });
    state.orthoLayer = orthoLayer;

    try {
      await map.addLayer(orthoLayer);
      console.log("Orthophoto loaded ✅");
    } catch (err) {
      console.error("Failed to load Ortho layer (Check S3 404/403 errors):", err);
    }

    // Terrain elevation range -> drives contour range readout
    const minMax = map.getElevationMinMax();
    console.log("Elevation MinMax:", minMax);
    const contourRangeEl = document.getElementById("contourRange");
    if (minMax) {
      state.elevationRange = minMax;
      if (contourRangeEl) {
        contourRangeEl.textContent = `${minMax.min.toFixed(1)}m to ${minMax.max.toFixed(1)}m`;
      }
    }

    // Frame the camera on the loaded extent (accounting for left flyout panel)
    frameCameraOnExtent(extent, extentOverride);

    updateStatus("Ready");
    instance.notifyChange();

    // Sync orthophoto visibility with optional toggle
    const orthoToggle = document.getElementById("orthoToggle");
    if (orthoToggle) orthoLayer.opacity = orthoToggle.checked ? 1 : 0;

    // Re-apply any active right-toolbar overlays to newly loaded terrain
    if (state.isHeatmapOverlayActive) {
      document.getElementById("btnEnableHeatmap")?.click();
    }
    if (state.isContourOverlayActive) {
      document.getElementById("btnEnableContours")?.click();
    }
    if (state.isGridOverlayActive) {
      document.getElementById("btnEnableElevations")?.click();
    }

    if (typeof window.populateIbmSurveys === "function") {
      window.populateIbmSurveys();
    }
  } catch (err) {
    console.error("Error loading project:", err);
    updateStatus("Error loading project files.");
  }
}

// Window attachment
window.loadProject = loadProject;
