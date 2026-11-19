// src/config/crs.js
// Coordinate Reference Systems (CRS) and projection registrations

import proj4 from "proj4";
import { register } from "ol/proj/proj4";
import CoordinateSystem from "@giro3d/giro3d/core/geographic/CoordinateSystem.js";
import HttpConfiguration from "@giro3d/giro3d/utils/HttpConfiguration.js";

// Fix for Chromium's ERR_CACHE_OPERATION_NOT_SUPPORTED on GeoTIFF range requests
HttpConfiguration.setOptions(window.location.origin, { cache: "no-store" });

// ---------------------------------------------------------------------------
// CRS registration
// ---------------------------------------------------------------------------
proj4.defs(
  "EPSG:3395",
  "+proj=merc +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs +type=crs"
);
proj4.defs(
  "EPSG:32645",
  "+proj=utm +zone=45 +datum=WGS84 +units=m +no_defs +type=crs"
);
register(proj4);

export const giroCrs = new CoordinateSystem("EPSG:3395");
export { proj4 };

export function initProj4() {
  // Purge legacy persistent localStorage folder keys to prevent multi-survey cross-contamination
  try {
    localStorage.removeItem("polygon_profile_folders");
    localStorage.removeItem("polygon_volume_folders");
    localStorage.removeItem("polygon_known_folders");
    localStorage.removeItem("polygon_folders");
  } catch (e) {
    // Ignore localStorage security/quota errors
  }
}
