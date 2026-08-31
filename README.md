# FigCopy

Two halves working together:

1. **Chrome extension** (`chrome-extension/`) — pick any element on your localhost
   page, or capture the whole page, and it copies a JSON layout tree to your
   clipboard.
2. **Figma plugin** (`figma-plugin/`) — paste that JSON in and it builds real
   frames, auto-layout, text, and images on the canvas.

## Install the Chrome extension

1. Go to `chrome://extensions`
2. Toggle **Developer mode** on (top right)
3. Click **Load unpacked**, select the `chrome-extension/` folder
4. Pin the extension so it's easy to click

## Install the Figma plugin

1. In Figma desktop app: **Plugins → Development → Import plugin from manifest…**
2. Select `figma-plugin/manifest.json`
3. It'll now show up under **Plugins → Development → FigCopy**

## Using it

1. Open your localhost app in Chrome
2. Click the extension icon → **Pick an element…** → click the section of the
   page you want (or **Capture full page**)
3. You'll see a toast confirming it copied
4. In Figma: **Plugins → Development → FigCopy**
5. Click **Paste from clipboard** (or `Cmd/Ctrl+V` directly into the box)
6. Click **Build in Figma**

It'll drop a frame at your current viewport center, fully nested and editable.

## What you get vs. what still needs manual work

**Comes through automatically:**
- Layout structure (nested frames matching your DOM)
- Auto-layout for anything using `display: flex` (direction, gap, padding,
  alignment)
- Absolute positioning for everything else (pixel-accurate to the captured page)
- Text content, size, weight (Regular/Medium/Bold), color, alignment
- Background colors, borders, corner radius, opacity
- Images (inlined as PNG where CORS allows; falls back to a gray placeholder
  otherwise — see note below)

**Still manual (this is true of every DOM-import tool, not a shortcut you're
missing):**
- Turning repeated patterns into real Figma **components/variants** — the
  import gives you flat frames, not a component library
- **Fonts** — everything currently maps to Inter with a weight guess, since
  Figma plugins can only use fonts already installed/available in your Figma
  account. If your product uses a custom typeface, install it and swap it in
  after import (search-and-replace font is quick in Figma)
- **Figma variables/styles** for color and spacing — worth setting up once
  you've imported a few screens, so future screens reuse the same tokens
  instead of raw hex values
- Grid/CSS-grid layouts aren't translated to auto-layout (only flexbox is) —
  grid containers come through as absolutely-positioned frames, which still
  look correct but won't reflow

## Known limitations / gotchas

- **Cross-origin images** (loaded from a different domain than your localhost
  page) will fail to inline due to canvas tainting — they come through as a
  gray placeholder rectangle. Same-origin images and inline `data:` images work
  fine.
- **Very deep/large pages** are capped at ~1500 nodes in `content.js`
  (`MAX_NODES`) to avoid locking up the tab — capture smaller sections at a
  time for big pages rather than the whole document.
- **`box-shadow`** is captured but not yet applied as a Figma effect — that's
  a straightforward addition to `applyCommonStyle` in `code.js` if you want it
  (parse the CSS shadow string into `{type: "DROP_SHADOW", ...}`).
- The Figma plugin UI's clipboard read can be blocked by the OS/app
  permissions — if **Paste from clipboard** fails silently, just
  `Cmd/Ctrl+V` directly into the textarea instead, which always works.

## Where to extend next

- `content.js` → `STYLE_PROPS`: add more computed style properties here if you
  want more fidelity (e.g. `letterSpacing` is captured but not yet applied on
  the Figma side — wire it into the text-node branch of `buildNode` in
  `code.js`)
- `code.js` → `buildNode`: this is the whole mapping layer, DOM JSON → Figma
  API calls. Component/variant detection would live here (e.g. hash each
  subtree's shape and reuse a `ComponentNode` for repeats).
