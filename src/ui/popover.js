// src/ui/popover.js
// High-performance floating cards displaying quick metadata when hovering over saved reports and volume list items

export function showQuickInfoPopover(targetEl, type, title, rows) {
  const quickInfoPopover = document.getElementById("quickInfoPopover");
  const popoverTitle = document.getElementById("popoverTitle");
  const popoverBadge = document.getElementById("popoverBadge");
  const popoverBody = document.getElementById("popoverBody");

  if (!quickInfoPopover || !targetEl) return;
  if (popoverTitle) popoverTitle.textContent = title || "Details";
  if (popoverBadge) popoverBadge.textContent = type || "Info";

  let html = '<div class="popover-grid">';
  (rows || []).forEach(r => {
    html += `
      <div class="popover-row">
        <span class="popover-label">${r.label}</span>
        <span class="popover-value">${r.val}</span>
      </div>
    `;
  });
  html += '</div>';
  if (popoverBody) popoverBody.innerHTML = html;

  const rect = targetEl.getBoundingClientRect();

  let top = rect.top + (rect.height / 2) - 40;
  let left = rect.right + 12;

  if (left + 280 > window.innerWidth) {
    left = Math.max(10, rect.left - 290);
  }
  if (top + 180 > window.innerHeight) {
    top = Math.max(10, window.innerHeight - 190);
  }
  if (top < 10) top = 10;

  quickInfoPopover.style.top = `${top}px`;
  quickInfoPopover.style.left = `${left}px`;
  quickInfoPopover.style.display = "block";
  quickInfoPopover.classList.remove("hidden");
  requestAnimationFrame(() => {
    quickInfoPopover.classList.add("visible");
  });
}

export function hideQuickInfoPopover() {
  const quickInfoPopover = document.getElementById("quickInfoPopover");
  if (!quickInfoPopover) return;
  quickInfoPopover.classList.remove("visible");
  setTimeout(() => {
    if (!quickInfoPopover.classList.contains("visible")) {
      quickInfoPopover.style.display = "none";
      quickInfoPopover.classList.add("hidden");
    }
  }, 150);
}
