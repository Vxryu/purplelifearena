// Hop-level beam search: from each landing, try many aim points / strafe styles, simulate to the next landing, keep the best landings.
const fs = require('fs');
const maps = require('./maps.js');
const { makeSim, DT } = require('./tas.js');
const D2R = Math.PI / 180;
const KEYS = [{ W: 0, A: 0, D: 1 }, { W: 0, A: 1, D: 0 }, { W: 1, A: 0, D: 1 }, { W: 1, A: 1, D: 0 }, { W: 1, A: 0, D: 0 }];
const YOFF = (process.env.YF ? [-70, -55, -40, -30, -20, -10, 0, 10, 20, 30, 40, 55, 70] : [-60, -40, -20, 0, 20, 40, 60]).map((d) => d * D2R);
const ACTS = []; for (let k = 0; k < KEYS.length; k++) for (let y = 0; y < YOFF.length; y++) ACTS.push([k, y]);

const SSTEP = +process.env.SSTEP || 30, STOP = +process.env.STOP || 6;
const REACH = +process.env.REACH || 15;
function run(L, WIDTH, maxHops) {
  const map = maps.getMap('pk' + L), pk = map.pk, sim = makeSim(map.boxes);
  const plats = map.boxes.filter((b) => b.kind === 'plat' || b.kind === 'start' || b.kind === 'finish');
  const n = plats.length, fi = plats.findIndex((b) => b.kind === 'finish'), V = 8.6;
  const adj = plats.map(() => []);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) {
    const a = plats[i], b = plats[j];
    if (maps.gapDist(a, b) <= REACH * maps.airtime((b.y + b.h) - (a.y + a.h)) + 0.3) adj[i].push(j);
  }
  const Dd = new Array(n).fill(Infinity); Dd[fi] = 0;
  for (let it = 0; it < n; it++) for (let i = 0; i < n; i++) for (const j of adj[i]) { const w = Math.hypot(plats[i].x - plats[j].x, plats[i].z - plats[j].z); if (Dd[j] + w < Dd[i]) Dd[i] = Dd[j] + w; }
  const platAt = (x, y, z) => { for (let i = 0; i < n; i++) { const b = plats[i]; if (Math.abs(y - (b.y + b.h)) < 0.02 && Math.abs(x - b.x) <= b.w / 2 + 0.3 && Math.abs(z - b.z) <= b.d / 2 + 0.3) return i; } return -1; };
  const finOK = (P) => Math.hypot(P.x - pk.fin[0], P.z - pk.fin[2]) < 3.2 && Math.abs(P.y - pk.fin[1]) < 2.2;
  const startOut = (P) => Math.abs(P.x - pk.start[0]) > 3.5 || Math.abs(P.z - pk.start[2]) > 3.5;

  // fly from state s with an aim controller; returns { st, frames, fin } where st is the next landing (or null if fell)
  function fly(s, T, mu, spaceOffFrames) {
    const P = { x: s.x, y: s.y, z: s.z, vx: s.vx, vz: s.vz, vy: s.vy, yaw: s.yaw };
    const acts = []; let started = s.started, cnt = 0, wasAir = s.vy !== 0 || s.air, f = 0;
    for (; f < 140; f++) {
      const dx = T.x - P.x, dz = T.z - P.z, dl = Math.hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl;
      const base = Math.atan2(-dx, -dz);      // yaw whose forward axis points at T
      let bestA = null, bestSc = -1e9, bestP = null, bestSp = 0;
      for (const [ki, yi] of ACTS) {
        const k = KEYS[ki], Q = Object.assign({}, P); Q.yaw = base + YOFF[yi];
        const sp0 = (spaceOffFrames > f) ? 0 : 1;
        sim.step(Q, { W: k.W, A: k.A, D: k.D, Space: sp0 === 1 }, DT);
        const sc = Math.hypot(Q.vx, Q.vz) + mu * (Q.vx * ux + Q.vz * uz);
        if (sc > bestSc) { bestSc = sc; bestA = [ki, yi, sp0]; bestP = Q; }
      }
      Object.assign(P, bestP); acts.push({ x: P.x, y: P.y, z: P.z, yaw: P.yaw, ki: bestA[0], sp: bestA[2] });
      if (!started && startOut(P)) started = true; if (started) cnt++;
      if (P.y < pk.kill + 1.2) return null;
      if (started && finOK(P)) return { fin: true, cnt: s.cnt + cnt, acts };
      const air = P.vy !== 0; if (wasAir && !air && P.vy === 0) {
        const pa = platAt(P.x, P.y, P.z); if (pa < 0) return null;
        return { fin: false, st: { x: P.x, y: P.y, z: P.z, vx: P.vx, vz: P.vz, vy: 0, yaw: P.yaw, pi: pa, started, cnt: s.cnt + cnt }, acts };
      }
      wasAir = wasAir || air;
    }
    return null;
  }
  // start: run-up on the start platform is free (clock starts when leaving it); use a few jump-start variants
  const s0 = { x: pk.start[0], y: pk.start[1], z: pk.start[2], vx: 0, vz: 0, vy: 0, yaw: 0, pi: 0, started: false, cnt: 0, air: false, path: [] };
  // free warm-up: the clock only starts when the player leaves the 7x7 start platform, so we can bunny-hop around on it first and leave with speed
  const WARM = +process.env.WARM || 360;
  const seeds = [s0];
  if (WARM > 0) {
    const first = plats[adjFirst()] , ux0 = first.x - pk.start[0], uz0 = first.z - pk.start[2], ul = Math.hypot(ux0, uz0) || 1, ux = ux0 / ul, uz = uz0 / ul;
    let wb = [{ x: pk.start[0], y: pk.start[1], z: pk.start[2], vx: 0, vz: 0, vy: 0, yaw: 0, path: null, par: null, act: null }];
    const lim = 3.4;
    for (let f = 0; f < WARM; f++) {
      const nm = new Map();
      for (const w of wb) {
        const sp = Math.hypot(w.vx, w.vz), heading = sp > 2 ? Math.atan2(-w.vx, -w.vz) : Math.atan2(-ux, -uz);
        for (const [ki, yi] of ACTS) {
          const k = KEYS[ki], Q = { x: w.x, y: w.y, z: w.z, vx: w.vx, vz: w.vz, vy: w.vy, yaw: heading + YOFF[yi] };
          sim.step(Q, { W: k.W, A: k.A, D: k.D, Space: true }, DT);
          if (Math.abs(Q.x - pk.start[0]) > lim || Math.abs(Q.z - pk.start[2]) > lim) continue;
          const q = { x: Q.x, y: Q.y, z: Q.z, vx: Q.vx, vz: Q.vz, vy: Q.vy, yaw: Q.yaw, par: w, act: { x: Q.x, y: Q.y, z: Q.z, yaw: Q.yaw, ki, sp: 1 } };
          // keep room: prefer fast states that are not about to hit the border
          const spd = Math.hypot(q.vx, q.vz), bx = lim - Math.abs(q.x - pk.start[0]) + (q.vx > 0 ? 0 : 0), bz = lim - Math.abs(q.z - pk.start[2]);
          q.score = spd;
          const key = Math.round(q.x * 3) + ',' + Math.round(q.z * 3) + ',' + Math.round(q.vx * 1.5) + ',' + Math.round(q.vz * 1.5) + ',' + Math.round(q.y * 4);
          const o = nm.get(key); if (!o || o.score < q.score) nm.set(key, q);
        }
      }
      wb = [...nm.values()].sort((a, b) => b.score - a.score).slice(0, 400);
      if (!wb.length) break;
      if (f >= 60 && f % SSTEP === 0) {
        // seeds: grounded states leaving fast toward the first platform
        const top = wb.map((w) => ({ w, sc: (w.vx * ux + w.vz * uz) + 0.3 * Math.hypot(w.vx, w.vz) })).sort((a, b) => b.sc - a.sc).slice(0, 6);
        for (const { w } of top) { const path = []; for (let c = w; c.par; c = c.par) path.push(c.act); path.reverse(); seeds.push({ x: w.x, y: w.y, z: w.z, vx: w.vx, vz: w.vz, vy: w.vy, yaw: w.yaw, pi: 0, started: false, cnt: 0, air: w.vy !== 0, path }); }
      }
    }
  }
  function adjFirst() { let bj = 1; for (const k of adj[0]) if (Dd[k] < Dd[bj]) bj = k; return bj; }
  if (process.env.TASDBG) console.log('seeds', seeds.length, seeds.slice(1).map((s) => Math.hypot(s.vx, s.vz).toFixed(1) + '@' + s.path.length).join(' '));
  let beam = seeds.slice(), best = null;
  for (let hop = 0; hop < maxHops && beam.length; hop++) {
    const nb = new Map();
    for (const s of beam) {
      const cands = [];
      for (const j of [s.pi, ...adj[s.pi]]) if (j !== s.pi && Dd[j] < Dd[s.pi] + 8) cands.push(j);
      if (s.pi === fi) continue;
      for (const j of cands) {
        const b = plats[j];
        const tg = [];
        for (const fx of [-0.4, -0.2, 0, 0.2, 0.4]) for (const fz of [-0.4, 0, 0.4]) tg.push({ x: b.x + fx * b.w, z: b.z + fz * b.d });
        if (j === fi) tg.push({ x: b.x, z: b.z });
        const nx = nextOfJ(j);
        for (const T of tg) for (const mu of (process.env.MU ? [0.2, 0.6, 1.2, 2, 4] : [0.4, 1.2, 3])) for (const so of (s.pi === 0 && s.cnt === 0 ? [0, 20, 40] : [0])) {
          const r = fly(s, T, mu, so);
          if (!r) continue;
          if (r.fin) { if (!best || r.cnt < best.cnt) best = { cnt: r.cnt, path: s.path.concat(r.acts) }; continue; }
          const st = r.st; st.path = s.path.concat(r.acts);
          if (!(Dd[st.pi] < Infinity)) continue;
          const b2 = plats[nx(st.pi)] || plats[fi], dx = b2.x - st.x, dz = b2.z - st.z, dl = Math.hypot(dx, dz) || 1;
          st.cost = 17 * st.cnt / 60 + Dd[st.pi] - 0.4 * ((st.vx * dx + st.vz * dz) / dl) + Math.hypot(st.x - plats[st.pi].x, st.z - plats[st.pi].z) * 0;
          const key = st.pi + ',' + Math.round(st.x * 2) + ',' + Math.round(st.z * 2) + ',' + Math.round(st.vx) + ',' + Math.round(st.vz);
          const o = nb.get(key); if (!o || o.cost > st.cost) nb.set(key, st);
        }
      }
    }
    beam = [...nb.values()].sort((a, b) => a.cost - b.cost).slice(0, WIDTH);
    if (process.env.TASDBG) console.log('hop', hop, beam.length, beam[0] && [beam[0].pi, beam[0].cnt, Math.hypot(beam[0].vx, beam[0].vz).toFixed(1)], best && best.cnt);
    if (best) { const lim = best.cnt; beam = beam.filter((s) => s.cnt < lim); }
  }
  function nextOfJ(j) { return (i) => { let bj = -1; for (const k of adj[i]) if (Dd[k] < Dd[i] - 1e-6 && (bj < 0 || Dd[k] < Dd[bj])) bj = k; return bj; }; }
  return best;
}
module.exports = { run, KEYS };
if (require.main === module) {
  const L = +process.argv[2] || 1, W = +process.argv[3] || 40;
  const t0 = Date.now(), r = run(L, W, 40);
  console.log(r ? 'level ' + L + ' time ' + (r.cnt / 60).toFixed(2) + ' s (' + r.path.length + ' frames) ' + ((Date.now() - t0) / 1000).toFixed(1) + 's' : 'no run');
  if (r) fs.writeFileSync(process.env.OUT || ('/tmp/nd/tas_hop_' + L + '.json'), JSON.stringify(r));
}
