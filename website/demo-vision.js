// MedSafe PEG — live camera tests for the walkthrough.
// Everything runs in the browser: code reading (BarcodeDetector / ZXing),
// printed-text reading (Tesseract.js, loaded on first use) and residue
// spot detection (plain image processing). No photo leaves the device.

const ZX_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm';
const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let zxP, tessP, detector;
// A failed load (flaky venue wifi) is not cached, so the next scan retries.
const loadZX = () => (zxP ||= import(ZX_URL).catch((e) => { zxP = null; throw e; }));
const loadTess = () => (tessP ||= new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = TESS_URL;
  s.onload = () => res(window.Tesseract); s.onerror = () => { tessP = null; rej(new Error('Text reader failed to load')); };
  document.head.appendChild(s);
}));

// ── Demo data ─────────────────────────────────────────────────────────────
const GTIN = { pexapan: '06285128019323', zetex: '06285147005758', prosta: '06285147003501' };
const hhmm = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
// Two prescribed medicines: one due when the page is opened, one due 4 hours later.
const LATER_H = 4;
export const PATIENT = {
  name: 'Patient A', route: 'PEG tube',
  // The medicine due now (used across the walkthrough).
  drug: 'Pexapan 5 mg', generic: 'Apixaban', dose: '1 tablet', gtin: GTIN.pexapan, due: hhmm(new Date()),
  later: { drug: 'Zetex 10 mg', generic: 'Ezetimibe', dose: '1 tablet', gtin: GTIN.zetex, hours: LATER_H, due: hhmm(new Date(Date.now() + LATER_H * 3600e3)) },
};
const PRODUCTS = {
  [GTIN.pexapan]: { name: 'Pexapan 5 mg', generic: 'Apixaban', form: 'Film-coated tablet', maker: 'Jamjoom Pharma', crush: 'ok' },
  [GTIN.zetex]: { name: 'Zetex 10 mg', generic: 'Ezetimibe', form: 'Tablet', maker: 'Tabuk Pharmaceuticals', crush: 'ok' },
  [GTIN.prosta]: { name: 'Prosta-Tab PR 0.4 mg', generic: 'Tamsulosin hydrochloride', form: 'Prolonged-release tablet', maker: 'Tabuk Pharmaceuticals', crush: 'no', why: 'Prolonged-release tablet' },
};

// Do-not-crush rules. Dosage-form categories and named examples drawn from
// the ISMP "Oral Dosage Forms That Should Not Be Crushed" list and the NEWT
// enteral-tube guidelines. Demo subset only, not a clinical database.
const FORM_RULES = [
  [/\b(SR|XR|ER|CR|MR|XL|LA|CD)\b|SUSTAINED|EXTENDED|PROLONGED|MODIFIED[- ]?RELEASE|CONTROLLED[- ]?RELEASE|SLOW[- ]?RELEASE|RETARD|CHRONO|CONTINUS/, 'Modified-release dosage form'],
  [/ENTERIC|GASTRO[- ]?RESISTANT|\bEC\b|DELAYED[- ]?RELEASE/, 'Enteric-coated dosage form'],
  [/SOFT ?GELS?\b|SOFTGEL|LIQUID[- ]?FILLED|SOFT CAPSULE/, 'Softgel or liquid-filled capsule'],
  [/SUBLINGUAL|BUCCAL/, 'Sublingual or buccal dosage form'],
];
const NAMED = [
  ['Tamsulosin', /TAMSULOSIN/, 'Modified-release capsule'],
  ['Omeprazole', /\bOMEPRAZOLE/, 'Enteric-coated pellets'],
  ['Esomeprazole', /ESOMEPRAZOLE/, 'Enteric-coated pellets'],
  ['Lansoprazole', /LANSOPRAZOLE/, 'Enteric-coated granules'],
  ['Pantoprazole', /PANTOPRAZOLE/, 'Gastro-resistant tablet'],
  ['Rabeprazole', /RABEPRAZOLE/, 'Gastro-resistant tablet'],
  ['Mesalazine', /MESALAZINE|MESALAMINE/, 'Modified-release tablet'],
  ['Bisacodyl', /BISACODYL/, 'Enteric-coated tablet'],
  ['Dabigatran', /DABIGATRAN|PRADAXA/, 'Capsule must not be opened'],
  ['OxyContin', /OXYCONTIN/, 'Extended-release opioid'],
  ['MST Continus', /\bMST\b/, 'Modified-release opioid'],
  ['Adalat', /ADALAT/, 'Modified-release nifedipine'],
  ['Concerta', /CONCERTA/, 'Extended-release osmotic tablet'],
  ['Felodipine', /FELODIPINE/, 'Extended-release tablet'],
  ['Finasteride', /FINASTERIDE/, 'Hazardous drug · exposure risk to staff'],
  ['Dutasteride', /DUTASTERIDE/, 'Hazardous drug · exposure risk to staff'],
  ['Methotrexate', /METHOTREXATE/, 'Cytotoxic · exposure risk to staff'],
  ['Tamoxifen', /TAMOXIFEN/, 'Hazardous drug · exposure risk to staff'],
  ['Capecitabine', /CAPECITABINE/, 'Cytotoxic · exposure risk to staff'],
  ['Mycophenolate', /MYCOPHENOLATE/, 'Hazardous drug · exposure risk to staff'],
  ['Tacrolimus', /TACROLIMUS/, 'Hazardous drug · narrow therapeutic index'],
];
function dncFlags(T) {
  const out = [];
  NAMED.forEach(([n, re, why]) => { if (re.test(T)) out.push({ name: n, why }); });
  FORM_RULES.forEach(([re, why]) => { if (re.test(T)) out.push({ name: null, why }); });
  return out;
}

// ── GS1 parsing ───────────────────────────────────────────────────────────
const FIXED = { '00': 18, '01': 14, '02': 14, '11': 6, '13': 6, '15': 6, '17': 6, '20': 2 };
export function parseGS1(raw) {
  const s = raw.replace(/^\](d2|C1|Q3|e0)/, '');
  const out = {}; let i = 0, guard = 0;
  while (i < s.length && guard++ < 24) {
    if (s[i] === '\x1d') { i++; continue; }
    const ai = s.substr(i, 2);
    if (FIXED[ai]) { out[ai] = s.substr(i + 2, FIXED[ai]); i += 2 + FIXED[ai]; }
    else if (['10', '21', '22', '30', '91', '92'].includes(ai)) { let j = s.indexOf('\x1d', i + 2); if (j < 0) j = s.length; out[ai] = s.slice(i + 2, j); i = j; }
    else break;
  }
  // Some readers drop the GS separators: recover "lot 17yymmdd 21serial".
  if (out['10'] && out['10'].length > 20) {
    const m = out['10'].match(/^(.*?)17(\d{6})(?:21(.+))?$/);
    if (m) { out['10'] = m[1]; out['17'] = out['17'] || m[2]; if (m[3]) out['21'] = m[3]; }
    else { const n = out['10'].match(/^(.{1,20}?)21(.{6,20})$/); if (n) { out['10'] = n[1]; out['21'] = n[2]; } }
  }
  return out;
}
function expDate(yymmdd) {
  const y = 2000 + +yymmdd.slice(0, 2), m = +yymmdd.slice(2, 4); let d = +yymmdd.slice(4, 6);
  if (!d) d = new Date(y, m, 0).getDate();
  // Month as a word (25 Feb 2028): avoids day/month order confusion.
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] || String(m);
  return { date: new Date(y, m - 1, d, 23, 59), label: `${d} ${mon} ${y}` };
}
const FMT = { DATA_MATRIX: 'DataMatrix', QR_CODE: 'QR code', EAN_13: 'Barcode (EAN-13)', EAN_8: 'Barcode (EAN-8)', UPC_A: 'Barcode (UPC-A)', UPC_E: 'Barcode (UPC-E)', CODE_128: 'Barcode (Code 128)' };

// ── Verdicts ──────────────────────────────────────────────────────────────
// Checks use plain wording: the label says the outcome, the detail says why.
// A blocked result shows only the failed checks plus `next` (what to do).
function build({ product, gtin, exp, flags = [], method, named }) {
  const isNow = !!product && product.gtin === PATIENT.gtin;
  const isLater = !!product && product.gtin === PATIENT.later.gtin;
  const isRx = isNow || isLater, L = PATIENT.later;
  const rx = isRx ? { ok: true, label: 'Prescribed', detail: `For ${PATIENT.name}` }
    : { ok: false, label: 'Not prescribed', detail: `Not on ${PATIENT.name}'s prescription list` };
  // Timing: only the medicine that is due now may be prepared.
  const timing = isNow ? { ok: true, label: 'Due now', detail: `Scheduled for ${PATIENT.due}` }
    : isLater ? { ok: false, label: 'Not due yet', detail: `Due at ${L.due}, in ${L.hours} hours` } : null;
  let crush;
  const why = product?.crush === 'no' ? product.why : flags[0]?.why;
  if (why) crush = { ok: false, label: 'Do not crush', detail: why };
  else if (product?.crush === 'ok') crush = { ok: true, label: 'Safe to crush', detail: 'Not on the do-not-crush list' };
  else crush = { ok: null, label: 'Crush check', detail: 'No do-not-crush flags found' };
  let expiry = null;
  if (exp) { const e = expDate(exp), expired = e.date < new Date(); expiry = expired ? { ok: false, label: 'Expired', detail: `Expired on ${e.label}` } : { ok: true, label: 'Not expired', detail: `Expires ${e.label}` }; }
  const checks = [rx, timing, crush, expiry].filter(Boolean);
  const ok = checks.every((c) => c.ok !== false);
  const fail = [crush, expiry, timing, rx].find((c) => c && c.ok === false);
  const title = product?.name || named || 'Unrecognised pack';
  const sub = product ? `${product.generic} · ${product.form}` : gtin ? 'Not in the demo product database' : 'Identified from printed text';
  const short = !fail ? '' : fail === crush ? 'Do not crush' : fail === expiry ? 'Expired pack' : fail === timing ? `Not due · next dose ${L.due}` : 'Not prescribed';
  const next = ok ? '' : isNow && fail === expiry ? `Use a pack of ${PATIENT.drug} that is in date.` : `Scan ${PATIENT.drug}, which is due now.`;
  return {
    ok, title, sub, checks, method, next,
    screen: ok ? ['VERIFIED', title, 'Matches prescription · crush approved'] : ['PREPARATION BLOCKED', title, short + (fail !== rx && !isRx ? ' · not prescribed' : '')],
  };
}

export function evaluateCode(text, format) {
  const clean = String(text).trim();
  const fmt = FMT[format] || 'Code';
  let gtin = null, g = {};
  if (/^\d{8,14}$/.test(clean)) gtin = clean.padStart(14, '0');
  else { g = parseGS1(clean); if (g['01']) gtin = g['01']; }
  if (!gtin) { const t = evaluateText(clean, 'Live test · ' + fmt); if (t) return t; }
  const product = gtin && PRODUCTS[gtin] ? { ...PRODUCTS[gtin], gtin } : null;
  return build({ product, gtin, exp: g['17'], method: 'Live test · ' + fmt });
}

const productFor = (gtin) => ({ ...PRODUCTS[gtin], gtin });
export function evaluateText(text, method = 'Live test · printed text') {
  const T = String(text).toUpperCase().replace(/[^A-Z0-9 \n.\-()/]/g, ' ');
  if (T.replace(/[^A-Z]/g, '').length < 4) return null;
  let product = null;
  const gm = T.match(/GTIN\.?\s*(\d{14})/);
  if (gm && PRODUCTS[gm[1]]) product = productFor(gm[1]);
  else if (/PEXAPAN|APIXABAN/.test(T)) product = productFor(GTIN.pexapan);
  else if (/ZETEX|EZETIMIBE/.test(T)) product = productFor(GTIN.zetex);
  else if (/PROSTA.?TAB/.test(T)) product = productFor(GTIN.prosta);
  const flags = product ? [] : dncFlags(T);
  const named = flags.find((f) => f.name)?.name;
  if (!product && !flags.length) return null;
  const em = T.match(/EXP(?:IRY)?\.?\s*(\d{2})[\s/.\-]*(20\d{2})/);
  return build({ product, gtin: product?.gtin, exp: em ? em[2].slice(2) + em[1] + '00' : null, flags, method, named });
}

export function notIdentified(method) {
  return {
    ok: false, title: 'Medicine not identified', sub: 'No readable code or name on the pack', method,
    checks: [{ ok: false, label: 'Not identified', detail: 'The code and name on the pack could not be read' }],
    next: 'Rescan the pack, or contact the pharmacist.',
    screen: ['PREPARATION BLOCKED', 'Not identified', 'Rescan or contact pharmacist'],
  };
}

export function simulatedVerify() {
  return build({ product: productFor(PATIENT.gtin), gtin: PATIENT.gtin, exp: '280225', method: 'Simulated' });
}

// ── Code reading ──────────────────────────────────────────────────────────
async function decodeCanvas(c, hard) {
  if ('BarcodeDetector' in window) {
    try {
      if (!detector) {
        const want = ['data_matrix', 'qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
        const have = await window.BarcodeDetector.getSupportedFormats();
        detector = new window.BarcodeDetector({ formats: want.filter((f) => have.includes(f)) });
      }
      const r = await detector.detect(c);
      if (r.length) return { text: r[0].rawValue, format: r[0].format.toUpperCase() };
    } catch (e) { /* fall through to ZXing */ }
  }
  const m = await loadZX();
  const g = c.getContext('2d', { willReadFrequently: true });
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const lum = new Uint8ClampedArray(c.width * c.height);
  for (let i = 0; i < lum.length; i++) lum[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
  const F = m.BarcodeFormat;
  const hints = new Map([[m.DecodeHintType.POSSIBLE_FORMATS, [F.DATA_MATRIX, F.QR_CODE, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128]]]);
  if (hard) hints.set(m.DecodeHintType.TRY_HARDER, true);
  for (const B of [m.HybridBinarizer, m.GlobalHistogramBinarizer]) {
    try {
      const r = new m.MultiFormatReader().decode(new m.BinaryBitmap(new B(new m.RGBLuminanceSource(lum, c.width, c.height))), hints);
      return { text: r.getText(), format: F[r.getBarcodeFormat()] };
    } catch (e) { /* not found */ }
  }
  return null;
}
// Likely code positions in a photo: dense patches with strong edges in both
// directions. ZXing only finds a DataMatrix when the image centre lies on the
// code, so each spot becomes a crop centred on it. Returns pixel boxes.
function codeSpots(img, W, H, perScale = 4, scales = [0.045, 0.065, 0.09, 0.13, 0.19]) {
  // 640 px keeps a small code's squares sharp enough to stand out from text.
  const sc = Math.min(1, 640 / Math.max(W, H)), w = Math.max(8, Math.round(W * sc)), h = Math.max(8, Math.round(H * sc));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, L = new Float32Array(w * h);
  for (let i = 0; i < L.length; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const S = w + 1, IX = new Float64Array(S * (h + 1)), IY = new Float64Array(S * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, ex = x + 1 < w ? Math.abs(L[i + 1] - L[i]) : 0, ey = y + 1 < h ? Math.abs(L[i + w] - L[i]) : 0, k = (y + 1) * S + x + 1;
    IX[k] = ex + IX[k - 1] + IX[k - S] - IX[k - S - 1]; IY[k] = ey + IY[k - 1] + IY[k - S] - IY[k - S - 1];
  }
  const box = (I, x0, y0, n) => I[(y0 + n) * S + x0 + n] - I[y0 * S + x0 + n] - I[(y0 + n) * S + x0] + I[y0 * S + x0];
  const out = [];
  for (const f of scales) {
    const n = Math.round(f * Math.max(w, h)); if (n >= Math.min(w, h)) continue;
    const pts = [];
    const st = Math.max(2, n >> 3);
    for (let y = 0; y + n <= h; y += st) for (let x = 0; x + n <= w; x += st) pts.push([Math.min(box(IX, x, y, n), box(IY, x, y, n)), x + n / 2, y + n / 2]);
    pts.sort((a, b) => b[0] - a[0]);
    const picked = [];
    for (const p of pts) { if (picked.length >= perScale) break; if (picked.every((q) => Math.hypot(q[1] - p[1], q[2] - p[2]) > n)) picked.push(p); }
    picked.forEach(([, cx, cy]) => { const side = (n * 1.8) / sc; out.push([cx / sc - side / 2, cy / sc - side / 2, side, side]); });
  }
  return out;
}
// Small crops are enlarged (up to 3×, to ~360 px): ZXing reads small, low-resolution codes far better that way.
const cropCanvas = (src, x, y, w, h, max, out = document.createElement('canvas')) => {
  const m = Math.max(w, h), s = m < 360 ? Math.min(3, 360 / m) : Math.min(1, max / m);
  out.width = Math.max(1, Math.round(w * s)); out.height = Math.max(1, Math.round(h * s));
  const g = out.getContext('2d'); g.imageSmoothingQuality = 'high'; g.fillStyle = '#fff'; g.fillRect(0, 0, out.width, out.height);
  g.drawImage(src, x, y, w, h, 0, 0, out.width, out.height);
  return out;
};
// Live scan helper: decode crops centred on code-like patches of a frame.
async function decodeSpots(c) {
  const sub = document.createElement('canvas');
  for (const [x, y, w, h] of codeSpots(c, c.width, c.height, 2, [0.08, 0.11, 0.16, 0.22])) {
    const r = await decodeCanvas(cropCanvas(c, x, y, w, h, 600, sub), false); if (r) return r;
  }
  return null;
}
export async function decodeImageHard(img) {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const regions = [[0, 0, W, H]];
  try { regions.push(...codeSpots(img, W, H)); } catch (e) { /* fall back to the fixed grid */ }
  regions.push([W * 0.2, H * 0.2, W * 0.6, H * 0.6]);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) regions.push([W * x * 0.25, H * y * 0.25, W * 0.5, H * 0.5]);
  const c = document.createElement('canvas');
  for (const [x, y, w, h] of regions) {
    const r = await decodeCanvas(cropCanvas(img, x, y, w, h, 1600, c), true); if (r) return r;
  }
  return null;
}
async function readText(src) {
  const T = await loadTess();
  const { data } = await T.recognize(src, 'eng');
  return data.text || '';
}

// ── Residue spot detection ────────────────────────────────────────────────
// Finds the cup's flat inner bottom: a dark disc (black paper through the
// frosted floor) ringed by the brighter cup wall. Every edge votes for a centre
// along its gradient (towards the darker side), so all the cup's concentric
// circles agree on one centre; the radius is where the angular-median
// brightness steps up most consistently. L is an M×M luminance image.
// Returns { x, y, r } in M px, or null.
const FLOOR_RING_MIN = 0.95; // real cup photos: 0.99–1.0; box photos: ≤ 0.9
export function findFloor(L, M) {
  const gx = new Float32Array(M * M), gy = new Float32Array(M * M), mag = new Float32Array(M * M);
  for (let y = 1; y < M - 1; y++) for (let x = 1; x < M - 1; x++) {
    const i = y * M + x, a = L[i - M - 1], b = L[i - M], c = L[i - M + 1], d = L[i - 1], e = L[i + 1], f = L[i + M - 1], g = L[i + M], h = L[i + M + 1];
    gx[i] = c + 2 * e + h - a - 2 * d - f; gy[i] = f + 2 * g + h - a - 2 * b - c; mag[i] = Math.hypot(gx[i], gy[i]);
  }
  const sorted = Float32Array.from(mag).sort(), et = Math.max(40, sorted[Math.floor(sorted.length * 0.88)]);
  const rmin = Math.round(M * 0.07), rmax = Math.round(M * 0.46), acc = new Float32Array(M * M);
  for (let y = 1; y < M - 1; y++) for (let x = 1; x < M - 1; x++) {
    const i = y * M + x; if (mag[i] < et) continue;
    const ux = gx[i] / mag[i], uy = gy[i] / mag[i];
    for (let r = rmin; r <= rmax; r += 1) {
      const X = Math.round(x - ux * r), Y = Math.round(y - uy * r);
      if (X < 0 || Y < 0 || X >= M || Y >= M) break;
      acc[Y * M + X] += 1;
    }
  }
  // Best centre within the middle 70% of the frame (3×3 smoothed).
  let best = -1, bx = M / 2, by = M / 2; const m0 = Math.round(M * 0.15), m1 = M - m0;
  for (let y = m0; y < m1; y++) for (let x = m0; x < m1; x++) {
    let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += acc[(y + dy) * M + x + dx];
    if (s > best) { best = s; bx = x; by = y; }
  }
  // Angular-median brightness profile around that centre.
  const A = 72, prof = new Float32Array(rmax + 8), ring = new Float32Array(A);
  for (let r = 0; r < prof.length; r++) {
    let n = 0;
    for (let k = 0; k < A; k++) {
      const X = Math.round(bx + r * Math.cos(k * 2 * Math.PI / A)), Y = Math.round(by + r * Math.sin(k * 2 * Math.PI / A));
      if (X >= 0 && Y >= 0 && X < M && Y < M) ring[n++] = L[Y * M + X];
    }
    prof[r] = n ? ring.subarray(0, n).sort()[n >> 1] : 255;
  }
  // Radius: strongest outward step (bright outside, dark inside) beyond the centre dimple.
  let br = 0, bs = 0;
  for (let r = rmin; r <= rmax; r++) {
    const step = prof[Math.min(prof.length - 1, r + 3)] - prof[Math.max(0, r - 3)];
    if (step > bs) { bs = step; br = r; }
  }
  // A real floor edge steps from dark to bright nearly all the way round (a partial arc, e.g. on a box, does not).
  // Angles whose edge falls outside the picture are not counted either way.
  let around = 0, seenA = 0;
  for (let k = 0; k < A; k++) {
    const cs = Math.cos(k * 2 * Math.PI / A), sn = Math.sin(k * 2 * Math.PI / A), at = (r) => {
      const X = Math.round(bx + r * cs), Y = Math.round(by + r * sn); return X >= 0 && Y >= 0 && X < M && Y < M ? L[Y * M + X] : null;
    };
    if (at(br + 7) === null) continue;
    seenA++;
    let st = -1e9; for (let r = br - 3; r <= br + 3; r++) st = Math.max(st, at(r + 4) - at(r - 4));
    if (st > 8) around++;
  }
  const ringFrac = seenA ? around / seenA : 0;
  if (bs < 12 || best < 20 || seenA < A * 0.75 || ringFrac < FLOOR_RING_MIN) return null;
  return { x: bx, y: by, r: br, step: bs, votes: best, ringFrac };
}

// Residue check for the demo cup (frosted plastic on black paper). Only the
// flat inner bottom is analysed: the wall's embossed text, ribs and ridges and
// water drops on the outer part would otherwise read as residue. Inside it, the
// centre dimple and a thin band at the edge are skipped, and only pixels
// brighter than the surrounding floor count (powder is white; shadows are dark).
export const RESIDUE_TUNING = { edge: 0.9, dimple: 0.36, local: 20, localK: 4.5, global: 38, globalK: 5, minBlob: 4, minSpots: 6, minCoverage: 0.02 };
export function analyzeResidue(src, sx, sy, side) {
  const T = RESIDUE_TUNING;
  const lum = (g, n) => { const d = g.getImageData(0, 0, n, n).data, L = new Float32Array(n * n); for (let i = 0; i < L.length; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; return L; };
  // 1. Find the inner bottom in a small copy of the region.
  const M = 240, c0 = document.createElement('canvas'); c0.width = c0.height = M;
  const g0 = c0.getContext('2d', { willReadFrequently: true }); g0.drawImage(src, sx, sy, side, side, 0, 0, M, M);
  const fl = findFloor(lum(g0, M), M);
  let fx = sx + side / 2, fy = sy + side / 2, fr = side * 0.43;
  if (fl) { const k = side / M; fx = sx + fl.x * k; fy = sy + fl.y * k; fr = fl.r * k; }
  // 2. Re-crop so the floor circle sits at 0.43·N (the overlay's ring).
  const N = 384, cs = (2 * fr) / 0.86, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
  g.drawImage(src, fx - cs / 2, fy - cs / 2, cs, cs, 0, 0, N, N);
  const L = lum(g, N), C = N / 2, RF = N * 0.43, r1 = RF * (fl ? T.edge : 1), r0 = fl ? RF * T.dimple : 0;
  const mask = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const d2 = (x - C) ** 2 + (y - C) ** 2; if (d2 < r1 * r1 && d2 >= r0 * r0) mask[y * N + x] = 1; }
  // 3. Local floor level: mean of floor pixels only in a box around each pixel.
  const S = N + 1, IL = new Float64Array(S * S), IC = new Float64Array(S * S);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, k = (y + 1) * S + x + 1, m = mask[i];
    IL[k] = (m ? L[i] : 0) + IL[k - 1] + IL[k - S] - IL[k - S - 1]; IC[k] = m + IC[k - 1] + IC[k - S] - IC[k - S - 1];
  }
  const R = Math.round(N * 0.05), boxMean = (x, y) => {
    const x0 = Math.max(0, x - R), y0 = Math.max(0, y - R), x1 = Math.min(N, x + R + 1), y1 = Math.min(N, y + R + 1);
    const n = IC[y1 * S + x1] - IC[y0 * S + x1] - IC[y1 * S + x0] + IC[y0 * S + x0];
    return n ? (IL[y1 * S + x1] - IL[y0 * S + x1] - IL[y1 * S + x0] + IL[y0 * S + x0]) / n : 0;
  };
  const D = new Float32Array(N * N), dv = [], lv = [];
  for (let i = 0; i < N * N; i++) if (mask[i]) { D[i] = L[i] - boxMean(i % N, (i / N) | 0); dv.push(Math.abs(D[i])); lv.push(L[i]); }
  const med = (a) => { const s = Float32Array.from(a).sort(); return s[s.length >> 1] || 0; };
  const madD = med(dv), Lg = med(lv), madL = med(lv.map((v) => Math.abs(v - Lg)));
  const thr = Math.max(T.local, T.localK * madD), gthr = Math.max(T.global, T.globalK * madL);
  const spot = new Uint8Array(N * N);
  for (let i = 0; i < spot.length; i++) if (mask[i] && (D[i] > thr || L[i] - Lg > gthr)) spot[i] = 1;
  // 4. Group into blobs; drop specks of noise and thin streaks (water lines, reflections, edge arcs).
  const seen = new Uint8Array(N * N), keep = new Uint8Array(N * N), blobs = []; let total = 0, edges = 0;
  for (let i = 0; i < spot.length; i++) {
    if (!spot[i] || seen[i]) continue;
    const q = [i], pts = []; seen[i] = 1; let sxm = 0, sym = 0, x0 = N, x1 = 0, y0 = N, y1 = 0;
    while (q.length) {
      const j = q.pop(), x = j % N, y = (j / N) | 0; pts.push(j); sxm += x; sym += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy, k = Y * N + X; if (X >= 0 && Y >= 0 && X < N && Y < N && spot[k] && !seen[k]) { seen[k] = 1; q.push(k); } }
    }
    const n = pts.length; if (n < T.minBlob) continue;
    const w = x1 - x0 + 1, h = y1 - y0 + 1, fill = n / (w * h), aspect = Math.max(w, h) / Math.min(w, h);
    // Thin streaks and arcs (water lines, reflections), and small line-shaped marks moulded into the cup.
    if ((aspect >= 3.5 && fill < 0.45) || (Math.max(w, h) >= N * 0.2 && fill < 0.15) || (aspect >= 2.2 && n < 120)) { edges++; continue; }
    blobs.push({ x: sxm / n, y: sym / n, n }); total += n; pts.forEach((j) => { keep[j] = 1; });
  }
  const area = lv.length || 1;
  blobs.sort((a, b) => b.n - a.n);
  // Residue = several spots, or one clump. Below that it is cup texture (moulded marks, glints) and is not shown.
  const residue = blobs.length >= T.minSpots || total / area >= T.minCoverage;
  if (!residue) { blobs.length = 0; keep.fill(0); total = 0; }
  const coverage = total / area;
  const quality = !fl ? 'Could not find the inner bottom of the cup. Hold the phone straight above the cup with the small inner circle inside the guide.'
    : Lg > 170 ? 'The cup bottom looks very bright. Put black paper under the cup for a clearer result.' : '';
  return { residue, coverage, spots: blobs.length, edges, blobs: blobs.slice(0, 60), crop: c, spot: keep, N, quality, floor: !!fl, debug: { thr, gthr, Lg, total } };
}
export function drawResidue(res, out) {
  const N = res.N, S = out.width, k = S / N, g = out.getContext('2d');
  g.clearRect(0, 0, S, S); g.drawImage(res.crop, 0, 0, S, S);
  const ov = g.getImageData(0, 0, S, S), d = ov.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = ((y / k) | 0) * N + ((x / k) | 0), o = (y * S + x) * 4;
    if (res.spot[i]) { d[o] = 255; d[o + 1] = 40; d[o + 2] = 30; }
    else if ((x - S / 2) ** 2 + (y - S / 2) ** 2 > (S * 0.43) ** 2) { d[o] *= 0.35; d[o + 1] *= 0.35; d[o + 2] *= 0.35; }
  }
  g.putImageData(ov, 0, 0);
  g.lineWidth = Math.max(2, S / 160); g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.43, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = '#FF3B2E';
  res.blobs.forEach((b) => { g.beginPath(); g.arc(b.x * k, b.y * k, (Math.sqrt(b.n / Math.PI) + 6) * k, 0, Math.PI * 2); g.stroke(); });
}

// ── Camera overlay ────────────────────────────────────────────────────────
const loadImg = (file) => new Promise((res, rej) => {
  const u = URL.createObjectURL(file); const i = new Image();
  i.onload = () => { URL.revokeObjectURL(u); res(i); };
  i.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Could not open this image')); };
  i.src = u;
});

export function openCamera(kind) {
  const verify = kind === 'verify';
  return new Promise((resolve) => {
    const el = document.createElement('div'); el.className = 'cam';
    el.innerHTML = `<video playsinline muted autoplay></video>
      <div class="cam-shade"><div class="cam-guide ${verify ? 'rect' : 'circle'}"></div></div>
      <div class="cam-top"><div><div class="mono">${verify ? '02 · Verify' : '07 · Check residue'}</div><div class="cam-title">${verify ? 'Scan the medicine pack' : 'Photograph the empty cup'}</div></div><button class="btn ghost sm" data-a="close">Close</button></div>
      <div class="cam-bot"><p class="cam-hint"></p><div class="cam-row"></div></div>
      <input type="file" accept="image/*" hidden>`;
    document.body.appendChild(el);
    const video = el.querySelector('video'), guide = el.querySelector('.cam-guide'), hint = el.querySelector('.cam-hint'), row = el.querySelector('.cam-row'), file = el.querySelector('input');
    let stream = null, stopped = false, t0 = performance.now(), busy = false;
    const finish = (v) => { stopped = true; stream?.getTracks().forEach((t) => t.stop()); el.remove(); resolve(v); };
    el.querySelector('[data-a=close]').onclick = () => finish(null);
    const setRow = (btns) => { row.innerHTML = ''; btns.forEach(([label, cls, fn]) => { const b = document.createElement('button'); b.className = 'btn ' + cls; b.innerHTML = label; b.onclick = fn; row.appendChild(b); }); };
    const say = (t) => { hint.textContent = t; };
    const pick = () => file.click();

    const guideRect = (k = 1) => {
      const vw = video.videoWidth, vh = video.videoHeight, vr = video.getBoundingClientRect();
      const s = Math.max(vr.width / vw, vr.height / vh), dx = (vr.width - vw * s) / 2, dy = (vr.height - vh * s) / 2;
      const gr = guide.getBoundingClientRect();
      let w = gr.width / s * k, h = gr.height / s * k;
      const cx = (gr.left - vr.left - dx) / s + gr.width / s / 2, cy = (gr.top - vr.top - dy) / s + gr.height / s / 2;
      const x = Math.max(0, cx - w / 2), y = Math.max(0, cy - h / 2);
      return { x, y, w: Math.min(vw - x, w), h: Math.min(vh - y, h) };
    };

    const showResidue = (src, sx, sy, side) => {
      // If the inner bottom isn't found in this crop, try a slightly tighter and a slightly looser crop
      // around the same centre. The floor search can miss at one framing and succeed at another, so a retry
      // only counts when both other crops find the floor (one lucky match on a non-cup photo is not enough).
      const W = src.videoWidth || src.naturalWidth || src.width, H = src.videoHeight || src.naturalHeight || src.height;
      const cx = sx + side / 2, cy = sy + side / 2;
      const at = (f) => {
        const s = Math.min(side * f, W, H);
        const x = Math.min(Math.max(0, cx - s / 2), W - s), y = Math.min(Math.max(0, cy - s / 2), H - s);
        return analyzeResidue(src, x, y, s);
      };
      let res = at(1);
      if (!res.floor) {
        const tight = at(0.89), loose = at(1.11);
        if (tight.floor && loose.floor) res = tight;
      }
      const retake = () => { el.querySelector('.cam-result')?.remove(); live(); };
      if (!res.floor) {
        // Without the inner bottom there is nothing reliable to judge: ask for another photo instead of guessing.
        const box = document.createElement('div'); box.className = 'cam-result';
        box.innerHTML = `<div class="cam-verdict">Cup not found</div><p class="cam-hint">${res.quality}</p>`;
        el.appendChild(box); say('Try again with the whole inner circle of the cup in view.');
        return setRow([['Retake', '', retake], ['Upload photo', 'ghost', pick]]);
      }
      const out = document.createElement('canvas'); out.width = out.height = 640; drawResidue(res, out);
      const ok = !res.residue;
      const box = document.createElement('div'); box.className = 'cam-result';
      box.innerHTML = `<div class="cam-verdict ${ok ? 'ok' : 'bad'}"><i></i>${ok ? 'No visible residue' : 'Residue detected'}</div>
        <div class="mono">${(res.coverage * 100).toFixed(2)}% of cup area · ${res.spots} spot${res.spots === 1 ? '' : 's'}</div>${res.quality ? `<p class="cam-hint">${res.quality}</p>` : ''}`;
      box.prepend(out);
      el.appendChild(box);
      say(ok ? 'Nothing stands out from the cup surface.' : 'Red marks show what stands out from the cup surface.');
      const use = () => finish({ type: 'residue', ok, coverage: res.coverage, spots: res.spots, img: out.toDataURL('image/jpeg', 0.8) });
      // Residue found: no Retake, so the walkthrough always goes on to "Flush and re-check".
      setRow(ok ? [['Use this result', '', use], ['Retake', 'ghost', retake]]
        : [['Continue', '', use]]);
    };

    const ocrFrom = async (src) => {
      busy = true; say('Reading printed text… (first use downloads the text reader)'); setRow([]);
      try {
        const r = evaluateText(await readText(src));
        if (r) return finish({ type: 'code', result: r });
        say('Could not identify the pack. Scan again with the code in view, or record it as not identified.');
        busy = false; live(); return setRow([['Scan again', '', () => live()], ['Not identified', 'ghost', () => finish({ type: 'code', result: notIdentified('Live test · camera') })]]);
      } catch (e) { say('Text reader unavailable. Check the connection and try again.'); }
      busy = false; live();
    };

    file.onchange = async () => {
      const f = file.files[0]; file.value = ''; if (!f) return;
      let img;
      try { img = await loadImg(f); } catch (e) { say('Could not open that photo. Try a JPEG or PNG image.'); return; }
      const W = img.naturalWidth, H = img.naturalHeight;
      if (!verify) { const side = Math.min(W, H) * 0.9; el.querySelector('.cam-result')?.remove(); return showResidue(img, (W - side) / 2, (H - side) / 2, side); }
      busy = true; say('Looking for a code in the photo…'); setRow([]);
      let hit = null;
      try { hit = await decodeImageHard(img); } catch (e) { /* code reader unavailable: fall back to text */ }
      if (stopped) return;
      if (hit) return finish({ type: 'code', result: evaluateCode(hit.text, hit.format) });
      const c = document.createElement('canvas'), s = Math.min(1, 2000 / Math.max(W, H)); c.width = W * s; c.height = H * s;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      ocrFrom(c);
    };

    const live = () => {
      if (!stream) {
        say('Camera not available here. It needs the secure (https) link and camera permission. You can still upload a photo.');
        setRow([['Upload photo', '', pick]]); return;
      }
      if (verify) {
        say('Hold the code inside the frame, about 10–15 cm from the camera.');
        setRow([['Upload photo', 'ghost', pick]]);
        t0 = performance.now(); busy = false;
      } else {
        say('Place the cup on black paper. Hold the phone straight above it and fit the small inner circle of the cup inside the guide.');
        setRow([['<span class="shutter"></span>Take photo', '', () => {
          if (!video.videoWidth) return say('The camera is still starting. Try again in a moment.');
          const r = guideRect(1.35); const side = Math.min(r.w, r.h); // a margin so the inner bottom's edge is fully in view
          showResidue(video, r.x + (r.w - side) / 2, r.y + (r.h - side) / 2, side);
        }], ['Upload photo', 'ghost', pick]]);
      }
    };

    const work = document.createElement('canvas');
    let textOffered = false, frame = 0;
    const scan = async () => {
      if (stopped) return;
      if (!busy && video.readyState >= 2 && video.videoWidth) {
        // Even frames decode the whole guide region (1.3× and 0.95× in turn). Odd frames decode
        // crops centred on code-like patches inside it: the iPhone decoder (ZXing) only finds a
        // DataMatrix under the crop centre, and this lets the code sit anywhere in the frame.
        const f = frame++, spots = f % 2 === 1, k = spots || f % 4 === 0 ? 1.3 : 0.95;
        const r = guideRect(k), s = Math.min(1, (k > 1 ? 900 : 1200) / r.w);
        work.width = Math.round(r.w * s); work.height = Math.round(r.h * s);
        work.getContext('2d', { willReadFrequently: true }).drawImage(video, r.x, r.y, r.w, r.h, 0, 0, work.width, work.height);
        let hit = null; try { hit = spots ? await decodeSpots(work) : await decodeCanvas(work, false); } catch (e) { /* keep scanning */ }
        if (hit && !stopped) { navigator.vibrate?.(60); return finish({ type: 'code', result: evaluateCode(hit.text, hit.format) }); }
        if (!textOffered && performance.now() - t0 > 6000) {
          textOffered = true;
          setRow([['Read printed text instead', '', () => {
            const c = document.createElement('canvas'), s2 = Math.min(1, 1600 / video.videoWidth);
            c.width = video.videoWidth * s2; c.height = video.videoHeight * s2; c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
            textOffered = false; ocrFrom(c);
          }], ['Upload photo', 'ghost', pick]]);
          say('No code found yet. Move closer, or read the printed name instead.');
        }
      }
      setTimeout(scan, 140);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = stream; await video.play().catch(() => {});
        const tr = stream.getVideoTracks()[0];
        tr.applyConstraints?.({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
      } catch (e) { stream = null; el.classList.add('nocam'); }
      live();
      if (verify && stream) { loadZX(); scan(); }
    })();
  });
}
