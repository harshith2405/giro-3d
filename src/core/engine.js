// src/core/engine.js
// Giro3D 3D Instance Initialization and Custom Terrain Shader Patches

import Instance from "@giro3d/giro3d/core/Instance.js";
import LayeredMaterial from "@giro3d/giro3d/renderer/LayeredMaterial.js";
import { Color } from "three";
import { giroCrs } from "../config/crs.js";
import { state } from "./state.js";

// ---------------------------------------------------------------------------
// Patch Giro3D terrain shader to cleanly discard white / off-white padding border on drone orthophotos
// ---------------------------------------------------------------------------
const origOnBeforeCompile = LayeredMaterial.prototype.onBeforeCompile;
LayeredMaterial.prototype.onBeforeCompile = function(parameters) {
  if (origOnBeforeCompile) origOnBeforeCompile.call(this, parameters);
  if (parameters.fragmentShader && parameters.fragmentShader.includes("gl_FragColor.a *= maskOpacity;")) {
    parameters.fragmentShader = parameters.fragmentShader.replace(
      "gl_FragColor.a *= maskOpacity;",
      "gl_FragColor.a *= maskOpacity;\n    if (gl_FragColor.r > 0.96 && gl_FragColor.g > 0.96 && gl_FragColor.b > 0.96) { discard; }"
    );
  }
};

const origCacheKey = LayeredMaterial.prototype.customProgramCacheKey;
LayeredMaterial.prototype.customProgramCacheKey = function() {
  const base = origCacheKey ? origCacheKey.call(this) : (this.defines.VISIBLE_COLOR_LAYER_COUNT ?? 0).toString();
  return base + "_clip_white";
};

// ---------------------------------------------------------------------------
// Giro3D instance initialization
// ---------------------------------------------------------------------------
export function initEngine() {
  const instance = new Instance({
    target: "view",
    crs: giroCrs,
    backgroundColor: 0x1e2229,
  });

  if (instance.scene) {
    instance.scene.background = new Color(0x1e2229);
  }
  if (instance.renderer) {
    instance.renderer.setClearColor(0x1e2229, 1);
    instance.renderer.localClippingEnabled = true;
  }

  state.instance = instance;
  return instance;
}
