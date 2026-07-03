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
import HttpConfiguration from "@giro3d/giro3d/utils/HttpConfiguration.js";

// Fix for Chromium's ERR_CACHE_OPERATION_NOT_SUPPORTED on GeoTIFF range requests
HttpConfiguration.setOptions(window.location.origin, { cache: "no-store" });

const giroCrs = new CoordinateSystem("EPSG:3395");

import { Vector3, Vector2, Color, DoubleSide } from "three";
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
  backgroundColor: 0x0a3b59,
});
instance.renderer.localClippingEnabled = true;

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
    map.backgroundColor = 0xcccccc;
    instance.add(map);

    // Sources are cached on the project object so switching / reloading is cheap.
    if (!project.elevationSource) {
      project.elevationSource = new GeoTIFFSource({
        url: new URL(project.elevationUrl, window.location.href).href,
        crs: giroCrs,
        retries: 5,
        httpTimeout: 30000,
      });
    }

    if (!project.orthoSource) {
      project.orthoSource = new GeoTIFFSource({
        url: new URL(project.orthoUrl, window.location.href).href,
        crs: giroCrs,
        retries: 5,
        httpTimeout: 30000,
      });
    }

    // Elevation (DSM/DTM).
    updateStatus("Loading Elevation Model…");

    // Create the slope color map BEFORE adding the layer.
    // Giro3D only registers colorMaps during addLayer(), so it must exist at construction.
    slopeColorMap = new ColorMap({
      colors: [
        new Color('green'),
        new Color('yellow'),
        new Color('orange'),
        new Color('red'),
        new Color('darkred')
      ],
      opacities: new Array(5).fill(0.35),
      min: 0,
      max: 90,
      mode: ColorMapMode.Slope
    });
    slopeColorMap.active = false; // Start hidden, user toggles it on

    elevationLayer = new ElevationLayer({
      name: "Elevation",
      extent,
      source: project.elevationSource,
      noDataOptions: { replaceNoData: true },
      minmax: { min: 0, max: 4000 }, // Prevents "no min/max could be computed" WebGL crash
      colorMap: slopeColorMap, // Registered with the Map's GPU shader atlas during addLayer
    });
    await map.addLayer(elevationLayer);
    console.log("Elevation loaded ✅");

    // Orthophoto (color imagery).
    updateStatus("Loading orthophoto…");
    orthoLayer = new ColorLayer({
      name: "Orthophoto",
      extent,
      source: project.orthoSource,
      opacity: 1,
      preloadImages: true,
    });
    await map.addLayer(orthoLayer);
    console.log("Orthophoto loaded ✅");

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

    // Frame the camera on the loaded extent.
    const center = extent.centerAsVector3();
    const dims = extent.dimensions();
    const size = Math.max(dims.x, dims.y);
    const zOffset = project.zOffset || 0;
    const camPos = new Vector3(
      center.x,
      center.y - size * 0.8,
      zOffset + size * 0.6
    );
    instance.view.camera.position.copy(camPos);
    controls.target.copy(new Vector3(center.x, center.y, zOffset));
    controls.update();

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
    elevationUrl: "./projects/Chattibhariatu/DSM_cloudoptimised.tif",
    orthoUrl: "./projects/Chattibhariatu/Ortho_CO.tif",
    extent: [
      9467845763606766e-9,
      9473006448724607e-9,
      2.7212684801465548e6,
      2.7244897791313147e6,
    ],
    zOffset: 429,
  },
  ahuja_project: {
    elevationUrl: "./projects/ahuja/Ahuja_DTM_COG.tif",
    orthoUrl: "./projects/ahuja/Ambuja_ortho.tif",
    extent: [
      8755723168817045e-9,
      8756317918817045e-9,
      1.9424123557069767e6,
      1.9432158557069767e6,
    ],
    zOffset: 550,
  },
};

// ---------------------------------------------------------------------------
// Camera controls
// ---------------------------------------------------------------------------
instance.view.camera.near = 0.1;
instance.view.camera.far = 1e6;

const controls = new MapControls(instance.view.camera, instance.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 50;
controls.maxDistance = 5e4;
controls.listenToKeyEvents(window);
instance.view.setControls(controls);

console.log("Giro3D initialized");

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  // Select project from ?project=... query string.
  const projectId =
    new URLSearchParams(window.location.search).get("project") ||
    "chattibhariatu_project";
  const activeProject = PROJECTS[projectId] || PROJECTS.chattibhariatu_project;
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
    const projectId = new URLSearchParams(window.location.search).get("project") || "chattibhariatu_project";
    const id = projectId;
    const project = PROJECTS[id] || PROJECTS.chattibhariatu_project;
    const extent = new Extent(giroCrs, ...project.extent);
    const center = extent.centerAsVector3();
    const dims = extent.dimensions();
    const size = Math.max(dims.x, dims.y);
    const zOffset = project.zOffset || 0;
    const camPos = new Vector3(
      center.x,
      center.y - size * 0.8,
      zOffset + size * 0.6
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
          if (coordLonLat) coordLonLat.textContent = `Lon: ${lon.toFixed(6)}°, Lat: ${lat.toFixed(6)}°`;
          if (coordElev) coordElev.textContent = `${Number(elev).toFixed(2)} m`;
        } catch(err) {
           console.error("Proj4 conversion error:", err);
        }
      }
    } else {
      if (coordLonLat) coordLonLat.textContent = "-";
      if (coordElev) coordElev.textContent = "-";
    }
  });
  canvas.addEventListener("mouseleave", () => {
    if (coordLonLat) coordLonLat.textContent = "-";
    if (coordElev) coordElev.textContent = "-";
  });

  // -------------------------------------------------------------------------
  // Contours
  // -------------------------------------------------------------------------
  const contourHeader = document.getElementById("contourHeader");
  const contourSettings = document.getElementById("contourSettings");
  const contourCarrot = document.getElementById("contourCarrot");
  const btnEnableContours = document.getElementById("btnEnableContours");
  const btnDisableContours = document.getElementById("btnDisableContours");
  const contourLoading = document.getElementById("contourLoading");
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
        let opacity = parseFloat(contourOpacity.value);
        if (opacity >= 1) opacity = 0.99;
        if (opacity <= 0) opacity = 0.01;
        map.contourLines = {
          enabled: true,
          secondaryInterval: parseFloat(contourInterval.value),
          interval: parseFloat(majorInterval.value),
          color: new Color(contourColor.value),
          thickness: parseFloat(contourWidth.value),
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
    regenerateContours();
  });
  btnDisableContours?.addEventListener("click", () => {
    contoursEnabled = false;
    btnEnableContours.disabled = false;
    btnDisableContours.disabled = true;
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
  // ROI (Region Of Interest) rectangle clipping
  // -------------------------------------------------------------------------
  const selectROI = document.getElementById("selectROI");
  const resetROI = document.getElementById("resetROI");
  const roiHint = document.getElementById("roiHint");
  const roiMetrics = document.getElementById("roiMetrics");
  const roiPerimeter = document.getElementById("roiPerimeter");
  const roiArea = document.getElementById("roiArea");

  let roiState = "IDLE"; // IDLE | SELECTING
  let roiDragging = false;
  let roiStart = null; // world coord (Vector3) of drag start
  let roiEnd = null; // world coord (Vector3) of drag end

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
    selectROI.classList.remove("active");
    selectROI.textContent = "Select ROI";
    roiHint.textContent = "Click 'Select ROI' to start drawing a rectangle.";
    if (roiMetrics) roiMetrics.classList.add("hidden");
    controls.enabled = true;
  }

  selectROI?.addEventListener("click", () => {
    resetRoiState();
    roiState = "SELECTING";
    controls.enabled = false;
    document.body.classList.add("roi-selecting");
    selectROI.classList.add("active");
    roiHint.textContent = "Click and drag on the terrain to draw a clipping rectangle.";
    resetROI.disabled = false;
  });

  resetROI?.addEventListener("click", () => {
    resetRoiState();
    roiSvg.style.display = "none";
    loadProject(activeProject, null); // reload full extent (un-clipped)
    resetROI.disabled = true;
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
      roiSvg.style.display = "none";
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

    roiSvg.style.display = "block";
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
    roiSvg.style.display = "none";
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
    const clipProject = PROJECTS.chattibhariatu_project;
    loadProject(clipProject, clipExtent);

    roiState = "IDLE";
    document.body.classList.remove("roi-selecting");
    selectROI.classList.remove("active");
    selectROI.textContent = "Select ROI";
    controls.enabled = true;
    resetROI.disabled = false;
    roiHint.textContent = "Terrain clipped! Click 'Reset' to restore the full view.";
  });

  // -------------------------------------------------------------------------
  // Measurement (distance / height)
  // -------------------------------------------------------------------------
  const measureHeader = document.getElementById("measureHeader");
  const measureCarrot = document.getElementById("measureCarrot");
  const measureSettings = document.getElementById("measureSettings");
  const btnMeasure = document.getElementById("btnMeasure");
  const btnClearMeasure = document.getElementById("btnClearMeasure");
  const measureResults = document.getElementById("measureResults");
  const measureHoriz = document.getElementById("measureHoriz");
  const measureVert = document.getElementById("measureVert");
  const measure3D = document.getElementById("measure3D");
  const measureHint = document.getElementById("measureHint");
  const measureSvg = document.getElementById("measureSvg");
  const measureSvgLine = document.getElementById("measureSvgLine");
  const measureSvgStart = document.getElementById("measureSvgStart");
  const measureSvgEnd = document.getElementById("measureSvgEnd");

  let measureState = "IDLE"; // IDLE | SELECTING | FINISHED
  let measureStartPoint = null; // world point (Vector3)
  let measureEndPoint = null; // world point (Vector3)
  let measureStartCoord = null; // geographic coord
  let measureEndCoord = null; // geographic coord

  measureHeader?.addEventListener("click", () => {
    const show = measureSettings.style.display === "none";
    measureSettings.style.display = show ? "block" : "none";
    measureCarrot.textContent = show ? "▲" : "▼";
  });

  // Clear the current measurement overlay + points.
  function clearMeasure() {
    if (measureSvg) measureSvg.style.display = "none";
    measureStartPoint = null;
    measureEndPoint = null;
    measureStartCoord = null;
    measureEndCoord = null;
  }

  // Project a world-space point to screen pixel coordinates.
  function projectToScreen(worldPoint) {
    const ndc = worldPoint.clone().project(instance.view.camera);
    const rect = canvas.getBoundingClientRect();
    const x = ((ndc.x + 1) / 2) * rect.width;
    const y = ((-ndc.y + 1) / 2) * rect.height;
    return { x, y, z: ndc.z };
  }

  // Redraw the measurement line so it "sticks" to the terrain as the camera moves.
  function updateMeasureSvg() {
    if (
      (measureState === "SELECTING" || measureState === "FINISHED") &&
      measureStartPoint &&
      measureEndPoint
    ) {
      const start = projectToScreen(measureStartPoint);
      const end = projectToScreen(measureEndPoint);
      // Hide if either endpoint is behind the camera.
      if (start.z > 1 || end.z > 1) {
        measureSvg.style.display = "none";
        return;
      }
      measureSvg.style.display = "block";
      measureSvgLine.setAttribute("x1", start.x);
      measureSvgLine.setAttribute("y1", start.y);
      measureSvgStart.setAttribute("cx", start.x);
      measureSvgStart.setAttribute("cy", start.y);
      measureSvgLine.setAttribute("x2", end.x);
      measureSvgLine.setAttribute("y2", end.y);
      measureSvgEnd.setAttribute("cx", end.x);
      measureSvgEnd.setAttribute("cy", end.y);
    } else if (measureSvg) {
      measureSvg.style.display = "none";
    }
  }
  controls.addEventListener("change", updateMeasureSvg);

  btnMeasure?.addEventListener("click", () => {
    measureState = "SELECTING";
    controls.enabled = false;
    document.body.classList.add("roi-selecting");
    btnMeasure.classList.add("active");
    btnMeasure.textContent = "Click to start";
    measureHint.textContent = "Click on the map to place the start point, then drag.";
    btnClearMeasure.disabled = false;
    measureResults.classList.remove("hidden");
    clearMeasure();
    measureHoriz.textContent = "0.00";
    measureVert.textContent = "0.00";
    measure3D.textContent = "0.00";
  });

  btnClearMeasure?.addEventListener("click", () => {
    measureState = "IDLE";
    controls.enabled = true;
    document.body.classList.remove("roi-selecting");
    btnMeasure.classList.remove("active");
    btnMeasure.textContent = "Measure Distance";
    measureHint.textContent = "Click 'Measure Distance' then click and drag on the map.";
    measureResults.classList.add("hidden");
    clearMeasure();
    btnClearMeasure.disabled = true;
  });

  canvas.addEventListener("mousedown", (e) => {
    if (measureState === "SELECTING") {
      const rect = canvas.getBoundingClientRect();
      const mouse = new Vector2(e.clientX - rect.left, e.clientY - rect.top);
      const picked = map.pick(mouse);
      if (picked && picked.length > 0) {
        measureStartPoint = picked[0].point.clone();
        measureStartCoord = picked[0].coord.clone();
        measureEndPoint = measureStartPoint.clone();
        measureEndCoord = measureStartCoord.clone();
        updateMeasureSvg();
        measureHint.textContent = "Drag to measure. Release to finish.";
      }
    }
  });

  canvas.addEventListener("mousemove", (e) => {
    if (measureState === "SELECTING" && measureStartPoint) {
      const rect = canvas.getBoundingClientRect();
      const mouse = new Vector2(e.clientX - rect.left, e.clientY - rect.top);
      const picked = map.pick(mouse);
      if (picked && picked.length > 0) {
        measureEndPoint = picked[0].point.clone();
        measureEndCoord = picked[0].coord.clone();
        updateMeasureSvg();

        const dx = measureEndCoord.x - measureStartCoord.x;
        const dy = measureEndCoord.y - measureStartCoord.y;
        const dz = measureEndCoord.z - measureStartCoord.z;
        const horizontal = Math.sqrt(dx * dx + dy * dy);
        const vertical = Math.abs(dz);
        const distance3D = Math.sqrt(dx * dx + dy * dy + dz * dz);

        measureHoriz.textContent = horizontal.toFixed(2);
        measureVert.textContent = vertical.toFixed(2);
        measure3D.textContent = distance3D.toFixed(2);
      }
    }
  });

  canvas.addEventListener("mouseup", () => {
    if (measureState === "SELECTING" && measureStartPoint) {
      measureState = "FINISHED";
      controls.enabled = true;
      document.body.classList.remove("roi-selecting");
      btnMeasure.classList.remove("active");
      btnMeasure.textContent = "Measure Distance";
      measureHint.textContent =
        "Measurement complete. Rotate the map to see the line stick! Click 'Clear' to remove.";
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
  const heatmapLoading = document.getElementById('heatmapLoading');

  btnEnableHeatmap?.addEventListener('click', () => {
    btnEnableHeatmap.disabled = true;
    heatmapLoading.classList.remove('hidden');

    setTimeout(() => {
      if (slopeColorMap) {
        slopeColorMap.active = true;
        if (orthoLayer) {
          orthoLayer.opacity = 0.4; // Fade the satellite image so the heatmap shines through
        }
        instance.notifyChange();
      }
      btnDisableHeatmap.disabled = false;
      heatmapLoading.classList.add('hidden');
      heatmapSettings.classList.remove('hidden');
    }, 600);
  });

  btnDisableHeatmap?.addEventListener('click', () => {
    if (slopeColorMap) {
      slopeColorMap.active = false;
      if (orthoLayer) {
        orthoLayer.opacity = 1.0; // Restore full satellite imagery
      }
      instance.notifyChange();
    }
    btnEnableHeatmap.disabled = false;
    btnDisableHeatmap.disabled = true;
    heatmapSettings.classList.add('hidden');
  });

  heatmapOpacity?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    heatmapOpacityVal.textContent = Math.round(val * 100) + '%';
    if (slopeColorMap) {
      slopeColorMap.opacity = new Array(5).fill(val);
      instance.notifyChange();
    }
  });

});
