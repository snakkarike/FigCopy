const statusEl = document.getElementById("status");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind || "";
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

document.getElementById("pickBtn").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab) return setStatus("No active tab.", "err");
  setStatus("Click any element on the page… (Esc to cancel)");
  chrome.tabs.sendMessage(tab.id, { type: "START_PICKER" }, () => {
    // Popup closes as soon as the user clicks the page — that's expected.
    // The content script copies to clipboard itself and shows an on-page toast.
    window.close();
  });
});

document.getElementById("fullPageBtn").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab) return setStatus("No active tab.", "err");
  setStatus("Capturing…");
  chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_FULL_PAGE" }, async (response) => {
    if (chrome.runtime.lastError || !response || !response.ok) {
      setStatus("Couldn't reach the page. Try reloading it.", "err");
      return;
    }
    try {
      const json = JSON.stringify(response.data);
      await navigator.clipboard.writeText(json);
      setStatus(`Copied! (${(json.length / 1024).toFixed(1)} KB)`, "ok");
    } catch (e) {
      setStatus("Captured, but clipboard write failed.", "err");
    }
  });
});
