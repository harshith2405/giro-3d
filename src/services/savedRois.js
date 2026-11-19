// src/services/savedRois.js
// Saved Box & Polygon ROIs Store, Dynamic Ingestion, Terrain Restorations & Quick Info

import { Vector3 } from "three";
import Extent from "@giro3d/giro3d/core/geographic/Extent.js";
import Coordinates from "@giro3d/giro3d/core/geographic/Coordinates.js";
import { giroCrs } from "../config/crs.js";
import { state } from "../core/state.js";
import { getActiveProjectConfig } from "../config/projects.js";
import { loadProject } from "../core/projectLoader.js";
import { frameCameraOnExtent } from "../core/camera.js";
import { getReportsFolder } from "../ui/roleGating.js";
import { showCustomAlert, showCustomConfirm, showCustomPrompt } from "../ui/dialogs.js";
import { showQuickInfoPopover, hideQuickInfoPopover } from "../ui/popover.js";
import { showUnifiedInfoPanel, updateInfoPanelRenameTrigger } from "../ui/infoPanel.js";
import { deleteFile } from "./api.js";
import { clearAllLeftPanelState } from "./clearState.js";
import { updateRoiWorkspaceBadge } from "../tools/roiState.js";
import { updateRoiPolySvg, applyRoiPolyClipping } from "../tools/roi.js";

/** Load a saved Box ROI or Polygon ROI onto the 3D terrain */
export async function loadRoiArea(url, fileObj = null, preloadedMeta = null) {
  try {
    clearAllLeftPanelState(true);
    let data = preloadedMeta;
    if (!data) {
      const _cacheBuster = url.includes("?") ? `&t=${Date.now()}` : `?t=${Date.now()}`;
      const res = await fetch(url + _cacheBuster, { cache: "no-store" });
      data = await res.json();
    }
    if (!data) {
      console.error("Invalid ROI data:", data);
      return;
    }

    const roiDisplayName = data.name || data.title || (fileObj ? fileObj.fileName.split("/").pop().replace(".json", "") : "SAVED ROI");

    const isBox = data.roiType === "BOX_ROI" || data.type === "BOX_ROI" || (data.bounds && (!data.points || data.points.length <= 4)) || (data.points && data.points.length === 4 && data.bounds);
    const resetROI = document.getElementById("resetROI");
    const roiHint = document.getElementById("roiHint");
    const roiArea = document.getElementById("roiArea");
    const roiPerimeter = document.getElementById("roiPerimeter");
    const roiMetrics = document.getElementById("roiMetrics");

    if (isBox) {
      let minX, maxX, minY, maxY;
      if (data.bounds) {
        minX = data.bounds.minX;
        maxX = data.bounds.maxX;
        minY = data.bounds.minY;
        maxY = data.bounds.maxY;
      } else if (data.points && data.points.length > 0) {
        minX = Math.min(...data.points.map(p => p.x));
        maxX = Math.max(...data.points.map(p => p.x));
        minY = Math.min(...data.points.map(p => p.y));
        maxY = Math.max(...data.points.map(p => p.y));
      } else {
        console.error("Box ROI missing bounds/points:", data);
        await showCustomAlert("This Box ROI file has no boundary points stored.", "Cannot Load ROI", "warning");
        return;
      }

      window._lastBoxRoiBounds = { minX, maxX, minY, maxY };
      const clipExtent = new Extent(giroCrs, minX, maxX, minY, maxY);
      const clipProject = getActiveProjectConfig();
      state.isTerrainClippedToRoi = true;
      updateRoiWorkspaceBadge(roiDisplayName || "Box ROI");

      if (resetROI) resetROI.disabled = false;
      if (roiHint) roiHint.textContent = `Viewing Box ROI: ${roiDisplayName}. Click 'Reset' to restore full map.`;

      frameCameraOnExtent(clipExtent, true);
      await loadProject(clipProject, clipExtent);

      const z0 = state.activeProject?.zOffset || 0;
      state.roiPolyPoints = [
        { coord: new Coordinates(giroCrs, minX, minY, z0), point: new Vector3(minX, minY, z0) },
        { coord: new Coordinates(giroCrs, maxX, minY, z0), point: new Vector3(maxX, minY, z0) },
        { coord: new Coordinates(giroCrs, maxX, maxY, z0), point: new Vector3(maxX, maxY, z0) },
        { coord: new Coordinates(giroCrs, minX, maxY, z0), point: new Vector3(minX, maxY, z0) }
      ];
      state.measureMode = "ROI_POLY";
      state.measureState = "FINISHED_ROI_POLY";
      updateRoiPolySvg();

      window.currentViewingFeature = {
        type: "BOX_ROI",
        name: roiDisplayName,
        file: fileObj || { fileName: url.split("?")[0].split("/").pop() },
        metadata: data
      };

      showUnifiedInfoPanel("BOX_ROI", roiDisplayName, data, true);
      updateInfoPanelRenameTrigger(roiDisplayName);

    } else {
      if (!data.points || data.points.length === 0) {
        console.error("Invalid Polygon ROI data (no points):", data);
        await showCustomAlert("This Polygon ROI has no points stored.", "Cannot Load ROI", "warning");
        return;
      }

      state.roiPolyPoints = data.points.map(pt => ({
        coord: new Coordinates(giroCrs, pt.x, pt.y, pt.z || 0),
        point: new Vector3(pt.x, pt.y, pt.z || 0)
      }));

      state.measureMode = "ROI_POLY";
      state.measureState = "FINISHED_ROI_POLY";
      state.roiPolyMousePoint = null;
      if (roiArea) roiArea.textContent = (data.area2D || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
      if (roiPerimeter) roiPerimeter.textContent = (data.perimeter || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
      if (roiMetrics) roiMetrics.classList.remove("hidden");
      if (resetROI) resetROI.disabled = false;

      window.currentViewingFeature = {
        type: "POLY_ROI",
        name: roiDisplayName,
        file: fileObj || { fileName: url.split("?")[0].split("/").pop() },
        metadata: data
      };

      showUnifiedInfoPanel("POLY_ROI", roiDisplayName, data, true);
      updateInfoPanelRenameTrigger(roiDisplayName);

      applyRoiPolyClipping();
    }
  } catch (err) {
    console.error("Error loading ROI", err);
  }
}

/** Fetch saved ROIs from backend API gateway */
export async function fetchSavedRois() {
  const featuresListRois = document.getElementById("featuresListRois");
  const leftRoisList = document.getElementById("leftRoisList");
  if (featuresListRois) featuresListRois.innerHTML = '<i style="color: var(--muted); padding: 4px;">Loading...</i>';
  if (leftRoisList) leftRoisList.innerHTML = '<i style="color: var(--muted); padding: 4px;">Loading...</i>';

  try {
    if (!state.activeProject) return;
    const apiUrl = `https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url?projectId=${state.activeProject.folderName}&surveyId=${state.activeProject.surveyId}&type=rois&folder=${encodeURIComponent(getReportsFolder())}`;
    const response = await fetch(apiUrl, { method: "GET", cache: "no-store" });
    if (!response.ok) throw new Error("Failed to fetch ROIs");
    const files = await response.json();
    const jsonFiles = files.filter(f => f.fileName.endsWith(".json"));

    if (jsonFiles.length === 0) {
      if (featuresListRois) featuresListRois.innerHTML = '<i style="color: var(--muted); padding: 4px;">No ROI areas saved yet.</i>';
      if (leftRoisList) leftRoisList.innerHTML = '<i style="color: var(--muted); padding: 4px;">No ROI areas saved yet.</i>';
      return;
    }

    const roiItemsData = await Promise.all(jsonFiles.map(async file => {
      let metadata = null;
      try {
        const _url = file.url;
        const _cacheBuster = _url.includes("?") ? `&t=${Date.now()}` : `?t=${Date.now()}`;
        const res = await fetch(_url + _cacheBuster, { cache: "no-store" });
        if (res.ok) metadata = await res.json();
      } catch (e) {}
      const niceName = metadata?.name || metadata?.title || file.fileName.split("/").pop().replace(".json", "");
      return { file, metadata, niceName };
    }));

    if (featuresListRois) featuresListRois.innerHTML = "";
    if (leftRoisList) leftRoisList.innerHTML = "";

    for (const { file, metadata, niceName } of roiItemsData) {
      const createRoiItem = () => {
        const item = document.createElement("div");
        item.className = "saved-report-item";
        const renameRoiBtnHtml = `<button class="btn-row-rename-icon btn-row-rename-roi" data-filename="${file.fileName}" title="Rename ${niceName}" style="display: ${state.isRoisEditMode ? "inline-flex" : "none"}; background: rgba(94, 25, 234, 0.08); border: 1px solid rgba(94, 25, 234, 0.25); color: #5e19ea; width: 22px; height: 22px; border-radius: 4px; cursor: pointer; align-items: center; justify-content: center; padding: 0;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>`;
        const delRoiBtnHtml = `<button class="btn-row-delete-icon btn-row-delete-roi" data-filename="${file.fileName}" title="Delete ${niceName}" style="display: ${state.isRoisEditMode ? "inline-flex" : "none"};"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`;
        const infoRoiBtnHtml = `<button class="btn-row-info-trigger" title="Quick Info" onclick="event.stopPropagation();"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></button>`;
        item.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
            <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #8b5cf6; flex-shrink: 0;"><polygon points="12 2 22 8.5 18 20 6 20 2 8.5 12 2"></polygon></svg>
              <span class="item-title" style="font-weight: 500; font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${niceName}">${niceName}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: 8px;">
              ${renameRoiBtnHtml}
              ${delRoiBtnHtml}
              ${infoRoiBtnHtml}
            </div>
          </div>
        `;

        const infoBtn = item.querySelector(".btn-row-info-trigger");
        const triggerRoiQuickInfo = () => {
          const areaNum = typeof metadata?.area2D === "number" ? metadata.area2D : (parseFloat(String(metadata?.area2D || metadata?.area || 0).replace(/[^0-9.-]/g, "")) || 0);
          const perimNum = typeof metadata?.perimeter === "number" ? metadata.perimeter : (parseFloat(String(metadata?.perimeter || 0).replace(/[^0-9.-]/g, "")) || 0);
          const ptsCount = metadata?.points ? metadata.points.length : (metadata?.pointsCount || "-");
          const dateStr = file.lastModified ? new Date(file.lastModified).toLocaleDateString() : (metadata?.timestamp ? new Date(metadata.timestamp).toLocaleDateString() : "-");

          const rows = [
            { label: "2D Area", val: areaNum ? `${areaNum.toLocaleString(undefined, { maximumFractionDigits: 2 })} m²` : "-" },
            { label: "Perimeter", val: perimNum ? `${perimNum.toLocaleString(undefined, { maximumFractionDigits: 2 })} m` : "-" },
            { label: "Vertices", val: ptsCount ? `${ptsCount} points` : "-" },
            { label: "Date", val: dateStr }
          ];
          showQuickInfoPopover(infoBtn, "ROI / Shape", niceName, rows);
        };

        infoBtn?.addEventListener("mouseenter", triggerRoiQuickInfo);
        infoBtn?.addEventListener("click", (e) => {
          e.stopPropagation();
          triggerRoiQuickInfo();
        });
        infoBtn?.addEventListener("mouseleave", hideQuickInfoPopover);

        item.addEventListener("click", (e) => {
          if (state.isRoisEditMode || window.isFeatureManageMode || window.isVolumeManageMode) return;
          if (e.target.closest("button")) return;
          document.querySelectorAll(".saved-report-item").forEach(el => el.classList.remove("selected-item"));
          item.classList.add("selected-item");
          loadRoiArea(file.url, file, metadata);
        });

        const renameBtn = item.querySelector(".btn-row-rename-roi");
        renameBtn?.addEventListener("click", async (e) => {
          e.stopPropagation();
          const newName = await showCustomPrompt(`Enter new name for ROI "${niceName}":`, niceName, "Rename ROI");
          if (!newName || newName.trim() === "" || newName.trim() === niceName) return;
          const cleanName = newName.trim();
          try {
            renameBtn.disabled = true;
            let meta = metadata || {};
            meta.name = cleanName;
            meta.title = cleanName;
            const res = await fetch(`https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ projectId: state.activeProject.folderName, surveyId: state.activeProject.surveyId, type: "rois", fileName: file.fileName, folder: getReportsFolder() })
            });
            if (res.ok) {
              const { uploadUrl } = await res.json();
              if (uploadUrl) {
                await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(meta, null, 2) });
              }
            }
            fetchSavedRois();
          } catch (err) {
            console.error("Rename ROI error:", err);
            await showCustomAlert("Failed to rename ROI: " + err.message, "Error", "error");
          }
        });

        const delBtn = item.querySelector(".btn-row-delete-roi");
        delBtn?.addEventListener("click", async (e) => {
          e.stopPropagation();
          const confirmed = await showCustomConfirm(`Delete saved ROI "${niceName}"? This cannot be undone.`, "Delete ROI", true);
          if (confirmed) {
            try {
              delBtn.disabled = true;
              await deleteFile("rois", file.fileName);
              fetchSavedRois();
            } catch (err) {
              console.error("Delete ROI error:", err);
              await showCustomAlert("Failed to delete ROI: " + err.message, "Error", "error");
            }
          }
        });

        return item;
      };

      if (featuresListRois) featuresListRois.appendChild(createRoiItem());
      if (leftRoisList) leftRoisList.appendChild(createRoiItem());
    }
  } catch (err) {
    if (featuresListRois) featuresListRois.innerHTML = '<i style="color: #ef4444; padding: 4px;">Failed to load ROIs.</i>';
    if (leftRoisList) leftRoisList.innerHTML = '<i style="color: #ef4444; padding: 4px;">Failed to load ROIs.</i>';
  }
}

/** Toggle ROIs Manage / Edit Mode */
export function toggleRoisEditMode(enable = !state.isRoisEditMode) {
  state.isRoisEditMode = enable;
  const btnManageRois = document.getElementById("btnManageRois");
  btnManageRois?.classList.toggle("active", state.isRoisEditMode);

  document.querySelectorAll(".btn-row-delete-roi").forEach(el => {
    el.style.display = state.isRoisEditMode ? "inline-flex" : "none";
  });
  document.querySelectorAll(".btn-row-rename-roi").forEach(el => {
    el.style.display = state.isRoisEditMode ? "inline-flex" : "none";
  });
}

/** Initialize Saved ROIs UI bindings */
export function initSavedRoisUI() {
  document.getElementById("btnManageRois")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleRoisEditMode();
  });

  // Attach to window
  window.loadRoiArea = loadRoiArea;
  window.fetchSavedRois = fetchSavedRois;
  window.toggleRoisEditMode = toggleRoisEditMode;
}
