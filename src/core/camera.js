// src/core/camera.js
// 3D Camera Controls, Smooth Top-Down Transitions, Sliders, and Frustum Projections

import { Vector3, Vector2 } from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import Extent from "@giro3d/giro3d/core/geographic/Extent.js";
import { giroCrs } from "../config/crs.js";
import { state } from "./state.js";
import { getVisibleViewportOffset } from "../ui/viewport.js";
import { getActiveProjectConfig } from "../config/projects.js";

let suppressSliderSync = false;
let cameraFlightAnimId = null;

// Arrow key velocity state for continuous smooth keyboard navigation
const arrowKeysPressed = {
  ArrowUp: false,
  ArrowDown: false,
  ArrowLeft: false,
  ArrowRight: false
};
let camVelocityX = 0;
let camVelocityY = 0;
let animFrameId = null;

export function initCamera(instance) {
  instance.view.camera.near = 0.1;
  instance.view.camera.far = 1e6;

  const controls = new MapControls(instance.view.camera, instance.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 20;
  controls.maxDistance = 150000;
  controls.maxPolarAngle = Math.PI / 2;
  controls.zoomToCursor = true;

  instance.view.setControls(controls);
  state.controls = controls;

  // Wheel zoom interceptor during drawing modes (when controls are disabled)
  const canvas = instance.domElement;
  canvas.addEventListener("wheel", (e) => {
    if (controls && !controls.enabled) {
      e.preventDefault();
      e.stopPropagation();

      const zoomFactor = e.deltaY < 0 ? 0.88 : 1.14;
      const camera = instance.view?.camera;
      if (camera && controls.target) {
        const offset = camera.position.clone().sub(controls.target);
        offset.multiplyScalar(zoomFactor);
        const dist = offset.length();
        if (dist >= (controls.minDistance || 20) && dist <= (controls.maxDistance || 150000)) {
          camera.position.copy(controls.target).add(offset);
          controls.update();
        }
      }

      if (instance.view?.camera) instance.view.camera.updateMatrixWorld(true);
      instance.notifyChange(instance.view?.camera);
      instance.notifyChange();

      syncSlidersFromCamera();
    }
  }, { passive: false });

  initCameraUI();

  return controls;
}

/**
 * Projects a world-space point to screen pixel coordinates with near-frustum clipping.
 */
export function projectToScreen(worldPoint, rectOverride = null) {
  const instance = state.instance;
  if (!instance || !instance.view || !instance.view.camera || !worldPoint) {
    return { x: 0, y: 0, z: 9999, isBehind: true };
  }
  const camera = instance.view.camera;
  camera.updateMatrixWorld(true);

  // 1. Check if point is behind the camera or closer than the near clipping plane
  const camPoint = worldPoint.clone().applyMatrix4(camera.matrixWorldInverse);
  const nearLimit = -(camera.near || 0.1);
  if (camPoint.z >= nearLimit) {
    return { x: 0, y: 0, z: 9999, isBehind: true };
  }

  // 2. Project into NDC
  const ndc = worldPoint.clone().project(camera);
  if (ndc.z > 1) {
    return { x: 0, y: 0, z: ndc.z, isBehind: true };
  }

  // 3. Convert NDC to Screen Coordinates
  const canvas = instance.domElement;
  const rect = rectOverride || (canvas ? canvas.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 });
  const x = ((ndc.x + 1) / 2) * rect.width;
  const y = ((-ndc.y + 1) / 2) * rect.height;
  return { x, y, z: ndc.z, isBehind: false };
}

/**
 * Frame camera smoothly on given geographic extent, taking into account the left sidebar flyout.
 */
export function frameCameraOnExtent(extent, extentOverride = false) {
  const instance = state.instance;
  const controls = state.controls;
  if (!instance || !instance.view || !instance.view.camera || !controls) return;
  const center = extent.centerAsVector3();
  const dims = extent.dimensions();
  const zOffset = (state.activeProject?.zOffset || 0);

  const camera = instance.view.camera;
  const fovRad = (camera.fov || 45) * (Math.PI / 180);
  const winW = window.innerWidth || 1920;
  const winH = window.innerHeight || 1080;
  const leftOffset = getVisibleViewportOffset();
  const visibleW = Math.max(winW - leftOffset, 400);

  // Calculate required altitude so dims fit cleanly within the visible viewport (accounting for left panel)
  const aspectVisible = visibleW / winH;
  const requiredH = Math.max(dims.y, dims.x / aspectVisible);
  const zoomMultiplier = extentOverride ? 2.4 : 1.35;
  const altitudeDist = (requiredH / (2 * Math.tan(fovRad / 2))) * zoomMultiplier;
  const altitude = zOffset + Math.max(altitudeDist, 200);

  // Calculate how much world space is covered per screen pixel at this altitude
  const visibleWorldH = 2 * altitudeDist * Math.tan(fovRad / 2);
  const worldPerPixel = visibleWorldH / winH;
  const shiftWorldX = (leftOffset / 2) * worldPerPixel;

  // Shift camera target to the left so the terrain center appears in the center of the visible area
  const adjustedCenterX = center.x - shiftWorldX;
  const adjustedCenterY = center.y;

  const camPos = new Vector3(adjustedCenterX, adjustedCenterY, altitude);
  camera.position.copy(camPos);
  controls.target.set(adjustedCenterX, adjustedCenterY, zOffset);
  controls.update();
  camera.updateMatrixWorld(true);
  instance.notifyChange(camera);
  instance.notifyChange();
}

/**
 * Position camera looking straight down (tilt = 0) scaled to feature span in visible canvas.
 */
export function setCameraTopDown(targetX, targetY, span = 300, animate = true) {
  const instance = state.instance;
  const controls = state.controls;
  if (!instance || !instance.view || !instance.view.camera || !controls) return;
  if (cameraFlightAnimId) {
    cancelAnimationFrame(cameraFlightAnimId);
    cameraFlightAnimId = null;
  }

  const camera = instance.view.camera;
  const fovRad = (camera.fov || 45) * (Math.PI / 180);
  const winH = window.innerHeight || 1080;
  const leftOffset = getVisibleViewportOffset();

  // Scale altitude based on span (allow smaller areas to zoom in close, min 40m)
  const altitudeDist = Math.max(span * 1.8, 40);

  // Sample real terrain elevation if available, otherwise project zOffset
  let surfaceZ = state.activeProject?.zOffset || 0;
  if (state.map && typeof state.map.getElevationFast === 'function') {
    const sample = state.map.getElevationFast(targetX, targetY);
    if (sample && sample.elevation !== undefined && !isNaN(sample.elevation)) {
      surfaceZ = sample.elevation;
    }
  }
  const altitude = surfaceZ + altitudeDist;

  const visibleWorldH = 2 * altitudeDist * Math.tan(fovRad / 2);
  const worldPerPixel = visibleWorldH / winH;
  const shiftWorldX = (leftOffset / 2) * worldPerPixel;

  const adjustedTargetX = targetX - shiftWorldX;

  if (!animate) {
    camera.position.set(adjustedTargetX, targetY, altitude);
    controls.target.set(adjustedTargetX, targetY, surfaceZ);
    controls.update();
    if (camera) camera.updateMatrixWorld(true);
    instance.notifyChange(camera);
    instance.notifyChange();
    syncSlidersFromCamera();
    return;
  }

  // Smooth easeInOutCubic flight animation
  const startCamPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const endCamPos = new Vector3(adjustedTargetX, targetY, altitude);
  const endTarget = new Vector3(adjustedTargetX, targetY, surfaceZ);
  const durationMs = 500;
  const startTime = performance.now();

  function stepFlight(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    const t = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

    camera.position.lerpVectors(startCamPos, endCamPos, t);
    controls.target.lerpVectors(startTarget, endTarget, t);
    controls.update();
    if (camera) camera.updateMatrixWorld(true);
    instance.notifyChange(camera);
    instance.notifyChange();
    syncSlidersFromCamera();

    if (progress < 1) {
      cameraFlightAnimId = requestAnimationFrame(stepFlight);
    } else {
      cameraFlightAnimId = null;
      camera.position.copy(endCamPos);
      controls.target.copy(endTarget);
      controls.update();
      if (camera) camera.updateMatrixWorld(true);
      instance.notifyChange(camera);
      instance.notifyChange();
      syncSlidersFromCamera();
    }
  }

  cameraFlightAnimId = requestAnimationFrame(stepFlight);
}

// ---------------------------------------------------------------------------
// Sliders & 2D/3D Toggles
// ---------------------------------------------------------------------------
let cameraUiInitialized = false;

export function syncSlidersFromCamera() {
  if (suppressSliderSync) return;
  const controls = state.controls;
  if (!controls) return;
  const headingSlider = document.getElementById("headingSlider");
  const tiltSlider = document.getElementById("tiltSlider");
  const headingValue = document.getElementById("headingValue");
  const tiltValue = document.getElementById("tiltValue");

  let heading = Math.round((controls.getAzimuthalAngle() * 180) / Math.PI);
  // Normalize to -180 .. 180 range
  heading = ((heading + 180) % 360 + 360) % 360 - 180;
  const tilt = Math.round(Math.max(0, Math.min(90, (controls.getPolarAngle() * 180) / Math.PI)));

  if (headingSlider) headingSlider.value = heading;
  if (headingValue) headingValue.textContent = heading + "°";
  if (tiltSlider) tiltSlider.value = tilt;
  if (tiltValue) tiltValue.textContent = tilt + "°";
}

export function applyCameraFromSliders() {
  const controls = state.controls;
  const instance = state.instance;
  if (!controls || !instance) return;
  const headingSlider = document.getElementById("headingSlider");
  const tiltSlider = document.getElementById("tiltSlider");
  const headingValue = document.getElementById("headingValue");
  const tiltValue = document.getElementById("tiltValue");
  if (!headingSlider || !tiltSlider) return;

  suppressSliderSync = true;
  const azimuth = (parseFloat(headingSlider.value) * Math.PI) / 180;
  const polar = (parseFloat(tiltSlider.value) * Math.PI) / 180;

  const minAz = controls.minAzimuthAngle;
  const maxAz = controls.maxAzimuthAngle;
  const minPol = controls.minPolarAngle;
  const maxPol = controls.maxPolarAngle;

  controls.minAzimuthAngle = azimuth;
  controls.maxAzimuthAngle = azimuth;
  controls.minPolarAngle = polar;
  controls.maxPolarAngle = polar;
  controls.update();

  const camera = instance.view?.camera;
  if (camera) camera.updateMatrixWorld(true);
  instance.notifyChange(camera);
  instance.notifyChange();

  controls.minAzimuthAngle = minAz;
  controls.maxAzimuthAngle = maxAz;
  controls.minPolarAngle = minPol;
  controls.maxPolarAngle = maxPol;

  if (headingValue) headingValue.textContent = headingSlider.value + "°";
  if (tiltValue) tiltValue.textContent = tiltSlider.value + "°";
  suppressSliderSync = false;
}

export function initCameraUI() {
  if (cameraUiInitialized) return;
  cameraUiInitialized = true;

  const controls = state.controls;
  if (controls) {
    controls.addEventListener("change", syncSlidersFromCamera);
  }

  const headingSlider = document.getElementById("headingSlider");
  const tiltSlider = document.getElementById("tiltSlider");
  headingSlider?.addEventListener("input", applyCameraFromSliders);
  tiltSlider?.addEventListener("input", applyCameraFromSliders);

  const camControlsPanel = document.getElementById("camControlsPanel");
  const resetCameraBtn = document.getElementById("resetCameraBtn");

  camControlsPanel?.addEventListener("dblclick", (e) => e.stopPropagation());
  camControlsPanel?.addEventListener("mousedown", (e) => e.stopPropagation());
  resetCameraBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const project = getActiveProjectConfig();
    const extent = new Extent(giroCrs, ...project.extent);
    frameCameraOnExtent(extent, false);
    syncSlidersFromCamera();
  });

  // Global Arrow Key Camera Controls (Continuous Smooth Inertia Sliding)
  window.addEventListener("keydown", (e) => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.tagName === "SELECT")) {
      return;
    }
    if (e.key in arrowKeysPressed) {
      e.preventDefault();
      arrowKeysPressed[e.key] = true;
      startSmoothCamLoop();
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.key in arrowKeysPressed) {
      arrowKeysPressed[e.key] = false;
    }
  });

  syncSlidersFromCamera();
}

function startSmoothCamLoop() {
  if (animFrameId) return;

  function updateCamVelocity() {
    const controls = state.controls;
    const instance = state.instance;
    if (!controls || !state.map || !instance) {
      animFrameId = null;
      return;
    }

    const cameraObj = controls.object || instance.view?.camera;
    if (!cameraObj || !controls.target) {
      animFrameId = null;
      return;
    }

    const isAnyKeyPressed = Object.values(arrowKeysPressed).some(Boolean);

    let targetVelX = 0;
    let targetVelY = 0;

    if (isAnyKeyPressed) {
      const dist = cameraObj.position.distanceTo(controls.target);
      const maxSpeed = Math.max(0.05, Math.min(6, dist * 0.0006));
      const azimuth = controls.getAzimuthalAngle ? controls.getAzimuthalAngle() : 0;
      const sinAz = Math.sin(azimuth);
      const cosAz = Math.cos(azimuth);

      if (arrowKeysPressed.ArrowUp) {
        targetVelX += -maxSpeed * sinAz;
        targetVelY += maxSpeed * cosAz;
      }
      if (arrowKeysPressed.ArrowDown) {
        targetVelX += maxSpeed * sinAz;
        targetVelY += -maxSpeed * cosAz;
      }
      if (arrowKeysPressed.ArrowLeft) {
        targetVelX += -maxSpeed * cosAz;
        targetVelY += -maxSpeed * sinAz;
      }
      if (arrowKeysPressed.ArrowRight) {
        targetVelX += maxSpeed * cosAz;
        targetVelY += maxSpeed * sinAz;
      }
    }

    const lerpFactor = isAnyKeyPressed ? 0.05 : 0.05;
    camVelocityX += (targetVelX - camVelocityX) * lerpFactor;
    camVelocityY += (targetVelY - camVelocityY) * lerpFactor;

    const currentSpeedSq = camVelocityX * camVelocityX + camVelocityY * camVelocityY;

    if (currentSpeedSq > 0.0001) {
      controls.target.x += camVelocityX;
      controls.target.y += camVelocityY;
      cameraObj.position.x += camVelocityX;
      cameraObj.position.y += camVelocityY;

      controls.update();
      instance.notifyChange();

      animFrameId = requestAnimationFrame(updateCamVelocity);
    } else {
      camVelocityX = 0;
      camVelocityY = 0;
      animFrameId = null;
    }
  }

  animFrameId = requestAnimationFrame(updateCamVelocity);
}
