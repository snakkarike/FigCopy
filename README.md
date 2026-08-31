<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/Logo-Dark.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/Logo-Light.png">
    <img src="assets/Logo-Light.png" alt="FigCopy Logo" height="60" />
  </picture>
</div>

<br/>

**FigCopy** is a developer tool that bridges your live DOM to Figma. It captures layouts, styles, and assets from your browser and reconstructs them into pixel-perfect, fully-editable Figma layers.

It consists of two halves working together:

1. **Chrome Extension** (`chrome-extension/`) — Inspect any element on your page (or capture the entire page). It serializes the DOM subtree into a specialized JSON payload and copies it to your clipboard.
2. **Figma Plugin** (`figma-plugin/`) — Paste that JSON payload into Figma, and the plugin reconstructs real frames, auto-layout groups, text nodes, vectors, gradients, and images on your canvas.

---

## 🚀 Installation

### 1. Install the Chrome Extension
1. Go to `chrome://extensions` in your browser.
2. Toggle **Developer mode** on (top right corner).
3. Click **Load unpacked**, and select the `chrome-extension/` folder from this repo.
4. Pin the extension to your toolbar for easy access!

### 2. Install the Figma Plugin
1. Open the Figma desktop app.
2. Go to **Plugins → Development → Import plugin from manifest…**
3. Select the `figma-plugin/manifest.json` file.
4. The plugin will now be available under **Plugins → Development → FigCopy**.

---

## 🛠️ How to use

1. Open the website or local app you want to capture in Chrome.
2. Click the **FigCopy extension icon** in your toolbar.
3. Click **Pick an element…** and hover over the section you want to capture. A highlighter box will show your selection. Click to capture it. (Alternatively, use **Capture full page**).
4. A toast notification will confirm the layout was copied to your clipboard.
5. In Figma, open **Plugins → Development → FigCopy**.
6. Click into the input box and press `Ctrl+V` (or `Cmd+V`) to paste the JSON.
7. Click **Build in Figma**.

A new frame will be dropped at the center of your viewport, fully nested and editable!

---

## ✨ Features & Capabilities

FigCopy captures a massive amount of detail automatically. Here is what is supported out-of-the-box:

- **Layout Structure:** Deeply nested DOM nodes become perfectly nested Figma Frames.
- **Auto-Layout:** Flexbox (`display: flex`) layouts map perfectly to Figma's Auto Layout, including direction, gaps, padding, wrapping, and alignment (justify/align).
- **Margins & Spacing:** CSS margins are translated natively into Figma's per-child margin properties.
- **Absolute Positioning:** Static and absolutely positioned elements are mapped pixel-accurately relative to their parents.
- **Text Fidelity:** Captures content, font families (with intelligent fallbacks to Inter), sizes, weights, colors, text-transform, text-decoration (underlines/strikethroughs), and line heights.
- **Masks & SVG Icons:** Intelligently detects CSS masks (`-webkit-mask` with SVG data URLs) and converts them into native, editable Figma SVG vectors with the correct fill colors.
- **CSS Gradients:** Captures `linear-gradient` and `radial-gradient` backgrounds by rendering them natively in the browser to a perfectly-sized tile and importing them into Figma.
- **Media Support:** Captures `<img>` tags, `<video>` tags (converted to Figma Video nodes when possible), and `<canvas>` elements.
- **Shadows:** Parses CSS `box-shadow` (both drop shadows and inner shadows) into Figma Effects.
- **Borders & Radii:** Captures border colors, individual border widths, and corner radii.
- **Colors:** Full support for HEX, RGB(A), HSL, Lab, and OKLCH (CSS Color Level 4) with automatic sRGB fallback conversion.

---

## ⚠️ Known Limitations / Manual Work Required

While FigCopy is powerful, some things still require manual cleanup in Figma (which is true of any DOM-to-Figma tool):

- **Components:** The import creates raw, flat frames. It will not automatically link repeated UI elements to your existing Figma Component library.
- **Custom Fonts:** If your product uses a custom typeface that isn't installed locally on your system, Figma will fall back to Inter. You'll need to install the font and swap it in Figma.
- **CSS Grid:** Grid containers aren't translated to Auto Layout (only Flexbox is). Grid children will come through as absolutely-positioned frames—they will look visually correct, but won't reflow.
- **Cross-Origin Media (CORS):** Images or videos loaded from third-party domains without CORS headers might fail to inline due to browser security (canvas tainting). They will fall back to gray placeholder rectangles.
- **Pseudo-elements:** `::before` and `::after` elements are supported if they contain `content`, but complex CSS trickery (like triangle borders) might not map perfectly.

---

## 💻 Tech Stack & Architecture

- **Extension (`content.js`):** Vanilla JavaScript. Traverses the DOM, evaluates `window.getComputedStyle`, and normalizes properties into a clean JSON tree.
- **Extension UI (`popup.html`):** A sleek, black-and-white aesthetic built with raw HTML/CSS.
- **Plugin UI (`ui.html`):** Handles clipboard pasting (via native events to bypass sandbox restrictions) and acts as an invisible rendering engine to rasterize complex CSS gradients via SVG `<foreignObject>`.
- **Plugin Logic (`code.js`):** Uses the Figma Plugin API to recursively walk the JSON tree and spawn native Figma nodes (`figma.createFrame()`, `figma.createText()`, etc.).

---

## 📜 License

This project is licensed under the **GNU General Public License v3.0** (GPLv3). 

You are free to use, modify, and distribute this software, but any derivative works must also be open-source and distributed under the same GPLv3 license. See the [LICENSE](LICENSE) file for the full text.

---

<div align="center">
  <i>Built to make the design-to-code loop a two-way street.</i>
  <br/><br/>
  <a href="https://buymeacoffee.com/snakkarike" target="_blank">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 40px !important;width: 145px !important;" >
  </a>
</div>
