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
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
  const [r, g, b, a = 1] = parts;
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  if (a === 0) return null; // fully transparent — treat as no fill
  return { color: { r: r / 255, g: g / 255, b: b / 255 }, opacity: a };
}

function px(str) {
  const n = parseFloat(str);
  return isNaN(n) ? 0 : n;
}

function alignPrimary(justifyContent) {
  switch (justifyContent) {
    case "center": return "CENTER";
    case "flex-end": return "MAX";
    case "space-between": return "SPACE_BETWEEN";
    default: return "MIN";
  }
}

function alignCounter(alignItems) {
  switch (alignItems) {
    case "center": return "CENTER";
    case "flex-end": return "MAX";
    case "baseline": return "MIN";
    default: return "MIN";
  }
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
  if (!isNaN(opacity) && "opacity" in node) node.opacity = opacity;

  applyBoxShadow(node, styles.boxShadow);
}

// domNode: captured node. originRect: the rect this node's x/y should be measured against
// (its parent's captured rect), so Figma's parent-relative coordinates come out right.
async function buildNode(domNode, originRect, bump) {
  bump();

  // ---- Image leaf ----
  if (domNode.tag === "img") {
    const node = figma.createRectangle();
    node.name = "img";
    node.resize(Math.max(domNode.rect.width, 1), Math.max(domNode.rect.height, 1));
    node.x = domNode.rect.x - originRect.x;
    node.y = domNode.rect.y - originRect.y;
    if (domNode.image && domNode.image.startsWith("data:image")) {
      try {
        const bytes = dataURLToBytes(domNode.image);
        const image = figma.createImage(bytes);
        node.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" }];
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
      const node = figma.createNodeFromSvg(domNode.svg);
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
  
  const children = domNode.children || [];
  
  let wantsAutoLayout = false;
  if (style.display === "flex" || style.display === "inline-flex") {
    wantsAutoLayout = true;
    frame.layoutMode = style.flexDirection && style.flexDirection.includes("column") ? "VERTICAL" : "HORIZONTAL";
  }

  if (wantsAutoLayout) {
    const flowChildren = children.filter(c => !(c.styles && (c.styles.position === "absolute" || c.styles.position === "fixed")));

    if (frame.layoutMode === "VERTICAL" && flowChildren.length > 1) {
      const gapY = flowChildren[1].rect.y - (flowChildren[0].rect.y + flowChildren[0].rect.height);
      frame.itemSpacing = Math.max(gapY, px(style.gap) || 0, 0);
    } else {
      frame.itemSpacing = Math.max(px(style.gap), 0);
    }

    if (flowChildren.length > 0) {
      let minY = Infinity, maxY = -Infinity;
      for (const child of flowChildren) {
        if (child.rect.y < minY) minY = child.rect.y;
        if (child.rect.y + child.rect.height > maxY) maxY = child.rect.y + child.rect.height;
      }
      frame.paddingTop = Math.max(minY - domNode.rect.y, 0);
      frame.paddingBottom = Math.max((domNode.rect.y + domNode.rect.height) - maxY, 0);
    } else {
      frame.paddingTop = px(style.paddingTop);
      frame.paddingBottom = px(style.paddingBottom);
    }

    frame.paddingLeft = px(style.paddingLeft);
    frame.paddingRight = px(style.paddingRight);

    frame.primaryAxisAlignItems = alignPrimary(style.justifyContent);
    frame.counterAxisAlignItems = alignCounter(style.alignItems);
    
    if (frame.layoutMode === "VERTICAL") {
      frame.primaryAxisSizingMode = "AUTO";
      frame.counterAxisSizingMode = "FIXED";
    } else {
      frame.primaryAxisSizingMode = "FIXED";
      frame.counterAxisSizingMode = "AUTO";
    }
  } else {
    frame.layoutMode = "NONE";
  }

  for (const child of children) {
    const childNode = await buildNode(child, domNode.rect, bump);
    frame.appendChild(childNode);
    
    if (wantsAutoLayout && child.styles && (child.styles.position === "absolute" || child.styles.position === "fixed")) {
      try {
        childNode.layoutPositioning = "ABSOLUTE";
      } catch(e) {}
    }
  }

  return frame;
}
