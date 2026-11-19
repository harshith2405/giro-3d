// src/tools/contours.js
// Topographic Contours, Marching Squares Extraction, 3D CAD DXF & GeoJSON Export

import { Color } from "three";
import { state } from "../core/state.js";

let contoursEnabled = false;

/** Push the current contour settings onto the Giro3D map */
export function applyContours() {
  const map = state.map;
  if (!map) return;
  try {
    if (!contoursEnabled) {
      map.contourLines = { enabled: false, opacity: 0 };
    } else {
      const _contourOpacity = document.getElementById("infoContourOpacity") || document.getElementById("contourOpacity");
      const _contourInterval = document.getElementById("infoContourInterval") || document.getElementById("contourInterval");
      const _majorInterval = document.getElementById("infoMajorInterval") || document.getElementById("majorInterval");
      const _contourColor = document.getElementById("infoContourColor") || document.getElementById("contourColor");
      const _contourWidth = document.getElementById("infoContourWidth") || document.getElementById("contourWidth");

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
    state.instance.notifyChange();
  } catch (err) {
    console.error("Contour error:", err);
  }
}

/** Regenerate contours, showing a loading indicator while processing */
export function regenerateContours() {
  const contourLoading = document.getElementById("contourLoading");
  if (contoursEnabled) {
    if (contourLoading) contourLoading.classList.remove("hidden");
    setTimeout(() => {
      applyContours();
      setTimeout(() => {
        if (contourLoading) contourLoading.classList.add("hidden");
      }, 500);
    }, 50);
  } else {
    applyContours();
    if (contourLoading) contourLoading.classList.add("hidden");
  }
}

/** Marching Squares isocontour polyline extraction across terrain elevation mesh */
export function extractContourPolylines(minorStep = 2, majorStep = 10) {
  const map = state.map;
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
  } else if (state.activeProject?.extent) {
    minX = state.activeProject.extent[0];
    minY = state.activeProject.extent[1];
    maxX = state.activeProject.extent[2];
    maxY = state.activeProject.extent[3];
  } else if (state.instance?.reference) {
    minX = state.instance.reference.x - 500;
    maxX = state.instance.reference.x + 500;
    minY = state.instance.reference.y - 500;
    maxY = state.instance.reference.y + 500;
  } else {
    minX = 0; maxX = 1000; minY = 0; maxY = 1000;
  }

  const GRID_RES = 100;
  const dx = (maxX - minX) / (GRID_RES - 1);
  const dy = (maxY - minY) / (GRID_RES - 1);

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
      } catch (e) {}
      row.push(z);
    }
    grid.push(row);
  }

  const contours = [];

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

        switch (code) {
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

/** Download 3D AutoCAD DXF contour file */
export function downloadContoursDxf() {
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
      const projName = state.activeProject?.folderName || "site";
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

/** Download contours as GeoJSON lines with elevation properties */
export function downloadContoursGeoJson() {
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
          properties: { name: state.activeProject?.crs || "urn:ogc:def:crs:OGC:1.3:CRS84" }
        },
        features
      };

      const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: "application/geo+json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const projName = state.activeProject?.folderName || "site";
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
    } catch (err) {
      console.error("GeoJSON export error", err);
      if (statusEl) statusEl.textContent = "⚠️ Export failed: " + err.message;
    }
  }, 60);
}

/** Initialize Contours UI and control bindings */
export function initContoursUI() {
  const btnEnableContours = document.getElementById("btnEnableContours");
  const btnDisableContours = document.getElementById("btnDisableContours");
  const contourPreset = document.getElementById("contourPreset");
  const contourInterval = document.getElementById("contourInterval");
  const majorInterval = document.getElementById("majorInterval");
  const contourColor = document.getElementById("contourColor");
  const contourWidth = document.getElementById("contourWidth");
  const contourOpacity = document.getElementById("contourOpacity");
  const btnDownloadDxf = document.getElementById("btnDownloadContoursDxf");
  const btnDownloadGeoJson = document.getElementById("btnDownloadContoursGeoJson");

  btnEnableContours?.addEventListener("click", () => {
    contoursEnabled = true;
    btnEnableContours.disabled = true;
    if (btnDisableContours) btnDisableContours.disabled = false;
    document.getElementById("infoContourExportCard")?.classList.remove("hidden");
    state.isContourOverlayActive = true;
    const btnRightContour = document.getElementById("btnRightContour");
    if (btnRightContour) btnRightContour.classList.add("overlay-active");
    regenerateContours();
  });

  btnDisableContours?.addEventListener("click", () => {
    contoursEnabled = false;
    if (btnEnableContours) btnEnableContours.disabled = false;
    btnDisableContours.disabled = true;
    document.getElementById("infoContourExportCard")?.classList.add("hidden");
    state.isContourOverlayActive = false;
    const btnRightContour = document.getElementById("btnRightContour");
    if (btnRightContour) btnRightContour.classList.remove("overlay-active");
    regenerateContours();
  });

  [contourInterval, majorInterval, contourColor, contourWidth, contourOpacity].forEach((input) => {
    input?.addEventListener("input", (e) => {
      if (e.target === contourOpacity) {
        const opacityVal = document.getElementById("contourOpacityVal");
        if (opacityVal) opacityVal.textContent = contourOpacity.value;
      }
      if (contoursEnabled) {
        if (e.target === contourInterval || e.target === majorInterval) {
          if (contourPreset) contourPreset.value = "custom";
        }
        regenerateContours();
      }
    });
  });

  contourPreset?.addEventListener("change", () => {
    const preset = contourPreset.value;
    if (preset === "survey") {
      if (contourInterval) contourInterval.value = "1";
      if (majorInterval) majorInterval.value = "5";
    } else if (preset === "mining") {
      if (contourInterval) contourInterval.value = "2";
      if (majorInterval) majorInterval.value = "10";
    } else if (preset === "overview") {
      if (contourInterval) contourInterval.value = "10";
      if (majorInterval) majorInterval.value = "50";
    }
    if (contoursEnabled) regenerateContours();
  });

  btnDownloadDxf?.addEventListener("click", downloadContoursDxf);
  btnDownloadGeoJson?.addEventListener("click", downloadContoursGeoJson);
  document.getElementById("btnExportContourDxf")?.addEventListener("click", downloadContoursDxf);
  document.getElementById("btnExportContourGeoJson")?.addEventListener("click", downloadContoursGeoJson);

  const contourHeader = document.getElementById("contourHeader");
  const contourSettings = document.getElementById("contourSettings");
  const contourCarrot = document.getElementById("contourCarrot");

  contourHeader?.addEventListener("click", () => {
    if (!contourSettings) return;
    if (contourSettings.style.display === "none") {
      contourSettings.style.display = "block";
      if (contourCarrot) contourCarrot.textContent = "▲";
    } else {
      contourSettings.style.display = "none";
      if (contourCarrot) contourCarrot.textContent = "▼";
    }
  });

  // Attach to window
  window.applyContours = applyContours;
  window.regenerateContours = regenerateContours;
  window.downloadContoursDxf = downloadContoursDxf;
  window.downloadContoursGeoJson = downloadContoursGeoJson;
}
