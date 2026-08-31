// ser.js — Giro3D Mining Viewer
// Professional browser-based 3D GIS / mining terrain viewer.
// Loads DSM/DTM + Orthophoto GeoTIFFs via Giro3D, with ROI clipping,
// contour generation, interactive measurement and live coordinate readout.

import proj4 from "proj4";
import { register } from "ol/proj/proj4";

import Instance from "@giro3d/giro3d/core/Instance.js";
import Map from "@giro3d/giro3d/entities/Map.js";
import Extent from "@giro3d/giro3d/core/geographic/Extent.js";
import GeoTIFFSource from "@giro3d/giro3d/sources/GeoTIFFSource.js";
import ElevationLayer from "@giro3d/giro3d/core/layer/ElevationLayer.js";
import ColorLayer from "@giro3d/giro3d/core/layer/ColorLayer.js";
import CoordinateSystem from "@giro3d/giro3d/core/geographic/CoordinateSystem.js";
import ColorMap, { ColorMapMode } from "@giro3d/giro3d/core/ColorMap.js";
import Coordinates from "@giro3d/giro3d/core/geographic/Coordinates.js";
import HttpConfiguration from "@giro3d/giro3d/utils/HttpConfiguration.js";
import Chart from "chart.js/auto";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

// Fix for Chromium's ERR_CACHE_OPERATION_NOT_SUPPORTED on GeoTIFF range requests
HttpConfiguration.setOptions(window.location.origin, { cache: "no-store" });

const giroCrs = new CoordinateSystem("EPSG:3395");

import { Vector3, Vector2, Color, DoubleSide, Plane } from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";

// ---------------------------------------------------------------------------
// CRS registration
// ---------------------------------------------------------------------------
proj4.defs(
  "EPSG:3395",
  "+proj=merc +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs +type=crs"
);
register(proj4);

// Default project extent (World Mercator), used as an initial reference.
new Extent(
  giroCrs,
  9467845763606766e-9,
  9473006448724607e-9,
  2.7212684801465548e6,
  2.7244897791313147e6
);

// ---------------------------------------------------------------------------
// Giro3D instance
// ---------------------------------------------------------------------------
const instance = new Instance({
  target: "view",
  crs: giroCrs,
  backgroundColor: 0x1e2229,
});
if (instance.scene) instance.scene.background = new Color(0x1e2229);
if (instance.renderer) {
  instance.renderer.setClearColor(0x1e2229, 1);
  instance.renderer.localClippingEnabled = true;
}

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------
let map = null;
let elevationLayer = null;
let orthoLayer = null;
let elevationRange = { min: 0, max: 1000 };
let slopeColorMap = null;

/** Update the on-screen status text (if a `.status` element exists). */
function updateStatus(text) {
  const el = document.querySelector(".status");
  if (el) el.textContent = text;
}

// ---------------------------------------------------------------------------
// Project loading
// ---------------------------------------------------------------------------
async function loadProject(project, extentOverride = null) {
  try {
    updateStatus("Cleaning up previous project...");

    // Remove any previously loaded map entity.
    if (map) {
      instance.remove(map);
      map = null;
    }

    const extent = extentOverride || new Extent(giroCrs, ...project.extent);

    map = new Map({
      extent,
      lighting: false,
      side: DoubleSide,
      discardNoData: true,
      maxSubdivisionLevel: 14, // Safely limits zoom to prevent mathematical infinity/crashes
    });
    map.backgroundColor = 0x1e2229;
    instance.add(map);

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

    // Elevation (DSM/DTM).
    updateStatus("Loading Elevation Model…");
    slopeColorMap = new ColorMap({
      colors: [new Color('green'), new Color('yellow'), new Color('orange'), new Color('red'), new Color('darkred')],
      opacities: new Array(5).fill(0.35),
      min: 0,
      max: 90,
      mode: ColorMapMode.Slope
    });
    slopeColorMap.active = false; 

    elevationLayer = new ElevationLayer({
      name: "Elevation",
      extent,
      source: project.elevationSource,
      noDataOptions: { replaceNoData: true },
      minmax: { min: 0, max: 4000 }, // Prevents "no min/max could be computed" WebGL crash
      colorMap: slopeColorMap, // Registered with the Map's GPU shader atlas during addLayer
    });
    
    try {
      await map.addLayer(elevationLayer);
      console.log("Elevation loaded ✅");
    } catch (err) {
      console.error("Failed to load Elevation layer (Check S3 404/403 errors):", err);
    }

    // Orthophoto (color imagery).
    updateStatus("Loading orthophoto…");
    orthoLayer = new ColorLayer({
      name: "Orthophoto",
      extent,
      source: project.orthoSource,
      opacity: 1,
      preloadImages: true,
    });
    
    try {
      await map.addLayer(orthoLayer);
      console.log("Orthophoto loaded ✅");
    } catch (err) {
      console.error("Failed to load Ortho layer (Check S3 404/403 errors):", err);
    }

    // Terrain elevation range → drives contour range readout.
    const minMax = map.getElevationMinMax();
    console.log("Elevation MinMax:", minMax);
    const contourRangeEl = document.getElementById("contourRange");
    if (minMax) {
      elevationRange = minMax;
      if (contourRangeEl) {
        contourRangeEl.textContent = `${minMax.min.toFixed(1)}m to ${minMax.max.toFixed(1)}m`;
      }
    }

    // Frame the camera on the loaded extent (Top-Down Nadir View, Tilt = 0).
    const center = extent.centerAsVector3();
    const dims = extent.dimensions();
    const size = Math.max(dims.x, dims.y);
    const zOffset = project.zOffset || 0;
    const zoomMultiplier = extentOverride ? 2.4 : 1.4;
    const camPos = new Vector3(
      center.x,
      center.y,
      zOffset + size * zoomMultiplier
    );
    instance.view.camera.position.copy(camPos);
    controls.target.copy(new Vector3(center.x, center.y, zOffset));
    controls.update();
    if (instance?.view?.camera) instance.view.camera.updateMatrixWorld(true);
    instance.notifyChange(instance.view.camera);

    updateStatus("Ready");
    instance.notifyChange();

    // Sync orthophoto visibility with the (optional) toggle.
    const orthoToggle = document.getElementById("orthoToggle");
    if (orthoToggle) orthoLayer.opacity = orthoToggle.checked ? 1 : 0;
  } catch (err) {
    console.error("Error loading project:", err);
    updateStatus("Error loading project files.");
  }
}

// ---------------------------------------------------------------------------
// Project catalogue
// ---------------------------------------------------------------------------
const PROJECTS = {
  chattibhariatu_project: {
    folderName: "Chattibhariatu",
    surveys: {
      may_2026: {
        elevationUrl: "./projects/Chattibhariatu/surveys/may_2026/DSM_cloudoptimised.tif",
        orthoUrl: "./projects/Chattibhariatu/surveys/may_2026/Ortho_CO.tif",
        extent: [9467845.7636, 9473006.4487, 2721268.4801, 2724489.7791],
        zOffset: 429,
      },
      july_2026: {
        elevationUrl: "./projects/Chattibhariatu/surveys/july_2026/DTM_CO_mercator.tif",
        orthoUrl: "./projects/Chattibhariatu/surveys/july_2026/Ortho_CO_5cm_mercator.tif",
        extent: [9467845.7636, 9473006.4487, 2721268.4801, 2724489.7791],
        zOffset: 429,
      },
      August_2026: {
        elevationUrl: "./projects/Chattibhariatu/surveys/August_2026/DTM_CO.tif",
        orthoUrl: "./projects/Chattibhariatu/surveys/August_2026/Ortho_CO.tif",
        extent: [9468023.88, 9472680.48, 2721355.34, 2724299.87],
        zOffset: 434.5,
      }
    }
  },
  ahuja_project: {
    folderName: "ahuja",
    surveys: {
      may_2026: {
        elevationUrl: "./projects/ahuja/surveys/may_2026/Ahuja_DTM_COG.tif",
        orthoUrl: "./projects/ahuja/surveys/may_2026/Ambuja_ortho.tif",
        extent: [8755723.1688, 8756317.9188, 1942412.3557, 1943215.8557],
        zOffset: 550,
      }
    }
  },
};

/** Helper to parse URL and return the active project+survey config */
function getActiveProjectConfig() {
  const urlParams = new URLSearchParams(window.location.search);
  const projectId = urlParams.get("project") || "chattibhariatu_project";
  const surveyId = urlParams.get("survey") || "may_2026";
  
  const projectInfo = PROJECTS[projectId] || PROJECTS.chattibhariatu_project;
  const defaultSurvey = projectInfo.surveys["may_2026"] || Object.values(projectInfo.surveys)[0];
  const surveyInfo = (projectInfo.surveys && projectInfo.surveys[surveyId])
    ? projectInfo.surveys[surveyId]
    : {
        elevationUrl: `./projects/${projectInfo.folderName}/surveys/${surveyId}/DSM_cloudoptimised.tif`,
        orthoUrl: `./projects/${projectInfo.folderName}/surveys/${surveyId}/Ortho_CO.tif`,
        extent: defaultSurvey ? defaultSurvey.extent : [0,0,0,0],
        zOffset: defaultSurvey ? defaultSurvey.zOffset : 0
      };
  
  return {
    ...projectInfo,
    elevationUrl: surveyInfo.elevationUrl,
    orthoUrl: surveyInfo.orthoUrl,
    extent: surveyInfo.extent || (defaultSurvey ? defaultSurvey.extent : [0,0,0,0]),
    zOffset: (typeof surveyInfo.zOffset === "number") ? surveyInfo.zOffset : (defaultSurvey ? defaultSurvey.zOffset : 0),
    id: projectId,
    folderName: projectInfo.folderName || projectId,
    surveyId: surveyId
  };
}

let activeProject = null;
let isTerrainClippedToRoi = false;

// ---------------------------------------------------------------------------
// Camera controls
// ---------------------------------------------------------------------------
instance.view.camera.near = 0.1;
instance.view.camera.far = 1e6;

const controls = new MapControls(instance.view.camera, instance.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 50;
controls.maxDistance = 150000;
controls.maxPolarAngle = Math.PI / 2;

const flyoutPanel = document.getElementById('flyoutPanel');
  const toggleFlyoutPanel = document.getElementById('toggleFlyoutPanel');
  const iconBtns = document.querySelectorAll('.left-icon-btn');
  const flyoutGroups = document.querySelectorAll('.left-group');
  const flyoutTitle = document.getElementById('flyoutTitle');
  const btnBrandLogo = document.getElementById('btnBrandLogo');

  btnBrandLogo?.addEventListener('click', () => {
    window.location.reload();
  });

  // Helper to close flyout
  function closeFlyout() {
    flyoutPanel.classList.add('closed');
    iconBtns.forEach(b => b.classList.remove('active'));
  }

  // Open / Switch Flyout
  iconBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      if (!targetId) return;
      
      const isAlreadyActiveAndOpen = btn.classList.contains('active') && !flyoutPanel.classList.contains('closed');
      
      // If clicking the currently active button while open, toggle it closed
      if (isAlreadyActiveAndOpen) {
        closeFlyout();
        return;
      }
      
      // Otherwise, open it and switch active state
      flyoutPanel.classList.remove('closed');
      
      // Update buttons
      iconBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update groups visibility
      flyoutGroups.forEach(g => {
        if (g.id === targetId) {
          g.classList.remove('hidden');
          g.classList.add('active');
          g.style.display = 'block';
        } else {
          g.classList.add('hidden');
          g.classList.remove('active');
          g.style.display = 'none';
        }
      });
      
      // Update Title
      if (flyoutTitle) {
        flyoutTitle.textContent = btn.getAttribute('title') || 'Panel';
      }

      // Reset left panel drawing/measure state & un-clip ROI when switching left tabs
      if (typeof window.clearAllLeftPanelState === 'function') {
        window.clearAllLeftPanelState();
      }

      // Automatically restore full unclipped map if switching to Features, Profiles, Volumes, or Measure
      if (['panel-features', 'panel-profile', 'panel-volume', 'panel-measure'].includes(targetId)) {
        if (typeof window.restoreFullMapIfClipped === 'function') {
          window.restoreFullMapIfClipped();
        }
      }
    });
  });

  // Close button inside flyout
  toggleFlyoutPanel?.addEventListener('click', () => {
    closeFlyout();
  });


  // --- Features Panel Draw Buttons ---
  const btnDrawFeaturePoint = document.getElementById('btnDrawFeaturePoint');

  btnDrawFeaturePoint?.addEventListener('click', (e) => {
    e.stopPropagation();
    restoreFullMapIfClipped();
    measureState = "SELECTING_POINT";
    measureMode = "POINT";
    controls.enabled = false;
    document.body.classList.add("roi-selecting");
    pointDrawPoint = null;
    pointDrawCoord = null;
    if(pointSvg) pointSvg.style.display = 'none';
    if(pointMiniContainer) pointMiniContainer.classList.add('hidden');
  });

  instance.view.setControls(controls);

console.log("Giro3D initialized");

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  // --- MULTI-SELECT STATE ---
  let isMultiSelectReports = false;
  let isMultiSelectVolumes = false;
  const multiSelectedReportsMap = new window.Map();
  const multiSelectedVolumesMap = new window.Map();
  let activeFocusedFeatureId = null;

  function updateMultiOverlaySvg() {
    const multiPolygonsGroup = document.getElementById("multiPolygonsGroup");
    const multiLinesGroup = document.getElementById("multiLinesGroup");
    const multiBadgesGroup = document.getElementById("multiBadgesGroup");

    if (!instance || !instance.view || !instance.view.camera) return;
    const camera = instance.view.camera;

    if (multiPolygonsGroup) multiPolygonsGroup.innerHTML = "";
    if (multiLinesGroup) multiLinesGroup.innerHTML = "";
    if (multiBadgesGroup) multiBadgesGroup.innerHTML = "";

    // Helper to render map badges
    function renderMapBadge(text, x, y, isFocused, onClick) {
      if (!multiBadgesGroup || isNaN(x) || isNaN(y)) return;
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.style.cursor = "pointer";
      g.style.pointerEvents = "auto";
  
      const paddingX = 10;
      const height = 22;
      const textWidth = Math.max(45, text.length * 7.5);
      const width = textWidth + paddingX * 2;
      const rectX = x - width / 2;
      const rectY = y - height / 2;
  
      const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bgRect.setAttribute("x", rectX);
      bgRect.setAttribute("y", rectY);
      bgRect.setAttribute("width", width);
      bgRect.setAttribute("height", height);
      bgRect.setAttribute("rx", "11");
      bgRect.setAttribute("fill", isFocused ? "#5e19ea" : "rgba(255, 255, 255, 0.94)");
      bgRect.setAttribute("stroke", isFocused ? "#ffffff" : "#5e19ea");
      bgRect.setAttribute("stroke-width", "1.5");
      if (isFocused) bgRect.setAttribute("filter", "url(#multiGlow)");
  
      const textEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
      textEl.setAttribute("x", x);
      textEl.setAttribute("y", y + 4);
      textEl.setAttribute("text-anchor", "middle");
      textEl.setAttribute("fill", isFocused ? "#ffffff" : "#1f2937");
      textEl.setAttribute("font-size", "11");
      textEl.setAttribute("font-weight", "700");
      textEl.setAttribute("font-family", "Inter, sans-serif");
      textEl.textContent = text;
  
      g.appendChild(bgRect);
      g.appendChild(textEl);
      g.addEventListener("click", (e) => {
        e.stopPropagation();
        if (onClick) onClick();
      });
  
      multiBadgesGroup.appendChild(g);
    }

    // Helper to focus
    function focusMultiFeature(id, type) {
      activeFocusedFeatureId = id;
      if (type === "VOLUME") {
        const vol = multiSelectedVolumesMap.get(id);
        if (vol && vol.metadata) {
          document.getElementById("volMiniArea").textContent = vol.metadata.area2D || "0";
          document.getElementById("volMiniPerim").textContent = vol.metadata.perimeter || "0";
          document.getElementById("volMiniCut").textContent = vol.metadata.cutVolume || "0";
          document.getElementById("volMiniFill").textContent = vol.metadata.fillVolume || "0";
          showUnifiedInfoPanel("VOLUME", "SAVED VOLUME", vol.metadata, true);

          if (vol.metadata.points && vol.metadata.points.length >= 3) {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            let cx = 0, cy = 0;
            for (const p of vol.metadata.points) {
              if (p.x < minX) minX = p.x;
              if (p.x > maxX) maxX = p.x;
              if (p.y < minY) minY = p.y;
              if (p.y > maxY) maxY = p.y;
              cx += p.x; cy += p.y;
            }
            cx /= vol.metadata.points.length;
            cy /= vol.metadata.points.length;
          }
        }
      } else if (type === "PROFILE") {
        const prof = multiSelectedReportsMap.get(id);
        if (prof && prof.metadata) {
          const m = prof.metadata;
          const profHoriz = document.getElementById("profileHoriz");
          const profVert = document.getElementById("profileVert");
          const prof3D = document.getElementById("profile3D");
          
          if (profHoriz && m.chartData) profHoriz.textContent = (m.chartData.totalDist || 0).toFixed(2) + " m";
          if (profVert && m.chartData) profVert.textContent = (m.chartData.elevChange || 0).toFixed(2) + " m";
          if (prof3D && m.chartData) prof3D.textContent = (m.chartData.surfDist || 0).toFixed(2) + " m";
          
          const elevationMiniContainer = document.getElementById("elevationMiniContainer");
          if (elevationMiniContainer) elevationMiniContainer.classList.remove('hidden');
          
          showUnifiedInfoPanel("PROFILE", "ELEVATION PROFILE", m, true);
          
          if (m.chartData && m.chartData.distances && m.chartData.elevations) {
            // Note: miniChart and initCharts are in the closure scope.
            if (typeof miniChart !== 'undefined' && miniChart && (miniChart.width === 0 || miniChart.height === 0)) {
              miniChart.destroy();
              miniChart = null;
            }
            const _savedDistances = m.chartData.distances;
            const _savedElevations = m.chartData.elevations;
            setTimeout(() => {
              if (typeof initCharts === "function") initCharts();
              if (typeof miniChart !== 'undefined' && miniChart) {
                miniChart.data.labels = _savedDistances;
                miniChart.data.datasets[0].data = _savedElevations;
                miniChart.resize();
                miniChart.update('none');
              }
            }, 100);
          }
        }
      }
      updateMultiOverlaySvg();
    }

    // 1. Render Multi-Selected Volumes (Dual-Stroke Option 1, No Fill)
    if (multiSelectedVolumesMap.size > 0) {
      multiSelectedVolumesMap.forEach((item, id) => {
        const volData = item.data || item.metadata;
        if (!volData || !volData.points || volData.points.length < 3) return;
        const isFocused = id === activeFocusedFeatureId;

        let sumX = 0, sumY = 0, sumZ = 0;
        const screenPoints = [];
        for (const pt of volData.points) {
          const v = new Vector3(pt.x, pt.y, pt.z);
          sumX += pt.x; sumY += pt.y; sumZ += pt.z;
          const screenP = projectToScreen(v);
          if (screenP.z <= 1) {
            screenPoints.push(`${screenP.x},${screenP.y}`);
          }
        }
        
        if (screenPoints.length < 3) return;

        const ptsAttr = screenPoints.join(" ");

        // 1. Halo white line underneath (3.2px)
        const haloEl = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        haloEl.setAttribute("points", ptsAttr);
        haloEl.setAttribute("fill", "none");
        haloEl.setAttribute("stroke", "#ffffff");
        haloEl.setAttribute("stroke-width", "3.2");
        haloEl.setAttribute("stroke-linejoin", "round");
        haloEl.setAttribute("stroke-linecap", "round");
        haloEl.style.pointerEvents = "none";

        // 2. Core Polygon Purple line on top (no fill)
        const polyEl = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        polyEl.setAttribute("points", ptsAttr);
        polyEl.setAttribute("fill", "none");
        polyEl.setAttribute("stroke", isFocused ? "#5e19ea" : "#7c3aed");
        polyEl.setAttribute("stroke-width", isFocused ? "2.4" : "1.8");
        polyEl.setAttribute("stroke-linejoin", "round");
        polyEl.setAttribute("stroke-linecap", "round");
        if (isFocused) polyEl.setAttribute("filter", "url(#multiGlow)");
        polyEl.style.cursor = "pointer";
        polyEl.style.pointerEvents = "auto";

        polyEl.addEventListener("click", (e) => {
          e.stopPropagation();
          focusMultiFeature(id, "VOLUME");
        });

        if (multiPolygonsGroup) {
          multiPolygonsGroup.appendChild(haloEl);
          multiPolygonsGroup.appendChild(polyEl);
        }

        const count = volData.points.length;
        const centroidWorld = new Vector3(sumX / count, sumY / count, sumZ / count);
        const projCentroid = projectToScreen(centroidWorld);
        if (projCentroid.z <= 1) {
          renderMapBadge(item.name || "Volume", projCentroid.x, projCentroid.y, isFocused, () => focusMultiFeature(id, "VOLUME"));
        }
      });
    }

    // 2. Render Multi-Selected Path Profiles (High-Density Terrain Draped, Dual-Stroke Option 1)
    if (multiSelectedReportsMap.size > 0) {
      multiSelectedReportsMap.forEach((item, id) => {
        const repData = item.data || item.metadata;
        if (!repData) return;

        if (!item._drapedPoints3D) {
          if (repData.startPoint && repData.endPoint) {
            const sPt = new Vector3(repData.startPoint.x, repData.startPoint.y, repData.startPoint.z);
            const ePt = new Vector3(repData.endPoint.x, repData.endPoint.y, repData.endPoint.z);
            
            if (repData.chartData && repData.chartData.elevations && repData.chartData.elevations.length >= 2) {
              item._drapedPoints3D = buildProfile3DPointsFromElevations(sPt, ePt, repData.chartData.elevations);
            } else {
              item._drapedPoints3D = [];
              const sX = repData.startCoord ? repData.startCoord.x : (repData.startPoint.x + (instance?.reference?.x || 0));
              const sY = repData.startCoord ? repData.startCoord.y : (repData.startPoint.y + (instance?.reference?.y || 0));
              const eX = repData.endCoord ? repData.endCoord.x : (repData.endPoint.x + (instance?.reference?.x || 0));
              const eY = repData.endCoord ? repData.endCoord.y : (repData.endPoint.y + (instance?.reference?.y || 0));
              
              const dX = eX - sX;
              const dY = eY - sY;
              const dist = Math.sqrt(dX * dX + dY * dY);
              const samples = Math.max(60, Math.min(400, Math.floor(dist / 0.8)));
              
              const sZ = repData.startPoint.z || (repData.startCoord ? repData.startCoord.z : 0);
              const eZ = repData.endPoint.z || (repData.endCoord ? repData.endCoord.z : 0);

              for (let i = 0; i <= samples; i++) {
                const t = i / samples;
                const gx = sX + t * dX;
                const gy = sY + t * dY;
                const fallbackZ = sZ + t * (eZ - sZ);
                let gz = fallbackZ;
                try {
                  const sample = map ? map.getElevationFast(gx, gy) : null;
                  if (sample && typeof sample.elevation === "number" && !isNaN(sample.elevation)) {
                    gz = sample.elevation;
                  }
                } catch (e) {
                  gz = fallbackZ;
                }
                const xLocal = sPt.x + t * (ePt.x - sPt.x);
                const yLocal = sPt.y + t * (ePt.y - sPt.y);
                item._drapedPoints3D.push(new Vector3(xLocal, yLocal, gz + 0.35));
              }
            }
          } else if (repData.points || repData.originalProfile) {
            const pts = repData.points || repData.originalProfile;
            item._drapedPoints3D = pts.map(p => new Vector3(
              p.coord ? p.coord.x - (instance?.reference?.x || 0) : (p.x || 0),
              p.coord ? p.coord.y - (instance?.reference?.y || 0) : (p.y || 0),
              (p.coord ? p.coord.z : (p.z || 0)) + 0.35
            ));
          }
        }

        const pts3D = item._drapedPoints3D;
        if (!pts3D || pts3D.length < 2) return;
        
        const isFocused = id === activeFocusedFeatureId;

        let sumX = 0, sumY = 0, sumZ = 0;
        const screenPoints = [];
        for (const v of pts3D) {
          sumX += v.x; sumY += v.y; sumZ += v.z;
          const screenP = projectToScreen(v);
          if (screenP.z <= 1) {
            screenPoints.push(`${screenP.x.toFixed(1)},${screenP.y.toFixed(1)}`);
          }
        }
        
        if (screenPoints.length < 2) return;

        const ptsAttr = screenPoints.join(" ");

        // 1. Halo white line underneath (3.2px)
        const haloLine = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        haloLine.setAttribute("points", ptsAttr);
        haloLine.setAttribute("fill", "none");
        haloLine.setAttribute("stroke", "#ffffff");
        haloLine.setAttribute("stroke-width", "3.2");
        haloLine.setAttribute("stroke-linecap", "round");
        haloLine.setAttribute("stroke-linejoin", "round");
        haloLine.style.pointerEvents = "none";

        // 2. Core Polygon Purple line on top
        const lineEl = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        lineEl.setAttribute("points", ptsAttr);
        lineEl.setAttribute("fill", "none");
        lineEl.setAttribute("stroke", isFocused ? "#5e19ea" : "#7c3aed");
        lineEl.setAttribute("stroke-width", isFocused ? "2.4" : "1.8");
        lineEl.setAttribute("stroke-linecap", "round");
        lineEl.setAttribute("stroke-linejoin", "round");
        if (isFocused) lineEl.setAttribute("filter", "url(#multiGlow)");
        lineEl.style.cursor = "pointer";
        lineEl.style.pointerEvents = "auto";

        lineEl.addEventListener("click", (e) => {
          e.stopPropagation();
          focusMultiFeature(id, "PROFILE");
        });

        if (multiLinesGroup) {
          multiLinesGroup.appendChild(haloLine);
          multiLinesGroup.appendChild(lineEl);
        }

        const count = pts3D.length;
        const midWorld = new Vector3(sumX / count, sumY / count, sumZ / count);
        const projMid = projectToScreen(midWorld);
        
        if (projMid.z <= 1) {
          renderMapBadge(item.name || "Profile", projMid.x, projMid.y, isFocused, () => focusMultiFeature(id, "PROFILE"));
        }
      });
    }
  }

  // --- View All Path Profiles Toggle Switch ---
  const toggleViewAllReports = document.getElementById("toggleViewAllReports");
  toggleViewAllReports?.addEventListener("change", (e) => {
    const isChecked = e.target.checked;
    isMultiSelectReports = isChecked;

    document.querySelectorAll(".toggle-folder-view-reports").forEach(cb => cb.checked = isChecked);

    if (isChecked) {
      restoreFullMapIfClipped();
      document.querySelectorAll("#reportsList .saved-report-item, #featuresListLines .saved-report-item").forEach(item => {
        item.classList.add("selected-item");
      });

      if (window._cachedAllProfileItems && window._cachedAllProfileItems.length > 0) {
        window._cachedAllProfileItems.forEach(({ pdfFile, jsonFile, metadata }) => {
          if (!metadata) return;
          const uniqueId = pdfFile.fileName;
          const rawName = metadata?.name || metadata?.title || pdfFile.fileName.split('/').pop().replace('.pdf', '').replace(/_/g, ' ');
          multiSelectedReportsMap.set(uniqueId, { file: jsonFile, metadata, data: metadata, name: rawName });
        });
      }
      updateMultiOverlaySvg();
    } else {
      multiSelectedReportsMap.clear();
      activeFocusedFeatureId = null;
      document.querySelectorAll("#reportsList .saved-report-item, #featuresListLines .saved-report-item").forEach(item => {
        item.classList.remove("selected-item");
      });
      updateMultiOverlaySvg();
    }
  });

  // --- View All Volumes Toggle Switch ---
  const toggleViewAllVolumes = document.getElementById("toggleViewAllVolumes");
  toggleViewAllVolumes?.addEventListener("change", (e) => {
    const isChecked = e.target.checked;
    isMultiSelectVolumes = isChecked;

    document.querySelectorAll(".toggle-folder-view-volumes").forEach(cb => cb.checked = isChecked);

    if (isChecked) {
      restoreFullMapIfClipped();
      document.querySelectorAll("#volumesList .saved-report-item, #featuresListPolygons .saved-report-item").forEach(item => {
        item.classList.add("selected-item");
      });

      if (window._cachedAllVolumeItems && window._cachedAllVolumeItems.length > 0) {
        window._cachedAllVolumeItems.forEach(({ file, metadata }) => {
          if (!metadata) return;
          const uniqueId = file.fileName;
          const volName = metadata?.name || metadata?.title || file.fileName.split('/').pop().replace(/_[0-9]+\.json$/, '').replace(/_/g, ' ');
          multiSelectedVolumesMap.set(uniqueId, { file, metadata, data: metadata, name: volName });
        });
      }
      updateMultiOverlaySvg();
    } else {
      multiSelectedVolumesMap.clear();
      activeFocusedFeatureId = null;
      document.querySelectorAll("#volumesList .saved-report-item, #featuresListPolygons .saved-report-item").forEach(item => {
        item.classList.remove("selected-item");
      });
      updateMultiOverlaySvg();
    }
  });

  activeProject = getActiveProjectConfig();
  loadProject(activeProject).then(() => {});

  // -------------------------------------------------------------------------
  // Heading / Tilt sliders
  // -------------------------------------------------------------------------
  const headingSlider = document.getElementById("headingSlider");
  const tiltSlider = document.getElementById("tiltSlider");
  const headingValue = document.getElementById("headingValue");
  const tiltValue = document.getElementById("tiltValue");
  let suppressSliderSync = false;

  // Update slider positions when the camera moves.
  function syncSlidersFromCamera() {
    if (suppressSliderSync) return;
    const heading = Math.round((controls.getAzimuthalAngle() * 180) / Math.PI);
    const tilt = Math.round((controls.getPolarAngle() * 180) / Math.PI);
    if (headingSlider) headingSlider.value = heading;
    if (headingValue) headingValue.textContent = heading + "°";
    if (tiltSlider) tiltSlider.value = tilt;
    if (tiltValue) tiltValue.textContent = tilt + "°";
  }
  controls.addEventListener("change", syncSlidersFromCamera);

  // Drive the camera from the sliders (temporarily lock the orbit angles).
  function applyCameraFromSliders() {
    suppressSliderSync = true;
    const azimuth = (parseFloat(headingSlider.value) * Math.PI) / 180;
    const polar = (parseFloat(tiltSlider.value) * Math.PI) / 180;

    const minAz = controls.minAzimuthAngle;
    const maxAz = controls.maxAzimuthAngle;
    const minPol = controls.minPolarAngle;
    const maxPol = controls.maxPolarAngle;

    controls.minAzimuthAngle = azimuth;
    controls.maxAzimuthAngle = azimuth;
    controls.minPolarAngle = polar;
    controls.maxPolarAngle = polar;
    controls.update();
    instance.notifyChange();

    controls.minAzimuthAngle = minAz;
    controls.maxAzimuthAngle = maxAz;
    controls.minPolarAngle = minPol;
    controls.maxPolarAngle = maxPol;

    if (headingValue) headingValue.textContent = headingSlider.value + "°";
    if (tiltValue) tiltValue.textContent = tiltSlider.value + "°";
    suppressSliderSync = false;
  }
  headingSlider?.addEventListener("input", applyCameraFromSliders);
  tiltSlider?.addEventListener("input", applyCameraFromSliders);

  // -------------------------------------------------------------------------
  // Camera panel + Reset View
  // -------------------------------------------------------------------------
  const camControlsPanel = document.getElementById("camControlsPanel");
  const resetCameraBtn = document.getElementById("resetCameraBtn");

  camControlsPanel?.addEventListener("dblclick", (e) => e.stopPropagation());
  camControlsPanel?.addEventListener("mousedown", (e) => e.stopPropagation());
  resetCameraBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const project = getActiveProjectConfig();
    const extent = new Extent(giroCrs, ...project.extent);
    const center = extent.centerAsVector3();
    const dims = extent.dimensions();
    const size = Math.max(dims.x, dims.y);
    const zOffset = project.zOffset || 0;
    const camPos = new Vector3(
      center.x,
      center.y,
      zOffset + size * 1.4
    );
    instance.view.camera.position.copy(camPos);
    controls.target.copy(new Vector3(center.x, center.y, zOffset));
    controls.update();
    instance.notifyChange();
    syncSlidersFromCamera();
  });

  // -------------------------------------------------------------------------
  // Live coordinate readout (terrain picking on hover)
  // -------------------------------------------------------------------------
  const canvas = instance.domElement;
  const coordLonLat = document.getElementById("coordLonLat");
  const coordElev = document.getElementById("coordElev");

  canvas.addEventListener("mousemove", (e) => {
    if (!map) return;
    const rect = canvas.getBoundingClientRect();
    const mouse = new Vector2(e.clientX - rect.left, e.clientY - rect.top);
    const picked = map.pick(mouse);
    if (picked && picked.length > 0) {
      const hit = picked[0];
      
      let x, y, elev;
      if (hit.coord) {
        x = hit.coord.x;
        y = hit.coord.y;
        elev = hit.coord.z !== undefined ? hit.coord.z : (hit.coord.altitude !== undefined ? hit.coord.altitude : (hit.coord.values ? hit.coord.values[2] : hit.point.z));
      } else if (hit.point) {
        x = hit.point.x;
        y = hit.point.y;
        elev = hit.point.z;
      }

      if (x !== undefined && y !== undefined) {
        try {
          const [lon, lat] = proj4("EPSG:3395", "WGS84", [x, y]);
          if (coordLonLat) coordLonLat.textContent = `Lon: ${lon.toFixed(3)}°, Lat: ${lat.toFixed(3)}°`;
          if (coordElev) coordElev.textContent = `${Number(elev).toFixed(2)} m`;
        } catch(err) {
           console.error("Proj4 conversion error:", err);
        }
      }
    } else {
      if (coordLonLat) coordLonLat.textContent = "Lon: --, Lat: --";
      if (coordElev) coordElev.textContent = "--";
    }
  });
  canvas.addEventListener("mouseleave", () => {
    if (coordLonLat) coordLonLat.textContent = "Lon: --, Lat: --";
    if (coordElev) coordElev.textContent = "--";
  });

  // -------------------------------------------------------------------------
  // Contours
  // -------------------------------------------------------------------------
  const contourHeader = document.getElementById("contourHeader");
  const contourSettings = document.getElementById("contourSettings");
  const contourCarrot = document.getElementById("contourCarrot");
  const btnEnableContours = document.getElementById("btnEnableContours");
  const btnDisableContours = document.getElementById("btnDisableContours");
  const contourLoading = document.getElementById("infoContourLoading") || document.getElementById("contourLoading");
  const contourPreset = document.getElementById("contourPreset");
  const contourInterval = document.getElementById("contourInterval");
  const majorInterval = document.getElementById("majorInterval");
  const contourColor = document.getElementById("contourColor");
  const contourWidth = document.getElementById("contourWidth");
  const contourOpacity = document.getElementById("contourOpacity");
  let contoursEnabled = false;

  contourHeader?.addEventListener("click", () => {
    if (contourSettings.style.display === "none") {
      contourSettings.style.display = "block";
      contourCarrot.textContent = "▲";
    } else {
      contourSettings.style.display = "none";
      contourCarrot.textContent = "▼";
    }
  });

  const heatmapHeader = document.getElementById("heatmapHeader");
  const heatmapSettingsContainer = document.getElementById("heatmapSettingsContainer");
  const heatmapCarrot = document.getElementById("heatmapCarrot");

  heatmapHeader?.addEventListener("click", () => {
    if (heatmapSettingsContainer.style.display === "none") {
      heatmapSettingsContainer.style.display = "block";
      heatmapCarrot.textContent = "▲";
    } else {
      heatmapSettingsContainer.style.display = "none";
      heatmapCarrot.textContent = "▼";
    }
  });

  // Push the current contour settings onto the map.
  function applyContours() {
    if (!map) return;
    try {
      if (!contoursEnabled) {
        map.contourLines = { enabled: false, opacity: 0 };
      } else {
        // Prefer info panel inputs (always visible), fall back to original hidden panel inputs
        const _contourOpacity = document.getElementById("infoContourOpacity") || contourOpacity;
        const _contourInterval = document.getElementById("infoContourInterval") || contourInterval;
        const _majorInterval = document.getElementById("infoMajorInterval") || majorInterval;
        const _contourColor = document.getElementById("infoContourColor") || contourColor;
        const _contourWidth = document.getElementById("infoContourWidth") || contourWidth;

        let opacity = parseFloat(_contourOpacity?.value ?? 0.8);
        if (opacity >= 1) opacity = 0.99;
        if (opacity <= 0) opacity = 0.01;
        map.contourLines = {
          enabled: true,
          secondaryInterval: parseFloat(_contourInterval?.value ?? 2),
          interval: parseFloat(_majorInterval?.value ?? 10),
          color: new Color(_contourColor?.value ?? "#ffffff"),
          thickness: parseFloat(_contourWidth?.value ?? 1),
          opacity,
        };
      }
      instance.notifyChange();
    } catch (err) {
      console.error("Contour error:", err);
    }
  }

  // Regenerate contours, showing a loading indicator while enabled.
  function regenerateContours() {
    if (contoursEnabled) {
      contourLoading.classList.remove("hidden");
      setTimeout(() => {
        applyContours();
        setTimeout(() => {
          contourLoading.classList.add("hidden");
        }, 25000);
      }, 50);
    } else {
      applyContours();
      contourLoading.classList.add("hidden");
    }
  }

  btnEnableContours?.addEventListener("click", () => {
    contoursEnabled = true;
    btnEnableContours.disabled = true;
    btnDisableContours.disabled = false;
    document.getElementById("infoContourExportCard")?.classList.remove("hidden");
    regenerateContours();
  });
  btnDisableContours?.addEventListener("click", () => {
    contoursEnabled = false;
    btnEnableContours.disabled = false;
    btnDisableContours.disabled = true;
    document.getElementById("infoContourExportCard")?.classList.add("hidden");
    regenerateContours();
  });

  [contourInterval, majorInterval, contourColor, contourWidth, contourOpacity].forEach(
    (input) => {
      input?.addEventListener("input", (e) => {
        if (e.target === contourOpacity) {
          const opacityVal = document.getElementById("contourOpacityVal");
          if (opacityVal) opacityVal.textContent = contourOpacity.value;
        }
        if (contoursEnabled) {
          // Editing intervals switches the preset to "custom".
          if (e.target === contourInterval || e.target === majorInterval) {
            contourPreset.value = "custom";
          }
          regenerateContours();
        }
      });
    }
  );

  contourPreset?.addEventListener("change", () => {
    const preset = contourPreset.value;
    if (preset === "survey") {
      contourInterval.value = "1";
      majorInterval.value = "5";
    } else if (preset === "mining") {
      contourInterval.value = "2";
      majorInterval.value = "10";
    } else if (preset === "overview") {
      contourInterval.value = "10";
      majorInterval.value = "50";
    }
    if (contoursEnabled) regenerateContours();
  });

  // -------------------------------------------------------------------------
  // CONTOUR & HEATMAP EXPORT GENERATORS (DXF, GeoJSON, High-Res PNG)
  // -------------------------------------------------------------------------
  function extractContourPolylines(minorStep = 2, majorStep = 10) {
    if (!map) return [];
    
    const minMax = map.getElevationMinMax() || { min: 0, max: 100 };
    const minZ = Math.floor(minMax.min);
    const maxZ = Math.ceil(minMax.max);
    
    let minX, maxX, minY, maxY;
    if (map.extent) {
      minX = map.extent.minX;
      maxX = map.extent.maxX;
      minY = map.extent.minY;
      maxY = map.extent.maxY;
    } else if (activeProject?.extent) {
      minX = activeProject.extent[0];
      minY = activeProject.extent[1];
      maxX = activeProject.extent[2];
      maxY = activeProject.extent[3];
    } else if (instance?.reference) {
      minX = instance.reference.x - 500;
      maxX = instance.reference.x + 500;
      minY = instance.reference.y - 500;
      maxY = instance.reference.y + 500;
    } else {
      minX = 0; maxX = 1000; minY = 0; maxY = 1000;
    }

    const GRID_RES = 100;
    const dx = (maxX - minX) / (GRID_RES - 1);
    const dy = (maxY - minY) / (GRID_RES - 1);

    // Sample terrain grid
    const grid = [];
    for (let r = 0; r < GRID_RES; r++) {
      const row = [];
      const y = minY + r * dy;
      for (let c = 0; c < GRID_RES; c++) {
        const x = minX + c * dx;
        let z = minZ;
        try {
          const s = map.getElevationFast(x, y);
          if (s && typeof s.elevation === "number" && !isNaN(s.elevation)) {
            z = s.elevation;
          }
        } catch(e) {}
        row.push(z);
      }
      grid.push(row);
    }

    const contours = [];

    // Marching Squares isocontour extraction
    for (let L = minZ; L <= maxZ; L += minorStep) {
      const isMajor = (Math.round(L) % Math.round(majorStep) === 0);
      const segments = [];

      for (let r = 0; r < GRID_RES - 1; r++) {
        const y0 = minY + r * dy;
        const y1 = y0 + dy;
        for (let c = 0; c < GRID_RES - 1; c++) {
          const x0 = minX + c * dx;
          const x1 = x0 + dx;

          const z00 = grid[r][c];
          const z10 = grid[r][c + 1];
          const z11 = grid[r + 1][c + 1];
          const z01 = grid[r + 1][c];

          const code = (z00 > L ? 1 : 0) | ((z10 > L ? 1 : 0) << 1) | ((z11 > L ? 1 : 0) << 2) | ((z01 > L ? 1 : 0) << 3);
          if (code === 0 || code === 15) continue;

          const pBottom = [x0 + ((L - z00) / (z10 - z00 || 0.0001)) * (x1 - x0), y0, L];
          const pRight  = [x1, y0 + ((L - z10) / (z11 - z10 || 0.0001)) * (y1 - y0), L];
          const pTop    = [x0 + ((L - z01) / (z11 - z01 || 0.0001)) * (x1 - x0), y1, L];
          const pLeft   = [x0, y0 + ((L - z00) / (z01 - z00 || 0.0001)) * (y1 - y0), L];

          switch(code) {
            case 1: case 14: segments.push([pLeft, pBottom]); break;
            case 2: case 13: segments.push([pBottom, pRight]); break;
            case 3: case 12: segments.push([pLeft, pRight]); break;
            case 4: case 11: segments.push([pRight, pTop]); break;
            case 5: segments.push([pLeft, pTop]); segments.push([pBottom, pRight]); break;
            case 6: case 9: segments.push([pBottom, pTop]); break;
            case 7: case 8: segments.push([pLeft, pTop]); break;
            case 10: segments.push([pLeft, pBottom]); segments.push([pTop, pRight]); break;
          }
        }
      }

      if (segments.length > 0) {
        contours.push({ elevation: L, isMajor, segments });
      }
    }

    return contours;
  }

  function downloadContoursDxf() {
    const statusEl = document.getElementById("contourExportStatus");
    if (statusEl) { statusEl.classList.remove("hidden"); statusEl.textContent = "Generating 3D CAD DXF file..."; }

    setTimeout(() => {
      try {
        const minorStep = parseFloat(document.getElementById("infoContourInterval")?.value || 2);
        const majorStep = parseFloat(document.getElementById("infoMajorInterval")?.value || 10);
        const contours = extractContourPolylines(minorStep, majorStep);

        let dxf = "";
        dxf += "0\nSECTION\n2\nHEADER\n0\nENDSEC\n";
        dxf += "0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n2\n";
        dxf += "0\nLAYER\n2\nCONTOURS_MAJOR\n70\n0\n62\n1\n6\nCONTINUOUS\n";
        dxf += "0\nLAYER\n2\nCONTOURS_MINOR\n70\n0\n62\n8\n6\nCONTINUOUS\n";
        dxf += "0\nENDTAB\n0\nENDSEC\n";
        dxf += "0\nSECTION\n2\nENTITIES\n";

        let totalLines = 0;
        contours.forEach(c => {
          const layerName = c.isMajor ? "CONTOURS_MAJOR" : "CONTOURS_MINOR";
          c.segments.forEach(seg => {
            const [p1, p2] = seg;
            dxf += `0\nLINE\n8\n${layerName}\n`;
            dxf += `10\n${p1[0].toFixed(3)}\n20\n${p1[1].toFixed(3)}\n30\n${p1[2].toFixed(2)}\n`;
            dxf += `11\n${p2[0].toFixed(3)}\n21\n${p2[1].toFixed(3)}\n31\n${p2[2].toFixed(2)}\n`;
            totalLines++;
          });
        });

        dxf += "0\nENDSEC\n0\nEOF\n";

        const blob = new Blob([dxf], { type: "application/dxf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const projName = activeProject?.folderName || "site";
        a.href = url;
        a.download = `${projName}_contours_${minorStep}m_${majorStep}m.dxf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (statusEl) {
          statusEl.textContent = `✓ Downloaded ${totalLines} contour lines (.dxf)`;
          setTimeout(() => statusEl.classList.add("hidden"), 4000);
        }
      } catch (err) {
        console.error("DXF export error", err);
        if (statusEl) statusEl.textContent = "⚠️ Export failed: " + err.message;
      }
    }, 60);
  }

  function downloadContoursGeoJson() {
    const statusEl = document.getElementById("contourExportStatus");
    if (statusEl) { statusEl.classList.remove("hidden"); statusEl.textContent = "Generating GeoJSON contours..."; }

    setTimeout(() => {
      try {
        const minorStep = parseFloat(document.getElementById("infoContourInterval")?.value || 2);
        const majorStep = parseFloat(document.getElementById("infoMajorInterval")?.value || 10);
        const contours = extractContourPolylines(minorStep, majorStep);

        const features = [];
        contours.forEach(c => {
          c.segments.forEach(seg => {
            features.push({
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: [
                  [seg[0][0], seg[0][1], seg[0][2]],
                  [seg[1][0], seg[1][1], seg[1][2]]
                ]
              },
              properties: {
                elevation: c.elevation,
                isMajor: c.isMajor,
                layer: c.isMajor ? "CONTOURS_MAJOR" : "CONTOURS_MINOR",
                unit: "meters"
              }
            });
          });
        });

        const geojson = {
          type: "FeatureCollection",
          crs: {
            type: "name",
            properties: { name: activeProject?.crs || "urn:ogc:def:crs:OGC:1.3:CRS84" }
          },
          features
        };

        const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: "application/geo+json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const projName = activeProject?.folderName || "site";
        a.href = url;
        a.download = `${projName}_contours.geojson`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (statusEl) {
          statusEl.textContent = `✓ Downloaded ${features.length} GeoJSON contours`;
          setTimeout(() => statusEl.classList.add("hidden"), 4000);
        }
      } catch(err) {
        console.error("GeoJSON export error", err);
        if (statusEl) statusEl.textContent = "⚠️ Export failed: " + err.message;
      }
    }, 60);
  }

  function downloadHeatmapPng() {
    const statusEl = document.getElementById("heatmapExportStatus");
    if (statusEl) { statusEl.classList.remove("hidden"); statusEl.textContent = "Rendering image with safety legend..."; }

    setTimeout(() => {
      try {
        const canvas3D = instance?.renderer?.domElement || document.querySelector("#viewerContainer canvas") || document.querySelector("canvas");
        if (!canvas3D) throw new Error("3D Canvas not found");

        if (instance) instance.notifyChange();

        const outCanvas = document.createElement("canvas");
        outCanvas.width = canvas3D.width || 1920;
        outCanvas.height = canvas3D.height || 1080;
        const ctx = outCanvas.getContext("2d");

        // Draw WebGL scene
        ctx.drawImage(canvas3D, 0, 0, outCanvas.width, outCanvas.height);

        // Draw Slope Safety Legend Overlay in Bottom-Left Corner
        const legendW = 280;
        const legendH = 150;
        const marginX = 24;
        const marginY = outCanvas.height - legendH - 24;

        // Glass card background
        ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
        ctx.strokeStyle = "rgba(14, 165, 233, 0.4)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(marginX, marginY, legendW, legendH, 12);
        } else {
          ctx.rect(marginX, marginY, legendW, legendH);
        }
        ctx.fill();
        ctx.stroke();

        // Title
        ctx.fillStyle = "#38bdf8";
        ctx.font = "bold 13px sans-serif";
        ctx.fillText("SLOPE HEATMAP & SAFETY ANALYSIS", marginX + 14, marginY + 24);

        const modeRadio = document.querySelector('input[name="infoHeatmapMode"]:checked') || { value: "predefined" };
        const isHaulRoad = modeRadio.value === "haulroad";

        const items = isHaulRoad ? [
          { color: "#22c55e", label: "0° – 5° (Excellent Safety)" },
          { color: "#eab308", label: "5° – 8° (Acceptable Grade)" },
          { color: "#f97316", label: "8° – 10° (Caution / Moderate)" },
          { color: "#ef4444", label: "> 10° (Unsafe for Haulage)" }
        ] : [
          { color: "#22c55e", label: "0° – 15° (Flat Terrain)" },
          { color: "#eab308", label: "15° – 30° (Moderate Slope)" },
          { color: "#f97316", label: "30° – 45° (Steep Pitch)" },
          { color: "#ef4444", label: "> 45° (Extreme Gradient)" }
        ];

        let rowY = marginY + 46;
        items.forEach(item => {
          ctx.fillStyle = item.color;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(marginX + 14, rowY - 10, 14, 14, 3);
          } else {
            ctx.rect(marginX + 14, rowY - 10, 14, 14);
          }
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.3)";
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = "#f1f5f9";
          ctx.font = "11px sans-serif";
          ctx.fillText(item.label, marginX + 36, rowY + 1);
          rowY += 22;
        });

        // Project watermark in top-right
        ctx.fillStyle = "rgba(15, 23, 42, 0.75)";
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(outCanvas.width - 220, 20, 200, 48, 8);
        } else {
          ctx.rect(outCanvas.width - 220, 20, 200, 48);
        }
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 12px sans-serif";
        const projTitle = activeProject?.folderName || "Polygon Site";
        ctx.fillText(`Project: ${projTitle}`, outCanvas.width - 208, 40);
        ctx.fillStyle = "#94a3b8";
        ctx.font = "10px sans-serif";
        ctx.fillText(new Date().toLocaleDateString(), outCanvas.width - 208, 56);

        outCanvas.toBlob(blob => {
          if (!blob) throw new Error("Canvas toBlob failed");
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${projTitle}_slope_heatmap_${isHaulRoad ? 'haulroad' : 'gradient'}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          if (statusEl) {
            statusEl.textContent = "✓ Downloaded High-Res Heatmap (.png)";
            setTimeout(() => statusEl.classList.add("hidden"), 4000);
          }
        }, "image/png");

      } catch(err) {
        console.error("Heatmap PNG export error", err);
        if (statusEl) statusEl.textContent = "⚠️ Export failed: " + err.message;
      }
    }, 60);
  }

  document.getElementById("btnExportContourDxf")?.addEventListener("click", downloadContoursDxf);
  document.getElementById("btnExportContourGeoJson")?.addEventListener("click", downloadContoursGeoJson);
  document.getElementById("btnExportHeatmapPng")?.addEventListener("click", downloadHeatmapPng);

  // -------------------------------------------------------------------------
  // ROI (Region Of Interest) rectangle clipping
  // -------------------------------------------------------------------------
  const selectROI = document.getElementById("selectROI");
  const btnDrawPolyRoi = document.getElementById("btnDrawPolyRoi");
  const resetROI = document.getElementById("resetROI");
  const roiHeader = document.getElementById("roiHeader");
  const roiSettings = document.getElementById("roiSettings");
  const roiCarrot = document.getElementById("roiCarrot");

  roiHeader?.addEventListener("click", () => {
    const show = roiSettings.style.display === "none";
    roiSettings.style.display = show ? "block" : "none";
    roiCarrot.textContent = show ? "▼" : "▲";
  });
  const roiHint = document.getElementById("roiHint");
  const roiMetrics = document.getElementById("roiMetrics");
  const roiPerimeter = document.getElementById("roiPerimeter");
  const roiArea = document.getElementById("roiArea");

  let roiState = "IDLE"; // IDLE | SELECTING
  let roiDragging = false;
  let roiStart = null; // world coord (Vector3) of drag start
  let roiEnd = null; // world coord (Vector3) of drag end

  // -------------------------------------------------------------------------
  // Unified Fixed Info Panel & Standardized Save Workflow Controller
  // -------------------------------------------------------------------------
  const unifiedInfoPanel = document.getElementById("unifiedInfoPanel");
  const unifiedInfoTitle = document.getElementById("unifiedInfoTitle");
  const closeInfoPanelBtn = document.getElementById("closeInfoPanelBtn");

  const universalSaveName = document.getElementById("universalSaveName");
  const universalSaveFolder = document.getElementById("universalSaveFolder");
  const btnUniversalSave = document.getElementById("btnUniversalSave");
  const btnUniversalNewFolder = document.getElementById("btnUniversalNewFolder");

  // ── Scoped Dynamic Folder Stores (Path Profiles & Volumes) ──
  const knownProfileFolders = new Set();
  const knownVolumeFolders = new Set();

  function loadStoredFolders() {
    try {
      const storedProfiles = localStorage.getItem("polygon_profile_folders");
      if (storedProfiles !== null) {
        const parsed = JSON.parse(storedProfiles);
        if (Array.isArray(parsed)) {
          knownProfileFolders.clear();
          parsed.forEach(f => {
            if (f && typeof f === "string" && f.trim() !== "") knownProfileFolders.add(f.trim());
          });
        }
      }

      const storedVolumes = localStorage.getItem("polygon_volume_folders");
      if (storedVolumes !== null) {
        const parsed = JSON.parse(storedVolumes);
        if (Array.isArray(parsed)) {
          knownVolumeFolders.clear();
          parsed.forEach(f => {
            if (f && typeof f === "string" && f.trim() !== "") knownVolumeFolders.add(f.trim());
          });
        }
      }
    } catch(e) {
      console.error("Error loading stored folders", e);
    }
  }

  function saveStoredFolders() {
    try {
      localStorage.setItem("polygon_profile_folders", JSON.stringify(Array.from(knownProfileFolders)));
      localStorage.setItem("polygon_volume_folders", JSON.stringify(Array.from(knownVolumeFolders)));
    } catch(e) {}
  }

  function addKnownProfileFolder(folderName, autoSync = true, selectTarget = null) {
    if (!folderName || typeof folderName !== "string") return;
    const trimmed = folderName.trim();
    if (trimmed === "") return;
    knownProfileFolders.add(trimmed);
    saveStoredFolders();
    if (autoSync) syncFolderDropdowns("PROFILE", selectTarget || trimmed);
  }

  function addKnownVolumeFolder(folderName, autoSync = true, selectTarget = null) {
    if (!folderName || typeof folderName !== "string") return;
    const trimmed = folderName.trim();
    if (trimmed === "") return;
    knownVolumeFolders.add(trimmed);
    saveStoredFolders();
    if (autoSync) syncFolderDropdowns("VOLUME", selectTarget || trimmed);
  }

  // Backward compatibility alias
  function addKnownFolder(folderName, autoSync = true, selectTarget = null) {
    addKnownVolumeFolder(folderName, autoSync, selectTarget);
  }

  function syncFolderDropdowns(toolType = null, selectedFolder = null) {
    const targetTool = toolType || activeInfoTool || "PROFILE";
    const select = document.getElementById("universalSaveFolder");
    const volSelect = document.getElementById("volSaveFolder");

    const volumeList = Array.from(knownVolumeFolders).sort();

    if (select) {
      const folderSet = (targetTool === "PROFILE") ? knownProfileFolders : knownVolumeFolders;
      const currentVal = selectedFolder || select.value || "General";
      
      select.innerHTML = "";
      Array.from(folderSet).sort().forEach(folder => {
        const option = document.createElement("option");
        option.value = folder;
        option.textContent = folder;
        select.appendChild(option);
      });

      if (folderSet.has(currentVal)) {
        select.value = currentVal;
      } else if (select.options.length > 0) {
        select.selectedIndex = 0;
      }
    }

    if (volSelect) {
      const currentVal = selectedFolder || volSelect.value || "General";
      volSelect.innerHTML = "";
      volumeList.forEach(folder => {
        const option = document.createElement("option");
        option.value = folder;
        option.textContent = folder;
        volSelect.appendChild(option);
      });
      if (knownVolumeFolders.has(currentVal)) {
        volSelect.value = currentVal;
      }
    }
  }

  loadStoredFolders();
  setTimeout(() => syncFolderDropdowns("PROFILE"), 100);

  const infoViewProfile = document.getElementById("infoViewProfile");
  const infoViewVolume = document.getElementById("infoViewVolume");
  const infoViewBoxRoi = document.getElementById("infoViewBoxRoi");
  const infoViewPolyRoi = document.getElementById("infoViewPolyRoi");
  const infoViewPoint = document.getElementById("infoViewPoint");

  // Central Universal Save Modal Elements
  const universalSaveModal = document.getElementById("universalSaveModal");
  const btnCloseSaveModal = document.getElementById("btnCloseSaveModal");
  const btnCancelSaveModal = document.getElementById("btnCancelSaveModal");
  const saveModalTypeBadge = document.getElementById("saveModalTypeBadge");
  const saveModalMetricsPreview = document.getElementById("saveModalMetricsPreview");
  const saveModalTitle = document.getElementById("saveModalTitle");

  let activeInfoTool = null;
  let activeToolSaveData = null;

  function openUniversalSaveModal() {
    if (!universalSaveModal) return;
    universalSaveModal.classList.remove("hidden");
    if (universalSaveName) {
      universalSaveName.classList.remove("input-invalid");
      universalSaveName.value = "";
      setTimeout(() => universalSaveName.focus(), 60);
    }

    if (activeInfoTool === "PROFILE") {
      if (saveModalTypeBadge) saveModalTypeBadge.textContent = "📈 Path Profile";
      const dist3D = document.getElementById("profile3D")?.textContent || "0.00 m";
      if (saveModalMetricsPreview) saveModalMetricsPreview.textContent = `3D: ${dist3D}`;
    } else if (activeInfoTool === "VOLUME") {
      if (saveModalTypeBadge) saveModalTypeBadge.textContent = "🧊 Volume Area";
      const cut = document.getElementById("volMiniCut")?.textContent || "0 m3";
      const fill = document.getElementById("volMiniFill")?.textContent || "0 m3";
      if (saveModalMetricsPreview) saveModalMetricsPreview.textContent = `Cut: ${cut} | Fill: ${fill}`;
    } else if (activeInfoTool === "BOX_ROI" || activeInfoTool === "POLY_ROI") {
      if (saveModalTypeBadge) saveModalTypeBadge.textContent = "✂️ ROI Boundary";
      const area = (document.getElementById("boxRoiArea") || document.getElementById("polyRoiArea"))?.textContent || "0 m²";
      if (saveModalMetricsPreview) saveModalMetricsPreview.textContent = `Area: ${area}`;
    } else if (activeInfoTool === "POINT") {
      if (saveModalTypeBadge) saveModalTypeBadge.textContent = "📍 Point Pin";
      const elev = document.getElementById("pointMiniElev")?.textContent || "-";
      if (saveModalMetricsPreview) saveModalMetricsPreview.textContent = `Elev: ${elev}`;
    }
    syncFolderDropdowns(activeInfoTool);
  }

  function closeUniversalSaveModal() {
    if (universalSaveModal) universalSaveModal.classList.add("hidden");
  }

  btnCloseSaveModal?.addEventListener("click", closeUniversalSaveModal);
  btnCancelSaveModal?.addEventListener("click", closeUniversalSaveModal);

  document.getElementById("btnSaveFromInfoProfile")?.addEventListener("click", openUniversalSaveModal);
  document.getElementById("btnSaveFromInfoVolume")?.addEventListener("click", openUniversalSaveModal);
  document.getElementById("btnSaveFromInfoBoxRoi")?.addEventListener("click", openUniversalSaveModal);
  document.getElementById("btnSaveFromInfoPolyRoi")?.addEventListener("click", openUniversalSaveModal);
  document.getElementById("btnSaveFromInfoPoint")?.addEventListener("click", openUniversalSaveModal);

  // -------------------------------------------------------------------------
  // Floating Quick-Info Popover Logic (Hover Card for list rows)
  // -------------------------------------------------------------------------
  const quickInfoPopover = document.getElementById("quickInfoPopover");
  const popoverTitle = document.getElementById("popoverTitle");
  const popoverBadge = document.getElementById("popoverBadge");
  const popoverBody = document.getElementById("popoverBody");

  function showQuickInfoPopover(targetEl, type, title, rows) {
    if (!quickInfoPopover || !targetEl) return;
    if (popoverTitle) popoverTitle.textContent = title || "Details";
    if (popoverBadge) popoverBadge.textContent = type || "Info";
    
    let html = '<div class="popover-grid">';
    (rows || []).forEach(r => {
      html += `
        <div class="popover-row">
          <span class="popover-label">${r.label}</span>
          <span class="popover-value">${r.val}</span>
        </div>
      `;
    });
    html += '</div>';
    if (popoverBody) popoverBody.innerHTML = html;

    const rect = targetEl.getBoundingClientRect();
    
    let top = rect.top + (rect.height / 2) - 40;
    let left = rect.right + 12;

    if (left + 280 > window.innerWidth) {
      left = Math.max(10, rect.left - 290);
    }
    if (top + 180 > window.innerHeight) {
      top = Math.max(10, window.innerHeight - 190);
    }
    if (top < 10) top = 10;

    quickInfoPopover.style.top = `${top}px`;
    quickInfoPopover.style.left = `${left}px`;
    quickInfoPopover.style.display = "block";
    quickInfoPopover.classList.remove("hidden");
    requestAnimationFrame(() => {
      quickInfoPopover.classList.add("visible");
    });
  }

  function hideQuickInfoPopover() {
    if (!quickInfoPopover) return;
    quickInfoPopover.classList.remove("visible");
    setTimeout(() => {
      if (!quickInfoPopover.classList.contains("visible")) {
        quickInfoPopover.style.display = "none";
        quickInfoPopover.classList.add("hidden");
      }
    }, 150);
  }

  function showUnifiedInfoPanel(toolType, headerText, data, isSavedView = false) {
    activeInfoTool = toolType;
    activeToolSaveData = data;

    if (unifiedInfoTitle) unifiedInfoTitle.textContent = headerText || "INFORMATION PANEL";
    
    // Clear validation error state & reset name input
    if (universalSaveName) {
      universalSaveName.classList.remove("input-invalid");
      universalSaveName.value = "";
    }

    // Hide all viewports first
    const infoViewGrid = document.getElementById("infoViewGrid");
    const infoViewHeatmap = document.getElementById("infoViewHeatmap");
    const infoViewContour = document.getElementById("infoViewContour");
    [infoViewProfile, infoViewVolume, infoViewBoxRoi, infoViewPolyRoi, infoViewPoint, infoViewGrid, infoViewHeatmap, infoViewContour].forEach(el => el?.classList.add("hidden"));

    // Toggle visibility of Save buttons inside viewports
    document.querySelectorAll(".info-save-btn").forEach(btn => {
      btn.style.display = isSavedView ? "none" : "flex";
    });

    // Display active tool viewport
    if (toolType === "PROFILE" && infoViewProfile) {
      infoViewProfile.classList.remove("hidden");
      // CRITICAL: un-hide the chart container (clearMeasure hides it)
      if (elevationMiniContainer) elevationMiniContainer.classList.remove("hidden");
      // Destroy stale 0x0 chart so it gets recreated at correct size
      if (miniChart && miniChart.width === 0) {
        miniChart.destroy();
        miniChart = null;
      }
      setTimeout(() => {
        initCharts();
        if (miniChart) {
          miniChart.resize();
          miniChart.update();
        }
      }, 100);
    }
    if (toolType === "VOLUME" && infoViewVolume) infoViewVolume.classList.remove("hidden");
    if (toolType === "BOX_ROI" && infoViewBoxRoi) infoViewBoxRoi.classList.remove("hidden");
    if (toolType === "POLY_ROI" && infoViewPolyRoi) infoViewPolyRoi.classList.remove("hidden");
    if (toolType === "POINT" && infoViewPoint) infoViewPoint.classList.remove("hidden");
    if (toolType === "GRID" && infoViewGrid) infoViewGrid.classList.remove("hidden");
    if (toolType === "HEATMAP" && infoViewHeatmap) infoViewHeatmap.classList.remove("hidden");
    if (toolType === "CONTOUR" && infoViewContour) infoViewContour.classList.remove("hidden");

    if (unifiedInfoPanel) unifiedInfoPanel.classList.remove("hidden");
  }

  closeInfoPanelBtn?.addEventListener("click", () => {
    if (unifiedInfoPanel) unifiedInfoPanel.classList.add("hidden");
    closeUniversalSaveModal();
    activeInfoTool = null;
    activeToolSaveData = null;
  });

  // Universal Feature Storage Helper
  function saveFeatureItem(type, name, folder, data) {
    const activeSurveyKey = `${activeProject?.folderName || activeProject}_${activeProject?.surveyId || 'default'}`;
    let saved = JSON.parse(localStorage.getItem(`features_${activeSurveyKey}`) || "[]");
    saved.push({
      id: Date.now(),
      type: type,
      name: name,
      folder: folder,
      timestamp: new Date().toISOString(),
      data: data
    });
    localStorage.setItem(`features_${activeSurveyKey}`, JSON.stringify(saved));
    if (typeof updateFeaturesListUI === 'function') updateFeaturesListUI();
  }

  // Compulsory Name Validation & Universal Save Handler
  btnUniversalSave?.addEventListener("click", async () => {
    const nameVal = universalSaveName ? universalSaveName.value.trim() : "";
    if (!nameVal) {
      if (universalSaveName) {
        universalSaveName.classList.add("input-invalid");
        universalSaveName.focus();
      }
      alert("⚠️ COMPULSORY: Please enter a Name before saving!");
      return;
    }

    if (universalSaveName) universalSaveName.classList.remove("input-invalid");
    const folderVal = universalSaveFolder ? universalSaveFolder.value : "General";
    const apiUrl = "https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url";

    const originalText = btnUniversalSave.textContent;
    btnUniversalSave.textContent = "Saving...";
    btnUniversalSave.disabled = true;

    try {
      if (!activeProject) throw new Error("No active project");

      if (activeInfoTool === "PROFILE") {
        // ── Upload PDF + JSON to S3 (same as btnSaveToSurvey) ──
        const safeReportName = nameVal.replace(/\s+/g, '_');

        const doc = generateReportPDF(nameVal);
        const pdfBlob = doc.output('blob');

        const metadata = {
          isOfficial: !window.isDumpDraw,
          folder: folderVal,
          name: nameVal,
          startPoint: measureStartPoint ? { x: measureStartPoint.x, y: measureStartPoint.y, z: measureStartPoint.z } : null,
          endPoint: measureEndPoint ? { x: measureEndPoint.x, y: measureEndPoint.y, z: measureEndPoint.z } : null,
          startCoord: measureStartCoord ? { x: measureStartCoord.x, y: measureStartCoord.y, z: measureStartCoord.z } : null,
          endCoord: measureEndCoord ? { x: measureEndCoord.x, y: measureEndCoord.y, z: measureEndCoord.z } : null,
          chartData: {
            distances: miniChart?.data.labels || [],
            elevations: miniChart?.data.datasets[0].data || [],
            currentProfileData: currentProfileData,
            totalDist: parseFloat(document.getElementById("profileHoriz")?.textContent) || 0,
            elevChange: parseFloat(document.getElementById("profileVert")?.textContent) || 0,
            surfDist: parseFloat(document.getElementById("profile3D")?.textContent) || 0
          }
        };
        const jsonBlob = new Blob([JSON.stringify(metadata)], { type: "application/json" });

        // Upload PDF
        const pdfRes = await fetch(apiUrl, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: activeProject.folderName, surveyId: activeProject.surveyId, type: "reports", fileName: `${safeReportName}.pdf` })
        });
        if (!pdfRes.ok) throw new Error("Failed to get PDF upload URL");
        const { uploadUrl: pdfUploadUrl } = await pdfRes.json();
        const pdfPut = await fetch(pdfUploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: pdfBlob });
        if (!pdfPut.ok) throw new Error("Failed to upload PDF to S3");

        // Upload JSON
        const jsonRes = await fetch(apiUrl, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: activeProject.folderName, surveyId: activeProject.surveyId, type: "reports", fileName: `${safeReportName}.json` })
        });
        if (!jsonRes.ok) throw new Error("Failed to get JSON upload URL");
        const { uploadUrl: jsonUploadUrl } = await jsonRes.json();
        const jsonPut = await fetch(jsonUploadUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: jsonBlob });
        if (!jsonPut.ok) throw new Error("Failed to upload JSON to S3");

        fetchSavedReports();

      } else if (activeInfoTool === "VOLUME") {
        // ── Upload Volume JSON to S3 (same as btnConfirmVolSave) ──
        const data = {
          name: nameVal,
          folder: folderVal,
          isOfficial: !window.isDumpDraw,
          timestamp: new Date().toISOString(),
          area2D: document.getElementById("volMiniArea")?.textContent || "0",
          perimeter: document.getElementById("volMiniPerim")?.textContent || "0",
          cutVolume: document.getElementById("volMiniCut")?.textContent || "0",
          fillVolume: document.getElementById("volMiniFill")?.textContent || "0",
          points: volumePoints.map(p => ({ x: p.coord.x, y: p.coord.y, z: p.coord.z }))
        };

        const safeName = nameVal.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const fileName = `${folderVal}/${safeName}_${Date.now()}.json`;

        const volRes = await fetch(apiUrl, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: activeProject.folderName, surveyId: activeProject.surveyId, type: "volumes", fileName })
        });
        if (!volRes.ok) throw new Error("Failed to get volume upload URL");
        const { uploadUrl } = await volRes.json();

        const putRes = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data, null, 2) });
        if (!putRes.ok) throw new Error("Failed to upload volume JSON to S3");

        fetchSavedVolumes();

      } else {
        // Fallback: localStorage for other types (BOX_ROI, POLY_ROI, POINT)
        if (activeToolSaveData) saveFeatureItem(activeInfoTool?.toLowerCase(), nameVal, folderVal, activeToolSaveData);
      }

      alert(`✅ Saved "${nameVal}" to folder '${folderVal}'!`);
      closeUniversalSaveModal();
      showUnifiedInfoPanel(activeInfoTool, "SAVED ITEM", null, true);

    } catch(err) {
      console.error("Save error:", err);
      alert("Error saving item: " + err.message);
    } finally {
      btnUniversalSave.textContent = originalText;
      btnUniversalSave.disabled = false;
    }
  });

  btnUniversalNewFolder?.addEventListener("click", () => {
    const isProfile = activeInfoTool === "PROFILE";
    const typeLabel = isProfile ? "Path Profile" : "Volume";
    const newFolder = prompt(`Enter new folder name for ${typeLabel}:`);
    if (newFolder && newFolder.trim() !== "") {
      const trimmed = newFolder.trim();
      if (isProfile) {
        addKnownProfileFolder(trimmed, true, trimmed);
        fetchSavedReports();
      } else {
        addKnownVolumeFolder(trimmed, true, trimmed);
        fetchSavedVolumes();
      }
    }
  });

  const roiSvg = document.getElementById("roiSvg");
  const roiFaceTop = document.getElementById("roiFaceTop");
  const roiFaceRight = document.getElementById("roiFaceRight");
  const roiFaceBottom = document.getElementById("roiFaceBottom");
  const roiDepthEdges = document.getElementById("roiDepthEdges");
  const roiCornerDots = document.getElementById("roiCornerDots");
  let roiDragStartScreen = null;

  // Isometric depth offset for the 2.5D box overlay.
  const DEPTH_X = 28;
  const DEPTH_Y = -28;

  // Reset ROI interaction state (does not restore the terrain clip).
  function resetRoiState() {
    roiState = "IDLE";
    roiDragging = false;
    roiStart = null;
    roiEnd = null;
    document.body.classList.remove("roi-selecting");
    if (selectROI) selectROI.classList.remove("active");
    if (roiHint) roiHint.textContent = "Click 'Select ROI' to start drawing a rectangle.";
    if (roiMetrics) roiMetrics.classList.add("hidden");
    controls.enabled = true;
    
    const mainRoiBtn = document.getElementById("mainRoiBtn");
    if (mainRoiBtn) {
      mainRoiBtn.classList.remove("active", "overlay-active");
    }
    const btnLeftBoxRoi = document.getElementById("btnLeftBoxRoi");
    const btnLeftPolyRoi = document.getElementById("btnLeftPolyRoi");
    const btnLeftKmlRoi = document.getElementById("btnLeftKmlRoi");
    [optRoiRect, optRoiPoly, optRoiKml, btnLeftBoxRoi, btnLeftPolyRoi, btnLeftKmlRoi].forEach(btn => btn?.classList.remove("active"));
    const roiSvg = document.getElementById("roiSvg");
    if (roiSvg) roiSvg.style.display = "none";
  }

  // Unified ROI Sub-Panel Controls
  const mainRoiBtn = document.getElementById("mainRoiBtn");
  const mainRoiIcon = document.getElementById("mainRoiIcon");
  const optRoiRect = document.getElementById("optRoiRect");
  const optRoiPoly = document.getElementById("optRoiPoly");
  const optRoiKml = document.getElementById("optRoiKml");

  const ROI_ICONS = {
    RECT: `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line>`,
    POLY: `<polygon points="12 2 22 8.5 18 20 6 20 2 8.5 12 2"></polygon>`,
    KML: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line>`
  };

  let activeRoiMode = "RECT";

  function setActiveRoiSubMode(mode) {
    activeRoiMode = mode;
    if (mainRoiIcon && ROI_ICONS[mode]) {
      mainRoiIcon.innerHTML = ROI_ICONS[mode];
    }
  }

  function triggerRectRoi() {
    const mainRoiBtn = document.getElementById("mainRoiBtn");
    if (mainRoiBtn && mainRoiBtn.classList.contains("overlay-active") && roiState === "SELECTING") {
      resetRoiState();
      return;
    }
    resetRoiState();
    roiState = "SELECTING";
    measureState = "IDLE";
    controls.enabled = false;
    document.body.classList.add("roi-selecting");
    if (mainRoiBtn) mainRoiBtn.classList.add("active", "overlay-active");
    if (optRoiRect) optRoiRect.classList.add("active");
    if (selectROI) selectROI.classList.add("active");
    if (roiHint) roiHint.textContent = "Click and drag on the terrain to draw a clipping rectangle.";
    if (resetROI) resetROI.disabled = false;
    setLiveGuidance("📐", "Click and drag over the map to draw a rectangular clipping box.");
  }

  const roiHorizontalBar = document.getElementById("roiHorizontalBar");
  const roiWrapper = document.getElementById("roiWrapper");

  mainRoiBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (roiHorizontalBar) {
      const isOpen = roiHorizontalBar.classList.toggle("open");
      if (isOpen) {
        if (unifiedInfoPanel) unifiedInfoPanel.classList.add("hidden");
        if (topSaveBar) topSaveBar.classList.add("hidden");
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

  const btnLeftBoxRoi = document.getElementById("btnLeftBoxRoi");
  const btnLeftPolyRoi = document.getElementById("btnLeftPolyRoi");
  const btnLeftKmlRoi = document.getElementById("btnLeftKmlRoi");
  const btnResetRoiLeft = document.getElementById("btnResetRoiLeft");
  const leftRoisHeader = document.getElementById("leftRoisHeader");
  const leftRoisContent = document.getElementById("leftRoisContent");
  const leftRoisCarrot = document.getElementById("leftRoisCarrot");

  function highlightLeftRoiBtn(activeBtn) {
    [btnLeftBoxRoi, btnLeftPolyRoi, btnLeftKmlRoi].forEach(b => b?.classList.remove("active"));
    if (activeBtn) activeBtn.classList.add("active");
  }

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
    const resetRoiBtn = document.getElementById("resetROI");
    if (resetRoiBtn) resetRoiBtn.click();
    if (map) map.clippingPlanes = [];
  });

  leftRoisHeader?.addEventListener("click", () => {
    if (!leftRoisContent) return;
    const isHidden = leftRoisContent.style.display === "none";
    leftRoisContent.style.display = isHidden ? "block" : "none";
    if (leftRoisCarrot) leftRoisCarrot.textContent = isHidden ? "▼" : "▲";
  });

  function startRoiPolyDrawing(e) {
    const btn = mainRoiBtn || (e ? e.currentTarget : null);
    if (btn && btn.classList.contains("active") && measureMode === "ROI_POLY") {
      resetRoiState();
      measureState = "IDLE";
      measureMode = "NONE";
      btn.classList.remove("active");
      document.body.classList.remove("roi-selecting");
      controls.enabled = true;
      roiPolyPoints = [];
      updateRoiPolySvg();
      return;
    }
    resetRoiState();
    measureState = "SELECTING";
    measureMode = "ROI_POLY";
    controls.enabled = false;
    document.body.classList.add("roi-selecting");
    roiPolyPoints = [];
    roiPolyMousePoint = null;
    updateRoiPolySvg();
    if (roiMiniContainer) roiMiniContainer.classList.add("hidden");
    if (btn) btn.classList.add("active");
  }

  document.getElementById("btnDrawFeatureRoi")?.addEventListener("click", (e) => startRoiPolyDrawing(e));

  resetROI?.addEventListener("click", () => {
    resetRoiState();
    if (roiSvg) roiSvg.style.display = "none";
    
    if (typeof roiPolyPoints !== "undefined") roiPolyPoints = [];
    if (measureMode === "ROI_POLY" || measureState === "FINISHED_ROI_POLY") {
      measureState = "IDLE";
      measureMode = "NONE";
    }
    if (typeof updateRoiPolySvg === 'function') updateRoiPolySvg();
    
    // Clear KML boundary
    kmlWorldPoints = [];
    if (typeof updateKmlSvg === "function") updateKmlSvg();

    loadProject(activeProject, null); // reload full extent (un-clipped)
    resetROI.disabled = true;
  });

  const btnUploadKml = document.getElementById("btnUploadKml");
  const kmlUpload = document.getElementById("kmlUpload");
  const kmlSvg = document.getElementById("kmlSvg");
  const kmlLine = document.getElementById("kmlLine");
  let kmlWorldPoints = [];

  function updateKmlSvg() {
    if (!kmlWorldPoints.length) {
      if (kmlSvg) kmlSvg.style.display = "none";
      return;
    }
    
    // Check if the center point is behind the camera
    const testProj = kmlWorldPoints[0].clone().project(instance.view.camera);
    if (testProj.z > 1) {
      if (kmlSvg) kmlSvg.style.display = "none";
      return;
    }
    
    if (kmlSvg) kmlSvg.style.display = "block";
    const rect = canvas.getBoundingClientRect();
    
    const screenPoints = kmlWorldPoints.map(wp => {
      const p = wp.clone().project(instance.view.camera);
      const sx = ((p.x + 1) / 2) * rect.width;
      const sy = ((-p.y + 1) / 2) * rect.height;
      return `${sx},${sy}`;
    });
    
    if (kmlLine) {
      kmlLine.setAttribute("d", "M " + screenPoints.join(" L ") + " Z");
    }
  }

  controls.addEventListener("change", updateKmlSvg);

  btnUploadKml?.addEventListener("click", () => {
    kmlUpload?.click();
  });

  kmlUpload?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, "text/xml");
      
      const coordsTags = xmlDoc.getElementsByTagName("coordinates");
      if (!coordsTags || coordsTags.length === 0) {
        alert("No coordinates found in KML file.");
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
            
            // Convert from WGS84 to Map CRS
            const [x, y] = proj4("WGS84", "EPSG:3395", [lon, lat]);
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            hasValidCoords = true;
            kmlWorldPoints.push(new Vector3(x, y, activeProject.zOffset || 0));
          }
        }
      }
      
      if (hasValidCoords) {
        resetRoiState();
        if (roiSvg) roiSvg.style.display = "none";
        // Do NOT clip the terrain anymore. Just focus camera.
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const span = Math.max(maxX - minX, maxY - minY, 80);
        setCameraTopDown(cx, cy, span);
        
        updateKmlSvg();
        if (roiHint) roiHint.textContent = "KML loaded! Red boundary is now visible. Click 'Reset' to clear.";
        if (resetROI) resetROI.disabled = false;
      } else {
        alert("Could not parse coordinates from KML.");
      }
    };
    reader.readAsText(file);
    kmlUpload.value = ""; // Reset input so same file can be uploaded again if needed
  });

  // Serialize [ [x,y], ... ] into an SVG points string.
  function pointsToString(points) {
    return points.map(([x, y]) => `${x},${y}`).join(" ");
  }

  // Draw the 2.5D ROI box between two screen points.
  function drawRoiBox(x1, y1, x2, y2) {
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

    // Top-face corners.
    const tl = [left, top];
    const tr = [right, top];
    const br = [right, bottom];
    const bl = [left, bottom];

    // Depth-extruded corners.
    const tlBack = [left + DEPTH_X, top + DEPTH_Y];
    const trBack = [right + DEPTH_X, top + DEPTH_Y];
    const brBack = [right + DEPTH_X, bottom + DEPTH_Y];

    roiFaceTop.setAttribute("points", pointsToString([tl, tr, br, bl]));
    roiFaceRight.setAttribute("points", pointsToString([tr, trBack, brBack, br]));
    roiFaceBottom.setAttribute("points", pointsToString([tl, tlBack, trBack, tr]));

    roiDepthEdges.innerHTML = [
      `<line x1="${tl[0]}" y1="${tl[1]}" x2="${tlBack[0]}" y2="${tlBack[1]}"/>`,
      `<line x1="${tr[0]}" y1="${tr[1]}" x2="${trBack[0]}" y2="${trBack[1]}"/>`,
      `<line x1="${br[0]}" y1="${br[1]}" x2="${brBack[0]}" y2="${brBack[1]}"/>`,
    ].join("");

    roiCornerDots.innerHTML = [tl, tr, br, bl]
      .map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="4"/>`)
      .join("");

    if (roiSvg) roiSvg.style.display = "block";
  }

  // Update perimeter / area readout from the world-space ROI rectangle.
  function updateRoiMetrics() {
    if (!roiStart || !roiEnd) return;
    const minX = Math.min(roiStart.x, roiEnd.x);
    const maxX = Math.max(roiStart.x, roiEnd.x);
    const minY = Math.min(roiStart.y, roiEnd.y);
    const maxY = Math.max(roiStart.y, roiEnd.y);
    const w = maxX - minX;
    const h = maxY - minY;
    const area = w * h;
    const perimeter = 2 * (w + h);
    if (area > 0) {
      roiMetrics.classList.remove("hidden");
      if (roiPerimeter) roiPerimeter.textContent = perimeter.toFixed(1);
      if (roiArea) roiArea.textContent = area.toFixed(1);
    }
  }

  canvas.addEventListener("mousedown", (e) => {
    if (roiState !== "SELECTING") return;
    const rect = canvas.getBoundingClientRect();
    const mouse = new Vector2(e.clientX - rect.left, e.clientY - rect.top);
    const picked = map.pick(mouse);
    if (!picked || picked.length === 0) return;
    roiDragging = true;
    roiDragStartScreen = { x: e.clientX, y: e.clientY };
    roiStart = picked[0].coord.clone();
    roiEnd = roiStart.clone();
    drawRoiBox(e.clientX, e.clientY, e.clientX, e.clientY);
  });

  canvas.addEventListener("mousemove", (e) => {
    if (roiState !== "SELECTING" || !roiDragging) return;
    const rect = canvas.getBoundingClientRect();
    const mouse = new Vector2(e.clientX - rect.left, e.clientY - rect.top);
    const picked = map.pick(mouse);
    drawRoiBox(roiDragStartScreen.x, roiDragStartScreen.y, e.clientX, e.clientY);
    if (picked && picked.length > 0) {
      roiEnd = picked[0].coord.clone();
      updateRoiMetrics();
    }
  });

  canvas.addEventListener("mouseup", () => {
    if (roiState !== "SELECTING" || !roiDragging) return;
    roiDragging = false;
    if (roiSvg) roiSvg.style.display = "none";
    if (!roiStart || !roiEnd) {
      resetRoiState();
      return;
    }
    const minX = Math.min(roiStart.x, roiEnd.x);
    const maxX = Math.max(roiStart.x, roiEnd.x);
    const minY = Math.min(roiStart.y, roiEnd.y);
    const maxY = Math.max(roiStart.y, roiEnd.y);
    if (Math.abs(maxX - minX) < 1 || Math.abs(maxY - minY) < 1) {
      resetRoiState();
      return;
    }
    // Reload the project clipped to the selected rectangle.
    const clipExtent = new Extent(giroCrs, minX, maxX, minY, maxY);
    const clipProject = getActiveProjectConfig();
    isTerrainClippedToRoi = true;
    loadProject(clipProject, clipExtent);

    roiState = "IDLE";
    document.body.classList.remove("roi-selecting");
    if (mainRoiBtn) mainRoiBtn.classList.remove("active");
    if (selectROI) selectROI.classList.remove("active");
    controls.enabled = true;
    if (resetROI) resetROI.disabled = false;
    if (roiHint) roiHint.textContent = "Terrain clipped! Click 'Reset' to restore the full view.";

    const boxW = Math.abs(maxX - minX);
    const boxH = Math.abs(maxY - minY);
    const boxArea = boxW * boxH;
    const boxPerim = 2 * (boxW + boxH);

    const boxPerimEl = document.getElementById("boxRoiPerim");
    const boxAreaEl = document.getElementById("boxRoiArea");
    if (boxPerimEl) boxPerimEl.textContent = boxPerim.toLocaleString(undefined, {maximumFractionDigits: 2}) + " m";
    if (boxAreaEl) boxAreaEl.textContent = boxArea.toLocaleString(undefined, {maximumFractionDigits: 2}) + " m²";

    showUnifiedInfoPanel("BOX_ROI", "BOX ROI ANALYSIS", { minX, maxX, minY, maxY, area: boxArea, perim: boxPerim });
  });

  // -------------------------------------------------------------------------
  // Measurement (distance / height)
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // Simple Measurement Tool
  // -------------------------------------------------------------------------
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
    const show = measureSimpleSettings.style.display === "none";
    measureSimpleSettings.style.display = show ? "block" : "none";
    measureSimpleCarrot.textContent = show ? "▲" : "▼";
  });

  // -------------------------------------------------------------------------
  // Path Profile Tool
  // -------------------------------------------------------------------------
  const profileHeader = document.getElementById("profileHeader");
  const profileCarrot = document.getElementById("profileCarrot");
  const profileSettings = document.getElementById("profileSettings");
  const btnProfile = document.getElementById("btnProfile");
  const btnClearProfile = document.getElementById("btnClearProfile");
  const profileResults = document.getElementById("profileResults");
  const profileHoriz = document.getElementById("profileHoriz");
  const profileVert = document.getElementById("profileVert");
  const profile3D = document.getElementById("profile3D");
  const profileHint = document.getElementById("profileHint");

  profileHeader?.addEventListener("click", () => {
    const show = profileSettings.style.display === "none";
    profileSettings.style.display = show ? "block" : "none";
    profileCarrot.textContent = show ? "▲" : "▼";
  });

  // -------------------------------------------------------------------------
  // Shared Drawing Logic
  // -------------------------------------------------------------------------
  const measureSvg = document.getElementById("measureSvg");
  const measureSvgLineHalo = document.getElementById("measureSvgLineHalo");
  const measureSvgPolylineHalo = document.getElementById("measureSvgPolylineHalo");
  const measureSvgLine = document.getElementById("measureSvgLine");
  const measureSvgPolyline = document.getElementById("measureSvgPolyline");
  const measureSvgStart = document.getElementById("measureSvgStart");
  const measureSvgEnd = document.getElementById("measureSvgEnd");

  // Point DOM Elements
  const pointSvg = document.getElementById("pointSvg");
  const pointSvgMarker = document.getElementById("pointSvgMarker");
  const pointMiniContainer = document.getElementById("pointMiniContainer");
  const closePointMiniBtn = document.getElementById("closePointMiniBtn");
  const pointMiniLon = document.getElementById("pointMiniLon");
  const pointMiniLat = document.getElementById("pointMiniLat");
  const pointMiniElev = document.getElementById("pointMiniElev");
  const pointSaveName = document.getElementById("pointSaveName");
  const btnConfirmPointSave = document.getElementById("btnConfirmPointSave");

  let measureState = "IDLE"; // IDLE | SELECTING | FINISHED | FINISHED_VOLUME | FINISHED_POINT
  let measureMode = "NONE"; // NONE | SIMPLE | PROFILE | REDRAW | VOLUME | POINT
  let measureStartPoint = null;
  let measureEndPoint = null;
  let measureStartCoord = null;
  let measureEndCoord = null;
  let currentProfilePoints3D = [];
  
  // Point Draw specific variables
  let pointDrawPoint = null;
  let pointDrawCoord = null; // geographic coord
  let measureDragScreenStart = null;
  let measureHasFirstTap = false;

  // Volume state
  let volumePoints = [];
  let roiPolyPoints = [];
  let roiPolyMousePoint = null;
  const roiMiniContainer = document.getElementById("roiMiniContainer");
  const closeRoiMiniBtn = document.getElementById("closeRoiMiniBtn");
  const roiSaveName = document.getElementById("roiSaveName");
  const btnConfirmRoiSave = document.getElementById("btnConfirmRoiSave");
  const featuresListRois = document.getElementById("featuresListRois");
 // Array of { point: Vector3, coord: Coordinates }
  let volumeMousePoint = null; // Vector3
  const volumeSvg = document.getElementById("volumeSvg");
  const volumePolygonHalo = document.getElementById("volumePolygonHalo");
  const volumePolygonSvg = document.getElementById("volumePolygonOverlay");
  const volumeVerticesSvg = document.getElementById("volumeVerticesOverlay");

  // Clear the current measurement overlay + points.
  function clearMeasure() {
    if (measureSvg) measureSvg.style.display = "none";
    if (measureSvgPolylineHalo) measureSvgPolylineHalo.style.display = "none";
    if (measureSvgPolyline) measureSvgPolyline.style.display = "none";
    if (measureSvgLineHalo) measureSvgLineHalo.style.display = "none";
    if (measureSvgLine) measureSvgLine.style.display = "none";
    if (elevationMiniContainer) elevationMiniContainer.classList.add("hidden");
    measureStartPoint = null;
    measureEndPoint = null;
    measureStartCoord = null;
    measureEndCoord = null;
    currentProfilePoints3D = [];
  }

  // Project a world-space point to screen pixel coordinates.
  function projectToScreen(worldPoint) {
    if (instance?.view?.camera) {
      instance.view.camera.updateMatrixWorld(true);
    }
    const ndc = worldPoint.clone().project(instance.view.camera);
    const rect = canvas.getBoundingClientRect();
    const x = ((ndc.x + 1) / 2) * rect.width;
    const y = ((-ndc.y + 1) / 2) * rect.height;
    return { x, y, z: ndc.z };
  }

  // Helper to position camera looking straight down (tilt = 0) scaled to feature span
  function setCameraTopDown(targetX, targetY, span = 300) {
    if (!instance || !instance.view || !instance.view.camera || !controls) return;
    const altitude = (activeProject?.zOffset || 0) + Math.max(span * 1.5, 150);
    instance.view.camera.position.set(targetX, targetY, altitude);
    controls.target.set(targetX, targetY, activeProject?.zOffset || 0);
    controls.update();
    if (instance.view.camera) instance.view.camera.updateMatrixWorld(true);
    instance.notifyChange(instance.view.camera);
  }

  // Redraw the measurement line so it "sticks" to the terrain as the camera moves.
  function updateMeasureSvg() {
    if (isMultiSelectReports && measureMode === "PROFILE") {
      if (measureSvg) measureSvg.style.display = "none";
      return;
    }
    if ((measureMode === "SIMPLE" || measureMode === "PROFILE") && measureStartPoint && measureEndPoint) {
      const start = projectToScreen(measureStartPoint);
      const end = projectToScreen(measureEndPoint);
      if (start.z > 1 && end.z > 1) {
        measureSvg.style.display = "none";
        return;
      }
      measureSvg.style.display = "block";
      
      measureSvgStart.setAttribute("cx", start.x);
      measureSvgStart.setAttribute("cy", start.y);
      measureSvgEnd.setAttribute("cx", end.x);
      measureSvgEnd.setAttribute("cy", end.y);

      // If finished profile with high-density draped terrain points, render smooth SVG polyline
      if (measureMode === "PROFILE" && currentProfilePoints3D.length >= 2) {
        let ptsStr = "";
        for (let i = 0; i < currentProfilePoints3D.length; i++) {
          const ptScreen = projectToScreen(currentProfilePoints3D[i]);
          if (ptScreen.z <= 1) {
            ptsStr += `${ptScreen.x.toFixed(1)},${ptScreen.y.toFixed(1)} `;
          }
        }
        if (measureSvgPolylineHalo) {
          measureSvgPolylineHalo.setAttribute("points", ptsStr);
          measureSvgPolylineHalo.style.display = "block";
        }
        if (measureSvgPolyline) {
          measureSvgPolyline.setAttribute("points", ptsStr);
          measureSvgPolyline.style.display = "block";
        }
        if (measureSvgLineHalo) measureSvgLineHalo.style.display = "none";
        if (measureSvgLine) measureSvgLine.style.display = "none";
      } else {
        // Active dragging or simple distance measurement
        if (measureSvgPolylineHalo) measureSvgPolylineHalo.style.display = "none";
        if (measureSvgPolyline) measureSvgPolyline.style.display = "none";
        if (measureSvgLineHalo) {
          measureSvgLineHalo.style.display = "block";
          measureSvgLineHalo.setAttribute("x1", start.x);
          measureSvgLineHalo.setAttribute("y1", start.y);
          measureSvgLineHalo.setAttribute("x2", end.x);
          measureSvgLineHalo.setAttribute("y2", end.y);
        }
        if (measureSvgLine) {
          measureSvgLine.style.display = "block";
          measureSvgLine.setAttribute("x1", start.x);
          measureSvgLine.setAttribute("y1", start.y);
          measureSvgLine.setAttribute("x2", end.x);
          measureSvgLine.setAttribute("y2", end.y);
        }
      }
    } else if (measureSvg) {
      measureSvg.style.display = "none";
    }
  }

  function updatePointSvg() {
    if ((measureMode === "POINT" || measureState === "FINISHED_POINT") && pointDrawPoint && pointSvg) {
      const p = projectToScreen(pointDrawPoint);
      if (p.z > 1) {
        pointSvg.style.display = "none";
        return;
      }
      pointSvgMarker.setAttribute("cx", p.x);
      pointSvgMarker.setAttribute("cy", p.y);
      pointSvg.style.display = "block";
    } else if (pointSvg) {
      pointSvg.style.display = "none";
    }
  }
  controls.addEventListener("change", updateMeasureSvg);

  // Redraw volume polygon
  
  function updateRoiPolySvg() {
    if ((measureMode === "ROI_POLY" || measureState === "FINISHED_ROI_POLY") && roiPolyPoints.length > 0) {
      let pointsAttr = "";
      if (volumeVerticesSvg) volumeVerticesSvg.innerHTML = "";
      
      for (const p of roiPolyPoints) {
        const screenP = projectToScreen(p.point);
        if (screenP.z <= 1) {
          pointsAttr += `${screenP.x},${screenP.y} `;
          if (volumeVerticesSvg) {
            const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            circle.setAttribute("cx", screenP.x);
            circle.setAttribute("cy", screenP.y);
            circle.setAttribute("r", "4");
            circle.setAttribute("fill", "#ffff00");
            circle.setAttribute("stroke", "#000");
            circle.setAttribute("stroke-width", "1.5");
            volumeVerticesSvg.appendChild(circle);
          }
        }
      }
      if (roiPolyMousePoint && measureState === "SELECTING") {
        const screenM = projectToScreen(roiPolyMousePoint);
        if (screenM.z <= 1) pointsAttr += `${screenM.x},${screenM.y} `;
      } else if (measureState === "FINISHED_ROI_POLY" && roiPolyPoints.length > 2) {
        const screen0 = projectToScreen(roiPolyPoints[0].point);
        if (screen0.z <= 1) pointsAttr += `${screen0.x},${screen0.y}`;
      }
      
      if (volumePolygonSvg) {
        volumePolygonSvg.setAttribute("points", pointsAttr.trim());
        volumePolygonSvg.setAttribute("fill", "none");
        volumePolygonSvg.setAttribute("stroke", "#8b5cf6");
        volumePolygonSvg.setAttribute("stroke-width", "2.5");
        volumePolygonSvg.style.display = "block";
      }
      if (volumeVerticesSvg) volumeVerticesSvg.style.display = "block";
      if (volumeSvg) volumeSvg.style.display = "block";
    } else if (measureMode !== "VOLUME" && measureState !== "FINISHED_VOLUME") {
      if (volumePolygonSvg) volumePolygonSvg.style.display = "none";
      if (volumeVerticesSvg) volumeVerticesSvg.style.display = "none";
      if (volumeSvg) volumeSvg.style.display = "none";
    }
  }
  controls.addEventListener("change", updateRoiPolySvg);

  function calculateRoiPolyMetrics() {
    if (roiPolyPoints.length < 3) return { area: 0, perimeter: 0 };
    let area = 0, perimeter = 0;
    for (let i = 0; i < roiPolyPoints.length; i++) {
      const p1 = roiPolyPoints[i].coord;
      const p2 = roiPolyPoints[(i + 1) % roiPolyPoints.length].coord;
      area += p1.x * p2.y - p2.x * p1.y;
      perimeter += Math.hypot(p2.x - p1.x, p2.y - p1.y);
    }
    area = Math.abs(area) / 2;
    if (roiArea) roiArea.textContent = area.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (roiPerimeter) roiPerimeter.textContent = perimeter.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (roiMetrics) roiMetrics.classList.remove("hidden");
    return { area, perimeter };
  }

  function applyRoiPolyClipping() {
    if (roiPolyPoints.length < 3) return;
    
    // 1. Bounding box uses geographic coords (for the Extent / data loading)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of roiPolyPoints) {
      if (p.coord.x < minX) minX = p.coord.x;
      if (p.coord.x > maxX) maxX = p.coord.x;
      if (p.coord.y < minY) minY = p.coord.y;
      if (p.coord.y > maxY) maxY = p.coord.y;
    }
    
    // 2. Load the project restricted to the bounding box
    const clipExtent = new Extent(giroCrs, minX, maxX, minY, maxY);
    const clipProject = activeProject || getActiveProjectConfig();
    
    updateStatus("Clipping Terrain to Polygon ROI...");
    
    loadProject(clipProject, clipExtent).then(() => {
        if (!map) return;
        
        // CRITICAL: Use geographic coords (coord.x/y) for plane math, but center them
        // first to bring values near zero (avoids float32 precision loss at ~8.5M meters).
        const numPoints = roiPolyPoints.length;
        let cx = 0, cy = 0;
        for (const p of roiPolyPoints) { cx += p.coord.x; cy += p.coord.y; }
        cx /= numPoints; cy /= numPoints;
        
        // Compute centered 2D points
        const pts2d = roiPolyPoints.map(p => ({ x: p.coord.x - cx, y: p.coord.y - cy }));
        
        // Determine winding order (signed area in centered coords)
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
          
          // Compute inward-facing normal
          let nx = isCCW ? dy : -dy;
          let ny = isCCW ? -dx : dx;
          
          const length = Math.hypot(nx, ny);
          if (length === 0) continue;
          nx /= length;
          ny /= length;
          
          // Plane normal (vertical plane, no Z clipping)
          const normal = new Vector3(nx, ny, 0);
          // Plane constant in centered space
          const constant = -(nx * p1.x + ny * p1.y);
          
          planes.push(new Plane(normal, constant));
        }
        
        // Translate planes back: since Three.js positions are NOT centered at (cx,cy),
        // we need to account for the fact that our planes were built in centered coords.
        // The plane equation is: n.dot(P - center) + c = 0 => n.dot(P) + (c - n.dot(center)) = 0
        // But Three.js scene uses local coords from map.worldToLocal, so we convert center:
        const mapCenter = map.worldToLocal(new Vector3(cx, cy, 0));
        for (const plane of planes) {
          plane.constant -= plane.normal.dot(mapCenter);
        }
        
        map.clippingPlanes = planes;
        isTerrainClippedToRoi = true;
        const dims = clipExtent.dimensions();
        const size = Math.max(dims.x, dims.y);
        const zOffset = clipProject?.zOffset || 0;
        instance.view.camera.position.set(cx, cy, zOffset + size * 2.4);
        controls.target.set(cx, cy, zOffset);
        controls.update();
        if (instance.view.camera) instance.view.camera.updateMatrixWorld(true);
        instance.notifyChange(instance.view.camera);
        updateRoiPolySvg();
        requestAnimationFrame(() => {
          if (instance?.view?.camera) instance.view.camera.updateMatrixWorld(true);
          updateRoiPolySvg();
        });

        let polyArea = Math.abs(signedArea) / 2;
        let polyPerim = 0;
        for (let i = 0; i < numPoints; i++) {
          const p1 = roiPolyPoints[i].coord;
          const p2 = roiPolyPoints[(i + 1) % numPoints].coord;
          polyPerim += Math.hypot(p2.x - p1.x, p2.y - p1.y);
        }

        const polyPerimEl = document.getElementById("polyRoiPerim");
        const polyAreaEl = document.getElementById("polyRoiArea");
        if (polyPerimEl) polyPerimEl.textContent = polyPerim.toLocaleString(undefined, {maximumFractionDigits: 2}) + " m";
        if (polyAreaEl) polyAreaEl.textContent = polyArea.toLocaleString(undefined, {maximumFractionDigits: 2}) + " m²";

        showUnifiedInfoPanel("POLY_ROI", "POLYGON ROI ANALYSIS", { points: roiPolyPoints, area: polyArea, perim: polyPerim });
    });
  }


  function updateVolumeSvg() {
    if (isMultiSelectVolumes && (measureMode === "VOLUME" || measureState === "FINISHED_VOLUME")) {
      if (volumeSvg) volumeSvg.style.display = "none";
      return;
    }
    if ((measureMode === "VOLUME" || measureState === "FINISHED_VOLUME") && volumePoints.length > 0) {
      let pointsAttr = "";
      if (volumeVerticesSvg) volumeVerticesSvg.innerHTML = "";
      
      // Add confirmed points
      for (const p of volumePoints) {
        const screenP = projectToScreen(p.point);
        if (screenP.z <= 1) {
          pointsAttr += `${screenP.x},${screenP.y} `;
          
          if (volumeVerticesSvg) {
            const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            circle.setAttribute("cx", screenP.x);
            circle.setAttribute("cy", screenP.y);
            circle.setAttribute("r", "4");
            circle.setAttribute("fill", "#5e19ea");
            circle.setAttribute("stroke", "#ffffff");
            circle.setAttribute("stroke-width", "1.5");
            volumeVerticesSvg.appendChild(circle);
          }
        }
      }
      
      // Add mouse point if actively drawing
      if (measureState === "SELECTING" && volumeMousePoint) {
        const screenP = projectToScreen(volumeMousePoint);
        if (screenP.z <= 1) {
          pointsAttr += `${screenP.x},${screenP.y}`;
        }
      }
      
      if (volumePolygonHalo) {
        volumePolygonHalo.style.display = "block";
        volumePolygonHalo.setAttribute("points", pointsAttr.trim());
      }
      if (volumePolygonSvg) {
        volumePolygonSvg.style.display = "block";
        volumePolygonSvg.setAttribute("points", pointsAttr.trim());
      }
      if (volumeVerticesSvg) volumeVerticesSvg.style.display = "block";
      if (volumeSvg) volumeSvg.style.display = "block";
    } else if (measureMode !== "ROI_POLY" && measureState !== "FINISHED_ROI_POLY") {
      if (volumePolygonHalo) volumePolygonHalo.style.display = "none";
      if (volumePolygonSvg) volumePolygonSvg.style.display = "none";
      if (volumeVerticesSvg) volumeVerticesSvg.style.display = "none";
      if (volumeSvg) volumeSvg.style.display = "none";
    }
  }
  controls.addEventListener("change", updateVolumeSvg);
  controls.addEventListener("change", updateMultiOverlaySvg);

  // ── Top-Center Live Map Guidance HUD Helper ──
  const liveGuidanceHud = document.getElementById("liveGuidanceHud");
  const guidanceIcon = document.getElementById("guidanceIcon");
  const guidanceText = document.getElementById("guidanceText");

  function setLiveGuidance(icon, text) {
    if (!liveGuidanceHud) return;
    if (!text) {
      liveGuidanceHud.classList.add("hidden");
      return;
    }
    if (guidanceIcon) guidanceIcon.textContent = icon;
    if (guidanceText) guidanceText.textContent = text;
    liveGuidanceHud.classList.remove("hidden");
  }

  // --- Simple Measurement ---
  btnMeasureSimple?.addEventListener("click", () => {
    resetRoiState();
    restoreFullMapIfClipped();
    measureState = "SELECTING";
    measureMode = "SIMPLE";
    setLiveGuidance("📐", "Click start point on map, then drag or click end point to measure.");
    measureHasFirstTap = false;
    controls.enabled = false;
    document.body.classList.add("roi-selecting");
    btnMeasureSimple.classList.add("active");
    btnMeasureSimple.textContent = "Click to start";
    measureSimpleHint.textContent = "Click on the map to place the start point, then drag or tap.";
    btnClearMeasureSimple.disabled = false;
    measureSimpleResults.classList.remove("hidden");
    clearMeasure();
    measureSimpleHoriz.textContent = "0.00";
    measureSimpleVert.textContent = "0.00";
    measureSimple3D.textContent = "0.00";
  });

  btnClearMeasureSimple?.addEventListener("click", () => {
    setLiveGuidance(null, null);
    measureState = "IDLE";
    measureMode = "NONE";
    controls.enabled = true;
    document.body.classList.remove("roi-selecting");
    btnMeasureSimple.classList.remove("active");
    btnMeasureSimple.textContent = "Measure Distance";
    measureSimpleHint.textContent = "Click 'Measure Distance' then click and drag on the map.";
    measureSimpleResults.classList.add("hidden");
    clearMeasure();
    btnClearMeasureSimple.disabled = true;
  });

  // --- Path Profile ---
  btnProfile?.addEventListener("click", () => {
    resetRoiState();
    restoreFullMapIfClipped();
    measureState = "SELECTING";
    measureMode = "PROFILE";
    setLiveGuidance("📏", "Click on the map to place start point, then drag or tap end point.");
    measureHasFirstTap = false;
    controls.enabled = false;
    document.body.classList.add("roi-selecting");
    btnProfile.classList.add("active");
    btnProfile.textContent = "Click to start";
    profileHint.textContent = "Click on the map to place the start point, then drag or tap.";
    btnClearProfile.disabled = false;
    profileResults.classList.remove("hidden");
    clearMeasure();
    profileHoriz.textContent = "0.00";
    profileVert.textContent = "0.00";
    profile3D.textContent = "0.00";
    if (elevationMiniContainer) elevationMiniContainer.classList.add("hidden");
  });

  btnClearProfile?.addEventListener("click", () => {
    setLiveGuidance(null, null);
    measureState = "IDLE";
    measureMode = "NONE";
    controls.enabled = true;
    document.body.classList.remove("roi-selecting");
    btnProfile.classList.remove("active");
    btnProfile.textContent = "Draw Path Profile";
    profileHint.textContent = "Draw a line to generate a terrain profile graph and save report.";
    profileResults.classList.add("hidden");
    clearMeasure();
    if (elevationMiniContainer) elevationMiniContainer.classList.add("hidden");
    btnClearProfile.disabled = true;
  });

  // --- Volume Analysis ---
  const volumeHeader = document.getElementById("volumeHeader");
  const volumeSettings = document.getElementById("volumeSettings");
  const btnDrawVolume = document.getElementById("btnDrawVolume");
  const btnClearVolume = document.getElementById("btnClearVolume");
  const btnFinishVolume = document.getElementById("btnFinishVolume");
  const volumeHint = document.getElementById("volumeHint");
  const volumeMiniContainer = document.getElementById("volumeMiniContainer");

  btnDrawVolume?.addEventListener("click", () => {
    resetRoiState();
    restoreFullMapIfClipped();
    measureState = "SELECTING";
    measureMode = "VOLUME";
    setLiveGuidance("📦", "Click points on the map to build volume polygon. Click Finish when done.");
    controls.enabled = false;
    document.body.classList.add("roi-selecting");
    btnDrawVolume.classList.add("active");
    btnDrawVolume.textContent = "Click to place points";
    if (volumeHint) volumeHint.textContent = "Click points on the map. Click Finish when done.";
    if (btnClearVolume) btnClearVolume.disabled = false;
    if (btnFinishVolume) btnFinishVolume.classList.remove("hidden");
    
    // Lock to Top-Down 2D
    const minPol = controls.minPolarAngle;
    const maxPol = controls.maxPolarAngle;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = 0;
    controls.update();
    controls.minPolarAngle = minPol;
    controls.maxPolarAngle = maxPol;

    volumePoints = [];
    volumeMousePoint = null;
    updateVolumeSvg();
    if (volumeMiniContainer) volumeMiniContainer.classList.add("hidden");
  });

  btnClearVolume?.addEventListener("click", () => {
    setLiveGuidance(null, null);
    measureState = "IDLE";
    measureMode = "NONE";
    controls.enabled = true;
    document.body.classList.remove("roi-selecting");
    if (btnDrawVolume) {
      btnDrawVolume.classList.remove("active");
      btnDrawVolume.textContent = "Draw Volume Area";
    }
    if (btnFinishVolume) btnFinishVolume.classList.add("hidden");
    if (volumeHint) volumeHint.textContent = "Click 'Draw Volume Area' to lock view to 2D. Then click points on the map to build a polygon.";
    
    volumePoints = [];
    volumeMousePoint = null;
    updateVolumeSvg();
    if (volumeMiniContainer) volumeMiniContainer.classList.add("hidden");
    if (btnClearVolume) btnClearVolume.disabled = true;
  });

  btnFinishVolume?.addEventListener("click", () => {
    setLiveGuidance(null, null);
    if (measureMode !== "VOLUME") return;
    if (volumePoints.length < 3) {
      alert("Please draw at least 3 points for a volume polygon.");
      return;
    }
    measureState = "FINISHED_VOLUME";
    controls.enabled = true;
    document.body.classList.remove("roi-selecting");
    if (btnDrawVolume) {
      btnDrawVolume.classList.remove("active");
      btnDrawVolume.textContent = "Draw Volume Area";
    }
    if (btnFinishVolume) btnFinishVolume.classList.add("hidden");
    if (volumeHint) volumeHint.textContent = "Volume Analysis complete. Click 'Clear' to remove.";
    volumeMousePoint = null;
    updateVolumeSvg();
    calculateVolumeMetrics();
  });

  canvas.addEventListener("dblclick", (e) => {
    if (measureState === "SELECTING" && measureMode === "VOLUME") {
      if (btnFinishVolume) btnFinishVolume.click();
    }
    if (measureState === "SELECTING" && measureMode === "ROI_POLY") {
      if (roiPolyPoints.length < 3) {
        alert("Please draw at least 3 points for a polygon ROI.");
        return;
      }
      measureState = "FINISHED_ROI_POLY";
      controls.enabled = true;
      document.body.classList.remove("roi-selecting");
      if (btnDrawPolyRoi) btnDrawPolyRoi.classList.remove("active");
      const featRoiBtn = document.getElementById("btnDrawFeatureRoi");
      if (featRoiBtn) featRoiBtn.classList.remove("active");
      roiPolyMousePoint = null;
      updateRoiPolySvg();
      calculateRoiPolyMetrics();
      applyRoiPolyClipping();
      if (roiMiniContainer) roiMiniContainer.classList.remove("hidden");
    }
  });

  let isCtrlPanActive = false;

  canvas.addEventListener("mousedown", (e) => {
    if (e.ctrlKey || isCtrlPanActive) return;
    if (measureMode === "POINT" && measureState === "SELECTING_POINT") {
      const rect = canvas.getBoundingClientRect();
      const mouse = new Vector2(e.clientX - rect.left, e.clientY - rect.top);
      const picked = map.pick(mouse);
      if (picked && picked.length > 0) {
        pointDrawPoint = picked[0].point.clone();
        pointDrawCoord = picked[0].coord.clone();
        measureState = "FINISHED_POINT";
        controls.enabled = true;
        document.body.classList.remove("roi-selecting");
        
        const pCoord = pointDrawCoord.as(proj4('EPSG:4326'));
        const lon = pCoord.x.toFixed(6) + "°";
        const lat = pCoord.y.toFixed(6) + "°";
        const elev = pointDrawPoint.z.toFixed(2) + " m";
        
        const ptLonEl = document.getElementById("pointMiniLon");
        const ptLatEl = document.getElementById("pointMiniLat");
        const ptElevEl = document.getElementById("pointMiniElev");
        if (ptLonEl) ptLonEl.textContent = lon;
        if (ptLatEl) ptLatEl.textContent = lat;
        if (ptElevEl) ptElevEl.textContent = elev;
        
        showUnifiedInfoPanel("POINT", "SAVE POINT", { lon: pCoord.x, lat: pCoord.y, z: pointDrawPoint.z, point: pointDrawPoint });
        
        updatePointSvg();
      }
      return;
    }

    if (measureState === "SELECTING") {
      
      const rect = canvas.getBoundingClientRect();
      const mouse = new Vector2(e.clientX - rect.left, e.clientY - rect.top);
      measureDragScreenStart = { x: e.clientX, y: e.clientY };
      const picked = map.pick(mouse);
      if (picked && picked.length > 0) {
        if (measureMode === "ROI_POLY") {
          roiPolyPoints.push({ point: picked[0].point.clone(), coord: picked[0].coord.clone() });
          setLiveGuidance("✂️", `Polygon ROI: ${roiPolyPoints.length} Points Placed — Double-click to finish clipping`);
          updateRoiPolySvg();
          return;
        }
        if (measureMode === "VOLUME") {
          volumePoints.push({
            point: picked[0].point.clone(),
            coord: picked[0].coord.clone()
          });
          measureDragScreenStart = null; // prevent mouseup from treating this as a drag-finish
          setLiveGuidance("📦", `Volume Drawing: ${volumePoints.length} Points Placed — Click map for next point, or Finish`);
          updateVolumeSvg();
          return;
        }

        if (!measureStartPoint) {
          measureStartPoint = picked[0].point.clone();
          measureStartCoord = picked[0].coord.clone();
          measureEndPoint = measureStartPoint.clone();
          measureEndCoord = measureStartCoord.clone();
          updateMeasureSvg();
          
          if (measureMode === "SIMPLE") measureSimpleHint.textContent = "Drag to measure, or tap again to set the end point.";
          else if (measureMode === "PROFILE") profileHint.textContent = "Drag to measure, or tap again to set the end point.";
        } else {
          measureEndPoint = picked[0].point.clone();
          measureEndCoord = picked[0].coord.clone();
          updateMeasureSvg();
        }
      }
    }
  });

  canvas.addEventListener("mousemove", (e) => {
    if (measureState === "SELECTING") {
      const rect = canvas.getBoundingClientRect();
      const mouse = new Vector2(e.clientX - rect.left, e.clientY - rect.top);
      const picked = map.pick(mouse);
      
      if (picked && picked.length > 0) {
        if (measureMode === "VOLUME") {
          volumeMousePoint = picked[0].point.clone();
          updateVolumeSvg();
          return;
        }
        if (measureMode === "ROI_POLY") {
          roiPolyMousePoint = picked[0].point.clone();
          updateRoiPolySvg();
          return;
        }
        
        if (measureStartPoint) {
          measureEndPoint = picked[0].point.clone();
          measureEndCoord = picked[0].coord.clone();
          updateMeasureSvg();

        const dx = measureEndCoord.x - measureStartCoord.x;
        const dy = measureEndCoord.y - measureStartCoord.y;
        const dz = measureEndCoord.z - measureStartCoord.z;
        const horizontal = Math.sqrt(dx * dx + dy * dy);
        const vertical = Math.abs(dz);
        const distance3D = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (measureMode === "SIMPLE") {
          measureSimpleHoriz.textContent = horizontal.toFixed(2);
          measureSimpleVert.textContent = vertical.toFixed(2);
          measureSimple3D.textContent = distance3D.toFixed(2);
        } else if (measureMode === "PROFILE") {
          profileHoriz.textContent = horizontal.toFixed(2);
          profileVert.textContent = vertical.toFixed(2);
          profile3D.textContent = distance3D.toFixed(2);
          updateElevationProfile();
        }
        } // End if (measureStartPoint)
      }
    }
  });

  canvas.addEventListener("mouseup", (e) => {
    if (measureState === "SELECTING" && measureStartPoint && measureDragScreenStart) {
      const dx = e.clientX - measureDragScreenStart.x;
      const dy = e.clientY - measureDragScreenStart.y;
      const dragDist = Math.sqrt(dx * dx + dy * dy);

      if (dragDist > 5) {
        measureState = "FINISHED";
        controls.enabled = true;
        document.body.classList.remove("roi-selecting");
        
        if (measureMode === "SIMPLE") {
          btnMeasureSimple.classList.remove("active");
          btnMeasureSimple.textContent = "Measure Distance";
          measureSimpleHint.textContent = "Measurement complete. Rotate the map to see the line stick! Click 'Clear' to remove.";
        } else if (measureMode === "PROFILE") {
          btnProfile.classList.remove("active");
          btnProfile.textContent = "Draw Path Profile";
          profileHint.textContent = "Path Profile complete. Rotate the map to see the line stick! Click 'Clear' to remove.";
          updateElevationProfile();
        }
      } else {
        if (!measureHasFirstTap) {
          measureHasFirstTap = true;
          if (measureMode === "SIMPLE") measureSimpleHint.textContent = "First point set. Tap elsewhere to set the second point.";
          else if (measureMode === "PROFILE") profileHint.textContent = "First point set. Tap elsewhere to set the second point.";
        } else {
          measureState = "FINISHED";
          controls.enabled = true;
          document.body.classList.remove("roi-selecting");
          
          if (measureMode === "SIMPLE") {
            btnMeasureSimple.classList.remove("active");
            btnMeasureSimple.textContent = "Measure Distance";
            measureSimpleHint.textContent = "Measurement complete. Rotate the map to see the line stick! Click 'Clear' to remove.";
          } else if (measureMode === "PROFILE") {
            btnProfile.classList.remove("active");
            btnProfile.textContent = "Draw Path Profile";
            profileHint.textContent = "Path Profile complete. Rotate the map to see the line stick! Click 'Clear' to remove.";
            updateElevationProfile();
          }
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // Elevation Profile Graph
  // -------------------------------------------------------------------------
  const elevationMiniContainer = document.getElementById("elevationMiniContainer");
  const elevationMiniChartCtx = document.getElementById("elevationMiniChart")?.getContext("2d");
  const elevationFullChartCtx = document.getElementById("elevationFullChart")?.getContext("2d");
  const elevationModal = document.getElementById("elevationModal");
  const btnCloseModal = document.getElementById("btnCloseModal");
  const btnDownloadReport = document.getElementById("btnDownloadReport");
  const btnSaveToSurvey = document.getElementById("btnSaveToSurvey");
  const reportNameInput = document.getElementById("reportNameInput");

  let miniChart = null;
  let fullChart = null;
  let currentProfileData = [];

  const customBgPlugin = {
    id: 'customCanvasBackgroundColor',
    beforeDraw: (chart, args, options) => {
      const {ctx} = chart;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = options.color || '#ffffff'; // Clean pure white background
      ctx.fillRect(0, 0, chart.width, chart.height);
      ctx.restore();
    }
  };

  function initCharts() {
    if (miniChart) return;
    const miniCanvas = document.getElementById("elevationMiniChart");
    const fullCanvas = document.getElementById("elevationFullChart");
    if (!miniCanvas || !fullCanvas) return;
    
    const miniCtx = miniCanvas.getContext("2d");
    const fullCtx = fullCanvas.getContext("2d");
    if (!miniCtx || !fullCtx) return;

    miniChart = new Chart(miniCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          data: [],
          borderColor: '#5e19ea', // Polygon Purple
          backgroundColor: 'rgba(94, 25, 234, 0.12)',
          fill: true,
          tension: 0.2,
          pointRadius: 0,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { display: false },
          y: { 
            display: true,
            ticks: { color: '#64748b', font: { size: 9 } }, 
            grid: { color: 'rgba(226, 232, 240, 0.8)' },
            grace: '5%'
          }
        }
      }
    });

    fullChart = new Chart(fullCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Elevation',
          data: [],
          borderColor: '#5e19ea', // Polygon Purple
          backgroundColor: 'rgba(94, 25, 234, 0.12)',
          fill: true,
          tension: 0.15,
          pointRadius: 3,
          pointBackgroundColor: '#5e19ea',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: '#4c1d95',
          borderWidth: 2.5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f172a',
            titleColor: '#f8fafc',
            bodyColor: '#c4b5fd',
            borderColor: '#7c3aed',
            borderWidth: 1,
            padding: 10,
            displayColors: false,
            callbacks: {
              label: (ctx) => `Elevation: ${ctx.parsed.y.toFixed(2)} m`
            }
          }
        },
        scales: {
          x: { 
            title: { display: true, text: 'Distance (m)', color: '#334155', font: { weight: '600' } },
            ticks: { color: '#64748b' },
            grid: { color: '#e2e8f0' }
          },
          y: { 
            title: { display: true, text: 'Elevation (m)', color: '#334155', font: { weight: '600' } },
            ticks: { color: '#64748b' },
            grid: { color: '#e2e8f0' },
            grace: '5%'
          }
        }
      },
      plugins: [customBgPlugin]
    });
  }

  function calculateVolumeMetrics() {
    if (volumePoints.length < 3) return;

    // 1. Calculate 3D Perimeter and Average Reference Elevation
    let perimeter = 0;
    let sumElevation = 0;
    const coords = volumePoints.map(p => p.coord);
    
    for (let i = 0; i < coords.length; i++) {
      const p1 = coords[i];
      const p2 = coords[(i + 1) % coords.length];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      
      const sample1 = map.getElevationFast(p1.x, p1.y);
      const z1 = sample1 ? sample1.elevation : 0;
      
      const sample2 = map.getElevationFast(p2.x, p2.y);
      const z2 = sample2 ? sample2.elevation : 0;
      
      const dz = z2 - z1;
      perimeter += Math.sqrt(dx * dx + dy * dy + dz * dz);
      sumElevation += z1;
    }
    
    const referenceElevation = sumElevation / coords.length;

    // 2. Calculate 2D Area (Shoelace Formula)
    let area2D = 0;
    for (let i = 0; i < coords.length; i++) {
      const p1 = coords[i];
      const p2 = coords[(i + 1) % coords.length];
      area2D += p1.x * p2.y - p2.x * p1.y;
    }
    area2D = Math.abs(area2D) / 2;

    // 3. Grid Sampling for Volume
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    for (const c of coords) {
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.y > maxY) maxY = c.y;
    }

    const gridStep = 1.0; // 1 meter grid
    let cutVolume = 0;
    let fillVolume = 0;
    
    // Ray-casting point in polygon
    function pointInPolygon(px, py, poly) {
      let isInside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y;
        const xj = poly[j].x, yj = poly[j].y;
        const intersect = ((yi > py) != (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
        if (intersect) isInside = !isInside;
      }
      return isInside;
    }

    for (let x = minX; x <= maxX; x += gridStep) {
      for (let y = minY; y <= maxY; y += gridStep) {
        if (pointInPolygon(x, y, coords)) {
          const sample = map.getElevationFast(x, y);
          const z = sample ? sample.elevation : 0;
          const diff = referenceElevation - z;
          
          if (diff > 0) {
            cutVolume += diff * (gridStep * gridStep); // Pit
          } else {
            fillVolume += Math.abs(diff) * (gridStep * gridStep); // Stockpile
          }
        }
      }
    }

    // 4. Update UI
    document.getElementById("volMiniArea").textContent = area2D.toLocaleString(undefined, {maximumFractionDigits: 2}) + " m²";
    document.getElementById("volMiniPerim").textContent = perimeter.toLocaleString(undefined, {maximumFractionDigits: 2}) + " m";
    document.getElementById("volMiniCut").textContent = cutVolume.toLocaleString(undefined, {maximumFractionDigits: 2}) + " m³";
    document.getElementById("volMiniFill").textContent = fillVolume.toLocaleString(undefined, {maximumFractionDigits: 2}) + " m³";
    
    showUnifiedInfoPanel("VOLUME", "VOLUME ANALYSIS", { area2D, perimeter, cutVolume, fillVolume, coords });
  }

  function buildProfile3DPointsFromElevations(startPt, endPt, elevationsArray) {
    if (!startPt || !endPt || !elevationsArray || elevationsArray.length < 2) return [];
    const count = elevationsArray.length;
    const pts = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const x = startPt.x + t * (endPt.x - startPt.x);
      const y = startPt.y + t * (endPt.y - startPt.y);
      const rawZ = Number(elevationsArray[i]);
      const fallbackZ = (startPt.z || 0) + t * ((endPt.z || 0) - (startPt.z || 0));
      const z = (!isNaN(rawZ) && typeof rawZ === 'number') ? rawZ : fallbackZ;
      pts.push(new Vector3(x, y, z + 0.35));
    }
    return pts;
  }

  function updateElevationProfile() {
    if (!measureStartCoord || !measureEndCoord || !map) {
      return;
    }
    
    const dx = measureEndCoord.x - measureStartCoord.x;
    const dy = measureEndCoord.y - measureStartCoord.y;
    const totalDist = Math.sqrt(dx * dx + dy * dy);
    if (totalDist < 1) {
      return;
    }

    // Ultra High-Density sampling: sample every 0.8 meters (min 60, max 400 points)
    let numSamples = Math.max(60, Math.min(400, Math.floor(totalDist / 0.8)));
    
    const distances = [];
    const elevations = [];
    currentProfileData = [];
    currentProfilePoints3D = [];

    const startZ = (measureStartPoint && typeof measureStartPoint.z === 'number') ? measureStartPoint.z : (measureStartCoord.z || 0);
    const endZ = (measureEndPoint && typeof measureEndPoint.z === 'number') ? measureEndPoint.z : (measureEndCoord.z || 0);
    const startLocal = measureStartPoint || { x: measureStartCoord.x - (instance?.reference?.x || 0), y: measureStartCoord.y - (instance?.reference?.y || 0), z: startZ };
    const endLocal = measureEndPoint || { x: measureEndCoord.x - (instance?.reference?.x || 0), y: measureEndCoord.y - (instance?.reference?.y || 0), z: endZ };

    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      const x = measureStartCoord.x + t * dx;
      const y = measureStartCoord.y + t * dy;
      const fallbackZ = startZ + t * (endZ - startZ);
      let z = fallbackZ;
      try {
        const sample = map ? map.getElevationFast(x, y) : null;
        if (sample && typeof sample.elevation === "number" && !isNaN(sample.elevation)) {
          z = sample.elevation;
        }
      } catch (err) {
        z = fallbackZ;
      }
      
      const currentDist = t * totalDist;
      distances.push(currentDist.toFixed(1));
      elevations.push(z);
      currentProfileData.push({ dist: currentDist, elev: z, x, y, z });

      const xLocal = startLocal.x + t * (endLocal.x - startLocal.x);
      const yLocal = startLocal.y + t * (endLocal.y - startLocal.y);
      currentProfilePoints3D.push(new Vector3(xLocal, yLocal, z + 0.35));
    }

    // Immediately trigger 3D draped line update
    updateMeasureSvg();

    const elevChange = Math.abs(elevations[elevations.length - 1] - elevations[0]);
    const surfDist = currentProfileData.reduce((acc, curr, idx) => {
      if (idx === 0) return 0;
      const prev = currentProfileData[idx - 1];
      const dX = curr.x - prev.x;
      const dY = curr.y - prev.y;
      const dZ = curr.elev - prev.elev;
      return acc + Math.sqrt(dX*dX + dY*dY + dZ*dZ);
    }, 0);

    const profHoriz = document.getElementById("profileHoriz");
    const profVert = document.getElementById("profileVert");
    const prof3D = document.getElementById("profile3D");
    if (profHoriz) profHoriz.textContent = totalDist.toFixed(2) + " m";
    if (profVert) profVert.textContent = elevChange.toFixed(2) + " m";
    if (prof3D) prof3D.textContent = surfDist.toFixed(2) + " m";

    showUnifiedInfoPanel("PROFILE", "ELEVATION PATH PROFILE", { totalDist, elevChange, surfDist, distances, elevations, currentProfileData });
    
    // Delay chart population to ensure container is visible and has real dimensions
    setTimeout(() => {
      initCharts();
      if (miniChart) {
        miniChart.data.labels = distances;
        miniChart.data.datasets[0].data = elevations;
        miniChart.resize();
        miniChart.update('none');
      }

      if (elevationModal && !elevationModal.classList.contains("hidden") && fullChart) {
        fullChart.data.labels = distances;
        fullChart.data.datasets[0].data = elevations;
        fullChart.update();
      }
    }, 150);
  }

  let wasInfoPanelVisibleOnModalOpen = false;
  let wasTopSaveBarVisibleOnModalOpen = false;

  elevationMiniContainer?.addEventListener("click", () => {
    // Auto-hide right info panel and top save bar to avoid visual overlap
    if (unifiedInfoPanel && !unifiedInfoPanel.classList.contains("hidden")) {
      wasInfoPanelVisibleOnModalOpen = true;
      unifiedInfoPanel.classList.add("hidden");
    } else {
      wasInfoPanelVisibleOnModalOpen = false;
    }

    if (topSaveBar && !topSaveBar.classList.contains("hidden")) {
      wasTopSaveBarVisibleOnModalOpen = true;
      topSaveBar.classList.add("hidden");
    } else {
      wasTopSaveBarVisibleOnModalOpen = false;
    }

    elevationModal.classList.remove("hidden");
    initCharts();
    fullChart.data.labels = miniChart.data.labels;
    fullChart.data.datasets[0].data = miniChart.data.datasets[0].data;
    fullChart.update();
  });
  
  const closeMiniChartBtn = document.getElementById("closeMiniChartBtn");
  closeMiniChartBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (elevationMiniContainer) elevationMiniContainer.classList.add("hidden");
  });

  btnCloseModal?.addEventListener("click", () => {
    elevationModal.classList.add("hidden");
    // Restore right info panel and top save bar if they were open before expanding
    if (wasInfoPanelVisibleOnModalOpen && unifiedInfoPanel) {
      unifiedInfoPanel.classList.remove("hidden");
    }
    if (wasTopSaveBarVisibleOnModalOpen && topSaveBar) {
      topSaveBar.classList.remove("hidden");
    }
  });

  function generateReportPDF(reportName) {
    // Force fullChart to sync with miniChart and render if modal is hidden
    let wasHidden = false;
    const elevationModal = document.getElementById("elevationModal");
    if (elevationModal && elevationModal.classList.contains("hidden")) {
      wasHidden = true;
      // Make it part of the layout but invisible to the user
      elevationModal.style.visibility = 'hidden';
      elevationModal.style.display = 'flex';
      elevationModal.classList.remove("hidden");
    }

    if (fullChart && miniChart) {
      fullChart.data.labels = miniChart.data.labels;
      fullChart.data.datasets[0].data = miniChart.data.datasets[0].data;
      // Force synchronous update (Chart.js 3+ uses 'none', fallback to 0)
      try { fullChart.update('none'); } catch (e) { }
      try { fullChart.update(0); } catch (e) { }
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // Professional Header Banner
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, pageWidth, 40, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("POLYGON GEOSPATIAL ANALYSIS", pageWidth / 2, 22, { align: 'center' });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(200, 200, 200);
    doc.text("Topographical & Elevation Report", pageWidth / 2, 30, { align: 'center' });
    
    // Report Metadata
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(`Report: ${reportName}`, 15, 52);
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Date of Analysis: ${new Date().toLocaleString()}`, 15, 60);
    doc.text(`Coordinate System: EPSG:3395 (World Mercator)`, 15, 66);
    
    // Add Chart Image
    const chartImg = fullChart.canvas.toDataURL('image/png');
    doc.addImage(chartImg, 'PNG', 15, 75, 180, 80);

    // Restore modal state
    if (wasHidden && elevationModal) {
      elevationModal.classList.add("hidden");
      elevationModal.style.visibility = '';
      elevationModal.style.display = '';
    }
    
    // Calculate Analytical Stats
    const dists = currentProfileData.map(d => d.dist);
    const elevs = currentProfileData.map(d => d.elev);
    const totalDist = Math.max(...dists);
    
    let surfaceDistance = 0;
    let maxSlope = 0;
    for (let i = 1; i < currentProfileData.length; i++) {
      const p1 = currentProfileData[i-1];
      const p2 = currentProfileData[i];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dz = p2.elev - p1.elev;
      const horizontalDist = Math.sqrt(dx*dx + dy*dy);
      surfaceDistance += Math.sqrt(horizontalDist*horizontalDist + dz*dz);
      
      if (horizontalDist > 0) {
        const slope = Math.abs(dz / horizontalDist) * 100;
        if (slope > maxSlope) maxSlope = slope;
      }
    }

    const maxElev = Math.max(...elevs);
    const minElev = Math.min(...elevs);
    const elevChange = maxElev - minElev;
    const avgSlope = totalDist > 0 ? (elevChange / totalDist * 100) : 0;
    
    const startX = currentProfileData[0].x.toFixed(2);
    const startY = currentProfileData[0].y.toFixed(2);
    const endX = currentProfileData[currentProfileData.length-1].x.toFixed(2);
    const endY = currentProfileData[currentProfileData.length-1].y.toFixed(2);
    
    // Tables
    autoTable(doc, {
      startY: 165,
      head: [['Geographical Details', 'Coordinates (EPSG:3395)']],
      body: [
        ['Start Point', `X: ${startX}, Y: ${startY}`],
        ['End Point', `X: ${endX}, Y: ${endY}`]
      ],
      theme: 'grid',
      headStyles: { fillColor: [51, 65, 85] },
      styles: { fontSize: 10, cellPadding: 5 }
    });

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 8,
      head: [['Topographical Metrics', 'Calculated Value']],
      body: [
        ['Horizontal Distance (2D)', `${totalDist.toFixed(2)} m`],
        ['Surface Distance (3D)', `${surfaceDistance.toFixed(2)} m`],
        ['Elevation Change (\u0394)', `${elevChange.toFixed(2)} m`],
        ['Maximum Elevation', `${maxElev.toFixed(2)} m`],
        ['Minimum Elevation', `${minElev.toFixed(2)} m`],
        ['Average Grade / Slope', `${avgSlope.toFixed(2)} %`],
        ['Maximum Grade / Slope', `${maxSlope.toFixed(2)} %`]
      ],
      theme: 'grid',
      headStyles: { fillColor: [15, 118, 110] }, // Teal header
      styles: { fontSize: 10, cellPadding: 5 }
    });
    
    // Footer
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    doc.text("Generated by Polygon Geospatial Viewer", pageWidth / 2, pageHeight - 10, { align: 'center' });
    
    return doc;
  }

  btnDownloadReport?.addEventListener("click", () => {
    if (currentProfileData.length === 0 || !fullChart) return;
    
    let reportName = reportNameInput?.value.trim() || "Elevation_Profile_Report";
    const doc = generateReportPDF(reportName);
    doc.save(`${reportName.replace(/\s+/g, '_')}.pdf`);
  });

  btnSaveToSurvey?.addEventListener("click", async () => {
    if (currentProfileData.length === 0 || !fullChart) return;

    let reportName = reportNameInput?.value.trim() || "Elevation_Profile_Report";
    const safeReportName = reportName.replace(/\s+/g, '_');
    
    const originalText = btnSaveToSurvey.innerHTML;
    btnSaveToSurvey.textContent = "Saving...";
    btnSaveToSurvey.disabled = true;

    try {
      const doc = generateReportPDF(reportName);
      const pdfBlob = doc.output('blob');
      
      // Generate JSON Metadata
      const metadata = {
        isOfficial: !window.isDumpDraw,
        startPoint: measureStartPoint ? { x: measureStartPoint.x, y: measureStartPoint.y, z: measureStartPoint.z } : null,
        endPoint: measureEndPoint ? { x: measureEndPoint.x, y: measureEndPoint.y, z: measureEndPoint.z } : null,
        startCoord: measureStartCoord ? { x: measureStartCoord.x, y: measureStartCoord.y, z: measureStartCoord.z } : null,
        endCoord: measureEndCoord ? { x: measureEndCoord.x, y: measureEndCoord.y, z: measureEndCoord.z } : null,
        chartData: {
          distances: miniChart?.data.labels || [],
          elevations: miniChart?.data.datasets[0].data || [],
          currentProfileData: currentProfileData,
          totalDist: parseFloat(document.getElementById("profileHoriz")?.textContent) || 0,
          elevChange: parseFloat(document.getElementById("profileVert")?.textContent) || 0,
          surfDist: parseFloat(document.getElementById("profile3D")?.textContent) || 0
        }
      };
      const jsonBlob = new Blob([JSON.stringify(metadata)], { type: "application/json" });
      
      const apiUrl = "https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url";
      
      // 1. Upload PDF
      const pdfApiResponse = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: activeProject.folderName,
          surveyId: activeProject.surveyId,
          type: "reports", fileName: `${safeReportName}.pdf`
        })
      });
      if (!pdfApiResponse.ok) throw new Error("Failed to get PDF upload URL from Lambda");
      const { uploadUrl: pdfUploadUrl } = await pdfApiResponse.json();
      const pdfUploadResponse = await fetch(pdfUploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: pdfBlob
      });
      if (!pdfUploadResponse.ok) throw new Error("Failed to upload PDF to S3");

      // 2. Upload JSON Metadata
      const jsonApiResponse = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: activeProject.folderName,
          surveyId: activeProject.surveyId,
          type: "reports", fileName: `${safeReportName}.json`
        })
      });
      if (!jsonApiResponse.ok) throw new Error("Failed to get JSON upload URL from Lambda");
      const { uploadUrl: jsonUploadUrl } = await jsonApiResponse.json();
      const jsonUploadResponse = await fetch(jsonUploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: jsonBlob
      });
      if (!jsonUploadResponse.ok) throw new Error("Failed to upload JSON to S3");

      btnSaveToSurvey.textContent = "Saved to Survey!";
      btnSaveToSurvey.style.background = "#10b981"; // success green
      
      // Refresh the reports panel automatically!
      fetchSavedReports();
      
      setTimeout(() => {
        btnSaveToSurvey.innerHTML = originalText;
        btnSaveToSurvey.style.background = "#5e19ea";
        btnSaveToSurvey.disabled = false;
      }, 3000);

    } catch (err) {
      console.error("Error saving report:", err);
      btnSaveToSurvey.textContent = "Error Saving";
      btnSaveToSurvey.style.background = "#ef4444"; // red
      
      setTimeout(() => {
        btnSaveToSurvey.innerHTML = originalText;
        btnSaveToSurvey.style.background = "#5e19ea";
        btnSaveToSurvey.disabled = false;
      }, 3000);
    }
  });

  const mode2D = document.getElementById('mode2D');

  // -------------------------------------------------------------------------
  // Slope Heat Map Logic
  // -------------------------------------------------------------------------
  const btnEnableHeatmap = document.getElementById('btnEnableHeatmap');
  const btnDisableHeatmap = document.getElementById('btnDisableHeatmap');
  const heatmapSettings = document.getElementById('heatmapSettings');
  const heatmapOpacity = document.getElementById('heatmapOpacity');
  const heatmapOpacityVal = document.getElementById('heatmapOpacityVal');
  const heatmapLoading = document.getElementById('infoHeatmapLoading') || document.getElementById('heatmapLoading');

  btnEnableHeatmap?.addEventListener('click', () => {
    btnEnableHeatmap.disabled = true;
    heatmapLoading.classList.remove('hidden');

    setTimeout(() => {
      if (slopeColorMap && elevationLayer) {
        elevationLayer.colorMap = slopeColorMap;
        slopeColorMap.active = true;
        if (orthoLayer) {
          orthoLayer.opacity = 0.4; // Fade the satellite image so the heatmap shines through
        }
        instance.notifyChange();
      }
      btnDisableHeatmap.disabled = false;
      heatmapLoading?.classList.add('hidden');
      heatmapSettings?.classList.remove('hidden');
      document.getElementById("infoHeatmapExportCard")?.classList.remove("hidden");
    }, 600);
  });

  btnDisableHeatmap?.addEventListener('click', () => {
    if (slopeColorMap && elevationLayer) {
      elevationLayer.colorMap = null;
      slopeColorMap.active = false;
      if (orthoLayer) {
        orthoLayer.opacity = 1.0; // Restore full satellite imagery
      }
      instance.notifyChange();
    }
    btnEnableHeatmap.disabled = false;
    btnDisableHeatmap.disabled = true;
    heatmapSettings?.classList.add('hidden');
    document.getElementById("infoHeatmapExportCard")?.classList.add("hidden");
  });

  heatmapOpacity?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    heatmapOpacityVal.textContent = Math.round(val * 100) + '%';
    if (slopeColorMap) {
      const mode = document.querySelector('input[name="heatmapMode"]:checked')?.value || 'predefined';
      if (mode === 'predefined') {
        slopeColorMap.opacity = new Array(5).fill(val);
        instance.notifyChange();
      } else if (mode === 'haulroad') {
        slopeColorMap.opacity = new Array(256).fill(val);
        instance.notifyChange();
      } else {
        btnApplyCustomHeatmap?.click();
      }
    }
  });

  // -------------------------------------------------------------------------
  // Custom Heat Map Logic
  // -------------------------------------------------------------------------
  const heatmapRadios = document.getElementsByName('heatmapMode');
  const predefinedHeatmapUI = document.getElementById('predefinedHeatmapUI');
  const customHeatmapUI = document.getElementById('customHeatmapUI');
  const haulroadHeatmapUI = document.getElementById('haulroadHeatmapUI');
  const customHeatmapRanges = document.getElementById('customHeatmapRanges');
  const btnAddHeatmapRange = document.getElementById('btnAddHeatmapRange');
  const btnApplyCustomHeatmap = document.getElementById('btnApplyCustomHeatmap');
  const customHeatmapError = document.getElementById('customHeatmapError');
  
  let customRanges = [
    { min: 0, max: 15, color: '#00ff00' },
    { min: 15, max: 30, color: '#ffff00' }
  ];

  function renderCustomRanges() {
    if (!customHeatmapRanges) return;
    customHeatmapRanges.innerHTML = '';
    customRanges.forEach((range, index) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '5px';
      row.style.alignItems = 'center';
      
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = range.color;
      colorInput.style.width = '30px';
      colorInput.style.height = '24px';
      colorInput.style.padding = '0';
      colorInput.style.border = 'none';
      colorInput.addEventListener('change', (e) => { customRanges[index].color = e.target.value; });
      
      const minInput = document.createElement('input');
      minInput.type = 'number';
      minInput.value = range.min;
      minInput.style.width = '55px';
      minInput.style.padding = '2px';
      minInput.addEventListener('change', (e) => { customRanges[index].min = parseFloat(e.target.value); });
      
      const span = document.createElement('span');
      span.textContent = 'to';
      span.style.fontSize = '12px';
      
      const maxInput = document.createElement('input');
      maxInput.type = 'number';
      maxInput.value = range.max;
      maxInput.style.width = '55px';
      maxInput.style.padding = '2px';
      maxInput.addEventListener('change', (e) => { customRanges[index].max = parseFloat(e.target.value); });
      
      const btnDel = document.createElement('button');
      btnDel.textContent = 'X';
      btnDel.className = 'btn btn-outline';
      btnDel.style.padding = '2px 6px';
      btnDel.addEventListener('click', () => {
        customRanges.splice(index, 1);
        renderCustomRanges();
      });
      
      row.appendChild(colorInput);
      row.appendChild(minInput);
      row.appendChild(span);
      row.appendChild(maxInput);
      row.appendChild(btnDel);
      
      customHeatmapRanges.appendChild(row);
    });
  }

  heatmapRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      const mode = e.target.value;
      if (mode === 'custom') {
        predefinedHeatmapUI.classList.add('hidden');
        if (haulroadHeatmapUI) haulroadHeatmapUI.classList.add('hidden');
        customHeatmapUI.classList.remove('hidden');
        renderCustomRanges();
      } else if (mode === 'haulroad') {
        predefinedHeatmapUI.classList.add('hidden');
        customHeatmapUI.classList.add('hidden');
        if (haulroadHeatmapUI) haulroadHeatmapUI.classList.remove('hidden');
        
        if (slopeColorMap) {
          const RESOLUTION = 256;
          const newColors = [];
          const val = parseFloat(heatmapOpacity.value);
          const newOpacities = new Array(RESOLUTION).fill(val);
          
          for (let i = 0; i < RESOLUTION; i++) {
            const deg = (i / (RESOLUTION - 1)) * 90;
            if (deg <= 5) newColors.push(new Color('green'));
            else if (deg <= 8) newColors.push(new Color('yellow'));
            else if (deg <= 10) newColors.push(new Color('orange'));
            else newColors.push(new Color('red'));
          }
          slopeColorMap.colors = newColors;
          slopeColorMap.opacity = newOpacities;
          instance.notifyChange();
        }
      } else {
        predefinedHeatmapUI.classList.remove('hidden');
        customHeatmapUI.classList.add('hidden');
        if (haulroadHeatmapUI) haulroadHeatmapUI.classList.add('hidden');
        
        if (slopeColorMap) {
          slopeColorMap.colors = [
            new Color('green'),
            new Color('yellow'),
            new Color('orange'),
            new Color('red'),
            new Color('darkred')
          ];
          const val = parseFloat(heatmapOpacity.value);
          slopeColorMap.opacity = new Array(5).fill(val);
          instance.notifyChange();
        }
      }
    });
  });

  btnAddHeatmapRange?.addEventListener('click', () => {
    const lastMax = customRanges.length > 0 ? customRanges[customRanges.length - 1].max : 0;
    customRanges.push({ min: lastMax, max: lastMax + 15, color: '#ff0000' });
    renderCustomRanges();
  });

  btnApplyCustomHeatmap?.addEventListener('click', () => {
    if (!customHeatmapError) return;
    customHeatmapError.style.display = 'none';
    
    const sorted = [...customRanges].sort((a, b) => a.min - b.min);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].min >= sorted[i].max) {
        customHeatmapError.textContent = `Error: Range must have min < max (${sorted[i].min} to ${sorted[i].max})`;
        customHeatmapError.style.display = 'block';
        return;
      }
      if (i > 0 && sorted[i].min < sorted[i-1].max) {
        customHeatmapError.textContent = `Error: Degrees overlap (${sorted[i-1].max} encounters ${sorted[i].min})`;
        customHeatmapError.style.display = 'block';
        return;
      }
    }
    
    if (slopeColorMap) {
      const RESOLUTION = 256;
      const newColors = [];
      const newOpacities = [];
      const val = parseFloat(heatmapOpacity.value);
      
      for (let i = 0; i < RESOLUTION; i++) {
        // Giro3D maps 0..90 degrees across the array length
        const deg = (i / (RESOLUTION - 1)) * 90;
        let foundColor = null;
        for (const r of customRanges) {
          if (deg >= r.min && deg <= r.max) {
            foundColor = r.color;
            break;
          }
        }
        if (foundColor) {
          newColors.push(new Color(foundColor));
          newOpacities.push(val);
        } else {
          newColors.push(new Color('black'));
          newOpacities.push(0);
        }
      }
      slopeColorMap.colors = newColors;
      slopeColorMap.opacity = newOpacities;
      instance.notifyChange();
    }
  });

  function setActiveSavedItem(itemEl) {
    document.querySelectorAll(".saved-report-item").forEach(el => el.classList.remove("selected-item"));
    if (itemEl) itemEl.classList.add("selected-item");
  }

  // -------------------------------------------------------------------------
  // Saved Reports UI Logic
  // -------------------------------------------------------------------------
  const savedReportsHeader = document.getElementById("savedReportsHeader");
  const reportsCarrot = document.getElementById("reportsCarrot");
  const reportsPanelContent = document.getElementById("reportsPanelContent");
  const reportsList = document.getElementById("reportsList");
  const reportsListLoading = document.getElementById("reportsListLoading");

  savedReportsHeader?.addEventListener("click", () => {
    const show = reportsPanelContent.style.display === "none";
    reportsPanelContent.style.display = show ? "block" : "none";
    reportsCarrot.textContent = show ? "▼" : "▲";
  });

  async function fetchSavedReports() {
    if (reportsListLoading) reportsListLoading.style.display = 'block';
    if (reportsListLoading) reportsListLoading.textContent = "Loading profiles...";
    if (featuresListLines) featuresListLines.innerHTML = '<i style="color: var(--muted); padding: 4px;">Loading profiles...</i>';
    if (reportsList) reportsList.innerHTML = '';

    try {
      if (!activeProject) return;
      let pdfFiles = [];
      let jsonFiles = [];

      try {
        const apiUrl = `https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url?projectId=${encodeURIComponent(activeProject.folderName)}&surveyId=${encodeURIComponent(activeProject.surveyId)}&type=reports`;
        const response = await fetch(apiUrl, { method: "GET", cache: "no-store" });
        if (response.ok) {
          const rawFiles = await response.json();
          const files = Array.isArray(rawFiles) ? rawFiles : [];
          pdfFiles = files.filter(f => f && f.fileName && f.fileName.endsWith('.pdf'));
          jsonFiles = files.filter(f => f && f.fileName && f.fileName.endsWith('.json'));
        }
      } catch (netErr) {
        console.warn("Could not load reports from S3 API", netErr);
      }

      if (reportsListLoading) reportsListLoading.style.display = 'none';

      // Fetch metadata for isOfficial & folder
      const itemsPromises = pdfFiles.map(async pdfFile => {
        const baseName = pdfFile.fileName.replace('.pdf', '');
        const jsonFile = jsonFiles.find(j => j.fileName === `${baseName}.json`);
        let metadata = { isOfficial: false, folder: "General" };
        if (jsonFile) {
          try {
            const _url = jsonFile.url;
            const _cacheBuster = _url.includes('?') ? `&t=${Date.now()}` : `?t=${Date.now()}`;
            const res = await fetch(_url + _cacheBuster, { cache: 'no-store' });
            metadata = await res.json();
          } catch(e) {}
        }
        return { pdfFile, jsonFile, metadata };
      });
      
      let items = await Promise.all(itemsPromises);
      items = items.sort((a,b) => new Date(b.pdfFile.lastModified) - new Date(a.pdfFile.lastModified));
      window._cachedAllProfileItems = items;

      if (reportsList) reportsList.innerHTML = '';
      if (featuresListLines) featuresListLines.innerHTML = '';

      // Group profiles by folder (and ensure known folders exist)
      const profileFolders = {};
      knownProfileFolders.forEach(f => {
        profileFolders[f] = [];
      });

      items.forEach(itemData => {
        const folderName = itemData.metadata.folder || "General";
        addKnownProfileFolder(folderName, false);
        if (!profileFolders[folderName]) profileFolders[folderName] = [];
        profileFolders[folderName].push(itemData);
      });

      // Clean up empty legacy default folders
      const legacyDefaults = ["Haul Roads", "Pit Profiles", "Face", "Stockpiles", "Over burden"];
      legacyDefaults.forEach(f => {
        if (profileFolders[f] && profileFolders[f].length === 0) {
          delete profileFolders[f];
          knownProfileFolders.delete(f);
        }
      });
      saveStoredFolders();

      const renderProfileFolder = (folderName, folderItems, targetContainer) => {
        const folderGroup = document.createElement("div");
        folderGroup.className = "folder-group";

        const svgFolder = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5e19ea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; flex-shrink: 0;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
        const svgChevron = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron-icon" style="transition: transform 0.2s ease; transform: rotate(-90deg);"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

        const fHeader = document.createElement("div");
        fHeader.className = "folder-header";
        fHeader.innerHTML = `
          <span style="display: flex; align-items: center; font-weight: 600; font-size: 13.5px; color: #1e293b;">${svgFolder} ${folderName}</span>
          <div style="display: flex; align-items: center; gap: 6px;">
            <label class="ui-toggle folder-view-toggle" title="View all in ${folderName}" onclick="event.stopPropagation();">
              <input type="checkbox" class="toggle-folder-view-reports" data-folder="${folderName}">
              <span class="ui-toggle-slider"></span>
            </label>
            <button class="btn-rename-folder-trigger" title="Rename folder" data-folder="${folderName}" data-type="profile" style="display: ${isProfilesEditMode ? 'inline-flex' : 'none'}; background: rgba(94, 25, 234, 0.08); border: 1px solid rgba(94, 25, 234, 0.25); color: #5e19ea; width: 22px; height: 22px; border-radius: 4px; cursor: pointer; align-items: center; justify-content: center; padding: 0;">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button class="btn-delete-folder-trigger" title="Delete folder & items" data-folder="${folderName}" data-type="profile" style="display: ${isProfilesEditMode ? 'inline-flex' : 'none'}; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); color: #ef4444; width: 22px; height: 22px; border-radius: 4px; cursor: pointer; align-items: center; justify-content: center; padding: 0;">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
            ${svgChevron}
          </div>
        `;

        const folderToggle = fHeader.querySelector(".toggle-folder-view-reports");
        folderToggle?.addEventListener("change", async (e) => {
          e.stopPropagation();
          const isChecked = e.target.checked;
          if (isChecked) {
            restoreFullMapIfClipped();
            for (const { pdfFile, jsonFile, metadata } of folderItems) {
              const uniqueId = (jsonFile && jsonFile.fileName) ? jsonFile.fileName : pdfFile.fileName;
              const rawName = metadata?.name || metadata?.title || pdfFile.fileName.split('/').pop().replace('.pdf', '').replace(/_/g, ' ');
              let meta = metadata;
              if (!meta && jsonFile && jsonFile.url) {
                try {
                  const _u = jsonFile.url + (jsonFile.url.includes('?') ? '&' : '?') + `t=${Date.now()}`;
                  const r = await fetch(_u, { cache: 'no-store' });
                  if (r.ok) meta = await r.json();
                } catch(err) {}
              }
              if (meta) {
                multiSelectedReportsMap.set(uniqueId, {
                  name: rawName,
                  pdfUrl: pdfFile.url,
                  metadata: meta,
                  data: meta,
                  file: jsonFile,
                  folderName: folderName
                });
              }
            }
          } else {
            for (const [key, val] of Array.from(multiSelectedReportsMap.entries())) {
              if (val.folderName === folderName) {
                multiSelectedReportsMap.delete(key);
              }
            }
          }
          updateMultiOverlaySvg();
        });

        const renameBtn = fHeader.querySelector(".btn-rename-folder-trigger");
        renameBtn?.addEventListener("click", async (e) => {
          e.stopPropagation();
          e.preventDefault();
          const newName = prompt(`Enter new name for folder "${folderName}":`, folderName);
          if (!newName || newName.trim() === "" || newName.trim() === folderName) return;
          const cleanName = newName.trim();
          knownProfileFolders.delete(folderName);
          knownProfileFolders.add(cleanName);
          saveStoredFolders();

          for (const { jsonFile, metadata } of folderItems) {
            if (jsonFile && metadata) {
              try {
                metadata.folder = cleanName;
                const jsonFileName = jsonFile.fileName.split('/').pop();
                const jsonBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" });
                const jsonRes = await fetch("https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ projectId: activeProject.folderName, surveyId: activeProject.surveyId, type: "reports", fileName: jsonFileName })
                });
                if (jsonRes.ok) {
                  const { uploadUrl } = await jsonRes.json();
                  if (uploadUrl) {
                    await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: jsonBlob });
                  }
                }
              } catch (err) {
                console.error("Failed to update folder in metadata:", err);
              }
            }
          }
          fetchSavedReports();
          syncFolderDropdowns("PROFILE");
        });

        const delBtn = fHeader.querySelector(".btn-delete-folder-trigger");
        delBtn?.addEventListener("click", async (e) => {
          e.stopPropagation();
          e.preventDefault();

          if (folderItems.length === 0) {
            if (confirm(`Delete empty subfolder "${folderName}"?`)) {
              knownProfileFolders.delete(folderName);
              saveStoredFolders();
              fetchSavedReports();
              syncFolderDropdowns("PROFILE");
            }
            return;
          }

          if (confirm(`Delete folder "${folderName}" and all ${folderItems.length} path profile(s) in it?`)) {
            delBtn.disabled = true;
            delBtn.textContent = "...";
            try {
              const deletePromises = folderItems.map(async ({ pdfFile, jsonFile }) => {
                const p1 = deleteFile("reports", pdfFile.fileName).catch(() => {});
                const p2 = jsonFile ? deleteFile("reports", jsonFile.fileName).catch(() => {}) : Promise.resolve();
                return Promise.all([p1, p2]);
              });
              await Promise.all(deletePromises);
              knownProfileFolders.delete(folderName);
              saveStoredFolders();
              fetchSavedReports();
              syncFolderDropdowns("PROFILE");
            } catch (err) {
              console.error("Error deleting folder items", err);
              alert("Failed to delete all items in folder.");
              fetchSavedReports();
            }
          }
        });

        const fContent = document.createElement("div");
        fContent.className = "folder-content";
        fContent.style.display = "none";
        fHeader.addEventListener("click", (e) => {
          if (e.target.closest(".btn-delete-folder-trigger") || e.target.closest(".btn-rename-folder-trigger")) return;
          const isHidden = fContent.style.display === "none";
          fContent.style.display = isHidden ? "flex" : "none";
          const chevron = fHeader.querySelector(".chevron-icon");
          if (chevron) chevron.style.transform = isHidden ? "rotate(0deg)" : "rotate(-90deg)";
        });

        const isFeaturesSection = (targetContainer === featuresListLines);
        if (folderItems.length === 0) {
          fContent.innerHTML = `<i style="color: var(--muted); font-size: 11px; padding: 6px 12px; display: block;">No profiles in this folder</i>`;
        } else {
          folderItems.forEach(({ pdfFile, jsonFile, metadata }) => {
            const item = document.createElement("div");
            item.className = "saved-report-item";
            
            const svg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
            const dateStr = new Date(pdfFile.lastModified).toLocaleDateString();
            
            const pdfLinkHtml = `<a href="${pdfFile.url}" target="_blank" class="btn-action-icon" title="Download PDF" onclick="event.stopPropagation();" style="width: 22px; height: 22px; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; background: rgba(94, 25, 234, 0.08); border: 1px solid rgba(94, 25, 234, 0.25); color: #5e19ea; text-decoration: none;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></a>`;
            const rawName = metadata?.name || metadata?.title || pdfFile.fileName.split('/').pop().replace('.pdf', '').replace(/_/g, ' ');
            const delBtnHtml = `<button class="btn-row-delete-icon btn-row-delete-profile" data-filename="${pdfFile.fileName}" title="Delete ${rawName}" style="display: ${isProfilesEditMode ? 'inline-flex' : 'none'};"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`;
            const infoBtnHtml = `<button class="btn-row-info-trigger" title="Quick Info" onclick="event.stopPropagation();"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></button>`;
            
            item.innerHTML = `
              <div style="display: flex; align-items: center; flex: 1; min-width: 0; overflow: hidden; cursor: pointer; gap: 8px;">
                ${isFeaturesSection ? '' : svg}
                <span class="item-title" style="flex: 1; font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${rawName}">${rawName}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: 8px;">
                ${delBtnHtml}
                ${isFeaturesSection ? '' : pdfLinkHtml}
                ${isFeaturesSection ? '' : infoBtnHtml}
              </div>
            `;

            const infoBtn = item.querySelector(".btn-row-info-trigger");
            const triggerProfileQuickInfo = async () => {
              let m = metadata;
              if (!m && jsonFile && jsonFile.url) {
                try {
                  const _u = jsonFile.url + (jsonFile.url.includes('?') ? '&' : '?') + `t=${Date.now()}`;
                  const r = await fetch(_u, { cache: 'no-store' });
                  if (r.ok) m = await r.json();
                } catch(e) {}
              }
              const dist2D = m?.chartData?.totalDist != null ? `${Number(m.chartData.totalDist).toFixed(2)} m` : (m?.totalDistance ? `${Number(m.totalDistance).toFixed(2)} m` : "-");
              const elevChg = m?.chartData?.elevChange != null ? `${Number(m.chartData.elevChange).toFixed(2)} m` : (m?.elevationChange ? `${Number(m.elevationChange).toFixed(2)} m` : "-");
              const dist3D = m?.chartData?.surfDist != null ? `${Number(m.chartData.surfDist).toFixed(2)} m` : (m?.surfaceDistance ? `${Number(m.surfaceDistance).toFixed(2)} m` : "-");

              const rows = [
                { label: "2D Distance", val: dist2D },
                { label: "Elevation Change", val: elevChg },
                { label: "3D Surface Dist", val: dist3D },
                { label: "Date", val: dateStr }
              ];
              showQuickInfoPopover(infoBtn, "Profile", rawName, rows);
            };

            infoBtn?.addEventListener("mouseenter", triggerProfileQuickInfo);
            infoBtn?.addEventListener("click", (e) => {
              e.stopPropagation();
              triggerProfileQuickInfo();
            });
            infoBtn?.addEventListener("mouseleave", hideQuickInfoPopover);

            const delBtn = item.querySelector(".btn-row-delete-profile");
            delBtn?.addEventListener("click", async (e) => {
              e.stopPropagation();
              if (confirm(`Are you sure you want to delete profile "${rawName}"? This cannot be undone.`)) {
                try {
                  delBtn.disabled = true;
                  await deleteFile("reports", pdfFile.fileName);
                  if (jsonFile && jsonFile.fileName) {
                    await deleteFile("reports", jsonFile.fileName).catch(() => {});
                  }
                  fetchSavedReports();
                } catch(err) {
                  alert("Failed to delete: " + err.message);
                }
              }
            });
            
            const loadPathProfile = async () => {
              restoreFullMapIfClipped();
              setActiveSavedItem(item);
              if (!jsonFile) return;
              try {
                const _url = jsonFile.url;
                const _cacheBuster = _url.includes('?') ? `&t=${Date.now()}` : `?t=${Date.now()}`;
                const res = await fetch(_url + _cacheBuster, { cache: 'no-store' });
                const text = await res.text();
                const m = JSON.parse(text);

                window.currentViewingFeature = {
                  type: "PROFILE",
                  name: rawName,
                  pdfFile,
                  jsonFile,
                  metadata: m
                };
                if (typeof updateInfoPanelRenameTrigger === 'function') {
                  updateInfoPanelRenameTrigger(rawName);
                }
                
                if (m.startPoint && m.endPoint) {
                   measureStartPoint = new Vector3(m.startPoint.x, m.startPoint.y, m.startPoint.z);
                   measureEndPoint = new Vector3(m.endPoint.x, m.endPoint.y, m.endPoint.z);
                   
                   if (m.startCoord) {
                     measureStartCoord = new Coordinates(giroCrs, m.startCoord.x, m.startCoord.y, m.startCoord.z);
                   } else {
                     measureStartCoord = new Coordinates(giroCrs, (instance?.reference?.x || 0) + measureStartPoint.x, (instance?.reference?.y || 0) + measureStartPoint.y, measureStartPoint.z);
                   }
                   
                   if (m.endCoord) {
                     measureEndCoord = new Coordinates(giroCrs, m.endCoord.x, m.endCoord.y, m.endCoord.z);
                   } else {
                     measureEndCoord = new Coordinates(giroCrs, (instance?.reference?.x || 0) + measureEndPoint.x, (instance?.reference?.y || 0) + measureEndPoint.y, measureEndPoint.z);
                   }
                   
                   measureMode = "PROFILE";
                   measureState = "FINISHED";
                   
                   if (m.chartData && m.chartData.elevations && m.chartData.elevations.length >= 2) {
                     currentProfilePoints3D = buildProfile3DPointsFromElevations(measureStartPoint, measureEndPoint, m.chartData.elevations);
                   } else {
                     updateElevationProfile();
                   }

                   updateMeasureSvg();
                   requestAnimationFrame(() => {
                     if (instance?.view?.camera) instance.view.camera.updateMatrixWorld(true);
                     updateMeasureSvg();
                   });
                   
                   if (m.chartData && m.chartData.distances && m.chartData.elevations) {
                     currentProfileData = m.chartData.currentProfileData || [];
                     const profHoriz = document.getElementById("profileHoriz");
                     const profVert = document.getElementById("profileVert");
                     const prof3D = document.getElementById("profile3D");
                     if (profHoriz) profHoriz.textContent = (m.chartData.totalDist || 0).toFixed(2) + " m";
                     if (profVert) profVert.textContent = (m.chartData.elevChange || 0).toFixed(2) + " m";
                     if (prof3D) prof3D.textContent = (m.chartData.surfDist || 0).toFixed(2) + " m";
                     
                     if (elevationMiniContainer) elevationMiniContainer.classList.remove('hidden');
                     if (miniChart && (miniChart.width === 0 || miniChart.height === 0)) {
                       miniChart.destroy();
                       miniChart = null;
                     }
                     showUnifiedInfoPanel("PROFILE", `PATH PROFILE: ${rawName}`, null, true);
                      
                     const _savedDistances = m.chartData.distances;
                     const _savedElevations = m.chartData.elevations;
                     setTimeout(() => {
                       initCharts();
                       if (miniChart) {
                         miniChart.data.labels = _savedDistances;
                         miniChart.data.datasets[0].data = _savedElevations;
                         miniChart.resize();
                         miniChart.update('none');
                       }
                     }, 100);
                   } else {
                     updateElevationProfile();
                     showUnifiedInfoPanel("PROFILE", `PATH PROFILE: ${rawName}`, null, true);
                   }
                }
              } catch(e) {
                console.error("Error loading path profile", e);
              }
            };

            item.addEventListener("click", (e) => {
              if (e.target.closest("a.pdf-link") || e.target.closest(".btn-row-delete-icon") || e.target.closest(".btn-action-icon")) return;
              if (e.target.closest("a.pdf-link") || e.target.closest("input")) return;

              const reportName = rawName || pdfFile.fileName.split('/').pop().replace('.pdf', '');
              const uniqueId = (jsonFile && jsonFile.fileName) ? jsonFile.fileName : pdfFile.fileName;

              if (isMultiSelectReports) {
                if (multiSelectedReportsMap.has(uniqueId)) {
                  multiSelectedReportsMap.delete(uniqueId);
                  item.classList.remove("selected-item");
                  if (activeFocusedFeatureId === uniqueId) {
                    activeFocusedFeatureId = multiSelectedReportsMap.keys().next().value || null;
                  }
                  if (typeof updateMultiOverlaySvg === "function") updateMultiOverlaySvg();
                } else {
                  item.classList.add("selected-item");
                  activeFocusedFeatureId = uniqueId;
                  if (jsonFile && jsonFile.url) {
                    const _url = jsonFile.url;
                    const _cacheBuster = _url.includes('?') ? `&t=${Date.now()}` : `?t=${Date.now()}`;
                    fetch(_url + _cacheBuster, { cache: 'no-store' })
                      .then(res => res.text())
                      .then(text => {
                        const m = JSON.parse(text);
                        multiSelectedReportsMap.set(uniqueId, { file: jsonFile, metadata: m, data: m, name: reportName });
                        showUnifiedInfoPanel("PROFILE", `PATH PROFILE: ${reportName}`, m, true);
                        if (typeof updateMultiOverlaySvg === "function") updateMultiOverlaySvg();
                      }).catch(e => console.error("Error fetching report json", e));
                  } else {
                    multiSelectedReportsMap.set(uniqueId, { file: jsonFile, metadata, data: metadata, name: reportName });
                    showUnifiedInfoPanel("PROFILE", `PATH PROFILE: ${reportName}`, metadata, true);
                    if (typeof updateMultiOverlaySvg === "function") updateMultiOverlaySvg();
                  }
                }
              } else {
                multiSelectedReportsMap.clear();
                document.querySelectorAll("#reportsList .saved-report-item").forEach(el => el.classList.remove("selected-item"));
                item.classList.add("selected-item");
                activeFocusedFeatureId = uniqueId;
                multiSelectedReportsMap.set(uniqueId, { file: jsonFile, metadata, data: metadata, name: reportName });
                loadPathProfile();
                if (typeof updateMultiOverlaySvg === "function") updateMultiOverlaySvg();
              }
            });
            
            fContent.appendChild(item);
          });
        }

        folderGroup.appendChild(fHeader);
        folderGroup.appendChild(fContent);
        targetContainer.appendChild(folderGroup);
      };

      let hasItems = false;
      Object.keys(profileFolders).sort().forEach(folderName => {
        if (reportsList) renderProfileFolder(folderName, profileFolders[folderName], reportsList);
        if (featuresListLines) renderProfileFolder(folderName, profileFolders[folderName], featuresListLines);
        if (profileFolders[folderName].length > 0) hasItems = true;
      });

      if (!hasItems && reportsList) {
        reportsList.innerHTML = '<i style="color: var(--muted); padding: 4px;">No saved path profiles yet.</i>';
      }
      
      // Restore UI state if re-fetched during manage mode
      if (typeof toggleManageMode === 'function') toggleManageMode(window.isReportManageMode || false);
      
    } catch (err) {
      console.error(err);
      if (reportsList) reportsList.innerHTML = '<i style="color: #ef4444; padding: 4px;">Error loading profiles.</i>';
      if (featuresListLines) featuresListLines.innerHTML = '<i style="color: #ef4444; padding: 4px;">Error loading profiles.</i>';
    }
  }

  // --- Streamlined Path Profiles Edit Mode Logic ---
  let isProfilesEditMode = false;

  function toggleProfilesEditMode(enable = !isProfilesEditMode) {
    isProfilesEditMode = enable;
    const btnManageProfilesFolder = document.getElementById("btnManageProfilesFolder");
    const manageReportsBtn = document.getElementById("manageReportsBtn");
    [btnManageProfilesFolder, manageReportsBtn].forEach(b => b?.classList.toggle("active", isProfilesEditMode));

    document.querySelectorAll(".btn-row-delete-profile").forEach(el => {
      el.style.display = isProfilesEditMode ? "inline-flex" : "none";
    });
    document.querySelectorAll("#panel-profile .btn-delete-folder-trigger, #featuresListLines .btn-delete-folder-trigger").forEach(b => {
      b.style.display = isProfilesEditMode ? "inline-flex" : "none";
    });
  }

  document.getElementById("manageReportsBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleProfilesEditMode();
  });
  document.getElementById("btnManageProfilesFolder")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleProfilesEditMode();
  });

  document.getElementById("btnNewProfilesFolder")?.addEventListener("click", (e) => {
    e.stopPropagation();
    promptNewFolder("PROFILE");
  });

  // Fetch immediately on load
  fetchSavedReports();

  // Direct Panel Add Folder Buttons
  const btnNewProfileFolder = document.getElementById("btnNewProfileFolder");
  btnNewProfileFolder?.addEventListener("click", () => {
    const newFolder = prompt("Enter new folder name for Path Profiles:");
    if (newFolder && newFolder.trim() !== "") {
      const trimmed = newFolder.trim();
      addKnownProfileFolder(trimmed, true, trimmed);
      fetchSavedReports();
    }
  });

  const btnNewVolumeFolder = document.getElementById("btnNewVolumeFolder");
  btnNewVolumeFolder?.addEventListener("click", () => {
    const newFolder = prompt("Enter new folder name for Volumes:");
    if (newFolder && newFolder.trim() !== "") {
      const trimmed = newFolder.trim();
      addKnownVolumeFolder(trimmed, true, trimmed);
      fetchSavedVolumes();
    }
  });

  const btnNewFeatureFolder = document.getElementById("btnNewFeatureFolder");
  btnNewFeatureFolder?.addEventListener("click", () => {
    const choice = prompt("Create folder in:\n1: Path Profiles\n2: Volumes\n\nEnter 1 or 2 (or type folder name):", "1");
    if (!choice) return;
    if (choice === "1") {
      const name = prompt("Enter new folder name for Path Profiles:");
      if (name && name.trim()) {
        addKnownProfileFolder(name.trim(), true, name.trim());
        fetchSavedReports();
      }
    } else if (choice === "2") {
      const name = prompt("Enter new folder name for Volumes:");
      if (name && name.trim()) {
        addKnownVolumeFolder(name.trim(), true, name.trim());
        fetchSavedVolumes();
      }
    } else {
      const trimmed = choice.trim();
      addKnownProfileFolder(trimmed, true, trimmed);
      addKnownVolumeFolder(trimmed, true, trimmed);
      fetchSavedReports();
      fetchSavedVolumes();
    }
  });

  // -------------------------------------------------------------------------
  // VOLUME SAVING AND FOLDERS LOGIC
  // -------------------------------------------------------------------------
  const btnSaveVolume = document.getElementById("btnSaveVolume");
  const volumeSaveModal = document.getElementById("volumeSaveModal");
  const btnCancelVolSave = document.getElementById("btnCancelVolSave");
  const btnConfirmVolSave = document.getElementById("btnConfirmVolSave");
  const volSaveName = document.getElementById("volSaveName");
  const volSaveFolder = document.getElementById("volSaveFolder");
  const btnNewVolFolder = document.getElementById("btnNewVolFolder");
  const closeVolumeMiniBtn = document.getElementById("closeVolumeMiniBtn");

  const savedVolumesHeader = document.getElementById("savedVolumesHeader");
  const volumesCarrot = document.getElementById("volumesCarrot");
  const volumesPanelContent = document.getElementById("volumesPanelContent");
  const volumesList = document.getElementById("volumesList");
  const volumesListLoading = document.getElementById("volumesListLoading");

  
  
  // Pre-fetch volumes and ROIs on load so the panel is ready instantly
  fetchSavedVolumes();
  fetchSavedRois();

  closeVolumeMiniBtn?.addEventListener("click", () => {
    if (volumeMiniContainer) volumeMiniContainer.classList.add("hidden");
  });

  btnSaveVolume?.addEventListener("click", () => {
    if (volumeSaveModal) {
      volumeSaveModal.classList.remove("hidden");
      volSaveName.value = "";
      volSaveName.focus();
    }
  });

  btnCancelVolSave?.addEventListener("click", () => {
    if (volumeSaveModal) volumeSaveModal.classList.add("hidden");
  });

  btnNewVolFolder?.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    
    // Custom prompt to bypass iframe restrictions
    const promptDiv = document.createElement("div");
    promptDiv.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;pointer-events:auto;";
    promptDiv.innerHTML = `
      <div style="background:white;padding:20px;border-radius:8px;box-shadow:0 10px 25px rgba(0,0,0,0.2);width:300px;">
        <div style="font-weight:bold;margin-bottom:10px;color:#333;">New Folder</div>
        <input type="text" id="customPromptInput" placeholder="e.g. Stockpiles" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;margin-bottom:15px;pointer-events:auto;user-select:text;">
        <div style="display:flex;justify-content:flex-end;gap:10px;">
          <button id="customPromptCancel" style="padding:6px 12px;border:none;background:#eee;border-radius:4px;cursor:pointer;">Cancel</button>
          <button id="customPromptOk" style="padding:6px 12px;border:none;background:#0ea5e9;color:white;border-radius:4px;cursor:pointer;">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(promptDiv);
    
    const input = document.getElementById("customPromptInput");
    setTimeout(() => input.focus(), 10);
    
    const cleanup = () => { if (promptDiv.parentNode) promptDiv.parentNode.removeChild(promptDiv); };
    
    document.getElementById("customPromptCancel").addEventListener("click", cleanup);
    document.getElementById("customPromptOk").addEventListener("click", () => {
      const newFolder = input.value.trim();
      if (newFolder) {
        addKnownFolder(newFolder, true, newFolder);
      }
      cleanup();
    });
  });

  btnConfirmVolSave?.addEventListener("click", async () => {
    const name = volSaveName.value.trim();
    const folder = volSaveFolder.value;
    if (!name) {
      alert("Please enter a volume name.");
      return;
    }
    btnConfirmVolSave.disabled = true;
    btnConfirmVolSave.textContent = "Saving...";

    try {
      if (!activeProject) throw new Error("No active project");

      const data = {
        name,
        folder,
        isOfficial: !window.isDumpDraw,
        timestamp: new Date().toISOString(),
        area2D: document.getElementById("volMiniArea").textContent,
        perimeter: document.getElementById("volMiniPerim").textContent,
        cutVolume: document.getElementById("volMiniCut").textContent,
        fillVolume: document.getElementById("volMiniFill").textContent,
        points: volumePoints.map(p => ({ x: p.coord.x, y: p.coord.y, z: p.coord.z }))
      };

      const jsonStr = JSON.stringify(data, null, 2);
      const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const fileName = `${folder}/${safeName}_${Date.now()}.json`;
      
      const response = await fetch(`https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: activeProject.folderName,
          surveyId: activeProject.surveyId,
          type: "volumes",
          fileName: fileName
        })
      });

      if (!response.ok) throw new Error("Failed to get upload URL");
      const { uploadUrl } = await response.json();

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: jsonStr
      });

      if (!putRes.ok) throw new Error("Failed to upload JSON to S3");

      if (volumeSaveModal) volumeSaveModal.classList.add("hidden");
      alert("Volume saved successfully!");
      fetchSavedVolumes();
    } catch (err) {
      console.error("Error saving volume", err);
      alert("Error saving volume: " + err.message);
    } finally {
      btnConfirmVolSave.disabled = false;
      btnConfirmVolSave.textContent = "Save";
    }
  });

  // Toggle saved volumes panel
  savedVolumesHeader?.addEventListener("click", () => {
    if (volumesPanelContent.style.display === "none" || !volumesPanelContent.style.display) {
      volumesPanelContent.style.display = "block";
      volumesCarrot.textContent = "▼";
    } else {
      volumesPanelContent.style.display = "none";
      volumesCarrot.textContent = "▶";
    }
  });

  
  closeRoiMiniBtn?.addEventListener("click", () => {
    if (roiMiniContainer) roiMiniContainer.classList.add("hidden");
    roiPolyPoints = [];
    if (volumePolygonSvg) volumePolygonSvg.style.display = "none";
    if (volumeVerticesSvg) volumeVerticesSvg.style.display = "none";
    if (volumeSvg) volumeSvg.style.display = "none";
    if (roiMetrics) roiMetrics.classList.add("hidden");
    measureMode = "IDLE";
    measureState = "IDLE";
    if (activeProject) loadProject(activeProject, null);
  });

  btnConfirmRoiSave?.addEventListener("click", async () => {
    const name = roiSaveName.value.trim();
    if (!name) { alert("Please enter an ROI name."); return; }
    
    btnConfirmRoiSave.disabled = true;
    btnConfirmRoiSave.textContent = "Saving...";
    
    try {
      if (!activeProject) throw new Error("No active project");
      const metrics = calculateRoiPolyMetrics();
      const data = {
        name,
        isOfficial: !window.isDumpDraw,
        timestamp: new Date().toISOString(),
        area2D: metrics.area,
        perimeter: metrics.perimeter,
        points: roiPolyPoints.map(p => ({ x: p.coord.x, y: p.coord.y, z: p.coord.z }))
      };
      
      const jsonStr = JSON.stringify(data, null, 2);
      const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const fileName = `General/${safeName}_${Date.now()}.json`;
      
      const response = await fetch(`https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeProject.folderName, surveyId: activeProject.surveyId, type: "rois", fileName })
      });
      if (!response.ok) throw new Error("Failed to get upload URL");
      const { uploadUrl } = await response.json();
      
      const putRes = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: jsonStr });
      if (!putRes.ok) throw new Error("Failed to upload JSON to S3");
      
      if (roiMiniContainer) roiMiniContainer.classList.add("hidden");
      alert("ROI saved successfully!");
      fetchSavedRois();
    } catch (err) {
      console.error(err);
      alert("Error saving ROI: " + err.message);
    } finally {
      btnConfirmRoiSave.disabled = false;
      btnConfirmRoiSave.textContent = "Save ROI";
    }
  });

  window.loadRoiArea = async function(url) {
    try {
      clearAllLeftPanelState();
      const res = await fetch(url);
      const data = await res.json();
      roiPolyPoints = data.points.map(pt => ({
        coord: new Coordinates(giroCrs, pt.x, pt.y, pt.z),
        point: new Vector3(pt.x, pt.y, pt.z)
      }));
      
      measureMode = "ROI_POLY";
      measureState = "FINISHED_ROI_POLY";
      roiPolyMousePoint = null;
      updateRoiPolySvg();
      if (roiArea) roiArea.textContent = (data.area2D || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
      if (roiPerimeter) roiPerimeter.textContent = (data.perimeter || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
      if (roiMetrics) roiMetrics.classList.remove("hidden");
      showUnifiedInfoPanel("POLY_ROI", "SAVED ROI", data, true);

      applyRoiPolyClipping();
    } catch (err) {
      console.error("Error loading ROI", err);
    }
  };

  // -------------------------------------------------------------------------
  // Generic file delete utility - works for rois, volumes, shapes, lines, points
  // API requires fileName in JSON body (same as reports delete)
  // -------------------------------------------------------------------------
  const API_BASE = "https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url";

  async function deleteFile(type, fileName) {
    const delUrl = `${API_BASE}?projectId=${encodeURIComponent(activeProject.folderName)}&surveyId=${encodeURIComponent(activeProject.surveyId)}&type=${encodeURIComponent(type)}&fileName=${encodeURIComponent(fileName)}`;
    const res = await fetch(delUrl, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: activeProject.folderName,
        surveyId: activeProject.surveyId,
        type: type,
        fileName: fileName
      })
    });
    if (!res.ok) throw new Error('Delete failed: ' + res.status);
  }

  window.deleteFileByUrl = async function(url, type, fileName) {
    if (!confirm(`Delete this item? This cannot be undone.`)) return;
    try {
      await deleteFile(type, fileName);
      if (type === 'rois') fetchSavedRois();
      else if (type === 'volumes') fetchSavedVolumes();
    } catch(err) {
      console.error('Delete error:', err);
      alert('Failed to delete: ' + err.message);
    }
  };

  function restoreFullMapIfClipped() {
    const hasClipping = isTerrainClippedToRoi || (map && map.clippingPlanes && map.clippingPlanes.length > 0) || (typeof roiPolyPoints !== "undefined" && roiPolyPoints.length > 0) || measureMode === "ROI_POLY" || measureState === "FINISHED_ROI_POLY";
    if (hasClipping) {
      isTerrainClippedToRoi = false;
      if (map) map.clippingPlanes = [];
      if (typeof resetRoiState === "function") resetRoiState();
      if (typeof roiSvg !== "undefined" && roiSvg) roiSvg.style.display = "none";
      if (typeof roiPolyPoints !== "undefined") roiPolyPoints = [];
      if (typeof volumePolygonSvg !== "undefined" && volumePolygonSvg) volumePolygonSvg.style.display = "none";
      if (typeof volumeVerticesSvg !== "undefined" && volumeVerticesSvg) volumeVerticesSvg.style.display = "none";
      if (typeof volumeSvg !== "undefined" && volumeSvg) volumeSvg.style.display = "none";
      if (measureMode === "ROI_POLY" || measureState === "FINISHED_ROI_POLY") {
        measureState = "IDLE";
        measureMode = "NONE";
      }
      if (typeof updateRoiPolySvg === "function") updateRoiPolySvg();
      const resetRoiBtn = document.getElementById("resetROI");
      if (resetRoiBtn) resetRoiBtn.disabled = true;
      const clipProject = activeProject || (typeof getActiveProjectConfig === "function" ? getActiveProjectConfig() : null);
      if (typeof loadProject === "function" && clipProject) {
        loadProject(clipProject, null);
      }
    }
  }
  window.restoreFullMapIfClipped = restoreFullMapIfClipped;

  // -------------------------------------------------------------------------
  // Left Panel Exclusive State: only one feature can be active at a time
  // -------------------------------------------------------------------------
  function clearAllLeftPanelState() {
    // 1. Clear Profile/Line & Distance Measurements
    const btnClearProfile = document.getElementById('btnClearProfile');
    if (btnClearProfile) {
      btnClearProfile.disabled = false;
      btnClearProfile.click();
    }
    clearMeasure();
    if (measureSvg) measureSvg.style.display = "none";
    currentProfilePoints3D = [];
    currentProfileData = [];

    // 2. Clear Volume/Polygon
    const btnClearVolume = document.getElementById('btnClearVolume');
    if (btnClearVolume) {
      btnClearVolume.disabled = false;
      btnClearVolume.click();
    }
    volumePoints = [];
    volumeMousePoint = null;
    if (volumeSvg) volumeSvg.style.display = "none";

    // 3. Clear Simple Measure
    const btnClearMeasureSimple = document.getElementById('btnClearMeasureSimple');
    if (btnClearMeasureSimple) {
      btnClearMeasureSimple.disabled = false;
      btnClearMeasureSimple.click();
    }

    // 4. Clear Points
    if (pointMiniContainer) pointMiniContainer.classList.add('hidden');
    pointDrawPoint = null;
    pointDrawCoord = null;
    if (pointSvg) pointSvg.style.display = 'none';

    // 5. Clear multi-selected overlay maps & SVG groups
    if (typeof multiSelectedReportsMap !== 'undefined') multiSelectedReportsMap.clear();
    if (typeof multiSelectedVolumesMap !== 'undefined') multiSelectedVolumesMap.clear();
    const multiPolygonsGroup = document.getElementById("multiPolygonsGroup");
    const multiLinesGroup = document.getElementById("multiLinesGroup");
    const multiBadgesGroup = document.getElementById("multiBadgesGroup");
    if (multiPolygonsGroup) multiPolygonsGroup.innerHTML = "";
    if (multiLinesGroup) multiLinesGroup.innerHTML = "";
    if (multiBadgesGroup) multiBadgesGroup.innerHTML = "";
    if (typeof updateMultiOverlaySvg === 'function') updateMultiOverlaySvg();

    // 6. Reset all View All switches (master and subfolders)
    const toggleViewAllReports = document.getElementById("toggleViewAllReports");
    const toggleViewAllVolumes = document.getElementById("toggleViewAllVolumes");
    if (toggleViewAllReports) toggleViewAllReports.checked = false;
    if (toggleViewAllVolumes) toggleViewAllVolumes.checked = false;
    document.querySelectorAll(".toggle-folder-view-reports, .toggle-folder-view-volumes").forEach(cb => cb.checked = false);

    // 7. Hide Info Panel & clear current viewing feature
    if (unifiedInfoPanel) unifiedInfoPanel.classList.add("hidden");
    const infoInlineRenameContainer = document.getElementById("infoInlineRenameContainer");
    if (infoInlineRenameContainer) infoInlineRenameContainer.classList.add("hidden");
    window.currentViewingFeature = null;

    // 8. Remove active list highlights
    document.querySelectorAll(".saved-report-item.active, .saved-item-card.active, .drawn-feature-item.active, .selected-item").forEach(el => {
      el.classList.remove("active", "selected-item");
    });

    // 9. Restore full unclipped map if ROI was active
    restoreFullMapIfClipped();
  }
  window.clearAllLeftPanelState = clearAllLeftPanelState;
  window.clearAllViewingState = clearAllLeftPanelState;

  async function fetchSavedRois() {
    const leftRoisList = document.getElementById("leftRoisList");
    if (featuresListRois) featuresListRois.innerHTML = '<i style="color: var(--muted); padding: 4px;">Loading...</i>';
    if (leftRoisList) leftRoisList.innerHTML = '<i style="color: var(--muted); padding: 4px;">Loading...</i>';
    try {
      if (!activeProject) return;
      const apiUrl = `https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url?projectId=${activeProject.folderName}&surveyId=${activeProject.surveyId}&type=rois`;
      const response = await fetch(apiUrl, { method: "GET", cache: "no-store" });
      if (!response.ok) throw new Error("Failed to fetch ROIs");
      const files = await response.json();
      const jsonFiles = files.filter(f => f.fileName.endsWith('.json'));
      
      if (jsonFiles.length === 0) {
        if (featuresListRois) featuresListRois.innerHTML = '<i style="color: var(--muted); padding: 4px;">No ROI areas saved yet.</i>';
        if (leftRoisList) leftRoisList.innerHTML = '<i style="color: var(--muted); padding: 4px;">No ROI areas saved yet.</i>';
        return;
      }
      
      if (featuresListRois) featuresListRois.innerHTML = '';
      if (leftRoisList) leftRoisList.innerHTML = '';

      for (const file of jsonFiles) {
        const createRoiItem = () => {
          const item = document.createElement("div");
          item.className = "saved-report-item";
          const cbHtml = `<input type="checkbox" class="feature-checkbox premium-checkbox" data-filename="${file.fileName}" value="${file.fileName}" style="display: none; margin-right: 8px;">`;
          item.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
              ${cbHtml}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #8b5cf6; flex-shrink: 0;"><polygon points="12 2 22 8.5 18 20 6 20 2 8.5 12 2"></polygon></svg>
              <span style="font-weight: 500; font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${file.fileName.split('/').pop().replace('.json', '')}</span>
            </div>
          `;
          
          item.addEventListener("click", (e) => {
            if (window.isFeatureManageMode || window.isVolumeManageMode) return;
            if (e.target.closest("input")) return;
            setActiveSavedItem(item);
            loadRoiArea(file.url);
          });
          return item;
        };

        if (featuresListRois) featuresListRois.appendChild(createRoiItem());
        if (leftRoisList) leftRoisList.appendChild(createRoiItem());
      }
    } catch(err) {
      if (featuresListRois) featuresListRois.innerHTML = '<i style="color: #ef4444; padding: 4px;">Failed to load ROIs.</i>';
      if (leftRoisList) leftRoisList.innerHTML = '<i style="color: #ef4444; padding: 4px;">Failed to load ROIs.</i>';
    }
  }

  async function fetchSavedVolumes() {
    const volumesList = document.getElementById("volumesList");
    const featuresListPolygons = document.getElementById("featuresListPolygons");
    const volumesListLoading = document.getElementById("volumesListLoading");

    if (volumesList) volumesList.innerHTML = '';
    if (featuresListPolygons) featuresListPolygons.innerHTML = '';

    try {
      if (!activeProject) return;
      let jsonFiles = [];

      try {
        const apiUrl = `https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url?projectId=${encodeURIComponent(activeProject.folderName)}&surveyId=${encodeURIComponent(activeProject.surveyId)}&type=volumes`;
        const response = await fetch(apiUrl, { method: "GET", cache: "no-store" });
        if (response.ok) {
          const rawFiles = await response.json();
          const files = Array.isArray(rawFiles) ? rawFiles : [];
          jsonFiles = files.filter(f => f && f.fileName && f.fileName.endsWith('.json'));
        }
      } catch (netErr) {
        console.warn("Could not load volumes from S3 API", netErr);
      }

      if (volumesListLoading) volumesListLoading.style.display = 'none';

      // Group by folder (and ensure known folders exist)
      const volumeFolders = {};
      knownVolumeFolders.forEach(f => {
        volumeFolders[f] = [];
      });

      const allVolumeItems = [];
      for (let file of jsonFiles) {
        try {
          const _url = file.url;
          const _cacheBuster = _url.includes('?') ? `&t=${Date.now()}` : `?t=${Date.now()}`;
          const res = await fetch(_url + _cacheBuster, { cache: 'no-store' });
          if (!res.ok) continue;
          const metadata = await res.json();
          const folderName = metadata.folder || "General";
          addKnownVolumeFolder(folderName, false);
          
          if (!volumeFolders[folderName]) volumeFolders[folderName] = [];
          const itemObj = { file, metadata };
          volumeFolders[folderName].push(itemObj);
          allVolumeItems.push(itemObj);
        } catch (e) {
          console.error("Error parsing volume json", e);
        }
      }
      window._cachedAllVolumeItems = allVolumeItems;

      // Clean up empty legacy default folders
      const legacyDefaults = ["Haul Roads", "Pit Profiles", "Face", "Stockpiles", "Over burden"];
      legacyDefaults.forEach(f => {
        if (volumeFolders[f] && volumeFolders[f].length === 0) {
          delete volumeFolders[f];
          knownVolumeFolders.delete(f);
        }
      });
      saveStoredFolders();

      const renderFolder = (folderName, folderItems, targetContainer) => {
        const folderGroup = document.createElement("div");
        folderGroup.className = "folder-group";
        
        const svgFolder = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5e19ea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; flex-shrink: 0;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
        const svgChevron = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron-icon" style="transition: transform 0.2s ease; transform: rotate(-90deg);"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

        const fHeader = document.createElement("div");
        fHeader.className = "folder-header";
        fHeader.innerHTML = `
          <span style="display: flex; align-items: center; font-weight: 600; font-size: 13.5px; color: #1e293b;">${svgFolder} ${folderName}</span>
          <div style="display: flex; align-items: center; gap: 6px;">
            <label class="ui-toggle folder-view-toggle" title="View all in ${folderName}" onclick="event.stopPropagation();">
              <input type="checkbox" class="toggle-folder-view-volumes" data-folder="${folderName}">
              <span class="ui-toggle-slider"></span>
            </label>
            <button class="btn-rename-folder-trigger" title="Rename folder" data-folder="${folderName}" data-type="volume" style="display: ${isVolumesEditMode ? 'inline-flex' : 'none'}; background: rgba(94, 25, 234, 0.08); border: 1px solid rgba(94, 25, 234, 0.25); color: #5e19ea; width: 22px; height: 22px; border-radius: 4px; cursor: pointer; align-items: center; justify-content: center; padding: 0;">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button class="btn-delete-folder-trigger" title="Delete folder & items" data-folder="${folderName}" data-type="volume" style="display: ${isVolumesEditMode ? 'inline-flex' : 'none'}; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); color: #ef4444; width: 22px; height: 22px; border-radius: 4px; cursor: pointer; align-items: center; justify-content: center; padding: 0;">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
            ${svgChevron}
          </div>
        `;

        const folderVolToggle = fHeader.querySelector(".toggle-folder-view-volumes");
        folderVolToggle?.addEventListener("change", (e) => {
          e.stopPropagation();
          const isChecked = e.target.checked;
          if (isChecked) {
            restoreFullMapIfClipped();
            for (const { file, metadata } of folderItems) {
              const uniqueId = file.fileName || metadata?.name || "Volume";
              const volName = metadata?.name || file.fileName.split('/').pop().replace('.json', '');
              multiSelectedVolumesMap.set(uniqueId, {
                file,
                metadata,
                data: metadata,
                name: volName,
                folderName: folderName
              });
            }
          } else {
            for (const [key, val] of Array.from(multiSelectedVolumesMap.entries())) {
              if (val.folderName === folderName) {
                multiSelectedVolumesMap.delete(key);
              }
            }
          }
          updateMultiOverlaySvg();
        });

        const renameBtn = fHeader.querySelector(".btn-rename-folder-trigger");
        renameBtn?.addEventListener("click", async (e) => {
          e.stopPropagation();
          e.preventDefault();
          const newName = prompt(`Enter new name for folder "${folderName}":`, folderName);
          if (!newName || newName.trim() === "" || newName.trim() === folderName) return;
          const cleanName = newName.trim();
          knownVolumeFolders.delete(folderName);
          knownVolumeFolders.add(cleanName);
          saveStoredFolders();

          for (const { file, metadata } of folderItems) {
            if (file && metadata) {
              try {
                metadata.folder = cleanName;
                const jsonFileName = file.fileName.split('/').pop();
                const jsonBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" });
                const jsonRes = await fetch("https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ projectId: activeProject.folderName, surveyId: activeProject.surveyId, type: "volumes", fileName: jsonFileName })
                });
                if (jsonRes.ok) {
                  const { uploadUrl } = await jsonRes.json();
                  if (uploadUrl) {
                    await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: jsonBlob });
                  }
                }
              } catch (err) {
                console.error("Failed to update folder in volume metadata:", err);
              }
            }
          }
          fetchSavedVolumes();
          syncFolderDropdowns("VOLUME");
        });

        const delBtn = fHeader.querySelector(".btn-delete-folder-trigger");
        delBtn?.addEventListener("click", async (e) => {
          e.stopPropagation();
          e.preventDefault();

          if (folderItems.length === 0) {
            if (confirm(`Delete empty subfolder "${folderName}"?`)) {
              knownVolumeFolders.delete(folderName);
              saveStoredFolders();
              fetchSavedVolumes();
              syncFolderDropdowns("VOLUME");
            }
            return;
          }

          if (confirm(`Delete folder "${folderName}" and all ${folderItems.length} volume(s) in it?`)) {
            delBtn.disabled = true;
            delBtn.textContent = "...";
            try {
              const deletePromises = folderItems.map(async ({ file }) => {
                return deleteFile("volumes", file.fileName).catch(() => {});
              });
              await Promise.all(deletePromises);
              knownVolumeFolders.delete(folderName);
              saveStoredFolders();
              fetchSavedVolumes();
              syncFolderDropdowns("VOLUME");
            } catch (err) {
              console.error("Error deleting volume folder items", err);
              alert("Failed to delete all items in volume folder.");
              fetchSavedVolumes();
            }
          }
        });
        
        const fContent = document.createElement("div");
        fContent.className = "folder-content";
        fContent.style.display = "none";
        fHeader.addEventListener("click", (e) => {
          if (e.target.closest(".btn-delete-folder-trigger") || e.target.closest(".btn-rename-folder-trigger")) return;
          const isHidden = fContent.style.display === "none";
          fContent.style.display = isHidden ? "flex" : "none";
          const chevron = fHeader.querySelector(".chevron-icon");
          if (chevron) chevron.style.transform = isHidden ? "rotate(0deg)" : "rotate(-90deg)";
        });

        const isFeaturesSection = (targetContainer === featuresListPolygons);
        if (folderItems.length === 0) {
          fContent.innerHTML = `<i style="color: var(--muted); font-size: 11px; padding: 6px 12px; display: block;">No volumes in this folder</i>`;
        } else {
          folderItems.forEach(({ file, metadata }) => {
            const item = document.createElement("div");
            item.className = "saved-report-item";
            
            const niceName = metadata?.name || metadata?.title || file.fileName.split('/').pop().replace(/_[0-9]+\.json$/, '').replace(/_/g, ' ');
            const delVolBtnHtml = `<button class="btn-row-delete-icon btn-row-delete-vol" data-filename="${file.fileName}" title="Delete ${niceName}" style="display: ${isVolumesEditMode ? 'inline-flex' : 'none'};"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`;
            const infoVolBtnHtml = `<button class="btn-row-info-trigger" title="Quick Info" onclick="event.stopPropagation();"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></button>`;
            const svg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`;
            item.innerHTML = `
              <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                <div style="display: flex; align-items: center; flex: 1; min-width: 0; gap: 8px;">
                  ${isFeaturesSection ? '' : svg}
                  <span class="item-title" style="flex: 1; font-weight: 500; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${niceName}">${niceName}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: 8px;">
                  ${delVolBtnHtml}
                  ${isFeaturesSection ? '' : infoVolBtnHtml}
                </div>
              </div>
            `;

            const infoVolBtn = item.querySelector(".btn-row-info-trigger");
            const triggerVolumeQuickInfo = () => {
              const rows = [
                { label: "2D Area", val: metadata?.area2D || metadata?.area || "-" },
                { label: "Perimeter", val: metadata?.perimeter || "-" },
                { label: "Cut Volume", val: metadata?.cutVolume || "-" },
                { label: "Fill Volume", val: metadata?.fillVolume || "-" },
                { label: "Date", val: new Date(file.lastModified).toLocaleDateString() }
              ];
              showQuickInfoPopover(infoVolBtn, "Volume", niceName, rows);
            };

            infoVolBtn?.addEventListener("mouseenter", triggerVolumeQuickInfo);
            infoVolBtn?.addEventListener("click", (e) => {
              e.stopPropagation();
              triggerVolumeQuickInfo();
            });
            infoVolBtn?.addEventListener("mouseleave", hideQuickInfoPopover);

            const delVolBtn = item.querySelector(".btn-row-delete-vol");
            delVolBtn?.addEventListener("click", async (e) => {
              e.stopPropagation();
              if (confirm(`Are you sure you want to delete volume "${niceName}"? This cannot be undone.`)) {
                try {
                  delVolBtn.disabled = true;
                  await deleteFile("volumes", file.fileName);
                  fetchSavedVolumes();
                } catch(err) {
                  alert("Failed to delete volume: " + err.message);
                }
              }
            });

          const loadVolumeAction = async () => {
            restoreFullMapIfClipped();
            setActiveSavedItem(item);
            
            try {
              clearAllLeftPanelState();
              measureMode = "VOLUME";
              measureState = "FINISHED_VOLUME";

              window.currentViewingFeature = {
                type: "VOLUME",
                name: niceName,
                file,
                metadata
              };
              if (typeof updateInfoPanelRenameTrigger === 'function') {
                updateInfoPanelRenameTrigger(niceName);
              }
              
              volumePoints = metadata.points.map(p => ({
                  coord: new Coordinates(giroCrs, p.x, p.y, p.z),
                  point: new Vector3(p.x, p.y, p.z)
              }));
              
              let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
              let cx = 0, cy = 0;
              for (let p of volumePoints) {
                if (p.coord.x < minX) minX = p.coord.x;
                if (p.coord.x > maxX) maxX = p.coord.x;
                if (p.coord.y < minY) minY = p.coord.y;
                if (p.coord.y > maxY) maxY = p.coord.y;
                cx += p.coord.x;
                cy += p.coord.y;
              }
              updateVolumeSvg();
              requestAnimationFrame(() => {
                if (instance?.view?.camera) instance.view.camera.updateMatrixWorld(true);
                updateVolumeSvg();
              });
              
              document.getElementById("volMiniArea").textContent = metadata.area2D;
              document.getElementById("volMiniPerim").textContent = metadata.perimeter;
              document.getElementById("volMiniCut").textContent = metadata.cutVolume;
              document.getElementById("volMiniFill").textContent = metadata.fillVolume;
              
              showUnifiedInfoPanel("VOLUME", `VOLUME: ${niceName}`, metadata, true);
              
              if (volumesPanelContent && volumesPanelContent.style.display === "none") {
                savedVolumesHeader.click();
              }
              
              btnClearVolume.disabled = false;
              
            } catch(err) {
              console.error("Failed to load volume metadata", err);
              alert("Failed to load volume details.");
            }
          };

          item.addEventListener("click", (e) => {
            if (e.target.closest(".btn-row-delete-icon") || e.target.closest("button")) return;
            if (e.target.closest("input")) return;

            const uniqueId = file.fileName || metadata.name || "Volume";
            const volName = niceName || metadata.name || file.fileName.split('/').pop().replace('.json', '');

            if (isMultiSelectVolumes) {
              if (multiSelectedVolumesMap.has(uniqueId)) {
                multiSelectedVolumesMap.delete(uniqueId);
                item.classList.remove("selected-item");
                if (activeFocusedFeatureId === uniqueId) {
                  activeFocusedFeatureId = multiSelectedVolumesMap.keys().next().value || null;
                }
              } else {
                multiSelectedVolumesMap.set(uniqueId, { file, metadata, data: metadata, name: volName });
                item.classList.add("selected-item");
                activeFocusedFeatureId = uniqueId;
                showUnifiedInfoPanel("VOLUME", `VOLUME: ${volName}`, metadata, true);
              }
              if (typeof updateMultiOverlaySvg === "function") updateMultiOverlaySvg();
            } else {
              multiSelectedVolumesMap.clear();
              document.querySelectorAll("#volumesList .saved-report-item").forEach(el => el.classList.remove("selected-item"));
              item.classList.add("selected-item");
              activeFocusedFeatureId = uniqueId;
              multiSelectedVolumesMap.set(uniqueId, { file, metadata, data: metadata, name: volName });
              loadVolumeAction();
              if (typeof updateMultiOverlaySvg === "function") updateMultiOverlaySvg();
            }
          });
          
          fContent.appendChild(item);
        });
        }
        
        folderGroup.appendChild(fHeader);
        folderGroup.appendChild(fContent);
        targetContainer.appendChild(folderGroup);
      };

      let hasVolumes = false;
      Object.keys(volumeFolders).sort().forEach(folderName => {
        if (volumesList) renderFolder(folderName, volumeFolders[folderName], volumesList);
        if (featuresListPolygons) renderFolder(folderName, volumeFolders[folderName], featuresListPolygons);
        hasVolumes = true;
      });
      if (!hasVolumes) {
        if (volumesList) volumesList.innerHTML = '<i style="color: var(--muted); padding: 4px;">No saved volumes yet.</i>';
        if (featuresListPolygons) featuresListPolygons.innerHTML = '<i style="color: var(--muted); padding: 4px;">No volumes drawn yet.</i>';
      }

      // Restore UI state if re-fetched during manage mode
      if (typeof toggleVolumeManageMode === 'function') toggleVolumeManageMode(window.isVolumeManageMode || false);

    } catch (err) {
      console.error(err);
      if (volumesList) volumesList.innerHTML = '<i style="color: #ef4444; padding: 4px;">Error loading volumes.</i>';
      if (featuresListPolygons) featuresListPolygons.innerHTML = '<i style="color: #ef4444; padding: 4px;">Error loading volumes.</i>';
    }
  }

  // Left Panel Features Accordions
  const toggleAccordion = (headerId, listId, carrotId) => {
    const header = document.getElementById(headerId);
    const list = document.getElementById(listId);
    const carrot = document.getElementById(carrotId);
    if (!header || !list || !carrot) return;
    
    header.addEventListener("click", (e) => {
      if (e.target.closest("button") || e.target.closest("input")) return;
      const isHidden = list.style.display === "none";
      list.style.display = isHidden ? "flex" : "none";
      carrot.style.transform = isHidden ? "rotate(0deg)" : "rotate(-90deg)";
      carrot.style.transition = "transform 0.2s";

      if (isHidden) {
        // When expanding an accordion, isolate view
        if (headerId === "featuresLinesHeader") {
          clearVolumeState();
          if (volumeSvg) volumeSvg.style.display = "none";
          multiSelectedVolumesMap.clear();
          updateMultiOverlaySvg();
        } else if (headerId === "featuresPolygonsHeader") {
          clearMeasure();
          if (measureSvg) measureSvg.style.display = "none";
          multiSelectedReportsMap.clear();
          updateMultiOverlaySvg();
        }
      }
    });
  };

  toggleAccordion("featuresPointsHeader", "featuresListPoints", "featuresPointsCarrot");
  toggleAccordion("featuresRoisHeader", "featuresListRois", "featuresRoisCarrot");
  toggleAccordion("featuresLinesHeader", "featuresListLines", "featuresLinesCarrot");
  toggleAccordion("featuresPolygonsHeader", "featuresListPolygons", "featuresPolygonsCarrot");

  // -------------------------------------------------------------------------
  // Streamlined Volumes Edit Mode Logic
  // -------------------------------------------------------------------------
  let isVolumesEditMode = false;

  function toggleVolumesEditMode(enable = !isVolumesEditMode) {
    isVolumesEditMode = enable;
    const btnManageVolumesFolder = document.getElementById("btnManageVolumesFolder");
    const manageVolumesBtn = document.getElementById("manageVolumesBtn");
    [btnManageVolumesFolder, manageVolumesBtn].forEach(b => b?.classList.toggle("active", isVolumesEditMode));

    document.querySelectorAll(".btn-row-delete-vol").forEach(el => {
      el.style.display = isVolumesEditMode ? "inline-flex" : "none";
    });
    document.querySelectorAll("#panel-volume .btn-delete-folder-trigger, #featuresListPolygons .btn-delete-folder-trigger").forEach(b => {
      b.style.display = isVolumesEditMode ? "inline-flex" : "none";
    });
  }

  document.getElementById("manageVolumesBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleVolumesEditMode();
  });
  document.getElementById("btnManageVolumesFolder")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleVolumesEditMode();
  });

  document.getElementById("btnNewVolumesFolder")?.addEventListener("click", (e) => {
    e.stopPropagation();
    promptNewFolder("VOLUME");
  });

  // -------------------------------------------------------------------------
  // Unified Info Panel Inline Rename Logic
  // -------------------------------------------------------------------------
  const btnInfoRenameTitle = document.getElementById("btnInfoRenameTitle");
  const infoInlineRenameContainer = document.getElementById("infoInlineRenameContainer");
  const infoInlineRenameInput = document.getElementById("infoInlineRenameInput");
  const btnInfoRenameSave = document.getElementById("btnInfoRenameSave");
  const btnInfoRenameCancel = document.getElementById("btnInfoRenameCancel");

  function updateInfoPanelRenameTrigger(featureName) {
    if (btnInfoRenameTitle) {
      btnInfoRenameTitle.classList.remove("hidden");
    }
    if (infoInlineRenameContainer) {
      infoInlineRenameContainer.classList.add("hidden");
    }
    if (infoInlineRenameInput) {
      infoInlineRenameInput.value = featureName || "";
    }
  }

  btnInfoRenameTitle?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!window.currentViewingFeature) return;
    if (infoInlineRenameContainer) {
      infoInlineRenameContainer.classList.remove("hidden");
      if (infoInlineRenameInput) {
        infoInlineRenameInput.value = window.currentViewingFeature.name || "";
        infoInlineRenameInput.focus();
        infoInlineRenameInput.select();
      }
    }
  });

  btnInfoRenameCancel?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (infoInlineRenameContainer) infoInlineRenameContainer.classList.add("hidden");
  });

  async function handleInfoPanelRename() {
    if (!window.currentViewingFeature || !infoInlineRenameInput) return;
    const newName = infoInlineRenameInput.value.trim();
    if (!newName) {
      alert("Please enter a valid name.");
      return;
    }
    const { type, name: oldName, pdfFile, jsonFile, file, metadata } = window.currentViewingFeature;
    if (newName === oldName) {
      if (infoInlineRenameContainer) infoInlineRenameContainer.classList.add("hidden");
      return;
    }

    if (btnInfoRenameSave) {
      btnInfoRenameSave.disabled = true;
    }

    try {
      if (type === "PROFILE") {
        const jsonFileName = jsonFile?.fileName || (pdfFile ? pdfFile.fileName.replace(/\.pdf$/, '.json') : null);
        let meta = metadata || {};
        try {
          const API_BASE = `https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url`;
          const jsonUrl = `${API_BASE}?projectId=${encodeURIComponent(activeProject.folderName)}&surveyId=${encodeURIComponent(activeProject.surveyId)}&type=reports&fileName=${encodeURIComponent(jsonFileName)}`;
          const gRes = await fetch(jsonUrl, { cache: 'no-store' });
          if (gRes.ok) {
            const files = await gRes.json();
            if (Array.isArray(files) && files.length > 0) {
              const mRes = await fetch(files[0].url, { cache: 'no-store' });
              if (mRes.ok) meta = await mRes.json();
            }
          }
        } catch(e){}

        meta.name = newName;
        meta.title = newName;

        const uploadApiUrl = `https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url`;
        const res = await fetch(uploadApiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: activeProject.folderName, surveyId: activeProject.surveyId, type: "reports", fileName: jsonFileName })
        });
        if (!res.ok) throw new Error("Failed to get upload URL");
        const { uploadUrl } = await res.json();
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(meta, null, 2)
        });
        if (!putRes.ok) throw new Error("Failed to upload updated JSON");

        window.currentViewingFeature.name = newName;
        window.currentViewingFeature.metadata = meta;
        if (unifiedInfoTitle) unifiedInfoTitle.textContent = `SAVED PATH PROFILE - ${newName.toUpperCase()}`;
        fetchSavedReports();
      } else if (type === "VOLUME") {
        const fileName = file.fileName;
        let meta = metadata || {};
        try {
          const API_BASE = `https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url`;
          const jsonUrl = `${API_BASE}?projectId=${encodeURIComponent(activeProject.folderName)}&surveyId=${encodeURIComponent(activeProject.surveyId)}&type=volumes&fileName=${encodeURIComponent(fileName)}`;
          const gRes = await fetch(jsonUrl, { cache: 'no-store' });
          if (gRes.ok) {
            const files = await gRes.json();
            if (Array.isArray(files) && files.length > 0) {
              const mRes = await fetch(files[0].url, { cache: 'no-store' });
              if (mRes.ok) meta = await mRes.json();
            }
          }
        } catch(e){}

        meta.name = newName;
        meta.title = newName;

        const uploadApiUrl = `https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url`;
        const res = await fetch(uploadApiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: activeProject.folderName, surveyId: activeProject.surveyId, type: "volumes", fileName })
        });
        if (!res.ok) throw new Error("Failed to get upload URL");
        const { uploadUrl } = await res.json();
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(meta, null, 2)
        });
        if (!putRes.ok) throw new Error("Failed to upload updated JSON");

        window.currentViewingFeature.name = newName;
        window.currentViewingFeature.metadata = meta;
        if (unifiedInfoTitle) unifiedInfoTitle.textContent = `SAVED VOLUME - ${newName.toUpperCase()}`;
        fetchSavedVolumes();
      }

      if (infoInlineRenameContainer) infoInlineRenameContainer.classList.add("hidden");
    } catch(err) {
      console.error("Rename error:", err);
      alert("Failed to rename: " + err.message);
    } finally {
      if (btnInfoRenameSave) btnInfoRenameSave.disabled = false;
    }
  }

  btnInfoRenameSave?.addEventListener("click", (e) => {
    e.stopPropagation();
    handleInfoPanelRename();
  });

  infoInlineRenameInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleInfoPanelRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (infoInlineRenameContainer) infoInlineRenameContainer.classList.add("hidden");
    }
  });

  // Stop 3D Map from swallowing key events on inputs
  ['volSaveName', 'roiSaveName', 'volSaveFolder', 'reportNameInput', 'infoInlineRenameInput'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('keydown', e => e.stopPropagation());
      el.addEventListener('keyup', e => e.stopPropagation());
      el.addEventListener('keypress', e => e.stopPropagation());
    }
  });

  // (Removed conflicting iOS style manage toggle)
  

  // -------------------------------------------------------------------------
  // ELEVATIONS OVERLAY LOGIC
  // -------------------------------------------------------------------------
  let isElevationsEnabled = false;
  let elevationGridSpacing = 50;
  let elevationGridPoints = [];
  
  const btnEnableElevations = document.getElementById("btnEnableElevations");
  const btnDisableElevations = document.getElementById("btnDisableElevations");
  const elevationsSpacingInput = document.getElementById("elevationsSpacing");
  const elevationsSpacingVal = document.getElementById("elevationsSpacingVal");
  const elevationsCanvas = document.getElementById("elevationsSvg"); // Note: variable named elevationsCanvas for simplicity, but it's an SVG now

  function renderElevations() {
    if (!elevationsCanvas) return;
    elevationsCanvas.innerHTML = "";
    
    if (!isElevationsEnabled || !map) return;

    const step = Math.max(60, elevationGridSpacing * 1.5);
    let svgContent = "";

    for (let screenX = step / 2; screenX < window.innerWidth; screenX += step) {
      for (let screenY = step / 2; screenY < window.innerHeight; screenY += step) {
        const mouse = new Vector2(screenX, screenY);
        const picked = map.pick(mouse, { gpuPicking: true });
        
        if (picked && picked.length > 0 && picked[0].coord) {
          const coord = picked[0].coord;
          
          // Check 1: Must be inside elevation layer extent
          if (elevationLayer && elevationLayer.extent && elevationLayer.extent.isPointInside(coord)) {
            // Check 2: Must be a valid elevation value (not no-data padding outside the angled boundary)
            const sample = map.getElevationFast(coord.x, coord.y);
            if (sample && typeof sample.elevation === "number" && !isNaN(sample.elevation)) {
              const text = Math.round(sample.elevation) + " m";
              svgContent += `<text x="${screenX.toFixed(1)}" y="${screenY.toFixed(1)}" fill="#111111" stroke="rgba(255,255,255,0.95)" stroke-width="3" paint-order="stroke" text-anchor="middle" dominant-baseline="middle" font-family="'Inter', 'Roboto', sans-serif" font-weight="700" font-size="13px">${text}</text>`;
            }
          }
        }
      }
    }
    elevationsCanvas.innerHTML = svgContent;
  }

  controls.addEventListener('change', () => {
    if (isElevationsEnabled) renderElevations();
  });

  btnEnableElevations?.addEventListener('click', () => {
    isElevationsEnabled = true;
    btnEnableElevations.disabled = true;
    btnDisableElevations.disabled = false;
    renderElevations();
  });
  
  btnDisableElevations?.addEventListener('click', () => {
    isElevationsEnabled = false;
    btnEnableElevations.disabled = false;
    btnDisableElevations.disabled = true;
    renderElevations(); 
  });
  
  elevationsSpacingInput?.addEventListener('input', (e) => {
    elevationsSpacingVal.textContent = e.target.value + "m";
  });
  
  elevationsSpacingInput?.addEventListener('change', (e) => {
    elevationGridSpacing = parseInt(e.target.value);
    if (isElevationsEnabled) generateElevationGrid();
  });

  toggleAccordion("elevationsHeader", "elevationsSettings", "elevationsCarrot");

  // -------------------------------------------------------------------------
  // ORTHOPHOTO TOGGLE LOGIC
  // -------------------------------------------------------------------------
  const btnToggleOrtho = document.getElementById("btnToggleOrtho");
  btnToggleOrtho?.addEventListener('click', () => {
    if (orthoLayer) {
      if (btnToggleOrtho.classList.contains("active")) {
        btnToggleOrtho.classList.remove("active");
        orthoLayer.opacity = 0;
        orthoLayer.visible = false;
      } else {
        btnToggleOrtho.classList.add("active");
        orthoLayer.opacity = 1;
        orthoLayer.visible = true;
      }
      instance.notifyChange();
    }
  });


  const btnResetMap = document.getElementById("btnResetMap");
  btnResetMap?.addEventListener("click", () => {
    // 1. Clear UI states
    if (typeof resetRoiState === "function") resetRoiState();
    
    // 2. Clear ROIs
    if (typeof roiSvg !== "undefined" && roiSvg) roiSvg.style.display = "none";
    if (typeof roiPolyPoints !== "undefined") roiPolyPoints = [];
    if (typeof updateRoiPolySvg === 'function') updateRoiPolySvg();
    
    // 3. Clear KML boundary
    if (typeof kmlWorldPoints !== "undefined") kmlWorldPoints = [];
    if (typeof updateKmlSvg === "function") updateKmlSvg();

    // 4. Clear Measurements
    if (typeof clearMeasure === "function") clearMeasure();

    // 5. Reload full unclipped project (this resets the camera to top-down default)
    if (typeof loadProject === "function" && typeof activeProject !== "undefined" && activeProject) {
      loadProject(activeProject, null);
    }
  });


  // -------------------------------------------------------------------------
  // RIGHT TOOLBAR OVERLAY TOGGLES (Grid, Heatmap, Contours)
  // -------------------------------------------------------------------------
  const btnRightGrid = document.getElementById("btnRightGrid");
  const btnRightHeatmap = document.getElementById("btnRightHeatmap");
  const btnRightContour = document.getElementById("btnRightContour");

  // Track overlay active states
  let isGridOverlayActive = false;
  let isHeatmapOverlayActive = false;
  let isContourOverlayActive = false;

  // --- Grid Toggle ---
  btnRightGrid?.addEventListener("click", () => {
    if (isGridOverlayActive) {
      // Turn OFF
      isGridOverlayActive = false;
      btnRightGrid.classList.remove("overlay-active");
      const btnDisableElevations = document.getElementById("btnDisableElevations");
      if (btnDisableElevations && !btnDisableElevations.disabled) btnDisableElevations.click();
      if (unifiedInfoPanel) unifiedInfoPanel.classList.add("hidden");
      if (topSaveBar) topSaveBar.classList.add("hidden");
    } else {
      // Show panel without turning ON
      showUnifiedInfoPanel("GRID", "ELEVATIONS GRID", null, false);
      // Sync info panel slider with the original slider
      const origSpacing = document.getElementById("elevationsSpacing");
      const infoSpacing = document.getElementById("infoElevationsSpacing");
      const infoSpacingVal = document.getElementById("infoElevationsSpacingVal");
      if (origSpacing && infoSpacing) {
        infoSpacing.value = origSpacing.value;
        if (infoSpacingVal) infoSpacingVal.textContent = origSpacing.value + "m";
      }
    }
  });

  // Sync info panel grid slider -> original slider
  document.getElementById("infoElevationsSpacing")?.addEventListener("input", (e) => {
    const origSpacing = document.getElementById("elevationsSpacing");
    const infoSpacingVal = document.getElementById("infoElevationsSpacingVal");
    if (origSpacing) {
      origSpacing.value = e.target.value;
      origSpacing.dispatchEvent(new Event("input"));
    }
    if (infoSpacingVal) infoSpacingVal.textContent = e.target.value + "m";
  });

  // Sync original disable button -> clear active state
  document.getElementById("btnDisableElevations")?.addEventListener("click", () => {
    isGridOverlayActive = false;
    if (btnRightGrid) btnRightGrid.classList.remove("overlay-active");
  });
  document.getElementById("btnEnableElevations")?.addEventListener("click", () => {
    isGridOverlayActive = true;
    if (btnRightGrid) btnRightGrid.classList.add("overlay-active");
  });

  // --- Heatmap Toggle ---
  btnRightHeatmap?.addEventListener("click", () => {
    if (isHeatmapOverlayActive) {
      // Turn OFF
      isHeatmapOverlayActive = false;
      btnRightHeatmap.classList.remove("overlay-active");
      const btnDisableHeatmap = document.getElementById("btnDisableHeatmap");
      if (btnDisableHeatmap && !btnDisableHeatmap.disabled) btnDisableHeatmap.click();
      if (unifiedInfoPanel) unifiedInfoPanel.classList.add("hidden");
      if (topSaveBar) topSaveBar.classList.add("hidden");
    } else {
      // Show panel without turning ON
      showUnifiedInfoPanel("HEATMAP", "SLOPE HEATMAP", null, false);
      // Sync export card visibility
      document.getElementById("infoHeatmapExportCard")?.classList.toggle("hidden", !isHeatmapOverlayActive);
      // Sync opacity
      const origOpacity = document.getElementById("heatmapOpacity");
      const infoOpacity = document.getElementById("infoHeatmapOpacity");
      const infoOpacityVal = document.getElementById("infoHeatmapOpacityVal");
      if (origOpacity && infoOpacity) {
        infoOpacity.value = origOpacity.value;
        if (infoOpacityVal) infoOpacityVal.textContent = Math.round(parseFloat(origOpacity.value) * 100) + "%";
      }
    }
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

  // Sync info panel heatmap mode radios -> original radios
  document.querySelectorAll('input[name="infoHeatmapMode"]').forEach(radio => {
    radio.addEventListener("change", (e) => {
      const mode = e.target.value;
      // Click the corresponding original radio
      const origRadio = document.querySelector(`input[name="heatmapMode"][value="${mode}"]`);
      if (origRadio) {
        origRadio.checked = true;
        origRadio.dispatchEvent(new Event("change"));
      }
      // Toggle info panel legends
      const infoPredefined = document.getElementById("infoPredefinedHeatmapUI");
      const infoHaulroad = document.getElementById("infoHaulroadHeatmapUI");
      const infoCustom = document.getElementById("infoCustomHeatmapUI");
      if (infoPredefined) infoPredefined.classList.toggle("hidden", mode !== "predefined");
      if (infoHaulroad) infoHaulroad.classList.toggle("hidden", mode !== "haulroad");
      if (infoCustom) infoCustom.classList.toggle("hidden", mode !== "custom");
    });
  });

  // Sync original disable/enable heatmap buttons -> clear/set active state  
  document.getElementById("btnDisableHeatmap")?.addEventListener("click", () => {
    isHeatmapOverlayActive = false;
    if (btnRightHeatmap) btnRightHeatmap.classList.remove("overlay-active");
    document.getElementById("infoHeatmapExportCard")?.classList.add("hidden");
  });
  document.getElementById("btnEnableHeatmap")?.addEventListener("click", () => {
    isHeatmapOverlayActive = true;
    if (btnRightHeatmap) btnRightHeatmap.classList.add("overlay-active");
    document.getElementById("infoHeatmapExportCard")?.classList.remove("hidden");
  });

  // --- Contour Toggle ---
  btnRightContour?.addEventListener("click", () => {
    if (isContourOverlayActive) {
      // Turn OFF
      isContourOverlayActive = false;
      btnRightContour.classList.remove("overlay-active");
      const btnDisableContours = document.getElementById("btnDisableContours");
      if (btnDisableContours && !btnDisableContours.disabled) btnDisableContours.click();
      if (unifiedInfoPanel) unifiedInfoPanel.classList.add("hidden");
      if (topSaveBar) topSaveBar.classList.add("hidden");
    } else {
      // Show panel without turning ON
      showUnifiedInfoPanel("CONTOUR", "TOPOGRAPHIC CONTOURS", null, false);
      // Sync export card visibility
      document.getElementById("infoContourExportCard")?.classList.toggle("hidden", !isContourOverlayActive);
      // Sync all contour values
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

  // Sync original disable/enable contour buttons -> clear/set active state
  document.getElementById("btnDisableContours")?.addEventListener("click", () => {
    isContourOverlayActive = false;
    if (btnRightContour) btnRightContour.classList.remove("overlay-active");
    document.getElementById("infoContourExportCard")?.classList.add("hidden");
  });
  document.getElementById("btnEnableContours")?.addEventListener("click", () => {
    isContourOverlayActive = true;
    if (btnRightContour) btnRightContour.classList.add("overlay-active");
    document.getElementById("infoContourExportCard")?.classList.remove("hidden");
  });


  // -------------------------------------------------------------------------
  // GLOBAL KEYBOARD SHORTCUTS & NAVIGATION (ESC Clear + Arrow Key Camera Controls)
  // -------------------------------------------------------------------------
  window.addEventListener("keydown", (e) => {
    // Ignore keypresses when user is actively typing in form inputs
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.tagName === "SELECT")) {
      return;
    }

    // --- Hold CTRL to pan/rotate map mid-drawing ---
    if ((e.key === "Control" || e.ctrlKey) && !isCtrlPanActive) {
      if (measureState === "SELECTING" || roiState === "SELECTING") {
        isCtrlPanActive = true;
        if (controls) controls.enabled = true;
        document.body.classList.remove("roi-selecting");
        setLiveGuidance("🗺️", "CTRL Held: Drag mouse to pan/rotate map • Release CTRL to resume drawing");
      }
    }

    // --- 1. Global ESC Key Reset Handler ---
    if (e.key === "Escape") {
      e.preventDefault();
      
      // Reset active drawing & tool mode
      measureState = "IDLE";
      measureMode = "NONE";
      if (controls) controls.enabled = true;
      document.body.classList.remove("roi-selecting");

      // Reset button states
      [btnMeasureSimple, btnProfile, btnDrawVolume, btnDrawPolyRoi].forEach(b => b?.classList.remove("active"));
      if (btnClearMeasureSimple) btnClearMeasureSimple.disabled = true;
      if (btnClearProfile) btnClearProfile.disabled = true;
      if (btnClearVolume) btnClearVolume.disabled = true;
      if (btnFinishVolume) btnFinishVolume.classList.add("hidden");

      // Clear drawn graphics & SVGs
      clearMeasure();
      volumePoints = [];
      volumeMousePoint = null;
      updateVolumeSvg();
      roiPolyPoints = [];
      roiPolyMousePoint = null;
      updateRoiPolySvg();
      
      pointDrawPoint = null;
      pointDrawCoord = null;
      if (pointSvg) pointSvg.style.display = "none";
      if (map) map.clippingPlanes = [];

      // Clear saved & multi-selected items on map and deselect UI items
      if (typeof setActiveSavedItem === 'function') setActiveSavedItem(null);
      document.querySelectorAll("#reportsList .saved-report-item, #volumesList .saved-report-item, .saved-report-item").forEach(el => el.classList.remove("selected-item"));
      
      multiSelectedReportsMap.clear();
      multiSelectedVolumesMap.clear();
      isMultiSelectReports = false;
      isMultiSelectVolumes = false;
      const toggleReportsEl = document.getElementById("toggleViewAllReports");
      const toggleVolumesEl = document.getElementById("toggleViewAllVolumes");
      if (toggleReportsEl) toggleReportsEl.checked = false;
      if (toggleVolumesEl) toggleVolumesEl.checked = false;
      activeFocusedFeatureId = null;
      if (typeof updateMultiOverlaySvg === 'function') updateMultiOverlaySvg();

      // Hide active tool panels, modals & guidance
      if (unifiedInfoPanel) unifiedInfoPanel.classList.add("hidden");
      closeUniversalSaveModal();
      const quickGuideModal = document.getElementById("quickGuideModal");
      if (quickGuideModal) quickGuideModal.classList.add("hidden");
      if (elevationModal) elevationModal.classList.add("hidden");
      const volumeSaveModal = document.getElementById("volumeSaveModal");
      if (volumeSaveModal) volumeSaveModal.classList.add("hidden");
      const roiHorizontalBar = document.getElementById("roiHorizontalBar");
      if (roiHorizontalBar) roiHorizontalBar.classList.remove("open");

      setLiveGuidance(null, null);
      return;
    }

    // --- 2. Arrow Key 3D Camera Controls (Continuous Smooth Inertia Sliding) ---
    if (e.key in arrowKeysPressed) {
      e.preventDefault();
      arrowKeysPressed[e.key] = true;
      startSmoothCamLoop();
    }
  });

  const arrowKeysPressed = {
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false
  };

  let camVelocityX = 0;
  let camVelocityY = 0;
  let animFrameId = null;

  window.addEventListener("keyup", (e) => {
    if (e.key in arrowKeysPressed) {
      arrowKeysPressed[e.key] = false;
    }
    if (e.key === "Control" || !e.ctrlKey) {
      if (isCtrlPanActive) {
        isCtrlPanActive = false;
        if (measureState === "SELECTING" || roiState === "SELECTING") {
          if (controls) controls.enabled = false;
          document.body.classList.add("roi-selecting");
          
          if (measureMode === "VOLUME") {
            setLiveGuidance("📦", `Volume Drawing: ${volumePoints.length} Points Placed — Click map for next point, or Finish`);
          } else if (measureMode === "PROFILE") {
            setLiveGuidance("📏", "Click on the map to place start point, then drag or tap end point.");
          } else if (measureMode === "ROI_POLY") {
            setLiveGuidance("✂️", `Polygon ROI: ${roiPolyPoints.length} Points Placed — Double-click to finish clipping`);
          } else if (roiState === "SELECTING") {
            setLiveGuidance("📐", "Click and drag over the map to draw a rectangular clipping box.");
          } else if (measureMode === "SIMPLE") {
            setLiveGuidance("📐", "Click start point on map, then drag or click end point to measure.");
          }
        }
      }
    }
  });

  function startSmoothCamLoop() {
    if (animFrameId) return; // Loop already running

    function updateCamVelocity() {
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
        // Max frame velocity scaled smoothly to current zoom altitude (ultra-gentle & micro-smooth)
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

      // Ultra-smooth acceleration (0.05) & soft glide deceleration (0.05)
      const lerpFactor = isAnyKeyPressed ? 0.05 : 0.05;
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

  // =========================================================================
  /*
  // QUICK USER GUIDE & CHEATSHEET MODAL (One-by-One Step Carousel)
  // (Commented out for now)
  // -------------------------------------------------------------------------
  const quickGuideModal = document.getElementById("quickGuideModal");
  const btnSidebarQuickGuide = document.getElementById("btnSidebarQuickGuide");
  const btnFlyoutQuickGuide = document.getElementById("btnFlyoutQuickGuide");
  const btnCloseQuickGuide = document.getElementById("btnCloseQuickGuide");
  const btnPrevGuideSlide = document.getElementById("btnPrevGuideSlide");
  const btnNextGuideSlide = document.getElementById("btnNextGuideSlide");
  const guideTabBtns = document.querySelectorAll(".guide-tab-btn");
  const guideDots = document.querySelectorAll(".guide-dot");

  let currentGuideSlideIdx = 0;
  const TOTAL_GUIDE_SLIDES = 5;

  function showGuideSlide(idx) {
    currentGuideSlideIdx = (idx + TOTAL_GUIDE_SLIDES) % TOTAL_GUIDE_SLIDES;

    // Toggle slide visibility
    for (let i = 0; i < TOTAL_GUIDE_SLIDES; i++) {
      const slide = document.getElementById(`guideSlide${i}`);
      if (slide) slide.classList.toggle("hidden", i !== currentGuideSlideIdx);
    }

    // Toggle tab active state
    guideTabBtns.forEach(btn => {
      const bIdx = parseInt(btn.getAttribute("data-idx"), 10);
      btn.classList.toggle("active", bIdx === currentGuideSlideIdx);
    });

    // Toggle dot active state
    guideDots.forEach(dot => {
      const dIdx = parseInt(dot.getAttribute("data-idx"), 10);
      dot.classList.toggle("active", dIdx === currentGuideSlideIdx);
    });

    // Update Next button text on last slide
    if (btnNextGuideSlide) {
      btnNextGuideSlide.textContent = (currentGuideSlideIdx === TOTAL_GUIDE_SLIDES - 1) ? "Got it! ✓" : "Next ▶";
    }
  }

  function openQuickGuide() {
    if (quickGuideModal) {
      quickGuideModal.classList.remove("hidden");
      showGuideSlide(0);
    }
  }

  function closeQuickGuide() {
    if (quickGuideModal) quickGuideModal.classList.add("hidden");
  }

  btnSidebarQuickGuide?.addEventListener("click", (e) => {
    e.stopPropagation();
    openQuickGuide();
  });

  btnFlyoutQuickGuide?.addEventListener("click", (e) => {
    e.stopPropagation();
    openQuickGuide();
  });

  btnCloseQuickGuide?.addEventListener("click", closeQuickGuide);

  btnPrevGuideSlide?.addEventListener("click", () => {
    showGuideSlide(currentGuideSlideIdx - 1);
  });

  btnNextGuideSlide?.addEventListener("click", () => {
    if (currentGuideSlideIdx === TOTAL_GUIDE_SLIDES - 1) {
      closeQuickGuide();
    } else {
      showGuideSlide(currentGuideSlideIdx + 1);
    }
  });

  guideTabBtns.forEach(btn => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt(e.currentTarget.getAttribute("data-idx"), 10);
      if (!isNaN(idx)) showGuideSlide(idx);
    });
  });

  guideDots.forEach(dot => {
    dot.addEventListener("click", (e) => {
      const idx = parseInt(e.currentTarget.getAttribute("data-idx"), 10);
      if (!isNaN(idx)) showGuideSlide(idx);
    });
  });

  // Close when clicking outside the modal content card
  quickGuideModal?.addEventListener("click", (e) => {
    if (e.target === quickGuideModal) {
      closeQuickGuide();
    }
  });
  */

});
