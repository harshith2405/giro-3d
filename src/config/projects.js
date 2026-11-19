// src/config/projects.js
// Dedicated Project Catalog & Dynamic Survey Resolution
// Easy to extend with new projects: simply add a new config object or call registerProject().

export const chattibhariatuConfig = {
  id: "chattibhariatu_project",
  folderName: "Chattibhariatu",
  surveys: {
    may_2026: {
      elevationUrl: "./projects/Chattibhariatu/surveys/may_2026/DTM_cloudoptimised.tif",
      orthoUrl: "./projects/Chattibhariatu/surveys/may_2026/Ortho_CO.tif",
      extent: [9467845.7636, 9473006.4487, 2721268.4801, 2724489.7791],
      zOffset: 429,
      displayName: "May 2026",
    },
    june_2026: {
      elevationUrl: "./projects/Chattibhariatu/surveys/june_2026/DTM_CO_mercator.tif",
      orthoUrl: "./projects/Chattibhariatu/surveys/june_2026/Ortho_CO_5cm_mercator.tif",
      extent: [9467997.87, 9472740.19, 2721372.36, 2724281.32],
      zOffset: 432.0,
      displayName: "June 2026",
    },
    july_2026: {
      elevationUrl: "./projects/Chattibhariatu/surveys/july_2026/DTM_CO.tif",
      orthoUrl: "./projects/Chattibhariatu/surveys/july_2026/Ortho_CO.tif",
      extent: [9468023.88, 9472680.48, 2721355.34, 2724299.87],
      zOffset: 436.4,
      displayName: "July 2026",
    },
    august_2026: {
      elevationUrl: "./projects/Chattibhariatu/surveys/august_2026/DTM_CO.tif",
      orthoUrl: "./projects/Chattibhariatu/surveys/august_2026/Ortho_CO.tif",
      extent: [9468040.67, 9472665.87, 2721360.00, 2724320.30],
      zOffset: 436.0,
      displayName: "August 2026",
    },
    september_2026: {
      elevationUrl: "./projects/Chattibhariatu/surveys/september_2026/DTM_CO.tif",
      orthoUrl: "./projects/Chattibhariatu/surveys/september_2026/Ortho_CO.tif",
      extent: [9467937.20, 9472761.00, 2721391.00, 2724470.00],
      zOffset: 432.0,
      displayName: "September 2026",
    },
    october_2026: {
      elevationUrl: "./projects/Chattibhariatu/surveys/october_2026/DTM-CO.tif",
      orthoUrl: "./projects/Chattibhariatu/surveys/october_2026/Ortho_CO.tif",
      extent: [9467993.08, 9472764.75, 2721407.00, 2724254.39],
      zOffset: 432.0,
      displayName: "October 2026",
    },
  }
};

export const nhpdcConfig = {
  id: "nhpdc_project",
  folderName: "NHPDC",
  surveys: {
    default: {
      elevationUrl: "./projects/NHPDC/DTM_Final_CO.tif",
      orthoUrl: "./projects/NHPDC/Ortho_CO_20cm.tif",
      extent: [10650229.73, 10662844.23, 3262029.95, 3273051.45],
      zOffset: 137.3,
      displayName: "NHPDC Default",
    },
    july_2026: {
      elevationUrl: "./projects/NHPDC/DTM_Final_CO.tif",
      orthoUrl: "./projects/NHPDC/Ortho_CO_20cm.tif",
      extent: [10650229.73, 10662844.23, 3262029.95, 3273051.45],
      zOffset: 137.3,
      displayName: "July 2026",
    }
  }
};

export const ahujaConfig = {
  id: "ahuja_project",
  folderName: "ahuja",
  surveys: {
    may_2026: {
      elevationUrl: "./projects/ahuja/surveys/may_2026/Ahuja_DTM_COG.tif",
      orthoUrl: "./projects/ahuja/surveys/may_2026/Ambuja_ortho.tif",
      extent: [8755723.1688, 8756317.9188, 1942412.3557, 1943215.8557],
      zOffset: 550,
      displayName: "May 2026",
    }
  }
};

// ---------------------------------------------------------------------------
// Project registry
// ---------------------------------------------------------------------------
export const PROJECTS = {
  chattibhariatu_project: chattibhariatuConfig,
  chattibhariatu: chattibhariatuConfig,
  ahuja_project: ahujaConfig,
  ahuja: ahujaConfig,
  nhpdc_project: nhpdcConfig,
  nhpdc: nhpdcConfig,
};

/**
 * Register or override a project configuration at runtime.
 * @param {string} id - Project key (e.g. 'my_mine_site')
 * @param {object} config - Project definition with folderName & surveys
 */
export function registerProject(id, config) {
  if (!id || !config) return;
  PROJECTS[id] = config;
  PROJECTS[id.toLowerCase()] = config;
}

/**
 * Helper to parse URL query parameters and return the active project+survey config.
 * Supports ?project=...&survey=...
 */
export function getActiveProjectConfig() {
  const urlParams = new URLSearchParams(window.location.search);
  const projectId = urlParams.get("project") || "chattibhariatu_project";
  const hasExplicitSurvey = urlParams.has("survey");
  // Default to the latest active survey (October 2026) when no survey is specified
  const rawSurveyId = urlParams.get("survey") || "october_2026";

  const projectInfo = PROJECTS[projectId] || PROJECTS[projectId.toLowerCase()] || PROJECTS.chattibhariatu_project;
  const surveys = projectInfo.surveys || {};
  const defaultSurvey = surveys["october_2026"] || surveys["september_2026"] || surveys["august_2026"] || surveys["may_2026"] || surveys["default"] || Object.values(surveys)[0];

  // Smart survey lookup: matches "october", "october_2026", "september", "september_2026", etc.
  const cleanKey = rawSurveyId.toLowerCase().replace(/_2026$/, "");
  const surveyInfo = surveys[rawSurveyId]
    || surveys[rawSurveyId.toLowerCase()]
    || surveys[`${cleanKey}_2026`]
    || surveys[cleanKey];

  // If the user explicitly requested a survey and no 3D data exists for it:
  // DO NOT fall back to previous surveys! Flag it as not available.
  if (hasExplicitSurvey && !surveyInfo) {
    return {
      ...projectInfo,
      notAvailable: true,
      surveyId: rawSurveyId,
      id: projectId,
      folderName: projectInfo.folderName || projectId,
    };
  }

  const activeSurvey = surveyInfo || defaultSurvey;
  return {
    ...projectInfo,
    notAvailable: false,
    elevationUrl: activeSurvey?.elevationUrl,
    orthoUrl: activeSurvey?.orthoUrl,
    extent: activeSurvey?.extent || (defaultSurvey ? defaultSurvey.extent : [0, 0, 0, 0]),
    zOffset: (typeof activeSurvey?.zOffset === "number") ? activeSurvey.zOffset : (defaultSurvey ? defaultSurvey.zOffset : 0),
    id: projectId,
    folderName: projectInfo.folderName || projectId,
    surveyId: hasExplicitSurvey ? rawSurveyId : (activeSurvey === surveys["october_2026"] ? "october_2026" : rawSurveyId),
    displayName: activeSurvey?.displayName || rawSurveyId.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())
  };
}
