// src/services/api.js
// S3 / AWS Lambda backend client for storage, uploads, and deletions

import { state } from "../core/state.js";
import { getReportsFolder } from "../ui/roleGating.js";
import { showCustomConfirm, showCustomAlert } from "../ui/dialogs.js";

export const API_BASE = "https://zkhfgqgrwj.execute-api.ap-south-2.amazonaws.com/upload-url";

/**
 * Generic file delete utility - works for reports, rois, volumes, shapes, lines, points
 * API requires fileName in JSON body
 */
export async function deleteFile(type, fileName) {
  if (!state.activeProject) throw new Error("No active project");
  const delUrl = `${API_BASE}?projectId=${encodeURIComponent(state.activeProject.folderName)}&surveyId=${encodeURIComponent(state.activeProject.surveyId)}&type=${encodeURIComponent(type)}&fileName=${encodeURIComponent(fileName)}&folder=${encodeURIComponent(getReportsFolder())}`;
  const res = await fetch(delUrl, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: state.activeProject.folderName,
      surveyId: state.activeProject.surveyId,
      type: type,
      fileName: fileName,
      folder: getReportsFolder()
    })
  });
  if (!res.ok) throw new Error('Delete failed: ' + res.status);
  return res;
}

export async function deleteFileByUrl(url, type, fileName, onDeleted = null) {
  const confirmed = await showCustomConfirm("Delete this item? This cannot be undone.", "Delete Item", true);
  if (!confirmed) return;
  try {
    await deleteFile(type, fileName);
    if (typeof onDeleted === 'function') onDeleted();
  } catch (err) {
    console.error('Delete error:', err);
    await showCustomAlert("Failed to delete: " + err.message, "Error", "error");
  }
}

/**
 * Helper to upload a Blob/JSON to S3 via pre-signed URL.
 */
export async function uploadToStorage(type, fileName, blobOrText, contentType = "application/json") {
  if (!state.activeProject) throw new Error("No active project");
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: state.activeProject.folderName,
      surveyId: state.activeProject.surveyId,
      type,
      fileName,
      folder: getReportsFolder()
    })
  });
  if (!res.ok) throw new Error(`Failed to get upload URL for ${fileName}`);
  const { uploadUrl } = await res.json();
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blobOrText
  });
  if (!putRes.ok) throw new Error(`Failed to upload ${fileName} to storage`);
  return putRes;
}

// Global attachment for compatibility
window.deleteFileByUrl = deleteFileByUrl;
