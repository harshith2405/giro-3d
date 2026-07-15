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
    folderName: "Chattibhariatu",
    extent: [
      9467845763606766e-9,
      9473006448724607e-9,
      2.7212684801465548e6,
      2.7244897791313147e6,
    ],
    zOffset: 429,
      surveys: {
        may_2026: {
          elevationUrl: "./projects/Chattibhariatu/surveys/may_2026/DSM_cloudoptimised.tif",
          orthoUrl: "./projects/Chattibhariatu/surveys/may_2026/Ortho_CO.tif",
        },
        july_2026: {
          elevationUrl: "./projects/Chattibhariatu/surveys/july_2026/DSM_cloudoptimised.tif",
          orthoUrl: "./projects/Chattibhariatu/surveys/july_2026/Ortho_CO.tif",
        }
      }
  },
  ahuja_project: {
    folderName: "ahuja",
    extent: [
      8755723168817045e-9,
      8756317918817045e-9,
      1.9424123557069767e6,
      1.9432158557069767e6,
    ],
    zOffset: 550,
    surveys: {
      may_2026: {
        elevationUrl: "./projects/ahuja/surveys/may_2026/Ahuja_DTM_COG.tif",
        orthoUrl: "./projects/ahuja/surveys/may_2026/Ambuja_ortho.tif",
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
  // If the specific survey doesn't exist, default to may_2026 to prevent crashes
  const surveyInfo = projectInfo.surveys[surveyId] || projectInfo.surveys["may_2026"];
  
  return {
    ...projectInfo,
    elevationUrl: surveyInfo.elevationUrl,
    orthoUrl: surveyInfo.orthoUrl,
    id: projectId,
    folderName: projectInfo.folderName || projectId,
    surveyId: surveyId
  };
}

let activeProject = null;

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
controls.maxPolarAngle = Math.PI / 2.1;

const flyoutPanel = document.getElementById('flyoutPanel');
  const toggleFlyoutPanel = document.getElementById('toggleFlyoutPanel');
  const iconBtns = document.querySelectorAll('.icon-btn');
  const flyoutGroups = document.querySelectorAll('.flyout-group');
  const flyoutTitle = document.getElementById('flyoutTitle');

  // Helper to close flyout
  function closeFlyout() {
    flyoutPanel.classList.add('closed');
    iconBtns.forEach(b => b.classList.remove('active'));
  }

  // Open / Switch Flyout
  iconBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      
      // If clicking the currently active button, just close it
      if (btn.classList.contains('active')) {
        closeFlyout();
        return;
      }
      
      // Otherwise, open it and switch active state
      flyoutPanel.classList.remove('closed');
      
      // Update buttons
      iconBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update groups
      flyoutGroups.forEach(g => g.classList.remove('active', 'hidden'));
      flyoutGroups.forEach(g => {
        if (g.id === targetId) {
          g.classList.add('active');
          g.style.display = 'block';
        } else {
          g.classList.add('hidden');
          g.style.display = 'none';
        }
      });
      
      // Update Title
      flyoutTitle.textContent = btn.getAttribute('title');
    });
  });

  // Close button inside flyout
  toggleFlyoutPanel?.addEventListener('click', () => {
    closeFlyout();
  });


instance.view.setControls(controls);

console.log("Giro3D initialized");

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  // Select project and survey from query string
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
        const center = new Vector3((minX + maxX) / 2, ((minY + maxY) / 2) - 1000, (activeProject.zOffset || 0) + 1500);
        instance.view.camera.position.copy(center);
        controls.target.copy(new Vector3((minX + maxX) / 2, (minY + maxY) / 2, activeProject.zOffset || 0));
        controls.update();
        
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
    const clipProject = getActiveProjectConfig();
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
  const measureSvgLine = document.getElementById("measureSvgLine");
  const measureSvgStart = document.getElementById("measureSvgStart");
  const measureSvgEnd = document.getElementById("measureSvgEnd");

  let measureState = "IDLE"; // IDLE | SELECTING | FINISHED
  let measureMode = "NONE"; // NONE | SIMPLE | PROFILE | REDRAW | VOLUME
  let measureStartPoint = null; // world point (Vector3)
  let measureEndPoint = null; // world point (Vector3)
  let measureStartCoord = null; // geographic coord
  let measureEndCoord = null; // geographic coord
  let measureDragScreenStart = null;
  let measureHasFirstTap = false;

  // Volume state
  let volumePoints = []; // Array of { point: Vector3, coord: Coordinates }
  let volumeMousePoint = null; // Vector3
  const volumeSvg = document.getElementById("volumeSvg");
  const volumePolygonSvg = document.getElementById("volumePolygonOverlay");
  const volumeVerticesSvg = document.getElementById("volumeVerticesOverlay");

  // Clear the current measurement overlay + points.
  function clearMeasure() {
    if (measureSvg) measureSvg.style.display = "none";
    if (elevationMiniContainer) elevationMiniContainer.classList.add("hidden");
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

  // Redraw volume polygon
  function updateVolumeSvg() {
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
            circle.setAttribute("r", "3");
            circle.setAttribute("fill", "#0ea5e9");
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
      
      if (volumePolygonSvg) {
        volumePolygonSvg.style.display = "block";
        volumePolygonSvg.setAttribute("points", pointsAttr.trim());
      }
      if (volumeVerticesSvg) volumeVerticesSvg.style.display = "block";
      if (volumeSvg) volumeSvg.style.display = "block";
    } else {
      if (volumePolygonSvg) volumePolygonSvg.style.display = "none";
      if (volumeVerticesSvg) volumeVerticesSvg.style.display = "none";
      if (volumeSvg) volumeSvg.style.display = "none";
    }
  }
  controls.addEventListener("change", updateVolumeSvg);

  // --- Simple Measurement ---
  btnMeasureSimple?.addEventListener("click", () => {
    measureState = "SELECTING";
    measureMode = "SIMPLE";
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
    measureState = "SELECTING";
    measureMode = "PROFILE";
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
    measureState = "SELECTING";
    measureMode = "VOLUME";
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
  });

  canvas.addEventListener("mousedown", (e) => {
    if (measureState === "SELECTING") {
      
      const rect = canvas.getBoundingClientRect();
      const mouse = new Vector2(e.clientX - rect.left, e.clientY - rect.top);
      measureDragScreenStart = { x: e.clientX, y: e.clientY };
      const picked = map.pick(mouse);
      if (picked && picked.length > 0) {
        if (measureMode === "VOLUME") {
          volumePoints.push({
            point: picked[0].point.clone(),
            coord: picked[0].coord.clone()
          });
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
      ctx.fillStyle = options.color || '#0f172a'; // Dark background
      ctx.fillRect(0, 0, chart.width, chart.height);
      ctx.restore();
    }
  };

  function initCharts() {
    if (miniChart) return;
    const commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false, // critical for smooth live dragging
      plugins: { legend: { display: false } },
      scales: {
        x: { 
          title: { display: true, text: 'Distance (m)', color: '#1e293b' },
          ticks: { color: '#64748b' },
          grid: { color: '#e2e8f0' }
        },
        y: { 
          title: { display: true, text: 'Elevation (m)', color: '#1e293b' },
          ticks: { color: '#64748b' },
          grid: { color: '#e2e8f0' }
        }
      }
    };

    miniChart = new Chart(elevationMiniChartCtx, {
      type: 'line',
      data: { labels: [], datasets: [{ data: [], borderColor: '#5e19ea', backgroundColor: 'rgba(94, 25, 234, 0.15)', fill: true, tension: 0.1, pointRadius: 0, borderWidth: 3 }] },
      options: {
        ...commonOptions,
        scales: {
          x: { display: false },
          y: { ticks: { color: '#64748b', font: { size: 9 } }, grid: { color: '#e2e8f0' } }
        }
      }
    });

    fullChart = new Chart(elevationFullChartCtx, {
      type: 'line',
      data: { labels: [], datasets: [{ label: 'Elevation', data: [], borderColor: '#5e19ea', backgroundColor: 'rgba(94, 25, 234, 0.15)', fill: true, tension: 0.1, pointRadius: 2, pointHoverRadius: 5, borderWidth: 3 }] },
      options: commonOptions,
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
    
    if (volumeMiniContainer) {
      volumeMiniContainer.classList.remove("hidden");
    }
  }

  function updateElevationProfile() {
    if (!measureStartCoord || !measureEndCoord || !map) {
      if (elevationMiniContainer) elevationMiniContainer.classList.add("hidden");
      return;
    }
    
    const dx = measureEndCoord.x - measureStartCoord.x;
    const dy = measureEndCoord.y - measureStartCoord.y;
    const totalDist = Math.sqrt(dx * dx + dy * dy);
    if (totalDist < 1) {
      if (elevationMiniContainer) elevationMiniContainer.classList.add("hidden");
      return;
    }

    // Dynamic sampling: 1 sample every 2 meters, min 10, max 200
    let numSamples = Math.max(10, Math.min(200, Math.floor(totalDist / 2)));
    
    const distances = [];
    const elevations = [];
    currentProfileData = [];

    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      const x = measureStartCoord.x + t * dx;
      const y = measureStartCoord.y + t * dy;
      
      const sample = map.getElevationFast(x, y);
      let z = sample ? sample.elevation : 0;
      
      const currentDist = t * totalDist;
      distances.push(currentDist.toFixed(1));
      elevations.push(z);
      currentProfileData.push({ dist: currentDist, elev: z, x, y });
    }

    if (elevationMiniContainer) elevationMiniContainer.classList.remove("hidden");
    
    initCharts();
    miniChart.data.labels = distances;
    miniChart.data.datasets[0].data = elevations;
    miniChart.update();

    if (!elevationModal.classList.contains("hidden")) {
      fullChart.data.labels = distances;
      fullChart.data.datasets[0].data = elevations;
      fullChart.update();
    }
  }

  elevationMiniContainer?.addEventListener("click", () => {
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
  });

  function generateReportPDF(reportName) {
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
        startPoint: measureStartPoint ? { x: measureStartPoint.x, y: measureStartPoint.y, z: measureStartPoint.z } : null,
        endPoint: measureEndPoint ? { x: measureEndPoint.x, y: measureEndPoint.y, z: measureEndPoint.z } : null,
        startCoord: measureStartCoord ? { x: measureStartCoord.x, y: measureStartCoord.y, z: measureStartCoord.z } : null,
        endCoord: measureEndCoord ? { x: measureEndCoord.x, y: measureEndCoord.y, z: measureEndCoord.z } : null
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
          fileName: `${safeReportName}.pdf`
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
          fileName: `${safeReportName}.json`
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
        btnSaveToSurvey.style.background = "#0ea5e9";
        btnSaveToSurvey.disabled = false;
      }, 3000);

    } catch (err) {
      console.error("Error saving report:", err);
      btnSaveToSurvey.textContent = "Error Saving";
      btnSaveToSurvey.style.background = "#ef4444"; // red
      
      setTimeout(() => {
        btnSaveToSurvey.innerHTML = originalText;
        btnSaveToSurvey.style.background = "#0ea5e9";
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
    if (!reportsListLoading || !reportsList) return;
    
    reportsListLoading.style.display = 'block';
    reportsListLoading.textContent = "Loading reports...";
    reportsList.innerHTML = '';

    try {
      const apiUrl = `https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url?projectId=${activeProject.folderName}&surveyId=${activeProject.surveyId}`;
      const response = await fetch(apiUrl, { method: "GET" });
      
      if (!response.ok) throw new Error("Failed to fetch reports");
      
      const files = await response.json();
      reportsListLoading.style.display = 'none';

      const pdfFiles = files.filter(f => f.fileName.endsWith('.pdf'));

      if (pdfFiles.length === 0) {
        reportsListLoading.style.display = 'block';
        reportsListLoading.textContent = "No saved reports yet.";
        return;
      }

      pdfFiles.forEach(file => {
        const item = document.createElement("div");
        item.className = "saved-report-item";
        item.style.cursor = "pointer";
        
        const svg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
        const dateStr = new Date(file.lastModified).toLocaleDateString();
        
        // Find corresponding JSON file
        const jsonFile = files.find(f => f.fileName === file.fileName.replace('.pdf', '.json'));
        const viewBtnHtml = jsonFile ? `<button class="view-path-btn" style="background: none; border: none; cursor: pointer; color: #0ea5e9; font-size: 14px;" title="View Path on Map">👁️</button>` : '';
        
        item.innerHTML = `
          <input type="checkbox" class="report-checkbox" style="display: none; cursor: pointer; margin-right: 8px;" data-filename="${file.fileName}">
          <a href="${file.url}" target="_blank" class="report-link" style="display: flex; align-items: center; flex: 1; color: inherit; text-decoration: none; overflow: hidden;">
            ${svg} <span style="flex: 1; margin-left: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${file.fileName}">${file.fileName}</span>
          </a>
          <div style="display: flex; align-items: center; gap: 8px;">
            ${viewBtnHtml}
            <span style="color: #94a3b8; font-size: 10px;">${dateStr}</span>
          </div>
        `;
        
        const viewBtn = item.querySelector('.view-path-btn');
        if (viewBtn) {
          viewBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();
            try {
              const res = await fetch(jsonFile.url);
              if (!res.ok) {
                const errText = await res.text();
                throw new Error(`HTTP ${res.status}: ${errText}`);
              }
              const text = await res.text();
              let metadata;
              try {
                metadata = JSON.parse(text);
              } catch (parseErr) {
                throw new Error(`JSON Parse Error: ${parseErr.message}. Content: ${text.substring(0, 100)}`);
              }
              
              if (metadata.startPoint && metadata.endPoint) {
                 measureStartPoint = new Vector3(metadata.startPoint.x, metadata.startPoint.y, metadata.startPoint.z);
                 measureEndPoint = new Vector3(metadata.endPoint.x, metadata.endPoint.y, metadata.endPoint.z);
                 if (metadata.startCoord) measureStartCoord = new Coordinates(giroCrs, metadata.startCoord.x, metadata.startCoord.y, metadata.startCoord.z);
                 if (metadata.endCoord) measureEndCoord = new Coordinates(giroCrs, metadata.endCoord.x, metadata.endCoord.y, metadata.endCoord.z);
                 
                 measureMode = "PROFILE";
                 measureState = "FINISHED";
                 updateMeasureSvg();
                 
                 // Expand Path Profile tool if closed
                 if (profileSettings.style.display === "none") {
                   profileHeader.click();
                 }
                 
                 // Show the reset button
                 btnProfile.classList.remove("active");
                 btnProfile.textContent = "Draw Path Profile";
                 btnClearProfile.disabled = false;
                 
                 // Run the live update to rebuild the graph and distances!
                 updateElevationProfile();
              }
            } catch(err) {
              console.error("Failed to load path metadata", err);
              alert("Failed to load path metadata from S3.\nError: " + err.message);
            }
          });
        }
        
        item.addEventListener("click", (e) => {
          if (isReportManageMode) {
            if (e.target.tagName.toLowerCase() !== 'input') {
              e.preventDefault();
              const cb = item.querySelector(".report-checkbox");
              if (cb) cb.checked = !cb.checked;
            }
          }
        });
        
        reportsList.appendChild(item);
      });
      
      // Restore UI state if re-fetched during manage mode
      toggleManageMode(isReportManageMode);
      
    } catch (err) {
      console.error(err);
      reportsListLoading.style.display = 'block';
      reportsListLoading.textContent = "Error loading reports.";
    }
  }

  // --- Professional Manage Mode Logic ---
  let isReportManageMode = false;
  const manageReportsBtn = document.getElementById("manageReportsBtn");
  const cancelManageReportsBtn = document.getElementById("cancelManageReportsBtn");
  const reportsSelectionBar = document.getElementById("reportsSelectionBar");
  const manageReportsContainer = document.getElementById("manageReportsContainer");
  const selectAllReports = document.getElementById("selectAllReports");
  const deleteSelectedReportsBtn = document.getElementById("deleteSelectedReportsBtn");

  function toggleManageMode(enable) {
    isReportManageMode = enable;
    if (manageReportsContainer) manageReportsContainer.style.display = enable ? "none" : "flex";
    if (reportsSelectionBar) reportsSelectionBar.style.display = enable ? "flex" : "none";
    
    document.querySelectorAll(".report-checkbox").forEach(cb => {
      cb.style.display = enable ? "block" : "none";
      if (!enable) cb.checked = false;
    });
    document.querySelectorAll(".report-link").forEach(link => {
      link.style.pointerEvents = enable ? "none" : "auto";
    });
    if (!enable && selectAllReports) selectAllReports.checked = false;
  }

  manageReportsBtn?.addEventListener("click", () => toggleManageMode(true));
  cancelManageReportsBtn?.addEventListener("click", () => toggleManageMode(false));

  selectAllReports?.addEventListener("change", (e) => {
    const isChecked = e.target.checked;
    document.querySelectorAll(".report-checkbox").forEach(cb => cb.checked = isChecked);
  });

  deleteSelectedReportsBtn?.addEventListener("click", async () => {
    const selectedCbs = document.querySelectorAll(".report-checkbox:checked");
    if (selectedCbs.length === 0) {
      alert("No reports selected.");
      return;
    }
    
    if (confirm(`Are you sure you want to delete ${selectedCbs.length} report(s)?`)) {
      const originalText = deleteSelectedReportsBtn.textContent;
      deleteSelectedReportsBtn.textContent = "Deleting...";
      deleteSelectedReportsBtn.disabled = true;
      
      try {
        const deletePromises = Array.from(selectedCbs).map(cb => {
          const fileName = cb.getAttribute("data-filename");
          const jsonFileName = fileName.replace('.pdf', '.json');
          const apiUrl = `https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url`;
          
          const deletePdf = fetch(apiUrl, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: activeProject.folderName,
              surveyId: activeProject.surveyId,
              fileName: fileName
            })
          }).then(res => {
            if (!res.ok) throw new Error(`Delete failed for ${fileName}`);
          });
          
          const deleteJson = fetch(apiUrl, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: activeProject.folderName,
              surveyId: activeProject.surveyId,
              fileName: jsonFileName
            })
          }).catch(() => {}); // Ignore JSON delete failure if it didn't exist

          return Promise.all([deletePdf, deleteJson]);
        });
        
        await Promise.all(deletePromises);
        
        toggleManageMode(false);
        fetchSavedReports();
      } catch (err) {
        console.error("Delete error:", err);
        alert("Some reports failed to delete.");
        fetchSavedReports();
      } finally {
        deleteSelectedReportsBtn.textContent = originalText;
        deleteSelectedReportsBtn.disabled = false;
      }
    }
  });

  // Fetch immediately on load
  fetchSavedReports();

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

  let isVolumeManageMode = false;
  
  // Pre-fetch volumes on load so the panel is ready instantly
  fetchSavedVolumes();

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

  btnNewVolFolder?.addEventListener("click", () => {
    const newFolder = prompt("Enter new folder name (e.g. Stockpiles, CutBlocks):");
    if (newFolder && newFolder.trim()) {
      const folderName = newFolder.trim();
      const opt = document.createElement("option");
      opt.value = folderName;
      opt.textContent = folderName;
      volSaveFolder.appendChild(opt);
      volSaveFolder.value = folderName;
    }
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

  async function fetchSavedVolumes() {
    if (!volumesListLoading || !volumesList) return;
    
    volumesListLoading.style.display = 'block';
    volumesListLoading.textContent = "Loading volumes...";
    volumesList.innerHTML = '';

    try {
      if (!activeProject) throw new Error("No active project");
      const apiUrl = `https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url?projectId=${activeProject.folderName}&surveyId=${activeProject.surveyId}&type=volumes`;
      const response = await fetch(apiUrl, { method: "GET" });
      
      if (!response.ok) throw new Error("Failed to fetch volumes");
      
      const files = await response.json();
      volumesListLoading.style.display = 'none';

      // We only care about JSON files for volumes
      const jsonFiles = files.filter(f => f.fileName.endsWith('.json'));

      if (jsonFiles.length === 0) {
        volumesListLoading.style.display = 'block';
        volumesListLoading.textContent = "No saved volumes yet.";
        return;
      }

      // Group by folder
      const folders = {};
      jsonFiles.forEach(f => {
        const parts = f.fileName.split('/');
        let folderName = "General";
        
        // If there's a folder in the path (e.g., "Pits/my_vol.json"), use it
        if (parts.length > 1) {
            folderName = parts[0];
        }
        
        if (!folders[folderName]) folders[folderName] = [];
        folders[folderName].push(f);
      });

      // Render Folders
      Object.keys(folders).sort().forEach(folderName => {
        const folderGroup = document.createElement("div");
        
        const fHeader = document.createElement("div");
        fHeader.className = "folder-header";
        const folderSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
        fHeader.innerHTML = `<span style="display: flex; align-items: center; gap: 6px;">${folderSvg} ${folderName}</span><span style="font-size: 10px;">▼</span>`;
        
        const fContent = document.createElement("div");
        fContent.className = "folder-content";
        
        fHeader.addEventListener("click", () => {
          const isHidden = fContent.style.display === "none";
          fContent.style.display = isHidden ? "flex" : "none";
          fHeader.querySelector("span:last-child").textContent = isHidden ? "▼" : "▶";
        });

        folders[folderName].sort((a,b) => new Date(b.lastModified) - new Date(a.lastModified)).forEach(f => {
            const item = document.createElement("div");
            item.className = "report-item";
            item.style.padding = "6px 8px";
            
            // Nice formatting for name
            const niceName = f.fileName.split('/').pop().replace(/_[0-9]+\.json$/, '').replace(/_/g, ' ');

            item.innerHTML = `
              <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                <div style="display: flex; align-items: center;">
                  <input type="checkbox" class="volume-checkbox" value="${f.fileName}" style="display: none; margin-right: 8px; cursor: pointer; accent-color: var(--purple-primary);">
                  <div style="display: flex; flex-direction: column;">
                    <span style="font-weight: 500; font-size: 13px; text-transform: capitalize;">${niceName}</span>
                    <span style="font-size: 10px; color: #64748b;">${new Date(f.lastModified).toLocaleDateString()}</span>
                  </div>
                </div>
                <button class="btn-outline view-vol-btn" data-url="${f.url}" style="padding: 2px 8px; font-size: 11px;">View</button>
              </div>
            `;

            item.querySelector('.view-vol-btn').addEventListener("click", async (e) => {
              if (isVolumeManageMode) return;
              e.stopPropagation();
              const btn = e.currentTarget;
              const originalText = btn.textContent;
              btn.textContent = "Loading...";
              
              try {
                const res = await fetch(f.url);
                const metadata = await res.json();
                
                measureMode = "VOLUME";
                measureState = "FINISHED_VOLUME";
                
                // Reconstruct points
                volumePoints = metadata.points.map(p => ({
                    coord: new Coordinates(giroCrs, p.x, p.y, p.z),
                    point: new Vector3(p.x, p.y, p.z)
                }));
                
                // Center camera on polygon center
                let cx=0, cy=0;
                for(let p of volumePoints) { cx+=p.coord.x; cy+=p.coord.y; }
                cx/=volumePoints.length; cy/=volumePoints.length;
                
                const centerWorld = new Vector3(cx, cy, activeProject.zOffset || 0);
                controls.target.copy(centerWorld);
                controls.update();

                updateVolumeSvg();
                
                document.getElementById("volMiniArea").textContent = metadata.area2D;
                document.getElementById("volMiniPerim").textContent = metadata.perimeter;
                document.getElementById("volMiniCut").textContent = metadata.cutVolume;
                document.getElementById("volMiniFill").textContent = metadata.fillVolume;
                
                if (volumeMiniContainer) volumeMiniContainer.classList.remove("hidden");
              } catch(err) {
                console.error("Failed to load volume metadata", err);
                alert("Failed to load volume details.");
              } finally {
                btn.textContent = originalText;
              }
            });
            
            fContent.appendChild(item);
        });

        folderGroup.appendChild(fHeader);
        folderGroup.appendChild(fContent);
        volumesList.appendChild(folderGroup);
      });
    } catch (err) {
      console.error(err);
      volumesListLoading.style.display = 'block';
      volumesListLoading.textContent = "Error loading volumes.";
    }
  }

  // Manage Volumes UI
  const manageVolumesBtn = document.getElementById("manageVolumesBtn");
  const volumesSelectionBar = document.getElementById("volumesSelectionBar");
  const cancelManageVolumesBtn = document.getElementById("cancelManageVolumesBtn");
  const deleteSelectedVolumesBtn = document.getElementById("deleteSelectedVolumesBtn");

  manageVolumesBtn?.addEventListener("click", () => {
    isVolumeManageMode = true;
    manageVolumesBtn.style.display = "none";
    volumesSelectionBar.style.display = "flex";
    document.querySelectorAll('.volume-checkbox').forEach(cb => cb.style.display = 'block');
    document.querySelectorAll('.view-vol-btn').forEach(btn => btn.style.display = 'none');
  });

  cancelManageVolumesBtn?.addEventListener("click", () => {
    isVolumeManageMode = false;
    manageVolumesBtn.style.display = "block";
    volumesSelectionBar.style.display = "none";
    document.querySelectorAll('.volume-checkbox').forEach(cb => {
        cb.style.display = 'none';
        cb.checked = false;
    });
    document.querySelectorAll('.view-vol-btn').forEach(btn => btn.style.display = 'block');
  });

});

