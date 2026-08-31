# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - Recent Security & Robustness Updates

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

## [1.0.0] - Initial Release

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
