// src/ui/viewport.js
// Viewport offset calculations, responsive sidebar flyout interactions

import { state } from "../core/state.js";
import { clearAllLeftPanelState } from "../services/clearState.js";

/**
 * Calculates the width in screen pixels occupied by the left sidebar and flyout.
 * Ensures 3D camera targeting centers the terrain in the visible canvas area.
 */
export function getVisibleViewportOffset() {
  const leftPanel = document.getElementById("flyoutPanel");
  const isLeftPanelOpen = leftPanel && !leftPanel.classList.contains("closed");
  // 58px icon sidebar + (320px flyout panel if open)
  const leftPx = isLeftPanelOpen ? 378 : 58;
  return leftPx;
}

export function closeFlyout() {
  const flyoutPanel = document.getElementById('flyoutPanel');
  const iconBtns = document.querySelectorAll('.left-icon-btn');
  if (flyoutPanel) flyoutPanel.classList.add('closed');
  iconBtns.forEach(b => b.classList.remove('active'));
}

export function initViewportUI() {
  const flyoutPanel = document.getElementById('flyoutPanel');
  const toggleFlyoutPanel = document.getElementById('toggleFlyoutPanel');
  const iconBtns = document.querySelectorAll('.left-icon-btn');
  const flyoutGroups = document.querySelectorAll('.left-group');
  const flyoutTitle = document.getElementById('flyoutTitle');
  const btnBrandLogo = document.getElementById('btnBrandLogo');

  btnBrandLogo?.addEventListener('click', () => {
    window.location.reload();
  });

  // Open / Switch Flyout
  iconBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      if (!targetId || !flyoutPanel) return;

      const isAlreadyActiveAndOpen = btn.classList.contains('active') && !flyoutPanel.classList.contains('closed');

      // If clicking the currently active button while open, toggle it closed
      if (isAlreadyActiveAndOpen) {
        closeFlyout();
        return;
      }

      // Otherwise, open it and switch active state
      flyoutPanel.classList.remove('closed');

      // Update buttons
      iconBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update groups visibility
      flyoutGroups.forEach(g => {
        if (g.id === targetId) {
          g.classList.remove('hidden');
          g.classList.add('active');
          g.style.display = 'block';
        } else {
          g.classList.add('hidden');
          g.classList.remove('active');
          g.style.display = 'none';
        }
      });

      // Update Title
      if (flyoutTitle) {
        flyoutTitle.textContent = btn.getAttribute('title') || 'Panel';
      }

      // Reset left panel active drawing/measure state (preserves active clipped ROI & right panel overlays)
      clearAllLeftPanelState(true);
    });
  });

  // Close button inside flyout
  toggleFlyoutPanel?.addEventListener('click', () => {
    closeFlyout();
  });

  // Left Panel Features Accordions
  const toggleAccordion = (headerId, listId, carrotId) => {
    const header = document.getElementById(headerId);
    const list = document.getElementById(listId);
    const carrot = document.getElementById(carrotId);
    if (!header || !list || !carrot) return;

    header.addEventListener("click", (e) => {
      if (e.target.closest("button") || e.target.closest("input")) return;
      const isHidden = list.style.display === "none";
      list.style.display = isHidden ? "flex" : "none";
      carrot.style.transform = isHidden ? "rotate(0deg)" : "rotate(-90deg)";
      carrot.style.transition = "transform 0.2s";

      if (isHidden) {
        if (headerId === "featuresLinesHeader") {
          const volumeSvg = document.getElementById("volumeSvg");
          if (volumeSvg) volumeSvg.style.display = "none";
          state.multiSelectedVolumesMap?.clear();
          if (typeof window.updateMultiOverlaySvg === "function") window.updateMultiOverlaySvg();
        } else if (headerId === "featuresPolygonsHeader") {
          const measureSvg = document.getElementById("measureSvg");
          if (measureSvg) measureSvg.style.display = "none";
          state.multiSelectedReportsMap?.clear();
          if (typeof window.updateMultiOverlaySvg === "function") window.updateMultiOverlaySvg();
        }
      }
    });
  };

  toggleAccordion("featuresPointsHeader", "featuresListPoints", "featuresPointsCarrot");
  toggleAccordion("featuresRoisHeader", "featuresListRois", "featuresRoisCarrot");
  toggleAccordion("featuresLinesHeader", "featuresListLines", "featuresLinesCarrot");
  toggleAccordion("featuresPolygonsHeader", "featuresListPolygons", "featuresPolygonsCarrot");
}
