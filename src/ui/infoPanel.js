// src/ui/infoPanel.js
// Unified Fixed Info Panel, Standardized Universal Save Modal & Inline Rename Controller

import { state } from "../core/state.js";
import { showCustomAlert, showCustomConfirm, showCustomPrompt } from "./dialogs.js";
import { getReportsFolder } from "./roleGating.js";
import { API_BASE, deleteFile } from "../services/api.js";

let isInlineTitleEditing = false;
let originalInlineTitleName = "";

export function addKnownProfileFolder(folderName, autoSync = true, selectTarget = null) {
  if (!folderName || typeof folderName !== "string") return;
  const trimmed = folderName.trim();
  if (trimmed === "") return;
  state.sessionCreatedProfileFolders.add(trimmed);
  state.knownProfileFolders.add(trimmed);
  if (autoSync) syncFolderDropdowns("PROFILE", selectTarget || trimmed);
}

export function addKnownVolumeFolder(folderName, autoSync = true, selectTarget = null) {
  if (!folderName || typeof folderName !== "string") return;
  const trimmed = folderName.trim();
  if (trimmed === "") return;
  state.sessionCreatedVolumeFolders.add(trimmed);
  state.knownVolumeFolders.add(trimmed);
  if (autoSync) syncFolderDropdowns("VOLUME", selectTarget || trimmed);
}

export function addKnownFolder(folderName, autoSync = true, selectTarget = null) {
  addKnownVolumeFolder(folderName, autoSync, selectTarget);
}

export function syncFolderDropdowns(toolType = null, selectedFolder = null) {
  const targetTool = toolType || state.activeInfoTool || "PROFILE";
  const select = document.getElementById("universalSaveFolder");
  const volSelect = document.getElementById("volSaveFolder");

  const folderSet = (targetTool === "PROFILE") ? state.knownProfileFolders : state.knownVolumeFolders;
  const sortedFolders = Array.from(folderSet).sort();

  if (select) {
    const currentVal = selectedFolder || (select.value !== "" ? select.value : null);
    select.innerHTML = "";

    if (sortedFolders.length === 0) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.disabled = true;
      placeholder.selected = true;
      placeholder.textContent = "No folders — click + to create";
      select.appendChild(placeholder);
    } else {
      sortedFolders.forEach(folder => {
        const option = document.createElement("option");
        option.value = folder;
        option.textContent = folder;
        select.appendChild(option);
      });

      if (currentVal && folderSet.has(currentVal)) {
        select.value = currentVal;
      } else if (select.options.length > 0) {
        select.selectedIndex = 0;
      }
    }
  }

  if (volSelect) {
    const volumeList = Array.from(state.knownVolumeFolders).sort();
    const currentVal = selectedFolder || (volSelect.value !== "" ? volSelect.value : null);
    volSelect.innerHTML = "";

    if (volumeList.length === 0) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.disabled = true;
      placeholder.selected = true;
      placeholder.textContent = "No folders — click + to create";
      volSelect.appendChild(placeholder);
    } else {
      volumeList.forEach(folder => {
        const option = document.createElement("option");
        option.value = folder;
        option.textContent = folder;
        volSelect.appendChild(option);
      });
      if (currentVal && state.knownVolumeFolders.has(currentVal)) {
        volSelect.value = currentVal;
      } else if (volSelect.options.length > 0) {
        volSelect.selectedIndex = 0;
      }
    }
  }

  const multiTarget = document.getElementById("multiVolumeTargetFolder");
  if (multiTarget) {
    const volumeList = Array.from(state.knownVolumeFolders).sort();
    const currentVal = selectedFolder || (multiTarget.value !== "" ? multiTarget.value : null);
    multiTarget.innerHTML = "";

    if (volumeList.length === 0) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.disabled = true;
      placeholder.selected = true;
      placeholder.textContent = "No folders — click + to create";
      multiTarget.appendChild(placeholder);
    } else {
      volumeList.forEach(folder => {
        const option = document.createElement("option");
        option.value = folder;
        option.textContent = folder;
        multiTarget.appendChild(option);
      });
      if (currentVal && state.knownVolumeFolders.has(currentVal)) {
        multiTarget.value = currentVal;
      } else if (multiTarget.options.length > 0) {
        multiTarget.selectedIndex = 0;
      }
    }
  }
}

// Window attachment for backward compatibility
window.syncFolderDropdowns = syncFolderDropdowns;

export function openUniversalSaveModal() {
  const universalSaveModal = document.getElementById("universalSaveModal");
  const universalSaveName = document.getElementById("universalSaveName");
  const universalSaveFolder = document.getElementById("universalSaveFolder");
  const saveModalTypeBadge = document.getElementById("saveModalTypeBadge");
  const saveModalMetricsPreview = document.getElementById("saveModalMetricsPreview");

  if (!universalSaveModal) return;
  universalSaveModal.classList.remove("hidden");
  const nameGroup = universalSaveName ? universalSaveName.parentElement : null;
  if (nameGroup) nameGroup.style.display = "block";

  if (universalSaveName) {
    universalSaveName.classList.remove("input-invalid");
    universalSaveName.value = "";
  }
  if (universalSaveFolder) {
    universalSaveFolder.classList.remove("input-invalid");
  }

  if (state.activeInfoTool === "PROFILE") {
    if (saveModalTypeBadge) saveModalTypeBadge.textContent = "📈 Path Profile";
    const dist3D = document.getElementById("profile3D")?.textContent || "0.00 m";
    if (saveModalMetricsPreview) saveModalMetricsPreview.textContent = `3D: ${dist3D}`;
    setTimeout(() => universalSaveName?.focus(), 60);
  } else if (state.activeInfoTool === "VOLUME") {
    if (state.volumeSaveMode === "BATCH" && state.multiKmlPolygons && state.multiKmlPolygons.length > 0) {
      const selected = state.multiKmlPolygons.filter(p => p.selected);
      if (saveModalTypeBadge) saveModalTypeBadge.textContent = `🧊 Multi-Volume (${selected.length} Areas)`;
      const totalNet = selected.reduce((acc, p) => acc + (p.metrics?.netVolumeNum || 0), 0);
      const sign = totalNet >= 0 ? "+" : "";
      if (saveModalMetricsPreview) saveModalMetricsPreview.textContent = `Total Net: ${sign}${totalNet.toLocaleString(undefined, { maximumFractionDigits: 1 })} m³`;
      if (universalSaveName) universalSaveName.value = "Selected Areas";
      if (nameGroup) nameGroup.style.display = "none";
    } else {
      const poly = (state.multiKmlPolygons && state.multiKmlPolygons[state.activeKmlPolyIndex])
        ? state.multiKmlPolygons[state.activeKmlPolyIndex]
        : null;
      const polyName = poly?.name || "Volume Area";
      if (saveModalTypeBadge) saveModalTypeBadge.textContent = `🧊 Volume: ${polyName}`;
      const net = poly?.metrics?.netVolume || document.getElementById("volMiniNet")?.textContent || "0 m³";
      if (saveModalMetricsPreview) saveModalMetricsPreview.textContent = `Net: ${net}`;
      if (universalSaveName) universalSaveName.value = polyName;

      if (poly && nameGroup) {
        nameGroup.style.display = "none";
      } else {
        setTimeout(() => universalSaveName?.focus(), 60);
      }
    }
  } else if (state.activeInfoTool === "BOX_ROI" || state.activeInfoTool === "POLY_ROI") {
    if (saveModalTypeBadge) saveModalTypeBadge.textContent = "✂️ ROI Boundary";
    const area = (document.getElementById("boxRoiArea") || document.getElementById("polyRoiArea"))?.textContent || "0 m²";
    if (saveModalMetricsPreview) saveModalMetricsPreview.textContent = `Area: ${area}`;
    setTimeout(() => universalSaveName?.focus(), 60);
  } else if (state.activeInfoTool === "POINT") {
    if (saveModalTypeBadge) saveModalTypeBadge.textContent = "📍 Point Pin";
    const elev = document.getElementById("pointMiniElev")?.textContent || "-";
    if (saveModalMetricsPreview) saveModalMetricsPreview.textContent = `Elev: ${elev}`;
    setTimeout(() => universalSaveName?.focus(), 60);
  }

  const folderGroup = document.getElementById("universalSaveFolderGroup");
  if (folderGroup) {
    if (state.activeInfoTool === "BOX_ROI" || state.activeInfoTool === "POLY_ROI") {
      folderGroup.style.display = "none";
      if (universalSaveFolder) universalSaveFolder.value = "";
    } else {
      folderGroup.style.display = "block";
    }
  }

  syncFolderDropdowns(state.activeInfoTool);
}

export function closeUniversalSaveModal() {
  const universalSaveModal = document.getElementById("universalSaveModal");
  if (universalSaveModal) universalSaveModal.classList.add("hidden");
}

export function showUnifiedInfoPanel(toolType, headerText, data, isSavedView = false) {
  state.activeInfoTool = toolType;
  state.activeToolSaveData = data;

  const unifiedInfoPanel = document.getElementById("unifiedInfoPanel");
  const unifiedInfoTitle = document.getElementById("unifiedInfoTitle");
  const universalSaveName = document.getElementById("universalSaveName");
  const infoViewProfile = document.getElementById("infoViewProfile");
  const infoViewVolume = document.getElementById("infoViewVolume");
  const infoViewBoxRoi = document.getElementById("infoViewBoxRoi");
  const infoViewPolyRoi = document.getElementById("infoViewPolyRoi");
  const infoViewPoint = document.getElementById("infoViewPoint");
  const infoViewGrid = document.getElementById("infoViewGrid");
  const infoViewHeatmap = document.getElementById("infoViewHeatmap");
  const infoViewContour = document.getElementById("infoViewContour");

  if (unifiedInfoTitle) {
    unifiedInfoTitle.textContent = headerText || "INFORMATION PANEL";
    if (!isSavedView) {
      unifiedInfoTitle.classList.remove("editable");
      unifiedInfoTitle.removeAttribute("title");
    }
  }

  if (universalSaveName) {
    universalSaveName.classList.remove("input-invalid");
    universalSaveName.value = "";
  }

  if (!isSavedView) {
    const btnInfoRename = document.getElementById("btnInfoRenameTitle");
    if (btnInfoRename) btnInfoRename.classList.add("hidden");
    const renameCont = document.getElementById("infoInlineRenameContainer");
    if (renameCont) renameCont.classList.add("hidden");
  }

  // Hide all viewports first
  [infoViewProfile, infoViewVolume, infoViewBoxRoi, infoViewPolyRoi, infoViewPoint, infoViewGrid, infoViewHeatmap, infoViewContour].forEach(el => el?.classList.add("hidden"));

  // Toggle visibility of Save buttons inside viewports
  document.querySelectorAll(".info-save-btn").forEach(btn => {
    btn.style.display = isSavedView ? "none" : "flex";
  });

  // Display active tool viewport
  if (toolType === "PROFILE" && infoViewProfile) {
    infoViewProfile.classList.remove("hidden");
    const elevationMiniContainer = document.getElementById("elevationMiniContainer");
    if (elevationMiniContainer) elevationMiniContainer.classList.remove("hidden");
    if (state.miniChart && state.miniChart.width === 0) {
      state.miniChart.destroy();
      state.miniChart = null;
    }
    setTimeout(() => {
      if (typeof window.initCharts === "function") window.initCharts();
      if (state.miniChart) {
        state.miniChart.resize();
        state.miniChart.update();
      }
    }, 100);
  }
  if (toolType === "VOLUME" && infoViewVolume) infoViewVolume.classList.remove("hidden");
  if (toolType === "BOX_ROI" && infoViewBoxRoi) {
    infoViewBoxRoi.classList.remove("hidden");
    const boxPerimEl = document.getElementById("boxRoiPerim");
    const boxAreaEl = document.getElementById("boxRoiArea");
    if (data) {
      const pRaw = data.perim !== undefined ? data.perim : (data.perimeter !== undefined ? data.perimeter : 0);
      const aRaw = data.area !== undefined ? data.area : (data.area2D !== undefined ? data.area2D : 0);
      const p = typeof pRaw === 'string' ? parseFloat(pRaw.replace(/[^0-9.-]/g, '')) || 0 : Number(pRaw || 0);
      const a = typeof aRaw === 'string' ? parseFloat(aRaw.replace(/[^0-9.-]/g, '')) || 0 : Number(aRaw || 0);
      if (boxPerimEl) boxPerimEl.textContent = `${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
      if (boxAreaEl) boxAreaEl.textContent = `${a.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
    }
  }
  if (toolType === "POLY_ROI" && infoViewPolyRoi) {
    infoViewPolyRoi.classList.remove("hidden");
    const polyPerimEl = document.getElementById("polyRoiPerim");
    const polyAreaEl = document.getElementById("polyRoiArea");
    if (data) {
      const pRaw = data.perim !== undefined ? data.perim : (data.perimeter !== undefined ? data.perimeter : 0);
      const aRaw = data.area !== undefined ? data.area : (data.area2D !== undefined ? data.area2D : 0);
      const p = typeof pRaw === 'string' ? parseFloat(pRaw.replace(/[^0-9.-]/g, '')) || 0 : Number(pRaw || 0);
      const a = typeof aRaw === 'string' ? parseFloat(aRaw.replace(/[^0-9.-]/g, '')) || 0 : Number(aRaw || 0);
      if (polyPerimEl) polyPerimEl.textContent = `${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
      if (polyAreaEl) polyAreaEl.textContent = `${a.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
    }
  }
  if (toolType === "POINT" && infoViewPoint) infoViewPoint.classList.remove("hidden");
  if (toolType === "GRID" && infoViewGrid) infoViewGrid.classList.remove("hidden");
  if (toolType === "HEATMAP" && infoViewHeatmap) {
    infoViewHeatmap.classList.remove("hidden");
    const currentMode = document.querySelector('input[name="infoHeatmapMode"]:checked')?.value ||
      document.querySelector('input[name="heatmapMode"]:checked')?.value ||
      'predefined';
    if (typeof window.setHeatmapMode === 'function') {
      window.setHeatmapMode(currentMode);
    }
  }
  if (toolType === "CONTOUR" && infoViewContour) infoViewContour.classList.remove("hidden");

  if (unifiedInfoPanel) unifiedInfoPanel.classList.remove("hidden");
}

export function updateInfoPanelRenameTrigger(featureName) {
  const unifiedInfoTitle = document.getElementById("unifiedInfoTitle");
  const btnInfoRenameTitle = document.getElementById("btnInfoRenameTitle");
  const infoInlineRenameContainer = document.getElementById("infoInlineRenameContainer");
  const infoInlineRenameInput = document.getElementById("infoInlineRenameInput");

  if (unifiedInfoTitle) {
    unifiedInfoTitle.classList.add("editable");
    unifiedInfoTitle.title = "Double-click to rename";
  }
  if (btnInfoRenameTitle) {
    btnInfoRenameTitle.classList.remove("hidden");
  }
  if (infoInlineRenameContainer) {
    infoInlineRenameContainer.classList.add("hidden");
  }
  if (infoInlineRenameInput) {
    infoInlineRenameInput.value = featureName || "";
  }
  isInlineTitleEditing = false;
  originalInlineTitleName = (featureName || "").trim();
}

export function startInlineTitleEdit() {
  const infoInlineRenameContainer = document.getElementById("infoInlineRenameContainer");
  const infoInlineRenameInput = document.getElementById("infoInlineRenameInput");
  if (!state.currentViewingFeature || !infoInlineRenameContainer || !infoInlineRenameInput) return;
  originalInlineTitleName = (state.currentViewingFeature.name || "").trim();
  infoInlineRenameInput.value = originalInlineTitleName;
  infoInlineRenameContainer.classList.remove("hidden");
  isInlineTitleEditing = true;
  infoInlineRenameInput.focus();
  infoInlineRenameInput.select();
}

export function cancelInlineTitleEdit() {
  const infoInlineRenameContainer = document.getElementById("infoInlineRenameContainer");
  const infoInlineRenameInput = document.getElementById("infoInlineRenameInput");
  if (infoInlineRenameContainer) infoInlineRenameContainer.classList.add("hidden");
  if (infoInlineRenameInput) infoInlineRenameInput.value = originalInlineTitleName;
  isInlineTitleEditing = false;
}

export async function handleInfoPanelRename() {
  const infoInlineRenameInput = document.getElementById("infoInlineRenameInput");
  const btnInfoRenameSave = document.getElementById("btnInfoRenameSave");
  const unifiedInfoTitle = document.getElementById("unifiedInfoTitle");
  if (!state.currentViewingFeature || !infoInlineRenameInput) return;
  const newName = infoInlineRenameInput.value.trim();
  if (!newName) {
    await showCustomAlert("Please enter a valid name.", "Invalid Name", "warning");
    return;
  }
  const { type, name: oldName, pdfFile, jsonFile, file, metadata } = state.currentViewingFeature;
  if (newName === oldName) {
    cancelInlineTitleEdit();
    return;
  }

  if (btnInfoRenameSave) {
    btnInfoRenameSave.disabled = true;
  }

  try {
    if (type === "PROFILE") {
      const jsonFileName = jsonFile?.fileName || (pdfFile ? pdfFile.fileName.replace(/\.pdf$/, '.json') : null);
      if (!jsonFileName) throw new Error("Missing profile JSON filename");

      const currentFolder = state.currentViewingFeature.folder || state.currentViewingFeature.metadata?.folder || (pdfFile?.fileName?.includes('/') ? pdfFile.fileName.split('/')[0] : "");
      let meta = Object.assign({}, metadata || {});
      if (jsonFile && jsonFile.url) {
        try {
          const _u = jsonFile.url + (jsonFile.url.includes('?') ? '&' : '?') + `t=${Date.now()}`;
          const gRes = await fetch(_u, { cache: 'no-store' });
          if (gRes.ok) {
            const fresh = await gRes.json();
            meta = Object.assign(meta, fresh);
          }
        } catch (e) {}
      }

      meta.name = newName;
      meta.title = newName;
      if (currentFolder) meta.folder = currentFolder;

      const uploadApiUrl = `${API_BASE}`;
      const res = await fetch(uploadApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: state.activeProject.folderName, surveyId: state.activeProject.surveyId, type: "reports", fileName: jsonFileName, folder: getReportsFolder() })
      });
      if (!res.ok) throw new Error("Failed to get upload URL");
      const { uploadUrl } = await res.json();
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meta, null, 2)
      });
      if (!putRes.ok) throw new Error("Failed to upload updated JSON");

      state.currentViewingFeature.name = newName;
      state.currentViewingFeature.metadata = meta;
      if (currentFolder) state.currentViewingFeature.folder = currentFolder;
      if (unifiedInfoTitle) unifiedInfoTitle.textContent = `SAVED PATH PROFILE: ${newName.toUpperCase()}`;
      updateInfoPanelRenameTrigger(newName);
      if (typeof window.fetchSavedReports === "function") await window.fetchSavedReports();
    } else if (type === "VOLUME") {
      const fileName = file?.fileName;
      if (!fileName) throw new Error("Missing volume filename");

      const currentFolder = state.currentViewingFeature.folder || state.currentViewingFeature.metadata?.folder || (file?.fileName?.includes('/') ? file.fileName.split('/')[0] : "");
      let meta = Object.assign({}, metadata || {});
      if (file && file.url) {
        try {
          const _u = file.url + (file.url.includes('?') ? '&' : '?') + `t=${Date.now()}`;
          const gRes = await fetch(_u, { cache: 'no-store' });
          if (gRes.ok) {
            const fresh = await gRes.json();
            meta = Object.assign(meta, fresh);
          }
        } catch (e) {}
      }

      meta.name = newName;
      meta.title = newName;
      if (currentFolder) meta.folder = currentFolder;

      const uploadApiUrl = `${API_BASE}`;
      const res = await fetch(uploadApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: state.activeProject.folderName, surveyId: state.activeProject.surveyId, type: "volumes", fileName, folder: getReportsFolder() })
      });
      if (!res.ok) throw new Error("Failed to get upload URL");
      const { uploadUrl } = await res.json();
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meta, null, 2)
      });
      if (!putRes.ok) throw new Error("Failed to upload updated JSON");

      state.currentViewingFeature.name = newName;
      state.currentViewingFeature.metadata = meta;
      state.currentViewingFeature.folder = currentFolder;
      if (unifiedInfoTitle) unifiedInfoTitle.textContent = `SAVED VOLUME: ${newName.toUpperCase()}`;
      updateInfoPanelRenameTrigger(newName);
      if (typeof window.fetchSavedVolumes === "function") await window.fetchSavedVolumes();
    } else if (type === "POLY_ROI" || type === "ROI" || type === "BOX_ROI") {
      const fileName = file?.fileName || jsonFile?.fileName || (file?.url ? file.url.split('?')[0].split('/').pop() : null);
      if (!fileName) throw new Error("Missing ROI filename");
      let meta = Object.assign({}, metadata || {});
      if (file && file.url) {
        try {
          const _u = file.url + (file.url.includes('?') ? '&' : '?') + `t=${Date.now()}`;
          const gRes = await fetch(_u, { cache: 'no-store' });
          if (gRes.ok) {
            const fresh = await gRes.json();
            meta = Object.assign(meta, fresh);
          }
        } catch (e) {}
      }

      meta.name = newName;
      meta.title = newName;
      if (!meta.folder && metadata?.folder) meta.folder = metadata.folder;
      if (!meta.points && state.roiPolyPoints && state.roiPolyPoints.length > 0) {
        meta.points = state.roiPolyPoints.map(p => ({ x: p.coord.x, y: p.coord.y, z: p.coord.z || 0 }));
      }

      const uploadApiUrl = `${API_BASE}`;
      const res = await fetch(uploadApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: state.activeProject.folderName, surveyId: state.activeProject.surveyId, type: "rois", fileName, folder: getReportsFolder() })
      });
      if (!res.ok) throw new Error("Failed to get upload URL");
      const { uploadUrl } = await res.json();
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meta, null, 2)
      });
      if (!putRes.ok) throw new Error("Failed to upload updated JSON");

      state.currentViewingFeature.name = newName;
      state.currentViewingFeature.metadata = meta;
      if (unifiedInfoTitle) unifiedInfoTitle.textContent = `SAVED ROI: ${newName.toUpperCase()}`;
      updateInfoPanelRenameTrigger(newName);
      if (typeof window.fetchSavedRois === "function") await window.fetchSavedRois();
    }

    cancelInlineTitleEdit();
  } catch (err) {
    console.error("Rename error:", err);
    await showCustomAlert("Failed to rename: " + err.message, "Error", "error");
  } finally {
    if (btnInfoRenameSave) btnInfoRenameSave.disabled = false;
  }
}

export function initInfoPanelUI() {
  const closeInfoPanelBtn = document.getElementById("closeInfoPanelBtn");
  const unifiedInfoPanel = document.getElementById("unifiedInfoPanel");
  const unifiedInfoTitle = document.getElementById("unifiedInfoTitle");
  const btnInfoRenameTitle = document.getElementById("btnInfoRenameTitle");
  const infoInlineRenameInput = document.getElementById("infoInlineRenameInput");
  const btnInfoRenameSave = document.getElementById("btnInfoRenameSave");
  const btnInfoRenameCancel = document.getElementById("btnInfoRenameCancel");
  const btnCloseSaveModal = document.getElementById("btnCloseSaveModal");
  const btnCancelSaveModal = document.getElementById("btnCancelSaveModal");
  const btnUniversalSave = document.getElementById("btnUniversalSave");
  const btnUniversalNewFolder = document.getElementById("btnUniversalNewFolder");
  const universalSaveName = document.getElementById("universalSaveName");
  const universalSaveFolder = document.getElementById("universalSaveFolder");

  closeInfoPanelBtn?.addEventListener("click", () => {
    if (unifiedInfoPanel) unifiedInfoPanel.classList.add("hidden");
    closeUniversalSaveModal();
    state.activeInfoTool = null;
    state.activeToolSaveData = null;
  });

  // Open Save Modal triggers from Viewports
  document.getElementById("btnSaveFromInfoProfile")?.addEventListener("click", openUniversalSaveModal);
  document.getElementById("btnSaveFromInfoVolume")?.addEventListener("click", openUniversalSaveModal);
  document.getElementById("btnSaveFromInfoBoxRoi")?.addEventListener("click", openUniversalSaveModal);
  document.getElementById("btnSaveFromInfoPolyRoi")?.addEventListener("click", openUniversalSaveModal);
  document.getElementById("btnSaveFromInfoPoint")?.addEventListener("click", openUniversalSaveModal);

  btnCloseSaveModal?.addEventListener("click", closeUniversalSaveModal);
  btnCancelSaveModal?.addEventListener("click", closeUniversalSaveModal);

  universalSaveName?.addEventListener("input", () => {
    if (universalSaveName.value.trim()) universalSaveName.classList.remove("input-invalid");
  });
  universalSaveFolder?.addEventListener("change", () => {
    if (universalSaveFolder.value?.trim()) universalSaveFolder.classList.remove("input-invalid");
  });

  // Inline rename interactions
  unifiedInfoTitle?.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    startInlineTitleEdit();
  });
  btnInfoRenameTitle?.addEventListener("click", (e) => {
    e.stopPropagation();
    startInlineTitleEdit();
  });
  btnInfoRenameCancel?.addEventListener("click", (e) => {
    e.stopPropagation();
    cancelInlineTitleEdit();
  });
  btnInfoRenameSave?.addEventListener("click", (e) => {
    e.stopPropagation();
    handleInfoPanelRename();
  });

  infoInlineRenameInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      isInlineTitleEditing = false;
      handleInfoPanelRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelInlineTitleEdit();
    }
  });

  infoInlineRenameInput?.addEventListener("blur", () => {
    if (!isInlineTitleEditing) return;
    const currentVal = infoInlineRenameInput.value.trim();
    setTimeout(() => {
      if (!isInlineTitleEditing) return;
      if (currentVal && currentVal !== originalInlineTitleName) {
        showCustomConfirm(`Save changes to "${currentVal}"?`, "Save Rename").then((confirmed) => {
          if (confirmed) {
            isInlineTitleEditing = false;
            handleInfoPanelRename();
          } else {
            cancelInlineTitleEdit();
          }
        });
      } else {
        cancelInlineTitleEdit();
      }
    }, 180);
  });

  btnUniversalNewFolder?.addEventListener("click", async () => {
    const isProfile = state.activeInfoTool === "PROFILE";
    const typeLabel = isProfile ? "Path Profile" : "Volume";
    const newFolder = await showCustomPrompt(`Enter new folder name for ${typeLabel}:`, "", "New Folder");
    if (newFolder && newFolder.trim() !== "") {
      const trimmed = newFolder.trim();
      if (universalSaveFolder) universalSaveFolder.classList.remove("input-invalid");
      if (isProfile) {
        addKnownProfileFolder(trimmed, true, trimmed);
        if (typeof window.fetchSavedReports === "function") await window.fetchSavedReports();
        syncFolderDropdowns("PROFILE", trimmed);
      } else {
        addKnownVolumeFolder(trimmed, true, trimmed);
        if (typeof window.fetchSavedVolumes === "function") await window.fetchSavedVolumes();
        syncFolderDropdowns("VOLUME", trimmed);
      }
    }
  });

  // Universal Save execution
  btnUniversalSave?.addEventListener("click", async () => {
    let nameVal = universalSaveName ? universalSaveName.value.trim() : "";

    if (state.activeInfoTool === "VOLUME" && state.multiKmlPolygons && state.multiKmlPolygons.length > 0) {
      if (state.volumeSaveMode === "BATCH") {
        nameVal = nameVal || "Multi-Volume";
      } else {
        const poly = state.multiKmlPolygons[state.activeKmlPolyIndex];
        nameVal = poly?.name || nameVal || "Volume Area";
      }
    }

    if (!nameVal) {
      if (universalSaveName) {
        universalSaveName.classList.add("input-invalid");
        universalSaveName.focus();
      }
      await showCustomAlert("Please enter a name before saving.", "Name Required", "warning");
      return;
    }

    if (universalSaveName) universalSaveName.classList.remove("input-invalid");

    const folderVal = universalSaveFolder ? universalSaveFolder.value?.trim() : "";
    if ((state.activeInfoTool === "PROFILE" || state.activeInfoTool === "VOLUME") && !folderVal) {
      if (universalSaveFolder) {
        universalSaveFolder.classList.add("input-invalid");
        universalSaveFolder.focus();
      }
      await showCustomAlert("Please select or create a folder before saving (click + to create).", "Folder Required", "warning");
      return;
    }
    if (universalSaveFolder) universalSaveFolder.classList.remove("input-invalid");

    const originalText = btnUniversalSave.textContent;
    btnUniversalSave.textContent = "Saving...";
    btnUniversalSave.disabled = true;

    try {
      if (!state.activeProject) throw new Error("No active project");

      if (state.activeInfoTool === "PROFILE") {
        const safeReportName = nameVal.replace(/\s+/g, '_');
        if (typeof window.generateReportPDF !== "function") throw new Error("PDF generator not initialized");
        const doc = window.generateReportPDF(nameVal);
        const pdfBlob = doc.output('blob');

        const metadata = {
          isOfficial: !window.isDumpDraw,
          folder: folderVal,
          name: nameVal,
          startPoint: state.measureStartPoint ? { x: state.measureStartPoint.x, y: state.measureStartPoint.y, z: state.measureStartPoint.z } : null,
          endPoint: state.measureEndPoint ? { x: state.measureEndPoint.x, y: state.measureEndPoint.y, z: state.measureEndPoint.z } : null,
          startCoord: state.measureStartCoord ? { x: state.measureStartCoord.x, y: state.measureStartCoord.y, z: state.measureStartCoord.z } : null,
          endCoord: state.measureEndCoord ? { x: state.measureEndCoord.x, y: state.measureEndCoord.y, z: state.measureEndCoord.z } : null,
          chartData: {
            distances: state.miniChart?.data.labels || [],
            elevations: state.miniChart?.data.datasets[0].data || [],
            comparisonData: (state.miniChart?.data?.datasets?.length > 1) ? {
              surveyKey: state.ibmComparisonPastSurveyKey,
              label: state.miniChart.data.datasets[1].label,
              elevations: state.miniChart.data.datasets[1].data,
              maxCut: parseFloat(document.getElementById("profileMaxCut")?.textContent) || 0,
              maxFill: parseFloat(document.getElementById("profileMaxFill")?.textContent) || 0,
            } : null,
            currentProfileData: state.currentProfileData,
            totalDist: parseFloat(document.getElementById("profileHoriz")?.textContent) || 0,
            elevChange: parseFloat(document.getElementById("profileVert")?.textContent) || 0,
            surfDist: parseFloat(document.getElementById("profile3D")?.textContent) || 0
          }
        };
        const jsonBlob = new Blob([JSON.stringify(metadata)], { type: "application/json" });

        // Upload PDF
        const pdfRes = await fetch(API_BASE, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: state.activeProject.folderName, surveyId: state.activeProject.surveyId, type: "reports", fileName: `${safeReportName}.pdf`, folder: getReportsFolder() })
        });
        if (!pdfRes.ok) throw new Error("Failed to get PDF upload URL");
        const { uploadUrl: pdfUploadUrl } = await pdfRes.json();
        const pdfPut = await fetch(pdfUploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: pdfBlob });
        if (!pdfPut.ok) throw new Error("Failed to upload PDF to cloud storage");

        // Upload JSON
        const jsonRes = await fetch(API_BASE, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: state.activeProject.folderName, surveyId: state.activeProject.surveyId, type: "reports", fileName: `${safeReportName}.json`, folder: getReportsFolder() })
        });
        if (!jsonRes.ok) throw new Error("Failed to get data upload URL");
        const { uploadUrl: jsonUploadUrl } = await jsonRes.json();
        const jsonPut = await fetch(jsonUploadUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: jsonBlob });
        if (!jsonPut.ok) throw new Error("Failed to upload data to cloud storage");

        if (typeof window.fetchSavedReports === "function") window.fetchSavedReports();

      } else if (state.activeInfoTool === "VOLUME") {
        if (state.volumeSaveMode === "BATCH" && state.multiKmlPolygons && state.multiKmlPolygons.length > 0) {
          const selected = state.multiKmlPolygons.filter(p => p.selected);
          const count = selected.length;
          for (let i = 0; i < count; i++) {
            btnUniversalSave.textContent = `Saving (${i + 1}/${count})...`;
            const poly = selected[i];
            const cleanName = poly.name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
            const fileName = `${folderVal}/${cleanName}_${Date.now() + i}.json`;

            const polyData = {
              name: poly.name,
              title: poly.name,
              folder: folderVal,
              isOfficial: !window.isDumpDraw,
              timestamp: new Date().toISOString(),
              area2D: poly.metrics?.area2D || "0 m²",
              perimeter: poly.metrics?.perimeter || "0 m",
              cutVolume: poly.metrics?.cutVolume || "0 m³",
              fillVolume: poly.metrics?.fillVolume || "0 m³",
              netVolume: poly.metrics?.netVolume || "0 m³",
              points: poly.volumePoints.map(p => ({
                x: p.coord ? p.coord.x : p.point.x,
                y: p.coord ? p.coord.y : p.point.y,
                z: p.coord ? p.coord.z : p.point.z
              }))
            };

            const volRes = await fetch(API_BASE, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ projectId: state.activeProject.folderName, surveyId: state.activeProject.surveyId, type: "volumes", fileName, folder: getReportsFolder() })
            });
            if (!volRes.ok) throw new Error(`Failed to get upload URL for "${poly.name}"`);
            const { uploadUrl } = await volRes.json();

            const putRes = await fetch(uploadUrl, {
              method: "PUT", headers: { "Content-Type": "application/json" },
              body: JSON.stringify(polyData, null, 2)
            });
            if (!putRes.ok) throw new Error(`Failed to upload "${poly.name}"`);
          }

          closeUniversalSaveModal();
          await showCustomAlert(`Successfully saved ${count} areas to folder "${folderVal}"!`, "Saved Successfully", "success");
          if (typeof window.fetchSavedVolumes === "function") window.fetchSavedVolumes();
          state.isMultiSaveMode = false;
          if (typeof window.renderMultiVolumeUIState === "function") window.renderMultiVolumeUIState();
          return;
        }

        // Standard Single Volume Save
        const poly = (state.multiKmlPolygons && state.multiKmlPolygons[state.activeKmlPolyIndex])
          ? state.multiKmlPolygons[state.activeKmlPolyIndex]
          : null;
        const activePoints = poly ? poly.volumePoints : state.volumePoints;
        const finalName = poly?.name || nameVal;

        const data = {
          name: finalName,
          title: finalName,
          folder: folderVal,
          isOfficial: !window.isDumpDraw,
          timestamp: new Date().toISOString(),
          area2D: poly ? (poly.metrics?.area2D || "0 m²") : (document.getElementById("volMiniArea")?.textContent || "0 m²"),
          perimeter: poly ? (poly.metrics?.perimeter || "0 m") : (document.getElementById("volMiniPerim")?.textContent || "0 m"),
          cutVolume: poly ? (poly.metrics?.cutVolume || "0 m³") : (document.getElementById("volMiniCut")?.textContent || "0 m³"),
          fillVolume: poly ? (poly.metrics?.fillVolume || "0 m³") : (document.getElementById("volMiniFill")?.textContent || "0 m³"),
          netVolume: poly ? (poly.metrics?.netVolume || "0 m³") : (document.getElementById("volMiniNet")?.textContent || "0 m³"),
          points: activePoints.map(p => ({
            x: p.coord ? p.coord.x : p.point.x,
            y: p.coord ? p.coord.y : p.point.y,
            z: p.coord ? p.coord.z : p.point.z
          }))
        };

        const safeName = finalName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const fileName = `${folderVal}/${safeName}_${Date.now()}.json`;

        const volRes = await fetch(API_BASE, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: state.activeProject.folderName, surveyId: state.activeProject.surveyId, type: "volumes", fileName, folder: getReportsFolder() })
        });
        if (!volRes.ok) throw new Error("Failed to get volume upload URL");
        const { uploadUrl } = await volRes.json();

        const putRes = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data, null, 2) });
        if (!putRes.ok) throw new Error("Failed to upload volume data");

        closeUniversalSaveModal();
        await showCustomAlert(`Successfully saved "${finalName}" to folder "${folderVal}"!`, "Saved Successfully", "success");
        if (typeof window.fetchSavedVolumes === "function") window.fetchSavedVolumes();
        return;

      } else if (state.activeInfoTool === "BOX_ROI" || state.activeInfoTool === "POLY_ROI") {
        let points = [];
        let metrics = { area: 0, perimeter: 0 };
        const isBoxTool = state.activeInfoTool === "BOX_ROI";
        let boxBounds = null;

        if (state.activeInfoTool === "POLY_ROI") {
          points = state.roiPolyPoints.map(p => ({ x: p.coord.x, y: p.coord.y, z: p.coord.z || 0 }));
          if (typeof window.calculateRoiPolyMetrics === "function") {
            metrics = window.calculateRoiPolyMetrics();
          }
        } else if (isBoxTool) {
          const b = window._lastBoxRoiBounds || state.activeToolSaveData?.bounds || (state.activeToolSaveData?.minX !== undefined ? state.activeToolSaveData : null);
          if (b) {
            boxBounds = { minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY };
            const z0 = state.activeProject?.zOffset || 0;
            points = [
              { x: b.minX, y: b.minY, z: z0 },
              { x: b.maxX, y: b.minY, z: z0 },
              { x: b.maxX, y: b.maxY, z: z0 },
              { x: b.minX, y: b.maxY, z: z0 }
            ];
            const w = Math.abs(b.maxX - b.minX);
            const h = Math.abs(b.maxY - b.minY);
            const a = state.activeToolSaveData?.area || state.activeToolSaveData?.area2D || (w * h);
            const p = state.activeToolSaveData?.perim || state.activeToolSaveData?.perimeter || (2 * (w + h));
            metrics = {
              area: typeof a === 'number' ? a : (parseFloat(String(a).replace(/[^0-9.-]/g, '')) || 0),
              perimeter: typeof p === 'number' ? p : (parseFloat(String(p).replace(/[^0-9.-]/g, '')) || 0)
            };
          }
        }

        const data = {
          name: nameVal,
          folder: folderVal,
          isOfficial: !window.isDumpDraw,
          timestamp: new Date().toISOString(),
          roiType: state.activeInfoTool,
          area2D: metrics.area || 0,
          perimeter: metrics.perimeter || 0,
          bounds: boxBounds,
          points
        };

        const safeName = nameVal.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const fileName = `${safeName}_${Date.now()}.json`;

        const res = await fetch(API_BASE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: state.activeProject.folderName, surveyId: state.activeProject.surveyId, type: "rois", fileName, folder: getReportsFolder() })
        });
        if (!res.ok) throw new Error("Failed to get ROI upload URL");
        const { uploadUrl } = await res.json();
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data, null, 2)
        });
        if (!putRes.ok) throw new Error("Failed to upload ROI data");

        state.currentViewingFeature = {
          type: state.activeInfoTool,
          name: nameVal,
          file: { fileName },
          metadata: data
        };

        if (typeof window.fetchSavedRois === "function") window.fetchSavedRois();
      }

      const savedMsg = (state.activeInfoTool === "PROFILE" || state.activeInfoTool === "VOLUME")
        ? `Saved "${nameVal}" to folder '${folderVal}'!`
        : `Saved "${nameVal}" successfully!`;
      await showCustomAlert(savedMsg, "Saved Successfully", "success");
      closeUniversalSaveModal();
      showUnifiedInfoPanel(state.activeInfoTool, "SAVED ITEM", null, true);

    } catch (err) {
      console.error("Save error:", err);
      await showCustomAlert("Error saving item: " + err.message, "Save Error", "error");
    } finally {
      btnUniversalSave.textContent = originalText;
      btnUniversalSave.disabled = false;
    }
  });
}
