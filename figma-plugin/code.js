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

function applyCommonStyle(node, styles) {
  if (!styles) return;

  const bg = parseColor(styles.backgroundColor);
  if (bg && "fills" in node) {
    node.fills = [{ type: "SOLID", color: bg.color, opacity: bg.opacity }];
  } else if ("fills" in node) {
    node.fills = [];
  }

  const borderColor = parseColor(styles.borderColor);
  const borderWidth = px(styles.borderWidth);
  if (borderColor && borderWidth > 0 && styles.borderStyle !== "none" && "strokes" in node) {
    node.strokes = [{ type: "SOLID", color: borderColor.color, opacity: borderColor.opacity }];
    node.strokeWeight = borderWidth;
  }

  if ("topLeftRadius" in node) {
    node.topLeftRadius = px(styles.borderTopLeftRadius);
    node.topRightRadius = px(styles.borderTopRightRadius);
    node.bottomLeftRadius = px(styles.borderBottomLeftRadius);
    node.bottomRightRadius = px(styles.borderBottomRightRadius);
  }

  const opacity = parseFloat(styles.opacity);
  if (!isNaN(opacity) && "opacity" in node) node.opacity = opacity;
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

  // ---- Text leaf ----
  if (domNode.text && (!domNode.children || domNode.children.length === 0)) {
    const style = domNode.styles || {};
    const fontStyle = fontStyleFor(style.fontWeight);
    const fontName = await loadFontSafe(fontStyle);

    const node = figma.createText();
    node.name = domNode.text.slice(0, 40);
    node.fontName = fontName;
    node.characters = domNode.text;
    node.fontSize = px(style.fontSize) || 12;

    const lh = style.lineHeight;
    if (lh && lh !== "normal" && !isNaN(parseFloat(lh))) {
      node.lineHeight = { value: parseFloat(lh), unit: "PIXELS" };
    }

    const color = parseColor(style.color) || { color: { r: 0, g: 0, b: 0 }, opacity: 1 };
    node.fills = [{ type: "SOLID", color: color.color, opacity: color.opacity }];

    if (style.textAlign === "center") node.textAlignHorizontal = "CENTER";
    else if (style.textAlign === "right") node.textAlignHorizontal = "RIGHT";
    else if (style.textAlign === "justify") node.textAlignHorizontal = "JUSTIFIED";

    node.x = domNode.rect.x - originRect.x;
    node.y = domNode.rect.y - originRect.y;
    node.textAutoResize = "NONE";
    node.resize(Math.max(domNode.rect.width, 1), Math.max(domNode.rect.height, 1));

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
  frame.clipsContent = false;

  applyCommonStyle(frame, style);

  const isFlex = style.display === "flex";
  if (isFlex) {
    frame.layoutMode = style.flexDirection === "column" ? "VERTICAL" : "HORIZONTAL";
    frame.itemSpacing = Math.max(px(style.gap), 0);
    frame.paddingTop = px(style.paddingTop);
    frame.paddingRight = px(style.paddingRight);
    frame.paddingBottom = px(style.paddingBottom);
    frame.paddingLeft = px(style.paddingLeft);
    frame.primaryAxisAlignItems = alignPrimary(style.justifyContent);
    frame.counterAxisAlignItems = alignCounter(style.alignItems);
    frame.primaryAxisSizingMode = "FIXED";
    frame.counterAxisSizingMode = "FIXED";
  } else {
    frame.layoutMode = "NONE";
  }

  const children = domNode.children || [];
  for (const child of children) {
    const childNode = await buildNode(child, domNode.rect, bump);
    frame.appendChild(childNode);
    // When the parent uses auto-layout, Figma positions children itself —
    // clear the absolute x/y we set so it doesn't fight the layout engine.
    if (isFlex) {
      childNode.x = 0;
      childNode.y = 0;
    }
  }

  return frame;
}
