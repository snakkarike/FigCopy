// code.js — runs in Figma's plugin sandbox (no DOM access, only the figma.* API)

figma.showUI(__html__, { width: 360, height: 420 });

figma.ui.onmessage = async (msg) => {
  if (msg.type !== "build") return;
  try {
    let count = 0;
    const bump = () => count++;
    const root = msg.payload.root;
    if (!root) throw new Error("No root node in payload");

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

  function oklabToRgb(L, a, b) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    let r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    let b_ = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    r = r > 0.0031308 ? 1.055 * Math.pow(r, 1/2.4) - 0.055 : 12.92 * r;
    g = g > 0.0031308 ? 1.055 * Math.pow(g, 1/2.4) - 0.055 : 12.92 * g;
    b_ = b_ > 0.0031308 ? 1.055 * Math.pow(b_, 1/2.4) - 0.055 : 12.92 * b_;
    return { r: Math.max(0, Math.min(1, r)), g: Math.max(0, Math.min(1, g)), b: Math.max(0, Math.min(1, b_)) };
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
        // Fallback for standard lab to grayscale (as true Lab to sRGB is complex)
        const l = parts[0] > 1 ? parts[0]/100 : parts[0];
        return { color: { r: l, g: l, b: l }, opacity: parts.length > 3 ? parts[3] : 1 };
      }
    }
  }

  if (str.startsWith("hsl")) {
    const m = str.match(/hsla?\(([^)]+)\)/);
    if (m) {
      const parts = m[1].replace(/[\/%]/g, " ").split(/[\s,]+/).filter(Boolean).map(parseFloat);
      if (parts.length >= 3 && !isNaN(parts[2])) {
        const l = parts[2] > 1 ? parts[2]/100 : parts[2];
        if (l > 0.5) return { color: { r: 1, g: 1, b: 1 }, opacity: 1 };
        return { color: { r: 0, g: 0, b: 0 }, opacity: 1 };
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

async function loadFontSafe(style) {
  try {
    await figma.loadFontAsync({ family: "Inter", style });
    return { family: "Inter", style };
  } catch (e) {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    return { family: "Inter", style: "Regular" };
  }
}

function dataURLToBytes(dataURL) {
  const base64 = dataURL.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
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

function parseLinearGradient(bgStr) {
  // Very basic universal parser for linear-gradient
  // Handles: linear-gradient(90deg, red, blue) or linear-gradient(to right, #f00 0%, #00f 100%)
  if (!bgStr || !bgStr.includes('linear-gradient')) return null;
  
  // This is a complex problem in regex, we'll extract just a basic 2-color gradient for now
  // as full CSS gradient parsing requires an AST parser (like css-gradient-parser).
  // For V1 generic compatibility, we just return null to avoid breaking,
  // or we can implement a basic fallback if needed.
  return null;
}

// domNode: captured node. originRect: the rect this node's x/y should be measured against
// (its parent's captured rect), so Figma's parent-relative coordinates come out right.
async function buildNode(domNode, originRect, bump) {
  bump();

  // ---- Image / Canvas leaf ----
  if (domNode.tag === "img" || domNode.tag === "canvas") {
    const node = figma.createRectangle();
    node.name = domNode.tag === "canvas" ? "canvas" : "img";
    node.resize(Math.max(domNode.rect.width, 1), Math.max(domNode.rect.height, 1));
    node.x = domNode.rect.x - originRect.x;
    node.y = domNode.rect.y - originRect.y;
    if (domNode.image && domNode.image.startsWith("data:image")) {
      try {
        const bytes = dataURLToBytes(domNode.image);
        const image = figma.createImage(bytes);
        const scaleMode = domNode.tag === "canvas" ? "FIT" : "FILL";
        node.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode }];
      } catch (e) {
        node.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.85 } }];
      }
    } else {
      node.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.85 } }];
    }
    applyCommonStyle(node, domNode.styles);
    return node;
  }

  // ---- SVG leaf ----
  if (domNode.svg) {
    try {
      let svgStr = domNode.svg;
      // Figma's SVG parser doesn't understand CSS Color Level 4 (lab, oklch, etc)
      // We manually intercept fill/stroke attributes and convert them to #hex + opacity
      svgStr = svgStr.replace(/(fill|stroke|color)="([^"]+)"/g, (match, attr, colorStr) => {
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
    const fontName = await loadFontSafe(fontStyle);

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
  
  const isClipped = style.overflow === "hidden" || style.overflow === "scroll" || style.overflow === "auto" || style.overflowX === "hidden" || style.overflowY === "hidden" || style.overflow === "clip";
  frame.clipsContent = !!isClipped;

  applyCommonStyle(frame, style);
  
  const children = domNode.children ? [...domNode.children] : [];
  
  let wantsAutoLayout = false;
  if (style.display === "flex" || style.display === "inline-flex") {
    wantsAutoLayout = true;
    frame.layoutMode = style.flexDirection && style.flexDirection.includes("column") ? "VERTICAL" : "HORIZONTAL";
  }

  if (wantsAutoLayout) {
    const flowChildren = children.filter(c => !(c.styles && (c.styles.position === "absolute" || c.styles.position === "fixed")));

    frame.itemSpacing = Math.max(px(style.gap) || 0, 0);

    frame.paddingTop = px(style.paddingTop);
    frame.paddingBottom = px(style.paddingBottom);
    frame.paddingLeft = px(style.paddingLeft);
    frame.paddingRight = px(style.paddingRight);

    frame.primaryAxisAlignItems = alignPrimary(style.justifyContent);
    frame.counterAxisAlignItems = alignCounter(style.alignItems);
    
    if (style.flexWrap === "wrap") {
      frame.layoutWrap = "WRAP";
    }
    
    frame.primaryAxisSizingMode = "FIXED";
    frame.counterAxisSizingMode = "FIXED";
  } else {
    frame.layoutMode = "NONE";
  }

  for (const child of children) {
    const childNode = await buildNode(child, domNode.rect, bump);
    
    const origX = childNode.x;
    const origY = childNode.y;
    
    frame.appendChild(childNode);
    
    if (wantsAutoLayout && child.styles) {
      if (child.styles.position === "absolute" || child.styles.position === "fixed") {
        try {
          childNode.layoutPositioning = "ABSOLUTE";
          childNode.x = origX;
          childNode.y = origY;
        } catch(e) {}
      } else {
        const flexGrow = parseFloat(child.styles.flexGrow);
        if (!isNaN(flexGrow) && flexGrow > 0) {
          try {
            childNode.layoutGrow = 1;
          } catch(e) {}
        }
      }
    }
  }

  return frame;
}
