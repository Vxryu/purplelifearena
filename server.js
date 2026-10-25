// Purple Arena - authoritative multiplayer server with three game modes:
//   dm       Deathmatch: 1:30 matches, most kills wins
//   camp     Campaign: co-op, 10 levels with bosses
//   endless  Endless: co-op waves, one life, go as far as you can (the map changes every wave)
//   pk       Parkour: 20 timed levels with bunny hop, best times saved per level
// Clients send their position, shots and loadout. The server runs hit detection, mobs, damage and scores.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { getMap, endlessMapId, PK_LEVELS } = require('./maps');

const PORT = process.env.PORT || 3000;
const MATCH_SECONDS = 90;
const INTERMISSION = 10;
const MAX_PER_ROOM = 12;
const TICK = 0.05;              // 20 Hz

const page = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
const server = http.createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200); res.end('ok'); return; }
  if (req.url === '/' || req.url.startsWith('/?') || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(page); return;
  }
  res.writeHead(404); res.end('Not found');
});
const wss = new WebSocketServer({ server, maxPayload: 2048 });

// ---- maps live in maps.js; each room has room.map ----
const PLAYER_H = 1.8;

// ---- weapons (the client has the same stats) ----
const WEAPONS = {
  rifle:   { dmg: 20, rate: 0.11,  mag: 30,  spread: 0.012,  pellets: 1 },
  smg:     { dmg: 12, rate: 0.065, mag: 40,  spread: 0.03,   pellets: 1 },
  shotgun: { dmg: 11, rate: 0.85,  mag: 6,   spread: 0.075,  pellets: 8 },
  sniper:  { dmg: 95, rate: 0.95,  mag: 5,   spread: 0.0015, pellets: 1 },
  lmg:     { dmg: 26, rate: 0.085, mag: 100, spread: 0.022,  pellets: 1 }
};

// ---- mobs ----
const MOB_KEYS = ['grunt', 'runner', 'gunner', 'tank', 'brute', 'warden', 'hunter', 'overlord'];
const MOBS = {
  grunt:    { name: 'Walker',       hp: 50,   speed: 3.3, r: 0.5,  scale: 1,    melee: 10, meleeCd: 0.9, coin: 5 },
  runner:   { name: 'Runner',       hp: 30,   speed: 5.4, r: 0.45, scale: 0.92, melee: 8,  meleeCd: 0.7, coin: 6 },
  gunner:   { name: 'Gunner',       hp: 45,   speed: 2.4, r: 0.5,  scale: 1,    range: 24, dmg: 7, fireCd: 1.1, pellets: 1, coin: 8 },
  tank:     { name: 'Tank',         hp: 240,  speed: 1.8, r: 0.7,  scale: 1.35, melee: 28, meleeCd: 1.2, coin: 22 },
  brute:    { name: 'The Brute',    boss: true, hp: 900,  speed: 2.6, r: 0.9, scale: 1.8, melee: 34, meleeCd: 1.0, coin: 150 },
  warden:   { name: 'The Warden',   boss: true, hp: 1700, speed: 1.9, r: 1.0, scale: 1.9, range: 28, dmg: 8, fireCd: 1.4, pellets: 5, summon: { type: 'grunt', count: 2, every: 9 }, coin: 300 },
  hunter:   { name: 'The Hunter',   boss: true, hp: 1400, speed: 4.2, r: 0.8, scale: 1.5, range: 26, dmg: 9, fireCd: 0.45, pellets: 1, melee: 20, meleeCd: 1.0, coin: 400 },
  overlord: { name: 'The Overlord', boss: true, hp: 4200, speed: 2.3, r: 1.1, scale: 2.2, range: 30, dmg: 9, fireCd: 1.0, pellets: 4, melee: 40, meleeCd: 1.2, summon: { type: 'gunner', count: 2, every: 8 }, coin: 1000 }
};
const BOSS_CYCLE = ['brute', 'warden', 'hunter', 'overlord'];
// campaign: counts per level (a boss goes first in the queue)
const LEVELS = [
  { grunt: 6 },
  { grunt: 8, gunner: 3 },
  { grunt: 6, gunner: 4, brute: 1 },
  { grunt: 8, gunner: 5, runner: 6 },
  { warden: 1, gunner: 4, grunt: 6 },
  { tank: 2, gunner: 6, runner: 8 },
  { hunter: 1, runner: 8, gunner: 4 },
  { tank: 4, gunner: 8, grunt: 10 },
  { tank: 4, runner: 12, gunner: 8, grunt: 8 },
  { overlord: 1, tank: 3, gunner: 8 }
];

function pushOut(map, p, r, y) {
  y = y || 0;
  for (const b of map.boxes) {
    const top = b.y + b.h;
    if (y >= top - 0.05 || y + PLAYER_H <= b.y) continue;   // standing on it / passing under it
    const nx = Math.max(b.x - b.w / 2, Math.min(p.x, b.x + b.w / 2));
    const nz = Math.max(b.z - b.d / 2, Math.min(p.z, b.z + b.d / 2));
    let dx = p.x - nx, dz = p.z - nz, d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 < 1e-6) { dx = p.x - b.x; dz = p.z - b.z; d2 = dx * dx + dz * dz || 1; }
      const d = Math.sqrt(d2), k = (r - d) / d;
      p.x += dx * k; p.z += dz * k;
    }
  }
  if (!map.pk) {
    p.x = Math.max(-map.half + r, Math.min(map.half - r, p.x));
    p.z = Math.max(-map.half + r, Math.min(map.half - r, p.z));
  }
}
function insideBox(map, x, z, pad) { return map.boxes.some((b) => Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad); }

// ---- ray helpers ----
function rayBox(o, d, b) {
  let tmin = 0, tmax = 1e9;
  const lo = [b.x - b.w / 2, b.y, b.z - b.d / 2], hi = [b.x + b.w / 2, b.y + b.h, b.z + b.d / 2], oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dd[i]) < 1e-9) { if (oo[i] < lo[i] || oo[i] > hi[i]) return Infinity; continue; }
    let t1 = (lo[i] - oo[i]) / dd[i], t2 = (hi[i] - oo[i]) / dd[i];
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}
function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - cc;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}
function rayCyl(o, d, cx, cz, r, y0, y1) {
  const ox = o.x - cx, oz = o.z - cz, a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return Infinity;
  const b = ox * d.x + oz * d.z, c = ox * ox + oz * oz - r * r, disc = b * b - a * c;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < 0) return Infinity;
  const y = o.y + d.y * t;
  return y >= y0 && y <= y1 ? t : Infinity;
}
function blockedLine(map, a, b) {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, l = Math.hypot(d.x, d.y, d.z) || 1;
  d.x /= l; d.y /= l; d.z /= l;
  for (const bx of map.boxes) if (rayBox(a, d, bx) < l) return true;
  return false;
}

// ---- helpers ----
const PALETTE = ['#b46bff', '#ff4d7a', '#4ad1c2', '#ffb347', '#7aa8ff', '#9be15d', '#f1eaff', '#ff7a45'];
const validColor = (c) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : null);
const r1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function send(p, o) { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(o)); }
function broadcast(room, o, except) { const s = JSON.stringify(o); for (const p of room.players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(s); }
const plist = (room) => [...room.players.values()];

// ---- rooms ----
function makeRoom(mode, mapId) {
  return { mode, map: getMap(mapId), players: new Map(), mobs: [], queue: [], phase: mode === 'dm' ? 'play' : 'idle', timeLeft: MATCH_SECONDS, t: 0, level: 1, wave: 0, spawnT: 0, nextMob: 1, info: '', boss: null };
}
const rooms = { dm: makeRoom('dm', 'arena'), camp: makeRoom('camp', 'forest1'), endless: makeRoom('endless', 'arena') };
const pkRooms = {};
function pkRoom(n) { if (!pkRooms[n]) { pkRooms[n] = makeRoom('pk', 'pk' + n); pkRooms[n].level = n; } return pkRooms[n]; }
const allRooms = () => Object.values(rooms).concat(Object.values(pkRooms));
let nextId = 1;

function freeSpot(map, cx, cz, rad) {
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * 6.283, d = i === 0 ? 0 : Math.random() * rad * (1 + i / 20);
    const x = clamp(cx + Math.cos(a) * d, -map.half + 1.5, map.half - 1.5), z = clamp(cz + Math.sin(a) * d, -map.half + 1.5, map.half - 1.5);
    if (!insideBox(map, x, z, 0.9)) return [x, z];
  }
  return [cx, cz];
}
function spawnPoint(room, self) {
  let best = room.map.spawns[0], bd = -1;
  for (const s of room.map.spawns) {
    let d = 99;
    for (const q of room.players.values()) if (q !== self && !q.dead) d = Math.min(d, Math.hypot(q.x - s[0], q.z - s[1]));
    d += Math.random() * 3;
    if (d > bd) { bd = d; best = s; }
  }
  return best;
}
function pkSpot(room, p) {
  const pk = room.map.pk, c = p.cp > 0 ? pk.cps[p.cp - 1] : pk.start;
  return [c[0], c[1] + 0.05, c[2]];
}
function respawn(room, p) {
  if (room.mode === 'pk') {
    const q = pkSpot(room, p);
    p.x = q[0]; p.y = q[1]; p.z = q[2]; p.hp = 100; p.dead = false; p.inv = 0;
    send(p, { t: 'respawn', x: p.x, y: p.y, z: p.z, hp: 100 });
    return;
  }
  let sp;
  if (room.mode === 'dm') sp = spawnPoint(room, p).slice();
  else sp = freeSpot(room.map, ...room.map.spawns[Math.floor(Math.random() * room.map.spawns.length)], 1.5);
  if (room.mode === 'dm') sp = freeSpot(room.map, sp[0], sp[1], 0.5);
  p.x = sp[0]; p.z = sp[1]; p.y = 0; p.hp = 100; p.dead = false; p.deadT = 0; p.inv = 2; p.hurtT = 99;
  send(p, { t: 'respawn', x: p.x, y: 0, z: p.z, hp: 100 });
}
// new map for a running room: tell the players and move them (the dead stay dead)
function changeMap(room, id) {
  room.map = getMap(id);
  const wire = room.map.wire;
  for (const p of room.players.values()) {
    if (p.ws.readyState === 1) p.ws.send(wire);
    if (!p.dead) {
      const sp = freeSpot(room.map, ...room.map.spawns[Math.floor(Math.random() * room.map.spawns.length)], 2);
      p.x = sp[0]; p.z = sp[1]; p.y = 0; p.inv = 2;
      send(p, { t: 'tp', x: p.x, y: 0, z: p.z });
    }
  }
}

// ---- players taking damage ----
function hurtPlayer(room, p, dmg, by) {
  if (p.dead || p.inv > 0) return;
  p.hp -= dmg; p.hurtT = 0;
  if (p.hp > 0) { send(p, { t: 'hurt', hp: Math.round(p.hp) }); return; }
  p.hp = 0; p.dead = true; p.deadT = room.mode === 'camp' ? 8 : 9999; p.deaths++; p.streak = 0;
  send(p, { t: 'dead', by });
  broadcast(room, { t: 'k', a: by, v: p.name, h: 0, st: 0 });
}

// ---- shooting ----
function shoot(room, s, m) {
  if (s.dead) return;
  if (room.mode === 'pk') return;
  if (room.mode === 'dm' && room.phase !== 'play') return;
  if (room.mode !== 'dm' && room.phase !== 'play' && room.phase !== 'break') return;
  const W = WEAPONS[room.mode === 'dm' ? 'rifle' : s.weapon] || WEAPONS.rifle;
  const t = Date.now();
  if (t - s.lastShot < W.rate * 800) return;
  s.lastShot = t;
  const yaw = typeof m.yaw === 'number' && isFinite(m.yaw) ? m.yaw : s.yaw;
  const pitch = clamp(typeof m.pitch === 'number' && isFinite(m.pitch) ? m.pitch : s.pitch, -1.5, 1.5);
  const o = { x: s.x, y: s.y + 1.7, z: s.z }, cp = Math.cos(pitch);
  const hits = new Map(); let first = null;
  for (let i = 0; i < W.pellets; i++) {
    const d = { x: -Math.sin(yaw) * cp + (Math.random() - 0.5) * W.spread * 2, y: Math.sin(pitch) + (Math.random() - 0.5) * W.spread * 2, z: -Math.cos(yaw) * cp + (Math.random() - 0.5) * W.spread * 2 };
    const l = Math.hypot(d.x, d.y, d.z); d.x /= l; d.y /= l; d.z /= l;
    let tBest = 120, target = null, head = false;
    for (const b of room.map.boxes) { const tb = rayBox(o, d, b); if (tb < tBest) tBest = tb; }
    const cands = room.mode === 'dm' ? plist(room).filter((v) => v !== s && !v.dead && v.inv <= 0) : room.mobs;
    for (const v of cands) {
      const sc = v.T ? v.T.scale : 1, vy = v.y || 0;
      const th = raySphere(o, d, { x: v.x, y: vy + 1.55 * sc, z: v.z }, 0.32 * sc);
      const tb = rayCyl(o, d, v.x, v.z, 0.5 * sc, vy, vy + 1.3 * sc);
      if (th < tBest) { tBest = th; target = v; head = true; }
      if (tb < tBest) { tBest = tb; target = v; head = false; }
    }
    if (i === 0) first = { x: o.x + d.x * tBest, y: o.y + d.y * tBest, z: o.z + d.z * tBest };
    if (target) { const rec = hits.get(target) || { dmg: 0, head: false }; rec.dmg += head ? W.dmg * 2 : W.dmg; rec.head = rec.head || head; hits.set(target, rec); }
  }
  broadcast(room, { t: 'sh', id: s.id, ox: r1(o.x), oy: r1(o.y), oz: r1(o.z), hx: r1(first.x), hy: r1(first.y), hz: r1(first.z) }, s);
  for (const [target, rec] of hits) {
    if (room.mode === 'dm') hitPlayerDm(room, s, target, rec);
    else hitMob(room, s, target, rec);
  }
}
function hitPlayerDm(room, s, hit, rec) {
  hit.hp -= rec.dmg; hit.hurtT = 0;
  if (hit.hp > 0) { send(s, { t: 'hm', h: rec.head ? 1 : 0, k: 0 }); send(hit, { t: 'hurt', hp: Math.round(hit.hp) }); return; }
  hit.hp = 0; hit.dead = true; hit.deadT = 2.2; hit.deaths++; hit.streak = 0;
  s.kills++; s.streak++; s.best = Math.max(s.best, s.streak);
  if (rec.head) s.heads++;
  s.coinsRun += 10;
  send(s, { t: 'hm', h: rec.head ? 1 : 0, k: 1, c: 10 });
  if (s.streak >= 5) send(s, { t: 'streak', n: s.streak });
  send(hit, { t: 'dead', by: s.name });
  broadcast(room, { t: 'k', a: s.name, v: hit.name, h: rec.head ? 1 : 0, st: s.streak });
}
function hitMob(room, s, mob, rec) {
  mob.hp -= rec.dmg;
  if (mob.hp > 0) { send(s, { t: 'hm', h: rec.head ? 1 : 0, k: 0 }); return; }
  room.mobs = room.mobs.filter((x) => x !== mob);
  s.kills++; s.streak++; s.best = Math.max(s.best, s.streak); if (rec.head) s.heads++;
  s.coinsRun += mob.T.coin;
  send(s, { t: 'hm', h: rec.head ? 1 : 0, k: 1, c: mob.T.coin });
  if (s.streak >= 5) send(s, { t: 'streak', n: s.streak });
  broadcast(room, { t: 'mk', id: mob.id, x: r1(mob.x), z: r1(mob.z), s: mob.T.scale, b: mob.T.boss ? 1 : 0 });
  if (mob.T.boss) broadcast(room, { t: 'k', a: s.name, v: mob.T.name, h: 0, st: 0 });
}

// ---- mobs ----
function hpMul(room) {
  const n = Math.max(1, room.players.size);
  const prog = room.mode === 'camp' ? 1 + 0.08 * (room.level - 1) : 1 + 0.06 * (Math.max(1, room.wave) - 1);
  return (1 + 0.5 * (n - 1)) * prog;
}
function spawnMob(room, key, x, z) {
  const T = MOBS[key];
  if (x == null) {
    const alive = plist(room).filter((p) => !p.dead), map = room.map;
    const around = alive.length ? alive[Math.floor(Math.random() * alive.length)] : { x: 0, z: 0 };
    const rmin = Math.min(22, map.half * 0.6), rmax = Math.min(32, map.half - 4);
    for (let tries = 0; tries < 24; tries++) {
      const a = Math.random() * Math.PI * 2, rr = rmin + Math.random() * (rmax - rmin);
      x = clamp(around.x + Math.cos(a) * rr, -map.half + 2, map.half - 2); z = clamp(around.z + Math.sin(a) * rr, -map.half + 2, map.half - 2);
      if (insideBox(map, x, z, 1.2)) continue;
      if (alive.every((p) => Math.hypot(p.x - x, p.z - z) > 14)) break;
    }
  }
  const hp = Math.round(T.hp * hpMul(room));
  const m = { id: room.nextMob++, key, T, x, z, y: 0, yaw: 0, hp, maxHp: hp, r: T.r, atkT: 0.5, fireT: 1 + Math.random(), sumT: T.summon ? T.summon.every : 0,
    strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 1, stuck: 0, stuckAcc: 0, side: 1, speed: T.speed * (0.9 + Math.random() * 0.2) };
  room.mobs.push(m);
  return m;
}
function dmgMul(room) { return room.mode === 'camp' ? 1 + 0.06 * (room.level - 1) : 1 + 0.04 * (Math.max(1, room.wave) - 1); }
function updateMobs(room, dt) {
  const alive = plist(room).filter((p) => !p.dead);
  const dm = dmgMul(room);
  for (const m of room.mobs) {
    const T = m.T;
    let tgt = null, bd = 1e9;
    for (const p of alive) { const d = (p.x - m.x) ** 2 + (p.z - m.z) ** 2; if (d < bd) { bd = d; tgt = p; } }
    if (!tgt) continue;
    const dx = tgt.x - m.x, dz = tgt.z - m.z, dist = Math.hypot(dx, dz) || 1;
    m.yaw = Math.atan2(-dx, -dz);
    let mx = 0, mz = 0;
    if (T.range) {
      if (dist > T.range * 0.7) { mx = dx / dist; mz = dz / dist; } else if (dist < T.range * 0.35) { mx = -dx / dist; mz = -dz / dist; }
      m.strafeT -= dt; if (m.strafeT <= 0) { m.strafe *= -1; m.strafeT = 1 + Math.random() * 2; }
      mx += -dz / dist * m.strafe * 0.5; mz += dx / dist * m.strafe * 0.5;
    } else if (dist > m.r + 0.55) { mx = dx / dist; mz = dz / dist; }
    if (m.stuck > 0) { m.stuck -= dt; const a = m.side * 1.1, c = Math.cos(a), s = Math.sin(a); const nx = mx * c - mz * s; mz = mx * s + mz * c; mx = nx; }
    const ox = m.x, oz = m.z, want = Math.hypot(mx, mz) * m.speed * dt;
    m.x += mx * m.speed * dt; m.z += mz * m.speed * dt;
    pushOut(room.map, m, m.r, 0);
    if (want > 0.001 && Math.hypot(m.x - ox, m.z - oz) < want * 0.4) { m.stuckAcc += dt; if (m.stuckAcc > 0.3) { m.stuck = 0.9; m.side = Math.random() < 0.5 ? 1 : -1; m.stuckAcc = 0; } } else m.stuckAcc = 0;
    for (const o of room.mobs) {
      if (o === m) continue;
      const ex = m.x - o.x, ez = m.z - o.z, ed = Math.hypot(ex, ez), min = m.r + o.r;
      if (ed > 0 && ed < min) { const k = (min - ed) / 2 / ed; m.x += ex * k; m.z += ez * k; }
    }
    m.atkT -= dt;
    if (T.melee && dist < m.r + 0.9 && m.atkT <= 0) { m.atkT = T.meleeCd; hurtPlayer(room, tgt, T.melee * dm, T.name); }
    if (T.range) {
      m.fireT -= dt;
      const head = { x: m.x, y: 1.5 * T.scale, z: m.z }, eye = { x: tgt.x, y: tgt.y + 1.5, z: tgt.z };
      if (m.fireT <= 0 && dist < T.range && !blockedLine(room.map, head, eye)) {
        m.fireT = T.fireCd * (0.8 + Math.random() * 0.4);
        const hc = clamp(0.8 - dist * 0.025, 0.15, 0.75);
        for (let i = 0; i < (T.pellets || 1); i++) {
          const hit = Math.random() < hc;
          const e = hit ? eye : { x: eye.x + (Math.random() - 0.5) * 4, y: eye.y + (Math.random() - 0.5) * 2, z: eye.z + (Math.random() - 0.5) * 4 };
          broadcast(room, { t: 'mt', ox: r1(head.x), oy: r1(head.y), oz: r1(head.z), hx: r1(e.x), hy: r1(e.y), hz: r1(e.z) });
          if (hit) hurtPlayer(room, tgt, T.dmg * dm, T.name);
        }
      }
    }
    if (T.summon) {
      m.sumT -= dt;
      if (m.sumT <= 0 && room.mobs.length < 30) {
        m.sumT = T.summon.every;
        for (let i = 0; i < T.summon.count; i++) { const a = Math.random() * 6.283; const hh = room.map.half - 2, sx = clamp(m.x + Math.cos(a) * 3, -hh, hh), sz = clamp(m.z + Math.sin(a) * 3, -hh, hh); if (!insideBox(room.map, sx, sz, 0.8)) spawnMob(room, T.summon.type, sx, sz); }
      }
    }
  }
}
function feedQueue(room, dt) {
  room.spawnT -= dt;
  const cap = (room.mode === 'camp' ? 12 : 16) + 4 * (Math.max(1, room.players.size) - 1);
  if (room.spawnT <= 0 && room.queue.length && room.mobs.length < cap) { spawnMob(room, room.queue.shift()); room.spawnT = 0.45; }
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ---- mode logic: deathmatch ----
function dmBoard(room) {
  return plist(room).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths).map((p) => [p.id, p.name, p.kills, p.deaths, p.heads, p.best, p.color, p.coinsRun]);
}
function dmNewMatch(room) {
  room.phase = 'play'; room.timeLeft = MATCH_SECONDS;
  for (const p of room.players.values()) { p.kills = 0; p.deaths = 0; p.heads = 0; p.streak = 0; p.best = 0; p.coinsRun = 0; respawn(room, p); }
  broadcast(room, { t: 'new' });
}
function dmTick(room) {
  room.timeLeft -= TICK;
  if (room.phase === 'play' && room.timeLeft <= 0) { room.phase = 'over'; room.timeLeft = INTERMISSION; broadcast(room, { t: 'end', board: dmBoard(room), msg: '' }); }
  else if (room.phase === 'over' && room.timeLeft <= 0) dmNewMatch(room);
  for (const p of room.players.values()) {
    if (p.dead && p.deadT > 0) { p.deadT -= TICK; if (p.deadT <= 0 && room.phase === 'play') respawn(room, p); }
  }
  const secs = Math.max(0, Math.ceil(room.timeLeft));
  room.info = room.phase === 'play' ? Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0') : 'Next match in ' + secs + 's';
}

// ---- mode logic: campaign ----
function buildQueue(counts) {
  const bosses = [], mobs = [];
  for (const k of Object.keys(counts)) for (let i = 0; i < counts[k]; i++) (MOBS[k].boss ? bosses : mobs).push(k);
  return bosses.concat(shuffle(mobs));
}
function startLevel(room, L) {
  room.level = L; room.mobs = []; room.queue = buildQueue(LEVELS[L - 1]); room.phase = 'play'; room.spawnT = 1.5;
  room.map = getMap('forest' + L);
  for (const p of room.players.values()) { if (p.ws.readyState === 1) p.ws.send(room.map.wire); respawn(room, p); }
  const boss = room.queue.find((k) => MOBS[k].boss);
  broadcast(room, { t: 'ban', text: 'Level ' + L + (boss ? ' - ' + MOBS[boss].name : '') });
}
function campBonus(room, n) { for (const p of room.players.values()) { p.coinsRun += n; send(p, { t: 'cn', n }); } }
function campTick(room) {
  if (!room.players.size) { room.phase = 'idle'; room.mobs = []; room.queue = []; room.level = 1; room.info = ''; return; }
  if (room.phase === 'idle') { startLevel(room, 1); }
  const ps = plist(room);
  if (room.phase === 'play') {
    feedQueue(room, TICK); updateMobs(room, TICK);
    for (const p of ps) if (p.dead && p.deadT > 0) { p.deadT -= TICK; if (p.deadT <= 0) respawn(room, p); }
    if (ps.every((p) => p.dead)) { room.phase = 'retry'; room.t = 3; broadcast(room, { t: 'ban', text: 'Squad down. Retrying level ' + room.level }); }
    else if (!room.queue.length && !room.mobs.length) {
      room.phase = 'clear'; room.t = 4; campBonus(room, 25 * room.level);
      broadcast(room, { t: 'ban', text: 'Level ' + room.level + ' cleared  +' + (25 * room.level) + ' coins' });
    }
  } else if (room.phase === 'clear') {
    room.t -= TICK;
    if (room.t <= 0) {
      if (room.level >= 10) {
        room.phase = 'victory'; room.t = 14; campBonus(room, 500);
        broadcast(room, { t: 'end', board: dmBoard(room), msg: 'Campaign complete! +500 coins' });
      } else startLevel(room, room.level + 1);
    }
  } else if (room.phase === 'retry') {
    room.t -= TICK; if (room.t <= 0) startLevel(room, room.level);
  } else if (room.phase === 'victory') {
    room.t -= TICK;
    if (room.t <= 0) { for (const p of ps) { p.kills = 0; p.deaths = 0; p.heads = 0; p.streak = 0; p.best = 0; p.coinsRun = 0; } startLevel(room, 1); broadcast(room, { t: 'new' }); }
  }
  const left = room.queue.length + room.mobs.length;
  room.info = room.phase === 'victory' ? 'Campaign complete' : 'Level ' + room.level + '/10 · ' + left + ' left';
  const boss = room.mobs.find((m) => m.T.boss);
  room.boss = boss ? [boss.T.name, Math.max(0, Math.round(boss.hp / boss.maxHp * 100))] : null;
}

// ---- mode logic: endless ----
function endlessQueue(w) {
  const q = [], total = 6 + Math.floor(w * 2.6);
  for (let i = 0; i < total; i++) {
    const r = Math.random();
    q.push(w >= 4 && r < 0.12 ? 'tank' : w >= 2 && r < 0.38 ? 'gunner' : w >= 3 && r < 0.58 ? 'runner' : 'grunt');
  }
  if (w % 5 === 0) q.unshift(BOSS_CYCLE[(w / 5 - 1) % 4]);
  return q;
}
function startWave(room, w) {
  room.wave = w; room.queue = endlessQueue(w); room.phase = 'play'; room.spawnT = 1.5;
  changeMap(room, endlessMapId(w));
  broadcast(room, { t: 'ban', text: 'Wave ' + w + ' - ' + room.map.name + (w % 5 === 0 ? ' - Boss' : '') });
}
function endlessReset(room) {
  room.mobs = []; room.queue = []; room.wave = 0;
  room.map = getMap(endlessMapId(1));
  for (const p of room.players.values()) { p.kills = 0; p.deaths = 0; p.heads = 0; p.streak = 0; p.best = 0; p.coinsRun = 0; if (p.ws.readyState === 1) p.ws.send(room.map.wire); respawn(room, p); }
  startWave(room, 1);
}
function endlessTick(room) {
  if (!room.players.size) { room.phase = 'idle'; room.mobs = []; room.queue = []; room.wave = 0; room.info = ''; return; }
  if (room.phase === 'idle') endlessReset(room);
  const ps = plist(room);
  if (room.phase === 'play') {
    feedQueue(room, TICK); updateMobs(room, TICK);
    if (ps.every((p) => p.dead)) {
      room.phase = 'over'; room.t = INTERMISSION; room.mobs = []; room.queue = [];
      broadcast(room, { t: 'end', board: dmBoard(room), msg: 'Your squad reached wave ' + room.wave });
    } else if (!room.queue.length && !room.mobs.length) {
      room.phase = 'break'; room.t = 4;
      for (const p of ps) { p.coinsRun += 10 * room.wave; send(p, { t: 'cn', n: 10 * room.wave }); if (!p.dead) { p.hp = Math.min(100, p.hp + 30); send(p, { t: 'hurt', hp: Math.round(p.hp), regen: 1 }); } }
      broadcast(room, { t: 'ban', text: 'Wave ' + room.wave + ' cleared  +' + (10 * room.wave) + ' coins' });
    }
  } else if (room.phase === 'break') {
    room.t -= TICK; if (room.t <= 0) startWave(room, room.wave + 1);
  } else if (room.phase === 'over') {
    room.t -= TICK; if (room.t <= 0) { endlessReset(room); broadcast(room, { t: 'new' }); }
  }
  const left = room.queue.length + room.mobs.length;
  room.info = room.phase === 'over' ? 'Run over' : 'Wave ' + room.wave + ' · ' + left + ' left';
  const boss = room.mobs.find((m) => m.T.boss);
  room.boss = boss ? [boss.T.name, Math.max(0, Math.round(boss.hp / boss.maxHp * 100))] : null;
}

// ---- tick ----
function playersCommon(room) {
  for (const p of room.players.values()) {
    if (p.dead) continue;
    p.inv = Math.max(0, p.inv - TICK); p.hurtT += TICK;
    if (p.hurtT > (room.mode === 'dm' ? 5 : 7) && p.hp < 100) {
      p.hp = Math.min(100, p.hp + (room.mode === 'dm' ? 12 : 8) * TICK);
      if (Math.floor(p.hp) % 4 === 0) send(p, { t: 'hurt', hp: Math.round(p.hp), regen: 1 });
    }
  }
}
function snapshot(room) {
  const list = plist(room).map((p) => [p.id, p.name, r1(p.x), r1(p.y), r1(p.z), Math.round(p.yaw * 100) / 100, Math.round(p.pitch * 100) / 100,
    p.dead ? 1 : 0, room.mode === 'pk' ? p.cp : p.kills, room.mode === 'dm' ? p.deaths : room.mode === 'pk' ? p.falls : p.coinsRun, p.color, p.inv > 0 ? 1 : 0, p.tone]);
  const mobs = room.mobs.map((m) => [m.id, MOB_KEYS.indexOf(m.key), r1(m.x), r1(m.z), Math.round(m.yaw * 100) / 100, Math.max(1, Math.round(m.hp / m.maxHp * 100))]);
  const s = JSON.stringify({ t: 's', p: list, m: mobs, ph: room.phase, ib: room.info, boss: room.boss, tl: Math.max(0, Math.round(room.timeLeft * 10) / 10) });
  for (const p of room.players.values()) if (p.ws.readyState === 1) p.ws.send(s);
}
setInterval(() => {
  for (const room of allRooms()) {
    if (room.mode === 'pk' && !room.players.size) continue;
    if (room.mode === 'dm') dmTick(room); else if (room.mode === 'camp') campTick(room); else if (room.mode === 'endless') endlessTick(room); else room.info = room.map.name;
    if (room.mode !== 'pk') playersCommon(room);
    snapshot(room);
  }
}, TICK * 1000);

// ---- parkour best times (saved to scores.json; set DATA_DIR to keep them somewhere else) ----
const SCORE_FILE = path.join(process.env.DATA_DIR || __dirname, 'scores.json');
let scores = {};
try { scores = JSON.parse(fs.readFileSync(SCORE_FILE, 'utf8')); } catch (e) { scores = {}; }
let saveT = null;
function saveScores() { if (saveT) return; saveT = setTimeout(() => { saveT = null; fs.writeFile(SCORE_FILE, JSON.stringify(scores), () => {}); }, 2000); }
function board(lv) { return (scores[lv] || []).slice(0, 10).map((r) => [r.n, r.t]); }
function recordTime(lv, name, time) {
  const list = scores[lv] || (scores[lv] = []);
  const key = name.toLowerCase(), old = list.find((r) => r.n.toLowerCase() === key);
  let pb = false;
  if (!old) { list.push({ n: name, t: time }); pb = true; } else if (time < old.t) { old.t = time; old.n = name; pb = true; }
  list.sort((a, b) => a.t - b.t); if (list.length > 50) list.length = 50;
  if (pb) saveScores();
  return { pb, rank: list.findIndex((r) => r.n.toLowerCase() === key) + 1 };
}
function sendBoard(lv, to) {
  const msg = { t: 'lb', lv, rows: board(lv) };
  if (to) send(to, msg); else broadcast(pkRoom(lv), msg);
}

// ---- connections ----
function enterRoom(me, room) {
  if (me.room) me.room.players.delete(me.id);
  me.room = room; room.players.set(me.id, me);
  me.cp = 0; me.pkStart = 0; me.finished = false; me.falls = 0; me.kills = 0; me.deaths = 0; me.streak = 0; me.best = 0; me.heads = 0; me.coinsRun = 0;
  me.dead = false; me.hp = 100;
  send(me, { t: 'hi', id: me.id, mode: room.mode, lv: room.level });
  if (me.ws.readyState === 1) me.ws.send(room.map.wire);
  respawn(room, me);
  if (room.mode === 'pk') sendBoard(room.level, me);
}
wss.on('connection', (ws) => {
  let me = null;
  ws.on('message', (data) => {
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    const room = me && me.room;
    if (m.t === 'join' && !me) {
      let r = rooms[m.mode];
      if (m.mode === 'pk') r = pkRoom(clamp(Math.floor(+m.level) || 1, 1, PK_LEVELS));
      if (!r) return;
      if (r.players.size >= MAX_PER_ROOM) { ws.send(JSON.stringify({ t: 'full' })); return; }
      const name = String(m.name || 'Player').replace(/[<>&"'`]/g, '').trim().slice(0, 14) || 'Player';
      me = { id: nextId++, ws, name, color: validColor(m.color) || PALETTE[Math.floor(Math.random() * PALETTE.length)], tone: clamp(Math.floor(+m.tone) || 0, 0, 4),
        weapon: WEAPONS[m.weapon] ? m.weapon : 'rifle', room: null, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100, dead: false, deadT: 0, inv: 0, hurtT: 99,
        kills: 0, deaths: 0, heads: 0, streak: 0, best: 0, coinsRun: 0, lastShot: 0, lastSt: Date.now(), cp: 0, pkStart: 0, finished: false, falls: 0 };
      enterRoom(me, r);
    } else if (m.t === 'st' && me && !me.dead) {
      if (![m.x, m.y, m.z, m.yaw, m.pitch].every((v) => typeof v === 'number' && isFinite(v))) return;
      const t = Date.now(), dt = Math.min(0.5, (t - me.lastSt) / 1000); me.lastSt = t;
      const map = room.map, pk = map.pk;
      let nx = m.x, nz = m.z;
      const maxd = 34 * dt + 1.2, dx = nx - me.x, dz = nz - me.z, dd = Math.hypot(dx, dz);
      if (dd > maxd) { nx = me.x + dx / dd * maxd; nz = me.z + dz / dd * maxd; }
      const p = { x: nx, z: nz }; pushOut(map, p, 0.45, m.y);
      me.x = p.x; me.z = p.z; me.yaw = m.yaw; me.pitch = clamp(m.pitch, -1.5, 1.5);
      if (!pk) { me.y = clamp(m.y, 0, 3); return; }
      me.y = clamp(m.y, pk.kill - 5, pk.bounds[5] + 12);
      if (me.finished) return;
      if (!me.pkStart && Math.hypot(me.x - pk.start[0], me.z - pk.start[2]) > 1.8) { me.pkStart = Date.now(); send(me, { t: 'pks' }); }
      const nextCp = pk.cps[me.cp];
      if (nextCp && Math.hypot(me.x - nextCp[0], me.z - nextCp[2]) < 2.6 && Math.abs(me.y - nextCp[1]) < 2.2) { me.cp++; send(me, { t: 'cp', i: me.cp, n: pk.cps.length }); }
      else if (!nextCp && me.pkStart && Math.hypot(me.x - pk.fin[0], me.z - pk.fin[2]) < 3.2 && Math.abs(me.y - pk.fin[1]) < 2.2) {
        const time = (Date.now() - me.pkStart) / 1000;
        if (time < pk.pathLen / 26) return;      // faster than anybody could run it
        me.finished = true;
        const res = recordTime(room.level, me.name, Math.round(time * 100) / 100);
        send(me, { t: 'fin', lv: room.level, time: Math.round(time * 100) / 100, rank: res.rank, pb: res.pb ? 1 : 0, rows: board(room.level) });
        if (res.pb) sendBoard(room.level);
      }
    } else if (m.t === 'shot' && me) {
      shoot(room, me, m);
    } else if (m.t === 'fell' && me && room.mode === 'pk') {
      me.falls++; respawn(room, me);
    } else if (m.t === 'restart' && me && room.mode === 'pk') {
      me.cp = 0; me.pkStart = 0; me.finished = false; respawn(room, me);
    } else if (m.t === 'lvl' && me && room.mode === 'pk') {
      const n = clamp(Math.floor(+m.n) || 1, 1, PK_LEVELS), r = pkRoom(n);
      if (r !== room && r.players.size < MAX_PER_ROOM) enterRoom(me, r); else if (r === room) { me.cp = 0; me.pkStart = 0; me.finished = false; respawn(room, me); sendBoard(n, me); }
    } else if (m.t === 'color' && me) {
      const c = validColor(m.color); if (c) me.color = c;
      if (m.tone != null) me.tone = clamp(Math.floor(+m.tone) || 0, 0, 4);
    }
  });
  ws.on('close', () => { if (me && me.room) me.room.players.delete(me.id); });
  ws.on('error', () => {});
});

server.listen(PORT, () => console.log('Purple Arena running on port ' + PORT));
