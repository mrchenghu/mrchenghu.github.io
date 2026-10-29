/* Offline deterministic tank battle model. No networking or external dependencies. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2, STEP = Math.PI / 4, TILE = 48, RADIUS = 18;
  const SPECS = Object.freeze({
    strike: { level: 5, range: 550, radius: 95, delay: 0.9, damage: 2, cooldown: 10 },
    shield: { level: 10, duration: 6, cooldown: 12 },
    factory: { level: 15, range: 360, radius: 140, cooldown: 18, hp: 1 }
  });
  const sq = v => v * v, dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const snap = a => Math.round(a / STEP) * STEP;
  const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  function segmentCircle(x1, y1, x2, y2, cx, cy, r) {
    const dx = x2 - x1, dy = y2 - y1, fx = x1 - cx, fy = y1 - cy;
    const c = fx * fx + fy * fy - r * r;
    if (c <= 0) return 0;
    const a = dx * dx + dy * dy;
    if (a < 1e-12) return Infinity;
    const b = 2 * (fx * dx + fy * dy), det = b * b - 4 * a * c;
    if (det < 0) return Infinity;
    const t = (-b - Math.sqrt(det)) / (2 * a);
    return t >= 0 && t <= 1 ? t : Infinity;
  }
  class MinHeap {
    constructor() { this.a = []; }
    push(v) { let i = this.a.length; this.a.push(v); while (i) { const p = (i - 1) >> 1; if (this.a[p].f <= v.f) break; this.a[i] = this.a[p]; i = p; } this.a[i] = v; }
    pop() { const r = this.a[0], v = this.a.pop(); if (this.a.length) { let i = 0; while (true) { let c = i * 2 + 1; if (c >= this.a.length) break; if (c + 1 < this.a.length && this.a[c + 1].f < this.a[c].f) c++; if (v.f <= this.a[c].f) break; this.a[i] = this.a[c]; i = c; } this.a[i] = v; } return r; }
  }
  class TankCore {
    constructor(options = {}) {
      this.seed = (options.seed === undefined ? Date.now() : options.seed) >>> 0;
      this.worldW = 60 * TILE; this.worldH = 42 * TILE;
      this.map = { cols: 60, rows: 42, tile: TILE, cells: new Uint8Array(60 * 42) };
      this.tanks = []; this.bullets = []; this.strikes = []; this.factories = []; this.particles = [];
      this.events = []; this.elapsed = 0; this.result = null; this.sequence = 0;
      this.stats = { shots: 0, hits: 0, heals: 0, destroyed: 0, casts: { strike: 0, shield: 0, factory: 0 } };
      this._damageQueue = []; this._makeMap();
      const levels = [this.randint(3, 4), this.randint(5, 9), this.randint(10, 14), this.randint(15, 19), this.randint(20, 25)];
      for (let i = levels.length - 1; i > 0; i--) { const j = this.randint(0, i); [levels[i], levels[j]] = [levels[j], levels[i]]; }
      this._newTank('player', '你', 0, clamp(Math.floor(options.playerLevel || 1), 1, 99), 6.5 * TILE, 21.5 * TILE, true);
      this._newTank('ally-1', '队友 · 山雀', 0, levels[0], 5.5 * TILE, 17.5 * TILE);
      this._newTank('ally-2', '队友 · 岩隼', 0, levels[1], 5.5 * TILE, 25.5 * TILE);
      this._newTank('enemy-1', '敌军 · 赤狐', 1, levels[2], 53.5 * TILE, 17.5 * TILE);
      this._newTank('enemy-2', '敌军 · 砂蝎', 1, levels[3], 54.5 * TILE, 21.5 * TILE);
      this._newTank('enemy-3', '敌军 · 夜枭', 1, levels[4], 53.5 * TILE, 25.5 * TILE);
      this._event('战斗开始：消灭敌方全部坦克');
    }
    random() { let t = this.seed += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }
    randint(a, b) { return a + Math.floor(this.random() * (b - a + 1)); }
    _newTank(id, name, team, level, x, y, isPlayer = false) {
      const maxHp = 5 + (level >= 20 ? Math.floor((level - 20) / 5) + 1 : 0);
      this.tanks.push({ id, name, team, level, x, y, angle: team === 0 ? 0 : Math.PI, hp: maxHp, maxHp, alive: true, isPlayer, radius: RADIUS, speed: 132,
        shieldRemaining: 0, cd: { strike: 0, shield: 0, factory: 0 }, fireCD: 0, aiTimer: this.random() * 0.45, path: [], targetId: null, stuck: 0, skin: this.tanks.length, shotHold: 0,
        aiShotDelay: 1 + this.random() * 2, aiStrikeDelay: 18 + this.random() * 7, lastFactoryHealAt: -1 });
    }
    _makeMap() {
      const m = this.map, set = (x, y, v) => { if (x >= 0 && y >= 0 && x < m.cols && y < m.rows) m.cells[y * m.cols + x] = v; };
      // Border cliffs, two irregular lakes, and offset rock ridges leave multiple flanking routes.
      for (let x = 0; x < m.cols; x++) { set(x, 0, 1); set(x, m.rows - 1, 1); }
      for (let y = 0; y < m.rows; y++) { set(0, y, 1); set(m.cols - 1, y, 1); }
      const ellipse = (cx, cy, rx, ry, type, seed) => {
        for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
          const wobble = 1 + Math.sin(x * 1.31 + y * 1.7 + seed) * 0.12;
          if (sq((x - cx) / rx) + sq((y - cy) / ry) < wobble) set(x, y, type);
        }
      };
      ellipse(23, 10, 6, 5, 2, 1); ellipse(37, 31, 6, 5, 2, 3);
      ellipse(30, 18, 3, 5, 1, 4); ellipse(18, 27, 3, 5, 1, 5);
      ellipse(43, 14, 3, 5, 1, 8); ellipse(10, 9, 3, 2, 1, 2);
      ellipse(50, 33, 3, 2, 1, 7); ellipse(31, 5, 4, 1.7, 1, 2);
      ellipse(28, 37, 4, 1.7, 1, 7); ellipse(31, 29, 2, 2, 1, 12);
      // Spawn pockets are explicitly open.
      for (let y = 15; y <= 28; y++) for (let x = 3; x <= 8; x++) set(x, y, 0);
      for (let y = 15; y <= 28; y++) for (let x = 51; x <= 56; x++) set(x, y, 0);
    }
    getPlayer() { return this.tanks.find(t => t.id === 'player'); }
    cell(x, y) { const m = this.map; return x < 0 || y < 0 || x >= m.cols || y >= m.rows ? 1 : m.cells[y * m.cols + x]; }
    _terrainStand(x, y, r = RADIUS) {
      if (x < r || y < r || x > this.worldW - r || y > this.worldH - r) return false;
      for (let cy = Math.floor((y - r) / TILE); cy <= Math.floor((y + r) / TILE); cy++) for (let cx = Math.floor((x - r) / TILE); cx <= Math.floor((x + r) / TILE); cx++) {
        if (!this.cell(cx, cy)) continue;
        const px = clamp(x, cx * TILE, (cx + 1) * TILE), py = clamp(y, cy * TILE, (cy + 1) * TILE);
        if (sq(x - px) + sq(y - py) < r * r - 0.01) return false;
      }
      return true;
    }
    canStand(x, y, r = RADIUS, ignoreId = null) {
      if (!this._terrainStand(x, y, r)) return false;
      return !this.tanks.some(t => t.alive && t.id !== ignoreId && sq(t.x - x) + sq(t.y - y) < sq(r + t.radius - 1));
    }
    _wallHit(x1, y1, x2, y2) {
      const dx = x2 - x1, dy = y2 - y1;
      let cx = Math.floor(x1 / TILE), cy = Math.floor(y1 / TILE);
      if (this.cell(cx, cy) === 1) return 0;
      const sx = Math.sign(dx), sy = Math.sign(dy), tx = dx ? TILE / Math.abs(dx) : Infinity, ty = dy ? TILE / Math.abs(dy) : Infinity;
      let mx = dx ? ((sx > 0 ? (cx + 1) * TILE : cx * TILE) - x1) / dx : Infinity;
      let my = dy ? ((sy > 0 ? (cy + 1) * TILE : cy * TILE) - y1) / dy : Infinity;
      for (let n = 0; n < 256; n++) {
        let at;
        if (mx < my) { at = mx; cx += sx; mx += tx; } else { at = my; cy += sy; my += ty; }
        if (at > 1 || !Number.isFinite(at)) return Infinity;
        if (this.cell(cx, cy) === 1) return Math.max(0, at);
      }
      return Infinity;
    }
    lineClear(x1, y1, x2, y2) { return this._wallHit(x1, y1, x2, y2) === Infinity; }
    _walkClear(x1, y1, x2, y2) {
      const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 5));
      for (let i = 1; i <= steps; i++) if (!this._terrainStand(x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps)) return false;
      return true;
    }
    _event(s) { this.events.push(s); if (this.events.length > 8) this.events.shift(); }
    _particle(type, x, y, life = 0.5, text) { this.particles.push({ id: ++this.sequence, type, x, y, age: 0, life, text }); }
    _move(t, dx, dy, dt) {
      if (!dx && !dy) return false;
      const angle = snap(Math.atan2(dy, dx)); t.angle = angle;
      const step = t.speed * dt, mx = Math.cos(angle) * step, my = Math.sin(angle) * step;
      const oldx = t.x, oldy = t.y;
      // Small substeps prevent tunnelling when the tab resumes after a pause.
      const n = Math.max(1, Math.ceil(step / 8));
      for (let i = 0; i < n; i++) {
        if (this.canStand(t.x + mx / n, t.y + my / n, RADIUS, t.id)) { t.x += mx / n; t.y += my / n; }
        else {
          if (this.canStand(t.x + mx / n, t.y, RADIUS, t.id)) t.x += mx / n;
          if (this.canStand(t.x, t.y + my / n, RADIUS, t.id)) t.y += my / n;
        }
      }
      return Math.hypot(t.x - oldx, t.y - oldy) > step * 0.2;
    }
    _fire(t) {
      if (!t.alive || t.fireCD > 0) return false;
      t.fireCD = 0.7; this.stats.shots++;
      const ux = Math.cos(t.angle), uy = Math.sin(t.angle);
      // Start inside the tank rather than beyond nearby walls: friendlies are not collision targets.
      this.bullets.push({ id: ++this.sequence, ownerId: t.id, team: t.team, x: t.x + ux * 12, y: t.y + uy * 12, angle: t.angle, vx: ux * 500, vy: uy * 500, range: 520, age: 0 });
      this._particle('muzzle', t.x + ux * 31, t.y + uy * 31, 0.12);
      return true;
    }
    cast(skill, x, y) { return this._cast(this.getPlayer(), skill, x, y); }
    _cast(t, skill, x, y) {
      const spec = SPECS[skill];
      if (this.result) return { ok: false, reason: '战斗已结束' };
      if (!t || !t.alive) return { ok: false, reason: '坦克已被击毁' };
      if (!spec) return { ok: false, reason: '未知技能' };
      if (t.level < spec.level) return { ok: false, reason: `${spec.level} 级解锁` };
      if (t.cd[skill] > 0) return { ok: false, reason: '技能冷却中' };
      if (skill !== 'shield') {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, reason: '请选择落点' };
        if (Math.hypot(x - t.x, y - t.y) > spec.range) return { ok: false, reason: '超出施法范围' };
        if (x < 0 || y < 0 || x > this.worldW || y > this.worldH) return { ok: false, reason: '落点超出地图' };
      }
      if (skill === 'factory' && !this.canStand(x, y, 24)) return { ok: false, reason: '工厂需要放在空旷陆地上' };
      t.cd[skill] = spec.cooldown; this.stats.casts[skill]++;
      if (skill === 'shield') {
        t.shieldRemaining = spec.duration; this._particle('shield', t.x, t.y, 0.5);
      } else if (skill === 'strike') {
        this.strikes.push({ id: ++this.sequence, ownerId: t.id, team: t.team, x, y, radius: spec.radius, age: 0, duration: spec.delay, remaining: spec.delay });
      } else {
        for (const f of this.factories) if (f.ownerId === t.id && f.alive) { f.alive = false; this._particle('hit', f.x, f.y, 0.35); }
        this.factories.push({ id: 'factory-' + (++this.sequence), ownerId: t.id, team: t.team, x, y, radius: spec.radius, hitRadius: 24, hp: 1, maxHp: 1, alive: true, healTimer: 0, age: 0 });
        this._event(`${t.name}部署了修理工厂`);
      }
      return { ok: true };
    }
    findPath(sx, sy, gx, gy) {
      const m = this.map, cols = m.cols, rows = m.rows;
      const startX = clamp(Math.floor(sx / TILE), 1, cols - 2), startY = clamp(Math.floor(sy / TILE), 1, rows - 2);
      let goalX = clamp(Math.floor(gx / TILE), 1, cols - 2), goalY = clamp(Math.floor(gy / TILE), 1, rows - 2);
      if (this.cell(goalX, goalY)) {
        let best = Infinity;
        for (let oy = -5; oy <= 5; oy++) for (let ox = -5; ox <= 5; ox++) if (!this.cell(goalX + ox, goalY + oy) && ox * ox + oy * oy < best) best = ox * ox + oy * oy;
        const originX = goalX, originY = goalY;
        outer: for (let oy = -5; oy <= 5; oy++) for (let ox = -5; ox <= 5; ox++) if (!this.cell(originX + ox, originY + oy) && ox * ox + oy * oy === best) { goalX += ox; goalY += oy; break outer; }
      }
      const start = startY * cols + startX, goal = goalY * cols + goalX;
      if (start === goal) return [{ x: (goalX + 0.5) * TILE, y: (goalY + 0.5) * TILE }];
      const g = new Float32Array(cols * rows); g.fill(Infinity); g[start] = 0;
      const parent = new Int16Array(cols * rows); parent.fill(-1);
      const closed = new Uint8Array(cols * rows), heap = new MinHeap(); heap.push({ n: start, f: 0 });
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      while (heap.a.length) {
        const { n } = heap.pop(); if (closed[n]) continue; closed[n] = 1;
        if (n === goal) {
          const path = []; let at = goal;
          while (at !== start && at >= 0) { path.push({ x: ((at % cols) + 0.5) * TILE, y: (Math.floor(at / cols) + 0.5) * TILE }); at = parent[at]; }
          return path.reverse();
        }
        const x = n % cols, y = Math.floor(n / cols);
        for (const [dx, dy] of dirs) {
          const nx = x + dx, ny = y + dy;
          if (this.cell(nx, ny) || (dx && dy && (this.cell(x + dx, y) || this.cell(x, y + dy)))) continue;
          const nn = ny * cols + nx, ng = g[n] + (dx && dy ? 1.414214 : 1);
          if (closed[nn] || ng >= g[nn]) continue;
          g[nn] = ng; parent[nn] = n;
          const ax = Math.abs(goalX - nx), ay = Math.abs(goalY - ny);
          heap.push({ n: nn, f: ng + Math.max(ax, ay) + 0.414214 * Math.min(ax, ay) });
        }
      }
      return [];
    }
    _ai(t, dt) {
      t.aiShotDelay = Math.max(0, t.aiShotDelay - dt);
      t.aiStrikeDelay = Math.max(0, t.aiStrikeDelay - dt);
      const enemies = this.tanks.filter(o => o.alive && o.team !== t.team);
      if (!enemies.length) return;
      let target = enemies.reduce((a, b) => dist(t, a) < dist(t, b) ? a : b);
      const hostileFactories = this.factories.filter(f => f.alive && f.team !== t.team && dist(t, f) < 480 && this.lineClear(t.x, t.y, f.x, f.y));
      // Repair stations must remain destructible in practice, or sustained healing can stall a match.
      if (hostileFactories.length) target = hostileFactories.reduce((a, b) => dist(t, a) < dist(t, b) ? a : b);
      t.targetId = target.id;
      const d = dist(t, target), aim = Math.atan2(target.y - t.y, target.x - t.x), snapped = snap(aim);
      const clear = this.lineClear(t.x, t.y, target.x, target.y);
      const incoming = this.bullets.some(b => b.team !== t.team && Math.hypot(b.x - t.x, b.y - t.y) < 155);
      const warning = this.strikes.some(s => s.team !== t.team && Math.hypot(s.x - t.x, s.y - t.y) < s.radius + 12);
      if (t.level >= 10 && t.cd.shield <= 0 && (incoming || warning || d < 210)) this._cast(t, 'shield');
      if (t.level >= 5 && t.cd.strike <= 0 && t.aiStrikeDelay <= 0 && d < 535) {
        if (this._cast(t, 'strike', target.x, target.y).ok) t.aiStrikeDelay = 14 + this.random() * 5;
      }
      if (t.level >= 15 && t.cd.factory <= 0 && t.hp <= t.maxHp - 2 && !this.factories.some(f => f.alive && f.ownerId === t.id)) {
        for (let i = 0; i < 8; i++) { const a = aim + Math.PI + i * STEP, x = t.x + Math.cos(a) * 65, y = t.y + Math.sin(a) * 65; if (this._cast(t, 'factory', x, y).ok) break; }
      }
      const canHit = Math.abs(Math.sin(angleDiff(aim, snapped)) * d) <= (target.hitRadius || RADIUS) + 3;
      if (clear && d < 500 && canHit && t.fireCD <= 0 && t.aiShotDelay <= 0) {
        t.angle = snapped; this._fire(t); t.shotHold = 0.18;
        t.aiShotDelay = 2.4 + this.random() * 1.6;
        return;
      }
      if (t.shotHold > 0) { t.shotHold -= dt; return; }
      // Sidestep an announced enemy strike instead of remaining motionless in its center.
      if (warning) {
        const s = this.strikes.find(s => s.team !== t.team && Math.hypot(s.x - t.x, s.y - t.y) < s.radius + 12);
        let a = Math.atan2(t.y - s.y, t.x - s.x); if (Math.hypot(t.x - s.x, t.y - s.y) < 5) a = aim + Math.PI / 2;
        this._move(t, Math.cos(a), Math.sin(a), dt); t.aiTimer = 0; return;
      }
      t.aiTimer -= dt;
      if (t.aiTimer <= 0 || !t.path.length) {
        t.aiTimer = 0.7 + this.random() * 0.35;
        const healing = this.factories.find(f => f.alive && f.team === t.team && t.hp < t.maxHp - 1 && dist(t, f) < 650);
        let goal = target;
        if (healing) {
          if (dist(t, healing) < healing.radius - 20) {
            if (clear && canHit && d < 500 && t.aiShotDelay <= 0) { t.angle = snapped; this._fire(t); t.aiShotDelay = 2.4 + this.random() * 1.6; }
            return;
          }
          goal = { x: healing.x + Math.cos(aim) * 60, y: healing.y + Math.sin(aim) * 60 };
        } else if (d < 700) {
          let best = Infinity;
          for (let k = 0; k < 8; k++) for (const range of [180, 280, 380]) {
            const a = k * STEP, candidate = { x: target.x + Math.cos(a) * range, y: target.y + Math.sin(a) * range };
            if (!this._terrainStand(candidate.x, candidate.y) || !this.lineClear(candidate.x, candidate.y, target.x, target.y)) continue;
            const score = dist(t, candidate) + Math.abs(range - 280) * 0.1;
            if (score < best) { best = score; goal = candidate; }
          }
        }
        t.path = this.findPath(t.x, t.y, goal.x, goal.y);
        // A tank can be off-center after dodging or sliding. Re-center before the
        // first grid turn if its circular body would otherwise clip a cliff corner.
        if (t.path.length && !this._walkClear(t.x, t.y, t.path[0].x, t.path[0].y)) {
          t.path.unshift({ x: (Math.floor(t.x / TILE) + 0.5) * TILE, y: (Math.floor(t.y / TILE) + 0.5) * TILE });
        }
        // Last waypoint keeps the exact firing lane rather than a tile-center-only approximation.
        if (this._terrainStand(goal.x, goal.y)) t.path.push({ x: goal.x, y: goal.y });
      }
      while (t.path.length && Math.hypot(t.path[0].x - t.x, t.path[0].y - t.y) < 7) t.path.shift();
      if (t.path.length) {
        const p = t.path[0], moved = this._move(t, p.x - t.x, p.y - t.y, dt);
        t.stuck = moved ? 0 : t.stuck + dt;
        if (!moved) {
          // Test the eight local headings to yield around another tank. A fixed
          // sideways choice can deadlock several allies at the same cliff corner.
          let bestAngle = null, bestScore = Infinity;
          for (let k = 0; k < 8; k++) {
            const a = k * STEP, nx = t.x + Math.cos(a) * t.speed * dt, ny = t.y + Math.sin(a) * t.speed * dt;
            if (!this.canStand(nx, ny, RADIUS, t.id)) continue;
            const score = Math.hypot(p.x - nx, p.y - ny);
            if (score < bestScore) { bestScore = score; bestAngle = a; }
          }
          if (bestAngle !== null) this._move(t, Math.cos(bestAngle), Math.sin(bestAngle), dt);
          if (t.stuck > 1) { t.path = []; t.aiTimer = 0; t.stuck = 0; }
        }
      }
    }
    _updateProjectiles(dt) {
      for (const b of this.bullets) {
        const x2 = b.x + b.vx * dt, y2 = b.y + b.vy * dt;
        let hitAt = this._wallHit(b.x, b.y, x2, y2), victim = null;
        for (const t of this.tanks) if (t.alive && t.team !== b.team) {
          const at = segmentCircle(b.x, b.y, x2, y2, t.x, t.y, t.radius + 3);
          if (at < hitAt) { hitAt = at; victim = t; }
        }
        for (const f of this.factories) if (f.alive && f.team !== b.team) {
          const at = segmentCircle(b.x, b.y, x2, y2, f.x, f.y, f.hitRadius);
          if (at < hitAt) { hitAt = at; victim = f; }
        }
        if (hitAt <= 1) {
          this._particle('hit', b.x + (x2 - b.x) * hitAt, b.y + (y2 - b.y) * hitAt, 0.35);
          if (victim) this._damageQueue.push({ target: victim, damage: 1, source: b.ownerId });
          b.dead = true;
        } else { b.x = x2; b.y = y2; b.range -= 500 * dt; b.age += dt; if (b.range <= 0) b.dead = true; }
      }
      this.bullets = this.bullets.filter(b => !b.dead);
      for (const s of this.strikes) {
        s.age += dt; s.remaining = Math.max(0, s.duration - s.age);
        if (s.age < s.duration) continue;
        this._particle('explosion', s.x, s.y, 0.8);
        for (const t of this.tanks) if (t.alive && t.team !== s.team && Math.hypot(t.x - s.x, t.y - s.y) <= s.radius + t.radius) this._damageQueue.push({ target: t, damage: SPECS.strike.damage, source: s.ownerId });
        for (const f of this.factories) if (f.alive && f.team !== s.team && Math.hypot(f.x - s.x, f.y - s.y) <= s.radius + f.hitRadius) this._damageQueue.push({ target: f, damage: 1, source: s.ownerId });
        s.dead = true;
      }
      this.strikes = this.strikes.filter(s => !s.dead);
    }
    _resolveDamage() {
      for (const d of this._damageQueue) {
        const t = d.target;
        if (t.shieldRemaining > 0) { t.shieldRemaining = 0; this._particle('shield', t.x, t.y, 0.5, '抵挡'); continue; }
        t.hp = Math.max(0, t.hp - d.damage); this.stats.hits++;
        this._particle('hit', t.x, t.y, 0.65, '-' + d.damage);
      }
      this._damageQueue.length = 0;
      for (const t of this.tanks) if (t.alive && t.hp <= 0) {
        t.alive = false; t.shieldRemaining = 0; t.path = []; this.stats.destroyed++;
        this._particle('death', t.x, t.y, 1.8); this._event(`${t.name}被击毁`);
      }
      for (const f of this.factories) if (f.alive && f.hp <= 0) { f.alive = false; this._particle('explosion', f.x, f.y, 0.6); this._event('修理工厂被摧毁'); }
    }
    _updateFactories(dt) {
      for (const f of this.factories) {
        if (!f.alive) continue; f.age += dt; f.healTimer += dt;
        if (f.healTimer < 1) continue; f.healTimer -= 1;
        for (const t of this.tanks) if (t.alive && t.team === f.team && t.hp < t.maxHp && Math.hypot(t.x - f.x, t.y - f.y) <= f.radius && this.elapsed - t.lastFactoryHealAt >= 1 - 1e-7) {
          t.hp = Math.min(t.maxHp, t.hp + 1); t.lastFactoryHealAt = this.elapsed; this.stats.heals++;
          this._particle('heal', t.x, t.y, 1, 'HP++');
        }
      }
      this.factories = this.factories.filter(f => f.alive);
    }
    _checkResult() {
      const a = this.tanks.some(t => t.alive && t.team === 0), b = this.tanks.some(t => t.alive && t.team === 1);
      if (!a && !b) this.result = 'draw'; else if (!b) this.result = 'win'; else if (!a) this.result = 'loss';
      if (this.result) this._event(this.result === 'win' ? '胜利 · 敌方全灭' : this.result === 'loss' ? '失败 · 己方全灭' : '平局 · 双方同时全灭');
    }
    step(dt, input = {}) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      dt = Math.min(dt, 0.1);
      for (const p of this.particles) p.age += dt;
      this.particles = this.particles.filter(p => p.age < p.life).slice(-180);
      if (this.result) return;
      this.elapsed += dt;
      for (const t of this.tanks) if (t.alive) {
        t.fireCD = Math.max(0, t.fireCD - dt); t.shieldRemaining = Math.max(0, t.shieldRemaining - dt);
        for (const k of Object.keys(t.cd)) t.cd[k] = Math.max(0, t.cd[k] - dt);
        if (t.isPlayer) { this._move(t, Number(input.moveX) || 0, Number(input.moveY) || 0, dt); if (input.fire) this._fire(t); }
        else this._ai(t, dt);
      }
      this._updateProjectiles(dt); this._resolveDamage(); this._updateFactories(dt); this._checkResult();
    }
  }
  TankCore.SPECS = SPECS;
  root.TankCore = TankCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = TankCore;
})(typeof globalThis !== 'undefined' ? globalThis : window);
