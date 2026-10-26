// Purple Arena - authoritative multiplayer server with two game modes:
//   dm       Deathmatch: 1:30 matches, most kills wins
//   pk       Parkour: 10 timed levels (one biome each) with bunny hop, best times saved per level
// Clients send their position and shots. The server runs hit detection, scores and the parkour timer.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { getMap, DM_MAPS, PK_LEVELS } = require('./maps');

const PORT = process.env.PORT || 3000;
const MATCH_SECONDS = +process.env.MATCH_S || 90;
const INTERMISSION = 10;
const MAX_PER_ROOM = 12;
const TICK = 0.05;              // 20 Hz

// index.html is normally in public/, but also accepted next to server.js (in case the folder was not uploaded to GitHub)
const pageFile = [path.join(__dirname, 'public', 'index.html'), path.join(__dirname, 'index.html')].find((f) => fs.existsSync(f));
if (!pageFile) { console.error('index.html not found: put it in a "public" folder next to server.js'); process.exit(1); }
const page = fs.readFileSync(pageFile);
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
const chatLog = [];

// ---- weapons (the client has the same stats) ----
const WEAPONS = {
  rifle:   { dmg: 20, rate: 0.11,  mag: 30,  spread: 0.012,  pellets: 1 },
  smg:     { dmg: 12, rate: 0.065, mag: 40,  spread: 0.03,   pellets: 1 },
  shotgun: { dmg: 11, rate: 0.85,  mag: 6,   spread: 0.075,  pellets: 8 },
  sniper:  { dmg: 95, rate: 0.95,  mag: 5,   spread: 0.0015, pellets: 1 },
  lmg:     { dmg: 26, rate: 0.085, mag: 100, spread: 0.022,  pellets: 1 }
};

// deathmatch loadout: rifle, sniper (one shot, long cooldown) and knife
const DM_GUNS = { rifle: WEAPONS.rifle, sniper: { dmg: 100, rate: 2.0, spread: 0.0008, pellets: 1 } };
const STAB_DMG = 50, STAB_BACK = 200, STAB_RANGE = 2.3, STAB_CD = 450, THROW_CD = 2500, KNIFE_SPEED = 38, KNIFE_G = 8;
const CUR_IDX = { rifle: 0, sniper: 1, knife: 2 };

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
  return { mode, map: getMap(mapId), players: new Map(), phase: 'play', timeLeft: MATCH_SECONDS, level: 1, info: '', dmIdx: 0 };
}
const rooms = { dm: makeRoom('dm', 'arena') };
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
// ---- players taking damage ----
// ---- shooting ----
function shoot(room, s, m) {
  if (s.dead) return;
  if (room.mode === 'pk') return;
  if (room.mode === 'dm' && room.phase !== 'play') return;
  if (room.mode !== 'dm' && room.phase !== 'play' && room.phase !== 'break') return;
  if (room.mode === 'dm' && s.cur === 'knife') return;
  const gunId = room.mode === 'dm' ? (s.cur === 'sniper' ? 'sniper' : 'rifle') : s.weapon;
  const W = (room.mode === 'dm' ? DM_GUNS[gunId] : WEAPONS[gunId]) || WEAPONS.rifle;
  const t = Date.now();
  if (t < s.swapT || t - s.lastShot < W.rate * 800 || (gunId === 'sniper' && t - s.lastSniper < W.rate * 800)) return;
  s.lastShot = t; if (gunId === 'sniper') s.lastSniper = t;
  const ads = m.ads ? 1 : 0;
  const spreadK = gunId === 'sniper' ? (ads ? 1 : 60) : (ads ? 0.4 : 1);   // aiming tightens the spread, a sniper without scope is wild
  const yaw = typeof m.yaw === 'number' && isFinite(m.yaw) ? m.yaw : s.yaw;
  const pitch = clamp(typeof m.pitch === 'number' && isFinite(m.pitch) ? m.pitch : s.pitch, -1.5, 1.5);
  const o = { x: s.x, y: s.y + 1.7, z: s.z }, cp = Math.cos(pitch);
  const hits = new Map(); let first = null;
  for (let i = 0; i < W.pellets; i++) {
    const d = { x: -Math.sin(yaw) * cp + (Math.random() - 0.5) * W.spread * spreadK * 2, y: Math.sin(pitch) + (Math.random() - 0.5) * W.spread * spreadK * 2, z: -Math.cos(yaw) * cp + (Math.random() - 0.5) * W.spread * spreadK * 2 };
    const l = Math.hypot(d.x, d.y, d.z); d.x /= l; d.y /= l; d.z /= l;
    let tBest = 120, target = null, head = false;
    for (const b of room.map.boxes) { const tb = rayBox(o, d, b); if (tb < tBest) tBest = tb; }
    const cands = plist(room).filter((v) => v !== s && !v.dead && v.inv <= 0);
    for (const v of cands) {
      const sc = v.T ? v.T.scale : 1, vy = v.y || 0;
      const th = raySphere(o, d, { x: v.x, y: vy + 1.55 * sc, z: v.z }, 0.32 * sc);
      const tb = rayCyl(o, d, v.x, v.z, 0.5 * sc, vy, vy + 1.3 * sc);
      if (th < tBest) { tBest = th; target = v; head = true; }
      if (tb < tBest) { tBest = tb; target = v; head = false; }
    }
    if (i === 0) first = { x: o.x + d.x * tBest, y: o.y + d.y * tBest, z: o.z + d.z * tBest };
    if (target) { const rec = hits.get(target) || { dmg: 0, head: false, w: gunId === 'sniper' ? 1 : 0 }; rec.dmg += head ? W.dmg * 2 : W.dmg; rec.head = rec.head || head; hits.set(target, rec); }
  }
  broadcast(room, { t: 'sh', id: s.id, ox: r1(o.x), oy: r1(o.y), oz: r1(o.z), hx: r1(first.x), hy: r1(first.y), hz: r1(first.z), w: gunId === 'sniper' ? 1 : 0 }, s);
  for (const [target, rec] of hits) {
    hitPlayerDm(room, s, target, rec);
  }
}
// ---- knife: stab in melee (2 hits, 1 from behind) and throw (right click) ----
function canFight(room, s) { return !s.dead && room.mode === 'dm' && room.phase === 'play' && s.cur === 'knife'; }
function stab(room, s) {
  if (!canFight(room, s)) return;
  const t = Date.now(); if (t < s.swapT || t - s.lastStab < STAB_CD) return; s.lastStab = t;
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  let best = null, bd = STAB_RANGE;
  for (const v of plist(room)) {
    if (v === s || v.dead || v.inv > 0 || Math.abs((v.y || 0) - (s.y || 0)) > 1.6) continue;
    const dx = v.x - s.x, dz = v.z - s.z, d = Math.hypot(dx, dz);
    if (d > bd || (d > 0.5 && (dx * fx + dz * fz) / d < 0.35)) continue;      // within reach and in front
    if (blockedLine(room.map, { x: s.x, y: s.y + 1.2, z: s.z }, { x: v.x, y: (v.y || 0) + 1.2, z: v.z })) continue;
    best = v; bd = d;
  }
  broadcast(room, { t: 'sw', id: s.id }, s);
  if (!best) return;
  const dx = best.x - s.x, dz = best.z - s.z, d = Math.hypot(dx, dz) || 1;
  const back = (-Math.sin(best.yaw) * dx - Math.cos(best.yaw) * dz) / d > 0.3;   // the victim looks away from the attacker
  hitPlayerDm(room, s, best, { dmg: back ? STAB_BACK : STAB_DMG, head: false, w: 2, bs: back });
}
function throwKnife(room, s, m) {
  if (!canFight(room, s)) return;
  const t = Date.now(); if (t < s.swapT || t - s.lastThrow < THROW_CD) return; s.lastThrow = t;
  const yaw = typeof m.yaw === 'number' && isFinite(m.yaw) ? m.yaw : s.yaw, pitch = clamp(typeof m.pitch === 'number' && isFinite(m.pitch) ? m.pitch : s.pitch, -1.5, 1.5), cp = Math.cos(pitch);
  const k = { id: nextKnife++, owner: s, x: s.x, y: s.y + 1.6, z: s.z, vx: -Math.sin(yaw) * cp * KNIFE_SPEED, vy: Math.sin(pitch) * KNIFE_SPEED, vz: -Math.cos(yaw) * cp * KNIFE_SPEED, life: 2.5 };
  (room.knives = room.knives || []).push(k);
  broadcast(room, { t: 'kt', id: k.id, x: r1(k.x), y: r1(k.y), z: r1(k.z), vx: r1(k.vx), vy: r1(k.vy), vz: r1(k.vz) });
}
let nextKnife = 1;
function knifeTick(room) {
  const list = room.knives; if (!list || !list.length) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const k = list[i]; let end = 0, hitP = null;
    const vl = Math.hypot(k.vx * TICK, k.vy * TICK, k.vz * TICK) || 1e-6, o = { x: k.x, y: k.y, z: k.z }, d = { x: k.vx * TICK / vl, y: k.vy * TICK / vl, z: k.vz * TICK / vl };
    let tb = vl;
    for (const b of room.map.boxes) { const x = rayBox(o, d, b); if (x < tb) { tb = x; end = 1; } }
    for (const v of plist(room)) {
      if (v === k.owner || v.dead || v.inv > 0) continue;
      const vy = v.y || 0, near = Math.hypot(v.x - o.x, v.z - o.z) < 0.55 && o.y > vy && o.y < vy + 1.9;
      const x = near ? 0 : rayCyl(o, d, v.x, v.z, 0.55, vy, vy + 1.9);
      if (x < tb) { tb = x; end = 2; hitP = v; }
    }
    k.x += d.x * tb; k.y += d.y * tb; k.z += d.z * tb;
    k.life -= TICK;
    if (!end) { k.x = o.x + k.vx * TICK; k.y = o.y + k.vy * TICK; k.z = o.z + k.vz * TICK; k.vy -= KNIFE_G * TICK; if (k.life <= 0 || k.y < -2) end = 1; }
    if (end) {
      list.splice(i, 1);
      broadcast(room, { t: 'kx', id: k.id, x: r1(k.x), y: r1(k.y), z: r1(k.z), h: end === 2 ? 1 : 0 });
      if (hitP && room.phase === 'play' && room.players.has(k.owner.id)) hitPlayerDm(room, k.owner, hitP, { dmg: 100, head: false, w: 3 });
    }
  }
}
function hitPlayerDm(room, s, hit, rec) {
  hit.hp -= rec.dmg; hit.hurtT = 0;
  if (hit.hp > 0) { send(s, { t: 'hm', h: rec.head ? 1 : 0, k: 0, w: rec.w | 0 }); send(hit, { t: 'hurt', hp: Math.round(hit.hp) }); return; }
  hit.hp = 0; hit.dead = true; hit.deadT = 2.2; hit.deaths++; hit.streak = 0;
  s.kills++; s.streak++; s.best = Math.max(s.best, s.streak);
  if (rec.head) s.heads++;
  s.coinsRun += 10;
  send(s, { t: 'hm', h: rec.head ? 1 : 0, k: 1, c: 10, w: rec.w | 0, bs: rec.bs ? 1 : 0 });
  if (s.streak >= 5) send(s, { t: 'streak', n: s.streak });
  send(hit, { t: 'dead', by: s.name });
  broadcast(room, { t: 'k', a: s.name, v: hit.name, h: rec.head ? 1 : 0, st: s.streak, w: rec.w | 0, sk: s.skin | 0, bs: rec.bs ? 1 : 0, x: r1(hit.x), y: r1(hit.y || 0), z: r1(hit.z) });
}
// ---- mode logic: deathmatch ----
function dmBoard(room) {
  return plist(room).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths).map((p) => [p.id, p.name, p.kills, p.deaths, p.heads, p.best, p.color, p.coinsRun]);
}
const nextDmMap = (room) => getMap(DM_MAPS[(room.dmIdx + 1) % DM_MAPS.length]);
function dmNewMatch(room) {
  room.phase = 'play'; room.timeLeft = MATCH_SECONDS;
  room.dmIdx = (room.dmIdx + 1) % DM_MAPS.length; room.map = getMap(DM_MAPS[room.dmIdx]);   // the five maps take turns
  for (const p of room.players.values()) { if (p.ws.readyState === 1) p.ws.send(room.map.wire); p.kills = 0; p.deaths = 0; p.heads = 0; p.streak = 0; p.best = 0; p.coinsRun = 0; respawn(room, p); }
  room.knives = [];
  broadcast(room, { t: 'new' });
}
function dmTick(room) {
  room.timeLeft -= TICK;
  if (room.phase === 'play' && room.timeLeft <= 0) { room.phase = 'over'; room.timeLeft = INTERMISSION; const bd = dmBoard(room); broadcast(room, { t: 'end', board: bd, msg: (bd[0] ? bd[0][1] + ' wins with ' + bd[0][2] + ' kills. ' : '') + 'Next map: ' + nextDmMap(room).name }); }
  else if (room.phase === 'over' && room.timeLeft <= 0) dmNewMatch(room);
  for (const p of room.players.values()) {
    if (p.dead && p.deadT > 0) { p.deadT -= TICK; if (p.deadT <= 0 && room.phase === 'play') respawn(room, p); }
  }
  const secs = Math.max(0, Math.ceil(room.timeLeft));
  room.info = room.phase === 'play' ? Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0') : 'Next match in ' + secs + 's';
}

// ---- tick ----
function playersCommon(room) {
  for (const p of room.players.values()) {
    if (p.dead) continue;
    p.inv = Math.max(0, p.inv - TICK); p.hurtT += TICK;
    if (p.hurtT > 5 && p.hp < 100) {
      p.hp = Math.min(100, p.hp + 12 * TICK);
      if (Math.floor(p.hp) % 4 === 0) send(p, { t: 'hurt', hp: Math.round(p.hp), regen: 1 });
    }
  }
}
function snapshot(room) {
  const list = plist(room).map((p) => [p.id, p.name, r1(p.x), r1(p.y), r1(p.z), Math.round(p.yaw * 100) / 100, Math.round(p.pitch * 100) / 100,
    p.dead ? 1 : 0, room.mode === 'pk' ? p.cp : p.kills, room.mode === 'dm' ? p.deaths : room.mode === 'pk' ? p.falls : p.coinsRun, p.color, p.inv > 0 ? 1 : 0, p.tone, p.skin | 0, CUR_IDX[p.cur] | 0]);
  const s = JSON.stringify({ t: 's', p: list, m: [], ph: room.phase, ib: room.info, boss: null, tl: Math.max(0, Math.round(room.timeLeft * 10) / 10) });
  for (const p of room.players.values()) if (p.ws.readyState === 1) p.ws.send(s);
}
setInterval(() => {
  for (const room of allRooms()) {
    if (room.mode === 'pk' && !room.players.size) continue;
    if (room.mode === 'dm') { dmTick(room); knifeTick(room); playersCommon(room); } else room.info = room.map.name;
    snapshot(room);
  }
}, TICK * 1000);

// ---- parkour best times (saved to scores-v2.json; set DATA_DIR to keep them somewhere else) ----
const SCORE_FILE = path.join(process.env.DATA_DIR || __dirname, 'scores-v2.json');
let scores = {};
try { scores = JSON.parse(fs.readFileSync(SCORE_FILE, 'utf8')); } catch (e) { scores = {}; }
let saveT = null;
function saveScores() { if (saveT) return; saveT = setTimeout(() => { saveT = null; fs.writeFile(SCORE_FILE, JSON.stringify(scores), () => {}); }, 2000); }
// each level keeps three boards: today, this month and all time (days and months follow Paris time)
const dayKey = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
function levelScores(lv) {
  let s = scores[lv];
  if (Array.isArray(s)) s = scores[lv] = { all: s };      // old file format
  if (!s) s = scores[lv] = { all: [] };
  const dk = dayKey(), mk = dk.slice(0, 7);
  if (!s.day || s.day.k !== dk) s.day = { k: dk, rows: [] };
  if (!s.month || s.month.k !== mk) s.month = { k: mk, rows: [] };
  return s;
}
function board(lv) {
  const s = levelScores(lv), f = (l) => l.slice(0, 10).map((r) => [r.n, r.t, r.r ? 1 : 0]);
  return { d: f(s.day.rows), m: f(s.month.rows), a: f(s.all) };
}
function addTime(list, name, time, rec) {
  const key = name.toLowerCase(), old = list.find((r) => r.n.toLowerCase() === key);
  let better = false;
  if (!old) { list.push({ n: name, t: time, r: rec || undefined }); better = true; } else if (time < old.t) { old.t = time; old.n = name; old.r = rec || undefined; better = true; }
  list.sort((a, b) => a.t - b.t); if (list.length > 50) list.length = 50;
  for (let i = 10; i < list.length; i++) if (list[i].r) delete list[i].r;      // only the top 10 keep their replay
  return better;
}
const rankOf = (list, name) => list.findIndex((r) => r.n.toLowerCase() === name.toLowerCase()) + 1;
function recordTime(lv, name, time, rec) {
  const s = levelScores(lv);
  const pb = addTime(s.all, name, time, rec), d = addTime(s.day.rows, name, time, rec), m = addTime(s.month.rows, name, time, rec);
  if (pb || d || m) saveScores();
  return { pb, changed: pb || d || m, rank: rankOf(s.all, name), rd: rankOf(s.day.rows, name), rm: rankOf(s.month.rows, name) };
}
function flatRec(rec) {
  if (!rec || rec.length < 10 || rec.length >= 4000) return undefined;
  const out = []; for (const r of rec) out.push(r[0], Math.round(r[1] * 20), Math.round(r[2] * 20), Math.round(r[3] * 20), Math.round(r[4] * 100), Math.round(r[5] * 100));
  return out;
}
function sendBoard(lv, to) {
  const msg = { t: 'lb', lv, b: board(lv) };
  if (to) send(to, msg); else broadcast(pkRoom(lv), msg);
}

// when the day (or month) turns over, refresh the boards of every level somebody is playing
let lastDay = dayKey();
setInterval(() => { const d = dayKey(); if (d === lastDay) return; lastDay = d; for (const r of Object.values(pkRooms)) if (r.players.size) sendBoard(r.level); }, 30000);

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
      me = { id: nextId++, ws, name, color: validColor(m.color) || PALETTE[Math.floor(Math.random() * PALETTE.length)], tone: clamp(Math.floor(+m.tone) || 0, 0, 4), skin: clamp(Math.floor(+m.skin) || 0, 0, 10),
        weapon: WEAPONS[m.weapon] ? m.weapon : 'rifle', room: null, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100, dead: false, deadT: 0, inv: 0, hurtT: 99,
        kills: 0, deaths: 0, heads: 0, streak: 0, best: 0, coinsRun: 0, lastShot: 0, lastSniper: 0, lastStab: 0, lastThrow: 0, swapT: 0, cur: 'rifle', lastChat: 0, lastSt: Date.now(), cp: 0, pkStart: 0, finished: false, falls: 0 };
      enterRoom(me, r);
      send(me, { t: 'chatlog', l: chatLog });
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
      // replay recording: one sample per position update from the moment the clock starts
      if (me.pkStart) { if (!me.rec) me.rec = []; if (me.rec.length < 4000) me.rec.push([Math.round((Date.now() - me.pkStart) / 10), me.x, me.y, me.z, me.yaw, me.pitch]); } else me.rec = null;
      // the clock starts as soon as you step off the green start platform (7 x 7)
      if (!me.pkStart && (Math.abs(me.x - pk.start[0]) > 3.5 || Math.abs(me.z - pk.start[2]) > 3.5)) { me.pkStart = Date.now(); send(me, { t: 'pks' }); }
      const nextCp = pk.cps[me.cp];
      if (nextCp && Math.hypot(me.x - nextCp[0], me.z - nextCp[2]) < 2.6 && Math.abs(me.y - nextCp[1]) < 2.2) { me.cp++; send(me, { t: 'cp', i: me.cp, n: pk.cps.length }); }
      else if (!nextCp && me.pkStart && Math.hypot(me.x - pk.fin[0], me.z - pk.fin[2]) < 3.2 && Math.abs(me.y - pk.fin[1]) < 2.2) {
        const time = (Date.now() - me.pkStart) / 1000;
        if (time < pk.pathLen / 26) return;      // faster than anybody could run it
        me.finished = true;
        const res = recordTime(room.level, me.name, Math.round(time * 100) / 100, flatRec(me.rec));
        send(me, { t: 'fin', lv: room.level, time: Math.round(time * 100) / 100, rank: res.rank, rd: res.rd, rm: res.rm, pb: res.pb ? 1 : 0, b: board(room.level) });
        if (res.changed) sendBoard(room.level);
      }
    } else if (m.t === 'shot' && me) {
      shoot(room, me, m);
    } else if (m.t === 'rp' && me) {
      const now = Date.now(); if (now - (me.lastRp || 0) < 400) return; me.lastRp = now;
      const lv = clamp(Math.floor(+m.lv) || 1, 1, PK_LEVELS), sc = levelScores(lv), list = m.p === 'd' ? sc.day.rows : m.p === 'm' ? sc.month.rows : sc.all, row = list[clamp(Math.floor(+m.i) || 0, 0, 9)];
      if (row && row.r) send(me, { t: 'rpd', lv, n: row.n, time: row.t, f: row.r }); else send(me, { t: 'rpd', lv, none: 1 });
    } else if (m.t === 'stab' && me) {
      stab(room, me);
    } else if (m.t === 'throw' && me) {
      throwKnife(room, me, m);
    } else if (m.t === 'wep' && me) {
      if (CUR_IDX[m.w] != null && m.w !== me.cur) { me.cur = m.w; me.swapT = Date.now() + 250; }
    } else if (m.t === 'chat' && me) {
      const now = Date.now(); if (now - me.lastChat < 700) return; me.lastChat = now;
      const text = String(m.x == null ? '' : m.x).replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!text) return;
      const msg = { t: 'chat', n: me.name, c: me.color, x: text };
      chatLog.push(msg); if (chatLog.length > 20) chatLog.shift();
      const str = JSON.stringify(msg);
      for (const r of allRooms()) for (const p of r.players.values()) if (p.ws.readyState === 1) p.ws.send(str);       // global: every room hears it
    } else if (m.t === 'fell' && me && room.mode === 'pk') {
      me.falls++; me.pkStart = 0; me.finished = false; respawn(room, me); send(me, { t: 'pkr', f: me.falls });
    } else if (m.t === 'restart' && me && room.mode === 'pk') {
      me.cp = 0; me.pkStart = 0; me.finished = false; respawn(room, me);
    } else if (m.t === 'lvl' && me && room.mode === 'pk') {
      const n = clamp(Math.floor(+m.n) || 1, 1, PK_LEVELS), r = pkRoom(n);
      if (r !== room && r.players.size < MAX_PER_ROOM) enterRoom(me, r); else if (r === room) { me.cp = 0; me.pkStart = 0; me.finished = false; respawn(room, me); sendBoard(n, me); }
    } else if (m.t === 'color' && me) {
      const c = validColor(m.color); if (c) me.color = c;
      if (m.tone != null) me.tone = clamp(Math.floor(+m.tone) || 0, 0, 4);
      if (m.skin != null) me.skin = clamp(Math.floor(+m.skin) || 0, 0, 10);
    }
  });
  ws.on('close', () => { if (me && me.room) me.room.players.delete(me.id); });
  ws.on('error', () => {});
});

server.listen(PORT, () => console.log('Purple Arena running on port ' + PORT));
