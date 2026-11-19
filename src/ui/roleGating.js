// src/ui/roleGating.js
// Client / Stakeholder Context Routing (e.g. &client=ibm or &mode=ibm)

import { state } from "../core/state.js";

const _urlSearchParams = new URLSearchParams(window.location.search);
export const isIBM = _urlSearchParams.get("client") === "ibm" || _urlSearchParams.get("mode") === "ibm";
state.isIBM = isIBM;

export function getReportsFolder() {
  return isIBM ? "ibm-reports" : "reports";
}

// Strict Role Gating for IBM Suite
export function applyIbmRoleGating() {
  const btnSidebarIbm = document.getElementById("btnSidebarIbm");
  const panelIbm = document.getElementById("panel-ibm");
  if (isIBM) {
    btnSidebarIbm?.classList.remove("hidden");
  } else {
    btnSidebarIbm?.classList.add("hidden");
    panelIbm?.classList.add("hidden");
  }
}

// Global attachments for backward compatibility
window.isIBM = isIBM;
window.getReportsFolder = getReportsFolder;
