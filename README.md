# SciFig

Browser-based image editor and scientific figure drawing tool: pixel layers, non-destructive adjustment
layers and CAD-style vector drawing in one document. Static site, no build step, no server code.

## Run locally

    python3 -m http.server 8377 --bind 127.0.0.1     # from this folder
    open http://127.0.0.1:8377/

`index.html?sample` opens an example figure. `index.html?sample&test` runs the scripted checks in
`tests/selftest.js` (results in the browser console, summary in the tab title).

## Layout

| Path | What |
| --- | --- |
| `js/app.js` | Registries (commands, tools, filters, adjustments, help), settings, events |
| `js/core.js` | Geometry, vector shapes, layers, document + undo history, renderer |
| `js/imaging.js` | Selections, adjustments, filters |
| `js/snap.js` | Object snapping and Shift angle lock |
| `js/tools.js` | Canvas tools |
| `js/view.js` | Zoom/pan, rulers, overlay, pointer dispatch |
| `js/io.js` | Open/save/export (PSD, TIFF, SVG, PDF/AI, EPS), autosave |
| `js/ui.js`, `js/commands.js` | Panels, menus, dialogs, search; menu commands and help topics |
| `plugins/` | Built-in plugins; `halftone.js` is the example to copy |
| `vendor/` | ag-psd (MIT), UTIF + pako (MIT), pdf.js (Apache-2.0), Ghostscript WASM (AGPL-3.0) |

## Adding a feature

Register it; menus and search pick it up automatically.

    // plugins/myfilter.js, then add it to plugins/index.js
    export default function (app) {
      app.registerFilter({
        id: 'myfilter', title: 'My Filter',
        params: [{ id: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, default: 50 }],
        apply(img, p) { /* edit img.data (RGBA) in place */ return img; },
      });
    }

Also: `app.registerAdjustment` (pointwise, non-destructive), `app.registerCommand`, `app.registerTool`,
`app.registerHelp`. Quick experiments can be written in the app under Plugins ▸ Plugin Editor.

## Deploy

Any static host works; for GitHub Pages push this folder to a repository and enable Pages from the root.

## Added in v2 (2026-11-12)

New modules: `js/color.js` (colour spaces + picker), `js/hd.js` (32-bit float layers, Develop, 16/32-bit export),
`js/inpaint.js` (content-aware fill), `js/analyze.js` (MTF, profile, statistics, FFT), `js/ai.js` (subject / object selection).

- Tools: Free Transform (F, Ctrl+T), Spline (Y), Dimension (K), Object Select (Q), Clone Stamp (S), Remove (J); zoom-to-area.
- Value boxes while drawing (Tab between length / angle / width / height, units can be typed), typed transforms.
- Options bar shows tool options and the properties of the selection; right-click menus; Colour panel; Channels tab.
- Layer masks on image, vector and adjustment layers; selections from layer alpha, masks and channels.
- Formats: HEIC, camera raw (LibRaw, needs cross-origin isolation, provided by `coi-serviceworker.js`), 16/32-bit TIFF, 16-bit PNG.
- Tests: `?sample&test` (52 checks) and `?test2` (58 checks; add `tests/sample.arw` to also test raw decoding).

Runtime downloads (not vendored): transformers.js and its models from jsdelivr / Hugging Face for the AI selections,
Google Fonts for web fonts. Licences of vendored code: LibRaw (LGPL/CDDL), heic-to/libheif (LGPL-3.0), UPNG (MIT), Ghostscript (AGPL).

## Added in v3 (2026-11-12)

- Layout: two-column toolbar, wrapping options bar with groups, compact Colour panel, Properties only when the layer has settings, full-screen button, View ▸ Hide Toolbar and Panels, restyled sliders.
- Colour panel edits the stroke or fill of the selected shapes directly.
- `js/dims.js`: dimensions attach to shape points; they follow the shape, drive it when a length is typed, and can be locked as constraints. View ▸ Show Dimensions; "Show in export" per dimension.
- Remove tool / Content-Aware Fill use the MI-GAN neural inpainting model (downloaded on first use), with the PatchMatch method as the offline option.
- File ▸ New takes its size from the image on the clipboard.
- `manifest.json` + `icon.svg` so the site can be installed as an app window.
