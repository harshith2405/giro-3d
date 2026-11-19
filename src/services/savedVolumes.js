// src/services/savedVolumes.js
// Saved Volumes Store, Folders, S3 Sync, Quick Info Popovers & Multi-Select

import { Vector3 } from "three";
import Coordinates from "@giro3d/giro3d/core/geographic/Coordinates.js";
import { giroCrs } from "../config/crs.js";
import { state } from "../core/state.js";
import { getReportsFolder } from "../ui/roleGating.js";
import { showCustomAlert, showCustomConfirm, showCustomPrompt } from "../ui/dialogs.js";
import { showQuickInfoPopover, hideQuickInfoPopover } from "../ui/popover.js";
import { showUnifiedInfoPanel, updateInfoPanelRenameTrigger, syncFolderDropdowns, addKnownVolumeFolder } from "../ui/infoPanel.js";
import { deleteFile } from "./api.js";
import { clearAllLeftPanelState, restoreFullMapIfClipped } from "./clearState.js";
import { isFeatureInsideActiveRoi, showRoiWorkspaceNotice, hideRoiWorkspaceNotice } from "../tools/roiState.js";
import { updateVolumeSvg } from "../tools/volume.js";
import { updateMultiOverlaySvg } from "../tools/multiOverlay.js";

/** Fetch saved volumes from backend API gateway */
export async function fetchSavedVolumes() {
  const volumesList = document.getElementById("volumesList");
  const featuresListPolygons = document.getElementById("featuresListPolygons");
  const volumesListLoading = document.getElementById("volumesListLoading");

  if (volumesList) volumesList.innerHTML = "";
  if (featuresListPolygons) featuresListPolygons.innerHTML = "";

  try {
    if (!state.activeProject) return;
    let jsonFiles = [];

    try {
      const apiUrl = `https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url?projectId=${encodeURIComponent(state.activeProject.folderName)}&surveyId=${encodeURIComponent(state.activeProject.surveyId)}&type=volumes&folder=${encodeURIComponent(getReportsFolder())}`;
      const response = await fetch(apiUrl, { method: "GET", cache: "no-store" });
      if (response.ok) {
        const rawFiles = await response.json();
        const files = Array.isArray(rawFiles) ? rawFiles : [];
        jsonFiles = files.filter(f => f && f.fileName && f.fileName.endsWith(".json"));
      }
    } catch (netErr) {
      console.warn("Could not load volumes", netErr);
    }

    if (volumesListLoading) volumesListLoading.style.display = "none";

    const volumeFolders = {};
    const allVolumeItems = [];

    for (const file of jsonFiles) {
      try {
        const _url = file.url;
        const _cacheBuster = _url.includes("?") ? `&t=${Date.now()}` : `?t=${Date.now()}`;
        const res = await fetch(_url + _cacheBuster, { cache: "no-store" });
        if (!res.ok) continue;
        const metadata = await res.json();
        const fallbackFolder = file.fileName.includes("/") ? file.fileName.split("/")[0] : "";
        const folderName = (metadata.folder && metadata.folder.trim()) ? metadata.folder.trim() : (fallbackFolder || "General");
        metadata.folder = folderName;

        if (!volumeFolders[folderName]) volumeFolders[folderName] = [];
        const itemObj = { file, metadata };
        volumeFolders[folderName].push(itemObj);
        allVolumeItems.push(itemObj);
      } catch (e) {
        console.error("Error parsing volume json", e);
      }
    }
    window._cachedAllVolumeItems = allVolumeItems;

    state.sessionCreatedVolumeFolders.forEach(f => {
      if (f && typeof f === "string" && f.trim() !== "") {
        const trimmed = f.trim();
        if (!volumeFolders[trimmed]) volumeFolders[trimmed] = [];
      }
    });

    state.knownVolumeFolders.clear();
    Object.keys(volumeFolders).forEach(f => state.knownVolumeFolders.add(f));
    syncFolderDropdowns("VOLUME");

    const renderFolder = (folderName, folderItems, targetContainer) => {
      const folderGroup = document.createElement("div");
      folderGroup.className = "folder-group";

      const svgFolder = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5e19ea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; flex-shrink: 0;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
      const svgChevron = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron-icon" style="transition: transform 0.2s ease; transform: rotate(-90deg);"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

      const fHeader = document.createElement("div");
      fHeader.className = "folder-header";
      fHeader.innerHTML = `
        <span style="display: flex; align-items: center; font-weight: 600; font-size: 13.5px; color: #1e293b;">${svgFolder} ${folderName}</span>
        <div style="display: flex; align-items: center; gap: 6px;">
          <label class="ui-toggle folder-view-toggle" title="View all in ${folderName}" onclick="event.stopPropagation();">
            <input type="checkbox" class="toggle-folder-view-volumes" data-folder="${folderName}">
            <span class="ui-toggle-slider"></span>
          </label>
          <button class="btn-rename-folder-trigger" title="Rename folder" data-folder="${folderName}" data-type="volume" style="display: ${state.isVolumesEditMode ? "inline-flex" : "none"}; background: rgba(94, 25, 234, 0.08); border: 1px solid rgba(94, 25, 234, 0.25); color: #5e19ea; width: 22px; height: 22px; border-radius: 4px; cursor: pointer; align-items: center; justify-content: center; padding: 0;">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <button class="btn-delete-folder-trigger" title="Delete folder & items" data-folder="${folderName}" data-type="volume" style="display: ${state.isVolumesEditMode ? "inline-flex" : "none"}; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); color: #ef4444; width: 22px; height: 22px; border-radius: 4px; cursor: pointer; align-items: center; justify-content: center; padding: 0;">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
          ${svgChevron}
        </div>
      `;

      const folderVolToggle = fHeader.querySelector(".toggle-folder-view-volumes");
      folderVolToggle?.addEventListener("change", (e) => {
        e.stopPropagation();
        const isChecked = e.target.checked;
        if (isChecked) {
          for (const { file, metadata } of folderItems) {
            const uniqueId = file.fileName || metadata?.name || "Volume";
            const volName = metadata?.name || file.fileName.split("/").pop().replace(".json", "");
            state.multiSelectedVolumesMap.set(uniqueId, {
              file,
              metadata,
              data: metadata,
              name: volName,
              folderName: folderName
            });
          }
        } else {
          for (const [key, val] of Array.from(state.multiSelectedVolumesMap.entries())) {
            if (val.folderName === folderName) {
              state.multiSelectedVolumesMap.delete(key);
            }
          }
        }
        updateMultiOverlaySvg();
      });

      const renameBtn = fHeader.querySelector(".btn-rename-folder-trigger");
      renameBtn?.addEventListener("click", async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const newName = await showCustomPrompt(`Enter new name for folder "${folderName}":`, folderName, "Rename Folder");
        if (!newName || newName.trim() === "" || newName.trim() === folderName) return;
        const cleanName = newName.trim();

        renameBtn.disabled = true;
        state.sessionCreatedVolumeFolders.delete(folderName);
        state.sessionCreatedVolumeFolders.add(cleanName);
        state.knownVolumeFolders.delete(folderName);
        state.knownVolumeFolders.add(cleanName);

        for (const { file, metadata } of folderItems) {
          if (file && metadata) {
            try {
              metadata.folder = cleanName;
              const baseFileName = file.fileName.split("/").pop();
              const newFileName = `${cleanName}/${baseFileName}`;
              const jsonBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" });
              const jsonRes = await fetch("https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ projectId: state.activeProject.folderName, surveyId: state.activeProject.surveyId, type: "volumes", fileName: newFileName, folder: getReportsFolder() })
              });
              if (jsonRes.ok) {
                const { uploadUrl } = await jsonRes.json();
                if (uploadUrl) {
                  const putRes = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: jsonBlob });
                  if (putRes.ok && file.fileName !== newFileName) {
                    await deleteFile("volumes", file.fileName).catch(delErr => {
                      console.warn("Could not delete old volume file after rename:", file.fileName, delErr);
                    });
                  }
                }
              }
            } catch (err) {
              console.error("Failed to update folder in volume metadata:", err);
            }
          }
        }
        await fetchSavedVolumes();
        syncFolderDropdowns("VOLUME", cleanName);
      });

      const delBtn = fHeader.querySelector(".btn-delete-folder-trigger");
      delBtn?.addEventListener("click", async (e) => {
        e.stopPropagation();
        e.preventDefault();

        if (folderItems.length === 0) {
          const confirmed = await showCustomConfirm(`Delete empty subfolder "${folderName}"?`, "Delete Folder", true);
          if (confirmed) {
            state.sessionCreatedVolumeFolders.delete(folderName);
            state.knownVolumeFolders.delete(folderName);
            await fetchSavedVolumes();
            syncFolderDropdowns("VOLUME");
          }
          return;
        }

        const confirmed = await showCustomConfirm(`Delete folder "${folderName}" and all ${folderItems.length} volume(s) in it?`, "Delete Folder", true);
        if (confirmed) {
          delBtn.disabled = true;
          delBtn.textContent = "...";
          try {
            const deletePromises = folderItems.map(async ({ file }) => {
              return deleteFile("volumes", file.fileName).catch(() => {});
            });
            await Promise.all(deletePromises);
            state.sessionCreatedVolumeFolders.delete(folderName);
            state.knownVolumeFolders.delete(folderName);
            await fetchSavedVolumes();
            syncFolderDropdowns("VOLUME");
          } catch (err) {
            console.error("Error deleting volume folder items", err);
            await showCustomAlert("Failed to delete all items in volume folder: " + err.message, "Error", "error");
            await fetchSavedVolumes();
          }
        }
      });

      const fContent = document.createElement("div");
      fContent.className = "folder-content";
      fContent.style.display = "none";
      fHeader.addEventListener("click", (e) => {
        if (e.target.closest(".btn-delete-folder-trigger") || e.target.closest(".btn-rename-folder-trigger")) return;
        const isHidden = fContent.style.display === "none";
        fContent.style.display = isHidden ? "flex" : "none";
        const chevron = fHeader.querySelector(".chevron-icon");
        if (chevron) chevron.style.transform = isHidden ? "rotate(0deg)" : "rotate(-90deg)";
      });

      const isFeaturesSection = (targetContainer === featuresListPolygons);
      if (folderItems.length === 0) {
        fContent.innerHTML = `<i style="color: var(--muted); font-size: 11px; padding: 6px 12px; display: block;">No volumes in this folder</i>`;
      } else {
        folderItems.forEach(({ file, metadata }) => {
          const item = document.createElement("div");
          item.className = "saved-report-item";

          const niceName = metadata?.name || metadata?.title || file.fileName.split("/").pop().replace(/_[0-9]+\.json$/, "").replace(/_/g, " ");
          const renameVolBtnHtml = `<button class="btn-row-rename-icon btn-row-rename-vol" data-filename="${file.fileName}" title="Rename ${niceName}" style="display: ${state.isVolumesEditMode ? "inline-flex" : "none"}; background: rgba(94, 25, 234, 0.08); border: 1px solid rgba(94, 25, 234, 0.25); color: #5e19ea; width: 22px; height: 22px; border-radius: 4px; cursor: pointer; align-items: center; justify-content: center; padding: 0;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>`;
          const delVolBtnHtml = `<button class="btn-row-delete-icon btn-row-delete-vol" data-filename="${file.fileName}" title="Delete ${niceName}" style="display: ${state.isVolumesEditMode ? "inline-flex" : "none"};"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`;
          const infoVolBtnHtml = `<button class="btn-row-info-trigger" title="Quick Info" onclick="event.stopPropagation();"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></button>`;
          const svg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`;

          item.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
              <div style="display: flex; align-items: center; flex: 1; min-width: 0; gap: 8px;">
                ${isFeaturesSection ? "" : svg}
                <span class="item-title" style="flex: 1; font-weight: 500; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${niceName}">${niceName}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: 8px;">
                ${renameVolBtnHtml}
                ${delVolBtnHtml}
                ${infoVolBtnHtml}
              </div>
            </div>
          `;

          const renameVolBtn = item.querySelector(".btn-row-rename-vol");
          renameVolBtn?.addEventListener("click", async (e) => {
            e.stopPropagation();
            const newName = await showCustomPrompt(`Enter new name for volume "${niceName}":`, niceName, "Rename Volume");
            if (!newName || newName.trim() === "" || newName.trim() === niceName) return;
            const cleanName = newName.trim();
            try {
              renameVolBtn.disabled = true;
              let meta = Object.assign({}, metadata || {});
              if (file && file.url) {
                try {
                  const _u = file.url + (file.url.includes("?") ? "&" : "?") + `t=${Date.now()}`;
                  const r = await fetch(_u, { cache: "no-store" });
                  if (r.ok) meta = Object.assign(meta, await r.json());
                } catch (err) {}
              }
              meta.name = cleanName;
              meta.title = cleanName;
              if (!meta.folder && metadata?.folder) meta.folder = metadata.folder;
              if (!meta.folder && folderName) meta.folder = folderName;

              const res = await fetch(`https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ projectId: state.activeProject.folderName, surveyId: state.activeProject.surveyId, type: "volumes", fileName: file.fileName, folder: getReportsFolder() })
              });
              if (res.ok) {
                const { uploadUrl } = await res.json();
                if (uploadUrl) {
                  await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(meta, null, 2) });
                }
              }
              fetchSavedVolumes();
            } catch (err) {
              console.error("Rename volume error:", err);
              await showCustomAlert("Failed to rename volume: " + err.message, "Error", "error");
            }
          });

          const infoVolBtn = item.querySelector(".btn-row-info-trigger");
          const triggerVolumeQuickInfo = () => {
            const cutNum = parseFloat(String(metadata?.cutVolume || "").replace(/[^0-9.-]/g, "")) || 0;
            const fillNum = parseFloat(String(metadata?.fillVolume || "").replace(/[^0-9.-]/g, "")) || 0;
            const netVal = metadata?.netVolume || (cutNum - fillNum);
            const netNum = (typeof netVal === "number") ? netVal : (parseFloat(String(netVal).replace(/[^0-9.-]/g, "")) || 0);
            const netSign = netNum >= 0 ? "+" : "";
            const netFormatted = !isNaN(netNum) ? `${netSign}${netNum.toLocaleString(undefined, { maximumFractionDigits: 2 })} m³` : (netVal || "-");

            const rows = [
              { label: "2D Area", val: metadata?.area2D || metadata?.area || "-" },
              { label: "Perimeter", val: metadata?.perimeter || "-" },
              { label: "Cut (Dump)", val: metadata?.cutVolume || "-" },
              { label: "Fill (Void)", val: metadata?.fillVolume || "-" },
              { label: "Net Volume", val: netFormatted },
              { label: "Date", val: new Date(file.lastModified).toLocaleDateString() }
            ];
            showQuickInfoPopover(infoVolBtn, "Volume", niceName, rows);
          };

          infoVolBtn?.addEventListener("mouseenter", triggerVolumeQuickInfo);
          infoVolBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            triggerVolumeQuickInfo();
          });
          infoVolBtn?.addEventListener("mouseleave", hideQuickInfoPopover);

          const delVolBtn = item.querySelector(".btn-row-delete-vol");
          delVolBtn?.addEventListener("click", async (e) => {
            e.stopPropagation();
            const confirmed = await showCustomConfirm(`Are you sure you want to delete volume "${niceName}"? This cannot be undone.`, "Delete Volume", true);
            if (confirmed) {
              try {
                delVolBtn.disabled = true;
                await deleteFile("volumes", file.fileName);
                fetchSavedVolumes();
              } catch (err) {
                await showCustomAlert("Failed to delete volume: " + err.message, "Error", "error");
              }
            }
          });

          const loadVolumeAction = async () => {
            if (state.isTerrainClippedToRoi) {
              const pts = metadata?.points;
              if (pts && pts.length >= 3 && !isFeatureInsideActiveRoi(pts)) {
                state.volumePoints = [];
                updateVolumeSvg();
                const volumeMiniContainer = document.getElementById("volumeMiniContainer");
                if (volumeMiniContainer) volumeMiniContainer.classList.add("hidden");

                showRoiWorkspaceNotice(`"${niceName}" is outside the active ROI view.`, () => {
                  restoreFullMapIfClipped();
                  setTimeout(() => {
                    loadVolumeAction();
                  }, 400);
                });
                return;
              }
            }
            hideRoiWorkspaceNotice();
            document.querySelectorAll("#volumesList .saved-report-item, #featuresListPolygons .saved-report-item").forEach(el => el.classList.remove("selected-item"));
            item.classList.add("selected-item");

            try {
              clearAllLeftPanelState();
              state.measureMode = "VOLUME";
              state.measureState = "FINISHED_VOLUME";

              if (metadata) {
                metadata.folder = folderName || metadata.folder || "";
              }

              window.currentViewingFeature = {
                type: "VOLUME",
                name: niceName,
                file,
                metadata,
                folder: folderName || metadata?.folder || ""
              };
              updateInfoPanelRenameTrigger(niceName);

              state.volumePoints = metadata.points.map(p => ({
                coord: new Coordinates(giroCrs, p.x, p.y, p.z),
                point: new Vector3(p.x, p.y, p.z)
              }));

              updateVolumeSvg();
              requestAnimationFrame(() => {
                if (state.instance?.view?.camera) state.instance.view.camera.updateMatrixWorld(true);
                updateVolumeSvg();
              });

              const volMiniArea = document.getElementById("volMiniArea");
              const volMiniPerim = document.getElementById("volMiniPerim");
              const volMiniCut = document.getElementById("volMiniCut");
              const volMiniFill = document.getElementById("volMiniFill");
              const volMiniNet = document.getElementById("volMiniNet");
              const btnClearVolume = document.getElementById("btnClearVolume");

              if (volMiniArea) volMiniArea.textContent = metadata.area2D;
              if (volMiniPerim) volMiniPerim.textContent = metadata.perimeter;
              if (volMiniCut) volMiniCut.textContent = metadata.cutVolume;
              if (volMiniFill) volMiniFill.textContent = metadata.fillVolume;

              if (volMiniNet) {
                const cutNum = parseFloat(String(metadata.cutVolume || "").replace(/[^0-9.-]/g, "")) || 0;
                const fillNum = parseFloat(String(metadata.fillVolume || "").replace(/[^0-9.-]/g, "")) || 0;
                const netVal = metadata.netVolume || (cutNum - fillNum);
                const netNum = (typeof netVal === "number") ? netVal : (parseFloat(String(netVal).replace(/[^0-9.-]/g, "")) || 0);
                const netSign = netNum >= 0 ? "+" : "";
                volMiniNet.textContent = `${netSign}${netNum.toLocaleString(undefined, { maximumFractionDigits: 2 })} m³`;
                volMiniNet.style.color = netNum >= 0 ? "#10b981" : "#ef4444";
              }

              showUnifiedInfoPanel("VOLUME", `VOLUME: ${niceName}`, metadata, true);
              if (btnClearVolume) btnClearVolume.disabled = false;

            } catch (err) {
              console.error("Failed to load volume metadata", err);
              await showCustomAlert("Failed to load volume details.", "Error", "error");
            }
          };

          item.addEventListener("click", (e) => {
            if (e.target.closest(".btn-row-delete-icon") || e.target.closest("button")) return;
            if (e.target.closest("input")) return;

            const uniqueId = file.fileName || metadata.name || "Volume";
            const volName = niceName || metadata.name || file.fileName.split("/").pop().replace(".json", "");

            if (state.isMultiSelectVolumes) {
              if (state.multiSelectedVolumesMap.has(uniqueId)) {
                state.multiSelectedVolumesMap.delete(uniqueId);
                item.classList.remove("selected-item");
                if (state.activeFocusedFeatureId === uniqueId) {
                  state.activeFocusedFeatureId = state.multiSelectedVolumesMap.keys().next().value || null;
                }
              } else {
                state.multiSelectedVolumesMap.set(uniqueId, { file, metadata, data: metadata, name: volName });
                item.classList.add("selected-item");
                state.activeFocusedFeatureId = uniqueId;
                showUnifiedInfoPanel("VOLUME", `VOLUME: ${volName}`, metadata, true);
              }
              updateMultiOverlaySvg();
            } else {
              state.multiSelectedVolumesMap.clear();
              document.querySelectorAll("#volumesList .saved-report-item, #featuresListPolygons .saved-report-item").forEach(el => el.classList.remove("selected-item"));
              item.classList.add("selected-item");
              state.activeFocusedFeatureId = uniqueId;
              state.multiSelectedVolumesMap.set(uniqueId, { file, metadata, data: metadata, name: volName });
              loadVolumeAction();
              updateMultiOverlaySvg();
            }
          });

          fContent.appendChild(item);
        });
      }

      folderGroup.appendChild(fHeader);
      folderGroup.appendChild(fContent);
      targetContainer.appendChild(folderGroup);
    };

    const volFolderKeys = Object.keys(volumeFolders).sort();
    volFolderKeys.forEach(folderName => {
      if (volumesList) renderFolder(folderName, volumeFolders[folderName], volumesList);
      if (featuresListPolygons) renderFolder(folderName, volumeFolders[folderName], featuresListPolygons);
    });
    if (volFolderKeys.length === 0) {
      if (volumesList) volumesList.innerHTML = '<i style="color: var(--muted); padding: 4px;">No saved volumes yet.</i>';
      if (featuresListPolygons) featuresListPolygons.innerHTML = '<i style="color: var(--muted); padding: 4px;">No saved volumes yet.</i>';
    }

  } catch (err) {
    console.error(err);
    if (volumesList) volumesList.innerHTML = '<i style="color: #ef4444; padding: 4px;">Error loading volumes.</i>';
    if (featuresListPolygons) featuresListPolygons.innerHTML = '<i style="color: #ef4444; padding: 4px;">Error loading volumes.</i>';
  }
}

/** Toggle Volumes Manage / Edit Mode (shows rename and delete icons) */
export function toggleVolumesEditMode(enable = !state.isVolumesEditMode) {
  state.isVolumesEditMode = enable;
  const btnManageVolumesFolder = document.getElementById("btnManageVolumesFolder");
  btnManageVolumesFolder?.classList.toggle("active", state.isVolumesEditMode);

  document.querySelectorAll(".btn-row-delete-vol").forEach(el => {
    el.style.display = state.isVolumesEditMode ? "inline-flex" : "none";
  });
  document.querySelectorAll(".btn-row-rename-vol").forEach(el => {
    el.style.display = state.isVolumesEditMode ? "inline-flex" : "none";
  });
  document.querySelectorAll("#panel-volume .btn-delete-folder-trigger, #featuresListPolygons .btn-delete-folder-trigger").forEach(b => {
    b.style.display = state.isVolumesEditMode ? "inline-flex" : "none";
  });
  document.querySelectorAll("#panel-volume .btn-rename-folder-trigger, #featuresListPolygons .btn-rename-folder-trigger").forEach(b => {
    b.style.display = state.isVolumesEditMode ? "inline-flex" : "none";
  });
}

/** Initialize Saved Volumes UI bindings */
export function initSavedVolumesUI() {
  const savedVolumesHeader = document.getElementById("savedVolumesHeader");
  const volumesCarrot = document.getElementById("volumesCarrot");
  const volumesPanelContent = document.getElementById("volumesPanelContent");

  savedVolumesHeader?.addEventListener("click", () => {
    if (!volumesPanelContent) return;
    const show = volumesPanelContent.style.display === "none";
    volumesPanelContent.style.display = show ? "block" : "none";
    if (volumesCarrot) volumesCarrot.textContent = show ? "▼" : "▲";
  });

  document.getElementById("btnManageVolumesFolder")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleVolumesEditMode();
  });

  document.getElementById("manageVolumesBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleVolumesEditMode();
  });

  document.getElementById("btnNewVolumesFolder")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const name = await showCustomPrompt("Enter new folder name for Volumes:", "", "New Volume Folder");
    if (name && name.trim()) {
      const trimmed = name.trim();
      addKnownVolumeFolder(trimmed, true, trimmed);
      fetchSavedVolumes();
    }
  });

  document.getElementById("btnNewVolumeFolder")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const name = await showCustomPrompt("Enter new folder name for Volumes:", "", "New Volume Folder");
    if (name && name.trim()) {
      const trimmed = name.trim();
      addKnownVolumeFolder(trimmed, true, trimmed);
      fetchSavedVolumes();
    }
  });

  // Attach to window
  window.fetchSavedVolumes = fetchSavedVolumes;
  window.toggleVolumesEditMode = toggleVolumesEditMode;
}
