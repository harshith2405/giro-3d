// src/tools/volume.js
// Cut/Fill Volume Calculations, KML Multi-Polygon Processing, Accordion Cards & SVG Overlays

import { Vector3 } from "three";
import proj4 from "proj4";
import Coordinates from "@giro3d/giro3d/core/geographic/Coordinates.js";
import { giroCrs } from "../config/crs.js";
import { state, setLiveGuidance } from "../core/state.js";
import { projectToScreen, setCameraTopDown } from "../core/camera.js";
import { getDrapedPolygon3DPoints } from "./drapedMath.js";
import { showCustomAlert } from "../ui/dialogs.js";
import { showUnifiedInfoPanel, openUniversalSaveModal, syncFolderDropdowns } from "../ui/infoPanel.js";
import { resetRoiState } from "./roiState.js";
import { clearAllLeftPanelState } from "../services/clearState.js";

/** Calculate 3D perimeter, reference elevation, 2D area (Shoelace), and Cut/Fill volumes (1m grid) */
export function calculateVolumeMetrics() {
  const map = state.map;
  if (!map || state.volumePoints.length < 3) return;

  // 1. Calculate 3D Perimeter and Average Reference Elevation
  let perimeter = 0;
  let sumElevation = 0;
  const coords = state.volumePoints.map(p => p.coord);

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

  function pointInPolygon(px, py, poly) {
    let isInside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) isInside = !isInside;
    }
    return isInside;
  }

  for (let x = minX; x <= maxX; x += gridStep) {
    for (let y = minY; y <= maxY; y += gridStep) {
      if (pointInPolygon(x, y, coords)) {
        const sample = map.getElevationFast(x, y);
        const z = sample ? sample.elevation : 0;
        const diff = z - referenceElevation;

        if (diff > 0) {
          cutVolume += diff * (gridStep * gridStep); // Stockpile / Dump (Above Ground)
        } else {
          fillVolume += Math.abs(diff) * (gridStep * gridStep); // Pit / Void (Below Ground)
        }
      }
    }
  }

  const netVolume = cutVolume - fillVolume;

  // 4. Update UI
  const areaEl = document.getElementById("volMiniArea");
  const perimEl = document.getElementById("volMiniPerim");
  const cutEl = document.getElementById("volMiniCut");
  const fillEl = document.getElementById("volMiniFill");
  const netEl = document.getElementById("volMiniNet");

  if (areaEl) areaEl.textContent = area2D.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " m²";
  if (perimEl) perimEl.textContent = perimeter.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " m";
  if (cutEl) cutEl.textContent = cutVolume.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " m³";
  if (fillEl) fillEl.textContent = fillVolume.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " m³";
  if (netEl) {
    const netSign = netVolume >= 0 ? "+" : "";
    netEl.textContent = `${netSign}${netVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })} m³`;
    netEl.style.color = netVolume >= 0 ? "#10b981" : "#ef4444";
  }

  showUnifiedInfoPanel("VOLUME", "VOLUME ANALYSIS", { area2D, perimeter, cutVolume, fillVolume, netVolume, coords });
}

/** Update the volume SVG overlay on map */
export function updateVolumeSvg() {
  const volumeSvg = document.getElementById("volumeSvg");
  const volumePolygonHalo = document.getElementById("volumePolygonHalo");
  const volumePolygonSvg = document.getElementById("volumePolygonOverlay") || document.getElementById("volumePolygonSvg");
  const volumeVerticesSvg = document.getElementById("volumeVerticesOverlay") || document.getElementById("volumeVerticesSvg");
  const secondaryGroup = document.getElementById("volumeSecondaryPolygonsGroup");

  if (state.isMultiSelectVolumes && (state.measureMode === "VOLUME" || state.measureState === "FINISHED_VOLUME")) {
    if (volumeSvg) volumeSvg.style.display = "none";
    return;
  }

  const canvas = state.instance?.domElement;
  if (!canvas) return;

  if ((state.measureMode === "VOLUME" || state.measureState === "FINISHED_VOLUME") && state.volumePoints.length > 0) {
    const cachedRect = canvas.getBoundingClientRect();
    let pointsAttr = "";
    if (volumeVerticesSvg) volumeVerticesSvg.innerHTML = "";

    // Render secondary (inactive) polygons if multi-polygon mode is active
    if (secondaryGroup) {
      secondaryGroup.innerHTML = "";
      if (state.multiKmlPolygons && state.multiKmlPolygons.length > 1) {
        state.multiKmlPolygons.forEach((poly, pIdx) => {
          if (pIdx === state.activeKmlPolyIndex) return; // Active polygon rendered below
          const draped = getDrapedPolygon3DPoints(poly.volumePoints, true);
          let sPoints = "";
          for (const pt of draped) {
            const sp = projectToScreen(pt, cachedRect);
            if (!sp.isBehind && sp.z <= 1) {
              sPoints += `${sp.x.toFixed(1)},${sp.y.toFixed(1)} `;
            }
          }
          if (sPoints.trim()) {
            const polyEl = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
            polyEl.setAttribute("points", sPoints.trim());
            polyEl.setAttribute("fill", "rgba(94, 25, 234, 0.08)");
            polyEl.setAttribute("stroke", "#8b5cf6");
            polyEl.setAttribute("stroke-width", "1.6");
            polyEl.setAttribute("stroke-dasharray", "4,3");
            polyEl.setAttribute("stroke-linejoin", "round");
            polyEl.style.cursor = "pointer";
            polyEl.style.pointerEvents = "auto";
            polyEl.addEventListener("click", () => {
              toggleKmlPolygonAccordion(pIdx, true);
            });
            secondaryGroup.appendChild(polyEl);
          }
        });
      }
    }

    // Render primary anchor dots on user-clicked vertices
    for (const p of state.volumePoints) {
      const screenP = projectToScreen(p.point, cachedRect);
      if (!screenP.isBehind && screenP.z <= 1 && volumeVerticesSvg) {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", screenP.x.toFixed(1));
        circle.setAttribute("cy", screenP.y.toFixed(1));
        circle.setAttribute("r", "4");
        circle.setAttribute("fill", "#5e19ea");
        circle.setAttribute("stroke", "#ffffff");
        circle.setAttribute("stroke-width", "1.5");
        volumeVerticesSvg.appendChild(circle);
      }
    }

    const isClosed = state.measureState === "FINISHED_VOLUME" && state.volumePoints.length >= 3;
    const activePoints = (state.measureState === "SELECTING" && state.volumeMousePoint)
      ? [...state.volumePoints, { point: state.volumeMousePoint, coord: state.volumeMousePoint }]
      : state.volumePoints;

    // Project terrain-draped points along the polygon perimeter
    const drapedPts = getDrapedPolygon3DPoints(activePoints, isClosed);
    for (const pt of drapedPts) {
      const sp = projectToScreen(pt, cachedRect);
      if (!sp.isBehind && sp.z <= 1) {
        pointsAttr += `${sp.x.toFixed(1)},${sp.y.toFixed(1)} `;
      }
    }

    if (volumePolygonHalo) {
      volumePolygonHalo.style.display = "block";
      volumePolygonHalo.setAttribute("points", pointsAttr.trim());
    }
    if (volumePolygonSvg) {
      volumePolygonSvg.style.display = "block";
      volumePolygonSvg.setAttribute("points", pointsAttr.trim());
      volumePolygonSvg.setAttribute("fill", "rgba(94, 25, 234, 0.20)");
      volumePolygonSvg.style.fill = "rgba(94, 25, 234, 0.20)";
    }
    if (volumeVerticesSvg) volumeVerticesSvg.style.display = "block";
    if (volumeSvg) volumeSvg.style.display = "block";
  } else {
    if (secondaryGroup) secondaryGroup.innerHTML = "";
    if (volumePolygonHalo) volumePolygonHalo.style.display = "none";
    if (volumePolygonSvg) volumePolygonSvg.style.display = "none";
    if (volumeVerticesSvg) volumeVerticesSvg.style.display = "none";
    if (volumeSvg) volumeSvg.style.display = "none";
  }
}

export function resetMultiVolumeState() {
  state.multiKmlPolygons = [];
  state.activeKmlPolyIndex = 0;
  state.expandedKmlPolyIndex = -1;
  state.isMultiSaveMode = false;
  const accordionContainer = document.getElementById("multiVolumeAccordionContainer");
  const singleContainer = document.getElementById("singleVolumeMetricsContainer");
  const cardsList = document.getElementById("multiVolumeCardsList");
  if (accordionContainer) accordionContainer.classList.add("hidden");
  if (singleContainer) singleContainer.classList.remove("hidden");
  if (cardsList) cardsList.innerHTML = "";
  const secondaryGroup = document.getElementById("volumeSecondaryPolygonsGroup");
  if (secondaryGroup) secondaryGroup.innerHTML = "";
}

export function resetVolumeKmlBadge() {
  state.uploadedVolumeFileName = "";
  resetMultiVolumeState();
  const volumeKmlBadge = document.getElementById("volumeKmlBadge");
  const volumeKmlUpload = document.getElementById("volumeKmlUpload");
  if (volumeKmlBadge) volumeKmlBadge.classList.add("hidden");
  if (volumeKmlUpload) volumeKmlUpload.value = "";
}

export function renderMultiVolumeUIState() {
  const hintBanner = document.getElementById("multiVolSelectHintBanner");
  const selectActions = document.getElementById("multiVolSelectActions");
  const normalActions = document.getElementById("multiVolNormalActions");
  const batchActiveActions = document.getElementById("multiVolBatchActiveActions");
  const selectedBadge = document.getElementById("multiVolSelectedBadge");
  const batchBtnText = document.getElementById("btnMultiVolumeBatchSaveText");
  const batchBtn = document.getElementById("btnMultiVolumeBatchSave");

  const selectedCount = state.multiKmlPolygons ? state.multiKmlPolygons.filter(p => p.selected).length : 0;

  if (state.isMultiSaveMode) {
    if (hintBanner) hintBanner.classList.remove("hidden");
    if (selectActions) selectActions.classList.remove("hidden");
    if (normalActions) normalActions.classList.add("hidden");
    if (batchActiveActions) batchActiveActions.classList.remove("hidden");
    if (selectedBadge) selectedBadge.textContent = `${selectedCount} selected`;
    if (batchBtnText) batchBtnText.textContent = `Save Selected (${selectedCount})`;
    if (batchBtn) {
      batchBtn.disabled = (selectedCount === 0);
      batchBtn.style.opacity = selectedCount === 0 ? "0.5" : "1";
      batchBtn.style.cursor = selectedCount === 0 ? "not-allowed" : "pointer";
    }
  } else {
    if (hintBanner) hintBanner.classList.add("hidden");
    if (selectActions) selectActions.classList.add("hidden");
    if (normalActions) normalActions.classList.remove("hidden");
    if (batchActiveActions) batchActiveActions.classList.add("hidden");
  }

  // Update each card's visual state
  document.querySelectorAll(".multi-vol-card").forEach(c => {
    const cIdx = parseInt(c.getAttribute("data-idx"), 10);
    const isExpanded = (cIdx === state.expandedKmlPolyIndex);
    const isActive = (cIdx === state.activeKmlPolyIndex);

    c.style.borderColor = isActive ? "#5e19ea" : "rgba(94, 25, 234, 0.12)";
    c.style.boxShadow = isActive ? "0 3px 10px rgba(94, 25, 234, 0.12)" : "0 1px 3px rgba(0,0,0,0.03)";

    const header = c.querySelector(".multi-vol-card-header");
    if (header) {
      header.style.background = isExpanded ? "rgba(94, 25, 234, 0.05)" : (isActive ? "rgba(94, 25, 234, 0.02)" : "#ffffff");
    }

    const cbWrapper = c.querySelector(".multi-vol-cb-wrapper");
    if (cbWrapper) {
      cbWrapper.style.display = state.isMultiSaveMode ? "flex" : "none";
    }

    const dot = c.querySelector(".multi-vol-active-dot");
    if (dot) {
      dot.style.display = (!state.isMultiSaveMode && isActive) ? "inline-block" : "none";
    }

    const body = c.querySelector(".multi-vol-card-body");
    if (body) {
      body.style.display = isExpanded ? "flex" : "none";
    }

    const chev = c.querySelector(".multi-vol-chevron");
    if (chev) {
      chev.style.transform = isExpanded ? "rotate(0deg)" : "rotate(-90deg)";
    }
  });
}

export function toggleKmlPolygonAccordion(idx, forceFly = false) {
  if (!state.multiKmlPolygons || !state.multiKmlPolygons[idx]) return;

  if (state.expandedKmlPolyIndex === idx && !forceFly) {
    state.expandedKmlPolyIndex = -1;
  } else {
    state.expandedKmlPolyIndex = idx;
    selectKmlPolygon(idx, true);
  }
  renderMultiVolumeUIState();

  if (state.expandedKmlPolyIndex === idx) {
    setTimeout(() => {
      const activeCard = document.querySelector(`.multi-vol-card[data-idx="${idx}"]`);
      if (activeCard) {
        activeCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }, 60);
  }
}

export function selectKmlPolygon(idx, flyTo = true) {
  if (!state.multiKmlPolygons || !state.multiKmlPolygons[idx]) return;
  state.activeKmlPolyIndex = idx;
  const poly = state.multiKmlPolygons[idx];

  state.volumePoints = poly.volumePoints;

  const areaEl = document.getElementById("volMiniArea");
  const perimEl = document.getElementById("volMiniPerim");
  const cutEl = document.getElementById("volMiniCut");
  const fillEl = document.getElementById("volMiniFill");
  const netEl = document.getElementById("volMiniNet");

  if (areaEl) areaEl.textContent = poly.metrics.area2D;
  if (perimEl) perimEl.textContent = poly.metrics.perimeter;
  if (cutEl) cutEl.textContent = poly.metrics.cutVolume;
  if (fillEl) fillEl.textContent = poly.metrics.fillVolume;
  if (netEl) {
    netEl.textContent = poly.metrics.netVolume;
    netEl.style.color = poly.metrics.netVolumeNum >= 0 ? "#10b981" : "#ef4444";
  }

  if (flyTo) {
    setCameraTopDown(poly.center.cx, poly.center.cy, poly.center.span * 1.3, true);
  }

  updateVolumeSvg();
  requestAnimationFrame(() => {
    if (state.instance?.view?.camera) state.instance.view.camera.updateMatrixWorld(true);
    updateVolumeSvg();
  });
}

export function buildMultiVolumeAccordion() {
  const accordionContainer = document.getElementById("multiVolumeAccordionContainer");
  const singleContainer = document.getElementById("singleVolumeMetricsContainer");
  const cardsList = document.getElementById("multiVolumeCardsList");
  const countTitle = document.getElementById("multiVolumeCountTitle");

  if (accordionContainer) accordionContainer.classList.remove("hidden");
  if (singleContainer) singleContainer.classList.add("hidden");
  if (countTitle && state.multiKmlPolygons) {
    countTitle.textContent = `${state.multiKmlPolygons.length} Areas Detected`;
  }

  state.isMultiSaveMode = false;
  state.expandedKmlPolyIndex = 0;

  syncFolderDropdowns("VOLUME");

  if (!cardsList || !state.multiKmlPolygons) return;
  cardsList.innerHTML = "";

  state.multiKmlPolygons.forEach((poly, idx) => {
    if (typeof poly.selected !== "boolean") poly.selected = true;
    if (!poly.name) poly.name = `Area ${idx + 1}`;

    const card = document.createElement("div");
    card.className = "multi-vol-card";
    card.setAttribute("data-idx", idx);
    card.style.cssText = `
      background: #ffffff;
      border: 1.5px solid rgba(94, 25, 234, 0.12);
      border-radius: 8px;
      overflow: hidden;
      transition: all 0.2s ease;
      box-shadow: 0 1px 3px rgba(0,0,0,0.03);
    `;

    const netColor = (poly.metrics?.netVolumeNum >= 0) ? "#10b981" : "#ef4444";
    const netDisplay = poly.metrics?.netVolume || "0 m³";

    card.innerHTML = `
      <div class="multi-vol-card-header" style="
        padding: 8px 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        user-select: none;
        transition: background 0.2s ease;
      ">
        <div style="display: flex; align-items: center; gap: 7px; min-width: 0; flex: 1;">
          <div class="multi-vol-cb-wrapper" style="display: none; align-items: center; flex-shrink: 0;">
            <input type="checkbox" class="multi-vol-cb" data-idx="${idx}" ${poly.selected ? "checked" : ""} style="accent-color: #5e19ea; width: 15px; height: 15px; cursor: pointer;" />
          </div>
          <span class="multi-vol-active-dot" style="display: none; width: 6px; height: 6px; border-radius: 50%; background: #5e19ea; flex-shrink: 0; box-shadow: 0 0 6px #5e19ea;"></span>
          <span class="multi-vol-title-text" style="font-size: 12px; font-weight: 600; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">#${idx + 1} ${poly.name}</span>
        </div>

        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
          <span class="multi-vol-net-pill" style="font-size: 11px; font-weight: 700; color: ${netColor}; background: rgba(94, 25, 234, 0.06); padding: 2px 6px; border-radius: 6px;">${netDisplay}</span>
          <svg class="multi-vol-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2.5" style="transition: transform 0.2s ease; transform: rotate(-90deg);"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </div>
      </div>

      <div class="multi-vol-card-body" style="
        display: none;
        flex-direction: column;
        gap: 7px;
        padding: 10px 10px 14px 10px;
        border-top: 1px solid rgba(94, 25, 234, 0.08);
        background: #fbfaff;
      ">
        <div>
          <label style="display: block; font-size: 10px; font-weight: 600; color: #64748b; margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.3px;">Area Name</label>
          <input type="text" class="multi-vol-name-input input" data-idx="${idx}" value="${poly.name}" placeholder="Area Name" style="width: 100%; box-sizing: border-box; padding: 5px 8px; font-size: 12px; border-radius: 6px; border: 1px solid #cbd5e1; background: #ffffff;" />
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px; font-size: 11.5px;">
          <div style="display: flex; justify-content: space-between;"><span style="color: #64748b;">Area (2D):</span><strong style="color: #1e293b;">${poly.metrics?.area2D || "0 m²"}</strong></div>
          <div style="display: flex; justify-content: space-between;"><span style="color: #64748b;">Perimeter:</span><strong style="color: #1e293b;">${poly.metrics?.perimeter || "0 m"}</strong></div>
          <div style="display: flex; justify-content: space-between; border-top: 1px solid rgba(0,0,0,0.06); padding-top: 4px;"><span style="color: #10b981; font-weight: 600;">Cut:</span><strong style="color: #10b981;">${poly.metrics?.cutVolume || "0 m³"}</strong></div>
          <div style="display: flex; justify-content: space-between;"><span style="color: #ef4444; font-weight: 600;">Fill:</span><strong style="color: #ef4444;">${poly.metrics?.fillVolume || "0 m³"}</strong></div>
          <div style="display: flex; justify-content: space-between; border-top: 1px dashed rgba(94, 25, 234, 0.25); padding-top: 5px; margin-top: 2px;"><span style="color: #5e19ea; font-weight: 700;">Net Volume:</span><strong style="color: #5e19ea; font-weight: 800;">${poly.metrics?.netVolume || "0 m³"}</strong></div>
        </div>
      </div>
    `;

    const header = card.querySelector(".multi-vol-card-header");
    const cb = card.querySelector(".multi-vol-cb");
    const nameInput = card.querySelector(".multi-vol-name-input");

    cb?.addEventListener("click", (e) => {
      e.stopPropagation();
      poly.selected = cb.checked;
      renderMultiVolumeUIState();
    });

    nameInput?.addEventListener("input", (e) => {
      const val = e.target.value.trim();
      poly.name = val || `Area ${idx + 1}`;
      const titleEl = card.querySelector(".multi-vol-title-text");
      if (titleEl) titleEl.textContent = `#${idx + 1} ${poly.name}`;
    });

    header?.addEventListener("click", () => {
      toggleKmlPolygonAccordion(idx);
    });

    cardsList.appendChild(card);
  });

  renderMultiVolumeUIState();
}

export function parseKmlCoordinatesString(coordsStr) {
  if (!coordsStr) return null;
  const pointStrings = coordsStr.trim().split(/\s+/);
  const pts = [];
  for (const pt of pointStrings) {
    if (!pt.trim()) continue;
    const parts = pt.split(",");
    if (parts.length >= 2) {
      const lon = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      if (isNaN(lon) || isNaN(lat)) continue;

      let x, y;
      if (Math.abs(lon) <= 180 && Math.abs(lat) <= 90) {
        [x, y] = proj4("WGS84", "EPSG:3395", [lon, lat]);
      } else {
        x = lon;
        y = lat;
      }
      pts.push({ x, y });
    }
  }
  // Remove duplicate closing point if present
  if (pts.length >= 4) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 0.05) {
      pts.pop();
    }
  }
  return pts.length >= 3 ? pts : null;
}

export function extractAllPolygonsFromKml(xmlDoc) {
  const list = [];

  const placemarks = xmlDoc.getElementsByTagName("Placemark");
  if (placemarks && placemarks.length > 0) {
    for (let p = 0; p < placemarks.length; p++) {
      const pm = placemarks[p];
      const nameTag = pm.getElementsByTagName("name")[0];
      const pmName = nameTag ? nameTag.textContent.trim() : "";

      const polys = pm.getElementsByTagName("Polygon");
      for (let k = 0; k < polys.length; k++) {
        const polyEl = polys[k];
        const outer = polyEl.getElementsByTagName("outerBoundaryIs")[0];
        const coordsTag = outer ? outer.getElementsByTagName("coordinates")[0] : polyEl.getElementsByTagName("coordinates")[0];
        if (coordsTag) {
          const pts = parseKmlCoordinatesString(coordsTag.textContent);
          if (pts) {
            list.push({
              name: pmName || `Area ${list.length + 1}`,
              coords: pts
            });
          }
        }
      }
    }
  }

  if (list.length === 0) {
    const polys = xmlDoc.getElementsByTagName("Polygon");
    for (let k = 0; k < polys.length; k++) {
      const polyEl = polys[k];
      const outer = polyEl.getElementsByTagName("outerBoundaryIs")[0];
      const coordsTag = outer ? outer.getElementsByTagName("coordinates")[0] : polyEl.getElementsByTagName("coordinates")[0];
      if (coordsTag) {
        const pts = parseKmlCoordinatesString(coordsTag.textContent);
        if (pts) {
          list.push({
            name: `Area ${list.length + 1}`,
            coords: pts
          });
        }
      }
    }
  }

  if (list.length === 0) {
    const rings = xmlDoc.getElementsByTagName("LinearRing");
    for (let r = 0; r < rings.length; r++) {
      const coordsTag = rings[r].getElementsByTagName("coordinates")[0];
      if (coordsTag) {
        const pts = parseKmlCoordinatesString(coordsTag.textContent);
        if (pts) {
          list.push({
            name: `Area ${list.length + 1}`,
            coords: pts
          });
        }
      }
    }
  }

  return list;
}

export function computeSinglePolygonVolumeData(coords, name) {
  const map = state.map;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const volPoints = [];

  for (const pt of coords) {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;

    let z = state.activeProject?.zOffset || 0;
    if (map && typeof map.getElevationFast === "function") {
      const sample = map.getElevationFast(pt.x, pt.y);
      if (sample && sample.elevation !== undefined && !isNaN(sample.elevation)) {
        z = sample.elevation;
      }
    }

    volPoints.push({
      point: new Vector3(pt.x, pt.y, z),
      coord: new Coordinates(giroCrs, pt.x, pt.y, z)
    });
  }

  let perimeter = 0;
  let sumElevation = 0;
  const cList = volPoints.map(p => p.coord);

  for (let i = 0; i < cList.length; i++) {
    const p1 = cList[i];
    const p2 = cList[(i + 1) % cList.length];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;

    const sample1 = map?.getElevationFast(p1.x, p1.y);
    const z1 = sample1 ? sample1.elevation : 0;
    const sample2 = map?.getElevationFast(p2.x, p2.y);
    const z2 = sample2 ? sample2.elevation : 0;

    const dz = z2 - z1;
    perimeter += Math.sqrt(dx * dx + dy * dy + dz * dz);
    sumElevation += z1;
  }
  const referenceElevation = sumElevation / cList.length;

  let area2D = 0;
  for (let i = 0; i < cList.length; i++) {
    const p1 = cList[i];
    const p2 = cList[(i + 1) % cList.length];
    area2D += p1.x * p2.y - p2.x * p1.y;
  }
  area2D = Math.abs(area2D) / 2;

  const gridStep = 1.0;
  let cutVolume = 0;
  let fillVolume = 0;

  function pointInPoly(px, py, poly) {
    let isInside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) isInside = !isInside;
    }
    return isInside;
  }

  for (let x = minX; x <= maxX; x += gridStep) {
    for (let y = minY; y <= maxY; y += gridStep) {
      if (pointInPoly(x, y, cList)) {
        const sample = map?.getElevationFast(x, y);
        const z = sample ? sample.elevation : 0;
        const diff = z - referenceElevation;
        if (diff > 0) {
          cutVolume += diff * (gridStep * gridStep);
        } else {
          fillVolume += Math.abs(diff) * (gridStep * gridStep);
        }
      }
    }
  }

  const netVolume = cutVolume - fillVolume;
  const netSign = netVolume >= 0 ? "+" : "";

  return {
    name,
    coords,
    volumePoints: volPoints,
    minX, maxX, minY, maxY,
    center: {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      span: Math.max(maxX - minX, maxY - minY, 15)
    },
    metrics: {
      area2DNum: area2D,
      area2D: area2D.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " m²",
      perimeter: perimeter.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " m",
      cutVolume: cutVolume.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " m³",
      fillVolume: fillVolume.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " m³",
      netVolume: `${netSign}${netVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })} m³`,
      netVolumeNum: netVolume,
      coords: cList
    }
  };
}

export async function processVolumeKmlFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".kml") && !file.name.toLowerCase().endsWith(".xml")) {
    await showCustomAlert("Please select a valid .kml or .xml boundary file.", "Invalid File", "warning");
    return;
  }

  const volumeKmlBadge = document.getElementById("volumeKmlBadge");
  const volumeKmlBadgeText = document.getElementById("volumeKmlBadgeText");
  const volumeHint = document.getElementById("volumeHint");
  const btnDrawVolume = document.getElementById("btnDrawVolume");
  const btnDrawVolumeText = document.getElementById("btnDrawVolumeText");
  const btnFinishVolume = document.getElementById("btnFinishVolume");
  const btnClearVolume = document.getElementById("btnClearVolume");
  const volumeKmlUpload = document.getElementById("volumeKmlUpload");

  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const text = ev.target.result;
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, "text/xml");

      const parseError = xmlDoc.getElementsByTagName("parsererror");
      if (parseError && parseError.length > 0) {
        await showCustomAlert("The selected file is not a valid XML/KML document.", "Parse Error", "error");
        return;
      }

      const rawPolygons = extractAllPolygonsFromKml(xmlDoc);
      if (!rawPolygons || rawPolygons.length === 0) {
        await showCustomAlert("No closed polygon boundary coordinates found in this KML file.", "Coordinates Missing", "warning");
        return;
      }

      resetRoiState();
      clearAllLeftPanelState(true);
      resetMultiVolumeState();

      state.multiKmlPolygons = rawPolygons.map((p, idx) => {
        const polyName = p.name || `Area ${idx + 1}`;
        return computeSinglePolygonVolumeData(p.coords, polyName);
      });

      state.uploadedVolumeFileName = file.name.replace(/\.[^/.]+$/, "");

      state.measureMode = "VOLUME";
      state.measureState = "FINISHED_VOLUME";
      if (state.controls) state.controls.enabled = true;
      document.body.classList.remove("roi-selecting");

      if (btnDrawVolume) {
        btnDrawVolume.classList.remove("active");
        if (btnDrawVolumeText) btnDrawVolumeText.textContent = "Draw Area";
        else btnDrawVolume.textContent = "Draw Area";
      }
      if (btnFinishVolume) btnFinishVolume.classList.add("hidden");
      if (btnClearVolume) btnClearVolume.disabled = false;

      if (state.multiKmlPolygons.length > 1) {
        if (volumeKmlBadge && volumeKmlBadgeText) {
          volumeKmlBadgeText.textContent = `${file.name} (${state.multiKmlPolygons.length} areas)`;
          volumeKmlBadge.classList.remove("hidden");
        }
        if (volumeHint) {
          volumeHint.textContent = `KML loaded (${state.multiKmlPolygons.length} areas). Expand any area in the Info Panel to inspect & name.`;
        }

        buildMultiVolumeAccordion();

        let overallMinX = Infinity, overallMaxX = -Infinity, overallMinY = Infinity, overallMaxY = -Infinity;
        state.multiKmlPolygons.forEach(p => {
          if (p.minX < overallMinX) overallMinX = p.minX;
          if (p.maxX > overallMaxX) overallMaxX = p.maxX;
          if (p.minY < overallMinY) overallMinY = p.minY;
          if (p.maxY > overallMaxY) overallMaxY = p.maxY;
        });
        const cx = (overallMinX + overallMaxX) / 2;
        const cy = (overallMinY + overallMaxY) / 2;
        const span = Math.max(overallMaxX - overallMinX, overallMaxY - overallMinY, 120);
        setCameraTopDown(cx, cy, span * 1.3);

        selectKmlPolygon(0, false);
        showUnifiedInfoPanel("VOLUME", "MULTI-AREA VOLUME", state.multiKmlPolygons[0].metrics);
      } else {
        const singlePoly = state.multiKmlPolygons[0];
        state.volumePoints = singlePoly.volumePoints;
        if (volumeKmlBadge && volumeKmlBadgeText) {
          volumeKmlBadgeText.textContent = `${file.name} (${singlePoly.coords.length} pts)`;
          volumeKmlBadge.classList.remove("hidden");
        }
        if (volumeHint) volumeHint.textContent = `KML loaded (${singlePoly.coords.length} points). Volume analysis complete.`;

        setCameraTopDown(singlePoly.center.cx, singlePoly.center.cy, singlePoly.center.span * 1.3);
        updateVolumeSvg();
        calculateVolumeMetrics();
      }

      state.volumeMousePoint = null;
      requestAnimationFrame(() => {
        if (state.instance?.view?.camera) state.instance.view.camera.updateMatrixWorld(true);
        updateVolumeSvg();
      });

    } catch (err) {
      console.error("Error processing volume KML file:", err);
      await showCustomAlert("Failed to parse KML file: " + err.message, "Upload Error", "error");
    }
  };
  reader.onerror = async () => {
    await showCustomAlert("Failed to read the selected file.", "File Read Error", "error");
  };
  reader.readAsText(file);
  if (volumeKmlUpload) volumeKmlUpload.value = "";
}

/** Initialize Volume Analysis Tool UI bindings */
export function initVolumeUI() {
  const btnDrawVolume = document.getElementById("btnDrawVolume");
  const btnDrawVolumeText = document.getElementById("btnDrawVolumeText");
  const btnUploadVolumeKml = document.getElementById("btnUploadVolumeKml");
  const volumeKmlUpload = document.getElementById("volumeKmlUpload");
  const btnRemoveVolumeKml = document.getElementById("btnRemoveVolumeKml");
  const btnClearVolume = document.getElementById("btnClearVolume");
  const btnFinishVolume = document.getElementById("btnFinishVolume");
  const volumeHint = document.getElementById("volumeHint");
  const volumeMiniContainer = document.getElementById("volumeMiniContainer");

  btnDrawVolume?.addEventListener("click", () => {
    resetRoiState();
    clearAllLeftPanelState(true);
    resetVolumeKmlBadge();
    state.measureState = "SELECTING";
    state.measureMode = "VOLUME";
    setLiveGuidance("📦", "Click points on the map to build volume polygon. Click Finish when done.");
    if (state.controls) state.controls.enabled = false;
    document.body.classList.add("roi-selecting");
    btnDrawVolume.classList.add("active");
    if (btnDrawVolumeText) btnDrawVolumeText.textContent = "Click map...";
    else btnDrawVolume.textContent = "Click map...";
    if (volumeHint) volumeHint.textContent = "Click points on the map. Click Finish when done.";
    if (btnClearVolume) btnClearVolume.disabled = false;
    if (btnFinishVolume) btnFinishVolume.classList.remove("hidden");

    if (state.controls) {
      const minPol = state.controls.minPolarAngle;
      const maxPol = state.controls.maxPolarAngle;
      state.controls.minPolarAngle = 0;
      state.controls.maxPolarAngle = 0;
      state.controls.update();
      state.controls.minPolarAngle = minPol;
      state.controls.maxPolarAngle = maxPol;
    }

    state.volumePoints = [];
    state.volumeMousePoint = null;
    updateVolumeSvg();
    if (volumeMiniContainer) volumeMiniContainer.classList.add("hidden");
  });

  btnUploadVolumeKml?.addEventListener("click", () => {
    volumeKmlUpload?.click();
  });

  ["dragenter", "dragover"].forEach(eventName => {
    btnUploadVolumeKml?.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      btnUploadVolumeKml.style.background = "rgba(94, 25, 234, 0.12)";
    });
  });
  ["dragleave", "drop"].forEach(eventName => {
    btnUploadVolumeKml?.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      btnUploadVolumeKml.style.background = "rgba(94, 25, 234, 0.04)";
    });
  });
  btnUploadVolumeKml?.addEventListener("drop", (e) => {
    const dt = e.dataTransfer;
    const files = dt?.files;
    if (files && files.length > 0) {
      processVolumeKmlFile(files[0]);
    }
  });

  volumeKmlUpload?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) {
      processVolumeKmlFile(file);
    }
  });

  btnRemoveVolumeKml?.addEventListener("click", (e) => {
    e.stopPropagation();
    resetVolumeKmlBadge();
    if (btnClearVolume) {
      btnClearVolume.disabled = false;
      btnClearVolume.click();
    }
  });

  btnClearVolume?.addEventListener("click", () => {
    setLiveGuidance(null, null);
    state.measureState = "IDLE";
    state.measureMode = "NONE";
    if (state.controls) state.controls.enabled = true;
    document.body.classList.remove("roi-selecting");
    if (btnDrawVolume) {
      btnDrawVolume.classList.remove("active");
      if (btnDrawVolumeText) btnDrawVolumeText.textContent = "Draw Area";
      else btnDrawVolume.textContent = "Draw Area";
    }
    if (btnFinishVolume) btnFinishVolume.classList.add("hidden");
    if (volumeHint) volumeHint.textContent = "Draw an area on the map or upload a KML boundary file to calculate cut/fill volumes.";

    resetVolumeKmlBadge();
    state.volumePoints = [];
    state.volumeMousePoint = null;
    updateVolumeSvg();
    if (volumeMiniContainer) volumeMiniContainer.classList.add("hidden");
    if (btnClearVolume) btnClearVolume.disabled = true;
  });

  btnFinishVolume?.addEventListener("click", () => {
    setLiveGuidance(null, null);
    if (state.measureMode !== "VOLUME") return;
    if (state.volumePoints.length < 3) {
      showCustomAlert("Please draw at least 3 points for a volume polygon.", "Incomplete Polygon", "warning");
      return;
    }
    state.measureState = "FINISHED_VOLUME";
    if (state.controls) state.controls.enabled = true;
    document.body.classList.remove("roi-selecting");
    if (btnDrawVolume) {
      btnDrawVolume.classList.remove("active");
      if (btnDrawVolumeText) btnDrawVolumeText.textContent = "Draw Area";
      else btnDrawVolume.textContent = "Draw Area";
    }
    if (btnFinishVolume) btnFinishVolume.classList.add("hidden");
    if (volumeHint) volumeHint.textContent = "Volume Analysis complete. Click 'Clear' to remove.";
    state.volumeMousePoint = null;
    updateVolumeSvg();
    calculateVolumeMetrics();
  });

  // Multi-Save Mode Toggles
  document.getElementById("btnEnterMultiSaveMode")?.addEventListener("click", () => {
    state.isMultiSaveMode = true;
    renderMultiVolumeUIState();
  });

  document.getElementById("btnCancelMultiSaveMode")?.addEventListener("click", () => {
    state.isMultiSaveMode = false;
    renderMultiVolumeUIState();
  });

  document.getElementById("btnMultiVolSelectAll")?.addEventListener("click", () => {
    if (!state.multiKmlPolygons) return;
    state.multiKmlPolygons.forEach(p => p.selected = true);
    document.querySelectorAll(".multi-vol-cb").forEach(cb => cb.checked = true);
    renderMultiVolumeUIState();
  });

  document.getElementById("btnMultiVolDeselectAll")?.addEventListener("click", () => {
    if (!state.multiKmlPolygons) return;
    state.multiKmlPolygons.forEach(p => p.selected = false);
    document.querySelectorAll(".multi-vol-cb").forEach(cb => cb.checked = false);
    renderMultiVolumeUIState();
  });

  document.getElementById("btnSaveSingleActiveArea")?.addEventListener("click", () => {
    state.volumeSaveMode = "SINGLE";
    state.activeInfoTool = "VOLUME";
    openUniversalSaveModal();
  });

  document.getElementById("btnMultiVolumeBatchSave")?.addEventListener("click", () => {
    if (!state.multiKmlPolygons || state.multiKmlPolygons.length === 0) return;
    const selected = state.multiKmlPolygons.filter(p => p.selected);
    if (selected.length === 0) {
      showCustomAlert("Please select at least one area to save.", "None Selected", "warning");
      return;
    }
    state.volumeSaveMode = "BATCH";
    state.activeInfoTool = "VOLUME";
    openUniversalSaveModal();
  });

  // Attach to window
  window.updateVolumeSvg = updateVolumeSvg;
  window.toggleKmlPolygonAccordion = toggleKmlPolygonAccordion;
  window.selectKmlPolygon = selectKmlPolygon;
  window.calculateVolumeMetrics = calculateVolumeMetrics;
}
