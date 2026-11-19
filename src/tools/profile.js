// src/tools/profile.js
// Elevation Path Profile, GeoTIFF COG Sampling, 3D Radar Beacons & Interactive Graph

import { Vector3 } from "three";
import { fromUrl } from "geotiff";
import { state, setLiveGuidance } from "../core/state.js";
import { projectToScreen } from "../core/camera.js";
import { resetRoiState } from "./roiState.js";
import { clearAllLeftPanelState } from "../services/clearState.js";
import { showUnifiedInfoPanel } from "../ui/infoPanel.js";
import { initCharts } from "./profileChart.js";
import { buildProfile3DPointsFromElevations } from "./drapedMath.js";
import { chattibhariatuConfig } from "../config/projects.js";

let elevationProfileDebounceTimer = null;

/** Returns the local 3D point along the profile corresponding to index */
export function getProfile3DPointAtIndex(index) {
  if (index == null || isNaN(index) || !state.currentProfileData || state.currentProfileData.length === 0) {
    return null;
  }
  const count = state.currentProfileData.length;
  const safeIdx = Math.max(0, Math.min(count - 1, index));
  const pt = state.currentProfileData[safeIdx];
  if (!pt) return null;

  const startZ = (state.measureStartPoint && typeof state.measureStartPoint.z === "number")
    ? state.measureStartPoint.z
    : (state.measureStartCoord?.z || 0);
  const endZ = (state.measureEndPoint && typeof state.measureEndPoint.z === "number")
    ? state.measureEndPoint.z
    : (state.measureEndCoord?.z || 0);

  const refX = state.instance?.reference?.x || 0;
  const refY = state.instance?.reference?.y || 0;

  const startLocal = state.measureStartPoint || {
    x: (state.measureStartCoord?.x || 0) - refX,
    y: (state.measureStartCoord?.y || 0) - refY,
    z: startZ
  };
  const endLocal = state.measureEndPoint || {
    x: (state.measureEndCoord?.x || 0) - refX,
    y: (state.measureEndCoord?.y || 0) - refY,
    z: endZ
  };

  const t = count > 1 ? safeIdx / (count - 1) : 0;
  const xLocal = startLocal.x + t * (endLocal.x - startLocal.x);
  const yLocal = startLocal.y + t * (endLocal.y - startLocal.y);
  const z = (pt.elev != null && !isNaN(pt.elev)) ? pt.elev : (startZ + t * (endZ - startZ));

  return new Vector3(xLocal, yLocal, z + 0.45);
}

/** Show 3D hover beacon along path profile */
export function showProfile3DHoverPoint(index) {
  if (index == null || isNaN(index)) return;
  state.currentProfileHover3DPoint = getProfile3DPointAtIndex(index);
  updateProfileHoverSvg();
}

/** Hide 3D hover beacon */
export function hideProfile3DHoverPoint() {
  state.currentProfileHover3DPoint = null;
  updateProfileHoverSvg();
}

/** Pin a specific station on profile and in 3D scene */
export function pinProfile3DPoint(index) {
  if (index == null || isNaN(index) || !state.currentProfileData || state.currentProfileData.length === 0) {
    clearProfilePinnedPoint();
    return;
  }
  const count = state.currentProfileData.length;
  const safeIdx = Math.max(0, Math.min(count - 1, index));
  state.currentProfilePinnedIndex = safeIdx;
  state.currentProfilePinned3DPoint = getProfile3DPointAtIndex(safeIdx);

  const pt = state.currentProfileData[safeIdx];
  const stationEl = document.getElementById("pinnedStationDist");
  const currentElevEl = document.getElementById("pinnedCurrentElev");
  const compRow = document.getElementById("pinnedComparisonRow");
  const pastLabel = document.getElementById("pinnedPastSurveyLabel");
  const pastElevEl = document.getElementById("pinnedPastElev");
  const diffEl = document.getElementById("pinnedDiffVal");

  if (stationEl) stationEl.textContent = `${(pt.dist || 0).toFixed(1)} m`;
  if (currentElevEl) currentElevEl.textContent = `${(pt.elev || 0).toFixed(2)} m`;

  if (state.currentProfileComparisonData?.pastElevs && state.currentProfileComparisonData.pastElevs[safeIdx] != null) {
    const pastElev = state.currentProfileComparisonData.pastElevs[safeIdx];
    const diff = pt.elev - pastElev;
    if (compRow) compRow.classList.remove("hidden");
    if (pastLabel) pastLabel.textContent = `${state.currentProfileComparisonData.label || "Past"}:`;
    if (pastElevEl) pastElevEl.textContent = `${pastElev.toFixed(2)} m`;
    if (diffEl) {
      const sign = diff >= 0 ? "+" : "";
      const tag = diff < 0 ? "Cut ⛏️" : "Fill 🏗️";
      diffEl.textContent = `${sign}${diff.toFixed(2)} m (${tag})`;
      diffEl.style.color = diff < 0 ? "#ef4444" : "#a855f7";
    }
  } else {
    if (compRow) compRow.classList.add("hidden");
  }

  updateProfilePinnedSvg();

  // Re-render charts to draw vertical pinned guideline & glowing halo
  if (state.miniChart) state.miniChart.update("none");
  if (state.fullChart) state.fullChart.update("none");
}

/** Clear pinned profile station HUD */
export function clearProfilePinnedPoint() {
  state.currentProfilePinnedIndex = null;
  state.currentProfilePinned3DPoint = null;
  const hud = document.getElementById("profilePinnedHud");
  const pinnedGroup = document.getElementById("measurePinnedGroup");
  if (hud) hud.classList.add("hidden");
  if (pinnedGroup) pinnedGroup.style.display = "none";
  if (state.miniChart) state.miniChart.update("none");
  if (state.fullChart) state.fullChart.update("none");
}

/** Update the 3D hover beacon SVG */
export function updateProfileHoverSvg() {
  const hoverGroup = document.getElementById("measureHoverGroup");
  const hoverCircle = document.getElementById("measureSvgHover");
  const hoverHalo = document.getElementById("measureSvgHoverHalo");
  const measureSvg = document.getElementById("measureSvg");
  if (!hoverGroup || !hoverCircle) return;

  if (!state.currentProfileHover3DPoint) {
    hoverGroup.style.display = "none";
    return;
  }

  const screenP = projectToScreen(state.currentProfileHover3DPoint);
  if (screenP.isBehind || screenP.z > 1) {
    hoverGroup.style.display = "none";
    return;
  }

  hoverCircle.setAttribute("cx", screenP.x.toFixed(1));
  hoverCircle.setAttribute("cy", screenP.y.toFixed(1));
  if (hoverHalo) {
    hoverHalo.setAttribute("cx", screenP.x.toFixed(1));
    hoverHalo.setAttribute("cy", screenP.y.toFixed(1));
  }
  hoverGroup.style.display = "block";
  if (measureSvg) measureSvg.style.display = "block";
}

/** Update the pinned station SVG and overlay card position */
export function updateProfilePinnedSvg() {
  const pinnedGroup = document.getElementById("measurePinnedGroup");
  const hud = document.getElementById("profilePinnedHud");
  const pulseCircle = document.getElementById("measureSvgPinnedPulse");
  const haloCircle = document.getElementById("measureSvgPinnedHalo");
  const coreCircle = document.getElementById("measureSvgPinned");
  const measureSvg = document.getElementById("measureSvg");

  if (!state.currentProfilePinned3DPoint) {
    if (pinnedGroup) pinnedGroup.style.display = "none";
    if (hud) hud.classList.add("hidden");
    return;
  }

  const screenP = projectToScreen(state.currentProfilePinned3DPoint);
  if (screenP.isBehind || screenP.z > 1) {
    if (pinnedGroup) pinnedGroup.style.display = "none";
    if (hud) hud.classList.add("hidden");
    return;
  }

  if (pulseCircle) {
    pulseCircle.setAttribute("cx", screenP.x.toFixed(1));
    pulseCircle.setAttribute("cy", screenP.y.toFixed(1));
  }
  if (haloCircle) {
    haloCircle.setAttribute("cx", screenP.x.toFixed(1));
    haloCircle.setAttribute("cy", screenP.y.toFixed(1));
  }
  if (coreCircle) {
    coreCircle.setAttribute("cx", screenP.x.toFixed(1));
    coreCircle.setAttribute("cy", screenP.y.toFixed(1));
  }
  if (pinnedGroup) pinnedGroup.style.display = "block";
  if (measureSvg) measureSvg.style.display = "block";

  if (hud) {
    hud.classList.remove("hidden");
    hud.style.left = `${screenP.x.toFixed(1)}px`;
    hud.style.top = `${screenP.y.toFixed(1)}px`;
  }
}

/** Sample past survey elevations along path profile from Cloud-Optimized GeoTIFF */
export async function sampleProfileFromGeoTIFF(url, points) {
  if (!url || !points || points.length === 0) return null;
  try {
    const fullUrl = url.startsWith("http")
      ? url
      : `https://polygon-giro3d.s3.ap-south-2.amazonaws.com/${url.replace(/^\.\//, "")}`;
    const tiff = await fromUrl(fullUrl);
    const img0 = await tiff.getImage(0);
    const origin = img0.getOrigin();
    const res = img0.getResolution();
    const origX = origin[0];
    const origY = origin[1];
    const resX = res[0];
    const resY = Math.abs(res[1]);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const pt of points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }

    const imgW0 = img0.getWidth();
    const imgH0 = img0.getHeight();

    const rawMinCol = Math.floor((minX - origX) / resX) - 2;
    const rawMaxCol = Math.ceil((maxX - origX) / resX) + 2;
    const rawMinRow = Math.floor((origY - maxY) / resY) - 2;
    const rawMaxRow = Math.ceil((origY - minY) / resY) + 2;

    if (rawMaxCol < 0 || rawMinCol >= imgW0 || rawMaxRow < 0 || rawMinRow >= imgH0) {
      return points.map(pt => pt.z || 0);
    }

    const minCol0 = Math.max(0, Math.min(imgW0 - 1, rawMinCol));
    const maxCol0 = Math.max(minCol0, Math.min(imgW0 - 1, rawMaxCol));
    const minRow0 = Math.max(0, Math.min(imgH0 - 1, rawMinRow));
    const maxRow0 = Math.max(minRow0, Math.min(imgH0 - 1, rawMaxRow));

    const winW0 = maxCol0 - minCol0 + 1;
    const winH0 = maxRow0 - minRow0 + 1;

    let targetImg = img0;
    let scale = 1;
    const imageCount = await tiff.getImageCount();
    let targetLevel = 0;

    while (targetLevel < imageCount - 1) {
      const w = Math.ceil(winW0 / scale);
      const h = Math.ceil(winH0 / scale);
      if (w * h <= 1500000) break;
      targetLevel++;
      scale *= 2;
    }

    if (targetLevel > 0) {
      targetImg = await tiff.getImage(targetLevel);
      scale = img0.getWidth() / targetImg.getWidth();
    }

    const targetW = targetImg.getWidth();
    const targetH = targetImg.getHeight();

    const winMinCol = Math.max(0, Math.min(targetW - 1, Math.floor(minCol0 / scale)));
    const winMaxCol = Math.max(winMinCol, Math.min(targetW - 1, Math.ceil(maxCol0 / scale)));
    const winMinRow = Math.max(0, Math.min(targetH - 1, Math.floor(minRow0 / scale)));
    const winMaxRow = Math.max(winMinRow, Math.min(targetH - 1, Math.ceil(maxRow0 / scale)));
    const winW = winMaxCol - winMinCol + 1;
    const winH = winMaxRow - winMinRow + 1;

    const rasters = await targetImg.readRasters({
      window: [winMinCol, winMinRow, winMaxCol + 1, winMaxRow + 1]
    });
    const rasterData = rasters[0];

    const sampledElevations = [];
    for (const pt of points) {
      const cImg = Math.floor((pt.x - origX) / (resX * scale));
      const rImg = Math.floor((origY - pt.y) / (resY * scale));
      const cWin = cImg - winMinCol;
      const rWin = rImg - winMinRow;

      if (cWin >= 0 && cWin < winW && rWin >= 0 && rWin < winH) {
        const val = rasterData[rWin * winW + cWin];
        if (val != null && !isNaN(val) && val > 0 && val < 2500) {
          sampledElevations.push(val);
          continue;
        }
      }
      sampledElevations.push(null);
    }

    for (let i = 0; i < sampledElevations.length; i++) {
      if (sampledElevations[i] === null) {
        const prev = i > 0 ? sampledElevations[i - 1] : null;
        let next = null;
        for (let j = i + 1; j < sampledElevations.length; j++) {
          if (sampledElevations[j] !== null) { next = sampledElevations[j]; break; }
        }
        sampledElevations[i] = prev ?? next ?? points[i].z ?? 0;
      }
    }

    return sampledElevations;
  } catch (err) {
    console.error("sampleProfileFromGeoTIFF error:", err);
    return points.map(pt => pt.z || 0);
  }
}

/** Update the elevation profile graph and high-density terrain points */
export function updateElevationProfile(isPreview = false) {
  const map = state.map;
  if (!state.measureStartCoord || !state.measureEndCoord || !map) {
    return;
  }

  const dx = state.measureEndCoord.x - state.measureStartCoord.x;
  const dy = state.measureEndCoord.y - state.measureStartCoord.y;
  const totalDist = Math.sqrt(dx * dx + dy * dy);
  if (totalDist < 1) {
    return;
  }

  // Ultra High-Density sampling: sample every 0.8 meters (min 60, max 400 points)
  const numSamples = Math.max(60, Math.min(400, Math.floor(totalDist / 0.8)));

  const distances = [];
  const elevations = [];
  state.currentProfileData = [];
  state.currentProfilePoints3D = [];

  const startZ = (state.measureStartPoint && typeof state.measureStartPoint.z === "number")
    ? state.measureStartPoint.z
    : (state.measureStartCoord.z || 0);
  const endZ = (state.measureEndPoint && typeof state.measureEndPoint.z === "number")
    ? state.measureEndPoint.z
    : (state.measureEndCoord.z || 0);

  const refX = state.instance?.reference?.x || 0;
  const refY = state.instance?.reference?.y || 0;

  const startLocal = state.measureStartPoint || {
    x: state.measureStartCoord.x - refX,
    y: state.measureStartCoord.y - refY,
    z: startZ
  };
  const endLocal = state.measureEndPoint || {
    x: state.measureEndCoord.x - refX,
    y: state.measureEndCoord.y - refY,
    z: endZ
  };

  for (let i = 0; i <= numSamples; i++) {
    const t = i / numSamples;
    const x = state.measureStartCoord.x + t * dx;
    const y = state.measureStartCoord.y + t * dy;
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
    state.currentProfileData.push({ dist: currentDist, elev: z, x, y, z });

    const svgStep = Math.max(1, Math.floor(numSamples / 80));
    if (i % svgStep === 0 || i === numSamples) {
      const xLocal = startLocal.x + t * (endLocal.x - startLocal.x);
      const yLocal = startLocal.y + t * (endLocal.y - startLocal.y);
      state.currentProfilePoints3D.push(new Vector3(xLocal, yLocal, z + 0.35));
    }
  }

  // Trigger 3D draped line update
  if (typeof window.updateMeasureSvg === "function") {
    window.updateMeasureSvg();
  }

  const elevChange = Math.abs(elevations[elevations.length - 1] - elevations[0]);
  const surfDist = state.currentProfileData.reduce((acc, curr, idx) => {
    if (idx === 0) return 0;
    const prev = state.currentProfileData[idx - 1];
    const dX = curr.x - prev.x;
    const dY = curr.y - prev.y;
    const dZ = curr.elev - prev.elev;
    return acc + Math.sqrt(dX * dX + dY * dY + dZ * dZ);
  }, 0);

  const profHoriz = document.getElementById("profileHoriz");
  const profVert = document.getElementById("profileVert");
  const prof3D = document.getElementById("profile3D");
  if (profHoriz) profHoriz.textContent = totalDist.toFixed(2) + " m";
  if (profVert) profVert.textContent = elevChange.toFixed(2) + " m";
  if (prof3D) prof3D.textContent = surfDist.toFixed(2) + " m";

  showUnifiedInfoPanel("PROFILE", "ELEVATION PATH PROFILE", {
    totalDist,
    elevChange,
    surfDist,
    distances,
    elevations,
    currentProfileData: state.currentProfileData
  });

  // Quick local profile update
  if (state.miniChart) {
    state.miniChart.data.labels = distances;
    state.miniChart.data.datasets[0].label = `Current (${state.activeProject?.displayName || "October 2026"})`;
    state.miniChart.data.datasets[0].data = elevations;
    if (!state.isIbmProfileComparison && state.miniChart.data.datasets.length > 1) {
      state.miniChart.data.datasets.splice(1, 1);
    }
    state.miniChart.resize();
    state.miniChart.update("none");
  }

  if (isPreview) return;

  // Debounced Final Evaluation
  clearTimeout(elevationProfileDebounceTimer);
  elevationProfileDebounceTimer = setTimeout(async () => {
    initCharts();
    if (state.miniChart) {
      state.miniChart.data.labels = distances;
      state.miniChart.data.datasets[0].label = `Current (${state.activeProject?.displayName || "October 2026"})`;
      state.miniChart.data.datasets[0].data = elevations;
      if (!state.isIbmProfileComparison && state.miniChart.data.datasets.length > 1) {
        state.miniChart.data.datasets.splice(1, 1);
      }
      state.miniChart.resize();
      state.miniChart.update("none");
    }

    const elevationModal = document.getElementById("elevationModal");
    if (elevationModal && !elevationModal.classList.contains("hidden") && state.fullChart) {
      state.fullChart.data.labels = distances;
      state.fullChart.data.datasets[0].label = `Current (${state.activeProject?.displayName || "October 2026"})`;
      state.fullChart.data.datasets[0].data = elevations;
      if (!state.isIbmProfileComparison && state.fullChart.data.datasets.length > 1) {
        state.fullChart.data.datasets.splice(1, 1);
        if (state.fullChart.options?.plugins) state.fullChart.options.plugins.legend = { display: false };
      }
      state.fullChart.update();
    }

    // IBM Multi-Temporal Profile Comparison Sampling (ONLY when in IBM comparison mode)
    const targetPastKey = (state.isIbmProfileComparison && state.ibmComparisonPastSurveyKey)
      ? state.ibmComparisonPastSurveyKey
      : null;

    if (targetPastKey) {
      const pastSurvey = chattibhariatuConfig.surveys?.[targetPastKey];
      if (pastSurvey && pastSurvey.elevationUrl) {
        setLiveGuidance("⏳", `Comparing with ${pastSurvey.displayName || targetPastKey}...`);
        try {
          const rawPastElevs = await sampleProfileFromGeoTIFF(pastSurvey.elevationUrl, state.currentProfileData);
          if (rawPastElevs && rawPastElevs.length > 0) {
            let pastElevs = rawPastElevs;
            if (pastElevs.length !== elevations.length) {
              pastElevs = [];
              for (let i = 0; i < elevations.length; i++) {
                const t = i / Math.max(1, elevations.length - 1);
                const pIdx = Math.min(rawPastElevs.length - 1, Math.round(t * (rawPastElevs.length - 1)));
                pastElevs.push(rawPastElevs[pIdx]);
              }
            }

            let maxCut = 0;
            let maxFill = 0;
            for (let i = 0; i < elevations.length; i++) {
              const cur = elevations[i];
              const past = pastElevs[i];
              if (cur != null && past != null) {
                const diff = cur - past;
                if (diff < -maxCut) maxCut = -diff;
                if (diff > maxFill) maxFill = diff;
              }
            }

            state.currentProfileComparisonData = {
              pastElevs,
              label: pastSurvey.displayName || targetPastKey,
              maxCut,
              maxFill
            };

            const compMetrics = document.getElementById("profileComparisonMetrics");
            const compName = document.getElementById("profileComparisonSurveyName");
            const maxCutEl = document.getElementById("profileMaxCut");
            const maxFillEl = document.getElementById("profileMaxFill");
            if (compMetrics) compMetrics.classList.remove("hidden");
            if (compName) compName.textContent = pastSurvey.displayName || targetPastKey;
            if (maxCutEl) maxCutEl.textContent = `${maxCut.toFixed(2)} m`;
            if (maxFillEl) maxFillEl.textContent = `${maxFill.toFixed(2)} m`;

            if (state.miniChart) {
              if (state.miniChart.data.datasets.length < 2) {
                state.miniChart.data.datasets.push({
                  label: `Past (${pastSurvey.displayName || targetPastKey})`,
                  data: pastElevs,
                  borderColor: "#ea580c",
                  borderDash: [5, 4],
                  fill: false,
                  tension: 0.25,
                  borderWidth: 2,
                  pointRadius: 0
                });
              } else {
                state.miniChart.data.datasets[1].label = `Past (${pastSurvey.displayName || targetPastKey})`;
                state.miniChart.data.datasets[1].data = pastElevs;
              }
              state.miniChart.resize();
              state.miniChart.update("none");
            }

            if (state.fullChart) {
              if (state.fullChart.data.datasets.length < 2) {
                state.fullChart.data.datasets.push({
                  label: `Past (${pastSurvey.displayName || targetPastKey})`,
                  data: pastElevs,
                  borderColor: "#ea580c",
                  borderDash: [6, 4],
                  fill: false,
                  tension: 0.25,
                  borderWidth: 2.2,
                  pointRadius: (ctx) => {
                    const index = ctx.dataIndex;
                    const count = ctx.dataset?.data?.length || 0;
                    if (index === 0 || index === count - 1) return 5.5;
                    return 0;
                  },
                  pointBackgroundColor: "#ea580c",
                  pointBorderColor: "#ffffff",
                  pointBorderWidth: 1.5,
                  pointHoverRadius: 6
                });
              } else {
                state.fullChart.data.datasets[1].label = `Past (${pastSurvey.displayName || targetPastKey})`;
                state.fullChart.data.datasets[1].data = pastElevs;
              }
              if (state.fullChart.options?.plugins) {
                state.fullChart.options.plugins.legend = {
                  display: true,
                  position: "top",
                  labels: { color: "#334155", font: { size: 11, weight: "600" } }
                };
              }
              state.fullChart.update();
            }

            setLiveGuidance("✅", `Profile compared against ${pastSurvey.displayName || targetPastKey}`);
          } else {
            setLiveGuidance(null, null);
          }
        } catch (compErr) {
          console.error("Comparison sampling error:", compErr);
          setLiveGuidance(null, null);
        }
      }
    } else {
      state.currentProfileComparisonData = null;
      if (state.miniChart && state.miniChart.data.datasets.length > 1) {
        state.miniChart.data.datasets.splice(1, 1);
        state.miniChart.update("none");
      }
      if (state.fullChart && state.fullChart.data.datasets.length > 1) {
        state.fullChart.data.datasets.splice(1, 1);
        if (state.fullChart.options?.plugins) state.fullChart.options.plugins.legend = { display: false };
        state.fullChart.update();
      }
      const compMetrics = document.getElementById("profileComparisonMetrics");
      if (compMetrics) compMetrics.classList.add("hidden");
      setLiveGuidance(null, null);
    }
  }, 100);
}

/** Initialize Path Profile Tool UI event listeners */
export function initProfileUI() {
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
  const elevationMiniContainer = document.getElementById("elevationMiniContainer");
  const elevationModal = document.getElementById("elevationModal");
  const btnCloseModal = document.getElementById("btnCloseModal");
  const closeMiniChartBtn = document.getElementById("closeMiniChartBtn");
  const ibmProfilePastSurveySelect = document.getElementById("ibmProfilePastSurveySelect");
  const btnIbmClearProfile = document.getElementById("btnIbmClearProfile");

  profileHeader?.addEventListener("click", () => {
    if (!profileSettings) return;
    const show = profileSettings.style.display === "none";
    profileSettings.style.display = show ? "block" : "none";
    if (profileCarrot) profileCarrot.textContent = show ? "▲" : "▼";
  });

  btnProfile?.addEventListener("click", () => {
    resetRoiState();
    clearAllLeftPanelState(true);

    // Generic Path Profile: Single current survey only (no past comparison)
    state.isIbmProfileComparison = false;
    state.ibmComparisonPastSurveyKey = null;
    state.currentProfileComparisonData = null;
    const compMetrics = document.getElementById("profileComparisonMetrics");
    if (compMetrics) compMetrics.classList.add("hidden");
    const pinnedCompRow = document.getElementById("pinnedComparisonRow");
    if (pinnedCompRow) pinnedCompRow.classList.add("hidden");

    state.measureState = "SELECTING";
    state.measureMode = "PROFILE";
    setLiveGuidance("📏", "Click on the map to place start point, then drag or tap end point.");
    window.measureHasFirstTap = false;
    if (state.controls) state.controls.enabled = false;
    document.body.classList.add("roi-selecting");
    btnProfile.classList.add("active");
    btnProfile.textContent = "Click to start";
    if (profileHint) profileHint.textContent = "Click on the map to place the start point, then drag or tap.";
    if (btnClearProfile) btnClearProfile.disabled = false;
    if (profileResults) profileResults.classList.remove("hidden");
    if (typeof window.clearMeasure === "function") window.clearMeasure();
    if (profileHoriz) profileHoriz.textContent = "0.00";
    if (profileVert) profileVert.textContent = "0.00";
    if (profile3D) profile3D.textContent = "0.00";
    if (elevationMiniContainer) elevationMiniContainer.classList.add("hidden");
  });

  btnClearProfile?.addEventListener("click", () => {
    setLiveGuidance(null, null);
    state.measureState = "IDLE";
    state.measureMode = "NONE";
    state.isIbmProfileComparison = false;
    state.ibmComparisonPastSurveyKey = null;
    state.currentProfileComparisonData = null;
    const compMetrics = document.getElementById("profileComparisonMetrics");
    if (compMetrics) compMetrics.classList.add("hidden");
    const pinnedCompRow = document.getElementById("pinnedComparisonRow");
    if (pinnedCompRow) pinnedCompRow.classList.add("hidden");
    if (state.controls) state.controls.enabled = true;
    document.body.classList.remove("roi-selecting");
    if (btnProfile) {
      btnProfile.classList.remove("active");
      btnProfile.textContent = "Draw Path Profile";
    }
    if (profileHint) profileHint.textContent = "Draw a line to generate a terrain profile graph and save report.";
    if (profileResults) profileResults.classList.add("hidden");
    if (typeof window.clearMeasure === "function") window.clearMeasure();
    if (elevationMiniContainer) elevationMiniContainer.classList.add("hidden");
    if (btnClearProfile) btnClearProfile.disabled = true;
  });

  document.getElementById("btnClosePinnedHud")?.addEventListener("click", (e) => {
    e.stopPropagation();
    clearProfilePinnedPoint();
  });

  elevationMiniContainer?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (elevationModal) elevationModal.classList.remove("hidden");
    initCharts();

    setTimeout(() => {
      if (state.fullChart) {
        const distances = (state.miniChart?.data?.labels?.length > 0)
          ? state.miniChart.data.labels
          : (state.currentProfileData ? state.currentProfileData.map(d => d.dist.toFixed(1)) : []);
        const elevations = (state.miniChart?.data?.datasets?.[0]?.data)
          ? state.miniChart.data.datasets[0].data
          : (state.currentProfileData ? state.currentProfileData.map(d => d.elev) : []);

        state.fullChart.data.labels = distances;
        state.fullChart.data.datasets[0].label = state.miniChart?.data?.datasets?.[0]?.label || `Current (${state.activeProject?.displayName || "October 2026"})`;
        state.fullChart.data.datasets[0].data = elevations;

        if (state.miniChart?.data?.datasets?.length > 1) {
          const pastDs = state.miniChart.data.datasets[1];
          if (state.fullChart.data.datasets.length < 2) {
            state.fullChart.data.datasets.push({
              label: pastDs.label,
              data: pastDs.data,
              borderColor: "#ea580c",
              borderDash: [6, 4],
              fill: false,
              tension: 0.25,
              borderWidth: 2.2,
              pointRadius: (ctx) => {
                const index = ctx.dataIndex;
                const count = ctx.dataset?.data?.length || 0;
                if (index === 0 || index === count - 1) return 5.5;
                return 0;
              },
              pointBackgroundColor: "#ea580c",
              pointBorderColor: "#ffffff",
              pointBorderWidth: 1.5,
              pointHoverRadius: 6
            });
          } else {
            state.fullChart.data.datasets[1].label = pastDs.label;
            state.fullChart.data.datasets[1].data = pastDs.data;
          }
          if (state.fullChart.options?.plugins) {
            state.fullChart.options.plugins.legend = {
              display: true,
              position: "top",
              labels: { color: "#334155", font: { size: 11, weight: "600" } }
            };
          }
        } else {
          if (state.fullChart.data.datasets.length > 1) {
            state.fullChart.data.datasets.splice(1, 1);
            if (state.fullChart.options?.plugins) state.fullChart.options.plugins.legend = { display: false };
          }
        }

        try {
          state.fullChart.resize();
          state.fullChart.update();
        } catch (err) {
          console.warn("fullChart resize error:", err);
        }
      }
    }, 150);
  });

  closeMiniChartBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (elevationMiniContainer) elevationMiniContainer.classList.add("hidden");
  });

  btnCloseModal?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (elevationModal) elevationModal.classList.add("hidden");
  });

  elevationModal?.addEventListener("click", (e) => {
    if (e.target === elevationModal) {
      elevationModal.classList.add("hidden");
    }
  });

  // Attach to window for global access
  window.updateElevationProfile = updateElevationProfile;
  window.clearProfilePinnedPoint = clearProfilePinnedPoint;
  window.showProfile3DHoverPoint = showProfile3DHoverPoint;
  window.hideProfile3DHoverPoint = hideProfile3DHoverPoint;
  window.pinProfile3DPoint = pinProfile3DPoint;
}
