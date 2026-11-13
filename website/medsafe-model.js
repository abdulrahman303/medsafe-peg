// MedSafe PEG — concept device model. Meters, y-up, base on y=0.
// Shared by the 3D viewer and the process film.

// Canvas roundRect is missing before Safari 16 (iOS 15); the display drawing needs it.
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(Array.isArray(r) ? r[0] : r || 0, w / 2, h / 2);
    this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath();
  };
}

export const COLORS = {
  shell: 0xECEAE5, graphite: 0x232427, accent: 0xFF5B2E, water: 0x86BFE3,
  slurry: 0xEDE3D6, steel: 0xB8BBBF, tablet: 0xF4CDB8, tubing: 0xF2F2F0,
};
export const DIM = {
  TOP: 0.136, CX: -0.065, CZ: -0.022, FLOOR: 0.164, RIM: 0.26,
  TX: 0.04, TZ: -0.048, SX: 0.112, SZ: -0.004,
  SLOPE_Y: 0.0917, SLOPE_Z: 0.0759, SLOPE_ROT: -0.5743,
  SCREEN_W: 0.148, SCREEN_H: 0.066, SCREEN_X: -0.045, SCANNER_X: 0.095,
  LIQ_MAX: 0.022,
};

function rrShape(THREE, w, h, r) {
  const s = new THREE.Shape(); const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function roundedPoly(THREE, pts, r) {
  const s = new THREE.Shape(); const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const d1 = Math.hypot(p0[0] - p1[0], p0[1] - p1[1]), d2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const a = [p1[0] + (p0[0] - p1[0]) / d1 * r, p1[1] + (p0[1] - p1[1]) / d1 * r];
    const b = [p1[0] + (p2[0] - p1[0]) / d2 * r, p1[1] + (p2[1] - p1[1]) / d2 * r];
    if (i === 0) s.moveTo(a[0], a[1]); else s.lineTo(a[0], a[1]);
    s.quadraticCurveTo(p1[0], p1[1], b[0], b[1]);
  }
  s.closePath();
  return s;
}
// Rounded box standing on y=0, footprint w (x) × d (z), height h.
function vBox(THREE, w, d, h, r, bevel = 0.002) {
  const geo = new THREE.ExtrudeGeometry(rrShape(THREE, w - 2 * bevel, d - 2 * bevel, r), {
    depth: Math.max(0.0001, h - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 3, curveSegments: 12,
  });
  geo.rotateX(-Math.PI / 2); geo.translate(0, bevel, 0);
  return geo;
}
// Flat rounded plate facing +z, thickness t.
function plate(THREE, w, h, r, t) {
  const geo = new THREE.ExtrudeGeometry(rrShape(THREE, w, h, r), { depth: t, bevelEnabled: false, curveSegments: 10 });
  return geo;
}

export function makeScreenCanvas() {
  const c = document.createElement('canvas'); c.width = 1120; c.height = 500; return c;
}

const SCREEN_COPY = {
  idle: ['NEXT DOSE', '08:00', 'Amlodipine 5 mg · 1 tablet'],
  remind: ['DOSE DUE · 08:00', 'Amlodipine 5 mg', '1 tablet · via PEG tube'],
  scan: ['02 VERIFY', 'Scan the package', 'Hold the barcode to the scanner'],
  blocked: ['PREPARATION BLOCKED', 'Extended-release', 'Do not crush · pharmacist review required'],
  verified: ['VERIFIED', 'Matches prescription', 'Crushing approved by pharmacist'],
  load: ['03 LOAD', 'Place 1 tablet', 'Open lid · drop tablet into the cup'],
  loaded: ['03 LOAD', 'Lid closed', 'Ready to crush'],
  crush: ['03 CRUSH', 'Crushing', 'Grinding pocket · lid locked'],
  water: ['04 ADD WATER', '', 'Protocol volume 20.0 mL'],
  mix: ['05 MIX', 'Mixing', 'Until uniform'],
  fill: ['06 FILL SYRINGE', 'Filling syringe', 'ENFit syringe · docked'],
  residue: ['07 CHECK RESIDUE', 'Inspecting chamber', 'Camera and LED ring'],
  residue_ok: ['07 CHECK RESIDUE', 'Within test limit', 'No visible residue'],
  remove: ['08 DOCUMENT', 'Syringe ready', 'Give dose · flush tube as instructed'],
  confirm: ['08 DOCUMENT', 'Was the dose given?', ''],
  logged: ['LOGGED', '08:06 · Given', 'Confirmed by caregiver · next dose 14:00'],
};

export function drawScreen(canvas, st = { mode: 'idle' }) {
  const ctx = canvas.getContext('2d'); const W = canvas.width, H = canvas.height;
  const S = "'Geist','Helvetica Neue',Helvetica,Arial,sans-serif", M = "'Geist Mono',ui-monospace,Menlo,monospace";
  const ACC = '#FF5B2E', pad = 64; const mode = st.mode || 'idle';
  const [lab, title0, sub] = st.lines || SCREEN_COPY[mode] || SCREEN_COPY.idle;
  const v = st.v || 0;
  const title = !st.lines && mode === 'water' ? v.toFixed(1) + ' mL' : title0;
  const alert = st.alert ?? (mode === 'blocked' || mode === 'remind');
  ctx.fillStyle = '#0C0D0E'; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  ctx.font = `500 28px ${S}`; ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.textAlign = 'left';
  ctx.fillText('MedSafe', pad, 74);
  ctx.textAlign = 'right'; ctx.font = `400 28px ${M}`; ctx.fillText(st.clock || '08:00', W - pad, 74);
  ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(pad, 100, W - pad * 2, 2);
  ctx.textAlign = 'left';
  let lx = pad;
  if (alert) { ctx.fillStyle = ACC; ctx.beginPath(); ctx.arc(pad + 9, 163, 9, 0, Math.PI * 2); ctx.fill(); lx += 32; }
  ctx.font = `500 28px ${M}`; ctx.fillStyle = alert ? ACC : 'rgba(255,255,255,0.58)';
  ctx.fillText(lab, lx, 173);
  let fs = 82; ctx.font = `500 ${fs}px ${S}`;
  while (ctx.measureText(title).width > W - pad * 2 && fs > 40) { fs -= 2; ctx.font = `500 ${fs}px ${S}`; }
  ctx.fillStyle = '#FFFFFF'; ctx.fillText(title, pad, 272);
  ctx.font = `400 32px ${S}`; ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillText(sub, pad, 332);
  const by = 392;
  if (mode === 'remind') {
    ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.roundRect(pad, by, 380, 68, 34); ctx.fill();
    ctx.fillStyle = '#0C0D0E'; ctx.font = `500 30px ${S}`; ctx.fillText('Start preparation', pad + 40, by + 45);
  } else if (mode === 'confirm') {
    const pr = st.press || 0;
    ctx.fillStyle = pr > 0 ? ACC : '#FFFFFF'; ctx.beginPath(); ctx.roundRect(pad, by - 70, 300, 76, 38); ctx.fill();
    ctx.fillStyle = pr > 0 ? '#FFFFFF' : '#0C0D0E'; ctx.font = `500 32px ${S}`; ctx.fillText('Confirm', pad + 92, by - 20);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(pad + 324, by - 70, 260, 76, 38); ctx.stroke();
    ctx.fillStyle = '#FFFFFF'; ctx.fillText('Not yet', pad + 400, by - 20);
  } else if (mode === 'residue_ok') {
    ctx.font = `400 26px ${M}`; ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillText('NOT A FULL-DOSE CONFIRMATION', pad, by + 46);
  } else if (st.p != null || mode === 'blocked') {
    const p = mode === 'blocked' ? 1 : Math.max(0, Math.min(1, st.p));
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.beginPath(); ctx.roundRect(pad, by + 30, W - pad * 2, 8, 4); ctx.fill();
    if (p > 0) { ctx.fillStyle = mode === 'blocked' ? ACC : '#FFFFFF'; ctx.beginPath(); ctx.roundRect(pad, by + 30, Math.max(8, (W - pad * 2) * p), 8, 4); ctx.fill(); }
  }
}

export function drawPack(canvas, variant) {
  const ctx = canvas.getContext('2d'); const W = canvas.width, H = canvas.height;
  const S = "'Geist','Helvetica Neue',Helvetica,Arial,sans-serif", M = "'Geist Mono',ui-monospace,Menlo,monospace";
  const er = variant === 'er';
  ctx.fillStyle = '#FBFAF7'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = er ? '#3A3B3F' : '#1B1C1E'; ctx.fillRect(0, 0, 26, H);
  ctx.fillStyle = '#141414'; ctx.textAlign = 'left';
  ctx.font = `600 64px ${S}`; ctx.fillText(er ? 'Nifedipine' : 'Amlodipine', 64, 120);
  ctx.font = `400 38px ${S}`; ctx.fillStyle = '#555'; ctx.fillText(er ? '30 mg · extended-release' : '5 mg · tablets', 64, 176);
  if (er) {
    ctx.fillStyle = '#FF5B2E'; ctx.beginPath(); ctx.roundRect(64, 236, 108, 56, 8); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `600 34px ${M}`; ctx.fillText('ER', 92, 276);
  }
  ctx.fillStyle = '#141414';
  let x = er ? 210 : 64; const seed = er ? 7 : 3;
  for (let i = 0; i < 46; i++) { const w = 2 + ((i * seed * 13) % 5); ctx.fillRect(x, 238, w, 54); x += w + 3 + ((i * seed) % 3); }
  ctx.font = `400 22px ${M}`; ctx.fillStyle = '#777'; ctx.fillText('DEMO PACK · NOT A REAL PRODUCT', 64, 340);
}

export function makeEnv(THREE, renderer) {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), new THREE.MeshBasicMaterial({ color: 0x7d7b78, side: THREE.BackSide })));
  const panel = (w, h, pos, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(i, i, i), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); s.add(m);
  };
  panel(5, 3, [0.5, 5, 2.5], 7); panel(2.5, 5, [-5, 1.5, 1.5], 3.2); panel(2.5, 5, [5, 1.5, -1.5], 2.6); panel(8, 1.2, [0, 0.8, -5.5], 1.6);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.035).texture; pm.dispose();
  return tex;
}

export function buildMedSafe(THREE, opts = {}) {
  const film = !!opts.film;
  const { TOP, CX, CZ, FLOOR, RIM, TX, TZ, SX, SZ } = DIM;
  const root = new THREE.Group(); root.name = 'MedSafe_PEG';
  const P = {};
  const mesh = (name, geo, mat, parent = root) => { const o = new THREE.Mesh(geo, mat); o.name = name; parent.add(o); P[name] = o; return o; };
  const group = (name, parent = root) => { const g = new THREE.Group(); g.name = name; parent.add(g); P[name] = g; return g; };

  const M = {
    shell: new THREE.MeshStandardMaterial({ name: 'shell_white', color: COLORS.shell, roughness: 0.52, metalness: 0 }),
    graphite: new THREE.MeshStandardMaterial({ name: 'graphite', color: COLORS.graphite, roughness: 0.42, metalness: 0.15 }),
    steel: new THREE.MeshStandardMaterial({ name: 'steel', color: COLORS.steel, roughness: 0.28, metalness: 0.35, flatShading: true }),
    accent: new THREE.MeshStandardMaterial({ name: 'enfit_accent', color: COLORS.accent, roughness: 0.45 }),
    glass: new THREE.MeshStandardMaterial({ name: 'clear_polymer', color: 0xE4ECEF, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    tubing: new THREE.MeshStandardMaterial({ name: 'tubing', color: COLORS.tubing, roughness: 0.25, transparent: true, opacity: 0.42, depthWrite: false }),
    water: new THREE.MeshStandardMaterial({ name: 'water', color: COLORS.water, roughness: 0.1, transparent: true, opacity: 0.72 }),
    slurry: new THREE.MeshStandardMaterial({ name: 'preparation', color: COLORS.water, roughness: 0.25, transparent: true, opacity: 0.7 }),
    syrFluid: new THREE.MeshStandardMaterial({ name: 'syringe_fluid', color: COLORS.slurry, roughness: 0.25, transparent: true, opacity: 0.9 }),
    powder: new THREE.MeshStandardMaterial({ name: 'powder', color: 0xF4F1EA, roughness: 0.95 }),
    tablet: new THREE.MeshStandardMaterial({ name: 'tablet', color: COLORS.tablet, roughness: 0.7 }),
    status: new THREE.MeshStandardMaterial({ name: 'status_light', color: COLORS.accent, emissive: COLORS.accent, emissiveIntensity: 0.6, roughness: 0.4 }),
    led: new THREE.MeshStandardMaterial({ name: 'led_ring', color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.15, roughness: 0.3 }),
    lens: new THREE.MeshStandardMaterial({ name: 'lens', color: 0x0a0b0c, roughness: 0.05, metalness: 0.2 }),
  };
  const canvas = opts.screenCanvas || makeScreenCanvas();
  const screenTex = new THREE.CanvasTexture(canvas); screenTex.colorSpace = THREE.SRGBColorSpace; screenTex.anisotropy = 8;
  M.screen = new THREE.MeshBasicMaterial({ name: 'display', map: screenTex, toneMapped: false });

  // Housing — side profile (z,y) extruded across x, with a sloped control face.
  const Y0 = 0.008;
  const prof = roundedPoly(THREE, [[-0.09, 0], [0.10, 0], [0.10, 0.035], [0.045, 0.12], [-0.09, 0.12]], 0.014);
  const bodyGeo = new THREE.ExtrudeGeometry(prof, { depth: 0.288, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004, bevelSegments: 6, curveSegments: 20 });
  bodyGeo.rotateY(-Math.PI / 2); bodyGeo.translate(0.144, 0.004 + Y0, 0);
  mesh('housing', bodyGeo, M.shell);
  const plinth = mesh('plinth', vBox(THREE, 0.284, 0.184, Y0 + 0.004, 0.03, 0.002), M.graphite); plinth.position.z = 0.005;

  // Control face: display + barcode scanner.
  const slope = group('control_face');
  slope.position.set(0, DIM.SLOPE_Y, DIM.SLOPE_Z); slope.rotation.x = DIM.SLOPE_ROT;
  const bez = mesh('display_bezel', plate(THREE, 0.162, 0.078, 0.008, 0.0016), M.lens, slope); bez.position.set(DIM.SCREEN_X, 0, 0.0002);
  const scr = mesh('display', new THREE.PlaneGeometry(DIM.SCREEN_W, DIM.SCREEN_H), M.screen, slope); scr.position.set(DIM.SCREEN_X, 0, 0.0021);
  const scn = mesh('scanner_housing', plate(THREE, 0.058, 0.036, 0.007, 0.0016), M.graphite, slope); scn.position.set(DIM.SCANNER_X, 0, 0.0002);
  const ap = mesh('scanner_window', plate(THREE, 0.044, 0.014, 0.004, 0.0006), M.lens, slope); ap.position.set(DIM.SCANNER_X, 0, 0.0018);
  const scanLed = new THREE.MeshStandardMaterial({ name: 'scanner_led', color: COLORS.accent, emissive: COLORS.accent, emissiveIntensity: 0.3 });
  const sl = mesh('scanner_led', new THREE.PlaneGeometry(0.034, 0.0012), scanLed, slope); sl.position.set(DIM.SCANNER_X, 0, 0.0026);
  const pwr = mesh('power_key', new THREE.CylinderGeometry(0.0045, 0.0045, 0.002, 32), M.graphite, slope); pwr.rotation.x = Math.PI / 2; pwr.position.set(DIM.SCANNER_X, -0.03, 0.001);

  // Drive base (motor + coupling).
  const lc = group('drive_base'); lc.position.set(CX, 0, CZ);
  mesh('drive_base_platform', new THREE.CylinderGeometry(0.05, 0.052, 0.016, 72), M.graphite, lc).position.y = TOP + 0.008;

  // Replaceable preparation cartridge.
  const cart = group('cartridge'); cart.position.set(CX, 0, CZ);
  mesh('cartridge_base', new THREE.CylinderGeometry(0.043, 0.043, 0.012, 72), M.graphite, cart).position.y = TOP + 0.022;
  const wall = mesh('cartridge_wall', new THREE.CylinderGeometry(0.044, 0.044, RIM - (TOP + 0.016), 72, 1, true), M.glass, cart);
  wall.position.y = (RIM + TOP + 0.016) / 2; wall.renderOrder = 3;
  const rim = mesh('cartridge_rim', new THREE.TorusGeometry(0.044, 0.0018, 10, 96), M.graphite, cart); rim.rotation.x = Math.PI / 2; rim.position.y = RIM - 0.001;
  const rotor = group('crusher_rotor', cart);
  rotor.position.y = FLOOR;
  // Bottom grinder for small tablets (up to ~10 mm). The floor slopes into an 18 mm grinding pocket at the
  // lowest point of the cup. A fluted stainless cone turns inside a fixed grooved ring: the tablet is trapped
  // in the throat and drawn down to a 0.6 mm exit gap. Water later floods the pocket, a small stirrer on the
  // same shaft mixes slowly, and the syringe outlet draws from the pocket floor so it drains completely.
  const V2 = (a) => a.map(p => new THREE.Vector2(p[0], p[1]));
  const dsG = M.graphite.clone(); dsG.side = THREE.DoubleSide; const dsS = M.steel.clone(); dsS.side = THREE.DoubleSide;
  mesh('funnel_floor', new THREE.LatheGeometry(V2([[0.0418, 0.012], [0.009, 0.0065]]), 72), dsS, cart).position.y = FLOOR;
  const ringG = group('grinding_ring', cart); ringG.position.y = FLOOR;
  mesh('grinding_ring_body', new THREE.LatheGeometry(V2([[0.009, 0.0065], [0.0068, 0.0005], [0, 0.0005]]), 64), dsS, ringG);
  for (let i = 0; i < 10; i++) { const piv = new THREE.Object3D(); piv.rotation.y = i / 10 * Math.PI * 2; ringG.add(piv); const g = mesh('ring_groove_' + i, new THREE.BoxGeometry(0.0006, 0.0062, 0.0007), M.steel, piv); g.position.set(0.0077, 0.0035, 0); g.rotation.z = 0.37; }
  mesh('cone_burr', new THREE.CylinderGeometry(0.0022, 0.0062, 0.0058, 40), M.steel, rotor).position.y = 0.0032;
  for (let i = 0; i < 6; i++) { const piv = new THREE.Object3D(); piv.rotation.y = i / 6 * Math.PI * 2; rotor.add(piv); const fl = mesh('cone_flute_' + i, new THREE.BoxGeometry(0.0007, 0.006, 0.0008), M.steel, piv); fl.position.set(0.0043, 0.0032, 0); fl.rotation.z = 0.62; fl.rotation.x = 0.35; }
  mesh('stirrer_shaft', new THREE.CylinderGeometry(0.0012, 0.0012, 0.006, 16), M.steel, rotor).position.y = 0.009;
  [1, -1].forEach((sd, i) => { const p = mesh('stirrer_blade_' + i, new THREE.BoxGeometry(0.016, 0.0012, 0.004), M.steel, rotor); p.position.set(sd * 0.0085, 0.0115, 0); p.rotation.x = sd * 0.4; });
  const seal = mesh('shaft_seal', new THREE.TorusGeometry(0.004, 0.0008, 8, 32), M.graphite, cart); seal.rotation.x = Math.PI / 2; seal.position.y = FLOOR + 0.0005;
  const slGeo = new THREE.CylinderGeometry(0.0418, 0.0418, 1, 72); slGeo.translate(0, 0.5, 0);
  const slurry = mesh('preparation', slGeo, M.slurry, cart); slurry.position.y = FLOOR + 0.0005; slurry.scale.y = 0.0001; slurry.visible = false; slurry.renderOrder = 1;
  const pwGeo = new THREE.LatheGeometry(V2([[0, 0.0005], [0.0068, 0.0005], [0.0074, 0.0022], [0, 0.0024]]), 48);
  const powder = mesh('powder', pwGeo, M.powder, cart); powder.position.set(0, FLOOR, 0); powder.visible = false;
  const tabGeo = new THREE.LatheGeometry([[0, -0.0017], [0.0034, -0.0017], [0.0045, -0.0008], [0.0045, 0.0008], [0.0034, 0.0017], [0, 0.0017]].map(p => new THREE.Vector2(p[0], p[1])), 48);
  const pill = mesh('tablet', tabGeo, M.tablet, cart); pill.position.y = FLOOR + 0.016; pill.visible = false;

  // Lid, hinged at the back. Fixed camera + LED ring on the underside, looking straight down into the cup.
  const lid = group('lid'); lid.position.set(CX, RIM, CZ - 0.046);
  const lidBody = mesh('lid_shell', new THREE.CylinderGeometry(0.047, 0.047, 0.018, 72), M.shell, lid); lidBody.position.set(0, 0.009, 0.046);
  mesh('lid_cap', new THREE.CylinderGeometry(0.036, 0.036, 0.002, 72), M.graphite, lid).position.set(0, 0.0185, 0.046);
  const hinge = mesh('lid_hinge', new THREE.CylinderGeometry(0.0055, 0.0055, 0.034, 24), M.graphite, lid); hinge.rotation.z = Math.PI / 2; hinge.position.set(0, 0.006, 0.0);
  mesh('camera_lens', new THREE.CylinderGeometry(0.0055, 0.0055, 0.003, 32), M.lens, lid).position.set(0, -0.001, 0.046);
  const ledRing = mesh('led_ring', new THREE.TorusGeometry(0.02, 0.0014, 8, 72), M.led, lid); ledRing.rotation.x = Math.PI / 2; ledRing.position.set(0, -0.0004, 0.046);

  // Water reservoir.
  const tank = group('water_reservoir'); tank.position.set(TX, 0, TZ);
  mesh('reservoir_dock', vBox(THREE, 0.086, 0.08, 0.006, 0.013, 0.0015), M.graphite, tank).position.y = TOP - 0.001;
  const tw = mesh('reservoir_shell', vBox(THREE, 0.078, 0.072, 0.12, 0.012, 0.003), M.glass, tank); tw.position.y = TOP + 0.005; tw.renderOrder = 3;
  const water = mesh('reservoir_water', vBox(THREE, 0.07, 0.064, 1, 0.008, 0.001), M.water, tank); water.position.y = TOP + 0.009; water.scale.y = 0.08; water.renderOrder = 1;
  mesh('reservoir_cap', new THREE.CylinderGeometry(0.016, 0.016, 0.012, 48), M.graphite, tank).position.y = TOP + 0.005 + 0.12 + 0.006;
  for (let i = 0; i < 4; i++) { const m = mesh('reservoir_mark_' + i, new THREE.BoxGeometry(i % 2 ? 0.008 : 0.014, 0.0008, 0.0008), M.graphite, tank); m.position.set(0.026, TOP + 0.03 + i * 0.022, 0.0365); }

  // ENFit syringe dock.
  const dock = group('syringe_dock'); dock.position.set(SX, 0, SZ);
  mesh('syringe_port', new THREE.CylinderGeometry(0.0145, 0.0155, 0.008, 48), M.graphite, dock).position.y = TOP + 0.004;
  const post = mesh('cradle_post', vBox(THREE, 0.026, 0.012, 0.115, 0.004, 0.0015), M.graphite, dock); post.position.set(0, TOP, -0.019);
  [0.205, 0.245].forEach((y, i) => {
    const g = new THREE.TorusGeometry(0.0138, 0.0018, 10, 48, Math.PI * 1.3); g.rotateZ(Math.PI * 0.85); g.rotateX(Math.PI / 2);
    mesh('cradle_clip_' + i, g, M.graphite, dock).position.y = y;
  });
  const syr = group('enfit_syringe'); syr.position.set(SX, 0, SZ);
  mesh('enfit_tip', new THREE.CylinderGeometry(0.0055, 0.0068, 0.014, 40), M.accent, syr).position.y = 0.151;
  mesh('barrel_shoulder', new THREE.CylinderGeometry(0.0125, 0.0068, 0.006, 48), M.glass, syr).position.y = 0.161;
  const barrel = mesh('barrel', new THREE.CylinderGeometry(0.0125, 0.0125, 0.10, 48, 1, true), M.glass, syr); barrel.position.y = 0.214; barrel.renderOrder = 3;
  mesh('barrel_flange', vBox(THREE, 0.042, 0.016, 0.0028, 0.005, 0.0008), M.shell, syr).position.y = 0.264;
  for (let i = 0; i < 6; i++) { const m = mesh('graduation_' + i, new THREE.BoxGeometry(i % 2 ? 0.003 : 0.006, 0.0006, 0.0006), M.graphite, syr); m.position.set(0, 0.172 + i * 0.016, 0.0127); }
  const sfGeo = new THREE.CylinderGeometry(0.0118, 0.0118, 1, 48); sfGeo.translate(0, 0.5, 0);
  const sf = mesh('syringe_fluid', sfGeo, M.syrFluid, syr); sf.position.y = 0.1645; sf.scale.y = 0.0001; sf.visible = false; sf.renderOrder = 1;
  const plunger = group('plunger', syr);
  mesh('stopper', new THREE.CylinderGeometry(0.0119, 0.0119, 0.008, 48), M.graphite, plunger).position.y = 0.004;
  for (let i = 0; i < 2; i++) { const r = mesh('plunger_rod_' + i, new THREE.BoxGeometry(0.017, 0.112, 0.0022), M.shell, plunger); r.position.y = 0.008 + 0.056; r.rotation.y = i * Math.PI / 2; }
  mesh('thumb_press', new THREE.CylinderGeometry(0.0135, 0.0135, 0.003, 48), M.shell, plunger).position.y = 0.008 + 0.112 + 0.0015;

  // Tubing: reservoir → chamber inlet (in lid hinge block), outlet from the grinding-pocket floor → syringe port.
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const inPath = new THREE.CatmullRomCurve3([V(TX - 0.034, TOP + 0.014, TZ), V(-0.006, TOP + 0.008, -0.062), V(-0.032, TOP + 0.007, -0.08), V(CX, TOP + 0.03, -0.083), V(CX, 0.235, -0.08), V(CX, 0.262, -0.074)]);
  const outPath = new THREE.CatmullRomCurve3([V(CX, FLOOR + 0.0005, CZ), V(CX, FLOOR - 0.008, CZ), V(CX + 0.03, TOP + 0.008, CZ + 0.012), V(CX + 0.046, TOP + 0.006, CZ + 0.018), V(0.0, TOP + 0.005, 0.014), V(0.05, TOP + 0.005, 0.02), V(0.09, TOP + 0.005, 0.016), V(SX - 0.012, TOP + 0.006, SZ + 0.006), V(SX, TOP + 0.007, SZ)]);
  const tube = (name, path, r, mat, seg = 160, rad = 16) => { const m = mesh(name, new THREE.TubeGeometry(path, seg, r, rad, false), mat); m.userData.seg = seg; m.userData.rad = rad; return m; };
  tube('inlet_tube', inPath, 0.0034, M.tubing).renderOrder = 3;
  tube('outlet_tube', outPath, 0.0034, M.tubing).renderOrder = 3;
  const inFluid = tube('inlet_flow', inPath, 0.0024, M.water); inFluid.visible = false;
  const outFluid = tube('outlet_flow', outPath, 0.0024, M.syrFluid); outFluid.visible = false;

  // Film-only effects.
  if (film) {
    const add = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const sg = new THREE.CylinderGeometry(0.0022, 0.0028, 1, 16); sg.translate(0, -0.5, 0);
    const stream = mesh('fx_stream', sg, M.water, cart); stream.position.set(0, RIM - 0.002, -0.026); stream.visible = false;
    const cg = new THREE.CylinderGeometry(0.004, 0.04, 1, 48, 1, true); cg.translate(0, -0.5, 0);
    const cone = mesh('fx_scan_cone', cg, add(0xffffff, 0), cart); cone.position.y = RIM - 0.002; cone.visible = false;
    const sr = mesh('fx_scan_ring', new THREE.TorusGeometry(0.0425, 0.0009, 8, 96), add(0xffffff, 0), cart); sr.rotation.x = Math.PI / 2; sr.visible = false;
    const pts = group('fx_particles', cart);
    const pm = new THREE.MeshStandardMaterial({ name: 'particle', color: 0xF4F1EA, roughness: 0.9, transparent: true, opacity: 1 });
    for (let i = 0; i < 18; i++) { const p = mesh('fx_particle_' + i, new THREE.SphereGeometry(0.0012 + (i % 3) * 0.0004, 8, 6), pm, pts); p.userData.k = i; }
    P.fx_particles.userData.mat = pm;
    const bm = add(COLORS.accent, 0);
    const bg = new THREE.PlaneGeometry(0.036, 0.07); bg.rotateX(-Math.PI / 2); bg.translate(0, 0, 0.035); bg.rotateX(Math.PI / 2);
    const beam = mesh('fx_beam', new THREE.PlaneGeometry(0.036, 0.07), bm, slope); beam.visible = false;
    beam.geometry.translate(0, 0, 0); beam.rotation.x = 0; beam.position.set(DIM.SCANNER_X, 0, 0.035);
    beam.rotation.set(Math.PI / 2, 0, 0); beam.userData.mat = bm;
  }

  const setFlow = (m, a, b) => {
    const seg = m.userData.seg, rad = m.userData.rad;
    const s = Math.floor(Math.max(0, a) * seg), e = Math.ceil(Math.min(1, b) * seg);
    if (e <= s) { m.visible = false; return; }
    m.visible = true; m.geometry.setDrawRange(s * rad * 6, (e - s) * rad * 6);
  };
  const cWater = new THREE.Color(COLORS.water), cSl = new THREE.Color(COLORS.slurry);

  function setState(s = {}) {
    P.lid.rotation.x = -(s.lid || 0) * 1.8;
    P.crusher_rotor.rotation.y = s.spin || 0;
    const liq = s.liquid || 0;
    P.preparation.visible = liq > 0.00005; P.preparation.scale.y = Math.max(0.00005, liq);
    const mix = s.mix || 0;
    M.slurry.color.copy(cWater).lerp(cSl, mix); M.slurry.opacity = 0.62 + 0.3 * mix;
    const pw = s.powder || 0; P.powder.visible = pw > 0.01; P.powder.scale.set(1, pw, 1);
    P.tablet.visible = !!s.pill && (s.pillScale ?? 1) > 0.02;
    if (s.pill) {
      P.tablet.position.set(s.pillX || 0, s.pillY ?? FLOOR + 0.016, s.pillZ || 0);
      P.tablet.rotation.set(s.pillRx || 0, 0, s.pillRz || 0);
      const k = s.pillScale ?? 1; P.tablet.scale.set(k * (2 - (s.pillSquash ?? 1)) ** 0.5, k * (s.pillSquash ?? 1), k * (2 - (s.pillSquash ?? 1)) ** 0.5);
    }
    P.reservoir_water.scale.y = Math.max(0.001, (s.tank ?? 0.8) * 0.106);
    setFlow(P.inlet_flow, s.inA || 0, s.inB || 0);
    setFlow(P.outlet_flow, s.outA || 0, s.outB || 0);
    const f = s.syr || 0;
    P.syringe_fluid.visible = f > 0.002; P.syringe_fluid.scale.y = Math.max(0.0001, f * 0.085);
    P.plunger.position.y = 0.1645 + f * 0.085;
    P.enfit_syringe.position.y = s.lift || 0;
    M.led.emissiveIntensity = 0.15 + (s.led || 0) * 3.5;
    M.status.emissiveIntensity = s.status ?? 0.6;
    scanLed.emissiveIntensity = 0.3 + (s.scanLed || 0) * 4;
    if (film) {
      const st = s.stream || 0; P.fx_stream.visible = st > 0.01; P.fx_stream.scale.set(1, Math.max(0.001, RIM - (FLOOR + liq) - 0.002), 1);
      const cn = s.cone || 0; P.fx_scan_cone.visible = cn > 0.01; P.fx_scan_cone.material.opacity = cn * 0.22; P.fx_scan_cone.scale.y = Math.max(0.001, (RIM - FLOOR - 0.004) * (s.coneLen ?? 1));
      const sr = s.scanRing ?? -1; P.fx_scan_ring.visible = sr >= 0 && cn > 0.01; P.fx_scan_ring.position.y = RIM - 0.004 - sr * (RIM - FLOOR - 0.01); P.fx_scan_ring.material.opacity = cn * 0.9;
      const pa = s.particles || 0; P.fx_particles.visible = pa > 0.01; P.fx_particles.userData.mat.opacity = pa;
      if (pa > 0.01) P.fx_particles.children.forEach((p) => {
        const k = p.userData.k, a = (s.swirl || 0) * (1 + (k % 4) * 0.15) + k * 2.1, rr = 0.012 + (k * 0.37 % 1) * 0.024;
        p.position.set(Math.cos(a) * rr, FLOOR + 0.003 + ((k * 0.61) % 1) * Math.max(0.002, liq - 0.004), Math.sin(a) * rr);
      });
      const bm = s.beam || 0; P.fx_beam.visible = bm > 0.01; P.fx_beam.userData.mat.opacity = bm * 0.35;
    }
  }

  function setExplode(e) {
    P.lid.position.y = RIM + e * 0.1;
    P.cartridge.position.y = e * 0.045;
    P.crusher_rotor.position.y = FLOOR - e * 0.03;
    P.water_reservoir.position.y = e * 0.08; P.water_reservoir.position.z = TZ - e * 0.03;
    P.enfit_syringe.position.y = e * 0.11; P.enfit_syringe.position.x = SX + e * 0.03;
    P.drive_base.position.y = 0;
    const vis = e < 0.04;
    ['inlet_tube', 'outlet_tube'].forEach((n) => (P[n].visible = vis));
  }

  setState(opts.state || {});
  return { group: root, parts: P, materials: M, screenCanvas: canvas, screenTex, setState, setExplode };
}

export function buildPack(THREE, variant) {
  const c = document.createElement('canvas'); c.width = 600; c.height = 384; drawPack(c, variant);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.MeshStandardMaterial({ name: 'pack_label_' + variant, map: tex, roughness: 0.6 });
  const side = new THREE.MeshStandardMaterial({ name: 'pack_card', color: 0xFBFAF7, roughness: 0.6 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.048, 0.022), [side, side, side, side, face, face]);
  m.name = 'pack_' + variant; m.castShadow = true;
  return { mesh: m, canvas: c, tex };
}
