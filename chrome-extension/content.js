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

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "LINK", "META", "TEMPLATE", "OPTION", "OPTGROUP", "DATALIST", "BR"]);
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
      return canvas.toDataURL("image/webp", 0.8);
    } catch (e) {
      return null; // tainted canvas (cross-origin) — fall back to src URL
    }
  }

  // Inlines computed fill/stroke onto an SVG clone so Figma sees explicit colours.
  function inlineSvgStyles(originalNode, cloneNode) {
    if (originalNode.nodeType === 1) {
      const comp = window.getComputedStyle(originalNode);
      if (comp.fill && comp.fill !== "none") cloneNode.setAttribute("fill", comp.fill);
      if (comp.stroke && comp.stroke !== "none") cloneNode.setAttribute("stroke", comp.stroke);
      if (comp.strokeWidth && comp.strokeWidth !== "0px") cloneNode.setAttribute("stroke-width", comp.strokeWidth);
      if (comp.color) cloneNode.setAttribute("color", comp.color);
    }
    for (let i = 0; i < originalNode.childNodes.length; i++) {
      if (cloneNode.childNodes[i]) inlineSvgStyles(originalNode.childNodes[i], cloneNode.childNodes[i]);
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
    } else if (content.startsWith("url(")) {
       node.tag = "img";
       const match = content.match(/url\(([^)]+)\)/);
       if (match) {
         node.image = match[1].replace(/["']/g, "");
       } else {
         return null;
       }
    }
    
    return node;
  }

  let didShowTruncateToast = false;

  function serialize(el, originRect, depth) {
    if (nodeCount > MAX_NODES) {
      if (!didShowTruncateToast) {
        showToast("Capture truncated — page has 1500+ nodes", "err");
        didShowTruncateToast = true;
      }
      return null;
    }
    if (el.nodeType !== 1) return null;
    if (SKIP_TAGS.has(el.tagName)) return null;
    if (el.hasAttribute("data-figcopy-ignore")) return null;

    const computed = window.getComputedStyle(el);
    if (computed.display === "none" || computed.visibility === "hidden") return null;

    const rect = rectOf(el);
    if (rect.width === 0 && rect.height === 0 && el.childNodes.length === 0) return null;

    // Skip invisible interaction overlays: absolutely/fixed positioned, no children,
    // and no visual styling — these are pure click-capture divs used by JS frameworks.
    if ((computed.position === "absolute" || computed.position === "fixed") && el.childNodes.length === 0) {
      const bg = computed.backgroundColor;
      const hasBg = bg && bg !== "rgba(0, 0, 0, 0)";
      const hasBorder = parseFloat(computed.borderTopWidth) > 0 || parseFloat(computed.borderLeftWidth) > 0;
      const hasShadow = computed.boxShadow && computed.boxShadow !== "none";
      if (!hasBg && !hasBorder && !hasShadow) return null;
    }

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
    
    if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) {
      const appearance = computed.appearance || computed.getPropertyValue("-webkit-appearance");
      if (appearance !== "none") {
        node.styles.borderStyle = "solid";
        node.styles.borderTopWidth = "1px";
        node.styles.borderRightWidth = "1px";
        node.styles.borderBottomWidth = "1px";
        node.styles.borderLeftWidth = "1px";
        if (el.type === "checkbox") {
          node.styles.borderTopLeftRadius = "3px";
          node.styles.borderTopRightRadius = "3px";
          node.styles.borderBottomLeftRadius = "3px";
          node.styles.borderBottomRightRadius = "3px";
          if (el.checked) {
            node.styles.backgroundColor = el.disabled ? "rgb(175, 175, 175)" : "rgb(10, 88, 202)";
            node.styles.borderColor = el.disabled ? "rgb(175, 175, 175)" : "rgb(10, 88, 202)";
            node.styles.backgroundImage = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' d='M4 8.5l2.5 2.5 5.5-5.5'/%3E%3C/svg%3E")`;
          } else {
            node.styles.backgroundColor = el.disabled ? "rgb(235, 235, 235)" : "rgb(255, 255, 255)";
            node.styles.borderColor = el.disabled ? "rgb(200, 200, 200)" : "rgb(118, 118, 118)";
          }
        } else {
          node.styles.borderTopLeftRadius = "50%";
          node.styles.borderTopRightRadius = "50%";
          node.styles.borderBottomLeftRadius = "50%";
          node.styles.borderBottomRightRadius = "50%";
          if (el.checked) {
            node.styles.backgroundColor = "rgb(255, 255, 255)";
            node.styles.borderColor = el.disabled ? "rgb(175, 175, 175)" : "rgb(10, 88, 202)";
            const dotColor = el.disabled ? "%23afafaf" : "%230a58ca";
            node.styles.backgroundImage = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='4' fill='${dotColor}'/%3E%3C/svg%3E")`;
          } else {
            node.styles.backgroundColor = el.disabled ? "rgb(235, 235, 235)" : "rgb(255, 255, 255)";
            node.styles.borderColor = el.disabled ? "rgb(200, 200, 200)" : "rgb(118, 118, 118)";
          }
        }
      }
    }

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
        canvas.width = el.videoWidth || el.width || rect.width || 1;
        canvas.height = el.videoHeight || el.height || rect.height || 1;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
        node.image = canvas.toDataURL("image/webp", 0.8);
      } catch (e) {
        node.image = el.poster || null; // fallback for cross-origin videos
      }
      return node;
    }

    if (el.tagName === "SVG" || el.tagName === "svg") {
      const clone = el.cloneNode(true);
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
            styles: {
              color: computed.color,
              fontSize: computed.fontSize,
              fontWeight: computed.fontWeight,
              fontFamily: computed.fontFamily,
              lineHeight: computed.lineHeight,
              letterSpacing: computed.letterSpacing,
              textAlign: computed.textAlign,
              textTransform: computed.textTransform,
              textDecoration: computed.textDecoration
            }
          });
        }
      }
    }

    const pseudoAfter = capturePseudo(el, originRect, "::after");
    if (pseudoAfter) node.children.push(pseudoAfter);

    const isTextInput = el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && (!el.type || ["text", "email", "search", "number", "tel", "url", "date", "color", "range", "time", "datetime-local", "month", "week"].includes(el.type.toLowerCase())));
    if (isTextInput || el.tagName === "SELECT") {
      let textVal = "";
      let isPlaceholder = false;
      if (el.tagName === "SELECT") {
        if (!skipFormValuesGlobal && el.options && el.options.length > 0 && el.selectedIndex >= 0) {
          textVal = el.options[el.selectedIndex].text;
        }
      } else {
        textVal = skipFormValuesGlobal ? "" : el.value;
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
        
        const textStyles = {
          color: computed.color,
          fontSize: computed.fontSize,
          fontWeight: computed.fontWeight,
          fontFamily: computed.fontFamily,
          lineHeight: computed.lineHeight,
          letterSpacing: computed.letterSpacing,
          textAlign: computed.textAlign,
          textTransform: computed.textTransform,
          textDecoration: computed.textDecoration,
          opacity: isPlaceholder ? "0.5" : computed.opacity
        };
        
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

  function collapseTree(node) {
    if (!node || !node.children || node.children.length === 0) return node;

    // Bottom-up traversal
    for (let i = 0; i < node.children.length; i++) {
      node.children[i] = collapseTree(node.children[i]);
    }

    if (
      node.children.length === 1 &&
      node.children[0].tag && 
      node.children[0].tag !== "mask_svg_icon"
    ) {
      const child = node.children[0];
      const styles = node.styles || {};
      
      const bg = styles.backgroundColor;
      const hasBg = bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
      const hasBgImg = styles.backgroundImage && styles.backgroundImage !== "none";
      const hasShadow = styles.boxShadow && styles.boxShadow !== "none";
      
      const t = parseFloat(styles.borderTopWidth) || 0;
      const r = parseFloat(styles.borderRightWidth) || 0;
      const b = parseFloat(styles.borderBottomWidth) || 0;
      const l = parseFloat(styles.borderLeftWidth) || 0;
      const hasBorder = (t > 0 || r > 0 || b > 0 || l > 0) && styles.borderStyle !== "none";
      
      const opacity = parseFloat(styles.opacity);
      const hasOpacity = !isNaN(opacity) && opacity < 1;
      
      const overflow = styles.overflow || "";
      const isClipped = overflow === "hidden" || overflow === "clip";
      
      const sameWidth = Math.abs(node.rect.width - child.rect.width) < 1;
      const sameHeight = Math.abs(node.rect.height - child.rect.height) < 1;
      
      // Don't collapse if the parent has meaningful padding (it contributes to layout)
      const pt = parseFloat(styles.paddingTop) || 0;
      const pb = parseFloat(styles.paddingBottom) || 0;
      const pl = parseFloat(styles.paddingLeft) || 0;
      const pr = parseFloat(styles.paddingRight) || 0;
      const hasPadding = pt > 0 || pb > 0 || pl > 0 || pr > 0;
      
      if (!hasBg && !hasBgImg && !hasShadow && !hasBorder && !hasOpacity && !isClipped && !hasPadding && sameWidth && sameHeight) {
        if (!child.styles) child.styles = {};
        
        if (styles.position === "absolute" || styles.position === "fixed") {
          child.styles.position = styles.position;
        }
        
        const mt = parseFloat(styles.marginTop) || 0;
        const mb = parseFloat(styles.marginBottom) || 0;
        const ml = parseFloat(styles.marginLeft) || 0;
        const mr = parseFloat(styles.marginRight) || 0;
        
        if (mt || mb || ml || mr) {
          child.styles.marginTop = ((parseFloat(child.styles.marginTop) || 0) + mt) + "px";
          child.styles.marginBottom = ((parseFloat(child.styles.marginBottom) || 0) + mb) + "px";
          child.styles.marginLeft = ((parseFloat(child.styles.marginLeft) || 0) + ml) + "px";
          child.styles.marginRight = ((parseFloat(child.styles.marginRight) || 0) + mr) + "px";
        }
        
        const flexGrow = parseFloat(styles.flexGrow) || 0;
        if (flexGrow > 0) {
          child.styles.flexGrow = Math.max(parseFloat(child.styles.flexGrow) || 0, flexGrow).toString();
        }

        if (node.tag !== "div" && node.tag !== "span") {
          child.tag = node.tag;
        }
        return child;
      }
    }
    return node;
  }

  function captureElement(el) {
    nodeCount = 0;
    didShowTruncateToast = false;
    const originRect = el.getBoundingClientRect();
    let tree = serialize(el, originRect, 0);
    
    if (reduceLayersGlobal) {
      tree = collapseTree(tree);
    }
    
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
  let skipFormValuesGlobal = false;
  let reduceLayersGlobal = false;
  let viewportWidthGlobal = "";
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
    if (downloadInsteadGlobal) {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      let host = "page";
      try { host = new URL(location.href).hostname.replace(/[^a-z0-9]/gi, '-'); } catch(e) {}
      const d = new Date();
      const time = `${d.getHours().toString().padStart(2, '0')}${d.getMinutes().toString().padStart(2, '0')}${d.getSeconds().toString().padStart(2, '0')}`;
      const tag = target.tagName.toLowerCase();
      const vpSuffix = viewportWidthGlobal ? `-${viewportWidthGlobal}px` : "";
      a.download = `figcopy-${host}-${tag}${vpSuffix}-${time}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setTimeout(() => {
        showToast(`Downloaded "${target.tagName.toLowerCase()}" layout as JSON`);
      }, 50);
    } else {
      const doFallback = () => {
        const textarea = document.createElement("textarea");
        textarea.value = json;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const success = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (success) {
          showToast(`Copied "${target.tagName.toLowerCase()}" layout to clipboard!`);
        } else {
          showToast("Clipboard write failed. Check console.", "err");
        }
      };

      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(json).then(() => {
          showToast(`Copied "${target.tagName.toLowerCase()}" layout to clipboard!`);
        }).catch(() => {
          doFallback();
        });
      } else {
        doFallback();
      }
    }
    
    didEmulateGlobal = false;
    downloadInsteadGlobal = false;
    reduceLayersGlobal = false;
    viewportWidthGlobal = "";
    document.body.style.cursor = "";
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
      skipFormValuesGlobal = msg.skipFormValues || false;
      reduceLayersGlobal = msg.reduceLayers || false;
      viewportWidthGlobal = msg.viewportWidth || "";
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
      skipFormValuesGlobal = msg.skipFormValues || false;
      reduceLayersGlobal = msg.reduceLayers || false;
      viewportWidthGlobal = msg.viewportWidth || "";
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
