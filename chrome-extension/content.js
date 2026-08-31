// content.js
// Injected into every page. Handles: (1) hover-to-select picker overlay,
// (2) serializing a DOM subtree into a JSON layout tree the Figma plugin understands.

(() => {
  const STYLE_PROPS = [
    "display", "flexDirection", "flexWrap", "justifyContent", "alignItems", "gap", "flexGrow",
    "position", "color", "backgroundColor", "backgroundImage", "backgroundSize", "opacity",
    "fontSize", "fontWeight", "fontFamily", "lineHeight", "letterSpacing", "textAlign",
    "textTransform", "textDecoration", "content",
    "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "borderColor", "borderStyle",
    "overflow", "overflowX", "overflowY",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "marginTop", "marginRight", "marginBottom", "marginLeft",
    "boxShadow", "mask", "webkitMask", "maskImage", "webkitMaskImage"
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

  // Synthesize a virtual node for pseudo-elements (::before / ::after)
  function capturePseudo(el, originRect, pseudoType) {
    const computed = window.getComputedStyle(el, pseudoType);
    const content = computed.content;
    if (!content || content === "none" || content === "normal") return null;
    if (computed.display === "none" || computed.visibility === "hidden") return null;

    let w = parseFloat(computed.width) || 0;
    let h = parseFloat(computed.height) || 0;
    
    // Ignore empty content with no physical dimensions
    if ((content === '""' || content === "''") && w === 0 && h === 0) return null;

    const elRect = rectOf(el);
    let x = elRect.x;
    let y = elRect.y;
    
    if (computed.position === 'absolute') {
      x += (parseFloat(computed.left) || 0);
      y += (parseFloat(computed.top) || 0);
    }
    
    const node = {
      tag: "div", // treat it as a generic box
      isPseudo: true,
      pseudoType: pseudoType,
      rect: {
        x: Math.round(x - originRect.x),
        y: Math.round(y - originRect.y),
        width: Math.round(w),
        height: Math.round(h)
      },
      styles: collectStyles(computed),
      children: []
    };
    
    if (content !== '""' && content !== "''" && !content.startsWith("url(")) {
       const text = content.replace(/^["'](.*)["']$/, '$1');
       if (text) {
          node.children.push({
            tag: "text_leaf",
            text: text,
            rect: node.rect,
            styles: node.styles
          });
       }
    }
    
    if (content.startsWith("url(")) {
       node.tag = "img";
       node.image = content.match(/url\(([^)]+)\)/)[1].replace(/["']/g, "");
    }
    
    return node;
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

    if (el.tagName === "CANVAS" || el.tagName === "VIDEO") {
      if (el.tagName === "VIDEO") {
        node.videoSrc = el.currentSrc || el.src || null;
      }
      try {
        const canvas = document.createElement("canvas");
        canvas.width = el.videoWidth || el.width || el.getBoundingClientRect().width || 1;
        canvas.height = el.videoHeight || el.height || el.getBoundingClientRect().height || 1;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
        node.image = canvas.toDataURL("image/png");
      } catch (e) {
        node.image = el.poster || null; // fallback for cross-origin videos
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
          if (cloneNode.childNodes[i]) {
            inlineSvgStyles(originalNode.childNodes[i], cloneNode.childNodes[i]);
          }
        }
      }
      inlineSvgStyles(el, clone);
      node.svg = clone.outerHTML;
      return node;
    }

    // ---- Mask-icon leaf (background-color shaped by -webkit-mask SVG) ----
    // e.g. Framer icon divs that use `background-color + -webkit-mask: url(data:image/svg+xml,...)`
    const maskCss = computed.getPropertyValue("-webkit-mask") ||
                    computed.getPropertyValue("mask") ||
                    computed.getPropertyValue("mask-image") ||
                    computed.getPropertyValue("-webkit-mask-image") || "";
    const hasMaskSvg = maskCss.includes("data:image/svg+xml");
    const hasNoMeaningfulChildren = el.children.length === 0 ||
      [...el.children].every(c => {
        const cs = window.getComputedStyle(c);
        return cs.display === "none" || cs.visibility === "hidden";
      });

    if (hasMaskSvg && hasNoMeaningfulChildren) {
      // Extract the raw SVG string from the data URL embedded in the mask
      const dataPrefix = "data:image/svg+xml";
      const start = maskCss.indexOf(dataPrefix);
      let svgStr = null;
      if (start !== -1) {
        // Find the closing </svg> tag
        const svgEnd = maskCss.indexOf("</svg>", start);
        if (svgEnd !== -1) {
          const rawUrl = maskCss.substring(start, svgEnd + 6);
          // URL-decode (these are usually url-encoded, not base64)
          try { svgStr = decodeURIComponent(rawUrl.replace(/^data:image\/svg\+xml,/, "")); } catch(e) { svgStr = rawUrl.replace(/^data:image\/svg\+xml,/, ""); }
        }
      }

      if (svgStr) {
        // Resolve the background-color (the fill color for the icon)
        const resolvedBg = computed.getPropertyValue("background-color");
        node.tag = "mask_svg_icon";
        node.maskSvg = svgStr;
        node.iconColor = resolvedBg && resolvedBg !== "rgba(0, 0, 0, 0)" ? resolvedBg : "rgb(0,0,0)";
        return node;
      }
    }

    const pseudoBefore = capturePseudo(el, originRect, "::before");
    if (pseudoBefore) node.children.push(pseudoBefore);

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

    const pseudoAfter = capturePseudo(el, originRect, "::after");
    if (pseudoAfter) node.children.push(pseudoAfter);

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
  let didEmulateGlobal = false;
  let downloadInsteadGlobal = false;
  let onPicked = null;

  function ensureHoverBox() {
    if (hoverBox) return hoverBox;
    hoverBox = document.createElement("div");
    hoverBox.setAttribute("data-figcopy-ignore", "true");
    hoverBox.style.cssText = `
      position: fixed; pointer-events: none; z-index: 2147483647;
      outline: 2px solid #fff;
      outline-offset: -2px;
      box-shadow: inset 0 0 0 4px #000, 0 0 0 2px #000;
      background: rgba(255,255,255,0.05);
      transition: left 40ms, top 40ms, width 40ms, height 40ms;
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

  function showToast(text, kind, duration = 2500) {
    // Remove any existing toast first
    document.querySelectorAll('[data-figcopy-toast]').forEach(t => t.remove());
    
    const toast = document.createElement("div");
    toast.setAttribute("data-figcopy-ignore", "true");
    toast.setAttribute("data-figcopy-toast", "true");
    
    const dot = document.createElement("span");
    const label = document.createElement("span");
    label.textContent = text;

    const dotColor = kind === "err" ? "#f66" : "#fff";
    dot.style.cssText = `
      display: inline-block; width: 6px; height: 6px;
      background: ${dotColor}; flex-shrink: 0; margin-top: 1px;
    `;

    toast.style.cssText = `
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      background: #000; color: #fff;
      padding: 10px 14px;
      font: 600 11px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0.02em;
      z-index: 2147483647;
      display: flex; align-items: flex-start; gap: 8px;
      white-space: nowrap;
      border: 1px solid #000;
      box-shadow: 3px 3px 0 rgba(0,0,0,0.15);
    `;
    toast.appendChild(dot);
    toast.appendChild(label);
    document.documentElement.appendChild(toast);
    if (duration > 0) {
      setTimeout(() => toast.remove(), duration);
    }
  }

  function onClick(e) {
    if (!picking) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.target;
    stopPicking();
    const data = captureElement(target);
    const json = JSON.stringify(data);
    // Write to clipboard or download JSON file, inside the same user-gesture (click), 
    // since the extension popup will already have closed by this point.
    if (downloadInsteadGlobal) {
      try {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "figcopy-layout.json";
        a.click();
        URL.revokeObjectURL(url);
        showToast(`Downloaded "${target.tagName.toLowerCase()}" layout as JSON`);
      } catch (e) {
        showToast("Couldn't download automatically — check console for the JSON", "err");
      }
    } else {
      navigator.clipboard.writeText(json).then(
        () => showToast(`Copied "${target.tagName.toLowerCase()}" layout — paste into the Figma plugin`),
        () => showToast("Couldn't copy automatically — check console for the JSON", "err")
      );
    }
    if (onPicked) onPicked(data);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") stopPicking();
  }

  function onMouseDown(e) {
    if (!picking) return;
    if (e.button !== 0) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      stopPicking();
      
      // If it was a right click, block the impending contextmenu event
      if (e.button === 2) {
        window.addEventListener("contextmenu", function blockMenu(ce) {
          ce.preventDefault();
          ce.stopPropagation();
          ce.stopImmediatePropagation();
          window.removeEventListener("contextmenu", blockMenu, true);
        }, true);
      }
    }
  }

  function onContextMenu(e) {
    if (!picking) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    stopPicking();
  }

  function startPicking(callback) {
    picking = true;
    onPicked = callback;
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    document.body.style.cursor = "crosshair";
    showToast("Pick an element (Press Esc or Right Click to cancel)", "info", 0);
  }

  function stopPicking() {
    picking = false;
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("mousedown", onMouseDown, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("contextmenu", onContextMenu, true);
    document.body.style.cursor = "";
    document.querySelectorAll('[data-figcopy-toast]').forEach(t => {
      // Don't remove it if we just showed the "Copied!" message, 
      // which happens immediately *after* stopPicking is called in onClick.
      // But if it's the "Pick an element" message, remove it.
      if (t.textContent.includes("Pick an element")) t.remove();
    });
    if (hoverBox) {
      hoverBox.remove();
      hoverBox = null;
    }
    if (didEmulateGlobal) {
      chrome.runtime.sendMessage({ type: "STOP_EMULATION" });
      didEmulateGlobal = false;
    }
  }

  // ---------- Message bridge to popup ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "CAPTURE_FULL_PAGE") {
      (async () => {
        showToast("Scrolling to trigger animations…");
        
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
      didEmulateGlobal = msg.didEmulate || false;
      downloadInsteadGlobal = msg.downloadInstead || false;
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
    if (msg.type === "PING") {
      sendResponse({ ok: true });
      return true;
    }
  });
})();
