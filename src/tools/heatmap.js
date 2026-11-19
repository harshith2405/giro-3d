// src/tools/heatmap.js
// IBM Multi-Temporal Elevation Difference Heatmap (ΔZ), COG Streaming & Solid Shaders

import { fromUrl } from "geotiff";
import Extent from "@giro3d/giro3d/core/geographic/Extent.js";
import StaticImageSource from "@giro3d/giro3d/sources/StaticImageSource.js";
import ColorLayer from "@giro3d/giro3d/core/layer/ColorLayer.js";
import { giroCrs } from "../config/crs.js";
import { state, setLiveGuidance } from "../core/state.js";
import { chattibhariatuConfig } from "../config/projects.js";
import { showCustomAlert } from "../ui/dialogs.js";
import { resetRoiState } from "./roiState.js";
import { clearAllLeftPanelState } from "../services/clearState.js";
import { clearMeasure } from "./measure.js";
import { updateElevationProfile } from "./profile.js";

/** Populate past survey dropdown lists for IBM multi-temporal comparisons */
export function populateIbmSurveys() {
  const profileSelect = document.getElementById("ibmProfilePastSurveySelect");
  const heatmapSelect = document.getElementById("ibmHeatmapPastSurveySelect");
  if (!profileSelect || !heatmapSelect) return;

  const urlParams = new URLSearchParams(window.location.search);
  const activeSurveyId = (state.activeProject?.surveyId || urlParams.get("survey") || "october_2026").toLowerCase();
  const activeBaseKey = activeSurveyId.replace(/_2026$/, "");

  const allSurveys = chattibhariatuConfig.surveys || {};

  profileSelect.innerHTML = '<option value="">Select past survey to compare...</option>';
  heatmapSelect.innerHTML = '<option value="">Select past survey...</option>';

  const surveyOrder = ["october_2026", "september_2026", "august_2026", "july_2026", "june_2026", "may_2026"];
  let firstPastKey = null;

  surveyOrder.forEach(key => {
    const sInfo = allSurveys[key];
    if (!sInfo) return;
    const keyBase = key.toLowerCase().replace(/_2026$/, "");

    // NEVER list the active survey in past comparison dropdowns
    if (key.toLowerCase() === activeSurveyId || keyBase === activeBaseKey) return;

    if (!firstPastKey) firstPastKey = key;

    const label = sInfo.displayName || key.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());

    const opt1 = document.createElement("option");
    opt1.value = key;
    opt1.textContent = label;
    profileSelect.appendChild(opt1);

    const opt2 = document.createElement("option");
    opt2.value = key;
    opt2.textContent = label;
    heatmapSelect.appendChild(opt2);
  });

  if (firstPastKey) {
    if (!profileSelect.value) profileSelect.value = firstPastKey;
    if (!heatmapSelect.value) heatmapSelect.value = firstPastKey;
  }
}

/** Clear active IBM path profile comparison state */
export function clearIbmProfileComparison() {
  state.isIbmProfileComparison = false;
  state.ibmComparisonPastSurveyKey = null;
  state.currentProfileComparisonData = null;

  const ibmProfilePastSurveySelect = document.getElementById("ibmProfilePastSurveySelect");
  const btnIbmStartProfileText = document.getElementById("btnIbmStartProfileText");
  const btnIbmClearProfile = document.getElementById("btnIbmClearProfile");
  const compMetrics = document.getElementById("profileComparisonMetrics");

  if (ibmProfilePastSurveySelect) ibmProfilePastSurveySelect.value = "";
  if (btnIbmStartProfileText) btnIbmStartProfileText.textContent = "Click 2 Points on Map";
  if (btnIbmClearProfile) btnIbmClearProfile.classList.add("hidden");
  if (compMetrics) compMetrics.classList.add("hidden");

  if (state.currentProfileData && state.currentProfileData.length > 0) {
    updateElevationProfile();
  } else {
    clearMeasure();
  }
  setLiveGuidance(null, null);
}

/** Render ΔZ heatmap pixel data onto high-speed HTML5 Canvas with 100% solid opacity */
export function renderDifferenceHeatmapCanvas(filterType = "all", customMin = null, customMax = null) {
  if (!state.cachedDiffHeatmapData || !state.diffCanvas) return;

  const { width, height, diffs, validMask } = state.cachedDiffHeatmapData;
  const ctx = state.diffCanvas.getContext("2d");
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  let totalVisible = 0;
  let totalCut = 0;
  let totalFill = 0;

  const minDiff = (customMin !== null && !isNaN(customMin)) ? customMin : 1.0;
  const maxDiff = (customMax !== null && !isNaN(customMax)) ? customMax : 100.0;

  for (let i = 0; i < diffs.length; i++) {
    const pIdx = i * 4;
    if (validMask[i] === 0) {
      data[pIdx + 3] = 0;
      continue;
    }

    const dZ = diffs[i];
    const absDZ = Math.abs(dZ);

    let isMatch = false;
    if (filterType === "all") isMatch = absDZ >= minDiff && absDZ <= maxDiff;
    else if (filterType === "1-2m") isMatch = absDZ >= 1.0 && absDZ < 2.0;
    else if (filterType === "2-5m") isMatch = absDZ >= 2.0 && absDZ < 5.0;
    else if (filterType === "5m+") isMatch = absDZ >= 5.0 && absDZ <= maxDiff;
    else if (filterType === "cut") isMatch = dZ <= -minDiff && dZ >= -maxDiff;
    else if (filterType === "fill") isMatch = dZ >= minDiff && dZ <= maxDiff;
    else if (filterType === "custom") isMatch = absDZ >= minDiff && absDZ <= maxDiff;

    if (!isMatch) {
      data[pIdx + 3] = 0; // 100% Transparent
      continue;
    }

    totalVisible++;

    if (dZ < 0) {
      totalCut++;
      // Continuous Cut Ramp: Amber (1m) -> Orange (2.5m) -> Crimson (5m) -> Burgundy (15m+)
      let r, g, b;
      if (absDZ <= 2.0) {
        const t = Math.max(0, Math.min(1, (absDZ - 1.0) / 1.0));
        r = Math.round(234 + t * (249 - 234));
        g = Math.round(179 + t * (115 - 179));
        b = Math.round(8 + t * (22 - 8));
      } else if (absDZ <= 5.0) {
        const t = (absDZ - 2.0) / 3.0;
        r = Math.round(249 + t * (239 - 249));
        g = Math.round(115 + t * (68 - 115));
        b = Math.round(22 + t * (68 - 22));
      } else {
        const t = Math.min(1.0, (absDZ - 5.0) / 10.0);
        r = Math.round(239 + t * (159 - 239));
        g = Math.round(68 + t * (18 - 68));
        b = Math.round(68 + t * (57 - 68));
      }
      data[pIdx] = r;
      data[pIdx + 1] = g;
      data[pIdx + 2] = b;
      data[pIdx + 3] = 255; // 100% solid opacity
    } else {
      totalFill++;
      // Continuous Fill Ramp: Mint (1m) -> Emerald -> Cyan (3m) -> Blue -> Purple (10m+)
      let r, g, b;
      if (absDZ <= 2.0) {
        const t = Math.max(0, Math.min(1, (absDZ - 1.0) / 1.0));
        r = Math.round(34 + t * (16 - 34));
        g = Math.round(197 + t * (185 - 197));
        b = Math.round(94 + t * (129 - 94));
      } else if (absDZ <= 5.0) {
        const t = (absDZ - 2.0) / 3.0;
        r = Math.round(16 + t * (59 - 16));
        g = Math.round(185 + t * (130 - 185));
        b = Math.round(129 + t * (246 - 129));
      } else {
        const t = Math.min(1.0, (absDZ - 5.0) / 10.0);
        r = Math.round(59 + t * (168 - 59));
        g = Math.round(130 + t * (85 - 130));
        b = Math.round(246 + t * (247 - 246));
      }
      data[pIdx] = r;
      data[pIdx + 1] = g;
      data[pIdx + 2] = b;
      data[pIdx + 3] = 255; // 100% solid opacity
    }
  }

  ctx.putImageData(imgData, 0, 0);

  const ibmHeatmapDiffSummaryBadge = document.getElementById("ibmHeatmapDiffSummaryBadge");
  if (ibmHeatmapDiffSummaryBadge) {
    if (filterType === "all") ibmHeatmapDiffSummaryBadge.textContent = `${totalVisible.toLocaleString()} px`;
    else if (filterType === "cut") ibmHeatmapDiffSummaryBadge.textContent = `Cut: ${totalCut.toLocaleString()} px`;
    else if (filterType === "fill") ibmHeatmapDiffSummaryBadge.textContent = `Fill: ${totalFill.toLocaleString()} px`;
    else if (filterType === "custom") ibmHeatmapDiffSummaryBadge.textContent = `${minDiff}m - ${maxDiff}m (${totalVisible.toLocaleString()} px)`;
    else ibmHeatmapDiffSummaryBadge.textContent = `${filterType.toUpperCase()}`;
  }
}

/** Refresh the Giro3D ColorLayer with flipY: false and proper opacity */
export async function refreshDiffLayerOnMap() {
  const map = state.map;
  if (!state.cachedDiffHeatmapData || !state.diffCanvas || !map) return;
  const extent = state.cachedDiffHeatmapData.extent;

  if (state.diffLayer) {
    try { map.removeLayer(state.diffLayer); } catch (e) {}
    state.diffLayer = null;
  }

  state.diffSource = new StaticImageSource({
    source: state.diffCanvas,
    extent: extent,
    flipY: false, // Strictly preserve flipY: false requirement
  });

  const opacitySlider = document.getElementById("ibmHeatmapOpacitySlider");
  const currentOpacity = opacitySlider ? (parseFloat(opacitySlider.value) / 100) : 1.0;

  state.diffLayer = new ColorLayer({
    name: "ElevationDifferenceHeatmap",
    extent: extent,
    source: state.diffSource,
    opacity: currentOpacity,
  });

  await map.addLayer(state.diffLayer);
  state.instance.notifyChange(state.diffLayer);

  const floatingHud = document.getElementById("heatmapFloatingHud");
  if (floatingHud) floatingHud.classList.remove("hidden");
}

/** Compute total-map sub-meter ΔZ difference grid from S3 GeoTIFF rasters */
export async function computeDifferenceHeatmap(pastSurveyKey) {
  const ibmHeatmapLoadingIndicator = document.getElementById("ibmHeatmapLoadingIndicator");
  const ibmHeatmapLoadingText = document.getElementById("ibmHeatmapLoadingText");
  const btnIbmComputeHeatmap = document.getElementById("btnIbmComputeHeatmap");
  const ibmHeatmapMinInput = document.getElementById("ibmHeatmapMinInput");
  const ibmHeatmapMaxInput = document.getElementById("ibmHeatmapMaxInput");
  const ibmHeatmapFiltersContainer = document.getElementById("ibmHeatmapFiltersContainer");
  const btnIbmClearHeatmap = document.getElementById("btnIbmClearHeatmap");

  try {
    if (ibmHeatmapLoadingIndicator) ibmHeatmapLoadingIndicator.classList.remove("hidden");
    if (ibmHeatmapLoadingText) ibmHeatmapLoadingText.textContent = "Connecting to S3 DTM Cloud-Optimized GeoTIFFs...";
    if (btnIbmComputeHeatmap) btnIbmComputeHeatmap.disabled = true;

    const currentElevationUrl = state.activeProject?.elevationUrl;
    const pastSurveyInfo = chattibhariatuConfig.surveys?.[pastSurveyKey];
    if (!pastSurveyInfo || !pastSurveyInfo.elevationUrl) {
      throw new Error("Selected past survey does not have valid elevation data.");
    }
    const pastElevationUrl = pastSurveyInfo.elevationUrl;

    const fullCurrentUrl = currentElevationUrl.startsWith("http")
      ? currentElevationUrl
      : `https://polygon-giro3d.s3.ap-south-2.amazonaws.com/${currentElevationUrl.replace(/^\.\//, "")}`;
    const fullPastUrl = pastElevationUrl.startsWith("http")
      ? pastElevationUrl
      : `https://polygon-giro3d.s3.ap-south-2.amazonaws.com/${pastElevationUrl.replace(/^\.\//, "")}`;

    if (ibmHeatmapLoadingText) ibmHeatmapLoadingText.textContent = "Reading COG overview levels...";

    const [currentTiff, pastTiff] = await Promise.all([
      fromUrl(fullCurrentUrl),
      fromUrl(fullPastUrl)
    ]);

    const [current0, past0] = await Promise.all([
      currentTiff.getImage(0),
      pastTiff.getImage(0)
    ]);

    const currentBbox = current0.getBoundingBox();
    const pastBbox = past0.getBoundingBox();

    const currentCount = await currentTiff.getImageCount();
    const pastCount = await pastTiff.getImageCount();

    const currentLevel = Math.min(6, currentCount - 1);
    const pastLevel = Math.min(6, pastCount - 1);

    if (ibmHeatmapLoadingText) ibmHeatmapLoadingText.textContent = `Streaming DTM rasters (L${currentLevel} & L${pastLevel})...`;

    let currentImg, pastImg, currentRaster, pastRaster;

    try {
      [currentImg, pastImg] = await Promise.all([
        currentTiff.getImage(currentLevel),
        pastTiff.getImage(pastLevel)
      ]);

      const [r1, r2] = await Promise.all([
        currentImg.readRasters(),
        pastImg.readRasters()
      ]);
      currentRaster = r1[0];
      pastRaster = r2[0];
    } catch (fetchErr) {
      console.warn("Retrying with lightweight overview Level 6...", fetchErr);
      if (ibmHeatmapLoadingText) ibmHeatmapLoadingText.textContent = "Retrying with lightweight overview...";
      const fallbackLevel1 = Math.min(6, currentCount - 1);
      const fallbackLevel2 = Math.min(6, pastCount - 1);
      [currentImg, pastImg] = await Promise.all([
        currentTiff.getImage(fallbackLevel1),
        pastTiff.getImage(fallbackLevel2)
      ]);
      const [r1, r2] = await Promise.all([
        currentImg.readRasters(),
        pastImg.readRasters()
      ]);
      currentRaster = r1[0];
      pastRaster = r2[0];
    }

    const W1 = currentImg.getWidth();
    const H1 = currentImg.getHeight();
    const W2 = pastImg.getWidth();
    const H2 = pastImg.getHeight();

    if (ibmHeatmapLoadingText) ibmHeatmapLoadingText.textContent = "Computing sub-meter ΔZ elevation difference grid...";

    const totalPixels = W1 * H1;
    const diffs = new Float32Array(totalPixels);
    const validMask = new Uint8Array(totalPixels);

    const minX1 = currentBbox[0];
    const minY1 = currentBbox[1];
    const maxX1 = currentBbox[2];
    const maxY1 = currentBbox[3];
    const spanX1 = maxX1 - minX1;
    const spanY1 = maxY1 - minY1;

    const minX2 = pastBbox[0];
    const minY2 = pastBbox[1];
    const maxX2 = pastBbox[2];
    const maxY2 = pastBbox[3];
    const spanX2 = maxX2 - minX2;
    const spanY2 = maxY2 - minY2;

    for (let r = 0; r < H1; r++) {
      const rowOffset = r * W1;
      const Y = maxY1 - (r + 0.5) * (spanY1 / H1);

      if (Y < minY2 || Y > maxY2) continue;

      const normY = (maxY2 - Y) / spanY2 * (H2 - 1);
      if (normY < 0 || normY > H2 - 1) continue;
      const r0 = Math.floor(normY);
      const r1 = Math.min(H2 - 1, r0 + 1);
      const fy = normY - r0;
      const pastRowOffset0 = r0 * W2;
      const pastRowOffset1 = r1 * W2;

      for (let c = 0; c < W1; c++) {
        const idx = rowOffset + c;
        const z1 = currentRaster[idx];
        if (z1 == null || isNaN(z1) || z1 < 300 || z1 > 1500) continue;

        const X = minX1 + (c + 0.5) * (spanX1 / W1);
        if (X < minX2 || X > maxX2) continue;

        const normX = (X - minX2) / spanX2 * (W2 - 1);
        if (normX < 0 || normX > W2 - 1) continue;
        const c0 = Math.floor(normX);
        const c1 = Math.min(W2 - 1, c0 + 1);
        const fx = normX - c0;

        const z00 = pastRaster[pastRowOffset0 + c0];
        const z01 = pastRaster[pastRowOffset0 + c1];
        const z10 = pastRaster[pastRowOffset1 + c0];
        const z11 = pastRaster[pastRowOffset1 + c1];

        const v00 = (z00 != null && !isNaN(z00) && z00 >= 300 && z00 <= 1500);
        const v01 = (z01 != null && !isNaN(z01) && z01 >= 300 && z01 <= 1500);
        const v10 = (z10 != null && !isNaN(z10) && z10 >= 300 && z10 <= 1500);
        const v11 = (z11 != null && !isNaN(z11) && z11 >= 300 && z11 <= 1500);

        let z2;
        if (v00 && v01 && v10 && v11) {
          z2 = (1 - fx) * (1 - fy) * z00 + fx * (1 - fy) * z01 + (1 - fx) * fy * z10 + fx * fy * z11;
        } else if (v00) {
          z2 = z00;
        } else {
          continue;
        }

        diffs[idx] = z1 - z2;
        validMask[idx] = 1;
      }
    }

    const extent = new Extent(giroCrs, currentBbox[0], currentBbox[2], currentBbox[1], currentBbox[3]);

    state.cachedDiffHeatmapData = {
      width: W1,
      height: H1,
      bbox: currentBbox,
      extent,
      diffs,
      validMask,
      pastSurveyKey
    };

    if (!state.diffCanvas) {
      state.diffCanvas = document.createElement("canvas");
    }
    state.diffCanvas.width = W1;
    state.diffCanvas.height = H1;

    if (ibmHeatmapMinInput) ibmHeatmapMinInput.value = "1.0";
    if (ibmHeatmapMaxInput) ibmHeatmapMaxInput.value = "50.0";

    renderDifferenceHeatmapCanvas("all", 1.0, 50.0);
    await refreshDiffLayerOnMap();

    if (ibmHeatmapFiltersContainer) ibmHeatmapFiltersContainer.classList.remove("hidden");
    if (btnIbmClearHeatmap) btnIbmClearHeatmap.classList.remove("hidden");

    document.querySelectorAll(".ibm-filter-pill").forEach(p => {
      p.classList.toggle("active", p.getAttribute("data-filter") === "all");
    });

  } catch (err) {
    console.error("Error computing difference heatmap:", err);
    await showCustomAlert(`Failed to compute heatmap: ${err.message}`, "Heatmap Calculation Error", "error");
  } finally {
    if (ibmHeatmapLoadingIndicator) ibmHeatmapLoadingIndicator.classList.add("hidden");
    if (btnIbmComputeHeatmap) btnIbmComputeHeatmap.disabled = false;
  }
}

/** Initialize IBM Multi-Temporal suite UI listeners */
export function initHeatmapUI() {
  const btnIbmStartProfile = document.getElementById("btnIbmStartProfile");
  const btnIbmStartProfileText = document.getElementById("btnIbmStartProfileText");
  const btnIbmClearProfile = document.getElementById("btnIbmClearProfile");
  const ibmProfilePastSurveySelect = document.getElementById("ibmProfilePastSurveySelect");
  const btnIbmComputeHeatmap = document.getElementById("btnIbmComputeHeatmap");
  const btnIbmClearHeatmap = document.getElementById("btnIbmClearHeatmap");
  const ibmHeatmapPastSurveySelect = document.getElementById("ibmHeatmapPastSurveySelect");
  const ibmHeatmapFiltersContainer = document.getElementById("ibmHeatmapFiltersContainer");
  const ibmHeatmapMinInput = document.getElementById("ibmHeatmapMinInput");
  const ibmHeatmapMaxInput = document.getElementById("ibmHeatmapMaxInput");
  const btnIbmApplyCustomFilter = document.getElementById("btnIbmApplyCustomFilter");
  const ibmHeatmapOpacitySlider = document.getElementById("ibmHeatmapOpacitySlider");
  const ibmHeatmapOpacityValue = document.getElementById("ibmHeatmapOpacityValue");

  populateIbmSurveys();

  btnIbmStartProfile?.addEventListener("click", async () => {
    const selectedSurvey = ibmProfilePastSurveySelect?.value;
    if (!selectedSurvey) {
      await showCustomAlert("Please select a past survey from the dropdown to compare against.", "Survey Required", "warning");
      return;
    }

    resetRoiState();
    clearAllLeftPanelState(true);

    state.isIbmProfileComparison = true;
    state.ibmComparisonPastSurveyKey = selectedSurvey;
    state.currentProfileComparisonData = null;
    state.measureState = "SELECTING";
    state.measureMode = "PROFILE";
    setLiveGuidance("📐", `Path Profile Comparison against ${selectedSurvey}: Click to place start point, then drag or tap end point.`);
    window.measureHasFirstTap = false;
    if (state.controls) state.controls.enabled = false;
    document.body.classList.add("roi-selecting");

    if (btnIbmStartProfileText) btnIbmStartProfileText.textContent = "Drawing... Click 2 Points";
    if (btnIbmClearProfile) btnIbmClearProfile.classList.remove("hidden");
    clearMeasure();
  });

  ibmProfilePastSurveySelect?.addEventListener("change", () => {
    const selected = ibmProfilePastSurveySelect.value;
    if (selected) {
      state.isIbmProfileComparison = true;
      state.ibmComparisonPastSurveyKey = selected;
      if (btnIbmClearProfile) btnIbmClearProfile.classList.remove("hidden");
      if (state.currentProfileData && state.currentProfileData.length > 0) {
        updateElevationProfile();
      }
    } else {
      clearIbmProfileComparison();
    }
  });

  btnIbmClearProfile?.addEventListener("click", clearIbmProfileComparison);

  btnIbmComputeHeatmap?.addEventListener("click", async () => {
    const selectedSurvey = ibmHeatmapPastSurveySelect?.value;
    if (!selectedSurvey) {
      await showCustomAlert("Please select a base past survey from the dropdown.", "Past Survey Required", "warning");
      return;
    }
    await computeDifferenceHeatmap(selectedSurvey);
  });

  btnIbmClearHeatmap?.addEventListener("click", () => {
    if (state.diffLayer && state.map) {
      try { state.map.removeLayer(state.diffLayer); } catch (e) {}
      state.diffLayer = null;
      state.diffSource = null;
      state.instance.notifyChange();
    }
    state.cachedDiffHeatmapData = null;
    if (ibmHeatmapFiltersContainer) ibmHeatmapFiltersContainer.classList.add("hidden");
    if (btnIbmClearHeatmap) btnIbmClearHeatmap.classList.add("hidden");
    const floatingHud = document.getElementById("heatmapFloatingHud");
    if (floatingHud) floatingHud.classList.add("hidden");
  });

  ibmHeatmapOpacitySlider?.addEventListener("input", (e) => {
    const val = parseInt(e.target.value, 10);
    if (ibmHeatmapOpacityValue) ibmHeatmapOpacityValue.textContent = `${val}%`;
    if (state.diffLayer) {
      state.diffLayer.opacity = val / 100;
      state.instance.notifyChange(state.diffLayer);
    }
  });

  btnIbmApplyCustomFilter?.addEventListener("click", async () => {
    if (!state.cachedDiffHeatmapData) return;
    const minVal = Math.max(0, parseFloat(ibmHeatmapMinInput?.value) || 0);
    const maxVal = Math.max(minVal, parseFloat(ibmHeatmapMaxInput?.value) || 100);

    document.querySelectorAll(".ibm-filter-pill").forEach(p => p.classList.remove("active"));
    renderDifferenceHeatmapCanvas("custom", minVal, maxVal);
    await refreshDiffLayerOnMap();
  });

  [ibmHeatmapMinInput, ibmHeatmapMaxInput].forEach(inp => {
    inp?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        btnIbmApplyCustomFilter?.click();
      }
    });
  });

  document.querySelectorAll(".ibm-filter-pill").forEach(pill => {
    pill.addEventListener("click", async () => {
      document.querySelectorAll(".ibm-filter-pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      const filter = pill.getAttribute("data-filter") || "all";

      if (filter === "all") {
        if (ibmHeatmapMinInput) ibmHeatmapMinInput.value = "1.0";
        if (ibmHeatmapMaxInput) ibmHeatmapMaxInput.value = "50.0";
      } else if (filter === "1-2m") {
        if (ibmHeatmapMinInput) ibmHeatmapMinInput.value = "1.0";
        if (ibmHeatmapMaxInput) ibmHeatmapMaxInput.value = "2.0";
      } else if (filter === "2-5m") {
        if (ibmHeatmapMinInput) ibmHeatmapMinInput.value = "2.0";
        if (ibmHeatmapMaxInput) ibmHeatmapMaxInput.value = "5.0";
      } else if (filter === "5m+") {
        if (ibmHeatmapMinInput) ibmHeatmapMinInput.value = "5.0";
        if (ibmHeatmapMaxInput) ibmHeatmapMaxInput.value = "50.0";
      } else if (filter === "cut") {
        if (ibmHeatmapMinInput) ibmHeatmapMinInput.value = "1.0";
        if (ibmHeatmapMaxInput) ibmHeatmapMaxInput.value = "50.0";
      } else if (filter === "fill") {
        if (ibmHeatmapMinInput) ibmHeatmapMinInput.value = "1.0";
        if (ibmHeatmapMaxInput) ibmHeatmapMaxInput.value = "50.0";
      }

      const minVal = parseFloat(ibmHeatmapMinInput?.value) || 1.0;
      const maxVal = parseFloat(ibmHeatmapMaxInput?.value) || 50.0;
      renderDifferenceHeatmapCanvas(filter, minVal, maxVal);
      await refreshDiffLayerOnMap();
    });
  });

  // Attach to window
  window.populateIbmSurveys = populateIbmSurveys;
  window.clearIbmProfileComparison = clearIbmProfileComparison;
  window.computeDifferenceHeatmap = computeDifferenceHeatmap;
}
