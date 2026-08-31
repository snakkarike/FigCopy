// content.js
// Injected into every page. Handles: (1) hover-to-select picker overlay,
// (2) serializing a DOM subtree into a JSON layout tree the Figma plugin understands.

(() => {
  const STYLE_PROPS = [
    "display", "flexDirection", "justifyContent", "alignItems", "gap",
    "position", "color", "backgroundColor", "opacity",
    "fontSize", "fontWeight", "fontFamily", "lineHeight", "letterSpacing", "textAlign",
    "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius",
    "borderWidth", "borderColor", "borderStyle",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "boxShadow"
  ];

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "LINK", "META", "TEMPLATE"]);
  const MAX_NODES = 1500;
  let nodeCount = 0;

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }

  function collectStyles(computed) {
    const out = {};
    for (const prop of STYLE_PROPS) {
      out[prop] = computed[prop];
    }
    return out;
  }

  // Best-effort inline image -> data URL. Skips on CORS failure (leaves src instead).
  function imageToDataURL(imgEl) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = imgEl.naturalWidth || imgEl.width || 1;
      canvas.height = imgEl.naturalHeight || imgEl.height || 1;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    } catch (e) {
      return null; // tainted canvas (cross-origin) — fall back to src URL
    }
  }

  function serialize(el, originRect, depth) {
    if (nodeCount > MAX_NODES) return null;
    if (el.nodeType !== 1) return null;
    if (SKIP_TAGS.has(el.tagName)) return null;

    const computed = window.getComputedStyle(el);
    if (computed.display === "none" || computed.visibility === "hidden") return null;

    const rect = rectOf(el);
    if (rect.width === 0 && rect.height === 0) return null;

    nodeCount++;

    const node = {
      tag: el.tagName.toLowerCase(),
      rect: {
        x: Math.round(rect.x - originRect.x),
        y: Math.round(rect.y - originRect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      styles: collectStyles(computed),
      children: []
    };

    if (el.tagName === "IMG") {
      node.image = imageToDataURL(el) || el.src || null;
      return node;
    }

    // Leaf text node: element with no element children but has text
    const elementChildren = Array.from(el.children);
    if (elementChildren.length === 0) {
      const text = el.textContent && el.textContent.trim();
      if (text) node.text = text;
      return node;
    }

    for (const child of elementChildren) {
      const childNode = serialize(child, originRect, depth + 1);
      if (childNode) node.children.push(childNode);
    }

    // Collapse: if this wrapper has no direct text and exactly one purpose (pass-through),
    // still keep it — simpler mapping on the Figma side. No collapsing for v1.

    return node;
  }

  function captureElement(el) {
    nodeCount = 0;
    const originRect = el.getBoundingClientRect();
    const tree = serialize(el, originRect, 0);
    return {
      version: 1,
      capturedAt: new Date().toISOString(),
      sourceUrl: location.href,
      root: tree
    };
  }

  // ---------- Picker overlay ----------
  let hoverBox = null;
  let picking = false;
  let onPicked = null;

  function ensureHoverBox() {
    if (hoverBox) return hoverBox;
    hoverBox = document.createElement("div");
    hoverBox.style.cssText = `
      position: fixed; pointer-events: none; z-index: 2147483647;
      border: 2px solid #6E5CFF; background: rgba(110,92,255,0.12);
      transition: all 60ms ease-out;
    `;
    document.documentElement.appendChild(hoverBox);
    return hoverBox;
  }

  function onMouseMove(e) {
    if (!picking) return;
    const box = ensureHoverBox();
    const r = e.target.getBoundingClientRect();
    box.style.left = r.left + "px";
    box.style.top = r.top + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
  }

  function showToast(text) {
    const toast = document.createElement("div");
    toast.textContent = text;
    toast.style.cssText = `
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: #1E1B2E; color: #fff; padding: 10px 16px; border-radius: 8px;
      font: 13px -apple-system, sans-serif; z-index: 2147483647; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    `;
    document.documentElement.appendChild(toast);
    setTimeout(() => toast.remove(), 2200);
  }

  function onClick(e) {
    if (!picking) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.target;
    stopPicking();
    const data = captureElement(target);
    const json = JSON.stringify(data);
    // Write to clipboard here, inside the same user-gesture (click), since the
    // extension popup will already have closed by this point.
    navigator.clipboard.writeText(json).then(
      () => showToast(`Copied "${target.tagName.toLowerCase()}" layout — paste into the Figma plugin`),
      () => showToast("Couldn't copy automatically — check console for the JSON")
    );
    if (onPicked) onPicked(data);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") stopPicking();
  }

  function startPicking(callback) {
    picking = true;
    onPicked = callback;
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.body.style.cursor = "crosshair";
  }

  function stopPicking() {
    picking = false;
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.body.style.cursor = "";
    if (hoverBox) {
      hoverBox.remove();
      hoverBox = null;
    }
  }

  // ---------- Message bridge to popup ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "CAPTURE_FULL_PAGE") {
      const data = captureElement(document.body);
      sendResponse({ ok: true, data });
      return true;
    }
    if (msg.type === "START_PICKER") {
      startPicking(() => {
        // Clipboard write already happened inside onClick, above.
      });
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "CANCEL_PICKER") {
      stopPicking();
      sendResponse({ ok: true });
      return true;
    }
  });
})();
