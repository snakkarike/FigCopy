const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");

function setStatus(text, kind) {
  statusText.textContent = text;
  statusEl.className = "status-bar" + (kind ? " " + kind : "");
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Injects the content script if it hasn't been injected yet (e.g. after extension reload),
// then sends a message. Returns true if the message was sent successfully.
async function ensureContentScript(tabId) {
  try {
    // Ping the content script first.
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
    return true;
  } catch (_) {
    // Not injected yet — inject it now.
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      return true;
    } catch (err) {
      setStatus("Can't inject script on this page.", "err");
      return false;
    }
  }
}

async function applyViewportResize(tab) {
  const widthStr = document.getElementById("viewportSelect").value;
  if (widthStr === "current") return false;

  let width = parseInt(widthStr, 10);
  if (widthStr === "custom") {
    width = parseInt(document.getElementById("customWidthInput").value, 10) || 1200;
  }
  
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: "START_EMULATION", tabId: tab.id, width }, (res) => {
      if (res && res.success) {
        // Wait a tiny bit for the browser to reflow the layout
        setTimeout(() => resolve(true), 400);
      } else {
        resolve(false);
      }
    });
  });
}

function getViewportWidth() {
  const widthStr = document.getElementById("viewportSelect").value;
  if (widthStr === "custom") return document.getElementById("customWidthInput").value || "";
  if (widthStr === "current") return "";
  return widthStr;
}

document.getElementById("viewportSelect").addEventListener("change", (e) => {
  const customWrap = document.getElementById("customWidthWrap");
  if (e.target.value === "custom") {
    customWrap.style.display = "block";
  } else {
    customWrap.style.display = "none";
  }
});

let isEmulating = false;

async function checkEmulationState() {
  const tab = await getActiveTab();
  if (!tab) return;
  chrome.runtime.sendMessage({ type: "CHECK_EMULATION", tabId: tab.id }, (res) => {
    isEmulating = res && res.isEmulating;
    updateEmulateBtnUI();
  });
}

function updateEmulateBtnUI() {
  const btn = document.getElementById("emulateBtn");
  if (isEmulating) {
    btn.innerHTML = `<span class="btn-icon">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1 6C1 6 3 2 6 2C9 2 11 6 11 6C11 6 9 10 6 10C3 10 1 6 1 6Z" stroke="var(--text)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="1.5" y1="10.5" x2="10.5" y2="1.5" stroke="var(--text)" stroke-width="1.2"/>
      </svg>
    </span>Stop Emulating`;
    btn.classList.add("active-toggle"); // You can style this if needed
  } else {
    btn.innerHTML = `<span class="btn-icon">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1 6C1 6 3 2 6 2C9 2 11 6 11 6C11 6 9 10 6 10C3 10 1 6 1 6Z" stroke="var(--text)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="6" cy="6" r="2" stroke="var(--text)" stroke-width="1.2"/>
      </svg>
    </span>Toggle Emulation`;
    btn.classList.remove("active-toggle");
  }
}

// Check state on load
checkEmulationState();

const downloadCheck = document.getElementById("downloadCheck");
const skipFormValuesCheck = document.getElementById("skipFormValuesCheck");
const reduceLayersCheck = document.getElementById("reduceLayersCheck");

chrome.storage.local.get(["downloadInstead", "skipFormValues", "reduceLayers"], (data) => {
  downloadCheck.checked = !!data.downloadInstead;
  skipFormValuesCheck.checked = !!data.skipFormValues;
  reduceLayersCheck.checked = !!data.reduceLayers;
});
downloadCheck.addEventListener("change", () => {
  chrome.storage.local.set({ downloadInstead: downloadCheck.checked });
});
skipFormValuesCheck.addEventListener("change", () => {
  chrome.storage.local.set({ skipFormValues: skipFormValuesCheck.checked });
});
reduceLayersCheck.addEventListener("change", () => {
  chrome.storage.local.set({ reduceLayers: reduceLayersCheck.checked });
});

document.getElementById("emulateBtn").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab) return setStatus("No active tab.", "err");
  
  if (isEmulating) {
    chrome.runtime.sendMessage({ type: "STOP_EMULATION", tabId: tab.id });
    isEmulating = false;
    updateEmulateBtnUI();
  } else {
    if (document.getElementById("viewportSelect").value === "current") {
      setStatus("Select a width to emulate first", "err");
      return;
    }
    const success = await applyViewportResize(tab);
    if (success) {
      isEmulating = true;
      updateEmulateBtnUI();
      setStatus("Emulation started", "ok");
    } else {
      setStatus("Failed to start emulation", "err");
    }
  }
});

document.getElementById("pickBtn").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab) return setStatus("No active tab.", "err");

  const ok = await ensureContentScript(tab.id);
  if (!ok) return;

  const didEmulate = await applyViewportResize(tab);
  const downloadInstead = downloadCheck.checked;
  const skipFormValues = skipFormValuesCheck.checked;
  const reduceLayers = reduceLayersCheck.checked;

  setStatus("Click any element… (Esc to cancel)");
  const viewportWidth = getViewportWidth();
  chrome.tabs.sendMessage(tab.id, { type: "START_PICKER", didEmulate, downloadInstead, skipFormValues, viewportWidth, reduceLayers }, () => {
    if (chrome.runtime.lastError) {}
    window.close();
  });
});

document.getElementById("fullPageBtn").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab) return setStatus("No active tab.", "err");

  const ok = await ensureContentScript(tab.id);
  if (!ok) return;

  const didEmulate = await applyViewportResize(tab);

  setStatus("Capturing…", "loading");
  const downloadInstead = downloadCheck.checked;
  const skipFormValues = skipFormValuesCheck.checked;
  const reduceLayers = reduceLayersCheck.checked;
  
  chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_FULL_PAGE", skipFormValues, reduceLayers, viewportWidth: getViewportWidth() }, async (response) => {
    if (didEmulate) {
      chrome.runtime.sendMessage({ type: "STOP_EMULATION", tabId: tab.id });
    }

    if (chrome.runtime.lastError || !response || !response.ok) {
      setStatus("Couldn't reach the page. Try reloading it.", "err");
      return;
    }
    try {
      const json = JSON.stringify(response.data);
      const vpSuffix = viewportWidth ? `-${viewportWidth}px` : "";
      if (downloadInstead) {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        let host = "page";
        try { host = new URL(tab.url).hostname.replace(/[^a-z0-9]/gi, '-'); } catch(e) {}
        const d = new Date();
        const time = `${d.getHours().toString().padStart(2, '0')}${d.getMinutes().toString().padStart(2, '0')}${d.getSeconds().toString().padStart(2, '0')}`;
        a.download = `figcopy-${host}-fullpage${vpSuffix}-${time}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setStatus(`Downloaded! (${(json.length / 1024).toFixed(1)} KB)`, "ok");
      } else {
        await navigator.clipboard.writeText(json);
        setStatus(`Copied! (${(json.length / 1024).toFixed(1)} KB)`, "ok");
      }
    } catch (e) {
      setStatus("Captured, but write failed.", "err");
    }
  });
});
