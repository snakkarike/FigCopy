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

document.getElementById("pickBtn").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab) return setStatus("No active tab.", "err");

  const ok = await ensureContentScript(tab.id);
  if (!ok) return;

  setStatus("Click any element… (Esc to cancel)");
  chrome.tabs.sendMessage(tab.id, { type: "START_PICKER" }, () => {
    if (chrome.runtime.lastError) {
      // popup may already be closed — that's fine
    }
    window.close();
  });
});

document.getElementById("fullPageBtn").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab) return setStatus("No active tab.", "err");

  const ok = await ensureContentScript(tab.id);
  if (!ok) return;

  setStatus("Capturing…", "loading");
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
