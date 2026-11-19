// src/tools/multiOverlay.js
// Multi-Select Visualization: Draped Dual-Stroke Overlays, Centroid Badges & Interactive Focus

import { Vector3 } from "three";
import { state } from "../core/state.js";
import { projectToScreen } from "../core/camera.js";
import { getDrapedPolygon3DPoints, buildProfile3DPointsFromElevations } from "./drapedMath.js";
import { showUnifiedInfoPanel } from "../ui/infoPanel.js";
import { initCharts } from "./profileChart.js";

/** Render clickable glassmorphic badge marker at projected centroid */
export function renderMapBadge(text, x, y, isFocused, onClick) {
  const multiBadgesGroup = document.getElementById("multiBadgesGroup");
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

/** Focus a specific feature in multi-select mode and display its metrics in Unified Info Panel */
export function focusMultiFeature(id, type) {
  state.activeFocusedFeatureId = id;
  if (type === "VOLUME") {
    const vol = state.multiSelectedVolumesMap.get(id);
    if (vol && vol.metadata) {
      const volMiniArea = document.getElementById("volMiniArea");
      const volMiniPerim = document.getElementById("volMiniPerim");
      const volMiniCut = document.getElementById("volMiniCut");
      const volMiniFill = document.getElementById("volMiniFill");
      const netEl = document.getElementById("volMiniNet");

      if (volMiniArea) volMiniArea.textContent = vol.metadata.area2D || "0";
      if (volMiniPerim) volMiniPerim.textContent = vol.metadata.perimeter || "0";
      if (volMiniCut) volMiniCut.textContent = vol.metadata.cutVolume || "0";
      if (volMiniFill) volMiniFill.textContent = vol.metadata.fillVolume || "0";

      if (netEl) {
        const cutNum = parseFloat(String(vol.metadata.cutVolume || "").replace(/[^0-9.-]/g, "")) || 0;
        const fillNum = parseFloat(String(vol.metadata.fillVolume || "").replace(/[^0-9.-]/g, "")) || 0;
        const netVal = vol.metadata.netVolume || (cutNum - fillNum);
        const netNum = (typeof netVal === "number") ? netVal : (parseFloat(String(netVal).replace(/[^0-9.-]/g, "")) || 0);
        const netSign = netNum >= 0 ? "+" : "";
        netEl.textContent = `${netSign}${netNum.toLocaleString(undefined, { maximumFractionDigits: 2 })} m³`;
        netEl.style.color = netNum >= 0 ? "#10b981" : "#ef4444";
      }
      showUnifiedInfoPanel("VOLUME", "SAVED VOLUME", vol.metadata, true);
    }
  } else if (type === "PROFILE") {
    const prof = state.multiSelectedReportsMap.get(id);
    if (prof && prof.metadata) {
      const m = prof.metadata;
      const profHoriz = document.getElementById("profileHoriz");
      const profVert = document.getElementById("profileVert");
      const prof3D = document.getElementById("profile3D");

      if (profHoriz && m.chartData) profHoriz.textContent = (m.chartData.totalDist || 0).toFixed(2) + " m";
      if (profVert && m.chartData) profVert.textContent = (m.chartData.elevChange || 0).toFixed(2) + " m";
      if (prof3D && m.chartData) prof3D.textContent = (m.chartData.surfDist || 0).toFixed(2) + " m";

      const elevationMiniContainer = document.getElementById("elevationMiniContainer");
      if (elevationMiniContainer) elevationMiniContainer.classList.remove("hidden");

      showUnifiedInfoPanel("PROFILE", "ELEVATION PROFILE", m, true);

      if (m.chartData?.distances && m.chartData?.elevations) {
        if (state.miniChart && (state.miniChart.width === 0 || state.miniChart.height === 0)) {
          state.miniChart.destroy();
          state.miniChart = null;
        }
        const _savedDistances = m.chartData.distances;
        const _savedElevations = m.chartData.elevations;
        setTimeout(() => {
          initCharts();
          if (state.miniChart) {
            state.miniChart.data.labels = _savedDistances;
            state.miniChart.data.datasets[0].data = _savedElevations;
            if (m.chartData.comparisonData) {
              const comp = m.chartData.comparisonData;
              if (state.miniChart.data.datasets.length < 2) {
                state.miniChart.data.datasets.push({
                  label: comp.label || `Past Survey`,
                  data: comp.elevations || [],
                  borderColor: "#ea580c",
                  borderDash: [5, 4],
                  fill: false,
                  tension: 0.2,
                  borderWidth: 2,
                  pointRadius: 0
                });
              } else {
                state.miniChart.data.datasets[1].label = comp.label || `Past Survey`;
                state.miniChart.data.datasets[1].data = comp.elevations || [];
              }
              const compMetrics = document.getElementById("profileComparisonMetrics");
              const compName = document.getElementById("profileComparisonSurveyName");
              const maxCutEl = document.getElementById("profileMaxCut");
              const maxFillEl = document.getElementById("profileMaxFill");
              if (compMetrics) compMetrics.classList.remove("hidden");
              if (compName) compName.textContent = comp.label || comp.surveyKey || "Past Survey";
              if (maxCutEl) maxCutEl.textContent = `${(comp.maxCut || 0).toFixed(2)} m`;
              if (maxFillEl) maxFillEl.textContent = `${(comp.maxFill || 0).toFixed(2)} m`;
            } else {
              if (state.miniChart.data.datasets.length > 1) {
                state.miniChart.data.datasets.splice(1, 1);
              }
              const compMetrics = document.getElementById("profileComparisonMetrics");
              if (compMetrics) compMetrics.classList.add("hidden");
            }
            state.miniChart.resize();
            state.miniChart.update("none");
          }
        }, 100);
      }
    }
  }
  updateMultiOverlaySvg();
}

/** Redraw multi-selected volume and path profile overlays onto the map */
export function updateMultiOverlaySvg() {
  const multiPolygonsGroup = document.getElementById("multiPolygonsGroup");
  const multiLinesGroup = document.getElementById("multiLinesGroup");
  const multiBadgesGroup = document.getElementById("multiBadgesGroup");

  if (!state.instance?.view?.camera) return;

  if (multiPolygonsGroup) multiPolygonsGroup.innerHTML = "";
  if (multiLinesGroup) multiLinesGroup.innerHTML = "";
  if (multiBadgesGroup) multiBadgesGroup.innerHTML = "";

  // 1. Render Multi-Selected Volumes (Dual-Stroke Halo + Purple Core)
  if (state.multiSelectedVolumesMap.size > 0) {
    state.multiSelectedVolumesMap.forEach((item, id) => {
      const volData = item.data || item.metadata;
      if (!volData || !volData.points || volData.points.length < 3) return;
      const isFocused = id === state.activeFocusedFeatureId;

      let sumX = 0, sumY = 0, sumZ = 0;
      for (const pt of volData.points) {
        sumX += pt.x; sumY += pt.y; sumZ += (pt.z || 0);
      }

      const drapedPts = getDrapedPolygon3DPoints(volData.points, true);
      const screenPoints = [];
      for (const pt of drapedPts) {
        const screenP = projectToScreen(pt);
        if (screenP.z <= 1) {
          screenPoints.push(`${screenP.x},${screenP.y}`);
        }
      }

      if (screenPoints.length < 3) return;

      const ptsAttr = screenPoints.join(" ");

      // Halo white line underneath (3.2px)
      const haloEl = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      haloEl.setAttribute("points", ptsAttr);
      haloEl.setAttribute("fill", "none");
      haloEl.setAttribute("stroke", "#ffffff");
      haloEl.setAttribute("stroke-width", "3.2");
      haloEl.setAttribute("stroke-linejoin", "round");
      haloEl.setAttribute("stroke-linecap", "round");
      haloEl.style.pointerEvents = "none";

      // Core Polygon line on top
      const polyEl = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      polyEl.setAttribute("points", ptsAttr);
      polyEl.setAttribute("fill", isFocused ? "rgba(94, 25, 234, 0.25)" : "rgba(94, 25, 234, 0.15)");
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

  // 2. Render Multi-Selected Path Profiles (High-Density Draped, Dual-Stroke Halo + Terminal Dots)
  if (state.multiSelectedReportsMap.size > 0) {
    state.multiSelectedReportsMap.forEach((item, id) => {
      const repData = item.data || item.metadata;
      if (!repData) return;

      if (!item._drapedPoints3D) {
        if (repData.startPoint && repData.endPoint) {
          const sPt = new Vector3(repData.startPoint.x, repData.startPoint.y, repData.startPoint.z);
          const ePt = new Vector3(repData.endPoint.x, repData.endPoint.y, repData.endPoint.z);

          if (repData.chartData?.elevations?.length >= 2) {
            item._drapedPoints3D = buildProfile3DPointsFromElevations(sPt, ePt, repData.chartData.elevations);
          } else {
            item._drapedPoints3D = [];
            const refX = state.instance?.reference?.x || 0;
            const refY = state.instance?.reference?.y || 0;
            const sX = repData.startCoord ? repData.startCoord.x : (repData.startPoint.x + refX);
            const sY = repData.startCoord ? repData.startCoord.y : (repData.startPoint.y + refY);
            const eX = repData.endCoord ? repData.endCoord.x : (repData.endPoint.x + refX);
            const eY = repData.endCoord ? repData.endCoord.y : (repData.endPoint.y + refY);

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
                const sample = state.map ? state.map.getElevationFast(gx, gy) : null;
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
          const refX = state.instance?.reference?.x || 0;
          const refY = state.instance?.reference?.y || 0;
          item._drapedPoints3D = pts.map(p => new Vector3(
            p.coord ? p.coord.x - refX : (p.x || 0),
            p.coord ? p.coord.y - refY : (p.y || 0),
            (p.coord ? p.coord.z : (p.z || 0)) + 0.35
          ));
        }
      }

      const pts3D = item._drapedPoints3D;
      if (!pts3D || pts3D.length < 2) return;

      const isFocused = id === state.activeFocusedFeatureId;

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

      // Halo white line underneath (3.2px)
      const haloLine = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      haloLine.setAttribute("points", ptsAttr);
      haloLine.setAttribute("fill", "none");
      haloLine.setAttribute("stroke", "#ffffff");
      haloLine.setAttribute("stroke-width", "3.2");
      haloLine.setAttribute("stroke-linecap", "round");
      haloLine.setAttribute("stroke-linejoin", "round");
      haloLine.style.pointerEvents = "none";

      // Core Purple line on top
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

      // Terminal Dots (Green Start, Red End)
      const startScreen = projectToScreen(pts3D[0]);
      if (startScreen.z <= 1) {
        const startCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        startCircle.setAttribute("cx", startScreen.x.toFixed(1));
        startCircle.setAttribute("cy", startScreen.y.toFixed(1));
        startCircle.setAttribute("r", isFocused ? "5.5" : "4.5");
        startCircle.setAttribute("fill", "#10b981");
        startCircle.setAttribute("stroke", "#ffffff");
        startCircle.setAttribute("stroke-width", "1.8");
        if (isFocused) startCircle.setAttribute("filter", "url(#multiGlow)");
        multiLinesGroup.appendChild(startCircle);
      }

      const endScreen = projectToScreen(pts3D[pts3D.length - 1]);
      if (endScreen.z <= 1) {
        const endCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        endCircle.setAttribute("cx", endScreen.x.toFixed(1));
        endCircle.setAttribute("cy", endScreen.y.toFixed(1));
        endCircle.setAttribute("r", isFocused ? "5.5" : "4.5");
        endCircle.setAttribute("fill", "#ef4444");
        endCircle.setAttribute("stroke", "#ffffff");
        endCircle.setAttribute("stroke-width", "1.8");
        if (isFocused) endCircle.setAttribute("filter", "url(#multiGlow)");
        multiLinesGroup.appendChild(endCircle);
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

/** Initialize View All switch listeners */
export function initMultiOverlayUI() {
  const toggleViewAllReports = document.getElementById("toggleViewAllReports");
  toggleViewAllReports?.addEventListener("change", (e) => {
    const isChecked = e.target.checked;
    state.isMultiSelectReports = isChecked;

    document.querySelectorAll(".toggle-folder-view-reports").forEach(cb => cb.checked = isChecked);

    if (isChecked) {
      document.querySelectorAll("#reportsList .saved-report-item, #featuresListLines .saved-report-item").forEach(item => {
        item.classList.add("selected-item");
      });
      if (window._cachedAllProfileItems) {
        window._cachedAllProfileItems.forEach(({ pdfFile, jsonFile, metadata }) => {
          const uniqueId = (jsonFile && jsonFile.fileName) ? jsonFile.fileName : pdfFile.fileName;
          const rawName = metadata?.name || metadata?.title || pdfFile.fileName.split("/").pop().replace(".pdf", "").replace(/_/g, " ");
          state.multiSelectedReportsMap.set(uniqueId, {
            name: rawName,
            pdfUrl: pdfFile.url,
            metadata,
            data: metadata,
            file: jsonFile,
            folderName: metadata?.folder || "General"
          });
        });
      }
    } else {
      document.querySelectorAll("#reportsList .saved-report-item, #featuresListLines .saved-report-item").forEach(item => {
        item.classList.remove("selected-item");
      });
      state.multiSelectedReportsMap.clear();
      state.activeFocusedFeatureId = null;
    }
    updateMultiOverlaySvg();
  });

  const toggleViewAllVolumes = document.getElementById("toggleViewAllVolumes");
  toggleViewAllVolumes?.addEventListener("change", (e) => {
    const isChecked = e.target.checked;
    state.isMultiSelectVolumes = isChecked;

    document.querySelectorAll(".toggle-folder-view-volumes").forEach(cb => cb.checked = isChecked);

    if (isChecked) {
      document.querySelectorAll("#volumesList .saved-report-item, #featuresListPolygons .saved-report-item").forEach(item => {
        item.classList.add("selected-item");
      });
      if (window._cachedAllVolumeItems) {
        window._cachedAllVolumeItems.forEach(({ file, metadata }) => {
          const uniqueId = file.fileName || metadata?.name || "Volume";
          const volName = metadata?.name || file.fileName.split("/").pop().replace(".json", "");
          state.multiSelectedVolumesMap.set(uniqueId, {
            file,
            metadata,
            data: metadata,
            name: volName,
            folderName: metadata?.folder || "General"
          });
        });
      }
    } else {
      document.querySelectorAll("#volumesList .saved-report-item, #featuresListPolygons .saved-report-item").forEach(item => {
        item.classList.remove("selected-item");
      });
      state.multiSelectedVolumesMap.clear();
      state.activeFocusedFeatureId = null;
    }
    updateMultiOverlaySvg();
  });

  // Attach to window
  window.updateMultiOverlaySvg = updateMultiOverlaySvg;
}
