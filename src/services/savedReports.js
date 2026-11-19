// src/services/savedReports.js
// Saved Path Profiles Store, PDF Report Generator, Folder Hierarchies & Multi-Select Sync

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Vector3 } from "three";
import Coordinates from "@giro3d/giro3d/core/geographic/Coordinates.js";
import { giroCrs } from "../config/crs.js";
import { state } from "../core/state.js";
import { getReportsFolder } from "../ui/roleGating.js";
import { showCustomAlert, showCustomConfirm, showCustomPrompt } from "../ui/dialogs.js";
import { showQuickInfoPopover, hideQuickInfoPopover } from "../ui/popover.js";
import { showUnifiedInfoPanel, updateInfoPanelRenameTrigger, syncFolderDropdowns, addKnownProfileFolder } from "../ui/infoPanel.js";
import { deleteFile } from "./api.js";
import { restoreFullMapIfClipped } from "./clearState.js";
import { isFeatureInsideActiveRoi, showRoiWorkspaceNotice, hideRoiWorkspaceNotice } from "../tools/roiState.js";
import { buildProfile3DPointsFromElevations } from "../tools/drapedMath.js";
import { updateMeasureSvg } from "../tools/measure.js";
import { updateElevationProfile } from "../tools/profile.js";
import { updateMultiOverlaySvg } from "../tools/multiOverlay.js";
import { initCharts } from "../tools/profileChart.js";

/** Generate professional geospatial topographical elevation PDF report */
export function generateReportPDF(reportName) {
  initCharts();

  const distances = (state.miniChart?.data?.labels?.length > 0)
    ? state.miniChart.data.labels
    : (state.currentProfileData ? state.currentProfileData.map(d => d.dist.toFixed(1)) : []);
  const elevations = (state.miniChart?.data?.datasets?.[0]?.data)
    ? state.miniChart.data.datasets[0].data
    : (state.currentProfileData ? state.currentProfileData.map(d => d.elev) : []);

  if (state.fullChart) {
    state.fullChart.data.labels = distances;
    state.fullChart.data.datasets[0].data = elevations;
    try { state.fullChart.update("none"); } catch (e) {}
  }

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header Banner
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, pageWidth, 40, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("POLYGON GEOSPATIAL ANALYSIS", pageWidth / 2, 22, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(200, 200, 200);
  doc.text("Topographical & Elevation Report", pageWidth / 2, 30, { align: "center" });

  // Report Metadata
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(`Report: ${reportName}`, 15, 52);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Date of Analysis: ${new Date().toLocaleString()}`, 15, 60);
  doc.text(`Coordinate System: EPSG:3395 (World Mercator)`, 15, 66);

  // Add Chart Image
  let chartImg = null;
  try {
    if (state.miniChart?.canvas?.width > 0 && state.miniChart?.canvas?.height > 0) {
      chartImg = state.miniChart.canvas.toDataURL("image/png");
    } else if (state.fullChart?.canvas?.width > 0 && state.fullChart?.canvas?.height > 0) {
      chartImg = state.fullChart.canvas.toDataURL("image/png");
    }
  } catch (e) {
    console.warn("Could not export chart canvas to dataURL:", e);
  }

  if (chartImg && typeof chartImg === "string" && chartImg.startsWith("data:image/png;base64,") && chartImg.length > 100) {
    try {
      doc.addImage(chartImg, "PNG", 15, 75, 180, 80);
    } catch (e) {
      console.warn("Failed to add chart image to PDF:", e);
    }
  }

  // Calculate Analytical Stats
  const dists = state.currentProfileData.map(d => d.dist);
  const elevs = state.currentProfileData.map(d => d.elev);
  const totalDist = dists.length > 0 ? Math.max(...dists) : 0;

  let surfaceDistance = 0;
  let maxSlope = 0;
  for (let i = 1; i < state.currentProfileData.length; i++) {
    const p1 = state.currentProfileData[i - 1];
    const p2 = state.currentProfileData[i];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dz = p2.elev - p1.elev;
    const horizontalDist = Math.sqrt(dx * dx + dy * dy);
    surfaceDistance += Math.sqrt(horizontalDist * horizontalDist + dz * dz);

    if (horizontalDist > 0) {
      const slope = Math.abs(dz / horizontalDist) * 100;
      if (slope > maxSlope) maxSlope = slope;
    }
  }

  const maxElev = elevs.length > 0 ? Math.max(...elevs) : 0;
  const minElev = elevs.length > 0 ? Math.min(...elevs) : 0;
  const elevChange = maxElev - minElev;
  const avgSlope = totalDist > 0 ? (elevChange / totalDist * 100) : 0;

  const startX = state.currentProfileData[0]?.x?.toFixed(2) || "0.00";
  const startY = state.currentProfileData[0]?.y?.toFixed(2) || "0.00";
  const endX = state.currentProfileData[state.currentProfileData.length - 1]?.x?.toFixed(2) || "0.00";
  const endY = state.currentProfileData[state.currentProfileData.length - 1]?.y?.toFixed(2) || "0.00";

  autoTable(doc, {
    startY: 165,
    head: [["Geographical Details", "Coordinates (EPSG:3395)"]],
    body: [
      ["Start Point", `X: ${startX}, Y: ${startY}`],
      ["End Point", `X: ${endX}, Y: ${endY}`]
    ],
    theme: "grid",
    headStyles: { fillColor: [51, 65, 85] },
    styles: { fontSize: 10, cellPadding: 5 }
  });

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 8,
    head: [["Topographical Metrics", "Calculated Value"]],
    body: [
      ["Horizontal Distance (2D)", `${totalDist.toFixed(2)} m`],
      ["Surface Distance (3D)", `${surfaceDistance.toFixed(2)} m`],
      ["Elevation Change (Δ)", `${elevChange.toFixed(2)} m`],
      ["Maximum Elevation", `${maxElev.toFixed(2)} m`],
      ["Minimum Elevation", `${minElev.toFixed(2)} m`],
      ["Average Grade / Slope", `${avgSlope.toFixed(2)} %`],
      ["Maximum Grade / Slope", `${maxSlope.toFixed(2)} %`]
    ],
    theme: "grid",
    headStyles: { fillColor: [15, 118, 110] },
    styles: { fontSize: 10, cellPadding: 5 }
  });

  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text("Generated by Polygon Geospatial Viewer", pageWidth / 2, pageHeight - 10, { align: "center" });

  return doc;
}

/** Fetch saved reports from backend API gateway */
export async function fetchSavedReports() {
  const reportsList = document.getElementById("reportsList");
  const reportsListLoading = document.getElementById("reportsListLoading");
  const featuresListLines = document.getElementById("featuresListLines");

  if (reportsListLoading) reportsListLoading.style.display = "block";
  if (reportsListLoading) reportsListLoading.textContent = "Loading profiles...";
  if (featuresListLines) featuresListLines.innerHTML = '<i style="color: var(--muted); padding: 4px;">Loading profiles...</i>';
  if (reportsList) reportsList.innerHTML = "";

  try {
    if (!state.activeProject) return;
    let pdfFiles = [];
    let jsonFiles = [];

    try {
      const apiUrl = `https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url?projectId=${encodeURIComponent(state.activeProject.folderName)}&surveyId=${encodeURIComponent(state.activeProject.surveyId)}&type=reports&folder=${encodeURIComponent(getReportsFolder())}`;
      const response = await fetch(apiUrl, { method: "GET", cache: "no-store" });
      if (response.ok) {
        const rawFiles = await response.json();
        const files = Array.isArray(rawFiles) ? rawFiles : [];
        pdfFiles = files.filter(f => f && f.fileName && f.fileName.endsWith(".pdf"));
        jsonFiles = files.filter(f => f && f.fileName && f.fileName.endsWith(".json"));
      }
    } catch (netErr) {
      console.warn("Could not load reports", netErr);
    }

    if (reportsListLoading) reportsListLoading.style.display = "none";

    const itemsPromises = pdfFiles.map(async pdfFile => {
      const rawPdfBase = pdfFile.fileName.split("/").pop().replace(".pdf", "");
      const jsonFile = jsonFiles.find(j => {
        const jRaw = j.fileName.split("/").pop().replace(".json", "");
        return j.fileName === `${pdfFile.fileName.replace(".pdf", "")}.json` || jRaw === rawPdfBase;
      });
      const fallbackFolder = pdfFile.fileName.includes("/") ? pdfFile.fileName.split("/")[0] : "";
      let metadata = { isOfficial: false, folder: fallbackFolder };
      if (jsonFile) {
        try {
          const _url = jsonFile.url;
          const _cacheBuster = _url.includes("?") ? `&t=${Date.now()}` : `?t=${Date.now()}`;
          const res = await fetch(_url + _cacheBuster, { cache: "no-store" });
          if (res.ok) {
            const fetchedMeta = await res.json();
            metadata = Object.assign(metadata, fetchedMeta);
          }
        } catch (e) {}
      }
      if (!metadata.folder) metadata.folder = fallbackFolder || "General";
      return { pdfFile, jsonFile, metadata };
    });

    let items = await Promise.all(itemsPromises);
    items = items.sort((a, b) => new Date(b.pdfFile.lastModified) - new Date(a.pdfFile.lastModified));
    window._cachedAllProfileItems = items;

    if (reportsList) reportsList.innerHTML = "";
    if (featuresListLines) featuresListLines.innerHTML = "";

    const profileFolders = {};

    items.forEach(itemData => {
      const rawFolder = itemData.metadata?.folder || (itemData.pdfFile.fileName.includes("/") ? itemData.pdfFile.fileName.split("/")[0] : "");
      const folderName = (rawFolder && rawFolder.trim()) ? rawFolder.trim() : "General";
      itemData.metadata.folder = folderName;
      if (!profileFolders[folderName]) profileFolders[folderName] = [];
      profileFolders[folderName].push(itemData);
    });

    state.sessionCreatedProfileFolders.forEach(f => {
      if (f && typeof f === "string" && f.trim() !== "") {
        const trimmed = f.trim();
        if (!profileFolders[trimmed]) profileFolders[trimmed] = [];
      }
    });

    state.knownProfileFolders.clear();
    Object.keys(profileFolders).forEach(f => state.knownProfileFolders.add(f));
    syncFolderDropdowns("PROFILE");

    const renderProfileFolder = (folderName, folderItems, targetContainer) => {
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
            <input type="checkbox" class="toggle-folder-view-reports" data-folder="${folderName}">
            <span class="ui-toggle-slider"></span>
          </label>
          <button class="btn-rename-folder-trigger" title="Rename folder" data-folder="${folderName}" data-type="profile" style="display: ${state.isProfilesEditMode ? "inline-flex" : "none"}; background: rgba(94, 25, 234, 0.08); border: 1px solid rgba(94, 25, 234, 0.25); color: #5e19ea; width: 22px; height: 22px; border-radius: 4px; cursor: pointer; align-items: center; justify-content: center; padding: 0;">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <button class="btn-delete-folder-trigger" title="Delete folder & items" data-folder="${folderName}" data-type="profile" style="display: ${state.isProfilesEditMode ? "inline-flex" : "none"}; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); color: #ef4444; width: 22px; height: 22px; border-radius: 4px; cursor: pointer; align-items: center; justify-content: center; padding: 0;">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
          ${svgChevron}
        </div>
      `;

      const folderToggle = fHeader.querySelector(".toggle-folder-view-reports");
      folderToggle?.addEventListener("change", async (e) => {
        e.stopPropagation();
        const isChecked = e.target.checked;
        if (isChecked) {
          for (const { pdfFile, jsonFile, metadata } of folderItems) {
            const uniqueId = (jsonFile && jsonFile.fileName) ? jsonFile.fileName : pdfFile.fileName;
            const rawName = metadata?.name || metadata?.title || pdfFile.fileName.split("/").pop().replace(".pdf", "").replace(/_/g, " ");
            let meta = metadata;
            if (!meta && jsonFile && jsonFile.url) {
              try {
                const _u = jsonFile.url + (jsonFile.url.includes("?") ? "&" : "?") + `t=${Date.now()}`;
                const r = await fetch(_u, { cache: "no-store" });
                if (r.ok) meta = await r.json();
              } catch (err) {}
            }
            if (meta) {
              state.multiSelectedReportsMap.set(uniqueId, {
                name: rawName,
                pdfUrl: pdfFile.url,
                metadata: meta,
                data: meta,
                file: jsonFile,
                folderName: folderName
              });
            }
          }
        } else {
          for (const [key, val] of Array.from(state.multiSelectedReportsMap.entries())) {
            if (val.folderName === folderName) {
              state.multiSelectedReportsMap.delete(key);
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
        state.sessionCreatedProfileFolders.delete(folderName);
        state.sessionCreatedProfileFolders.add(cleanName);
        state.knownProfileFolders.delete(folderName);
        state.knownProfileFolders.add(cleanName);

        for (const { jsonFile, metadata } of folderItems) {
          if (jsonFile && metadata) {
            try {
              metadata.folder = cleanName;
              const jsonFileName = jsonFile.fileName;
              const jsonBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" });
              const jsonRes = await fetch("https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ projectId: state.activeProject.folderName, surveyId: state.activeProject.surveyId, type: "reports", fileName: jsonFileName, folder: getReportsFolder() })
              });
              if (jsonRes.ok) {
                const { uploadUrl } = await jsonRes.json();
                if (uploadUrl) {
                  await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: jsonBlob });
                }
              }
            } catch (err) {
              console.error("Failed to update folder in metadata:", err);
            }
          }
        }
        await fetchSavedReports();
        syncFolderDropdowns("PROFILE", cleanName);
      });

      const delBtn = fHeader.querySelector(".btn-delete-folder-trigger");
      delBtn?.addEventListener("click", async (e) => {
        e.stopPropagation();
        e.preventDefault();

        if (folderItems.length === 0) {
          const confirmed = await showCustomConfirm(`Delete empty subfolder "${folderName}"?`, "Delete Folder", true);
          if (confirmed) {
            state.sessionCreatedProfileFolders.delete(folderName);
            state.knownProfileFolders.delete(folderName);
            await fetchSavedReports();
            syncFolderDropdowns("PROFILE");
          }
          return;
        }

        const confirmed = await showCustomConfirm(`Delete folder "${folderName}" and all ${folderItems.length} path profile(s) in it?`, "Delete Folder", true);
        if (confirmed) {
          delBtn.disabled = true;
          delBtn.textContent = "...";
          try {
            const deletePromises = folderItems.map(async ({ pdfFile, jsonFile }) => {
              const p1 = deleteFile("reports", pdfFile.fileName).catch(() => {});
              const p2 = jsonFile ? deleteFile("reports", jsonFile.fileName).catch(() => {}) : Promise.resolve();
              return Promise.all([p1, p2]);
            });
            await Promise.all(deletePromises);
            state.sessionCreatedProfileFolders.delete(folderName);
            state.knownProfileFolders.delete(folderName);
            await fetchSavedReports();
            syncFolderDropdowns("PROFILE");
          } catch (err) {
            console.error("Error deleting folder items", err);
            await showCustomAlert("Failed to delete all items in folder: " + err.message, "Error", "error");
            await fetchSavedReports();
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

      const isFeaturesSection = (targetContainer === featuresListLines);
      if (folderItems.length === 0) {
        fContent.innerHTML = `<i style="color: var(--muted); font-size: 11px; padding: 6px 12px; display: block;">No profiles in this folder</i>`;
      } else {
        folderItems.forEach(({ pdfFile, jsonFile, metadata }) => {
          const item = document.createElement("div");
          item.className = "saved-report-item";

          const svg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
          const dateStr = new Date(pdfFile.lastModified).toLocaleDateString();

          const pdfLinkHtml = `<a href="${pdfFile.url}" target="_blank" class="btn-action-icon" title="Download PDF" onclick="event.stopPropagation();" style="width: 22px; height: 22px; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; background: rgba(94, 25, 234, 0.08); border: 1px solid rgba(94, 25, 234, 0.25); color: #5e19ea; text-decoration: none;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></a>`;
          const rawName = metadata?.name || metadata?.title || pdfFile.fileName.split("/").pop().replace(".pdf", "").replace(/_/g, " ");
          const renameProfileBtnHtml = `<button class="btn-row-rename-icon btn-row-rename-profile" data-filename="${pdfFile.fileName}" title="Rename ${rawName}" style="display: ${state.isProfilesEditMode ? "inline-flex" : "none"}; background: rgba(94, 25, 234, 0.08); border: 1px solid rgba(94, 25, 234, 0.25); color: #5e19ea; width: 22px; height: 22px; border-radius: 4px; cursor: pointer; align-items: center; justify-content: center; padding: 0;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>`;
          const delBtnHtml = `<button class="btn-row-delete-icon btn-row-delete-profile" data-filename="${pdfFile.fileName}" title="Delete ${rawName}" style="display: ${state.isProfilesEditMode ? "inline-flex" : "none"};"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`;
          const infoBtnHtml = `<button class="btn-row-info-trigger" title="Quick Info" onclick="event.stopPropagation();"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></button>`;

          item.innerHTML = `
            <div style="display: flex; align-items: center; flex: 1; min-width: 0; overflow: hidden; cursor: pointer; gap: 8px;">
              ${isFeaturesSection ? "" : svg}
              <span class="item-title" style="flex: 1; font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${rawName}">${rawName}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: 8px;">
              ${renameProfileBtnHtml}
              ${delBtnHtml}
              ${isFeaturesSection ? "" : pdfLinkHtml}
              ${infoBtnHtml}
            </div>
          `;

          const renameBtn = item.querySelector(".btn-row-rename-profile");
          renameBtn?.addEventListener("click", async (e) => {
            e.stopPropagation();
            const newName = await showCustomPrompt(`Enter new name for profile "${rawName}":`, rawName, "Rename Path Profile");
            if (!newName || newName.trim() === "" || newName.trim() === rawName) return;
            const cleanName = newName.trim();
            try {
              renameBtn.disabled = true;
              let meta = Object.assign({}, metadata || {});
              if (jsonFile && jsonFile.url) {
                try {
                  const _u = jsonFile.url + (jsonFile.url.includes("?") ? "&" : "?") + `t=${Date.now()}`;
                  const r = await fetch(_u, { cache: "no-store" });
                  if (r.ok) meta = Object.assign(meta, await r.json());
                } catch (err) {}
              }
              meta.name = cleanName;
              meta.title = cleanName;
              if (!meta.folder && metadata?.folder) meta.folder = metadata.folder;
              if (!meta.folder && folderName) meta.folder = folderName;

              const jsonFileName = jsonFile?.fileName || pdfFile.fileName.replace(/\.pdf$/, ".json");
              const res = await fetch(`https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ projectId: state.activeProject.folderName, surveyId: state.activeProject.surveyId, type: "reports", fileName: jsonFileName, folder: getReportsFolder() })
              });
              if (res.ok) {
                const { uploadUrl } = await res.json();
                if (uploadUrl) {
                  await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(meta, null, 2) });
                }
              }
              fetchSavedReports();
            } catch (err) {
              console.error("Rename profile error:", err);
              await showCustomAlert("Failed to rename profile: " + err.message, "Error", "error");
            }
          });

          const infoBtn = item.querySelector(".btn-row-info-trigger");
          const triggerProfileQuickInfo = async () => {
            let m = metadata;
            if (!m && jsonFile && jsonFile.url) {
              try {
                const _u = jsonFile.url + (jsonFile.url.includes("?") ? "&" : "?") + `t=${Date.now()}`;
                const r = await fetch(_u, { cache: "no-store" });
                if (r.ok) m = await r.json();
              } catch (e) {}
            }
            const dist2D = m?.chartData?.totalDist != null ? `${Number(m.chartData.totalDist).toFixed(2)} m` : (m?.totalDistance ? `${Number(m.totalDistance).toFixed(2)} m` : "-");
            const elevChg = m?.chartData?.elevChange != null ? `${Number(m.chartData.elevChange).toFixed(2)} m` : (m?.elevationChange ? `${Number(m.elevationChange).toFixed(2)} m` : "-");
            const dist3D = m?.chartData?.surfDist != null ? `${Number(m.chartData.surfDist).toFixed(2)} m` : (m?.surfaceDistance ? `${Number(m.surfaceDistance).toFixed(2)} m` : "-");

            const rows = [
              { label: "2D Distance", val: dist2D },
              { label: "Elevation Change", val: elevChg },
              { label: "3D Surface Dist", val: dist3D },
              { label: "Date", val: dateStr }
            ];
            showQuickInfoPopover(infoBtn, "Profile", rawName, rows);
          };

          infoBtn?.addEventListener("mouseenter", triggerProfileQuickInfo);
          infoBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            triggerProfileQuickInfo();
          });
          infoBtn?.addEventListener("mouseleave", hideQuickInfoPopover);

          const delBtn = item.querySelector(".btn-row-delete-profile");
          delBtn?.addEventListener("click", async (e) => {
            e.stopPropagation();
            const confirmed = await showCustomConfirm(`Are you sure you want to delete profile "${rawName}"? This cannot be undone.`, "Delete Profile", true);
            if (confirmed) {
              try {
                delBtn.disabled = true;
                await deleteFile("reports", pdfFile.fileName);
                if (jsonFile && jsonFile.fileName) {
                  await deleteFile("reports", jsonFile.fileName).catch(() => {});
                }
                fetchSavedReports();
              } catch (err) {
                await showCustomAlert("Failed to delete: " + err.message, "Error", "error");
              }
            }
          });

          const loadPathProfile = async () => {
            let m = metadata;
            if (state.isTerrainClippedToRoi && m && (m.startPoint || m.startCoord) && (m.endPoint || m.endCoord)) {
              const p1 = m.startCoord || m.startPoint;
              const p2 = m.endCoord || m.endPoint;
              if (!isFeatureInsideActiveRoi([p1, p2])) {
                showRoiWorkspaceNotice(`"${rawName}" is outside the active ROI view.`, () => {
                  restoreFullMapIfClipped();
                  setTimeout(() => {
                    loadPathProfile();
                  }, 400);
                });
                return;
              }
            }
            hideRoiWorkspaceNotice();
            document.querySelectorAll(".saved-report-item").forEach(el => el.classList.remove("selected-item"));
            item.classList.add("selected-item");

            if (!jsonFile) return;
            try {
              const _url = jsonFile.url;
              const _cacheBuster = _url.includes("?") ? `&t=${Date.now()}` : `?t=${Date.now()}`;
              const res = await fetch(_url + _cacheBuster, { cache: "no-store" });
              const text = await res.text();
              m = JSON.parse(text);
              if (m) {
                m.folder = folderName || m.folder || "";
              }

              window.currentViewingFeature = {
                type: "PROFILE",
                name: rawName,
                pdfFile,
                jsonFile,
                metadata: m,
                folder: folderName || m?.folder || ""
              };
              updateInfoPanelRenameTrigger(rawName);

              if (m.startPoint && m.endPoint) {
                state.measureStartPoint = new Vector3(m.startPoint.x, m.startPoint.y, m.startPoint.z);
                state.measureEndPoint = new Vector3(m.endPoint.x, m.endPoint.y, m.endPoint.z);

                const refX = state.instance?.reference?.x || 0;
                const refY = state.instance?.reference?.y || 0;

                if (m.startCoord) {
                  state.measureStartCoord = new Coordinates(giroCrs, m.startCoord.x, m.startCoord.y, m.startCoord.z);
                } else {
                  state.measureStartCoord = new Coordinates(giroCrs, refX + state.measureStartPoint.x, refY + state.measureStartPoint.y, state.measureStartPoint.z);
                }

                if (m.endCoord) {
                  state.measureEndCoord = new Coordinates(giroCrs, m.endCoord.x, m.endCoord.y, m.endCoord.z);
                } else {
                  state.measureEndCoord = new Coordinates(giroCrs, refX + state.measureEndPoint.x, refY + state.measureEndPoint.y, state.measureEndPoint.z);
                }

                state.measureMode = "PROFILE";
                state.measureState = "FINISHED";

                if (m.chartData && m.chartData.elevations && m.chartData.elevations.length >= 2) {
                  state.currentProfilePoints3D = buildProfile3DPointsFromElevations(state.measureStartPoint, state.measureEndPoint, m.chartData.elevations);
                } else {
                  updateElevationProfile();
                }

                updateMeasureSvg();
                requestAnimationFrame(() => {
                  if (state.instance?.view?.camera) state.instance.view.camera.updateMatrixWorld(true);
                  updateMeasureSvg();
                });

                if (m.chartData && m.chartData.distances && m.chartData.elevations) {
                  state.currentProfileData = m.chartData.currentProfileData || [];
                  const profHoriz = document.getElementById("profileHoriz");
                  const profVert = document.getElementById("profileVert");
                  const prof3D = document.getElementById("profile3D");
                  if (profHoriz) profHoriz.textContent = (m.chartData.totalDist || 0).toFixed(2) + " m";
                  if (profVert) profVert.textContent = (m.chartData.elevChange || 0).toFixed(2) + " m";
                  if (prof3D) prof3D.textContent = (m.chartData.surfDist || 0).toFixed(2) + " m";

                  const elevationMiniContainer = document.getElementById("elevationMiniContainer");
                  if (elevationMiniContainer) elevationMiniContainer.classList.remove("hidden");
                  if (state.miniChart && (state.miniChart.width === 0 || state.miniChart.height === 0)) {
                    state.miniChart.destroy();
                    state.miniChart = null;
                  }
                  showUnifiedInfoPanel("PROFILE", `PATH PROFILE: ${rawName}`, null, true);

                  const _savedDistances = m.chartData.distances;
                  const _savedElevations = m.chartData.elevations;
                  setTimeout(() => {
                    initCharts();
                    if (state.miniChart) {
                      state.miniChart.data.labels = _savedDistances;
                      state.miniChart.data.datasets[0].data = _savedElevations;
                      state.miniChart.resize();
                      state.miniChart.update("none");
                    }
                  }, 100);
                } else {
                  updateElevationProfile();
                  showUnifiedInfoPanel("PROFILE", `PATH PROFILE: ${rawName}`, null, true);
                }
              }
            } catch (e) {
              console.error("Error loading path profile", e);
            }
          };

          item.addEventListener("click", (e) => {
            if (e.target.closest("a.pdf-link") || e.target.closest(".btn-row-delete-icon") || e.target.closest(".btn-action-icon")) return;
            if (e.target.closest("input")) return;

            const reportName = rawName || pdfFile.fileName.split("/").pop().replace(".pdf", "");
            const uniqueId = (jsonFile && jsonFile.fileName) ? jsonFile.fileName : pdfFile.fileName;

            if (state.isMultiSelectReports) {
              if (state.multiSelectedReportsMap.has(uniqueId)) {
                state.multiSelectedReportsMap.delete(uniqueId);
                item.classList.remove("selected-item");
                if (state.activeFocusedFeatureId === uniqueId) {
                  state.activeFocusedFeatureId = state.multiSelectedReportsMap.keys().next().value || null;
                }
                updateMultiOverlaySvg();
              } else {
                item.classList.add("selected-item");
                state.activeFocusedFeatureId = uniqueId;
                if (jsonFile && jsonFile.url) {
                  const _url = jsonFile.url;
                  const _cacheBuster = _url.includes("?") ? `&t=${Date.now()}` : `?t=${Date.now()}`;
                  fetch(_url + _cacheBuster, { cache: "no-store" })
                    .then(res => res.text())
                    .then(text => {
                      const m = JSON.parse(text);
                      state.multiSelectedReportsMap.set(uniqueId, { file: jsonFile, metadata: m, data: m, name: reportName });
                      showUnifiedInfoPanel("PROFILE", `PATH PROFILE: ${reportName}`, m, true);
                      updateMultiOverlaySvg();
                    }).catch(e => console.error("Error fetching report json", e));
                } else {
                  state.multiSelectedReportsMap.set(uniqueId, { file: jsonFile, metadata, data: metadata, name: reportName });
                  showUnifiedInfoPanel("PROFILE", `PATH PROFILE: ${reportName}`, metadata, true);
                  updateMultiOverlaySvg();
                }
              }
            } else {
              state.multiSelectedReportsMap.clear();
              document.querySelectorAll("#reportsList .saved-report-item, #featuresListLines .saved-report-item").forEach(el => el.classList.remove("selected-item"));
              item.classList.add("selected-item");
              state.activeFocusedFeatureId = uniqueId;
              state.multiSelectedReportsMap.set(uniqueId, { file: jsonFile, metadata, data: metadata, name: reportName });
              loadPathProfile();
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

    const folderKeys = Object.keys(profileFolders).sort();
    folderKeys.forEach(folderName => {
      if (reportsList) renderProfileFolder(folderName, profileFolders[folderName], reportsList);
      if (featuresListLines) renderProfileFolder(folderName, profileFolders[folderName], featuresListLines);
    });

    if (folderKeys.length === 0) {
      if (reportsList) reportsList.innerHTML = '<i style="color: var(--muted); padding: 4px;">No saved profiles yet.</i>';
      if (featuresListLines) featuresListLines.innerHTML = '<i style="color: var(--muted); padding: 4px;">No saved profiles yet.</i>';
    }

  } catch (err) {
    console.error(err);
    if (reportsList) reportsList.innerHTML = '<i style="color: #ef4444; padding: 4px;">Error loading profiles.</i>';
    if (featuresListLines) featuresListLines.innerHTML = '<i style="color: #ef4444; padding: 4px;">Error loading profiles.</i>';
  }
}

/** Toggle Profiles Manage / Edit Mode (shows rename and delete icons) */
export function toggleProfilesEditMode(enable = !state.isProfilesEditMode) {
  state.isProfilesEditMode = enable;
  const btnManageProfilesFolder = document.getElementById("btnManageProfilesFolder");
  const manageReportsBtn = document.getElementById("manageReportsBtn");
  [btnManageProfilesFolder, manageReportsBtn].forEach(b => b?.classList.toggle("active", state.isProfilesEditMode));

  document.querySelectorAll(".btn-row-delete-profile").forEach(el => {
    el.style.display = state.isProfilesEditMode ? "inline-flex" : "none";
  });
  document.querySelectorAll(".btn-row-rename-profile").forEach(el => {
    el.style.display = state.isProfilesEditMode ? "inline-flex" : "none";
  });
  document.querySelectorAll("#panel-profile .btn-delete-folder-trigger, #featuresListLines .btn-delete-folder-trigger").forEach(b => {
    b.style.display = state.isProfilesEditMode ? "inline-flex" : "none";
  });
  document.querySelectorAll("#panel-profile .btn-rename-folder-trigger, #featuresListLines .btn-rename-folder-trigger").forEach(b => {
    b.style.display = state.isProfilesEditMode ? "inline-flex" : "none";
  });
}

/** Initialize Saved Reports UI bindings */
export function initSavedReportsUI() {
  const savedReportsHeader = document.getElementById("savedReportsHeader");
  const reportsCarrot = document.getElementById("reportsCarrot");
  const reportsPanelContent = document.getElementById("reportsPanelContent");
  const btnDownloadReport = document.getElementById("btnDownloadReport");
  const btnSaveToSurvey = document.getElementById("btnSaveToSurvey");
  const reportNameInput = document.getElementById("reportNameInput");

  savedReportsHeader?.addEventListener("click", () => {
    if (!reportsPanelContent) return;
    const show = reportsPanelContent.style.display === "none";
    reportsPanelContent.style.display = show ? "block" : "none";
    if (reportsCarrot) reportsCarrot.textContent = show ? "▼" : "▲";
  });

  btnDownloadReport?.addEventListener("click", () => {
    if (state.currentProfileData.length === 0 || !state.fullChart) return;
    const reportName = reportNameInput?.value.trim() || "Elevation_Profile_Report";
    const doc = generateReportPDF(reportName);
    doc.save(`${reportName.replace(/\s+/g, "_")}.pdf`);
  });

  btnSaveToSurvey?.addEventListener("click", async () => {
    if (state.currentProfileData.length === 0 || !state.fullChart) return;

    const reportName = reportNameInput?.value.trim() || "Elevation_Profile_Report";
    const safeReportName = reportName.replace(/\s+/g, "_");

    const originalText = btnSaveToSurvey.innerHTML;
    btnSaveToSurvey.textContent = "Saving...";
    btnSaveToSurvey.disabled = true;

    try {
      const doc = generateReportPDF(reportName);
      const pdfBlob = doc.output("blob");

      const metadata = {
        isOfficial: !window.isDumpDraw,
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

      const apiUrl = "https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url";

      // 1. Upload PDF
      const pdfApiResponse = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: state.activeProject.folderName,
          surveyId: state.activeProject.surveyId,
          type: "reports", fileName: `${safeReportName}.pdf`,
          folder: getReportsFolder()
        })
      });
      if (!pdfApiResponse.ok) throw new Error("Failed to get PDF upload URL");
      const { uploadUrl: pdfUploadUrl } = await pdfApiResponse.json();
      const pdfUploadResponse = await fetch(pdfUploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: pdfBlob
      });
      if (!pdfUploadResponse.ok) throw new Error("Failed to upload PDF report");

      // 2. Upload JSON Metadata
      const jsonApiResponse = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: state.activeProject.folderName,
          surveyId: state.activeProject.surveyId,
          type: "reports", fileName: `${safeReportName}.json`,
          folder: getReportsFolder()
        })
      });
      if (!jsonApiResponse.ok) throw new Error("Failed to get data upload URL");
      const { uploadUrl: jsonUploadUrl } = await jsonApiResponse.json();
      const jsonUploadResponse = await fetch(jsonUploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: jsonBlob
      });
      if (!jsonUploadResponse.ok) throw new Error("Failed to upload report metadata");

      btnSaveToSurvey.textContent = "Saved to Survey!";
      btnSaveToSurvey.style.background = "#10b981";

      fetchSavedReports();

      setTimeout(() => {
        btnSaveToSurvey.innerHTML = originalText;
        btnSaveToSurvey.style.background = "#5e19ea";
        btnSaveToSurvey.disabled = false;
      }, 3000);

    } catch (err) {
      console.error("Error saving report:", err);
      btnSaveToSurvey.textContent = "Error Saving";
      btnSaveToSurvey.style.background = "#ef4444";

      setTimeout(() => {
        btnSaveToSurvey.innerHTML = originalText;
        btnSaveToSurvey.style.background = "#5e19ea";
        btnSaveToSurvey.disabled = false;
      }, 3000);
    }
  });

  document.getElementById("manageReportsBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleProfilesEditMode();
  });
  document.getElementById("btnManageProfilesFolder")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleProfilesEditMode();
  });

  document.getElementById("btnNewProfilesFolder")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const name = await showCustomPrompt("Enter new folder name for Path Profiles:", "", "New Profile Folder");
    if (name && name.trim()) {
      const trimmed = name.trim();
      addKnownProfileFolder(trimmed, true, trimmed);
      fetchSavedReports();
    }
  });

  document.getElementById("btnNewProfileFolder")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const name = await showCustomPrompt("Enter new folder name for Path Profiles:", "", "New Profile Folder");
    if (name && name.trim()) {
      const trimmed = name.trim();
      addKnownProfileFolder(trimmed, true, trimmed);
      fetchSavedReports();
    }
  });

  // Attach to window
  window.fetchSavedReports = fetchSavedReports;
  window.generateReportPDF = generateReportPDF;
  window.toggleProfilesEditMode = toggleProfilesEditMode;
}
