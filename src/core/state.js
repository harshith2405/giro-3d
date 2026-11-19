// src/core/state.js
// Centralized shared application state across all viewer modules

export const state = {
  // 3D Engine & Layers
  instance: null,
  map: null,
  elevationLayer: null,
  orthoLayer: null,
  activeProject: null,
  elevationRange: { min: 0, max: 1000 },
  slopeColorMap: null,
  controls: null,

  // Scoped Dynamic Folder Stores (Strictly in-memory, scoped per survey)
  knownProfileFolders: new Set(),
  knownVolumeFolders: new Set(),
  sessionCreatedProfileFolders: new Set(),
  sessionCreatedVolumeFolders: new Set(),

  // IBM Multi-Temporal Audit Context
  isIBM: false,
  isIbmProfileComparison: false,
  ibmComparisonPastSurveyKey: null,
  currentProfileComparisonData: null,
  cachedDiffHeatmapData: null,
  diffLayer: null,
  diffSource: null,
  diffCanvas: null,

  // Overlays & Workspaces
  isTerrainClippedToRoi: false,
  isGridOverlayActive: false,
  isHeatmapOverlayActive: false,
  isContourOverlayActive: false,

  // Multi-Select Visualization
  activeFocusedFeatureId: null,
  isMultiSelectReports: false,
  isMultiSelectVolumes: false,
  multiSelectedReportsMap: new Map(),
  multiSelectedVolumesMap: new Map(),

  // Active Tool & Save Context
  activeInfoTool: null,
  activeToolSaveData: null,
  volumeSaveMode: "SINGLE", // "SINGLE" | "BATCH"
  isProfilesEditMode: false,
  isVolumesEditMode: false,
  isRoisEditMode: false,

  // Simple / Path Profile / Volume Measurements
  measureState: "IDLE", // IDLE | SELECTING | FINISHED | FINISHED_VOLUME | FINISHED_POINT | FINISHED_ROI_POLY | SELECTING_POINT
  measureMode: "NONE", // NONE | SIMPLE | PROFILE | REDRAW | VOLUME | POINT | ROI_POLY
  measureStartPoint: null,
  measureEndPoint: null,
  measureStartCoord: null,
  measureEndCoord: null,
  currentProfilePoints3D: [],
  currentProfileData: [],
  currentProfileHover3DPoint: null,
  currentProfilePinnedIndex: null,
  currentProfilePinned3DPoint: null,

  // Point Drawing
  pointDrawPoint: null,
  pointDrawCoord: null,

  // Volume
  volumePoints: [],
  volumeMousePoint: null,
  uploadedVolumeFileName: "",

  // Multi-Polygon KML State
  multiKmlPolygons: [],
  activeKmlPolyIndex: 0,
  expandedKmlPolyIndex: -1,
  isMultiSaveMode: false,

  // ROI State
  roiState: "IDLE", // IDLE | SELECTING
  roiDragging: false,
  roiStart: null,
  roiEnd: null,
  roiDragStartScreen: null,
  roiPolyPoints: [],
  roiPolyMousePoint: null,
  kmlWorldPoints: [],

  // Charts
  miniChart: null,
  fullChart: null,

  // Current Viewing Feature for Inline Rename & Inspection
  currentViewingFeature: null,
};

/** Update the on-screen status text (if a `.status` element exists). */
export function updateStatus(text) {
  const el = document.querySelector(".status");
  if (el) el.textContent = text;
}

/** Top-Center Live Map Guidance HUD Helper */
export function setLiveGuidance(icon, text) {
  const liveGuidanceHud = document.getElementById("liveGuidanceHud");
  const guidanceIcon = document.getElementById("guidanceIcon");
  const guidanceText = document.getElementById("guidanceText");
  if (!liveGuidanceHud) return;
  if (!text) {
    liveGuidanceHud.classList.add("hidden");
    return;
  }
  if (guidanceIcon) guidanceIcon.textContent = icon;
  if (guidanceText) guidanceText.textContent = text;
  liveGuidanceHud.classList.remove("hidden");
}
