// src/ui/dialogs.js
// Custom In-App Glassmorphic Dialog System (Prompt / Confirm / Alert)
// Eliminates native browser popups with bucket origins

let currentDialogResolve = null;

export function closeCustomDialog(result = null) {
  const customDialogModal = document.getElementById("customDialogModal");
  if (!customDialogModal) return;
  customDialogModal.classList.add("hidden");
  if (currentDialogResolve) {
    currentDialogResolve(result);
    currentDialogResolve = null;
  }
}

export function showCustomPrompt(message, defaultValue = "", title = "Enter Name") {
  return new Promise((resolve) => {
    currentDialogResolve = resolve;
    const customDialogModal = document.getElementById("customDialogModal");
    const customDialogTitle = document.getElementById("customDialogTitle");
    const customDialogMessage = document.getElementById("customDialogMessage");
    const customDialogInputGroup = document.getElementById("customDialogInputGroup");
    const customDialogInput = document.getElementById("customDialogInput");
    const customDialogConfirm = document.getElementById("customDialogConfirm");
    const customDialogCancel = document.getElementById("customDialogCancel");
    const customDialogIconWrapper = document.getElementById("customDialogIconWrapper");
    const customDialogIconPrompt = document.getElementById("customDialogIconPrompt");
    const customDialogIconConfirm = document.getElementById("customDialogIconConfirm");
    const customDialogIconAlert = document.getElementById("customDialogIconAlert");
    const customDialogIconSuccess = document.getElementById("customDialogIconSuccess");

    if (!customDialogModal) return resolve(null);

    if (customDialogTitle) customDialogTitle.textContent = title;
    if (customDialogMessage) customDialogMessage.textContent = message;
    if (customDialogInputGroup) customDialogInputGroup.classList.remove("hidden");
    if (customDialogInput) customDialogInput.value = defaultValue;

    customDialogIconPrompt?.classList.remove("hidden");
    customDialogIconConfirm?.classList.add("hidden");
    customDialogIconAlert?.classList.add("hidden");
    customDialogIconSuccess?.classList.add("hidden");
    customDialogIconWrapper?.classList.remove("warning", "success");

    if (customDialogCancel) customDialogCancel.classList.remove("hidden");
    if (customDialogConfirm) {
      customDialogConfirm.textContent = "Save";
      customDialogConfirm.classList.remove("danger");
    }

    customDialogModal.classList.remove("hidden");
    setTimeout(() => {
      if (customDialogInput) {
        customDialogInput.focus();
        customDialogInput.select();
      }
    }, 50);

    const handleConfirm = () => {
      const val = customDialogInput ? customDialogInput.value.trim() : "";
      closeCustomDialog(val || null);
    };

    const handleKeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeCustomDialog(null);
      }
    };

    if (customDialogConfirm) customDialogConfirm.onclick = handleConfirm;
    if (customDialogInput) customDialogInput.onkeydown = handleKeydown;
  });
}

export function showCustomConfirm(message, title = "Confirm Action", isDanger = false) {
  return new Promise((resolve) => {
    currentDialogResolve = resolve;
    const customDialogModal = document.getElementById("customDialogModal");
    const customDialogTitle = document.getElementById("customDialogTitle");
    const customDialogMessage = document.getElementById("customDialogMessage");
    const customDialogInputGroup = document.getElementById("customDialogInputGroup");
    const customDialogConfirm = document.getElementById("customDialogConfirm");
    const customDialogCancel = document.getElementById("customDialogCancel");
    const customDialogIconWrapper = document.getElementById("customDialogIconWrapper");
    const customDialogIconPrompt = document.getElementById("customDialogIconPrompt");
    const customDialogIconConfirm = document.getElementById("customDialogIconConfirm");
    const customDialogIconAlert = document.getElementById("customDialogIconAlert");
    const customDialogIconSuccess = document.getElementById("customDialogIconSuccess");

    if (!customDialogModal) return resolve(false);

    if (customDialogTitle) customDialogTitle.textContent = title;
    if (customDialogMessage) customDialogMessage.textContent = message;
    if (customDialogInputGroup) customDialogInputGroup.classList.add("hidden");

    customDialogIconPrompt?.classList.add("hidden");
    customDialogIconConfirm?.classList.remove("hidden");
    customDialogIconAlert?.classList.add("hidden");
    customDialogIconSuccess?.classList.add("hidden");

    if (isDanger) {
      customDialogIconWrapper?.classList.add("warning");
      if (customDialogConfirm) customDialogConfirm.classList.add("danger");
    } else {
      customDialogIconWrapper?.classList.remove("warning", "success");
      if (customDialogConfirm) customDialogConfirm.classList.remove("danger");
    }

    if (customDialogCancel) customDialogCancel.classList.remove("hidden");
    if (customDialogConfirm) customDialogConfirm.textContent = isDanger ? "Delete" : "Confirm";

    customDialogModal.classList.remove("hidden");

    if (customDialogConfirm) customDialogConfirm.onclick = () => closeCustomDialog(true);
    if (customDialogCancel) customDialogCancel.onclick = () => closeCustomDialog(false);
  });
}

export function showCustomAlert(message, title = "Notification", type = "info") {
  return new Promise((resolve) => {
    currentDialogResolve = resolve;
    const customDialogModal = document.getElementById("customDialogModal");
    const customDialogTitle = document.getElementById("customDialogTitle");
    const customDialogMessage = document.getElementById("customDialogMessage");
    const customDialogInputGroup = document.getElementById("customDialogInputGroup");
    const customDialogConfirm = document.getElementById("customDialogConfirm");
    const customDialogCancel = document.getElementById("customDialogCancel");
    const customDialogIconWrapper = document.getElementById("customDialogIconWrapper");
    const customDialogIconPrompt = document.getElementById("customDialogIconPrompt");
    const customDialogIconConfirm = document.getElementById("customDialogIconConfirm");
    const customDialogIconAlert = document.getElementById("customDialogIconAlert");
    const customDialogIconSuccess = document.getElementById("customDialogIconSuccess");

    if (!customDialogModal) return resolve();

    if (customDialogTitle) customDialogTitle.textContent = title;
    if (customDialogMessage) customDialogMessage.textContent = message;
    if (customDialogInputGroup) customDialogInputGroup.classList.add("hidden");

    customDialogIconPrompt?.classList.add("hidden");
    customDialogIconConfirm?.classList.add("hidden");

    if (type === "error" || type === "warning") {
      customDialogIconAlert?.classList.remove("hidden");
      customDialogIconSuccess?.classList.add("hidden");
      customDialogIconWrapper?.classList.add("warning");
      customDialogIconWrapper?.classList.remove("success");
    } else if (type === "success") {
      customDialogIconAlert?.classList.add("hidden");
      customDialogIconSuccess?.classList.remove("hidden");
      customDialogIconWrapper?.classList.add("success");
      customDialogIconWrapper?.classList.remove("warning");
    } else {
      customDialogIconConfirm?.classList.remove("hidden");
      customDialogIconAlert?.classList.add("hidden");
      customDialogIconSuccess?.classList.add("hidden");
      customDialogIconWrapper?.classList.remove("warning", "success");
    }

    if (customDialogCancel) customDialogCancel.classList.add("hidden");
    if (customDialogConfirm) {
      customDialogConfirm.textContent = "OK";
      customDialogConfirm.classList.remove("danger");
      customDialogConfirm.onclick = () => closeCustomDialog(true);
    }

    customDialogModal.classList.remove("hidden");
  });
}

export function initDialogs() {
  const customDialogModal = document.getElementById("customDialogModal");
  const customDialogClose = document.getElementById("customDialogClose");
  const customDialogCancel = document.getElementById("customDialogCancel");

  customDialogClose?.addEventListener("click", () => closeCustomDialog(null));
  customDialogCancel?.addEventListener("click", () => closeCustomDialog(null));

  customDialogModal?.addEventListener("click", (e) => {
    if (e.target === customDialogModal) {
      closeCustomDialog(null);
    }
  });

  // Attach to window for backwards compatibility with any inline handler
  window.showCustomPrompt = showCustomPrompt;
  window.showCustomConfirm = showCustomConfirm;
  window.showCustomAlert = showCustomAlert;
}
