// src/tools/elevationsGrid.js
// Spot Elevation Point Grid Overlay with Real-time Terrain Sampling

import { Vector2 } from "three";
import { state } from "../core/state.js";

let isElevationsEnabled = false;
let elevationGridSpacing = 50;

/** Render screen-space spot elevation text markers across the active terrain */
export function renderElevations() {
  const elevationsCanvas = document.getElementById("elevationsSvg");
  if (!elevationsCanvas) return;
  elevationsCanvas.innerHTML = "";

  if (!isElevationsEnabled || !state.map) return;

  const step = Math.max(60, elevationGridSpacing * 1.5);
  let svgContent = "";

  for (let screenX = step / 2; screenX < window.innerWidth; screenX += step) {
    for (let screenY = step / 2; screenY < window.innerHeight; screenY += step) {
      const mouse = new Vector2(screenX, screenY);
      const picked = state.map.pick(mouse, { gpuPicking: true });

      if (picked && picked.length > 0 && picked[0].coord) {
        const coord = picked[0].coord;

        if (state.elevationLayer && state.elevationLayer.extent && state.elevationLayer.extent.isPointInside(coord)) {
          const sample = state.map.getElevationFast(coord.x, coord.y);
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

/** Initialize Elevations Grid UI */
export function initElevationsGridUI() {
  const btnEnableElevations = document.getElementById("btnEnableElevations");
  const btnDisableElevations = document.getElementById("btnDisableElevations");
  const elevationsSpacingInput = document.getElementById("elevationsSpacing");
  const elevationsSpacingVal = document.getElementById("elevationsSpacingVal");

  btnEnableElevations?.addEventListener("click", () => {
    isElevationsEnabled = true;
    btnEnableElevations.disabled = true;
    if (btnDisableElevations) btnDisableElevations.disabled = false;
    state.isGridOverlayActive = true;
    const btnRightGrid = document.getElementById("btnRightGrid");
    if (btnRightGrid) btnRightGrid.classList.add("overlay-active");
    renderElevations();
  });

  btnDisableElevations?.addEventListener("click", () => {
    isElevationsEnabled = false;
    if (btnEnableElevations) btnEnableElevations.disabled = false;
    btnDisableElevations.disabled = true;
    state.isGridOverlayActive = false;
    const btnRightGrid = document.getElementById("btnRightGrid");
    if (btnRightGrid) btnRightGrid.classList.remove("overlay-active");
    renderElevations();
  });

  elevationsSpacingInput?.addEventListener("input", (e) => {
    if (elevationsSpacingVal) elevationsSpacingVal.textContent = e.target.value + "m";
  });

  elevationsSpacingInput?.addEventListener("change", (e) => {
    elevationGridSpacing = parseInt(e.target.value, 10);
    if (isElevationsEnabled) renderElevations();
  });

  // Attach to window
  window.renderElevations = renderElevations;
}
