async function getAttachedTabs() {
  const data = await chrome.storage.session.get("attachedTabs");
  return data.attachedTabs || [];
}

async function addAttachedTab(tabId) {
  const tabs = await getAttachedTabs();
  if (!tabs.includes(tabId)) {
    tabs.push(tabId);
    await chrome.storage.session.set({ attachedTabs: tabs });
  }
}

async function removeAttachedTab(tabId) {
  const tabs = await getAttachedTabs();
  const newTabs = tabs.filter(id => id !== tabId);
  await chrome.storage.session.set({ attachedTabs: newTabs });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START_EMULATION") {
    const tabId = msg.tabId;
    const width = msg.width;
    
    chrome.debugger.attach({ tabId }, "1.3", () => {
      if (chrome.runtime.lastError) {
        console.error("Debugger attach failed: " + chrome.runtime.lastError.message);
        sendResponse({ success: false });
        return;
      }
      
      addAttachedTab(tabId);
      
      chrome.debugger.sendCommand(
        { tabId },
        "Emulation.setDeviceMetricsOverride",
        {
          width: width,
          height: 0,
          deviceScaleFactor: 0,
          mobile: false
        },
        () => {
          if (chrome.runtime.lastError) {
            console.error("sendCommand failed: " + chrome.runtime.lastError.message);
            sendResponse({ success: false });
          } else {
            sendResponse({ success: true });
          }
        }
      );
    });
    
    return true;
  } 
  
  if (msg.type === "STOP_EMULATION") {
    const tabId = msg.tabId || sender.tab?.id;
    if (tabId) {
      chrome.debugger.detach({ tabId }, () => {
        if (chrome.runtime.lastError) {} 
        removeAttachedTab(tabId);
      });
    }
  }

  if (msg.type === "CHECK_EMULATION") {
    const tabId = msg.tabId || sender.tab?.id;
    getAttachedTabs().then(tabs => {
      sendResponse({ isEmulating: tabs.includes(tabId) });
    });
    return true; 
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) {
    removeAttachedTab(source.tabId);
  }
});