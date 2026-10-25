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

// ---------- fixed arena (deathmatch, first endless wave) ----------
function arena() {
  const boxes = [];
  edges(30, boxes, 'wall');
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
  return { id: 'arena', name: 'Arena', th: 'arena', half: 30, boxes, spawns: [[0, 24], [0, -24], [24, 0], [-24, 0], [-27, -27], [27, 27], [-27, 27], [27, -27]] };
}

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
  { th: 'space', name: 'Outer Space', col: 0x3a3a5a }
];
const PK_LEVELS = PK_INFO.length;
function airtime(dy) { const disc = 49 - 40 * dy; return disc < 0 ? 0 : (7 + Math.sqrt(disc)) / 20; }
function gapDist(a, b) {
  const dx = Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2), dz = Math.max(0, Math.abs(a.z - b.z) - (a.d + b.d) / 2);
  return Math.hypot(dx, dz);
}
const PK_SALT = {10: 2};   // levels re-rolled after the reachability test found an impossible jump
function parkour(L) {
  const r = rng(L * 7919 + 13 + (PK_SALT[L] || 0) * 104729), t = (L - 1) / (PK_LEVELS - 1), band = PK_INFO[L - 1];
  const f = 0.5 + 0.34 * t, V = 8.6, boxes = [], plats = [];
  const N = 12 + Math.round(L * 3);
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
      if ((r() < 0.12 + 0.3 * t || tries > 8) && !(prevRun && tries <= 20)) { const s = r() < 0.5 ? 1 : -1; d2 = dir[0] === 0 ? [s, 0] : [0, s]; }
      const last = i === N, run = !last && L >= 3 && i > 1 && placedRunOk && r() < 0.14 + 0.16 * t, size = last ? 6 : Math.max(2.6, (5.0 - 2.4 * t) * (0.85 + r() * 0.4));
      let w = size, dd = last ? 6 : Math.max(2.6, size * (0.85 + r() * 0.3));
      if (run) { if (d2[0] === 0) { w = 3.4; dd = 12; } else { w = 12; dd = 3.4; } }
      const up = r() < 0.45 ? r() * (0.35 + 0.65 * t) : -r() * (0.8 + 2 * t);
      const top = Math.max(-2, prev.top + (last ? Math.min(up, 0) : up));
      const dy = top - prev.top, allow = f * V * airtime(dy);
      if (allow <= 0.6) continue;
      const g = Math.max(1.2, allow * (0.6 + 0.4 * r()) - 0.2);
      const lat = (r() * 2 - 1) * (0.2 + 1.6 * t);
      const along = (d2[0] !== 0 ? (prev.w + w) / 2 : (prev.d + dd) / 2) + g;
      let x = prev.x + d2[0] * along + (d2[0] === 0 ? lat : 0), z = prev.z + d2[1] * along + (d2[1] === 0 ? lat : 0);
      const c = mk(x, z, w, dd, top, last ? 'finish' : 'plat');
      if (gapDist(prev, c) > allow) { continue; }
      if (plats.some((p, k) => k < plats.length - 1 && Math.abs(p.top - top) < 4 && overlaps(p, c, 1.5))) continue;
      placed = c; dir = d2; placed.run = run;
    }
    if (!placed) { // fallback: straight, easy step
      const w = i === N ? 6 : 3, dd = w, c = mk(prev.x + dir[0] * (prev.w / 2 + 3 + w / 2), prev.z + dir[1] * (prev.d / 2 + 3 + dd / 2), w, dd, prev.top, i === N ? 'finish' : 'plat');
      placed = c;
    }
    pathLen += Math.hypot(placed.x - prev.x, placed.z - prev.z);
    plats.push(placed); boxes.push(placed); placedRunOk = !placed.run;
    if (placed.run) {
      const along = dir[0] === 0 ? 'z' : 'x';
      for (const k of (L >= 7 ? [-1, 1] : [0])) {
        const bx = placed.x + (along === 'x' ? k * 3.2 : 0), bz = placed.z + (along === 'z' ? k * 2.6 : 0);
        boxes.push(B('barrier', bx, bz, along === 'x' ? 0.6 : 3.4, along === 'x' ? 3.4 : 0.6, 1.0, 0, placed.top));
      }
    }
  }
  const fin = plats[plats.length - 1];
  let minY = 0, maxY = 0, minX = 0, maxX = 0, minZ = 0, maxZ = 0;
  for (const p of plats) { minY = Math.min(minY, p.top); maxY = Math.max(maxY, p.top); minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  return {
    id: 'pk' + L, name: 'Level ' + L + ' - ' + band.name, biome: band.th, th: band.th, half: 2000, boxes, spawns: [[0, 0]], pk: {
      lv: L, n: PK_LEVELS, start: [0, 0, 0], cps: [], fin: [fin.x, fin.top, fin.z], kill: Math.min(minY, 0) - 14, pathLen,
      bounds: [minX - 20, maxX + 20, minZ - 20, maxZ + 20, minY, maxY]
    }
  };
}

const cache = new Map();
function getMap(id) {
  if (cache.has(id)) return cache.get(id);
  let m = null, k;
  if (id === 'arena') m = arena();
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
  m.wire = JSON.stringify({ t: 'map', id: m.id, name: m.name, th: m.th, half: m.half, b: m.boxes.map((b) => [b.kind, +b.x.toFixed(2), +b.z.toFixed(2), +b.w.toFixed(2), +b.d.toFixed(2), +b.h.toFixed(2), b.col, +b.y.toFixed(2)]), pk: m.pk || null });
  cache.set(id, m);
  return m;
}
function setSalt(L, v) { PK_SALT[L] = v; cache.delete('pk' + L); }
module.exports = { setSalt, getMap, PK_LEVELS, PK_INFO, airtime, gapDist };
