# Changelog

All notable changes to this project will be documented in this file.

## [1.0.2] - Advanced Auto Layout & Native Forms

### Added
- **Expanded Auto-Layout Coverage:** Structural elements like badges, text blocks, and table cells (`display: block`, `inline-block`, `list-item`, `table-cell`) are now automatically converted into fully-editable Figma Auto Layout frames instead of absolute "dumb" boxes.
- **Text-Align Mapping:** CSS `text-align` properties (`center`, `right`, `end`) are now intelligently mapped directly to Figma's `primaryAxisAlignItems` and `counterAxisAlignItems` for these new structural containers.
- **SVG Background Image Support:** The plugin can now render inline SVG data URLs used in CSS `background-image` properties (heavily used in custom checkboxes). It decodes the SVG, creates native Figma vector nodes, and pins them to the back of the element's layout stack using absolute positioning.
- **Native Checkbox & Radio Synthesis:** The Chrome extension now detects native OS-rendered checkboxes and radio buttons. Because native controls hide their CSS, the extension synthesizes their blue checked backgrounds, borders, disabled states, and vector checkmark/dot SVGs on the fly so they render perfectly in Figma.

### Fixes
- **Select Dropdown Bounds:** Ignored `<option>`, `<optgroup>`, and `<datalist>` tags in both the extension and plugin to prevent invisible browser DOM cruft from blowing out the dimensions of `<select>` dropdowns in Auto Layout.
- **Margin Wrapper Sizing Bug:** Fixed a critical issue where margin and centering wrappers were defaulting to fixed 100x100 pixel dimensions because the Figma API requires the string `"AUTO"` for "Hug contents" rather than `"HUG"`.
- **Root Frame Clipping:** Disabled `clipsContent` on the absolute root frame to prevent rigid wide layouts from being artificially chopped off if the capturing browser window was narrowed by scrollbars.
- **Graceful Text Overflow:** Refined the `clipsContent` mapping so containers using `overflow: auto` or `overflow: scroll` (like sidebars) no longer aggressively clip text characters in Figma, allowing slightly-wider text rendering to overflow gracefully for manual resizing.

## [1.0.1] - UI & Icon Polish

### Fixes
- **Extension Icon Fix:** Padded the `icon.png` to a perfect 1:1 aspect ratio (133x133) to prevent Chrome from stretching and distorting the icon in the extensions toolbar and dropdown.
- **Popup Logo Scaling:** Added explicit width scaling to the SVG logo in the extension popup to prevent flexbox distortion.

## [1.0.0] - Recent Security & Robustness Updates
### Security & Privacy
- **SSRF / Beaconing Protection:** The Figma plugin now scans pasted payloads for external image/media URLs. If a stranger's payload tries to load external assets, the plugin halts and presents a confirmation UI listing the domains. Local development URLs (`localhost`, LAN IPs) bypass this check automatically for zero-friction workflows.
- **Privacy & Form Data:** Password fields are no longer captured in plaintext. 
- **Skip Form Input Values:** A new toggle has been added to the extension popup to easily omit live form data (emails, searches) from being captured in shared payloads.
- **Stack Overflow Prevention:** Added strict depth (max 500 levels) and node count (max 3000) limits to the Figma plugin to defend against malformed or malicious, deeply-nested JSON payloads.
- **DOM XSS Mitigation:** Plugin UI properly escapes dragged-and-dropped file names to prevent script injection in the iframe sandbox.

### Fixes & Improvements
- **Extension Cleanup:** The background script now properly garbage-collects tab emulation states when browser tabs are closed, preventing memory leaks in session storage.
- **Permissions Transparency:** Added a `Permissions` section to the README to clarify the scoped usage of the Chrome `debugger` API (it is only used for `Emulation.setDeviceMetricsOverride`).
- **Gradient Rasterization Security:** Plugin UI now builds DOM elements natively using `document.createElement` instead of raw HTML string interpolation when rasterizing CSS gradients, hardening against injection vectors.
- **Payload Truncation Warning:** The extension will now show a toast warning to the user if a DOM subtree exceeds the 1500-node hard limit, preventing silent truncation in the generated payload.
- **Robust Pseudo-Element Parsing:** Added null-checks to the pseudo-element parser in `content.js` to prevent the extension from crashing on malformed CSS `url()` strings.
- **Comprehensive Form Capture:** Expanded `isTextInput` list to natively handle modern HTML5 inputs (`date`, `color`, `range`, `time`, etc.), ensuring full-fidelity form capture.
- **CI & Automation:** Added GitHub Action workflows for basic CI linting and automated release packaging, and removed checked-in binary `.zip` artifacts from the repository.

## [0.0.1] - Initial Release

### Added
- **Core Engine:** DOM-to-JSON serialization in Chrome Extension and JSON-to-Figma reconstruction in Figma Plugin.
- **Auto-Layout Support:** Perfectly maps Flexbox (`display: flex`) properties including direction, gaps, padding, wrapping, and alignment into native Figma Auto Layout frames.
- **Deep Styling Capture:** Supports CSS margins, absolute positioning, borders, radii, opacity, and complex `box-shadow` properties (including inner shadows).
- **Text & Typography:** High-fidelity capture of text content, fonts (falling back to Inter), weights, sizes, line heights, text-transform, and text-decoration.
- **Media & Images:** Native support for `<img>`, `<video>` (mapped to Figma Video nodes), and `<canvas>` rendering.
- **Advanced CSS Rendering:** 
  - Converts `-webkit-mask` SVG data URLs into native, color-filled Figma vectors.
  - Native browser rasterization for complex `linear-gradient` and `radial-gradient` backgrounds.
- **Color Parsing:** Full translation of HEX, RGB(A), HSL, Lab, and OKLCH (CSS Color Level 4) values into Figma-compatible RGBA objects.
- **Viewport Emulation:** Toggleable device width emulation directly from the extension popup using Chrome's debugger API.
- **File Queueing:** Support for dragging, dropping, and queuing multiple `.json` payloads in the Figma plugin for batch building.
