# MedSafe PEG

**An interactive prototype of a home device that safely prepares tablet medicine for a PEG feeding tube.**

MedSafe PEG guides a family caregiver from the dose reminder to the dose record. Before anything is prepared, it checks that the medicine is prescribed, that it is due now and that it is safe to crush. After the syringe is filled, it checks the cup for medicine left behind.

This repository contains the web prototype: a live 3D model of the device that walks through all 8 steps, with two safety checks that run for real on a phone camera.

> Concept and demo only. Not a validated medical device.

**Live demo: [medsafe-peg-website.vercel.app](https://medsafe-peg-website.vercel.app)**

---

## Try it

Open the live link on a phone (iPhone Safari or Android Chrome) and tap **Start walkthrough**.

The 8 steps: **01** Remind · **02** Verify · **03** Crush · **04** Add water · **05** Mix · **06** Fill syringe · **07** Check residue · **08** Document

Two steps work with your phone camera. Each also has **Continue demo** to see a simulated result:

| Step | What to do | What happens |
|---|---|---|
| **02 · Verify** | Scan the medicine pack's DataMatrix code | The pack is checked against the prescription, the dose schedule, a do-not-crush list and its expiry date. If any check fails, preparation stays locked and the screen says why and what to do next. |
| **07 · Check residue** | Photograph the empty cup from above, on black paper | The cup's inner bottom is found automatically and powder left behind is marked in red. If residue is found, the caregiver is sent to **Flush and re-check**. |

### Demo patient
Patient A (fictional) has two prescriptions. Their times are set when the page opens:

| Medicine | Scheduled | Result when scanned |
|---|---|---|
| Pexapan 5 mg (apixaban) | Due now | **Match** |
| Zetex 10 mg (ezetimibe) | Due in 4 hours | **Blocked:** not due yet |
| Prosta-Tab PR 0.4 mg (prolonged-release tamsulosin) | Not prescribed | **Blocked:** not prescribed, do not crush |

Any other pack is read by its code or printed name and checked against the do-not-crush rules.

---

## How it works

- **3D model:** the device is built in code with [three.js](https://threejs.org) and animates each step.
- **Pack check:** reads GS1 DataMatrix codes (product number, batch, expiry, serial) with the browser's built-in barcode reader, or [ZXing](https://github.com/zxing-js/library) where that isn't available (iPhone). If no code can be read, the printed name is read with [Tesseract.js](https://github.com/naptha/tesseract.js). Do-not-crush rules cover modified-release, enteric-coated, softgel and sublingual forms and named hazardous drugs (a demo subset of published guidance).
- **Residue check:** custom image analysis finds the cup's inner bottom, then flags specks brighter than the cup surface. It ignores the cup's own markings, glare and water drops.
- **Privacy:** all image analysis runs on the phone. No photos are uploaded.

## Testing so far

- Tested on iPhone and laptop with the real medicine packs and the real demo cup.
- Pack check: all three demo packs gave the expected result.
- Residue check: 6 of 6 photos of the demo cup were classified correctly (clean, wet and with powder).
- The walkthrough was checked on phone (portrait and landscape) and desktop screen sizes.

---

## Run it yourself

It's a static site with no build step. The camera needs a secure (https) connection or `localhost`.

```bash
cd website
python3 -m http.server 8000
# open http://localhost:8000
```

To deploy, serve the `website` folder from any static host (for example Vercel, with Root Directory set to `website`).

### Files
| File | Purpose |
|---|---|
| `website/index.html` | Layout, step-by-step walkthrough, device screen states, Explore mode |
| `website/demo-vision.js` | Demo data, pack checks, code and text reading, residue detection, camera screen |
| `website/medsafe-model.js` | The 3D device model and its display |
| `website/three-d-stage.js` | 3D viewer: renderer, lighting, camera controls |

## Credits

Built by the **SafeFlow team** for MEDATHON. Designed with Claude Design and built and tested with Claude Code.
