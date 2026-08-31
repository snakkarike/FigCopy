// content.js
// Injected into every page. Handles: (1) hover-to-select picker overlay,
// (2) serializing a DOM subtree into a JSON layout tree the Figma plugin understands.

(() => {
  const STYLE_PROPS = [
    "display", "flexDirection", "flexWrap", "justifyContent", "alignItems", "gap", "flexGrow",
    "position", "color", "backgroundColor", "backgroundImage", "backgroundSize", "opacity",
    "fontSize", "fontWeight", "fontFamily", "lineHeight", "letterSpacing", "textAlign",
    "textTransform", "textDecoration",
    "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "borderColor", "borderStyle",
    "overflow", "overflowX", "overflowY",
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
    if (el.hasAttribute("data-figcopy-ignore")) return null;

    const computed = window.getComputedStyle(el);
    if (computed.display === "none" || computed.visibility === "hidden") return null;

    const rect = rectOf(el);
    if (rect.width === 0 && rect.height === 0 && el.childNodes.length === 0) return null;

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

    if (el.tagName === "CANVAS") {
      try {
        node.image = el.toDataURL("image/png");
      } catch (e) {
        node.image = null; // Silently fallback if canvas is tainted
      }
      return node;
    }

    if (el.tagName === "SVG" || el.tagName === "svg") {
      const clone = el.cloneNode(true);
      function inlineSvgStyles(originalNode, cloneNode) {
        if (originalNode.nodeType === 1) { // ELEMENT
          const comp = window.getComputedStyle(originalNode);
          if (comp.fill && comp.fill !== "none") cloneNode.setAttribute("fill", comp.fill);
          if (comp.stroke && comp.stroke !== "none") cloneNode.setAttribute("stroke", comp.stroke);
          if (comp.strokeWidth && comp.strokeWidth !== "0px") cloneNode.setAttribute("stroke-width", comp.strokeWidth);
          if (comp.color) cloneNode.setAttribute("color", comp.color);
        }
        for (let i = 0; i < originalNode.childNodes.length; i++) {
          inlineSvgStyles(originalNode.childNodes[i], cloneNode.childNodes[i]);
        }
      }
      inlineSvgStyles(el, clone);
      node.svg = clone.outerHTML;
      return node;
    }

    for (const child of el.childNodes) {
      if (child.nodeType === 1) { // ELEMENT_NODE
        const childNode = serialize(child, originRect, depth + 1);
        if (childNode) node.children.push(childNode);
      } else if (child.nodeType === 3) { // TEXT_NODE
        const text = child.textContent && child.textContent.trim();
        if (text) {
          const range = document.createRange();
          range.selectNode(child);
          const textRect = range.getBoundingClientRect();
          node.children.push({
            tag: "text_leaf",
            text: text,
            rect: {
              x: Math.round(textRect.x - originRect.x),
              y: Math.round(textRect.y - originRect.y),
              width: Math.round(textRect.width),
              height: Math.round(textRect.height)
            },
            styles: collectStyles(computed)
          });
        }
      }
    }

    const isTextInput = el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && (!el.type || ["text", "password", "email", "search", "number", "tel", "url"].includes(el.type.toLowerCase())));
    if (isTextInput || el.tagName === "SELECT") {
      let textVal = "";
      let isPlaceholder = false;
      if (el.tagName === "SELECT") {
        if (el.options && el.options.length > 0 && el.selectedIndex >= 0) {
          textVal = el.options[el.selectedIndex].text;
        }
      } else {
        textVal = el.value;
        if (!textVal && el.placeholder) {
          textVal = el.placeholder;
          isPlaceholder = true;
        }
      }

      if (textVal) {
        const pt = parseFloat(computed.paddingTop) || 0;
        const pl = parseFloat(computed.paddingLeft) || 0;
        const pr = parseFloat(computed.paddingRight) || 0;
        const pb = parseFloat(computed.paddingBottom) || 0;
        
        const textStyles = collectStyles(computed);
        textStyles.display = "inline";
        if (isPlaceholder) {
          textStyles.opacity = "0.5";
        }
        
        node.children.push({
          tag: "text_leaf",
          text: textVal,
          rect: {
            x: Math.round(rect.x - originRect.x + pl),
            y: Math.round(rect.y - originRect.y + pt),
            width: Math.round(Math.max(rect.width - pl - pr, 1)),
            height: Math.round(Math.max(rect.height - pt - pb, 1))
          },
          styles: textStyles
        });
      }

      if (el.tagName === "SELECT") {
        const arrowSize = 10;
        const pr = parseFloat(computed.paddingRight) || 20;
        const color = computed.color || "#000000";
        node.children.push({
          tag: "svg",
          svg: `<svg viewBox="0 0 10 10" width="${arrowSize}" height="${arrowSize}"><path fill="${color}" d="M0 3h10L5 8z"/></svg>`,
          rect: {
            x: Math.round(rect.x - originRect.x + rect.width - pr + (pr - arrowSize) / 2),
            y: Math.round(rect.y - originRect.y + (rect.height - arrowSize) / 2),
            width: arrowSize,
            height: arrowSize
          },
          styles: collectStyles(computed)
        });
      }
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
    hoverBox.setAttribute("data-figcopy-ignore", "true");
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
    toast.setAttribute("data-figcopy-ignore", "true");
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
      (async () => {
        showToast("Scrolling page to trigger animations...");
        
        // Auto-scroll to trigger IntersectionObservers
        const scrollHeight = document.body.scrollHeight;
        const viewportHeight = window.innerHeight;
        
        // Disable smooth scrolling temporarily to prevent mid-scroll captures
        const origHtmlBehavior = document.documentElement.style.scrollBehavior;
        const origBodyBehavior = document.body.style.scrollBehavior;
        document.documentElement.style.scrollBehavior = 'auto';
        document.body.style.scrollBehavior = 'auto';
        
        for (let y = 0; y < scrollHeight; y += viewportHeight / 2) {
          window.scrollTo({ top: y, behavior: 'instant' });
          await new Promise(r => setTimeout(r, 100)); // wait for GSAP triggers
        }
        
        // Wait for final animations to finish
        await new Promise(r => setTimeout(r, 1000));
        
        // Snap back to the top
        window.scrollTo({ top: 0, behavior: 'instant' });
        
        // Force and wait until we are strictly at the top
        let attempts = 0;
        while (window.scrollY > 0 && attempts < 20) {
          window.scrollTo({ top: 0, behavior: 'instant' });
          await new Promise(r => setTimeout(r, 50));
          attempts++;
        }
        
        // Restore smooth scrolling
        document.documentElement.style.scrollBehavior = origHtmlBehavior;
        document.body.style.scrollBehavior = origBodyBehavior;

        const data = captureElement(document.documentElement);
        
        sendResponse({ ok: true, data });
      })();
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
