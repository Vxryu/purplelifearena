// TAS generator: plays every parkour level with the game's own physics (a port of move() in public/index.html, parkour branch)
// and searches for the fastest run it can find. Run `node tas.js` to rebuild tas.json (the server serves it as the "TAS" replay of each level).
const maps = require('./maps.js');
const DT = 1 / 60, SPEED_CAP = 25;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

function makeSim(boxes) {
  const groundAt = (x, z, y) => {
    let g = -1e9;
    for (const b of boxes) {
      const top = b.y + b.h;
      if (top > y + 0.15 || top <= g) continue;
      if (Math.abs(x - b.x) < b.w / 2 + 0.25 && Math.abs(z - b.z) < b.d / 2 + 0.25) g = top;
    }
    return g;
  };
  const pushOut = (p, r, y) => {
    for (const b of boxes) {
      if (y >= b.y + b.h - 0.05 || y + 1.8 <= b.y) continue;
      const nx = Math.max(b.x - b.w / 2, Math.min(p.x, b.x + b.w / 2)), nz = Math.max(b.z - b.d / 2, Math.min(p.z, b.z + b.d / 2));
      let dx = p.x - nx, dz = p.z - nz, d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 < 1e-6) { dx = p.x - b.x; dz = p.z - b.z; d2 = dx * dx + dz * dz || 1; }
        const d = Math.sqrt(d2), k = (r - d) / d; p.x += dx * k; p.z += dz * k;
      }
    }
  };
  // one physics step; k = { W, A, D, Space }; returns true when the player landed this step
  const step = (P, k, dt) => {
    const fwd = k.W ? 1 : 0, side = (k.D ? 1 : 0) - (k.A ? 1 : 0);
    let wx = -Math.sin(P.yaw) * fwd + Math.cos(P.yaw) * side, wz = -Math.cos(P.yaw) * fwd - Math.sin(P.yaw) * side;
    const wl = Math.hypot(wx, wz); if (wl > 0) { wx /= wl; wz /= wl; }
    const run = 9, g = groundAt(P.x, P.z, P.y), onGround = P.vy <= 0 && P.y <= g + 0.001;
    let jumped = false;
    if (onGround && k.Space) { P.vy = 7; jumped = true; }
    if (onGround && !jumped) {
      const sp = Math.hypot(P.vx, P.vz);
      if (sp > 0.01) { const f = Math.max(0, sp - Math.max(sp, 3) * 7 * dt) / sp; P.vx *= f; P.vz *= f; }
      if (wl > 0) { const add = run - (P.vx * wx + P.vz * wz); if (add > 0) { const gain = Math.min(add, 10 * run * dt); P.vx += wx * gain; P.vz += wz * gain; } }
    } else if (wl > 0) {
      const cap = 0.9, add = cap - (P.vx * wx + P.vz * wz);
      if (add > 0) { const gain = Math.min(add, cap * 60 * dt); P.vx += wx * gain; P.vz += wz * gain; }
    }
    const sp2 = Math.hypot(P.vx, P.vz); if (sp2 > SPEED_CAP) { P.vx *= SPEED_CAP / sp2; P.vz *= SPEED_CAP / sp2; }
    P.vy -= 20 * dt;
    const ox = P.x, oz = P.z;
    P.x += P.vx * dt; P.z += P.vz * dt; pushOut(P, 0.45, P.y);
    { const rx = (P.x - ox) / dt, rz = (P.z - oz) / dt; if (Math.hypot(rx, rz) < Math.hypot(P.vx, P.vz) - 0.01) { P.vx = rx; P.vz = rz; } }
    let ny = P.y + P.vy * dt; const g2 = groundAt(P.x, P.z, Math.max(P.y, ny)); let landed = false;
    if (ny <= g2 && P.vy <= 0) { ny = g2; P.vy = 0; landed = true; }
    P.y = ny;
    return landed;
  };
  return { groundAt, step };
}
module.exports = { makeSim, wrap, DT };
