// src/tools/slopeHeatmap.js
// Slope Gradient Analysis, Color LUT Shaders, Custom Degree Intervals & High-Res PNG Export

import { Color } from "three";
import { state } from "../core/state.js";

let customRanges = [
  { min: 0, max: 15, color: "#22c55e" },
  { min: 15, max: 30, color: "#eab308" }
];

/** Read the exact numbers & colors currently in the DOM inputs */
export function getLiveCustomRanges() {
  const container = document.getElementById("infoCustomHeatmapRanges") || document.getElementById("customHeatmapRanges");
  if (!container || container.children.length === 0) return customRanges;

  const rows = container.querySelectorAll(".custom-range-row");
  if (rows.length === 0) return customRanges;

  const extracted = [];
  rows.forEach(row => {
    const colorInput = row.querySelector("input[type='color']");
    const minInput = row.querySelector(".range-min-input");
    const maxInput = row.querySelector(".range-max-input");
    if (colorInput && minInput && maxInput) {
      extracted.push({
        color: colorInput.value,
        min: parseFloat(minInput.value) || 0,
        max: parseFloat(maxInput.value) || 0
      });
    }
  });

  if (extracted.length > 0) {
    customRanges = extracted;
  }
  return customRanges;
}

/** Render custom degree range input rows in both the flyout and info panels */
export function renderCustomRanges() {
  const containers = [
    document.getElementById("customHeatmapRanges"),
    document.getElementById("infoCustomHeatmapRanges")
  ].filter(Boolean);
  if (containers.length === 0) return;

  containers.forEach(container => {
    container.innerHTML = "";
    customRanges.forEach((range, index) => {
      const row = document.createElement("div");
      row.className = "custom-range-row";
      row.style.display = "flex";
      row.style.gap = "8px";
      row.style.alignItems = "center";
      row.style.marginBottom = "8px";
      row.style.padding = "6px 8px";
      row.style.background = "#f8fafc";
      row.style.border = "1px solid #e2e8f0";
      row.style.borderRadius = "8px";
      row.style.boxShadow = "0 1px 2px rgba(0, 0, 0, 0.03)";

      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.value = range.color;
      colorInput.className = "range-color-input";
      colorInput.style.width = "32px";
      colorInput.style.height = "28px";
      colorInput.style.padding = "0";
      colorInput.style.border = "1px solid #cbd5e1";
      colorInput.style.borderRadius = "6px";
      colorInput.style.cursor = "pointer";
      colorInput.style.background = "#ffffff";
      colorInput.title = "Choose Slope Color";
      colorInput.addEventListener("change", (e) => {
        customRanges[index].color = e.target.value;
        renderCustomRanges();
        if (state.slopeColorMap && state.slopeColorMap.active) {
          handleApplyCustomHeatmap(false);
        }
      });

      const minInput = document.createElement("input");
      minInput.type = "number";
      minInput.className = "range-min-input";
      minInput.value = range.min;
      minInput.min = "0";
      minInput.max = "90";
      minInput.style.width = "55px";
      minInput.style.padding = "4px 6px";
      minInput.style.fontSize = "12px";
      minInput.style.fontWeight = "600";
      minInput.style.borderRadius = "6px";
      minInput.style.border = "1px solid #cbd5e1";
      minInput.style.background = "#ffffff";
      minInput.style.color = "#0f172a";
      minInput.addEventListener("input", (e) => {
        customRanges[index].min = parseFloat(e.target.value) || 0;
      });
      minInput.addEventListener("change", (e) => {
        customRanges[index].min = parseFloat(e.target.value) || 0;
      });

      const span = document.createElement("span");
      span.textContent = "to";
      span.style.fontSize = "12px";
      span.style.fontWeight = "600";
      span.style.color = "#64748b";

      const maxInput = document.createElement("input");
      maxInput.type = "number";
      maxInput.className = "range-max-input";
      maxInput.value = range.max;
      maxInput.min = "0";
      maxInput.max = "90";
      maxInput.style.width = "55px";
      maxInput.style.padding = "4px 6px";
      maxInput.style.fontSize = "12px";
      maxInput.style.fontWeight = "600";
      maxInput.style.borderRadius = "6px";
      maxInput.style.border = "1px solid #cbd5e1";
      maxInput.style.background = "#ffffff";
      maxInput.style.color = "#0f172a";
      maxInput.addEventListener("input", (e) => {
        customRanges[index].max = parseFloat(e.target.value) || 0;
      });
      maxInput.addEventListener("change", (e) => {
        customRanges[index].max = parseFloat(e.target.value) || 0;
      });

      const degSpan = document.createElement("span");
      degSpan.textContent = "°";
      degSpan.style.fontSize = "13px";
      degSpan.style.fontWeight = "600";
      degSpan.style.color = "#64748b";

      const btnDel = document.createElement("button");
      btnDel.textContent = "✕";
      btnDel.className = "btn btn-outline";
      btnDel.style.padding = "4px 8px";
      btnDel.style.fontSize = "11px";
      btnDel.style.fontWeight = "700";
      btnDel.style.color = "#ef4444";
      btnDel.style.borderColor = "rgba(239, 68, 68, 0.3)";
      btnDel.style.background = "#ffffff";
      btnDel.style.borderRadius = "6px";
      btnDel.style.cursor = "pointer";
      btnDel.title = "Remove Range";
      btnDel.addEventListener("click", () => {
        getLiveCustomRanges();
        customRanges.splice(index, 1);
        renderCustomRanges();
        if (state.slopeColorMap && state.slopeColorMap.active) {
          handleApplyCustomHeatmap(false);
        }
      });

      row.appendChild(colorInput);
      row.appendChild(minInput);
      row.appendChild(span);
      row.appendChild(maxInput);
      row.appendChild(degSpan);
      row.appendChild(btnDel);

      container.appendChild(row);
    });
  });
}

/** Set the active slope heatmap mode (predefined, haulroad, custom) */
export function setHeatmapMode(mode) {
  const predefinedHeatmapUI = document.getElementById("predefinedHeatmapUI");
  const haulroadHeatmapUI = document.getElementById("haulroadHeatmapUI");
  const customHeatmapUI = document.getElementById("customHeatmapUI");

  document.querySelectorAll('input[name="heatmapMode"]').forEach(r => {
    r.checked = (r.value === mode);
  });
  document.querySelectorAll('input[name="infoHeatmapMode"]').forEach(r => {
    r.checked = (r.value === mode);
  });

  if (predefinedHeatmapUI) predefinedHeatmapUI.classList.toggle("hidden", mode !== "predefined");
  if (haulroadHeatmapUI) haulroadHeatmapUI.classList.toggle("hidden", mode !== "haulroad");
  if (customHeatmapUI) customHeatmapUI.classList.toggle("hidden", mode !== "custom");

  const infoPre = document.getElementById("infoPredefinedHeatmapUI");
  const infoHaul = document.getElementById("infoHaulroadHeatmapUI");
  const infoCust = document.getElementById("infoCustomHeatmapUI");
  if (infoPre) infoPre.classList.toggle("hidden", mode !== "predefined");
  if (infoHaul) infoHaul.classList.toggle("hidden", mode !== "haulroad");
  if (infoCust) infoCust.classList.toggle("hidden", mode !== "custom");

  if (mode === "custom") {
    renderCustomRanges();
  }

  const opacityEl = document.getElementById("infoHeatmapOpacity") || document.getElementById("heatmapOpacity");
  const val = opacityEl ? parseFloat(opacityEl.value) : 0.35;

  if (state.slopeColorMap && state.slopeColorMap.active) {
    if (mode === "custom") {
      handleApplyCustomHeatmap(false);
    } else if (mode === "haulroad") {
      const RESOLUTION = 256;
      const newColors = [];
      const newOpacities = new Array(RESOLUTION).fill(val);
      for (let i = 0; i < RESOLUTION; i++) {
        const deg = (i / (RESOLUTION - 1)) * 90;
        if (deg <= 5) newColors.push(new Color("green"));
        else if (deg <= 8) newColors.push(new Color("yellow"));
        else if (deg <= 10) newColors.push(new Color("orange"));
        else newColors.push(new Color("red"));
      }
      state.slopeColorMap.colors = newColors;
      state.slopeColorMap.opacity = newOpacities;
      state.instance.notifyChange();
    } else {
      state.slopeColorMap.colors = [
        new Color("green"),
        new Color("yellow"),
        new Color("orange"),
        new Color("red"),
        new Color("darkred")
      ];
      state.slopeColorMap.opacity = new Array(5).fill(val);
      state.instance.notifyChange();
    }
  }
}

export function handleAddHeatmapRange() {
  getLiveCustomRanges();
  const lastMax = customRanges.length > 0 ? customRanges[customRanges.length - 1].max : 0;
  const nextMax = Math.min(90, lastMax + 15);
  const colorPalette = ["#f97316", "#ef4444", "#a855f7", "#3b82f6"];
  const color = colorPalette[(customRanges.length - 2) % colorPalette.length] || "#ef4444";
  customRanges.push({ min: lastMax, max: nextMax, color });
  renderCustomRanges();
  if (state.slopeColorMap && state.slopeColorMap.active) {
    handleApplyCustomHeatmap(false);
  }
}

export function handleApplyCustomHeatmap(showFeedback = true) {
  const errorEls = [
    document.getElementById("customHeatmapError"),
    document.getElementById("infoCustomHeatmapError")
  ].filter(Boolean);
  errorEls.forEach(el => { el.style.display = "none"; el.textContent = ""; });

  const ranges = getLiveCustomRanges();
  if (!ranges || ranges.length === 0) {
    const msg = "Please add at least one slope range";
    errorEls.forEach(el => { el.textContent = msg; el.style.display = "block"; });
    return;
  }

  const sorted = [...ranges].sort((a, b) => a.min - b.min);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].min >= sorted[i].max) {
      const msg = `Error: Range must have min < max (${sorted[i].min}° to ${sorted[i].max}°)`;
      errorEls.forEach(el => { el.textContent = msg; el.style.display = "block"; });
      return;
    }
    if (i > 0 && sorted[i].min < sorted[i - 1].max) {
      const msg = `Error: Overlapping degrees (${sorted[i - 1].max}° encounters ${sorted[i].min}°)`;
      errorEls.forEach(el => { el.textContent = msg; el.style.display = "block"; });
      return;
    }
  }

  const btnEnableHeatmap = document.getElementById("btnEnableHeatmap");
  const btnDisableHeatmap = document.getElementById("btnDisableHeatmap");

  if (state.slopeColorMap && state.elevationLayer) {
    state.elevationLayer.colorMap = state.slopeColorMap;
    state.slopeColorMap.active = true;
    if (state.orthoLayer) {
      state.orthoLayer.opacity = 0.4;
    }

    if (btnEnableHeatmap) btnEnableHeatmap.disabled = true;
    if (btnDisableHeatmap) btnDisableHeatmap.disabled = false;
    state.isHeatmapOverlayActive = true;
    const btnRightHeatmap = document.getElementById("btnRightHeatmap");
    if (btnRightHeatmap) btnRightHeatmap.classList.add("overlay-active");
    const exportCard = document.getElementById("infoHeatmapExportCard");
    if (exportCard) exportCard.classList.remove("hidden");
    const heatmapSettings = document.getElementById("heatmapSettings");
    if (heatmapSettings) heatmapSettings.classList.remove("hidden");

    const RESOLUTION = 256;
    const newColors = [];
    const newOpacities = [];
    const opacityEl = document.getElementById("infoHeatmapOpacity") || document.getElementById("heatmapOpacity");
    const val = opacityEl ? parseFloat(opacityEl.value) : 0.35;

    for (let i = 0; i < RESOLUTION; i++) {
      const deg = (i / (RESOLUTION - 1)) * 90;
      let foundColor = null;
      for (const r of sorted) {
        if (deg >= r.min && deg <= r.max) {
          foundColor = r.color;
          break;
        }
      }
      if (foundColor) {
        newColors.push(new Color(foundColor));
        newOpacities.push(val);
      } else {
        newColors.push(new Color("black"));
        newOpacities.push(0);
      }
    }
    state.slopeColorMap.colors = newColors;
    state.slopeColorMap.opacity = newOpacities;
    state.instance.notifyChange();
  }

  if (showFeedback) {
    const applyBtns = [
      document.getElementById("infoApplyCustomHeatmap"),
      document.getElementById("btnApplyCustomHeatmap")
    ].filter(Boolean);
    applyBtns.forEach(btn => {
      const origText = btn.dataset.origText || btn.textContent;
      btn.dataset.origText = origText;
      btn.textContent = "Applied to Map! ✓";
      btn.style.background = "#10b981";
      btn.style.color = "#ffffff";
      setTimeout(() => {
        btn.textContent = origText;
        btn.style.background = "";
        btn.style.color = "";
      }, 1500);
    });
  }
}

/** Render and download high-resolution PNG with embedded slope safety legend */
export function downloadHeatmapPng() {
  const statusEl = document.getElementById("heatmapExportStatus");
  if (statusEl) { statusEl.classList.remove("hidden"); statusEl.textContent = "Rendering image with safety legend..."; }

  setTimeout(() => {
    try {
      const canvas3D = state.instance?.renderer?.domElement || document.querySelector("#viewerContainer canvas") || document.querySelector("canvas");
      if (!canvas3D) throw new Error("3D Canvas not found");

      if (state.instance) state.instance.notifyChange();

      const outCanvas = document.createElement("canvas");
      outCanvas.width = canvas3D.width || 1920;
      outCanvas.height = canvas3D.height || 1080;
      const ctx = outCanvas.getContext("2d");

      ctx.drawImage(canvas3D, 0, 0, outCanvas.width, outCanvas.height);

      const legendW = 280;
      const legendH = 150;
      const marginX = 24;
      const marginY = outCanvas.height - legendH - 24;

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

      const url = outCanvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = `slope_heatmap_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      if (statusEl) {
        statusEl.textContent = "✓ High-res heatmap exported!";
        setTimeout(() => statusEl.classList.add("hidden"), 3000);
      }
    } catch (err) {
      console.error("Heatmap export error", err);
      if (statusEl) statusEl.textContent = "⚠️ Export failed: " + err.message;
    }
  }, 100);
}

/** Initialize Slope Heatmap UI and controls */
export function initSlopeHeatmapUI() {
  const btnEnableHeatmap = document.getElementById("btnEnableHeatmap");
  const btnDisableHeatmap = document.getElementById("btnDisableHeatmap");
  const heatmapSettings = document.getElementById("heatmapSettings");
  const heatmapLoading = document.getElementById("infoHeatmapLoading") || document.getElementById("heatmapLoading");
  const btnAddHeatmapRange = document.getElementById("btnAddHeatmapRange");
  const infoAddHeatmapRange = document.getElementById("infoAddHeatmapRange");
  const btnApplyCustomHeatmap = document.getElementById("btnApplyCustomHeatmap");
  const infoApplyCustomHeatmap = document.getElementById("infoApplyCustomHeatmap");
  const btnDownloadHeatmapPng = document.getElementById("btnDownloadHeatmapPng");

  const handleHeatmapOpacityInput = (e) => {
    const val = parseFloat(e.target.value);
    const infoVal = document.getElementById("infoHeatmapOpacityVal");
    const flyoutVal = document.getElementById("heatmapOpacityVal");
    const pct = Math.round(val * 100) + "%";
    if (infoVal) infoVal.textContent = pct;
    if (flyoutVal) flyoutVal.textContent = pct;

    const infoOp = document.getElementById("infoHeatmapOpacity");
    const flyoutOp = document.getElementById("heatmapOpacity");
    if (infoOp && e.target !== infoOp) infoOp.value = val;
    if (flyoutOp && e.target !== flyoutOp) flyoutOp.value = val;

    const curMode = document.querySelector('input[name="infoHeatmapMode"]:checked')?.value ||
                    document.querySelector('input[name="heatmapMode"]:checked')?.value ||
                    "predefined";

    if (state.slopeColorMap && state.slopeColorMap.active) {
      if (curMode === "custom") {
        handleApplyCustomHeatmap(false);
      } else if (curMode === "haulroad") {
        state.slopeColorMap.opacity = new Array(256).fill(val);
        state.instance.notifyChange();
      } else {
        state.slopeColorMap.opacity = new Array(5).fill(val);
        state.instance.notifyChange();
      }
    }
  };

  document.getElementById("heatmapOpacity")?.addEventListener("input", handleHeatmapOpacityInput);
  document.getElementById("infoHeatmapOpacity")?.addEventListener("input", handleHeatmapOpacityInput);

  btnEnableHeatmap?.addEventListener("click", () => {
    btnEnableHeatmap.disabled = true;
    heatmapLoading?.classList.remove("hidden");

    setTimeout(() => {
      if (state.slopeColorMap && state.elevationLayer) {
        state.elevationLayer.colorMap = state.slopeColorMap;
        state.slopeColorMap.active = true;
        if (state.orthoLayer) {
          state.orthoLayer.opacity = 0.4;
        }
      }

      const curMode = document.querySelector('input[name="infoHeatmapMode"]:checked')?.value ||
                      document.querySelector('input[name="heatmapMode"]:checked')?.value ||
                      "predefined";

      if (curMode === "custom") {
        handleApplyCustomHeatmap(false);
      } else {
        setHeatmapMode(curMode);
      }

      state.instance.notifyChange();
      if (btnDisableHeatmap) btnDisableHeatmap.disabled = false;
      heatmapLoading?.classList.add("hidden");
      heatmapSettings?.classList.remove("hidden");
      document.getElementById("infoHeatmapExportCard")?.classList.remove("hidden");

      state.isHeatmapOverlayActive = true;
      const btnRightHeatmap = document.getElementById("btnRightHeatmap");
      if (btnRightHeatmap) btnRightHeatmap.classList.add("overlay-active");
    }, 400);
  });

  btnDisableHeatmap?.addEventListener("click", () => {
    if (state.slopeColorMap && state.elevationLayer) {
      state.elevationLayer.colorMap = null;
      state.slopeColorMap.active = false;
      if (state.orthoLayer) {
        state.orthoLayer.opacity = 1.0;
      }
      state.instance.notifyChange();
    }
    if (btnEnableHeatmap) btnEnableHeatmap.disabled = false;
    btnDisableHeatmap.disabled = true;
    heatmapSettings?.classList.add("hidden");
    document.getElementById("infoHeatmapExportCard")?.classList.add("hidden");

    state.isHeatmapOverlayActive = false;
    const btnRightHeatmap = document.getElementById("btnRightHeatmap");
    if (btnRightHeatmap) btnRightHeatmap.classList.remove("overlay-active");
  });

  document.querySelectorAll('input[name="heatmapMode"]').forEach(radio => {
    radio.addEventListener("change", (e) => {
      setHeatmapMode(e.target.value);
    });
  });
  document.querySelectorAll('input[name="infoHeatmapMode"]').forEach(radio => {
    radio.addEventListener("change", (e) => {
      setHeatmapMode(e.target.value);
    });
  });

  btnAddHeatmapRange?.addEventListener("click", handleAddHeatmapRange);
  infoAddHeatmapRange?.addEventListener("click", handleAddHeatmapRange);

  btnApplyCustomHeatmap?.addEventListener("click", () => handleApplyCustomHeatmap(true));
  infoApplyCustomHeatmap?.addEventListener("click", () => handleApplyCustomHeatmap(true));

  btnDownloadHeatmapPng?.addEventListener("click", downloadHeatmapPng);
  document.getElementById("btnExportHeatmapPng")?.addEventListener("click", downloadHeatmapPng);

  const heatmapHeader = document.getElementById("heatmapHeader");
  const heatmapSettingsContainer = document.getElementById("heatmapSettingsContainer");
  const heatmapCarrot = document.getElementById("heatmapCarrot");

  heatmapHeader?.addEventListener("click", () => {
    if (!heatmapSettingsContainer) return;
    if (heatmapSettingsContainer.style.display === "none") {
      heatmapSettingsContainer.style.display = "block";
      if (heatmapCarrot) heatmapCarrot.textContent = "▲";
    } else {
      heatmapSettingsContainer.style.display = "none";
      if (heatmapCarrot) heatmapCarrot.textContent = "▼";
    }
  });

  // Attach to window
  window.setHeatmapMode = setHeatmapMode;
  window.renderCustomRanges = renderCustomRanges;
  window.handleApplyCustomHeatmap = handleApplyCustomHeatmap;
  window.downloadHeatmapPng = downloadHeatmapPng;
}
