// Maps for Purple Arena (the Deathmatch arena and 10 parkour levels). The server builds them and sends them to the clients.
// Box = { kind, x, z, w, d, h, y (bottom), col }.  Top of a box = y + h.

function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const B = (kind, x, z, w, d, h, col, y) => ({ kind, x, z, w, d, h, y: y || 0, col: col || 0 });

function edges(half, boxes, kind) {
  const L = half * 2 + 4;
  boxes.push(B(kind, 0, -half - 1, L, 2, 8), B(kind, 0, half + 1, L, 2, 8), B(kind, -half - 1, 0, 2, L, 8), B(kind, half + 1, 0, 2, L, 8));
}
function overlaps(a, b, pad) { return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad && Math.abs(a.z - b.z) < (a.d + b.d) / 2 + pad; }

// ---------- building blocks: ramps and raised decks ----------
// ramp: a wedge. rd 0 rises towards +x, 1 towards -x, 2 towards +z, 3 towards -z. h is the height of its high edge.
const R = (x, z, w, d, h, rd, col, y) => Object.assign(B('ramp', x, z, w, d, h, col, y), { rd });
// deck: a slab on pillars (players can walk underneath when h >= 2.2); its top is at height h
function deck(boxes, x, z, w, d, h, col, pillars) {
  boxes.push(B('plat', x, z, w, d, 0.4, col, h - 0.4));
  if (pillars !== false) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) boxes.push(B('pillar', x + sx * (w / 2 - 0.7), z + sz * (d / 2 - 0.7), 0.9, 0.9, h - 0.4));
}
// ramp leading up to a deck from one of its sides (0 +x, 1 -x, 2 +z, 3 -z)
function rampTo(boxes, x, z, w, d, h, side, col, len) {
  len = len || h * 2.5;
  if (side === 0) boxes.push(R(x + w / 2 + len / 2, z, len, d, h, 1, col));
  else if (side === 1) boxes.push(R(x - w / 2 - len / 2, z, len, d, h, 0, col));
  else if (side === 2) boxes.push(R(x, z + d / 2 + len / 2, w, len, h, 3, col));
  else boxes.push(R(x, z - d / 2 - len / 2, w, len, h, 2, col));
}
// a hill you can slide down: two ramps back to back
function hill(boxes, x, z, len, wid, h, alongX, col) {
  if (alongX) boxes.push(R(x - len / 2, z, len, wid, h, 0, col), R(x + len / 2, z, len, wid, h, 1, col));
  else boxes.push(R(x, z - len / 2, wid, len, h, 2, col), R(x, z + len / 2, wid, len, h, 3, col));
}

// ---------- fixed arena (deathmatch, first endless wave) ----------
function arena() {
  const boxes = [];
  edges(44, boxes, 'wall');
  const add = (...a) => boxes.push(B(...a));
  add('brick', -4.25, -5, 5.5, 0.6, 4); add('brick', 4.25, -5, 5.5, 0.6, 4); add('brick', -4.25, 5, 5.5, 0.6, 4); add('brick', 4.25, 5, 5.5, 0.6, 4);
  add('brick', -7, 0, 0.6, 9.4, 4); add('brick', 7, 0, 0.6, 9.4, 4);
  add('crate', -3.5, -1.5, 1.3, 1.3, 1.0); add('crate', 3.5, 2, 1.3, 1.3, 1.0); add('crate', 0, 0, 1.6, 1.6, 2.0);
  add('cont', -18, -10, 6.2, 2.5, 2.6, 11022893); add('cont', 18, 10, 6.2, 2.5, 2.6, 2973608); add('cont', -18, 12, 2.5, 6.2, 2.6, 4160847); add('cont', 18, -12, 2.5, 6.2, 2.6, 13071403);
  add('cont', 0, -20, 6.2, 2.5, 2.6, 2973608); add('cont', 0, 20, 6.2, 2.5, 2.6, 11022893); add('cont', -26, 0, 2.5, 6.2, 2.6, 4160847); add('cont', 26, 0, 2.5, 6.2, 2.6, 13071403);
  add('barrier', -10, 16, 3, 0.6, 1.0); add('barrier', 10, -16, 3, 0.6, 1.0); add('barrier', -10, -16, 0.6, 3, 1.0); add('barrier', 10, 16, 0.6, 3, 1.0);
  add('barrier', -24, -22, 3, 0.6, 1.0); add('barrier', 24, 22, 3, 0.6, 1.0); add('barrier', -24, 22, 0.6, 3, 1.0); add('barrier', 24, -22, 0.6, 3, 1.0);
  add('crate', -8, 8, 1.4, 1.4, 1.0); add('crate', 8, -8, 1.4, 1.4, 1.0); add('crate', -14, 0, 1.4, 1.4, 1.0); add('crate', 14, 0, 1.4, 1.4, 1.0);
  add('crate', 12, -2, 1.6, 1.6, 2.0); add('crate', -12, 2, 1.6, 1.6, 2.0); add('crate', -22, -14, 1.4, 1.4, 1.0); add('crate', 22, 14, 1.4, 1.4, 1.0);
  add('barrel', -5, -12, 0.9, 0.9, 1.1); add('barrel', 5, 12, 0.9, 0.9, 1.1); add('barrel', -22, 10, 0.9, 0.9, 1.1); add('barrel', 22, -10, 0.9, 0.9, 1.1);
  add('barrel', 0, -10, 0.9, 0.9, 1.1); add('barrel', 0, 10, 0.9, 0.9, 1.1);
  // outer ring: corner towers with two ramps each, long raised lanes on the north and south edge, slide hills
  const T = 0x7d8794;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { deck(boxes, sx * 36, sz * 36, 10, 10, 3.6, T); rampTo(boxes, sx * 36, sz * 36, 10, 10, 3.6, sx > 0 ? 1 : 0, T); rampTo(boxes, sx * 36, sz * 36, 10, 10, 3.6, sz > 0 ? 3 : 2, T); }
  for (const sz of [-1, 1]) { deck(boxes, 0, sz * 39, 18, 5, 3.6, T); rampTo(boxes, 0, sz * 39, 18, 5, 3.6, 0, T); rampTo(boxes, 0, sz * 39, 18, 5, 3.6, 1, T); }
  hill(boxes, -37, 0, 5, 7, 1.8, true, 0x8a8f99); hill(boxes, 37, 0, 5, 7, 1.8, true, 0x8a8f99);
  add('crate', -30, 30, 1.4, 1.4, 1.0); add('crate', 30, -30, 1.4, 1.4, 1.0); add('crate', -26, -30, 1.4, 1.4, 2.0); add('crate', 26, 30, 1.4, 1.4, 2.0);
  add('cont', -30, -18, 6.2, 2.5, 2.6, 4160847); add('cont', 30, 18, 6.2, 2.5, 2.6, 11022893); add('barrier', -20, 30, 3, 0.6, 1.0); add('barrier', 20, -30, 3, 0.6, 1.0);
  return { id: 'arena', name: 'Arena', th: 'arena', half: 44, boxes, spawns: ringSpawns(44) };
}

// ---------- more deathmatch maps ----------
function free(boxes, x, z, w, d, pad) { const t = { x, z, w, d }; return !boxes.some((b) => overlaps(t, b, pad)); }
function scatter(boxes, r, n, make, avoid, pad, half) {
  let placed = 0;
  for (let tries = 0; tries < n * 14 && placed < n; tries++) {
    const x = (r() * 2 - 1) * (half - 4), z = (r() * 2 - 1) * (half - 4), b = make(x, z);
    if (avoid(x, z) || !free(boxes, b.x, b.z, b.w, b.d, pad)) continue;
    boxes.push(b); placed++;
  }
}
function ringSpawns(half) {
  const a = half * 0.82, out = [];
  for (const [x, z] of [[0, 1], [0, -1], [1, 0], [-1, 0], [0.9, 0.9], [-0.9, 0.9], [0.9, -0.9], [-0.9, -0.9]]) out.push([x * a, z * a]);
  return out;
}
// Dust Bowl: sandstone temple ruins in the desert
function dust() {
  const r = rng(501), half = 44, boxes = [], S = 0xc9a066, add = (...a) => boxes.push(B(...a));
  edges(half, boxes, 'edge');
  add('block', -7.5, -8, 9, 0.9, 3.6, S); add('block', 7.5, -8, 9, 0.9, 3.6, S); add('block', -7.5, 8, 9, 0.9, 3.6, S); add('block', 7.5, 8, 9, 0.9, 3.6, S);
  add('block', -12, -3.5, 0.9, 8, 3.6, S); add('block', -12, 3.5, 0.9, 8, 3.6, S); add('block', 12, -3.5, 0.9, 8, 3.6, S); add('block', 12, 3.5, 0.9, 8, 3.6, S);
  for (const [x, z] of [[-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5]]) add('pillar', x, z, 1.3, 1.3, 4.6);
  add('stone', 0, 0, 3.2, 3.2, 0.9); add('stone', 0, 0, 1.6, 1.6, 1.8);
  // raised sandstone terraces north and south, with slide dunes between the temple and the walls
  for (const sz of [-1, 1]) { deck(boxes, 0, sz * 36, 16, 6, 4, S); rampTo(boxes, 0, sz * 36, 16, 6, 4, 0, S); rampTo(boxes, 0, sz * 36, 16, 6, 4, 1, S); }
  for (const sx of [-1, 1]) { deck(boxes, sx * 34, 0, 6, 12, 2.8, S); rampTo(boxes, sx * 34, 0, 6, 12, 2.8, 2, S); rampTo(boxes, sx * 34, 0, 6, 12, 2.8, 3, S); }
  hill(boxes, -24, -22, 11, 8, 2.4, true, S); hill(boxes, 24, 22, 11, 8, 2.4, true, S); hill(boxes, 24, -22, 8, 11, 2.4, false, S); hill(boxes, -24, 22, 8, 11, 2.4, false, S);
  const avoid = (x, z) => Math.abs(x) < 13.5 && Math.abs(z) < 9.5;
  scatter(boxes, r, 14, (x, z) => { const s2 = 2 + r() * 2.2; return B('rock', x, z, s2, s2 * (0.8 + r() * 0.4), 0.9 + r() * 0.25); }, avoid, 1.2, half);
  scatter(boxes, r, 10, (x, z) => { const s2 = 1.3 + r() * 0.3; return B('crate', x, z, s2, s2, r() < 0.5 ? 1.0 : 2.0); }, avoid, 1.0, half);
  scatter(boxes, r, 8, (x, z) => (r() < 0.5 ? B('block', x, z, 5 + r() * 2, 0.8, 1.1, S) : B('block', x, z, 0.8, 5 + r() * 2, 1.1, S)), avoid, 1.3, half);
  scatter(boxes, r, 6, (x, z) => B('barrel', x, z, 0.9, 0.9, 1.1), avoid, 0.8, half);
  return { id: 'dust', name: 'Dust Bowl', th: 'desert', half, boxes, spawns: ringSpawns(half) };
}
// Frostbite: ice blocks and a snowed-in bunker
function frost() {
  const r = rng(733), half = 42, boxes = [], ICE = 0x9fd0ea, SNOW = 0xe9f1f7, add = (...a) => boxes.push(B(...a));
  edges(half, boxes, 'edge');
  // ice pyramid in the middle (ramps on all four sides), half-pipes on both flanks, snow forts in the corners
  deck(boxes, 0, 0, 8, 8, 3.8, ICE, false); for (let s2 = 0; s2 < 4; s2++) rampTo(boxes, 0, 0, 8, 8, 3.8, s2, ICE, 9);
  for (const sx of [-1, 1]) { boxes.push(R(sx * 27, -7, 12, 8, 3, sx > 0 ? 1 : 0, ICE), R(sx * 27, 7, 12, 8, 3, sx > 0 ? 1 : 0, ICE)); hill(boxes, sx * 27, 0, 7, 6, 1.4, true, SNOW); }
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { add('block', sx * 33, sz * 33, 7, 0.8, 3.2, SNOW); add('block', sx * 36.4, sz * 29.6, 0.8, 6.4, 3.2, SNOW); add('block', sx * 30, sz * 36, 0.8, 5, 3.2, SNOW); }
  const avoid = (x, z) => Math.abs(x) < 16 && Math.abs(z) < 16 || (Math.abs(x) > 19 && Math.abs(x) < 35 && Math.abs(z) < 12);
  scatter(boxes, r, 22, (x, z) => { const s2 = 1.6 + r() * 2.6; return B('block', x, z, s2, s2 * (0.7 + r() * 0.6), 1.2 + r() * 2.4, ICE); }, avoid, 1.3, half);
  scatter(boxes, r, 12, (x, z) => { const s2 = 2 + r() * 2.5; return B('block', x, z, s2, s2, 0.5 + r() * 0.6, SNOW); }, avoid, 1.0, half);
  scatter(boxes, r, 8, (x, z) => B('crate', x, z, 1.4, 1.4, r() < 0.5 ? 1.0 : 2.0), avoid, 1.0, half);
  scatter(boxes, r, 5, (x, z) => B('barrel', x, z, 0.9, 0.9, 1.1), avoid, 0.8, half);
  return { id: 'frost', name: 'Frostbite', th: 'ice', half, boxes, spawns: ringSpawns(half) };
}
// Night Woods: dark forest clearing with a cabin
function woods() {
  const r = rng(917), half = 50, boxes = [], W = 0x5a3f2a, add = (...a) => boxes.push(B(...a));
  edges(half, boxes, 'edge');
  // treehouse: a big deck in the middle, rope bridges to two outpost decks, log ramps up
  deck(boxes, 0, 0, 12, 12, 4.4, W); rampTo(boxes, 0, 0, 12, 12, 4.4, 2, W, 11); rampTo(boxes, 0, 0, 12, 12, 4.4, 3, W, 11);
  for (const sx of [-1, 1]) {
    deck(boxes, sx * 10.5, 0, 9, 3, 4.4, W, false); boxes.push(B('pillar', sx * 10.5, 0, 0.9, 0.9, 4.0));
    deck(boxes, sx * 24, 0, 10, 10, 4.4, W); rampTo(boxes, sx * 24, 0, 10, 10, 4.4, sx > 0 ? 0 : 1, W, 11); rampTo(boxes, sx * 24, 0, 10, 10, 4.4, 2, W, 11);
    hill(boxes, sx * 38, -20, 9, 6, 2, false, W);
  }
  add('crate', 0, 0, 1.5, 1.5, 1.0);
  const avoid = (x, z) => (Math.abs(x) < 31 && Math.abs(z) < 19) || (Math.abs(x) > 33 && Math.abs(x) < 43 && Math.abs(z) > 10 && Math.abs(z) < 30);
  scatter(boxes, r, 100, (x, z) => B('tree', x, z, 0.9, 0.9, 9), avoid, 2.8, half);
  scatter(boxes, r, 12, (x, z) => { const s2 = 1.4 + r() * 1.6; return B('rock', x, z, s2, s2 * (0.7 + r() * 0.5), 0.6 + r() * 0.55); }, avoid, 1.0, half);
  scatter(boxes, r, 12, (x, z) => (r() < 0.5 ? B('log', x, z, 4 + r(), 0.8, 0.8) : B('log', x, z, 0.8, 4 + r(), 0.8)), avoid, 1.0, half);
  scatter(boxes, r, 5, (x, z) => B('barrel', x, z, 0.9, 0.9, 1.1), avoid, 0.8, half);
  return { id: 'woods', name: 'Night Woods', th: 'forest', half, boxes, spawns: ringSpawns(half) };
}
// Reactor: industrial core with catwalks
function reactor() {
  const r = rng(1201), half = 44, boxes = [], add = (...a) => boxes.push(B(...a));
  edges(half, boxes, 'wall');
  add('pipe', 0, 0, 5, 5, 8);
  for (const [x, z] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) add('pipe', x, z, 1.2, 1.2, 8);
  add('cont', -15, -4, 2.5, 6.2, 2.6, 2973608); add('cont', 15, 4, 2.5, 6.2, 2.6, 11022893); add('cont', 4, -15, 6.2, 2.5, 2.6, 4160847); add('cont', -4, 15, 6.2, 2.5, 2.6, 13071403);
  // catwalks (top at 3.0) reached by crate stairs
  const G = 0x5a5f68;
  for (const sz of [-1, 1]) { deck(boxes, 0, sz * 24, 22, 4, 3.2, G); rampTo(boxes, 0, sz * 24, 22, 4, 3.2, 0, G); rampTo(boxes, 0, sz * 24, 22, 4, 3.2, 1, G); }
  for (const sx of [-1, 1]) { deck(boxes, sx * 36, 0, 5, 22, 3.2, G); rampTo(boxes, sx * 36, 0, 5, 22, 3.2, 2, G); rampTo(boxes, sx * 36, 0, 5, 22, 3.2, 3, G); }
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { deck(boxes, sx * 36, sz * 36, 8, 8, 5.2, G); rampTo(boxes, sx * 36, sz * 36, 8, 8, 5.2, sx > 0 ? 1 : 0, G, 13); add('cont', sx * 22, sz * 28, 6.2, 2.5, 2.6, sz > 0 ? 2973608 : 11022893); }
  const avoid = (x, z) => Math.hypot(x, z) < 7 || (Math.abs(z) > 20 && Math.abs(x) < 24) || (Math.abs(x) > 30 && Math.abs(z) < 14) || (Math.abs(x) > 30 && Math.abs(z) > 30);
  scatter(boxes, r, 22, (x, z) => { const s2 = 1.3 + r() * 0.4; return B('crate', x, z, s2, s2, r() < 0.5 ? 1.0 : 2.0); }, avoid, 1.0, half);
  scatter(boxes, r, 8, (x, z) => B('barrel', x, z, 0.9, 0.9, 1.1), avoid, 0.8, half);
  scatter(boxes, r, 8, (x, z) => B('barrier', x, z, 3, 0.6, 1.0), avoid, 1.2, half);
  return { id: 'reactor', name: 'Reactor', th: 'factory', half, boxes, spawns: ringSpawns(half) };
}
const DM_MAPS = ['arena', 'dust', 'frost', 'woods', 'reactor'];

// ---------- parkour (10 levels, one biome each) ----------
const PK_INFO = [
  { th: 'desert', name: 'Scorched Dunes', col: 0xc9a066 },
  { th: 'water', name: 'Open Sea', col: 0x8a6a45 },
  { th: 'forest', name: 'Whispering Forest', col: 0x5b4a2f },
  { th: 'ice', name: 'Frozen Peaks', col: 0xbfe3f5 },
  { th: 'cave', name: 'Crystal Cave', col: 0x4a3f3a },
  { th: 'factory', name: 'Rusty Factory', col: 0x6b6f78 },
  { th: 'volcano', name: 'Molten Core', col: 0x2d2523 },
  { th: 'abyss', name: 'Abyssal Depths', col: 0x2a5a6a },
  { th: 'neon', name: 'Neon City', col: 0x2b1b55 },
  { th: 'space', name: 'Outer Space', col: 0x3a3a5a },
  { th: 'neon', name: 'Final Sprint', col: 0x3b2470 },
  { th: 'volcano', name: 'Blink', col: 0x4a2a22 }
];
const PK_LEVELS = PK_INFO.length;
function airtime(dy) { const disc = 49 - 40 * dy; return disc < 0 ? 0 : (7 + Math.sqrt(disc)) / 20; }
function gapDist(a, b) {
  const dx = Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2), dz = Math.max(0, Math.abs(a.z - b.z) - (a.d + b.d) / 2);
  return Math.hypot(dx, dz);
}
const PK_SALT = {10: 2};   // levels re-rolled after the reachability test found an impossible jump
function parkour(L) {
  const SL = L === 11 ? 12 : L === 12 ? 13 : L, r = rng(SL * 7919 + 13 + (PK_SALT[L] || 0) * 104729), t = Math.min((SL - 1) / 9, 1.1), band = PK_INFO[L - 1], big = band.th === 'cavern';     // t keeps the old value for levels 1-10, so their layouts did not change; the last level is long, hard and roomy
  const f = big ? 0.7 : 0.4 + 0.22 * t, V = 8.6, boxes = [], plats = [], cps = [];     // gentler than before: shorter gaps, bigger platforms
  const N = big ? 54 : L === 11 ? 6 : L === 12 ? 2 : 10 + Math.round(L * 2.2);
  const col = band.col;
  const mk = (x, z, w, d, top, kind) => { const b = B(kind || 'plat', x, z, w, d, 0.7, col, top - 0.7); b.top = top; return b; };
  const start = mk(0, 0, 7, 7, 0, 'start'); plats.push(start); boxes.push(start);
  let dir = [0, -1], pathLen = 0, placedRunOk = true, prevRun = false;
  for (let i = 1; i <= N; i++) {
    const prev = plats[plats.length - 1];
    prevRun = !!prev.run;
    let placed = null;
    for (let tries = 0; tries < 40 && !placed; tries++) {
      let d2 = dir;
      if ((r() < (big ? 0.34 : 0.1 + 0.2 * t) || tries > 8) && !(prevRun && tries <= 20)) { const s = r() < 0.5 ? 1 : -1; d2 = dir[0] === 0 ? [s, 0] : [0, s]; }
      const last = i === N, isCp = false, run = !last && !isCp && L >= 4 && i > 1 && placedRunOk && r() < 0.1 + 0.1 * Math.min(t, 1), size = last || isCp ? 6 : big ? 4.4 + r() * 2.2 : Math.max(3.1, (5.6 - 2.1 * t) * (0.85 + r() * 0.4));
      let w = size, dd = last || isCp ? 6 : big ? 4.4 + r() * 2.2 : Math.max(3.1, size * (0.85 + r() * 0.3));
      if (run) { const rw = big ? 4.6 : 3.4; if (d2[0] === 0) { w = rw; dd = 12; } else { w = 12; dd = rw; } }
      const up = r() < 0.4 ? r() * (0.25 + 0.45 * t) : -r() * (0.6 + 1.4 * t);
      const top = Math.max(-2, prev.top + (last ? Math.min(up, 0) : up));
      const dy = top - prev.top, allow = f * V * airtime(dy);
      if (allow <= 0.6) continue;
      const g = Math.max(1.2, allow * (0.6 + 0.4 * r()) - 0.2);
      const lat = (r() * 2 - 1) * (0.2 + 1.0 * t);
      const along = (d2[0] !== 0 ? (prev.w + w) / 2 : (prev.d + dd) / 2) + g;
      let x = prev.x + d2[0] * along + (d2[0] === 0 ? lat : 0), z = prev.z + d2[1] * along + (d2[1] === 0 ? lat : 0);
      const c = mk(x, z, w, dd, top, last ? 'finish' : isCp ? 'cp' : 'plat');
      if (gapDist(prev, c) > allow) { continue; }
      // keep the scoreboards readable: nothing may stand in front of the start board, and nothing high next to the finish board
      if (Math.abs(x) - w / 2 < 6.5 && z + dd / 2 > 3.2 && z - dd / 2 < 16) continue;
      if (last && plats.some((p, k) => k < plats.length - 1 && Math.hypot(p.x - x, p.z - z) < 14 && p.top > top + 1)) continue;
      if (plats.some((p, k) => k < plats.length - 1 && Math.abs(p.top - top) < 4 && overlaps(p, c, 1.5))) continue;
      placed = c; dir = d2; placed.run = run;
    }
    if (!placed) { // fallback: straight, easy step
      const w = i === N ? 6 : big ? 5 : 3, dd = w, c = mk(prev.x + dir[0] * (prev.w / 2 + 3 + w / 2), prev.z + dir[1] * (prev.d / 2 + 3 + dd / 2), w, dd, prev.top, i === N ? 'finish' : 'plat');
      placed = c;
    }
    pathLen += Math.hypot(placed.x - prev.x, placed.z - prev.z);
    plats.push(placed); boxes.push(placed); placedRunOk = !placed.run;
    if (placed.kind === 'cp') cps.push([placed.x, placed.top, placed.z]);
  }
  const fin = plats[plats.length - 1];
  let minY = 0, maxY = 0, minX = 0, maxX = 0, minZ = 0, maxZ = 0;
  for (const p of plats) { minY = Math.min(minY, p.top); maxY = Math.max(maxY, p.top); minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  if (big) {   // the last level is a cavern: solid rock walls all around, plus rock pillars and wall slabs standing between the platforms
    const M = 18, T = 8, y0 = minY - 20, H = maxY - minY + 60, x0 = minX - M, x1 = maxX + M, z0 = minZ - M, z1 = maxZ + M;
    const wall = (x, z, w, d) => { const b = B('cave', x, z, w, d, H, col, y0); boxes.push(b); return b; };
    wall((x0 + x1) / 2, z0 - T / 2, x1 - x0 + 2 * T, T); wall((x0 + x1) / 2, z1 + T / 2, x1 - x0 + 2 * T, T);
    wall(x0 - T / 2, (z0 + z1) / 2, T, z1 - z0); wall(x1 + T / 2, (z0 + z1) / 2, T, z1 - z0);
    const segDist = (px, pz, a, b2) => { const vx = b2.x - a.x, vz = b2.z - a.z, l2 = vx * vx + vz * vz || 1, k = Math.max(0, Math.min(1, ((px - a.x) * vx + (pz - a.z) * vz) / l2)); return Math.hypot(px - a.x - vx * k, pz - a.z - vz * k); };
    let made = 0;
    for (let tries = 0; tries < 900 && made < 46; tries++) {
      const long = r() < 0.5, ax = r() < 0.5, w = long ? (ax ? 10 + r() * 8 : 2.4 + r() * 1.6) : 2.4 + r() * 3, d = long ? (ax ? 2.4 + r() * 1.6 : 10 + r() * 8) : w;
      const x = x0 + 4 + r() * (x1 - x0 - 8), z = z0 + 4 + r() * (z1 - z0 - 8);
      const probe = { x, z, w, d };
      if (plats.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 + 5 && Math.abs(p.z - z) < (p.d + d) / 2 + 5)) continue;
      let ok = true;
      for (let k = 1; k < plats.length && ok; k++) { const a = plats[k - 1], b2 = plats[k], need = Math.max(w, d) / 2 + 4.5; if (segDist(x, z, a, b2) < need) ok = false; }
      if (!ok || (Math.abs(x) < w / 2 + 12 && z + d / 2 > -6 && z - d / 2 < 22) || Math.hypot(x - fin.x, z - fin.z) < Math.max(w, d) / 2 + 14) continue;
      if (boxes.some((b2) => b2.kind === 'cave' && b2.h < H - 1 && overlaps(b2, probe, 2))) continue;
      const b = B('cave', x, z, w, d, H, col, y0); boxes.push(b); made++;
    }
  }
  return {
    id: 'pk' + L, name: 'Level ' + L + ' - ' + band.name, biome: band.th, th: band.th, half: 2000, boxes, spawns: [[0, 0]], pk: {
      lv: L, n: PK_LEVELS, start: [0, 0, 0], cps, cpR: 4.2, fin: [fin.x, fin.top, fin.z], kill: Math.min(minY, 0) - 14, pathLen,
      bounds: [minX - (big ? 18 : 20), maxX + (big ? 18 : 20), minZ - (big ? 18 : 20), maxZ + (big ? 18 : 20), minY, maxY]
    }
  };
}

const cache = new Map();
function getMap(id) {
  if (cache.has(id)) return cache.get(id);
  let m = null, k;
  if (id === 'arena') m = arena();
  else if (id === 'dust') m = dust();
  else if (id === 'frost') m = frost();
  else if (id === 'woods') m = woods();
  else if (id === 'reactor') m = reactor();
  else if ((k = /^pk(\d+)$/.exec(id)) && +k[1] >= 1 && +k[1] <= PK_LEVELS) m = parkour(+k[1]);
  if (!m) return null;
  // make sure every spawn point is out of every box
  m.spawns = m.spawns.map(([x, z]) => {
    for (let i = 0; i < 40; i++) {
      const px = x + (i ? (Math.random() - 0.5) * 2 * i * 0.4 : 0), pz = z + (i ? (Math.random() - 0.5) * 2 * i * 0.4 : 0);
      if (!m.boxes.some((b) => !m.pk && Math.abs(px - b.x) < b.w / 2 + 0.9 && Math.abs(pz - b.z) < b.d / 2 + 0.9)) return [px, pz];
    }
    return [x, z];
  });
  m.wire = JSON.stringify({ t: 'map', id: m.id, name: m.name, th: m.th, half: m.half, b: m.boxes.map((b) => [b.kind, +b.x.toFixed(2), +b.z.toFixed(2), +b.w.toFixed(2), +b.d.toFixed(2), +b.h.toFixed(2), b.col, +b.y.toFixed(2), b.rd | 0]), pk: m.pk || null });
  cache.set(id, m);
  return m;
}
function setSalt(L, v) { PK_SALT[L] = v; cache.delete('pk' + L); }
// a ramp is a wedge: rd 0 rises towards +x, 1 towards -x, 2 towards +z, 3 towards -z
function rampH(b, x, z) {
  const t = b.rd === 0 ? (x - (b.x - b.w / 2)) / b.w : b.rd === 1 ? 1 - (x - (b.x - b.w / 2)) / b.w : b.rd === 2 ? (z - (b.z - b.d / 2)) / b.d : 1 - (z - (b.z - b.d / 2)) / b.d;
  return b.y + b.h * Math.max(0, Math.min(1, t));
}
module.exports = { rampH, setSalt, getMap, DM_MAPS, PK_LEVELS, PK_INFO, airtime, gapDist };
