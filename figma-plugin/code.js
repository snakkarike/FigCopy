// code.js — runs in Figma's plugin sandbox (no DOM access, only the figma.* API)

figma.showUI(__html__, { width: 360, height: 420 });

const pendingImageDecodes = new Map();

figma.ui.onmessage = async (msg) => {
  if (msg.type === "image-decoded") {
    if (pendingImageDecodes.has(msg.url)) {
      pendingImageDecodes.get(msg.url).resolve(msg.data);
      pendingImageDecodes.delete(msg.url);
    }
    return;
  }
  if (msg.type === "image-decode-failed") {
    if (pendingImageDecodes.has(msg.url)) {
      pendingImageDecodes.get(msg.url).reject(new Error("Decode failed"));
      pendingImageDecodes.delete(msg.url);
    }
    return;
  }
  if (msg.type === "gradient-rendered") {
    if (pendingImageDecodes.has(msg.key)) {
      pendingImageDecodes.get(msg.key).resolve(msg.data);
      pendingImageDecodes.delete(msg.key);
    }
    return;
  }
  if (msg.type === "gradient-render-failed") {
    if (pendingImageDecodes.has(msg.key)) {
      pendingImageDecodes.get(msg.key).reject(new Error("Gradient render failed"));
      pendingImageDecodes.delete(msg.key);
    }
    return;
  }

  if (msg.type !== "build") return;
  try {
    let count = 0;
    const root = msg.payload.root;
    if (!root) throw new Error("No root node in payload");

    const totalNodes = countNodes(root);
    const bump = () => {
      count++;
      if (count % 5 === 0 || count === totalNodes) {
        figma.ui.postMessage({ type: "progress", current: count, total: totalNodes });
      }
    };

    const rootFrame = await buildNode(root, root.rect, bump);
    figma.currentPage.appendChild(rootFrame);
    rootFrame.x = figma.viewport.center.x - rootFrame.width / 2;
    rootFrame.y = figma.viewport.center.y - rootFrame.height / 2;
    figma.currentPage.selection = [rootFrame];
    figma.viewport.scrollAndZoomIntoView([rootFrame]);

    figma.ui.postMessage({ type: "build-done", count });
  } catch (err) {
    figma.ui.postMessage({ type: "build-error", message: err.message || String(err) });
  }
};

// ---------- helpers ----------

function countNodes(node, depth = 0, state = { count: 0 }) {
  if (depth > 500) throw new Error("Payload too deep (max 500 levels)");
  state.count++;
  if (state.count > 3000) throw new Error("Too many nodes in payload (max 3000)");

  let count = 1;
  if (node.children) {
    for (const child of node.children) count += countNodes(child, depth + 1, state);
  }
  return count;
}

function oklabToRgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  let r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bv = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  r = r > 0.0031308 ? 1.055 * Math.pow(r, 1/2.4) - 0.055 : 12.92 * r;
  g = g > 0.0031308 ? 1.055 * Math.pow(g, 1/2.4) - 0.055 : 12.92 * g;
  bv = bv > 0.0031308 ? 1.055 * Math.pow(bv, 1/2.4) - 0.055 : 12.92 * bv;
  return { r: Math.max(0, Math.min(1, r)), g: Math.max(0, Math.min(1, g)), b: Math.max(0, Math.min(1, bv)) };
}

function hslToRgb(h, s, l) {
  s = Math.min(1, Math.max(0, s));
  l = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, bv = 0;
  if (h < 60)       { r = c; g = x; bv = 0; }
  else if (h < 120) { r = x; g = c; bv = 0; }
  else if (h < 180) { r = 0; g = c; bv = x; }
  else if (h < 240) { r = 0; g = x; bv = c; }
  else if (h < 300) { r = x; g = 0; bv = c; }
  else              { r = c; g = 0; bv = x; }
  return { r: r + m, g: g + m, b: bv + m };
}

function parseColor(str) {
  if (!str) return null;
  
  if (str.startsWith("#")) {
    const hex = str.replace("#", "");
    if (hex.length === 3) return { color: { r: parseInt(hex[0]+hex[0], 16)/255, g: parseInt(hex[1]+hex[1], 16)/255, b: parseInt(hex[2]+hex[2], 16)/255 }, opacity: 1 };
    if (hex.length >= 6) return { color: { r: parseInt(hex.slice(0,2), 16)/255, g: parseInt(hex.slice(2,4), 16)/255, b: parseInt(hex.slice(4,6), 16)/255 }, opacity: 1 };
  }

  if (str.startsWith("rgb")) {
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const parts = m[1].replace(/[\/%]/g, " ").split(/[\s,]+/).filter(Boolean).map(parseFloat);
      if (parts.length >= 3 && !isNaN(parts[0])) {
        return { color: { r: parts[0]/255, g: parts[1]/255, b: parts[2]/255 }, opacity: parts.length > 3 ? parts[3] : 1 };
      }
    }
  }

  if (str.startsWith("color(")) {
    const m = str.match(/color\([^ ]+\s+([^)]+)\)/);
    if (m) {
      const parts = m[1].replace(/[\/%]/g, " ").split(/[\s,]+/).filter(Boolean).map(parseFloat);
      if (parts.length >= 3 && !isNaN(parts[0])) {
        return { color: { r: parts[0], g: parts[1], b: parts[2] }, opacity: parts.length > 3 ? parts[3] : 1 };
      }
    }
  }

  if (str.startsWith("oklch(")) {
    const m = str.match(/oklch\(([^)]+)\)/);
    if (m) {
      const parts = m[1].replace(/[\/%]/g, " ").split(/[\s,]+/).filter(Boolean).map(parseFloat);
      if (parts.length >= 3 && !isNaN(parts[0])) {
        const L = parts[0] > 1 ? parts[0]/100 : parts[0];
        const C = parts[1];
        const hRad = parts[2] * Math.PI / 180;
        const a = C * Math.cos(hRad);
        const b = C * Math.sin(hRad);
        return { color: oklabToRgb(L, a, b), opacity: parts.length > 3 ? parts[3] : 1 };
      }
    }
  }

  if (str.startsWith("oklab(")) {
    const m = str.match(/oklab\(([^)]+)\)/);
    if (m) {
      const parts = m[1].replace(/[\/%]/g, " ").split(/[\s,]+/).filter(Boolean).map(parseFloat);
      if (parts.length >= 3 && !isNaN(parts[0])) {
        const L = parts[0] > 1 ? parts[0]/100 : parts[0];
        const a = parts[1];
        const b = parts[2];
        return { color: oklabToRgb(L, a, b), opacity: parts.length > 3 ? parts[3] : 1 };
      }
    }
  }

  if (str.startsWith("lab(")) {
    const m = str.match(/lab\(([^)]+)\)/);
    if (m) {
      const parts = m[1].replace(/[\/%]/g, " ").split(/[\s,]+/).filter(Boolean).map(parseFloat);
      if (parts.length > 0 && !isNaN(parts[0])) {
        const l = parts[0] > 1 ? parts[0]/100 : parts[0];
        return { color: { r: l, g: l, b: l }, opacity: parts.length > 3 ? parts[3] : 1 };
      }
    }
  }

  if (str.startsWith("hsl")) {
    const m = str.match(/hsla?\(([^)]+)\)/);
    if (m) {
      const parts = m[1].replace(/[\/%]/g, " ").split(/[\s,]+/).filter(Boolean).map(parseFloat);
      if (parts.length >= 3 && !isNaN(parts[0])) {
        const h = parts[0];  // degrees
        const s = parts[1] > 1 ? parts[1] / 100 : parts[1];
        const l = parts[2] > 1 ? parts[2] / 100 : parts[2];
        return { color: hslToRgb(h, s, l), opacity: parts.length > 3 ? parts[3] : 1 };
      }
    }
  }

  return null;
}

function px(str) {
  const n = parseFloat(str);
  return isNaN(n) ? 0 : n;
}

function alignPrimary(val) {
  if (!val) return "MIN";
  if (val.includes("center")) return "CENTER";
  if (val.includes("end")) return "MAX";
  if (val.includes("space-between")) return "SPACE_BETWEEN";
  return "MIN";
}

function alignCounter(val) {
  if (!val) return "MIN";
  if (val.includes("center")) return "CENTER";
  if (val.includes("end")) return "MAX";
  return "MIN";
}

function fontStyleFor(fontWeight) {
  const w = parseInt(fontWeight, 10);
  if (!isNaN(w)) {
    if (w >= 700) return "Bold";
    if (w >= 500) return "Medium";
    return "Regular";
  }
  if (fontWeight === "bold") return "Bold";
  return "Regular";
}

function getPrimaryFont(fontFamilyStr) {
  if (!fontFamilyStr) return "Inter";
  const first = fontFamilyStr.split(",")[0].trim();
  const family = first.replace(/['"]/g, "");
  return family || "Inter";
}

async function loadFontSafe(family, style) {
  try {
    await figma.loadFontAsync({ family, style });
    return { family, style };
  } catch (e) {
    try {
      await figma.loadFontAsync({ family, style: "Regular" });
      return { family, style: "Regular" };
    } catch (e2) {
      try {
        await figma.loadFontAsync({ family: "Inter", style });
        return { family: "Inter", style };
      } catch (e3) {
        await figma.loadFontAsync({ family: "Inter", style: "Regular" });
        return { family: "Inter", style: "Regular" };
      }
    }
  }
}

function getSvgStringFromDataUrl(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith("data:image/svg+xml")) return null;
  const parts = dataUrl.split(",");
  const prefix = parts[0];
  const data = parts.slice(1).join(",");
  if (prefix.includes("base64")) {
    try { return atob(data); } catch(e) { return null; }
  } else {
    try { return decodeURIComponent(data); } catch(e) { return data; }
  }
}

function extractSvgDataUrl(cssStr) {
  if (!cssStr || cssStr === "none") return null;
  
  const qMatch = cssStr.match(/url\((['"])(.*?)\1\)/);
  if (qMatch) return qMatch[2];
  
  const dataPrefix = "data:image/svg+xml";
  const start = cssStr.indexOf(dataPrefix);
  if (start !== -1) {
    const endRaw = cssStr.indexOf("</svg>", start);
    if (endRaw !== -1) return cssStr.substring(start, endRaw + 6);
    
    const endEncoded = cssStr.indexOf("%3C/svg%3E", start);
    if (endEncoded !== -1) return cssStr.substring(start, endEncoded + 10);
  }
  
  const unqMatch = cssStr.match(/url\((.*?)\)/);
  if (unqMatch) return unqMatch[1].trim();
  
  return null;
}

function processSvgString(svgStr) {
  // Use a regex that balances the nested parentheses for rgb(...) inside var(...)
  let resolvedStr = svgStr.replace(/var\([^,]+,\s*(rgb[a]?\([^)]+\)|[^)]+)\)/g, "$1");
  return resolvedStr.replace(/(fill|stroke|color)="([^"]+)"/g, (match, attr, colorStr) => {
    if (colorStr === "none" || colorStr === "transparent") return match;
    const parsed = parseColor(colorStr);
    if (parsed) {
      const r = Math.round(parsed.color.r * 255).toString(16).padStart(2, '0');
      const g = Math.round(parsed.color.g * 255).toString(16).padStart(2, '0');
      const b = Math.round(parsed.color.b * 255).toString(16).padStart(2, '0');
      return `${attr}="#${r}${g}${b}" ${attr}-opacity="${parsed.opacity}"`;
    }
    return match;
  });
}

function dataURLToBytes(dataURL) {
  const base64 = dataURL.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function decodeImageSafe(url) {
  if (url.startsWith("data:image") && !url.startsWith("data:image/webp")) {
    return dataURLToBytes(url);
  }
  const dataUrl = await new Promise((resolve, reject) => {
    pendingImageDecodes.set(url, { resolve, reject });
    figma.ui.postMessage({ type: "decode-image", url: url });
    setTimeout(() => reject(new Error("Timeout")), 10000);
  });
  return dataURLToBytes(dataUrl);
}

function applyBoxShadow(node, shadowStr) {
  if (!shadowStr || shadowStr === "none" || !("effects" in node)) return;
  const effects = [];
  const shadowRegex = /(inset\s+)?(rgba?\([^)]+\)|#[0-9a-fA-F]+|[a-zA-Z]+)\s+([-.\d]+px)\s+([-.\d]+px)\s+([-.\d]+px)\s*([-.\d]+px)?\s*(inset)?/g;
  let match;
  while ((match = shadowRegex.exec(shadowStr)) !== null) {
    const isInset = match[1] || match[7];
    const colorStr = match[2];
    const x = px(match[3]);
    const y = px(match[4]);
    const blur = px(match[5]);
    const spread = match[6] ? px(match[6]) : 0;
    
    const parsedColor = parseColor(colorStr);
    if (!parsedColor) continue;

    effects.push({
      type: isInset ? "INNER_SHADOW" : "DROP_SHADOW",
      color: { r: parsedColor.color.r, g: parsedColor.color.g, b: parsedColor.color.b, a: parsedColor.opacity },
      offset: { x, y },
      radius: blur,
      spread: spread,
      visible: true,
      blendMode: "NORMAL"
    });
  }
  if (effects.length > 0) node.effects = effects;
}

function applyCommonStyle(node, styles) {
  if (!styles) return;

  const bg = parseColor(styles.backgroundColor);
  if (bg && "fills" in node) {
    const existing = Array.isArray(node.fills) ? [...node.fills].filter(f => f.type !== "SOLID") : [];
    node.fills = [...existing, { type: "SOLID", color: bg.color, opacity: bg.opacity }];
  } else if ("fills" in node) {
    const existing = Array.isArray(node.fills) ? [...node.fills].filter(f => f.type !== "SOLID") : [];
    node.fills = existing;
  }

  const borderColor = parseColor(styles.borderColor);
  const t = px(styles.borderTopWidth);
  const r = px(styles.borderRightWidth);
  const b = px(styles.borderBottomWidth);
  const l = px(styles.borderLeftWidth);

  if (borderColor && styles.borderStyle !== "none" && (t > 0 || r > 0 || b > 0 || l > 0) && "strokes" in node) {
    node.strokes = [{ type: "SOLID", color: borderColor.color, opacity: borderColor.opacity }];
    if (t === r && r === b && b === l) {
      node.strokeWeight = t;
    } else {
      node.strokeTopWeight = t;
      node.strokeRightWeight = r;
      node.strokeBottomWeight = b;
      node.strokeLeftWeight = l;
    }
  }

  if ("topLeftRadius" in node) {
    node.topLeftRadius = px(styles.borderTopLeftRadius);
    node.topRightRadius = px(styles.borderTopRightRadius);
    node.bottomLeftRadius = px(styles.borderBottomLeftRadius);
    node.bottomRightRadius = px(styles.borderBottomRightRadius);
  }

  const opacity = parseFloat(styles.opacity);
  // We ignore opacity 0 because it's almost always a scroll animation (e.g. GSAP/AOS) 
  // and users want to see the elements in their design file.
  if (!isNaN(opacity) && opacity > 0 && "opacity" in node) node.opacity = opacity;

  applyBoxShadow(node, styles.boxShadow);
}

// domNode: captured node. originRect: the rect this node's x/y should be measured against
// (its parent's captured rect), so Figma's parent-relative coordinates come out right.
async function buildNode(domNode, originRect, bump, depth = 0) {
  if (depth > 500) throw new Error("Payload too deep (max 500 levels)");
  bump();

  // ---- Image / Canvas / Video leaf ----
  if (domNode.tag === "img" || domNode.tag === "canvas" || domNode.tag === "video") {
    const svgStr = domNode.image ? getSvgStringFromDataUrl(domNode.image) : null;
    if (svgStr) {
      try {
        const node = figma.createNodeFromSvg(processSvgString(svgStr));
        node.name = "img-svg";
        node.x = domNode.rect.x - originRect.x;
        node.y = domNode.rect.y - originRect.y;
        node.resize(Math.max(domNode.rect.width, 1), Math.max(domNode.rect.height, 1));
        applyCommonStyle(node, domNode.styles);
        return node;
      } catch (e) {
        // Fallback to normal rectangle
      }
    }

    const node = figma.createRectangle();
    node.name = domNode.tag;
    node.resize(Math.max(domNode.rect.width, 1), Math.max(domNode.rect.height, 1));
    node.x = domNode.rect.x - originRect.x;
    node.y = domNode.rect.y - originRect.y;
    
    let hasVideo = false;
    if (domNode.videoSrc) {
      try {
        const response = await fetch(domNode.videoSrc);
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const video = await figma.createVideoAsync(bytes);
        node.fills = [{ type: "VIDEO", videoHash: video.hash, scaleMode: "FILL" }];
        hasVideo = true;
      } catch (e) {}
    }

    if (!hasVideo) {
      if (domNode.image && (domNode.image.startsWith("data:image") || domNode.image.startsWith("http"))) {
        try {
          const bytes = await decodeImageSafe(domNode.image);
          const image = figma.createImage(bytes);
          const scaleMode = domNode.tag === "img" ? "FILL" : "FIT";
          node.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode }];
        } catch (uiErr) {
          if (domNode.image.startsWith("http")) {
            try {
              const response = await fetch(domNode.image);
              const buffer = await response.arrayBuffer();
              const bytes = new Uint8Array(buffer);
              const image = figma.createImage(bytes);
              const scaleMode = domNode.tag === "img" ? "FILL" : "FIT";
              node.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode }];
            } catch (fetchErr) {
              node.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.85 } }];
            }
          } else {
            node.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.85 } }];
          }
        }
      } else {
        node.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.85 } }];
      }
    }
    applyCommonStyle(node, domNode.styles);
    return node;
  }

  // ---- Mask-icon leaf (background-color + -webkit-mask SVG) ----
  if (domNode.tag === "mask_svg_icon" && domNode.maskSvg) {
    try {
      const style = domNode.styles || {};
      // Resolve the fill color — iconColor is already computed (no CSS vars)
      const fill = parseColor(domNode.iconColor) || { color: { r: 0, g: 0, b: 0 }, opacity: 1 };
      const fillHex = "#" +
        Math.round(fill.color.r * 255).toString(16).padStart(2, "0") +
        Math.round(fill.color.g * 255).toString(16).padStart(2, "0") +
        Math.round(fill.color.b * 255).toString(16).padStart(2, "0");

      // Inject the resolved color into all path/shape fills in the SVG
      let svgStr = domNode.maskSvg;
      // Replace fill="var(...)" or fill="currentColor" with the actual color
      svgStr = svgStr.replace(/fill="[^"]*"/g, `fill="${fillHex}"`);
      // Also replace any fill:... in style attributes
      svgStr = svgStr.replace(/fill:\s*[^;}"']+/g, `fill:${fillHex}`);
      svgStr = processSvgString(svgStr);

      const node = figma.createNodeFromSvg(svgStr);
      node.name = "icon";
      node.x = domNode.rect.x - originRect.x;
      node.y = domNode.rect.y - originRect.y;
      node.resize(Math.max(domNode.rect.width, 1), Math.max(domNode.rect.height, 1));
      const opacity = parseFloat(style.opacity);
      if (!isNaN(opacity)) node.opacity = opacity;
      return node;
    } catch (e) {
      // fallback: solid colored rectangle
      const node = figma.createRectangle();
      node.name = "icon";
      node.x = domNode.rect.x - originRect.x;
      node.y = domNode.rect.y - originRect.y;
      node.resize(Math.max(domNode.rect.width, 1), Math.max(domNode.rect.height, 1));
      const fill = parseColor(domNode.iconColor) || { color: { r: 0, g: 0, b: 0 }, opacity: 1 };
      node.fills = [{ type: "SOLID", color: fill.color, opacity: fill.opacity }];
      return node;
    }
  }

  // ---- SVG leaf ----
  if (domNode.svg) {
    try {
      let svgStr = domNode.svg;
      // Figma's SVG parser doesn't understand CSS Color Level 4 (lab, oklch, etc)
      // We manually intercept fill/stroke attributes and convert them to #hex + opacity
      svgStr = processSvgString(svgStr);

      const node = figma.createNodeFromSvg(svgStr);
      node.name = "svg";
      node.x = domNode.rect.x - originRect.x;
      node.y = domNode.rect.y - originRect.y;
      node.resize(Math.max(domNode.rect.width, 1), Math.max(domNode.rect.height, 1));
      applyCommonStyle(node, domNode.styles);
      return node;
    } catch (e) {
      // silently fallback to creating a frame if svg fails
      const node = figma.createFrame();
      node.resize(Math.max(domNode.rect.width, 1), Math.max(domNode.rect.height, 1));
      return node;
    }
  }

  // ---- Text leaf ----
  if (domNode.tag === "text_leaf" || domNode.text) {
    const style = domNode.styles || {};
    const fontStyle = fontStyleFor(style.fontWeight);
    const family = getPrimaryFont(style.fontFamily);
    const fontName = await loadFontSafe(family, fontStyle);

    const node = figma.createText();
    node.name = domNode.text.slice(0, 40);
    node.fontName = fontName;
    node.characters = domNode.text;
    const fontSize = px(style.fontSize) || 12;
    node.fontSize = fontSize;

    if (style.textTransform === "uppercase") node.textCase = "UPPER";
    else if (style.textTransform === "lowercase") node.textCase = "LOWER";
    else if (style.textTransform === "capitalize") node.textCase = "TITLE";

    if (style.textDecoration && style.textDecoration.includes("underline")) node.textDecoration = "UNDERLINE";
    else if (style.textDecoration && style.textDecoration.includes("line-through")) node.textDecoration = "STRIKETHROUGH";

    const lh = style.lineHeight;
    if (lh && lh !== "normal" && !isNaN(parseFloat(lh))) {
      node.lineHeight = { value: parseFloat(lh), unit: "PIXELS" };
    }

    node.x = domNode.rect.x - originRect.x;
    node.y = domNode.rect.y - originRect.y;
    
    const isMultiline = domNode.rect.height > fontSize * 1.5;
    if (isMultiline) {
      node.resize(Math.max(domNode.rect.width + 2, 1), Math.max(domNode.rect.height, 1));
      node.textAutoResize = "HEIGHT";
    } else {
      node.textAutoResize = "WIDTH_AND_HEIGHT";
    }
    
    const color = parseColor(style.color) || { color: { r: 0, g: 0, b: 0 }, opacity: 1 };
    node.fills = [{ type: "SOLID", color: color.color, opacity: color.opacity }];

    if (style.textAlign === "center") node.textAlignHorizontal = "CENTER";
    else if (style.textAlign === "right") node.textAlignHorizontal = "RIGHT";
    else if (style.textAlign === "justify") node.textAlignHorizontal = "JUSTIFIED";

    const opacity = parseFloat(style.opacity);
    if (!isNaN(opacity)) node.opacity = opacity;

    return node;
  }

  // ---- Container (frame) ----
  const style = domNode.styles || {};
  const frame = figma.createFrame();
  frame.name = domNode.tag || "div";
  frame.x = domNode.rect.x - originRect.x;
  frame.y = domNode.rect.y - originRect.y;
  frame.resize(Math.max(domNode.rect.width, 1), Math.max(domNode.rect.height, 1));
  
  const isClipped = style.overflow === "hidden" || style.overflowX === "hidden" || style.overflowY === "hidden" || style.overflow === "clip";
  frame.clipsContent = depth === 0 ? false : !!isClipped;

  applyCommonStyle(frame, style);
  
  const children = domNode.children ? [...domNode.children] : [];
  
  let wantsAutoLayout = false;
  if (style.display === "flex" || style.display === "inline-flex") {
    wantsAutoLayout = true;
    frame.layoutMode = style.flexDirection && style.flexDirection.includes("column") ? "VERTICAL" : "HORIZONTAL";
  } else if (style.display === "block" || style.display === "inline-block" || style.display === "list-item" || style.display === "inline" || style.display === "table-cell") {
    wantsAutoLayout = true;
    let hasBlockChild = false;
    if (domNode.children) {
      for (const child of domNode.children) {
        if (child.tag !== "text_leaf" && child.styles && (child.styles.display === "block" || child.styles.display === "flex" || child.styles.display === "grid" || child.styles.display === "list-item" || child.styles.display === "table" || child.styles.display === "table-row")) {
          hasBlockChild = true;
          break;
        }
      }
    }
    if (hasBlockChild) {
      frame.layoutMode = "VERTICAL";
    } else {
      frame.layoutMode = "HORIZONTAL";
      frame.layoutWrap = "WRAP";
    }
  }

  if (wantsAutoLayout) {
    frame.itemReverseZIndex = true;
    frame.itemSpacing = Math.max(px(style.gap) || 0, 0);

    frame.paddingTop = px(style.paddingTop);
    frame.paddingBottom = px(style.paddingBottom);
    frame.paddingLeft = px(style.paddingLeft);
    frame.paddingRight = px(style.paddingRight);

    frame.primaryAxisAlignItems = alignPrimary(style.justifyContent);
    frame.counterAxisAlignItems = alignCounter(style.alignItems);
    
    if (style.display !== "flex" && style.display !== "inline-flex") {
      if (style.textAlign === "center") {
        if (frame.layoutMode === "VERTICAL") frame.counterAxisAlignItems = "CENTER";
        else frame.primaryAxisAlignItems = "CENTER";
      } else if (style.textAlign === "right" || style.textAlign === "end") {
        if (frame.layoutMode === "VERTICAL") frame.counterAxisAlignItems = "MAX";
        else frame.primaryAxisAlignItems = "MAX";
      }
    }
    
    if (style.flexWrap === "wrap") {
      frame.layoutWrap = "WRAP";
    }
    
    frame.primaryAxisSizingMode = "FIXED";
    frame.counterAxisSizingMode = "FIXED";
  } else {
    frame.layoutMode = "NONE";
  }

  for (const child of children) {
    if (child.tag === "option" || child.tag === "optgroup" || child.tag === "datalist") continue;
    const childNode = await buildNode(child, domNode.rect, bump, depth + 1);
    
    const origX = childNode.x;
    const origY = childNode.y;
    
    const childCenterX = child.rect.x + (child.rect.width / 2);
    const parentCenterX = domNode.rect.x + (domNode.rect.width / 2);
    const isCenteredX = Math.abs(childCenterX - parentCenterX) < 50;
    const isFullBleed = origX <= -5 && child.rect.width >= domNode.rect.width;
    const shouldCenter = isCenteredX || isFullBleed;
    
    frame.appendChild(childNode);
    
    if (wantsAutoLayout && child.styles) {
      if (child.styles.position === "absolute" || child.styles.position === "fixed") {
        try {
          childNode.layoutPositioning = "ABSOLUTE";
          childNode.x = origX;
          childNode.y = origY;
          if (shouldCenter) {
            childNode.constraints = { horizontal: "CENTER", vertical: childNode.constraints.vertical || "TOP" };
          }
        } catch(e) {}
      } else {
        const flexGrow = parseFloat(child.styles.flexGrow);
        
        let currentNode = childNode;
        
        if (shouldCenter && origX < -5) {
          try {
            const wrapper = figma.createFrame();
            wrapper.name = childNode.name + "-center-wrap";
            wrapper.fills = [];
            try { wrapper.layoutMode = frame.layoutMode; } catch(e) {}
            try { wrapper.primaryAxisSizingMode = "AUTO"; } catch(e) {}
            try { wrapper.counterAxisSizingMode = "AUTO"; } catch(e) {}
            try { wrapper.primaryAxisAlignItems = "CENTER"; } catch(e) {}
            try { wrapper.counterAxisAlignItems = "CENTER"; } catch(e) {}
            try { wrapper.clipsContent = false; } catch(e) {}
            
            const idx = frame.children.indexOf(currentNode);
            try {
              if (idx !== -1) frame.insertChild(idx, wrapper);
              else frame.appendChild(wrapper);
            } catch(e) {}
            
            try { wrapper.appendChild(currentNode); } catch(e) {}
            
            try { wrapper.layoutAlign = "STRETCH"; } catch(e) {}
            
            currentNode = wrapper;
          } catch(e) {}
        }
        
        if (!isNaN(flexGrow) && flexGrow > 0) {
          try { currentNode.layoutGrow = 1; } catch(e) {}
        }
        
        const mt = px(child.styles.marginTop);
        const mb = px(child.styles.marginBottom);
        const ml = px(child.styles.marginLeft);
        const mr = px(child.styles.marginRight);
        if (mt || mb || ml || mr) {
          try {
            const wrapper = figma.createFrame();
            wrapper.name = currentNode.name + "-margin";
            wrapper.fills = [];
            try { wrapper.layoutMode = "VERTICAL"; } catch(e) {}
            try { wrapper.primaryAxisSizingMode = "AUTO"; } catch(e) {}
            try { wrapper.counterAxisSizingMode = "AUTO"; } catch(e) {}
            if (mt) try { wrapper.paddingTop = Math.max(0, mt); } catch(e) {}
            if (mb) try { wrapper.paddingBottom = Math.max(0, mb); } catch(e) {}
            if (ml) try { wrapper.paddingLeft = Math.max(0, ml); } catch(e) {}
            if (mr) try { wrapper.paddingRight = Math.max(0, mr); } catch(e) {}
            
            const idx = frame.children.indexOf(currentNode);
            try {
              if (idx !== -1) frame.insertChild(idx, wrapper);
              else frame.appendChild(wrapper);
            } catch(e) {}
            
            // If the child has layoutGrow = 1 or layoutAlign = "STRETCH", appending it to a HUG wrapper will crash or behave incorrectly.
            let hadGrow = false;
            let hadStretch = false;
            try { 
              if (currentNode.layoutGrow === 1) {
                hadGrow = true;
                currentNode.layoutGrow = 0;
              }
              if (currentNode.layoutAlign === "STRETCH") {
                hadStretch = true;
                currentNode.layoutAlign = "INHERIT";
              }
            } catch(e) {}
            
            try { wrapper.appendChild(currentNode); } catch(e) {}
            
            if (hadStretch) {
              try { wrapper.layoutAlign = "STRETCH"; } catch(e) {}
              try { currentNode.layoutAlign = "STRETCH"; } catch(e) {}
            }
            
            if (hadGrow) {
              try { wrapper.layoutGrow = 1; } catch(e) {}
              try { currentNode.layoutAlign = "STRETCH"; } catch(e) {}
            }
            
            if (!isNaN(flexGrow) && flexGrow > 0) {
              try { wrapper.layoutGrow = 1; } catch(e) {}
            }
            
            currentNode = wrapper;
          } catch(e) {}
        }
      }
    }
  }

  // ---- CSS gradient background (linear-gradient, radial-gradient, etc.) ----
  const bgImgRaw = style.backgroundImage || "";
  const hasGradient = bgImgRaw.includes("gradient(");
  let bgImgUrl = !hasGradient ? extractSvgDataUrl(bgImgRaw) : null;

  if (hasGradient && bgImgRaw !== "none") {
    try {
      const bgSize = style.backgroundSize || "100% 100%";
      const dataUrl = await new Promise((resolve, reject) => {
        const key = bgImgRaw + "||" + bgSize;
        pendingImageDecodes.set(key, { resolve, reject });
        figma.ui.postMessage({ type: "render-gradient", bgImage: bgImgRaw, bgSize, key });
        setTimeout(() => reject(new Error("Gradient render timeout")), 10000);
      });
      const bytes = dataURLToBytes(dataUrl);
      const image = figma.createImage(bytes);
      // Parse background-size to determine tile dimensions for Figma's scaling factor.
      // TILE scaleMode in Figma uses the image's natural size, so rendering the canvas
      // at exactly the tile size means scalingFactor=1 is correct.
      frame.fills = [
        ...(frame.fills || []).filter(f => f.type !== "IMAGE"),
        { type: "IMAGE", imageHash: image.hash, scaleMode: "TILE", scalingFactor: 1 }
      ];
    } catch(e) {}
  }

  if (bgImgUrl) {
    const svgStr = getSvgStringFromDataUrl(bgImgUrl);
    if (svgStr) {
      try {
        const svgNode = figma.createNodeFromSvg(processSvgString(svgStr));
        svgNode.name = "background-svg";
        svgNode.resize(Math.max(frame.width, 1), Math.max(frame.height, 1));
        if (frame.layoutMode !== "NONE") svgNode.layoutPositioning = "ABSOLUTE";
        svgNode.x = 0;
        svgNode.y = 0;
        frame.insertChild(0, svgNode);
      } catch(e) {}
    } else if (bgImgUrl.startsWith("data:image") || bgImgUrl.startsWith("http")) {
      try {
        const bytes = await decodeImageSafe(bgImgUrl);
        const image = figma.createImage(bytes);
        frame.fills = [...(frame.fills || []), { type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" }];
      } catch (uiErr) {
        if (bgImgUrl.startsWith("http")) {
          try {
            const response = await fetch(bgImgUrl);
            const buffer = await response.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            const image = figma.createImage(bytes);
            frame.fills = [...(frame.fills || []), { type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" }];
          } catch(e) {}
        }
      }
    }
  }

  const maskStyle = style.maskImage || style.webkitMaskImage || style.mask || style.WebkitMask || style.webkitMask || style.WebkitMaskImage;
  let maskUrl = extractSvgDataUrl(maskStyle);

  if (maskUrl) {
    const svgStr = getSvgStringFromDataUrl(maskUrl);
    if (svgStr) {
      try {
        const maskWrapper = figma.createFrame();
        maskWrapper.name = frame.name + " (Masked)";
        maskWrapper.x = frame.x;
        maskWrapper.y = frame.y;
        if (frame.layoutPositioning === "ABSOLUTE") {
          maskWrapper.layoutPositioning = "ABSOLUTE";
        } else if (frame.layoutGrow === 1) {
          maskWrapper.layoutGrow = 1;
        }
        
        maskWrapper.resize(Math.max(frame.width, 1), Math.max(frame.height, 1));
        maskWrapper.fills = [];
        maskWrapper.clipsContent = false;
        
        frame.x = 0;
        frame.y = 0;
        
        const svgNode = figma.createNodeFromSvg(processSvgString(svgStr));
        svgNode.resize(Math.max(frame.width, 1), Math.max(frame.height, 1));
        svgNode.x = 0;
        svgNode.y = 0;
        
        // Figma FrameNodes mask as rectangles. We must extract the vectors into a GroupNode.
        const childrenToGroup = [...svgNode.children];
        if (childrenToGroup.length > 0) {
          const maskGroup = figma.group(childrenToGroup, maskWrapper);
          maskGroup.name = "mask-svg";
          maskGroup.isMask = true;
          try { maskGroup.maskType = "ALPHA"; } catch(e) {}
        }
        svgNode.remove(); // remove the empty frame
        
        maskWrapper.appendChild(frame);
        
        return maskWrapper;
      } catch(e) {}
    }
  }

  return frame;
}
