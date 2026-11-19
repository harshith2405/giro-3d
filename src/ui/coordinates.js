// src/ui/coordinates.js
// Live coordinate readout (terrain picking on hover -> Lon, Lat in WGS84, Elev in meters)

import { Vector2 } from "three";
import { proj4 } from "../config/crs.js";
import { state } from "../core/state.js";

export function initCoordinateReadout() {
  const instance = state.instance;
  if (!instance) return;
  const canvas = instance.domElement;
  const coordLonLat = document.getElementById("coordLonLat");
  const coordElev = document.getElementById("coordElev");

  canvas.addEventListener("mousemove", (e) => {
    if (!state.map) return;
    const rect = canvas.getBoundingClientRect();
    const mouse = new Vector2(e.clientX - rect.left, e.clientY - rect.top);
    const picked = state.map.pick(mouse);
    if (picked && picked.length > 0) {
      const hit = picked[0];

      let x, y, elev;
      if (hit.coord) {
        x = hit.coord.x;
        y = hit.coord.y;
        elev = hit.coord.z !== undefined ? hit.coord.z : (hit.coord.altitude !== undefined ? hit.coord.altitude : (hit.coord.values ? hit.coord.values[2] : hit.point.z));
      } else if (hit.point) {
        x = hit.point.x;
        y = hit.point.y;
        elev = hit.point.z;
      }

      if (x !== undefined && y !== undefined) {
        try {
          const [lon, lat] = proj4("EPSG:3395", "WGS84", [x, y]);
          if (coordLonLat) coordLonLat.textContent = `Lon: ${lon.toFixed(3)}°, Lat: ${lat.toFixed(3)}°`;
          if (coordElev) coordElev.textContent = `${Number(elev).toFixed(2)} m`;
        } catch (err) {
          console.error("Proj4 conversion error:", err);
        }
      }
    } else {
      if (coordLonLat) coordLonLat.textContent = "Lon: --, Lat: --";
      if (coordElev) coordElev.textContent = "--";
    }
  });

  canvas.addEventListener("mouseleave", () => {
    if (coordLonLat) coordLonLat.textContent = "Lon: --, Lat: --";
    if (coordElev) coordElev.textContent = "--";
  });
}
