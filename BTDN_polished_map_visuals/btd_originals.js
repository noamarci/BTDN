/* =====================================================================
   Bloons TD N  —  Original Towers: 3 paths x 5 tiers  (btd_originals.js)
   ---------------------------------------------------------------------
   Gives the 14 original towers (Dart, Boomerang, Bomb, Tack, Ice, Glue,
   Sniper, Heli, Ninja, Wizard, Super, Alchemist, Farm, Village) the same
   three-path / five-tier upgrade system the 8 expansion towers already
   have (210 new upgrade tiers).  It runs on top of btd_expansion.js and
   re-uses its upgrade engine, panel, projectiles and effects, so it must
   be loaded AFTER btd_expansion.js:

     <script src="btd_expansion.js" data-map="classic"></script>
     <script src="btd_originals.js"></script>

   Crosspath rules (same as the expansion): max two paths upgraded, only
   one of them past tier 2.  If this file is missing, the original towers
   simply fall back to their old single upgrade.
   ===================================================================== */
(function () {
'use strict';
const BT = window.BTDX, A = BT && BT.api;
if (!A) { console.error('[BTDO] btd_expansion.js (v2) not found - original-tower upgrades not loaded.'); return; }
const DEFS = BT.DEFS, SPR = BT.SPR;
const { EXT, STEPS, addFx, hurt, explode, fxBoom, pickTarget, pickMany, nearestBloon, rateMul, mkDart, launchShell,
        slowBloon, burnBloon, rnd, clamp, TAU, segDist, onScreen, lerpAngle, prog, strength, predict, W, H, XPS,
        mk, R, U, circ, ell, rect, poly, monkeyHead, topTier, pickTrackPoint, layPile, updateSpikes, updatePatches } = A;
const NOW = () => A.NOW();
const PRIMARY = { Dart: 1, Boomerang: 1, Bomb: 1, Tack: 1, Ice: 1, Glue: 1 };
const SEC = 60;                                   // ticks per second
const MAP = A.MAP;
const sgn = v => (v < 0 ? -1 : 1);

/* ------------------------------------------------------------------ *
 * 1. SMALL SHARED HELPERS
 * ------------------------------------------------------------------ */
const live = b => b.hp > 0;
const cdOf = t => {                                // cooldown between attacks (ticks)
    let r = t.s.rate * rateMul(t);
    if (t.abRate && t.abRate.until > NOW()) r *= t.abRate.f;
    return Math.max(1, r);
};
const losOf = t => !(t.type === 'Sniper' || t.type === 'Heli');
function aimAt(t, tg, k) { const a = Math.atan2(tg.y - t.y, tg.x - t.x); t.angle = lerpAngle(t.angle, a, k || 0.45); return a; }
function inRange(t, range, o) {                    // any bloon in range?
    return pickTarget(t, range, 'first', Object.assign({ los: losOf(t) }, o || {}));
}
/* an ability timer: returns true exactly once per cycle, never while bloons are absent */
function abReady(t, key, every, needBloons) {
    t.ab = t.ab || {};
    let c = t.ab[key];
    if (c === undefined) c = Math.round(every * 0.55);
    if (c > 0) c--;
    t.ab[key] = c;
    if (c > 0) return false;
    if (needBloons !== false && !(roundInProgress && bloons.some(live))) return false;
    t.ab[key] = every;
    return true;
}
const abLeft = (t, key) => t.ab && t.ab[key] !== undefined ? Math.max(0, Math.ceil(t.ab[key] / SEC)) : null;

/* ------------------------------------------------------------------ *
 * 2. STATUS EFFECTS  (vulnerability, acid DoT, push-back, universal slow)
 * ------------------------------------------------------------------ */
/* "Vulnerable": every damage instance on the bloon is increased for a while.
   The strongest bonus wins; it never stacks.                                */
function setVuln(b, d, dur) {
    if (!live(b) || d <= 0) return;
    const v = b.xVuln;
    if (!v || v.until <= NOW() || d >= v.d) b.xVuln = { d, until: Math.max(NOW() + dur, v && v.until > NOW() ? v.until : 0) };
    else v.until = Math.max(v.until, NOW() + dur);
}
const _damageBloon = damageBloon;
damageBloon = function (b, amount) {
    if (amount > 0 && b.xVuln && b.xVuln.until > NOW()) amount += b.xVuln.d;
    return _damageBloon.call(this, b, amount);
};
/* Acid / poison damage over time (the strongest source is kept) */
function acid(b, a) {
    if (!live(b)) return;
    const c = b.xAcid;
    if (!c || a.d >= c.d) b.xAcid = { d: a.d, t: a.t, n: a.n || 30, c: a.n || 30, cer: a.cer || 0, blimp: a.blimp || 0, spread: a.spread || 0 };
    else c.t = Math.max(c.t, a.t);
}
/* push a bloon back along the track (used by knock-back style upgrades) */
function pushBack(b, px) {
    if (!live(b) || px <= 0) return;
    let rem = px, i = clamp(b.waypointIndex, 1, path.length - 1), guard = 0;
    while (rem > 0 && guard++ < 12) {
        const prev = path[i - 1], dx = prev.x - b.x, dy = prev.y - b.y, d = Math.hypot(dx, dy);
        if (d > rem) { b.x += dx / d * rem; b.y += dy / d * rem; rem = 0; }
        else { b.x = prev.x; b.y = prev.y; rem -= d; if (i - 1 >= 1) { i--; b.waypointIndex = i; } else rem = 0; }
    }
}
/* slow that also works on blimps (used by abilities that are meant to) */
function slowAny(b, f, t) {
    if (!live(b)) return;
    if (!(b.glueTimer > 0) || f <= b.glueSlow) { b.glueSlow = f; b.glueTimer = Math.max(b.glueTimer || 0, t); }
}
/* freeze: blimps only freeze for a limited time so nothing is permanently locked */
function freezeBloon(b, dur) {
    if (!live(b)) return;
    const d = b.isBlimp ? Math.min(dur, 42) : dur;
    b.frozenTimer = Math.max(b.frozenTimer || 0, d);
}
/* per-tick status processing + buff aggregation run before the tower steppers */
function bloonStatuses() {
    const bl = bloons;
    for (let i = 0; i < bl.length; i++) {
        const b = bl[i], c = b.xAcid;
        if (!c) continue;
        if (b.hp <= 0 || --c.t <= 0) { b.xAcid = null; continue; }
        if (--c.c <= 0) {
            c.c = c.n;
            let d = c.d; if (c.cer && b.type === 'Ceramic') d += c.cer; if (c.blimp && b.isBlimp) d += c.blimp;
            damageBloon(b, d);
            if (c.spread && b.hp > 0) {
                const o = nearestBloon(b.x, b.y, 46, null);
                if (o && o !== b && !o.xAcid) acid(o, { d: Math.max(1, c.d - 1), t: Math.min(c.t, 150), n: c.n });
            }
        }
    }
}
EXT.pre.push(bloonStatuses);

/* ------------------------------------------------------------------ *
 * 3. BUFF AGGREGATION  (Village, Alchemist brews, Super/Ninja/Heli auras)
 *    Rule: for each channel the STRONGEST active source wins - nothing
 *    stacks, nothing is re-applied every frame, and everything expires the
 *    moment the source is sold / out of range / timed out.
 * ------------------------------------------------------------------ */
function auraSources() {
    const src = [];
    for (const t of towers) {
        if (!t.xt || !t.xt.aura) continue;
        let list = t.xt.aura(t);
        if (!list) continue;
        if (!Array.isArray(list)) list = [list];
        for (const a of list) { a.src = t; if (a.x === undefined) { a.x = t.cx !== undefined ? t.cx : t.x; a.y = t.cy !== undefined ? t.cy : t.y; } src.push(a); }
    }
    return src;
}
function applyBuffs() {
    const src = auraSources(), now = NOW();
    for (const u of towers) {
        if (!u.xt || !u.s || u.xt.noBuff) continue;
        let rate = 1, rangeP = 0, dmg = 0, pierce = 0, cer = 0, bli = 0, vis = null;
        for (let k = 0; k < src.length; k++) {
            const a = src[k];
            if (a.src === u) { if (!a.self) continue; }
            else if (!a.global && Math.hypot(u.x - a.x, u.y - a.y) > a.r) continue;
            if (a.only && !a.only(u)) continue;
            const v = (a.prim && PRIMARY[u.type]) ? a.prim : null;
            const g = f => Math.max(a[f] || 0, v && v[f] || 0);
            const r = Math.min(a.rate || 1, v && v.rate || 1);
            if (r < rate) { rate = r; vis = a.vis || vis; }
            rangeP = Math.max(rangeP, g('rangeP')); dmg = Math.max(dmg, g('dmg')); pierce = Math.max(pierce, g('pierce'));
            cer = Math.max(cer, g('cer')); bli = Math.max(bli, g('bli'));
            if (!vis && (a.dmg || a.pierce || a.rangeP)) vis = a.vis || null;
        }
        const br = u.xBrew;
        if (br && br.until > now) {
            if ((br.rate || 1) < rate) { rate = br.rate; vis = '#7CFC00'; }
            dmg = Math.max(dmg, br.dmg || 0); pierce = Math.max(pierce, br.pierce || 0);
        } else if (br) u.xBrew = null;
        if (u.xCall && u.xCall.until > now) { if (u.xCall.rate < rate) { rate = u.xCall.rate; vis = '#ff9f1c'; } dmg = Math.max(dmg, u.xCall.dmg || 0); }
        else if (u.xCall) u.xCall = null;
        u.xBuffRate = rate < 1 ? rate : 0; u.bfVis = vis;
        const s = u.s;
        /* flat channels are applied as deltas on the freshly built stat block, so recompute() resets them cleanly */
        const set = (key, field, want, minBase) => {
            const had = s[key] || 0;
            if (had === want) return;
            if (minBase !== undefined && s[field] <= minBase) { s[key] = 0; return; }
            s[field] += want - had; s[key] = want;
        };
        set('_bd', 'dmg', dmg, 0); set('_bp', 'pierce', pierce, 0); set('_bc', 'ceramic', cer); set('_bb', 'blimp', bli);
        if (u.xt.kind !== 'ace') {
            const baseR = s.range - (s._br || 0), want = Math.round(baseR * rangeP);
            if (want !== (s._br || 0) && baseR < 2000) { s.range = baseR + want; s._br = want; u.range = s.range; u.candR = null; }
        }
        u.damage = s.dmg; u.pierce = s.pierce;
    }
}
EXT.pre.push(applyBuffs);

/* Upgrade discounts (Monkey Commerce line): the best village in range applies, never stacks */
EXT.price = function (t, cost) {
    let best = 0;
    for (const v of towers) {
        if (!v.xt || !v.xt.orig || !v.s.disc) continue;
        if (Math.hypot(t.x - v.x, t.y - v.y) <= v.s.vr) best = Math.max(best, v.s.disc);
    }
    return best ? Math.max(1, Math.round(cost * (1 - best))) : cost;
};

/* ------------------------------------------------------------------ *
 * 4. MINIONS  (temporary or permanent summoned helpers)
 *    They are real objects: they have lifetimes, positions, targets and
 *    fire real projectiles / explosions.
 * ------------------------------------------------------------------ */
function addMinion(t, o) {
    if (t.mn.length > 24) return null;
    const m = Object.assign({ x: t.x, y: t.y, life: 600, cd: 10, ang: 0, orb: rnd(0, TAU), orR: 32, orS: 0.045, flash: 0, rate: 12, range: 130, dmg: 1, pierce: 2, style: 'dart', kind: 'turret' }, o);
    t.mn.push(m);
    addFx({ k: 'ring', x: t.x, y: t.y, r0: 6, r1: 26, life: 14, col: m.col || '#ffd54a', w: 2 });
    return m;
}
function minionShot(t, m, tg) {
    const a = Math.atan2(tg.y - m.y, tg.x - m.x);
    m.ang = a;
    const p = mkDart(m.x, m.y, a + rnd(-0.04, 0.04), t.s, {
        dmg: m.dmg, pierce: m.pierce, style: m.style, range: m.range, spd: m.spd || 14, pr: m.pr || 3.5,
        ceramic: m.ceramic || 0, blimp: m.blimp || 0, burn: m.burn || null, slow: m.slow || null, stun: m.stun || 0,
        homing: m.homing || 0, aoe: m.aoe || 0, tgt: null
    });
    m.flash = 3;
    return p;
}
function stepMinions(t) {
    const arr = t.mn;
    if (!arr.length) return;
    const cx = t.cx !== undefined ? t.cx : t.x, cy = t.cy !== undefined ? t.cy : t.y;
    for (let i = arr.length - 1; i >= 0; i--) {
        const m = arr[i];
        if (m.life !== Infinity && --m.life <= 0) { addFx({ k: 'puff', x: m.x, y: m.y, r: 8, life: 14, col: m.col || '#bbb' }); arr.splice(i, 1); continue; }
        if (m.flash > 0) m.flash--;
        if (m.kind === 'phoenix') { stepPhoenix(t, m); continue; }
        m.orb += m.orS; m.x = cx + Math.cos(m.orb) * m.orR; m.y = cy + Math.sin(m.orb) * m.orR;
        if (--m.cd <= 0) {
            const tg = pickTarget(t, m.range, 'first', { x: m.x, y: m.y });
            if (tg) { minionShot(t, m, tg); m.cd = m.rate; } else m.cd = 6;
        }
    }
}
/* the Wizard Lord's phoenix: flies to bloons and detonates in a burst of fire */
function stepPhoenix(t, m) {
    let tg = m.tg && live(m.tg) ? m.tg : null;
    if (!tg) { tg = pickTarget(t, 9999, 'strong', { x: m.x, y: m.y }); m.tg = tg; }
    const tx = tg ? tg.x : t.x + Math.cos(NOW() * 0.03) * 60, ty = tg ? tg.y : t.y + Math.sin(NOW() * 0.03) * 60;
    const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy) || 1, sp = 5.5;
    m.x += dx / d * Math.min(sp, d); m.y += dy / d * Math.min(sp, d); m.ang = Math.atan2(dy, dx);
    if (NOW() % 3 === 0) addFx({ k: 'puff', x: m.x, y: m.y, r: 5, life: 12, col: '#ff8a1a' });
    if (tg && d < 22 && --m.cd <= 0) {
        explode(m.x, m.y, m.aoe, m.dmg, { burn: m.burn, blimp: m.blimp, ceramic: m.ceramic, fx: 'boom', maxHit: 40 });
        m.cd = m.rate; m.tg = null;
    }
}
function drawMinion(m, t) {
    ctx.save(); ctx.translate(m.x, m.y);
    const f = m.flash > 0;
    switch (m.kind) {
        case 'phoenix':
            ctx.rotate(m.ang); ell(ctx, 0, 0, 12, 7, '#ff7a1a', '#7a1f00', 1.2); ell(ctx, -2, 0, 7, 4, '#ffd54a');
            poly(ctx, [[-4, -6], [-16, -18 + Math.sin(NOW() * 0.6) * 5], [-10, -3]], '#ff4d1a'); poly(ctx, [[-4, 6], [-16, 18 - Math.sin(NOW() * 0.6) * 5], [-10, 3]], '#ff4d1a');
            poly(ctx, [[-10, -2], [-26, 0], [-10, 2]], '#ffb347'); circ(ctx, 9, -1.5, 1.4, '#111'); break;
        case 'skel':
            ctx.rotate(m.ang); circ(ctx, 0, 0, 6, '#eceff1', '#455a64', 1); circ(ctx, 2, -2, 1.2, '#222'); circ(ctx, 2, 2, 1.2, '#222');
            rect(ctx, 4, -1, 8, 2, '#8d6e63'); if (f) circ(ctx, 14, 0, 2.5, 'rgba(180,120,255,0.9)'); break;
        case 'fan':
            ctx.rotate(m.ang); poly(ctx, [[-1, -7], [-10, 0], [-1, 7]], '#dc143c'); circ(ctx, 0, 0, 6.5, m.col || '#2b50ff', '#0a1a66', 1);
            ell(ctx, 3, 0, 3.5, 4, '#e8c9a0'); circ(ctx, 4, -1.6, 0.9, '#111'); circ(ctx, 4, 1.6, 0.9, '#111'); if (f) circ(ctx, 11, 0, 2.5, '#fff6a8'); break;
        case 'mheli':
            ctx.rotate(m.ang); ell(ctx, 0, 0, 7, 4.5, '#3b6e4f', '#16301f', 1); rect(ctx, -12, -1, 7, 2, '#222');
            ctx.rotate(-m.ang + NOW() * 0.7); rect(ctx, -11, -1, 22, 2, 'rgba(30,30,30,0.7)'); break;
        case 'clone':
            ctx.rotate(m.ang); circ(ctx, 0, 0, 7, 'rgba(40,40,60,0.8)', '#8aa', 1); circ(ctx, 3, 0, 3, 'rgba(120,120,140,0.8)'); break;
        default: circ(ctx, 0, 0, 6, '#999');
    }
    ctx.restore();
}

/* ------------------------------------------------------------------ *
 * 5. ORBITING BLADES / GLAIVES  (Glaive Lord, Blade Maelstrom, Sun Temple ...)
 * ------------------------------------------------------------------ */
function stepOrbit(t, cfg, active) {
    if (!active) { t.orbOn = false; return; }
    t.orbOn = true; t.orbA = (t.orbA || 0) + cfg.spin;
    t.orbHit = t.orbHit || new Map();
    const now = NOW(), n = cfg.n, cx = t.cx !== undefined ? t.cx : t.x, cy = t.cy !== undefined ? t.cy : t.y;
    t.orbPts = [];
    for (let i = 0; i < n; i++) {
        const a = t.orbA + i * TAU / n, x = cx + Math.cos(a) * cfg.r, y = cy + Math.sin(a) * cfg.r;
        t.orbPts.push({ x, y, a });
        for (const b of bloons) {
            if (!live(b)) continue;
            if (Math.abs(b.x - x) > b.radius + cfg.hr + 4 || Math.abs(b.y - y) > b.radius + cfg.hr + 4) continue;
            if (Math.hypot(b.x - x, b.y - y) > b.radius + cfg.hr) continue;
            const last = t.orbHit.get(b);
            if (last !== undefined && now - last < cfg.cd) continue;
            t.orbHit.set(b, now);
            hurt(b, cfg.dmg, { ceramic: cfg.ceramic || 0, blimp: cfg.blimp || 0, burn: cfg.burn || null });
        }
    }
    if (t.orbHit.size > 160) { for (const [b, v] of t.orbHit) if (!live(b) || now - v > 90) t.orbHit.delete(b); }
}
function drawOrbit(t) {
    if (!t.orbOn || !t.orbPts) return;
    const cfg = t.orbCfg;
    for (const p of t.orbPts) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a * 3 + NOW() * 0.3);
        if (cfg.look === 'glaive') { poly(ctx, [[0, -10], [3, -3], [10, 0], [3, 3], [0, 10], [-3, 3], [-10, 0], [-3, -3]], '#d8dde3', '#5d6770', 1); circ(ctx, 0, 0, 2, '#7f8c8d'); }
        else if (cfg.look === 'sun') { circ(ctx, 0, 0, 7, 'rgba(255,230,120,0.9)'); circ(ctx, 0, 0, 3.5, '#fff'); }
        else { poly(ctx, [[0, -8], [2.5, -2], [8, 0], [2.5, 2], [0, 8], [-2.5, 2], [-8, 0], [-2.5, -2]], '#e8e8ee', '#44484e', 1); circ(ctx, 0, 0, 1.8, '#c0392b'); }
        ctx.restore();
    }
}

/* ------------------------------------------------------------------ *
 * 6. PERIODIC / SHARED ATTACK HELPERS
 * ------------------------------------------------------------------ */
/* lobbed shell with an arbitrary landing point (cluster bombs, blitz, crates ...) */
function lob(t, sx, sy, tx, ty, k) {
    XPS.push({
        kind: 'shell', style: k.style || 'bomb', sx, sy, x: sx, y: sy, z: 0, tx, ty, t: 0, T: k.T || 16, h: k.h || 20,
        dmg: k.dmg, aoe: k.aoe, ceramic: k.ceramic || 0, blimp: k.blimp || 0, stun: k.stun || 0, burn: k.burn || null,
        slow: k.slow || null, maxHit: k.maxHit, patch: k.patch || null, owner: t, fx: k.fx || (k.burn ? 'mortar' : 'boom'),
        apply: k.apply || null, done: k.done || null
    });
}
/* instant radial pulse around a point (flames, shock waves, freeze nova ...) */
function pulse(x, y, r, d, o, fxStyle) {
    o = o || {};
    let n = 0;
    for (const b of bloons) {
        if (!live(b)) continue;
        if (Math.hypot(b.x - x, b.y - y) > r + b.radius * 0.4) continue;
        if (++n > (o.maxHit || 90)) break;
        hurt(b, d, o);
        if (o.push && !b.isBlimp) pushBack(b, o.push);
        if (o.pushB && b.isBlimp) pushBack(b, o.pushB);
        if (o.freeze) freezeBloon(b, o.freeze);
    }
    if (fxStyle !== false) {
        addFx({ k: 'ring', x, y, r0: r * 0.2, r1: r, life: 14, col: (o.col || '#ffd2a0'), w: 4 });
        addFx({ k: 'flash', x, y, r: r * 0.7, life: 8, col: o.flash || 'rgba(255,200,120,0.6)' });
    }
    return n;
}
/* hitscan hit that chains to nearby bloons (ricochets, bouncing bullets, shrapnel) */
function chainHits(first, n, link, d, o, col) {
    const hit = new Set(), pts = [];
    let cur = first;
    for (let i = 0; i < n && cur; i++) {
        hit.add(cur); pts.push({ x: cur.x, y: cur.y });
        hurt(cur, d, o);
        let nx = null, nd = link;
        for (const b of bloons) { if (!live(b) || hit.has(b)) continue; const dd = Math.hypot(b.x - cur.x, b.y - cur.y); if (dd < nd) { nd = dd; nx = b; } }
        cur = nx;
    }
    return pts;
}
function beamLine(t, ox, oy, a, len, wid, maxHit, d, o, col) {
    const x2 = ox + Math.cos(a) * len, y2 = oy + Math.sin(a) * len, hits = [];
    for (const b of bloons) { if (live(b) && segDist(b.x, b.y, ox, oy, x2, y2) <= b.radius + wid) hits.push(b); }
    hits.sort((p, q) => Math.hypot(p.x - ox, p.y - oy) - Math.hypot(q.x - ox, q.y - oy));
    for (let i = 0; i < hits.length && i < maxHit; i++) hurt(hits[i], d, o);
    addFx({ k: 'lbeam', x1: ox, y1: oy, x2, y2, life: 7, col: col || '#ff3b6b', w: wid });
    return hits.length;
}
const centerOf = t => ({ x: t.cx !== undefined ? t.cx : t.x, y: t.cy !== undefined ? t.cy : t.y });
function cashFx(x, y, amt) { if (amt > 0) addFx({ k: 'txt', x, y: y - 20, s: '+$' + Math.round(amt), col: '#7CFC00', life: 50 }); }
function giveMoney(x, y, amt) { amt = Math.round(amt); if (amt <= 0) return; money += amt; cashFx(x, y, amt); updateMainUI(); }
const fmt1 = v => (Math.round(v * 10) / 10).toString();
const rps = t => (60 / cdOf(t)).toFixed(1) + '/s';

/* ------------------------------------------------------------------ *
 * 7. DEFINITION HELPERS
 * ------------------------------------------------------------------ */
const B = v => '<b>' + v + '</b>';
function baseInit(t) {
    t.mn = []; t.sgN = 0; t.angle = -0.6; t.orbCfg = null; t.recoil = 0;
    if (t.isVillage) t.isVillage = false;          // the old village aura is replaced by this module's aggregator
}
function orig(type, o) {
    const T = TOWER_TYPES[type];
    const d = Object.assign({ orig: true, cost: T.cost, radius: T.radius, color: T.color, muzzle: 12 }, o);
    const own = o.init2;
    d.init = t => { baseInit(t); if (own) own(t); };
    d.ground = t => { for (const m of t.mn) drawMinion(m, t); drawOrbit(t); if (o.ground2) o.ground2(t); };
    d.statLine = t => {
        const s = t.s, p = ['Range ' + B(s.range > 2000 ? '∞' : Math.round(s.range))];
        if (s.rate) p.push('Rate ' + B(rps(t)));
        if (s.dmg > 0 && !o.noDmgStat) p.push('Dmg ' + B(s.dmg + (t.sgN || 0)));
        if (s.pierce && !o.noPierceStat) p.push('Pierce ' + B(s.pierce));
        const ex = o.stats ? o.stats(t) : [];
        return p.concat(ex).filter(Boolean).join(' · ');
    };
    DEFS[type] = d;
    return d;
}
function baseTick(t) {
    if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - 0.18);
    if (t.mn.length) stepMinions(t);
    if (t.spikes.length) updateSpikes(t);
    if (t.patches.length) updatePatches(t);
}
const sgBonus = t => t.sgN || 0;
const burnOf = (d, ticks, n) => ({ d, t: ticks, n: n || 30 });

/* ================================================================== *
 *  1. DART MONKEY
 * ================================================================== */
function fireDart(t, tg) {
    const s = t.s, a = aimAt(t, tg, 1), mx = t.x + Math.cos(a) * 11, my = t.y + Math.sin(a) * 11, n = s.shots;
    for (let i = 0; i < n; i++) {
        const off = (n > 1 ? (i / (n - 1) - 0.5) * s.fan : 0) + (Math.random() - 0.5) * s.spread;
        const p = mkDart(mx, my, a + off, s, { dmg: s.dmg + sgBonus(t), tgt: s.homing ? tg : null });
        if (s.split) {
            const sp = s.split;
            p.onDie = q => { for (let k = 0; k < sp.n; k++) mkDart(q.x, q.y, k * TAU / sp.n + rnd(0, 1), s, { style: 'dart', dmg: sp.dmg, pierce: sp.pierce, range: 85, spd: 9, pr: 3.5, homing: 0, aoe: 0, blimp: s.blimp, ceramic: s.ceramic }); };
        }
    }
    t.recoil = 1; t.shots++;
}
function summonClub(t) {
    const c = t.s.club;
    for (const m of t.mn) if (m.kind === 'fan') m.life = 0;
    for (let i = 0; i < c.n; i++) addMinion(t, { kind: 'fan', life: c.dur, rate: c.rate, dmg: c.dmg, pierce: c.pierce, style: c.style, range: t.s.range * 1.15, orR: 34 + (i % 2) * 14, orb: i * TAU / c.n, orS: 0.05, col: c.col, spd: 15, ceramic: t.s.ceramic, blimp: t.s.blimp, pr: 4 });
}
STEPS.o_dart = function (t) {
    baseTick(t);
    const s = t.s;
    if (t.cd > 0) t.cd--;
    if (s.club && abReady(t, 'club', s.club.every)) summonClub(t);
    const tg = pickTarget(t, s.range, t.mode, { los: true });
    if (tg) { aimAt(t, tg); if (t.cd <= 0) { fireDart(t, tg); t.cd = cdOf(t); } }
};
orig('Dart', {
    name: 'Dart Monkey', cat: 'Primary', kind: 'o_dart', muzzle: 11,
    blurb: 'Throws a single dart. Cheap, reliable and upgradable in every direction.',
    base: mk({ range: 120, rate: 35, dmg: 1, pierce: 2, spd: 10, pr: 3.5, spread: 0, style: 'dart' }),
    stats: t => [t.s.shots > 1 ? 'Darts ' + B(t.s.shots) : '', t.s.club ? '⚡ Fan Club ' + B(abLeft(t, 'club') + 's') : '', t.s.sg ? 'Focus ' + B('+' + sgBonus(t)) : ''],
    paths: [
        { name: 'Sharpness', up: [
            U('Sharp Shots', 140, '+2 pierce.', s => { s.pierce += 2; }),
            U('Razor Sharp Shots', 220, '+3 pierce, +1 damage vs ceramic.', s => { s.pierce += 3; s.ceramic += 1; }),
            U('Spike-o-pult', 650, 'Hurls heavy spiked balls: +1 damage, 14 pierce, slower.', s => { s.style = 'sball'; s.dmg += 1; s.pierce = 14; s.rate = R(s.rate * 1.5); s.pr = 7; s.spd = 7.5; s.ceramic += 1; s.range += 10; }),
            U('Juggernaut', 2200, 'Giant rolling ball: 3 damage, 24 pierce, +3 vs ceramic.', s => { s.style = 'jug'; s.dmg = 3; s.pierce = 24; s.pr = 11; s.spd = 7; s.ceramic += 3; s.blimp += 2; s.rate = R(s.rate * 0.9); }),
            U('Ultra-Juggernaut', 16000, 'Colossal ball: 6 damage, 40 pierce. Splits into 6 balls when spent.', s => { s.dmg = 6; s.pierce = 40; s.pr = 14; s.ceramic += 6; s.blimp += 8; s.rate = R(s.rate * 0.8); s.split = { n: 6, dmg: 3, pierce: 12 }; }),
        ] },
        { name: 'Quick Shots', up: [
            U('Quick Shots', 100, 'Throws 25% faster.', s => { s.rate = R(s.rate * 0.8); }),
            U('Very Quick Shots', 190, 'Throws 25% faster again.', s => { s.rate = R(s.rate * 0.8); }),
            U('Triple Shot', 400, 'Throws 3 darts in a fan.', s => { s.shots = 3; s.fan = 0.34; }),
            U('Super Monkey Fan Club', 5500, 'Every 45s, 4 super monkeys fire at light speed for 10s.', s => { s.rate = R(s.rate * 0.9); s.club = { every: 2700, dur: 600, n: 4, rate: 8, dmg: 1, pierce: 2, style: 'dart', col: '#2b50ff' }; }),
            U('Plasma Monkey Fan Club', 22000, 'Every 35s, 6 plasma monkeys blast bloons for 15s.', s => { s.shots = 5; s.fan = 0.6; s.rate = R(s.rate * 0.8); s.club = { every: 2100, dur: 900, n: 6, rate: 5, dmg: 2, pierce: 4, style: 'plasma', col: '#ff4fd8' }; }),
        ] },
        { name: 'Long Range', up: [
            U('Long Range Darts', 90, '+25 range.', s => { s.range += 25; }),
            U('Enhanced Eyesight', 200, '+20 range, +1 pierce, +1 vs ceramic. Darts steer a little.', s => { s.range += 20; s.pierce += 1; s.ceramic += 1; s.homing = 0.07; }),
            U('Crossbow', 600, 'Heavy bolts: +2 damage, +1 pierce, faster, far-flying.', s => { s.style = 'xbow'; s.dmg += 2; s.pierce += 1; s.spd = 16; s.range += 20; s.rate = R(s.rate * 0.9); s.pr = 4; }),
            U('Sharp Shooter', 2400, 'Faster crossbow. Gains +1 damage every round (max +6).', s => { s.dmg += 1; s.pierce += 2; s.rate = R(s.rate * 0.85); s.sg = { add: 1, max: 6 }; }),
            U('Crossbow Master', 12000, 'Brutal rate of fire: +3 damage, +3 pierce, +3 vs blimps. +2 damage per round.', s => { s.rate = R(s.rate * 0.4); s.dmg += 3; s.pierce += 3; s.blimp += 3; s.ceramic += 2; s.range += 25; s.sg = { add: 2, max: 12 }; }),
        ] },
    ]
});

/* ================================================================== *
 *  2. BOOMERANG MONKEY
 * ================================================================== */
function throwBoom(t, a, side) {
    const s = t.s;
    XPS.push({
        kind: 'boom', style: s.glaive ? 'glaive' : 'boom', x: t.x, y: t.y, sx: t.x, sy: t.y, ang: a, dist: s.range * 1.1, curve: 70 * side,
        t: 0, T: s.T, hit: new Set(), pierce: s.pierce, dmg: s.dmg, pr: s.pr, ceramic: s.ceramic, blimp: s.blimp, burn: s.burn,
        push: s.push, rico: s.rico, seek: s.seek, size: s.size, owner: t, spin: rnd(0, 6), free: false, back: false, tgt: null, apply: s.apply || null
    });
}
function stepBoom(p) {
    p.t++;
    const t = p.owner;
    if (p.t > p.T * 3) { p.dead = true; return; }
    if (p.seek && !p.back && !p.free && p.t > 3) {
        const o = nearestBloon(p.x, p.y, p.seek, p.hit);
        if (o) { p.free = true; p.tgt = o; }
    }
    if (p.free) {
        let tg = p.tgt;
        if (!tg || !live(tg) || p.hit.has(tg)) { tg = nearestBloon(p.x, p.y, p.seek * 1.2, p.hit); p.tgt = tg; if (!tg) { p.free = false; p.back = true; } }
        if (tg) { const dx = tg.x - p.x, dy = tg.y - p.y, d = Math.hypot(dx, dy) || 1, sp = 10.5; p.x += dx / d * Math.min(sp, d); p.y += dy / d * Math.min(sp, d); }
    }
    if (p.back) {
        const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy) || 1;
        if (d < 14) { p.dead = true; return; }
        p.x += dx / d * 12; p.y += dy / d * 12;
    } else if (!p.free) {
        const u = p.t / p.T;
        if (u >= 1) { p.dead = true; return; }
        const d = Math.sin(u * Math.PI) * p.dist, c = Math.sin(u * Math.PI) * p.curve, dx = Math.cos(p.ang), dy = Math.sin(p.ang);
        p.x = p.sx + dx * d - dy * c; p.y = p.sy + dy * d + dx * c;
    }
    for (const b of bloons) {
        if (!live(b) || p.hit.has(b)) continue;
        const reach = b.radius + p.pr * p.size;
        if (Math.abs(b.x - p.x) > reach || Math.abs(b.y - p.y) > reach || Math.hypot(b.x - p.x, b.y - p.y) > reach) continue;
        p.hit.add(b);
        hurt(b, p.dmg, p);
        if (p.push && b.isBlimp) pushBack(b, p.push);
        if (p.rico) {
            const pts = chainHits(null, 0, 0, 0);
            let cur = b, got = 0;
            while (got < p.rico) {
                let nx = null, nd = 120;
                for (const o of bloons) { if (!live(o) || p.hit.has(o)) continue; const dd = Math.hypot(o.x - cur.x, o.y - cur.y); if (dd < nd) { nd = dd; nx = o; } }
                if (!nx) break;
                addFx({ k: 'bolt', pts: [{ x: cur.x, y: cur.y }, { x: nx.x, y: nx.y }], life: 8, col: '#e6edf3', w: 2 });
                p.hit.add(nx); hurt(nx, p.dmg, p); cur = nx; got++;
            }
        }
        if (--p.pierce <= 0) { p.dead = true; return; }
    }
}
EXT.step.boom = stepBoom;
STEPS.o_boom = function (t) {
    baseTick(t);
    const s = t.s;
    if (t.cd > 0) t.cd--;
    if (s.turbo && abReady(t, 'turbo', s.turbo.every)) { t.abRate = { until: NOW() + s.turbo.dur, f: s.turbo.f }; addFx({ k: 'ring', x: t.x, y: t.y, r0: 8, r1: 44, life: 22, col: '#ff9f1c', w: 4 }); addFx({ k: 'txt', x: t.x, y: t.y - 28, s: 'TURBO!', col: '#ffb347', life: 50 }); }
    t.orbCfg = s.orbit;
    stepOrbit(t, s.orbit, !!s.orbit);
    const tg = pickTarget(t, s.range, t.mode, { los: true });
    if (tg) {
        const a = aimAt(t, tg, 1);
        if (t.cd <= 0) {
            const n = s.shots;
            for (let i = 0; i < n; i++) throwBoom(t, a + (n > 1 ? (i / (n - 1) - 0.5) * 0.5 : 0), i % 2 ? -1 : 1);
            t.recoil = 1; t.cd = cdOf(t);
        }
    }
};
orig('Boomerang', {
    name: 'Boomerang Monkey', cat: 'Primary', kind: 'o_boom', muzzle: 8,
    blurb: 'Throws a boomerang that loops through bloons and flies back.',
    base: mk({ range: 140, rate: 45, dmg: 1, pierce: 3, T: 40, pr: 15, shots: 1, size: 1, glaive: false, seek: 0, rico: 0, push: 0 }),
    stats: t => [t.s.shots > 1 ? 'Throws ' + B(t.s.shots) : '', t.s.rico ? 'Ricochet ' + B(t.s.rico) : '', t.s.turbo ? '⚡ Turbo ' + B(abLeft(t, 'turbo') + 's') : ''],
    paths: [
        { name: 'Speed', up: [
            U('Faster Throwing', 150, 'Throws 25% faster.', s => { s.rate = R(s.rate * 0.75); }),
            U('Faster Rangs', 300, 'Throws 25% faster again.', s => { s.rate = R(s.rate * 0.75); }),
            U('Bionic Boomerang', 2200, 'Hurls at twice the speed: +1 pierce per throw, +2 pierce.', s => { s.rate = R(s.rate * 0.5); s.pierce += 2; s.T = 34; }),
            U('Turbo Charge', 4500, 'Every 30s: 6s of 4x throwing speed. Throws 2 boomerangs.', s => { s.shots = 2; s.turbo = { every: 1800, dur: 360, f: 0.25 }; s.pierce += 1; }),
            U('Perma Charge', 18000, 'Permanent turbo: 3 boomerangs, +2 damage, ultra fast.', s => { s.shots = 3; s.rate = R(s.rate * 0.45); s.dmg += 2; s.pierce += 3; s.ceramic += 2; s.turbo = { every: 1500, dur: 420, f: 0.3 }; }),
        ] },
        { name: 'Glaives', up: [
            U('Improved Rangs', 200, '+3 pierce.', s => { s.pierce += 3; }),
            U('Glaives', 350, 'Silver glaives: 12 pierce and +1 vs ceramic.', s => { s.glaive = true; s.pierce = 12; s.ceramic += 1; }),
            U('Glaive Ricochet', 1800, 'Glaives bounce on to 3 more nearby bloons.', s => { s.rico = 3; s.pierce += 2; }),
            U('M.O.A.R. Glaives', 4500, 'Huge glaives: +2 damage, +6 vs blimps, bigger hit area.', s => { s.dmg += 2; s.blimp += 6; s.ceramic += 2; s.size = 1.6; s.pierce += 6; s.range += 15; }),
            U('Glaive Lord', 13000, 'Three glaives orbit the Monkey, shredding anything near. +3 pierce.', s => { s.orbit = { n: 3, r: 50, spin: 0.09, hr: 11, cd: 12, dmg: 2, ceramic: 2, blimp: 3, look: 'glaive' }; s.rico = 4; s.dmg += 1; s.pierce += 3; s.rate = R(s.rate * 0.8); }),
        ] },
        { name: 'Range & Seeking', up: [
            U('Long Range Rangs', 100, '+25 range.', s => { s.range += 25; }),
            U('Red Hot Rangs', 250, 'Hits set bloons on fire. +1 damage vs ceramic.', s => { s.burn = burnOf(1, 150); s.ceramic += 1; }),
            U('Kylie Boomerang', 1200, 'Seeking: boomerangs hunt down nearby bloons. Faster.', s => { s.seek = 110; s.rate = R(s.rate * 0.8); s.range += 10; s.dmg += 1; }),
            U('MOAB Press', 3800, 'Crushes blimps: +14 damage and knocks them back.', s => { s.blimp += 14; s.push = 14; s.dmg += 1; s.pierce += 3; s.seek = 140; }),
            U('MOAB Domination', 16000, 'Seeking glaive swarm: +60 vs blimps, heavy knockback. Throws 2.', s => { s.blimp += 60; s.push = 26; s.shots = 2; s.dmg += 2; s.pierce += 4; s.ceramic += 3; s.rate = R(s.rate * 0.8); s.glaive = true; s.size = 1.3; }),
        ] },
    ]
});

/* ================================================================== *
 *  3. BOMB SHOOTER
 * ================================================================== */
function bombDie(t, p) {
    if (!p.exp) return;
    const s = t.s;
    if (s.push) { for (const b of bloons) if (live(b) && Math.hypot(b.x - p.x, b.y - p.y) <= p.aoe) pushBack(b, b.isBlimp ? s.push * 0.6 : s.push); }
    if (s.frag) { const f = s.frag; for (let k = 0; k < f.n; k++) mkDart(p.x, p.y, k * TAU / f.n + rnd(0, 0.6), s, { style: 'frag', dmg: f.dmg, pierce: f.pierce, range: f.range, spd: 8, pr: 3, homing: 0, aoe: 0, burn: null, stun: 0, ceramic: s.ceramic, blimp: 0 }); }
    if (s.cluster) {
        const c = s.cluster;
        for (let k = 0; k < c.n; k++) {
            const a = k * TAU / c.n + rnd(0, 0.7), tx = clamp(p.x + Math.cos(a) * c.r, 6, W() - 6), ty = clamp(p.y + Math.sin(a) * c.r, 6, H() - 6);
            lob(t, p.x, p.y, tx, ty, {
                T: 15, h: 18, dmg: c.dmg, aoe: c.aoe, ceramic: s.ceramic, blimp: 0, maxHit: 18,
                done: c.rec ? q => {
                    explode(q.tx, q.ty, q.aoe, q.dmg, q);
                    for (let j = 0; j < c.rec; j++) { const b2 = rnd(0, TAU); lob(t, q.tx, q.ty, clamp(q.tx + Math.cos(b2) * 30, 6, W() - 6), clamp(q.ty + Math.sin(b2) * 30, 6, H() - 6), { T: 12, h: 12, dmg: c.dmg, aoe: c.aoe * 0.8, maxHit: 12 }); }
                } : null
            });
        }
    }
}
function fireBomb(t, tg) {
    const s = t.s, a = aimAt(t, tg, 1), mx = t.x + Math.cos(a) * 14, my = t.y + Math.sin(a) * 14;
    const p = mkDart(mx, my, a, s, { style: s.bstyle, aoe: s.aoe, pierce: 1, pr: 5, spd: s.spd, homing: s.homing, tgt: s.homing ? tg : null });
    p.maxHit = s.maxHit;
    if (s.vuln) p.apply = b => { if (b.isBlimp) setVuln(b, s.vuln, 300); };
    p.onDie = q => bombDie(t, q);
    t.recoil = 1; t.shots++;
}
STEPS.o_bomb = function (t) {
    baseTick(t);
    const s = t.s;
    if (t.cd > 0) t.cd--;
    if (s.blitz && abReady(t, 'blitz', s.blitz.every)) {
        const list = pickMany(t, 0, s.blitz.n, { global: true, random: true });
        for (const b of list) launchShell(t, t.x, t.y, b, { T: 30, h: 80, dmg: s.blitz.dmg, aoe: s.blitz.aoe, jitter: 6, style: 'bomb', blimp: s.blimp, ceramic: s.ceramic, maxHit: 25 });
        addFx({ k: 'ring', x: t.x, y: t.y, r0: 8, r1: 56, life: 22, col: '#ff7a1a', w: 5 }); addFx({ k: 'txt', x: t.x, y: t.y - 28, s: 'BOMB BLITZ!', col: '#ffb347', life: 60 });
    }
    const tg = pickTarget(t, s.range, t.mode, { los: true });
    if (tg) { aimAt(t, tg); if (t.cd <= 0) { fireBomb(t, tg); t.cd = cdOf(t); } }
};
orig('Bomb', {
    name: 'Bomb Shooter', cat: 'Primary', kind: 'o_bomb', muzzle: 14,
    blurb: 'Lobs explosive bombs that blast groups of bloons.',
    base: mk({ range: 130, rate: 65, dmg: 1, pierce: 10, spd: 10, aoe: 60, maxHit: 10, bstyle: 'bomb', frag: null, cluster: null }),
    stats: t => ['Blast ' + B(Math.round(t.s.aoe)), t.s.blitz ? '⚡ Blitz ' + B(abLeft(t, 'blitz') + 's') : ''],
    paths: [
        { name: 'Blast Power', up: [
            U('Bigger Bombs', 250, '+20 blast radius.', s => { s.aoe += 20; }),
            U('Heavy Bombs', 400, '+1 damage, hits 6 more bloons.', s => { s.dmg += 1; s.maxHit += 6; s.pierce += 6; }),
            U('Really Big Bombs', 900, '+25 radius, +1 damage, hits 8 more bloons.', s => { s.aoe += 25; s.dmg += 1; s.maxHit += 8; s.pierce += 8; }),
            U('Bloon Impact', 3200, 'Bombs stun bloons (not blimps). +1 damage.', s => { s.stun = 80; s.dmg += 1; s.ceramic += 1; }),
            U('Bloon Crush', 14000, 'Colossal blasts: +6 damage, knockback, stun. Crushes blimps.', s => { s.aoe += 35; s.dmg += 6; s.stun = 130; s.push = 24; s.blimp += 12; s.ceramic += 4; s.maxHit += 20; s.pierce += 20; s.bstyle = 'bigbomb'; }),
        ] },
        { name: 'Rapid Bombardment', up: [
            U('Faster Reload', 350, 'Fires 25% faster.', s => { s.rate = R(s.rate * 0.75); }),
            U('Missile Launcher', 500, 'Homing missiles: faster, longer range, quicker reload.', s => { s.bstyle = 'missile'; s.spd = 13; s.homing = 0.09; s.range += 12; s.rate = R(s.rate * 0.8); }),
            U('Frag Bombs', 1500, 'Bombs burst into 8 fragments that fly on and pop bloons.', s => { s.frag = { n: 8, dmg: 1, pierce: 3, range: 85 }; s.rate = R(s.rate * 0.9); }),
            U('Cluster Bombs', 4800, 'Bombs split into 4 smaller explosives. Fires faster.', s => { s.cluster = { n: 4, dmg: 1, aoe: 34, r: 50 }; s.rate = R(s.rate * 0.8); s.dmg += 1; }),
            U('Bomb Blitz', 18000, 'Recursive clusters + every 15s a blitz of 22 bombs on the strongest bloons.', s => { s.cluster = { n: 5, dmg: 2, aoe: 38, r: 56, rec: 2 }; s.frag = { n: 10, dmg: 2, pierce: 4, range: 95 }; s.rate = R(s.rate * 0.7); s.blitz = { every: 900, n: 22, dmg: 4, aoe: 52 }; }),
        ] },
        { name: 'Heavy Artillery', up: [
            U('Extra Range', 250, '+30 range.', s => { s.range += 30; }),
            U('Heavy Artillery', 450, '+25 range, bombs fly faster, +1 damage vs ceramic.', s => { s.range += 25; s.spd = 12; s.ceramic += 1; }),
            U('MOAB Mauler', 1800, '+14 damage to blimps.', s => { s.blimp += 14; s.dmg += 1; }),
            U('MOAB Assassin', 4000, '+45 damage vs blimps, blimps take extra damage.', s => { s.blimp += 45; s.vuln = 2; s.rate = R(s.rate * 0.85); s.range += 15; }),
            U('MOAB Eliminator', 16000, '+240 vs blimps. Blimps struck take heavy bonus damage from everything.', s => { s.blimp += 240; s.vuln = 5; s.dmg += 2; s.rate = R(s.rate * 0.7); s.aoe += 18; s.bstyle = 'bigbomb'; s.ceramic += 3; }),
        ] },
    ]
});

/* ================================================================== *
 *  4. TACK SHOOTER
 * ================================================================== */
STEPS.o_tack = function (t) {
    baseTick(t);
    const s = t.s;
    if (t.cd > 0) t.cd--;
    t.orbCfg = s.orbit;
    let orbActive = !!s.orbit;
    if (s.orbitAb) {
        if (abReady(t, 'mael', s.orbitAb.every)) { t.orbUntil = NOW() + s.orbitAb.dur; addFx({ k: 'txt', x: t.x, y: t.y - 26, s: 'MAELSTROM!', col: '#cfd8dc', life: 50 }); }
        orbActive = !!s.orbit && (t.orbUntil || 0) > NOW();
    }
    stepOrbit(t, s.orbit, orbActive);
    if (s.ring) {
        t.ringC = (t.ringC || 0) - 1;
        if (t.ringC <= 0) {
            const r = s.ring;
            if (pickTarget(t, r.r + 10, 'first', { los: false })) { pulse(t.x, t.y, r.r, r.dmg, { burn: r.burn, ceramic: s.ceramic, blimp: s.blimp, col: '#ff7a1a', flash: 'rgba(255,120,30,0.35)' }); t.ringC = r.every; } else t.ringC = 8;
        }
    }
    const tg = pickTarget(t, s.range, 'first', { los: true });
    if (tg) {
        t.angle += 0.05;
        if (t.cd <= 0) {
            const n = s.n, off = (t.rotA = (t.rotA || 0) + s.rot);
            for (let i = 0; i < n; i++) mkDart(t.x, t.y, off + i * TAU / n, s, { life: Math.ceil((s.range + 8) / s.spd), tgt: null });
            t.recoil = 1; t.cd = cdOf(t);
        }
    }
};
orig('Tack', {
    name: 'Tack Shooter', cat: 'Primary', kind: 'o_tack', noTarget: true,
    blurb: 'Fires a ring of tacks in every direction.',
    base: mk({ range: 85, rate: 50, dmg: 1, pierce: 1, spd: 10, pr: 3, style: 'tack', n: 8, rot: 0.2 }),
    stats: t => ['Tacks ' + B(t.s.n), t.s.ring ? 'Fire ring ' + B(t.s.ring.r) : '', t.s.orbit ? 'Blades ' + B(t.s.orbit.n) : '', t.s.orbitAb ? '⚡ Maelstrom ' + B(abLeft(t, 'mael') + 's') : ''],
    paths: [
        { name: 'Volley', up: [
            U('Faster Shooting', 150, 'Shoots 22% faster.', s => { s.rate = R(s.rate * 0.78); }),
            U('Even Faster Shooting', 250, 'Shoots 25% faster again.', s => { s.rate = R(s.rate * 0.75); }),
            U('Tack Sprayer', 650, 'Sprays 16 tacks per volley.', s => { s.n = 16; s.rot = 0.1; }),
            U('Overdrive', 3000, 'Blistering fire rate. +1 pierce.', s => { s.rate = R(s.rate * 0.5); s.pierce += 1; }),
            U('The Tack Zone', 18000, '32 tacks at an insane rate. +1 damage, +2 pierce, +15 range.', s => { s.n = 32; s.rate = R(s.rate * 0.55); s.dmg += 1; s.pierce += 2; s.range += 15; s.blimp += 2; s.rot = 0.05; }),
        ] },
        { name: 'Blades', up: [
            U('Long Range Tacks', 100, '+20 range.', s => { s.range += 20; }),
            U('Super Range Tacks', 200, '+25 range, +1 pierce.', s => { s.range += 25; s.pierce += 1; }),
            U('Blade Shooter', 600, 'Fires razor blades: 2 damage, 5 pierce.', s => { s.style = 'blade'; s.dmg += 1; s.pierce += 4; s.pr = 4.5; s.ceramic += 1; }),
            U('Blade Maelstrom', 2800, 'Every 16s, spinning blades orbit for 5s, shredding bloons.', s => { s.orbit = { n: 5, r: 42, spin: 0.12, hr: 10, cd: 9, dmg: 2, ceramic: 1, look: 'blade' }; s.orbitAb = { every: 960, dur: 300 }; s.pierce += 2; }),
            U('Super Maelstrom', 16000, 'Permanent orbiting blade storm: 8 blades, +3 damage, +30 range.', s => { s.orbit = { n: 8, r: 52, spin: 0.14, hr: 12, cd: 7, dmg: 3, ceramic: 3, blimp: 3, look: 'blade' }; s.orbitAb = null; s.dmg += 2; s.pierce += 4; s.range += 30; s.n = 12; s.blimp += 3; }),
        ] },
        { name: 'Inferno', up: [
            U('Hot Shots', 200, 'Tacks set bloons on fire.', s => { s.burn = burnOf(1, 150); }),
            U('Hotter Shots', 400, 'Stronger, longer burning. +1 pierce.', s => { s.burn = burnOf(2, 210); s.pierce += 1; }),
            U('Ring of Fire', 1100, 'A ring of flames scorches every bloon around the tower.', s => { s.ring = { r: 62, every: 30, dmg: 1, burn: burnOf(2, 150) }; }),
            U('Inferno Ring', 3600, 'Bigger, hotter ring. Tacks burn harder. +25 range.', s => { s.ring = { r: 82, every: 24, dmg: 2, burn: burnOf(3, 210) }; s.range += 25; s.burn = burnOf(3, 240); s.dmg += 1; s.n = 12; }),
            U('Volcanic Eruption', 15000, 'Searing lava ring: 5 damage pulses, 16 burning tacks. Melts blimps.', s => { s.ring = { r: 105, every: 18, dmg: 4, burn: burnOf(5, 300) }; s.range += 25; s.n = 16; s.burn = burnOf(4, 300); s.blimp += 6; s.dmg += 1; s.rate = R(s.rate * 0.8); }),
        ] },
    ]
});

/* ================================================================== *
 *  5. ICE MONKEY
 * ================================================================== */
function iceFreeze(t, b, wasFrozen) {
    const s = t.s;
    freezeBloon(b, s.freeze);
    if (s.dmg > 0) hurt(b, s.dmg, { ceramic: s.ceramic, blimp: s.blimp });
    if (s.frostDmg && wasFrozen) hurt(b, s.frostDmg, { ceramic: s.ceramic, blimp: s.blimp });
    if (s.after && !b.isBlimp) slowBloon(b, s.after.f, s.freeze + s.after.t);
    if (s.vuln) setVuln(b, s.vuln, 360);
}
STEPS.o_ice = function (t) {
    baseTick(t);
    const s = t.s;
    if (t.cd > 0) t.cd--;
    if (s.aura && NOW() % 10 === 0) {
        for (const b of bloons) if (live(b) && Math.hypot(b.x - t.x, b.y - t.y) <= s.range + b.radius * 0.4) slowAny(b, b.isBlimp ? s.aura.fb : s.aura.f, 24);
    }
    if (s.storm && abReady(t, 'storm', s.storm.every)) {
        for (const b of bloons) if (live(b) && onScreen(b)) { freezeBloon(b, s.storm.dur); if (s.storm.dmg) hurt(b, s.storm.dmg, { blimp: s.storm.blimp || 0 }); }
        addFx({ k: 'flash', x: W() / 2, y: H() / 2, r: 500, life: 14, col: 'rgba(190,235,255,0.5)' }); addFx({ k: 'txt', x: t.x, y: t.y - 28, s: s.storm.name, col: '#cdefff', life: 70 });
        particles.push({ x: t.x, y: t.y, isIceNova: true, radius: 480, life: 20 });
    }
    if (t.cd > 0) return;
    let any = false;
    for (const b of bloons) {
        if (!live(b) || Math.hypot(b.x - t.x, b.y - t.y) > s.range + b.radius * 0.4) continue;
        const was = b.frozenTimer > 0;
        iceFreeze(t, b, was); any = true;
    }
    if (any) {
        particles.push({ x: t.x, y: t.y, isIceNova: true, radius: s.range, life: 20 });
        addFx({ k: 'ring', x: t.x, y: t.y, r0: 8, r1: s.range, life: 16, col: '#bfe9ff', w: 3 });
        if (s.shards) for (let k = 0; k < s.shards; k++) mkDart(t.x, t.y, k * TAU / s.shards + rnd(0, 0.4), s, { style: 'shard', dmg: 1, pierce: 4, range: s.range * 1.15, spd: 9, pr: 3.5, slow: null, stun: 0 });
        if (s.cryo) { t.cryoN = (t.cryoN || 0) + 1; if (t.cryoN % s.cryo.every === 0) { const tg = pickTarget(t, s.range * 1.5, 'strong', { los: false }); if (tg) launchShell(t, t.x, t.y, tg, { T: 26, h: 40, dmg: s.cryo.dmg, aoe: s.cryo.aoe, stun: s.cryo.stun, style: 'foam', fx: 'foam', blimp: s.blimp, maxHit: 30, jitter: 4 }); } }
        t.recoil = 1; t.cd = cdOf(t);
    }
};
orig('Ice', {
    name: 'Ice Monkey', cat: 'Primary', kind: 'o_ice', noTarget: true,
    blurb: 'Freezes every bloon around it in a chilling pulse.',
    base: mk({ range: 85, rate: 70, dmg: 0, pierce: 0, freeze: 60, shards: 0, after: null, vuln: 0, aura: null, cryo: null, storm: null, frostDmg: 0 }),
    noPierceStat: true,
    stats: t => ['Freeze ' + B((t.s.freeze / 60).toFixed(1) + 's'), t.s.storm ? '⚡ ' + t.s.storm.name + ' ' + B(abLeft(t, 'storm') + 's') : ''],
    paths: [
        { name: 'Brittle Frost', up: [
            U('Permafrost', 100, 'Bloons stay slowed for 3s after thawing.', s => { s.after = { f: 0.5, t: 180 }; }),
            U('Cold Snap', 225, 'Pulses 15% faster, +10 range.', s => { s.rate = R(s.rate * 0.85); s.range += 10; }),
            U('Ice Shards', 550, 'Each pulse fires 8 piercing ice shards.', s => { s.shards = 8; }),
            U('Embrittlement', 2800, 'Frozen bloons take +1 damage from every source for 6s.', s => { s.vuln = 1; s.dmg = 1; s.shards = 12; }),
            U('Super Brittle', 15000, 'Bloons take +3 damage from all sources and 3 per pulse. Freezes harder.', s => { s.vuln = 3; s.dmg = 3; s.blimp += 5; s.ceramic += 2; s.rate = R(s.rate * 0.8); s.shards = 16; s.freeze += 25; }),
        ] },
        { name: 'Deep Freeze', up: [
            U('Larger Radius', 150, '+22 freeze radius.', s => { s.range += 22; }),
            U('Enhanced Freeze', 300, 'Freeze lasts 60% longer.', s => { s.freeze = Math.round(s.freeze * 1.6); }),
            U('Arctic Wind', 1600, 'Permanent chill: bloons in range are always slowed, even between pulses.', s => { s.aura = { f: 0.6, fb: 0.8 }; s.range += 12; }),
            U('Snowstorm', 3500, 'Every 25s a blizzard freezes every bloon on screen.', s => { s.storm = { every: 1500, dur: 120, dmg: 0, name: 'Snowstorm' }; s.freeze = Math.round(s.freeze * 1.2); }),
            U('Absolute Zero', 18000, 'Every 25s: a deadly freeze-and-shatter across the whole map. Permanent deep chill.', s => { s.storm = { every: 1500, dur: 200, dmg: 4, blimp: 8, name: 'Absolute Zero' }; s.aura = { f: 0.4, fb: 0.65 }; s.range += 25; s.dmg = Math.max(s.dmg, 0) + 2; s.ceramic += 2; s.blimp += 4; s.freeze = Math.round(s.freeze * 1.3); }),
        ] },
        { name: 'Cryo', up: [
            U('Re-Freeze', 150, 'Pulses 25% faster, bloons re-freeze quickly.', s => { s.rate = R(s.rate * 0.75); }),
            U('Cold Reach', 350, '+20 range. Pulses also deal 1 damage (+1 vs ceramic).', s => { s.range += 20; s.ceramic += 1; s.dmg = Math.max(s.dmg, 1); }),
            U('Cryo Cannon', 1400, 'Every 2nd pulse also lobs a cryo shell at the strongest bloon.', s => { s.cryo = { every: 2, dmg: 2, aoe: 50, stun: 90 }; }),
            U('Icicles', 3800, 'Frozen bloons take 2 damage per pulse. Cryo shells hit harder.', s => { s.frostDmg = 2; s.cryo = { every: 1, dmg: 4, aoe: 58, stun: 120 }; s.rate = R(s.rate * 0.85); }),
            U('Icicle Impale', 16000, 'Frozen bloons take 6 per pulse; shells deal 18 and crush blimps.', s => { s.frostDmg = 6; s.cryo = { every: 1, dmg: 18, aoe: 70, stun: 150 }; s.blimp += 14; s.ceramic += 4; s.range += 20; s.rate = R(s.rate * 0.8); }),
        ] },
    ]
});

/* ================================================================== *
 *  6. GLUE GUNNER
 * ================================================================== */
function glueApply(s, b) {
    const g = s.glue;
    if (!live(b)) return;
    const f = b.isBlimp ? g.bf : g.f;
    if (!(b.glueTimer > 0) || f <= b.glueSlow) { b.glueSlow = f; b.glueTimer = Math.max(b.glueTimer || 0, g.t); }
    if (g.dot) acid(b, g.dot);
    if (g.vuln) setVuln(b, g.vuln, g.t);
}
STEPS.o_glue = function (t) {
    baseTick(t);
    const s = t.s;
    if (t.cd > 0) t.cd--;
    if (s.strike && abReady(t, 'strike', s.strike.every)) {
        let n = 0;
        for (const b of bloons) if (live(b) && onScreen(b)) { glueApply({ glue: s.strike.glue }, b); n++; }
        addFx({ k: 'flash', x: W() / 2, y: H() / 2, r: 500, life: 14, col: 'rgba(255,200,40,0.35)' }); addFx({ k: 'txt', x: t.x, y: t.y - 28, s: s.strike.name, col: '#ffd54a', life: 70 });
    }
    const tg = pickTarget(t, s.range, t.mode, { los: true });
    if (tg) {
        aimAt(t, tg);
        if (t.cd <= 0) {
            const a = Math.atan2(tg.y - t.y, tg.x - t.x), n = s.shots;
            for (let i = 0; i < n; i++) {
                const tgi = n > 1 ? (pickMany(t, s.range, n, { mode: 'first' })[i] || tg) : tg;
                const p = mkDart(t.x + Math.cos(a) * 12, t.y + Math.sin(a) * 12, a + (n > 1 ? (i - (n - 1) / 2) * 0.12 : 0), s, { style: 'glob', homing: 0.4, tgt: tgi, spd: 10, pr: 5, aoe: s.aoeDart, dmg: s.dmg, pierce: s.pierce, slow: null, stun: 0, burn: null });
                p.maxHit = s.maxHit; p.apply = b => glueApply(s, b);
            }
            t.recoil = 1; t.cd = cdOf(t);
        }
    }
};
orig('Glue', {
    name: 'Glue Gunner', cat: 'Primary', kind: 'o_glue', muzzle: 12, noDmgStat: false,
    blurb: 'Glues bloons so they crawl along the track.',
    base: mk({ range: 110, rate: 50, dmg: 0, pierce: 1, spd: 10, aoeDart: 0, maxHit: 8, shots: 1, strike: null, glue: { f: 0.5, bf: 0.5, t: 180, dot: null, vuln: 0 } }),
    stats: t => ['Slow ' + B(Math.round((1 - t.s.glue.f) * 100) + '%'), 'Glue ' + B((t.s.glue.t / 60).toFixed(1) + 's'), t.s.aoeDart ? 'Splash ' + B(t.s.aoeDart) : '', t.s.strike ? '⚡ ' + t.s.strike.name + ' ' + B(abLeft(t, 'strike') + 's') : ''],
    paths: [
        { name: 'Corrosion', up: [
            U('Stickier Glue', 100, 'Glue lasts 50% longer.', s => { s.glue.t = Math.round(s.glue.t * 1.5); }),
            U('Corrosive Glue', 450, 'Glue eats at bloons: 1 damage every 0.5s.', s => { s.glue.dot = { d: 1, t: 300, n: 30 }; s.glue.t += 60; }),
            U('Bloon Dissolver', 1800, 'Stronger acid: 2 damage every 0.5s, +2 vs ceramic.', s => { s.glue.dot = { d: 2, t: 360, n: 30, cer: 2 }; s.glue.t += 60; }),
            U('Bloon Liquefier', 4500, 'Fast acid: 3 damage every 0.33s, +3 vs ceramic.', s => { s.glue.dot = { d: 3, t: 420, n: 20, cer: 3, blimp: 2 }; s.glue.t += 60; s.rate = R(s.rate * 0.9); }),
            U('The Bloon Solver', 18000, 'Deadly acid: 6 every 0.33s, spreads to nearby bloons. Dissolves blimps.', s => { s.glue.dot = { d: 6, t: 480, n: 20, cer: 4, blimp: 10, spread: 1 }; s.glue.t += 90; s.rate = R(s.rate * 0.8); }),
        ] },
        { name: 'Splash', up: [
            U('Bigger Globs', 120, 'Globs hit 2 bloons.', s => { s.pierce = 2; }),
            U('Glue Splatter', 400, 'Globs splatter: glue every bloon in a small radius.', s => { s.aoeDart = 30; s.pierce = 1; s.range += 10; }),
            U('Glue Hose', 1400, 'Sprays glue much faster with a wider splash.', s => { s.rate = R(s.rate * 0.35); s.aoeDart = 36; s.range += 10; s.maxHit = 12; }),
            U('Glue Strike', 3500, 'Every 25s a strike glues every bloon on screen.', s => { s.strike = { every: 1500, name: 'Glue Strike', glue: { f: 0.4, bf: 0.55, t: 300, dot: null, vuln: 0 } }; s.aoeDart = 42; }),
            U('Glue Storm', 16000, 'Glue storm every 12s covers the whole map in strong, damaging glue. 3 globs per shot.', s => { s.strike = { every: 720, name: 'Glue Storm', glue: { f: 0.3, bf: 0.45, t: 360, dot: { d: 2, t: 360, n: 30 }, vuln: 1 } }; s.shots = 3; s.aoeDart = 50; s.maxHit = 18; s.rate = R(s.rate * 0.8); }),
        ] },
        { name: 'Super Glue', up: [
            U('Stronger Glue', 200, 'Glue slows by 60%.', s => { s.glue.f = 0.4; s.glue.bf = 0.4; }),
            U('Glue Soak', 500, 'Glue soaks through: glued bloons take +1 damage from all sources.', s => { s.glue.vuln = 1; s.range += 15; }),
            U('MOAB Glue', 1500, 'Glue grips blimps much harder and lasts longer.', s => { s.glue.bf = 0.2; s.glue.t += 120; s.rate = R(s.rate * 0.85); }),
            U('Relentless Glue', 3800, 'Heavy-duty glue lasts 10s; glued bloons take +2 from everything.', s => { s.glue.f = 0.3; s.glue.t = 600; s.glue.vuln = 2; s.glue.dot = s.glue.dot || { d: 1, t: 300, n: 30 }; s.range += 15; }),
            U('Super Glue', 16000, 'Bloons stuck almost solid (90% slow, even blimps); +4 damage from every source.', s => { s.glue.f = 0.1; s.glue.bf = 0.18; s.glue.t = 720; s.glue.vuln = 4; s.rate = R(s.rate * 0.75); s.aoeDart = Math.max(s.aoeDart, 34); s.range += 20; }),
        ] },
    ]
});

/* ================================================================== *
 *  7. SNIPER MONKEY
 * ================================================================== */
function sniperShot(t, tg, ox, oy) {
    const s = t.s, o = { ceramic: s.ceramic, blimp: s.blimp, stun: s.stun };
    addFx({ k: 'lbeam', x1: ox, y1: oy, x2: tg.x, y2: tg.y, life: 8, col: '#ffd54a', w: 3 });
    let n = s.pierce;
    hurt(tg, s.dmg + sgBonus(t), o); n--;
    if (s.mark) setVuln(tg, s.mark, 240);
    if (s.push && tg.isBlimp) pushBack(tg, s.push);
    for (const b of bloons) { if (n <= 0) break; if (b !== tg && live(b) && Math.hypot(b.x - tg.x, b.y - tg.y) < 50) { hurt(b, s.dmg, o); n--; } }
    if (s.shrap) explode(tg.x, tg.y, s.shrap.r, s.shrap.dmg, { ceramic: s.ceramic, maxHit: 14, fx: 'boom' });
    else addFx({ k: 'flash', x: tg.x, y: tg.y, r: 12, life: 8, col: 'rgba(255,255,0,0.7)' });
    if (s.bounce) {
        const hit = new Set([tg]); let cur = tg;
        for (let k = 0; k < s.bounce; k++) {
            let nx = null, nd = 170;
            for (const b of bloons) { if (!live(b) || hit.has(b)) continue; const d = Math.hypot(b.x - cur.x, b.y - cur.y); if (d < nd) { nd = d; nx = b; } }
            if (!nx) break;
            addFx({ k: 'lbeam', x1: cur.x, y1: cur.y, x2: nx.x, y2: nx.y, life: 6, col: '#ffe680', w: 2 });
            hurt(nx, Math.max(1, Math.ceil(s.dmg * 0.6)), o); hit.add(nx); cur = nx;
        }
    }
}
STEPS.o_sniper = function (t) {
    baseTick(t);
    const s = t.s;
    if (t.cd > 0) t.cd--;
    if (s.drop && roundInProgress && abReady(t, 'drop', s.drop.every, false)) {
        const x = rnd(40, W() - 40), y = rnd(40, H() - 40);
        addFx({ k: 'ring', x, y, r0: 4, r1: 24, life: 18, col: '#7CFC00', w: 3 }); giveMoney(x, y + 10, s.drop.amt);
        addFx({ k: 'txt', x: t.x, y: t.y - 26, s: 'SUPPLY DROP', col: '#ffd54a', life: 50 });
    }
    if (t.cd > 0) return;
    const list = s.multi > 1 ? pickMany(t, 99999, s.multi, { global: true, mode: t.mode === 'strong' ? 'strong' : 'first' }) : (() => { const g = pickTarget(t, 99999, t.mode, { los: false }); return g ? [g] : []; })();
    if (!list.length) return;
    aimAt(t, list[0], 1);
    for (const tg of list) sniperShot(t, tg, t.x, t.y);
    t.recoil = 1; t.cd = cdOf(t);
};
orig('Sniper', {
    name: 'Sniper Monkey', cat: 'Military', kind: 'o_sniper', muzzle: 14,
    blurb: 'Hits any bloon on the map from anywhere, every time.',
    base: mk({ range: 9999, rate: 90, dmg: 2, pierce: 1, stun: 0, mark: 0, shrap: null, bounce: 0, drop: null, multi: 1, push: 0 }),
    stats: t => [t.s.multi > 1 ? 'Targets ' + B(t.s.multi) : '', t.s.bounce ? 'Bounces ' + B(t.s.bounce) : '', t.s.drop ? '⚡ Drop ' + B(abLeft(t, 'drop') + 's') : '', t.s.income ? '💰 +$' + t.s.income + '/round' : ''],
    paths: [
        { name: 'Rapid Fire', up: [
            U('Fast Firing', 300, 'Shoots 25% faster.', s => { s.rate = R(s.rate * 0.75); }),
            U('Even Faster Firing', 500, 'Shoots 30% faster again.', s => { s.rate = R(s.rate * 0.7); }),
            U('Semi-Automatic', 3200, 'Rifle fires nearly 3x faster. +1 damage.', s => { s.rate = R(s.rate * 0.36); s.dmg += 1; }),
            U('Full Auto Rifle', 5500, 'Fully automatic: more than twice as fast again.', s => { s.rate = R(s.rate * 0.42); s.ceramic += 1; }),
            U('Elite Defender', 15000, 'Fires at 2 targets at once. +3 damage, even faster.', s => { s.multi = 2; s.dmg += 3; s.rate = R(s.rate * 0.7); s.ceramic += 2; s.blimp += 3; }),
        ] },
        { name: 'Crippling', up: [
            U('Full Metal Jacket', 350, '+2 damage, +1 vs ceramic.', s => { s.dmg += 2; s.ceramic += 1; }),
            U('Large Calibre', 600, '+3 damage. Shots stun bloons (not blimps).', s => { s.dmg += 3; s.stun = 45; }),
            U('Deadly Precision', 2200, '+12 damage, +8 vs ceramic. Heavy hitter.', s => { s.dmg += 12; s.ceramic += 8; s.blimp += 6; }),
            U('Maim MOAB', 2800, '+40 vs blimps; blimps hit take +2 from every source.', s => { s.blimp += 40; s.mark = 2; s.rate = R(s.rate * 0.9); }),
            U('Cripple MOAB', 18000, '+320 vs blimps; blimps take +5 and are shoved back.', s => { s.blimp += 320; s.mark = 5; s.push = 22; s.dmg += 10; s.ceramic += 8; }),
        ] },
        { name: 'Support', up: [
            U('Night Vision Goggles', 400, 'Marks the target: it takes +1 damage from all sources for 4s. +1 pierce.', s => { s.mark = Math.max(s.mark, 1); s.pierce += 1; }),
            U('Shrapnel Shot', 900, 'Bullets burst into shrapnel (radius 50).', s => { s.shrap = { r: 50, dmg: 2 }; }),
            U('Bouncing Bullet', 2200, 'Bullets ricochet to 3 more bloons.', s => { s.bounce = 3; }),
            U('Supply Drop', 4500, 'Every 25s a supply crate drops: +$300 cash.', s => { s.drop = { every: 1500, amt: 300 }; }),
            U('Elite Sniper', 16000, '+4 damage, 5 bounces, faster. Crates every 15s (+$700) and +$300/round.', s => { s.dmg += 4; s.bounce = 5; s.rate = R(s.rate * 0.7); s.shrap = { r: 70, dmg: 5 }; s.drop = { every: 900, amt: 700 }; s.income = 300; s.mark = Math.max(s.mark, 2); }),
        ] },
    ]
});

/* ================================================================== *
 *  8. HELI PILOT
 * ================================================================== */
STEPS.o_heli = function (t) {
    baseTick(t);
    const s = t.s;
    if (t.cd > 0) t.cd--;
    t.rot = (t.rot || 0) + 0.45;
    const tg = pickTarget(t, 9999, t.mode, { x: t.hx, y: t.hy, los: false });
    let mx = t.x, my = t.y, stop = 0;
    if (tg) { mx = tg.x; my = tg.y; stop = s.rotor ? 8 : s.range * 0.55; }
    const dx = mx - t.hx, dy = my - t.hy, d = Math.hypot(dx, dy);
    if (d > stop + 0.5) { const sp = Math.min(s.sp, d - stop); t.hx += dx / d * sp; t.hy += dy / d * sp; }
    if (d > 4) t.hang = lerpAngle(t.hang, Math.atan2(dy, dx), 0.2);
    t.cx = t.hx; t.cy = t.hy; t.angle = t.hang;
    if (s.rotor && NOW() % s.rotor.every === 0) {
        let hit = false;
        for (const b of bloons) if (live(b) && Math.hypot(b.x - t.hx, b.y - t.hy) <= s.rotor.r + b.radius * 0.4) { hurt(b, s.rotor.dmg, { ceramic: s.ceramic, blimp: s.blimp }); hit = true; }
        if (hit) addFx({ k: 'ring', x: t.hx, y: t.hy, r0: 10, r1: s.rotor.r, life: 8, col: '#e0e0e0', w: 2 });
    }
    if (s.down && abReady(t, 'down', s.down.every)) { pulse(t.hx, t.hy, s.down.r, 0, { push: s.down.push, pushB: s.down.push * 0.4, col: '#cfd8dc', flash: 'rgba(200,220,255,0.3)' }); }
    if (tg && t.cd <= 0 && Math.hypot(tg.x - t.hx, tg.y - t.hy) <= s.range) {
        const a = Math.atan2(tg.y - t.hy, tg.x - t.hx), n = s.shots;
        for (let i = 0; i < n; i++) {
            const off = (n > 1 ? (i / (n - 1) - 0.5) * s.fan : 0) + rnd(-0.03, 0.03);
            const p = mkDart(t.hx + Math.cos(a) * 12, t.hy + Math.sin(a) * 12, a + off, s, { dmg: s.dmg, homing: s.homing, tgt: s.homing ? tg : null });
            if (s.push) p.apply = b => { if (b.isBlimp) pushBack(b, s.push); };
        }
        t.shots++;
        if (s.rocket && t.shots % s.rocket.every === 0) {
            const list = pickMany(t, s.range * 1.2, s.rocket.n, { x: t.hx, y: t.hy, mode: 'strong' }); if (!list.length) list.push(tg);
            for (let i = 0; i < s.rocket.n; i++) A.launchMissile(t, t.hx, t.hy, list[i % list.length], s.rocket);
        }
        t.cd = cdOf(t);
    }
};
orig('Heli', {
    name: 'Heli Pilot', cat: 'Military', kind: 'o_heli', muzzle: 12, noBlurb: 0,
    blurb: 'Chases bloons across the map and shoots them from the air.',
    init2: t => { t.hx = t.x; t.hy = t.y; t.hang = 0; t.rot = 0; t.cx = t.x; t.cy = t.y; },
    ring: t => ({ x: t.hx, y: t.hy, r: t.s.range }),
    aura: t => t.s.cmd ? { x: t.hx, y: t.hy, r: t.s.cmd.r, rate: t.s.cmd.rate, vis: '#6ec6ff', only: u => u.type !== 'Farm' } : null,
    base: mk({ range: 140, rate: 20, dmg: 1, pierce: 2, spd: 12, pr: 3.5, sp: 4, shots: 1, fan: 0.3, rotor: null, rocket: null, down: null, push: 0, cmd: null }),
    stats: t => ['Speed ' + B(fmt1(t.s.sp)), t.s.shots > 1 ? 'Darts ' + B(t.s.shots) : '', t.s.rotor ? 'Rotor ' + B(t.s.rotor.dmg) : '', t.s.income ? '💰 +$' + t.s.income + '/round' : ''],
    paths: [
        { name: 'Gunship', up: [
            U('Quad Darts', 500, 'Fires 4 darts at once.', s => { s.shots = 4; s.fan = 0.45; }),
            U('Pursuit', 900, 'Faster flight (+2) and +30% fire rate.', s => { s.sp += 2; s.rate = R(s.rate * 0.7); }),
            U('Razor Rotors', 1500, 'Rotors shred bloons the Heli flies over (1 damage / 0.25s).', s => { s.rotor = { r: 30, dmg: 1, every: 15 }; s.pierce += 1; }),
            U('Apache Dartship', 5500, '8 darts per volley at high speed, +1 damage. Stronger rotors.', s => { s.shots = 8; s.fan = 0.7; s.rate = R(s.rate * 0.75); s.dmg += 1; s.rotor = { r: 34, dmg: 2, every: 12 }; }),
            U('Apache Prime', 22000, 'Homing 12-dart salvos, +2 damage, rotors cut through blimps.', s => { s.shots = 12; s.fan = 0.9; s.homing = 0.12; s.dmg += 2; s.pierce += 3; s.rate = R(s.rate * 0.7); s.rotor = { r: 40, dmg: 4, every: 10 }; s.blimp += 3; s.sp += 1; }),
        ] },
        { name: 'Missiles', up: [
            U('Bigger Jets', 400, '+1.5 flight speed, +15 range.', s => { s.sp += 1.5; s.range += 15; }),
            U('IFR', 700, 'Every 4th volley launches a homing missile (explodes).', s => { s.rocket = { every: 4, n: 1, dmg: 3, aoe: 44, blimp: 3, spd: 10, homing: 0.14, style: 'missile' }; }),
            U('Downdraft', 1800, 'Rotor wash blasts bloons back every 4s. Missiles every 3rd volley.', s => { s.down = { every: 240, r: 95, push: 18 }; s.rocket.every = 3; s.rocket.n = 2; }),
            U('MOAB Missiles', 4500, '3 heavy missiles every 2nd volley: +18 vs blimps.', s => { s.rocket = { every: 2, n: 3, dmg: 5, aoe: 52, blimp: 18, spd: 11, homing: 0.15, style: 'missile' }; s.range += 10; }),
            U('Special Poperations', 20000, '4 elite escort helis + 6 giant missiles every volley. Devastating.', s => { s.rocket = { every: 1, n: 6, dmg: 9, aoe: 62, blimp: 40, spd: 12, homing: 0.16, style: 'bigmissile', burn: burnOf(2, 150) }; s.escort = { n: 4, dmg: 2 }; s.rate = R(s.rate * 0.8); }),
        ] },
        { name: 'Support Flight', up: [
            U('Faster Darts', 350, 'Darts fly faster, +20 range.', s => { s.spd = 17; s.range += 20; }),
            U('Faster Firing', 500, 'Fires 35% faster.', s => { s.rate = R(s.rate * 0.65); }),
            U('MOAB Shove', 1500, 'Darts shove blimps back. +4 damage vs blimps.', s => { s.push = 8; s.blimp += 4; s.pierce += 2; }),
            U('Comanche Defense', 5000, '2 Comanche escorts circle the Heli and fire darts.', s => { s.escort = { n: 2, dmg: 1 }; s.dmg += 1; s.rate = R(s.rate * 0.85); }),
            U('Comanche Commander', 18000, '4 Comanches. Towers near the Heli fire 25% faster. +$350/round.', s => { s.escort = { n: 4, dmg: 3 }; s.cmd = { r: 170, rate: 0.75 }; s.income = 350; s.dmg += 2; s.pierce += 2; s.rate = R(s.rate * 0.75); }),
        ] },
    ],
    after: (t, s) => {
        /* escort minions follow the paths bought */
        t.mn = (t.mn || []).filter(m => m.kind !== 'mheli');
        if (s.escort) for (let i = 0; i < s.escort.n; i++) addMinion(t, { kind: 'mheli', life: Infinity, rate: 14, dmg: s.escort.dmg, pierce: 2, range: 130, orR: 26 + (i % 2) * 8, orb: i * TAU / s.escort.n, orS: 0.07, spd: 14, style: 'dart' });
    }
});

/* ================================================================== *
 *  9. NINJA MONKEY
 * ================================================================== */
function ninjaFire(t, tg) {
    const s = t.s, a = aimAt(t, tg, 1), n = s.shots;
    for (let i = 0; i < n; i++) {
        const off = (n > 1 ? (i / (n - 1) - 0.5) * s.fan : 0) + rnd(-0.02, 0.02);
        const p = mkDart(t.x + Math.cos(a) * 10, t.y + Math.sin(a) * 10, a + off, s, { homing: s.homing, tgt: s.homing ? tg : null });
        if (s.distract) p.apply = b => { if (!b.isBlimp && Math.random() < s.distract) { pushBack(b, 38); b.frozenTimer = Math.max(b.frozenTimer || 0, 20); } };
    }
    t.shots++; t.recoil = 1;
    if (s.flash && t.shots % s.flash.every === 0) {
        const f = s.flash;
        const p = launchShell(t, t.x, t.y, tg, { T: 20, h: 30, dmg: f.dmg, aoe: f.aoe, stun: f.stun, slow: f.slow, blimp: f.blimp || 0, ceramic: s.ceramic, style: 'bomb', maxHit: 40, jitter: 6, fx: 'boom' });
    }
}
STEPS.o_ninja = function (t) {
    baseTick(t);
    const s = t.s;
    if (t.cd > 0) t.cd--;
    if (s.cal && roundInProgress && abReady(t, 'cal', s.cal.every, false)) {
        for (let i = 0; i < s.cal.n; i++) { const p = pickTrackPoint(t, s.range, false); if (p) layPile(t, p, { life: 1500, max: 12, pierce: s.cal.pierce, dmg: s.cal.dmg, ceramic: s.ceramic, blimp: 0, burn: null }); }
    }
    if (s.sab && abReady(t, 'sab', s.sab.every)) {
        for (const b of bloons) if (live(b) && onScreen(b)) { slowAny(b, s.sab.f, s.sab.t); if (s.sab.vuln) setVuln(b, s.sab.vuln, s.sab.t); if (s.sab.dmg) hurt(b, s.sab.dmg, { blimp: s.sab.dmg }); }
        addFx({ k: 'flash', x: W() / 2, y: H() / 2, r: 500, life: 14, col: 'rgba(60,60,90,0.35)' }); addFx({ k: 'txt', x: t.x, y: t.y - 28, s: s.sab.name, col: '#b0bec5', life: 70 });
    }
    const tg = pickTarget(t, s.range, t.mode, { los: true });
    if (tg) { aimAt(t, tg); if (t.cd <= 0) { ninjaFire(t, tg); t.cd = cdOf(t); } }
};
orig('Ninja', {
    name: 'Ninja Monkey', cat: 'Magic', kind: 'o_ninja', muzzle: 10,
    blurb: 'Hurls fast shuriken. Masters of speed, sabotage and bombs.',
    aura: t => t.s.shinobi ? { r: t.s.shinobi.r, rate: t.s.shinobi.rate, vis: '#9575cd', only: u => u.type === 'Ninja' } : null,
    base: mk({ range: 130, rate: 25, dmg: 1, pierce: 2, spd: 15, pr: 3, style: 'shuriken', shots: 1, fan: 0.3, distract: 0, flash: null, cal: null, sab: null, shinobi: null }),
    stats: t => [t.s.shots > 1 ? 'Shuriken ' + B(t.s.shots) : '', t.s.sab ? '⚡ ' + t.s.sab.name + ' ' + B(abLeft(t, 'sab') + 's') : '', t.s.shinobi ? 'Ninja aura ' + B(t.s.shinobi.r) : ''],
    paths: [
        { name: 'Shuriken', up: [
            U('Ninja Discipline', 300, 'Throws 25% faster.', s => { s.rate = R(s.rate * 0.75); }),
            U('Sharp Shuriken', 350, '+2 pierce, +1 vs ceramic.', s => { s.pierce += 2; s.ceramic += 1; }),
            U('Double Shot', 850, 'Throws 2 shuriken at once.', s => { s.shots = 2; s.fan = 0.3; }),
            U('Bloonjitsu', 2800, 'Throws 5 shuriken in a fan and faster.', s => { s.shots = 5; s.fan = 0.8; s.rate = R(s.rate * 0.8); }),
            U('Grandmaster Ninja', 20000, '8 homing shuriken at double speed. +2 damage, +3 pierce.', s => { s.shots = 8; s.fan = 1.1; s.rate = R(s.rate * 0.5); s.dmg += 2; s.pierce += 3; s.homing = 0.1; s.blimp += 3; s.ceramic += 2; }),
        ] },
        { name: 'Sabotage', up: [
            U('Seeking Shuriken', 300, 'Shuriken steer towards bloons. +10 range.', s => { s.homing = 0.15; s.range += 10; }),
            U('Distraction', 500, '25% of hits send bloons back and stop them briefly.', s => { s.distract = 0.25; }),
            U('Shinobi Tactics', 2500, 'Ninjas within 150 attack 25% faster (incl. this one 15%).', s => { s.shinobi = { r: 150, rate: 0.75 }; s.rate = R(s.rate * 0.85); }),
            U('Bloon Sabotage', 4500, 'Every 40s all bloons on screen are slowed by half for 6s.', s => { s.sab = { every: 2400, f: 0.5, t: 360, name: 'Sabotage' }; s.distract = 0.35; }),
            U('Grand Saboteur', 18000, 'Every 30s: heavy slow, +2 damage taken and 6 damage to all. Aura 200.', s => { s.sab = { every: 1800, f: 0.3, t: 480, vuln: 2, dmg: 6, name: 'Grand Saboteur' }; s.shinobi = { r: 200, rate: 0.65 }; s.distract = 0.5; s.rate = R(s.rate * 0.8); s.dmg += 1; }),
        ] },
        { name: 'Bombs', up: [
            U('Caltrops', 250, '+15 range. Lays caltrops (spikes) on the track every 5s.', s => { s.range += 15; s.cal = { every: 300, n: 2, pierce: 6, dmg: 1 }; }),
            U('Flash Bomb', 1100, 'Every 4th throw lobs a flash bomb that stuns bloons.', s => { s.flash = { every: 4, aoe: 62, dmg: 1, stun: 90 }; }),
            U('Sticky Bomb', 3000, 'Bombs every 3rd throw: stun + 2 damage, +10 vs blimps, slows blimps.', s => { s.flash = { every: 3, aoe: 72, dmg: 2, stun: 100, blimp: 10 }; s.cal.n = 3; s.cal.pierce = 9; }),
            U('Master Bomber', 5500, 'Every 2nd throw: huge bombs (4 damage, +20 vs blimps).', s => { s.flash = { every: 2, aoe: 84, dmg: 4, stun: 120, blimp: 20 }; s.range += 15; s.cal.dmg = 2; }),
            U('Bomb Barrage', 20000, 'Every throw is a giant bomb: 9 damage, +60 vs blimps. +3 caltrops.', s => { s.flash = { every: 1, aoe: 96, dmg: 9, stun: 150, blimp: 60 }; s.cal = { every: 150, n: 4, pierce: 14, dmg: 3 }; s.rate = R(s.rate * 0.85); }),
        ] },
    ]
});

/* ================================================================== *
 *  10. WIZARD MONKEY
 * ================================================================== */
function wizardFire(t, tg) {
    const s = t.s, a = aimAt(t, tg, 1), mx = t.x + Math.cos(a) * 12, my = t.y + Math.sin(a) * 12;
    mkDart(mx, my, a, s, { homing: 0.4, tgt: tg });
    t.shots++; t.recoil = 1;
    if (s.fire) (t.fq = t.fq || []).push({ at: NOW() + 15 });
    if (s.chain && t.shots % s.chain.every === 0) A.chainLightning(t, mx, my, tg, Object.assign({ ceramic: s.ceramic, blimp: s.blimp }, s.chain));
}
STEPS.o_wizard = function (t) {
    baseTick(t);
    const s = t.s, now = NOW();
    if (t.cd > 0) t.cd--;
    if (t.fq && t.fq.length && t.fq[0].at <= now) {
        t.fq.shift();
        const g = pickTarget(t, s.range, 'first', { los: true });
        if (g) { const a = Math.atan2(g.y - t.y, g.x - t.x); mkDart(t.x, t.y, a, s, { style: 'fireb', spd: 12, aoe: s.fire.aoe, dmg: s.fire.dmg, pierce: 1, burn: s.fire.burn || null, homing: 0.2, tgt: g, pr: 6 }); }
    }
    if (s.wall && roundInProgress && abReady(t, 'wall', s.wall.every, false)) {
        const p = pickTrackPoint(t, s.range, true);
        if (p) t.patches.push({ x: p.x, y: p.y, r: s.wall.r, life: s.wall.life, d: s.wall.d, every: 20, c: 0, burn: burnOf(2, 120) });
    }
    if (s.breath) {
        const tg = pickTarget(t, s.range * 0.8, 'first', { los: true });
        if (tg && now % s.breath.every === 0) { const a = Math.atan2(tg.y - t.y, tg.x - t.x); for (let k = 0; k < s.breath.n; k++) mkDart(t.x + Math.cos(a) * 12, t.y + Math.sin(a) * 12, a + rnd(-0.22, 0.22), s, { style: 'flame', dmg: s.breath.dmg, pierce: 6, spd: 8, range: s.range * 0.85, pr: 6, burn: burnOf(2, 180), homing: 0, aoe: 0 }); }
    }
    if (s.blast && abReady(t, 'blast', s.blast.every)) {
        const g = pickTarget(t, s.range, 'strong', { los: true }) || pickTarget(t, s.range, 'first', { los: false });
        if (g) { explode(g.x, g.y, s.blast.r, s.blast.dmg, { blimp: s.blast.blimp || 0, ceramic: s.ceramic, stun: s.blast.stun || 0, maxHit: 60, fx: 'bolt' }); addFx({ k: 'bolt', pts: [{ x: g.x + rnd(-14, 14), y: -10 }, { x: g.x, y: g.y }], life: 12, col: '#cfa8ff', w: 5 }); }
    }
    if (s.necro && abReady(t, 'necro', s.necro.every, false)) {
        const have = t.mn.filter(m => m.kind === 'skel').length;
        for (let i = have; i < s.necro.n; i++) addMinion(t, { kind: 'skel', life: s.necro.life, rate: s.necro.rate, dmg: s.necro.dmg, pierce: s.necro.pierce, range: s.range * 0.9, style: 'arcane', orR: 28 + (i % 3) * 10, orb: i * 1.1, orS: 0.04, col: '#b388ff', spd: 11, pr: 4, homing: 0.12 });
        t.ab.necro = s.necro.every;
    }
    if (s.phoenix && !t.mn.some(m => m.kind === 'phoenix')) addMinion(t, { kind: 'phoenix', life: Infinity, dmg: s.phoenix.dmg, aoe: s.phoenix.aoe, rate: s.phoenix.rate, burn: burnOf(3, 200), blimp: s.phoenix.blimp, ceramic: 3, col: '#ff8a1a' });
    const tg = pickTarget(t, s.range, t.mode, { los: true });
    if (tg) { aimAt(t, tg); if (t.cd <= 0) { wizardFire(t, tg); t.cd = cdOf(t); } }
};
orig('Wizard', {
    name: 'Wizard Monkey', cat: 'Magic', kind: 'o_wizard', muzzle: 12,
    blurb: 'Casts magic bolts that seek out bloons.',
    base: mk({ range: 130, rate: 40, dmg: 1, pierce: 3, spd: 10, pr: 5, style: 'arcane', fire: null, wall: null, breath: null, chain: null, blast: null, necro: null, phoenix: null }),
    stats: t => [t.s.chain ? 'Lightning ' + B(t.s.chain.n) : '', t.s.necro ? 'Skeletons ' + B(t.s.necro.n) : '', t.s.blast ? '⚡ Blast ' + B(abLeft(t, 'blast') + 's') : ''],
    paths: [
        { name: 'Fire', up: [
            U('Guided Magic', 250, '+15 range, +1 pierce, bolts home in better.', s => { s.range += 15; s.pierce += 1; }),
            U('Fireball', 350, 'Each bolt is followed by an exploding fireball (burns).', s => { s.fire = { aoe: 32, dmg: 1, burn: burnOf(1, 90) }; }),
            U('Wall of Fire', 1100, 'Every 7s conjures a burning patch on the track.', s => { s.wall = { every: 420, r: 38, life: 480, d: 2 }; s.fire.aoe = 40; s.fire.dmg = 2; }),
            U('Dragon\'s Breath', 3200, 'Breathes a cone of fire at nearby bloons. Fireballs +1 damage.', s => { s.breath = { every: 6, n: 3, dmg: 1 }; s.fire.dmg = 3; s.fire.aoe = 46; }),
            U('Wizard Lord Phoenix', 20000, 'A phoenix hunts bloons for you; fireballs and breath are far stronger.', s => { s.phoenix = { dmg: 6, aoe: 72, rate: 22, blimp: 8 }; s.breath = { every: 4, n: 4, dmg: 2 }; s.fire = { aoe: 56, dmg: 5, burn: burnOf(3, 150) }; s.rate = R(s.rate * 0.8); }),
        ] },
        { name: 'Lightning', up: [
            U('Intense Magic', 200, '+20 range, +1 pierce.', s => { s.range += 20; s.pierce += 1; }),
            U('Lightning Bolt', 600, 'Every 3rd cast chains lightning through 4 bloons.', s => { s.chain = { every: 3, n: 4, dmg: 2, link: 90 }; }),
            U('Arcane Mastery', 2200, 'Lightning every 2nd cast (6 bloons) + an arcane blast every 6s.', s => { s.chain = { every: 2, n: 6, dmg: 2, link: 100 }; s.blast = { every: 360, r: 90, dmg: 4 }; }),
            U('Archmage', 6500, 'Casts 40% faster; lightning every cast through 8 bloons for 3 damage.', s => { s.rate = R(s.rate * 0.6); s.chain = { every: 1, n: 8, dmg: 3, link: 110 }; s.blast.r = 105; s.blast.dmg = 7; s.blimp += 4; }),
            U('Arcane Tempest', 20000, 'Storm lightning (12 bloons, 5 dmg) + a stunning mega blast every 4s.', s => { s.rate = R(s.rate * 0.8); s.chain = { every: 1, n: 12, dmg: 5, link: 130 }; s.blast = { every: 240, r: 140, dmg: 14, blimp: 40, stun: 100 }; s.range += 20; s.blimp += 6; }),
        ] },
        { name: 'Necromancy', up: [
            U('Unholy Focus', 300, '+1 damage, casts 15% faster.', s => { s.dmg += 1; s.rate = R(s.rate * 0.85); }),
            U('Necromancer', 900, 'Every 9s raises up to 2 skeleton archers (20s each).', s => { s.necro = { every: 540, n: 2, life: 1200, rate: 22, dmg: 1, pierce: 3 }; }),
            U('Unpopped Army', 2800, 'Raises 4 skeletons more often.', s => { s.necro = { every: 420, n: 4, life: 1500, rate: 18, dmg: 2, pierce: 3 }; }),
            U('Skeletal Legion', 6500, '6 fast skeletons. Your bolts hit harder.', s => { s.necro = { every: 360, n: 6, life: 1800, rate: 12, dmg: 2, pierce: 4 }; s.dmg += 1; s.pierce += 2; }),
            U('Prince of Darkness', 18000, '9 deadly skeletons + dark blasts every 5s. +3 damage.', s => { s.necro = { every: 300, n: 9, life: 2400, rate: 9, dmg: 3, pierce: 5 }; s.blast = { every: 300, r: 100, dmg: 8, blimp: 20 }; s.dmg += 3; s.rate = R(s.rate * 0.8); s.ceramic += 3; }),
        ] },
    ]
});

/* ================================================================== *
 *  11. SUPER MONKEY
 * ================================================================== */
function superFire(t, tg) {
    const s = t.s, a = aimAt(t, tg, 1), mx = t.x + Math.cos(a) * 12, my = t.y + Math.sin(a) * 12;
    const dm = s.dmg + sgBonus(t);
    if (s.beam) beamLine(t, mx, my, a, s.range * 1.15, s.beam.w, s.pierce, dm, { ceramic: s.ceramic, blimp: s.blimp, burn: s.burn }, s.beam.col);
    else {
        const p = mkDart(mx, my, a + rnd(-0.02, 0.02), s, { dmg: dm, homing: s.homing, tgt: s.homing ? tg : null });
        if (s.push || s.mark) p.apply = b => { if (s.push) pushBack(b, b.isBlimp ? s.push * 0.3 : s.push); if (s.mark) setVuln(b, s.mark, 180); };
    }
    t.recoil = 1;
}
STEPS.o_super = function (t) {
    baseTick(t);
    const s = t.s;
    if (t.cd > 0) t.cd--;
    t.orbCfg = s.orbit; stepOrbit(t, s.orbit, !!s.orbit);
    if (s.terror && abReady(t, 'terror', s.terror.every)) {
        const list = pickMany(t, s.range * 1.3, s.terror.n, { mode: 'strong', global: !!s.terror.global });
        for (const b of list) { addFx({ k: 'lbeam', x1: t.x, y1: t.y, x2: b.x, y2: b.y, life: 8, col: '#7df9ff', w: 4 }); hurt(b, s.terror.dmg, { blimp: s.terror.blimp, ceramic: s.terror.dmg }); }
    }
    if (s.slash && abReady(t, 'slash', s.slash.every)) {
        if (pickTarget(t, s.slash.r + 10, 'first', { los: false })) { pulse(t.x, t.y, s.slash.r, s.slash.dmg, { blimp: s.slash.blimp || 0, ceramic: s.slash.dmg, col: '#b39ddb', flash: 'rgba(120,80,200,0.35)' }); t.slashAt = NOW(); }
        else t.ab.slash = 4;
    }
    const n = s.multi;
    const list = n > 1 ? pickMany(t, s.range, n, { mode: 'first' }) : (() => { const g = pickTarget(t, s.range, t.mode, { los: true }); return g ? [g] : []; })();
    if (list.length) {
        aimAt(t, list[0]);
        if (t.cd <= 0) { for (const tg of list) superFire(t, tg); t.cd = cdOf(t); }
    }
};
orig('Super', {
    name: 'Super Monkey', cat: 'Magic', kind: 'o_super', muzzle: 12,
    blurb: 'Fires darts at an unbelievable rate.',
    aura: t => { const a = t.s.aura; return a ? { x: t.x, y: t.y, r: a.r, global: !!a.global, rate: a.rate, dmg: a.dmg, pierce: a.pierce, cer: a.cer, bli: a.bli, vis: '#7e57c2', only: u => u.type !== 'Farm' } : null; },
    base: mk({ range: 220, rate: 4, dmg: 1, pierce: 1, spd: 10, pr: 3, style: 'dart', beam: null, orbit: null, terror: null, slash: null, aura: null, multi: 1, push: 0, mark: 0 }),
    stats: t => [t.s.multi > 1 ? 'Targets ' + B(t.s.multi) : '', t.s.terror ? '⚡ Terror ' + B(abLeft(t, 'terror') + 's') : '', t.s.aura ? 'Buff aura ' + (t.s.aura.global ? B('map') : B(t.s.aura.r)) : ''],
    paths: [
        { name: 'Plasma', up: [
            U('Laser Blasts', 1500, 'Laser bolts: 2.5x speed, +2 pierce.', s => { s.style = 'laser'; s.spd = 25; s.pierce += 2; }),
            U('Plasma Vision', 3000, 'Plasma bolts: +3 pierce, +1 damage, slows bloons.', s => { s.style = 'plasma'; s.pierce += 3; s.dmg += 1; s.slow = { f: 0.7, t: 40 }; s.pr = 5; }),
            U('Sun Avatar', 6500, 'Fires a piercing solar beam. +1 damage.', s => { s.beam = { w: 6, col: '#ffd54a' }; s.rate = R(s.rate * 1.8); s.dmg += 1; s.pierce += 4; s.burn = burnOf(1, 120); }),
            U('Sun Temple', 14000, 'Three sun orbs orbit and scorch. Beam: +3 damage, wider.', s => { s.orbit = { n: 3, r: 46, spin: 0.08, hr: 12, cd: 8, dmg: 3, ceramic: 3, blimp: 4, look: 'sun' }; s.dmg += 3; s.beam.w = 9; s.pierce += 6; s.blimp += 3; }),
            U('True Sun God', 32000, 'Colossal sun beam (+7 dmg, 30 pierce) + 6 sun orbs. Obliterates everything.', s => { s.orbit = { n: 6, r: 56, spin: 0.1, hr: 14, cd: 6, dmg: 6, ceramic: 6, blimp: 10, look: 'sun' }; s.dmg += 7; s.beam = { w: 14, col: '#fff3a0' }; s.pierce += 20; s.blimp += 10; s.ceramic += 5; s.rate = R(s.rate * 0.85); }),
        ] },
        { name: 'Range & Robo', up: [
            U('Super Range', 800, '+50 range.', s => { s.range += 50; }),
            U('Epic Range', 1500, '+40 range, +1 pierce, +1 vs ceramic.', s => { s.range += 40; s.pierce += 1; s.ceramic += 1; }),
            U('Robo Monkey', 4500, 'Fires at 2 different bloons at once. +1 damage.', s => { s.multi = 2; s.dmg += 1; }),
            U('Tech Terror', 12000, 'Robo fires at 3. Every 2s cyber beams strike 6 bloons for 8 damage.', s => { s.multi = 3; s.terror = { every: 120, n: 6, dmg: 8, blimp: 10 }; s.dmg += 1; s.range += 30; }),
            U('The Anti-Bloon', 28000, '4 targets. Every 1.2s beams strike 16 bloons anywhere for 22 damage.', s => { s.multi = 4; s.terror = { every: 72, n: 16, dmg: 22, blimp: 40, global: true }; s.range += 50; s.dmg += 2; s.pierce += 3; s.rate = R(s.rate * 0.8); }),
        ] },
        { name: 'Dark Knight', up: [
            U('Knockback', 1200, 'Darts knock bloons back along the track.', s => { s.push = 7; s.pierce += 1; }),
            U('Ultravision', 2500, '+35 range, +1 pierce. Targets take +1 damage from all sources.', s => { s.range += 35; s.pierce += 1; s.mark = 1; s.homing = 0.1; }),
            U('Dark Knight', 6000, 'Sword slashes all bloons around it every 0.3s. +2 damage.', s => { s.dmg += 2; s.slash = { every: 18, r: 62, dmg: 3, blimp: 4 }; }),
            U('Dark Champion', 14000, 'Stronger slashes and a dark aura: nearby towers fire 20% faster, +1 pierce.', s => { s.dmg += 3; s.slash = { every: 14, r: 78, dmg: 6, blimp: 8 }; s.aura = { r: 180, rate: 0.8, pierce: 1, cer: 1 }; s.pierce += 2; s.rate = R(s.rate * 0.85); }),
            U('Legend of the Night', 32000, 'Night falls: EVERY tower fires 35% faster with +1 damage, +2 pierce. Massive slashes.', s => { s.dmg += 6; s.slash = { every: 10, r: 98, dmg: 12, blimp: 25 }; s.aura = { global: true, r: 9999, rate: 0.65, dmg: 1, pierce: 2, cer: 2, bli: 4 }; s.pierce += 3; s.range += 40; s.rate = R(s.rate * 0.8); }),
        ] },
    ]
});

/* ================================================================== *
 *  12. ALCHEMIST
 * ================================================================== */
function stepPools(t) {
    if (!t.pools || !t.pools.length) return;
    for (let i = t.pools.length - 1; i >= 0; i--) {
        const p = t.pools[i];
        if (--p.life <= 0) { t.pools.splice(i, 1); continue; }
        if (--p.c <= 0) { p.c = 20; for (const b of bloons) if (live(b) && Math.hypot(b.x - p.x, b.y - p.y) <= p.r + b.radius * 0.4) { hurt(b, p.d, { ceramic: p.d }); acid(b, { d: 1, t: 60, n: 30 }); } }
    }
}
function alchFire(t, tg) {
    const s = t.s, a = aimAt(t, tg, 1);
    const p = mkDart(t.x + Math.cos(a) * 10, t.y + Math.sin(a) * 10, a, s, { style: 'potion', aoe: s.aoe, pierce: 1, spd: 9, pr: 5, homing: 0.5, tgt: tg, slow: null, stun: s.stun || 0, burn: null });
    p.maxHit = s.maxHit;
    p.apply = b => { acid(b, s.acid); if (s.cash) { money += s.cash; } };
    p.onDie = q => { if (q.exp && s.pool) { (t.pools = t.pools || []).push({ x: q.x, y: q.y, r: s.pool.r, life: s.pool.life, d: s.pool.d, c: 0 }); } };
    t.recoil = 1;
}
STEPS.o_alch = function (t) {
    baseTick(t); stepPools(t);
    const s = t.s;
    if (t.cd > 0) t.cd--;
    if (s.brew && abReady(t, 'brew', s.brew.every, false)) {
        const c = towers.filter(o => o !== t && o.xt && !o.xt.noBuff && Math.hypot(o.x - t.x, o.y - t.y) <= s.range + 10).sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y)).slice(0, s.brew.n);
        for (const o of c) { o.xBrew = { until: NOW() + s.brew.dur, rate: s.brew.rate, dmg: s.brew.dmg, pierce: s.brew.pierce }; addFx({ k: 'ring', x: o.x, y: o.y, r0: 6, r1: 28, life: 20, col: '#7CFC00', w: 3 }); addFx({ k: 'bolt', pts: [{ x: t.x, y: t.y }, { x: o.x, y: o.y }], life: 10, col: '#9be564', w: 2 }); }
        if (!c.length) t.ab.brew = 40;
    }
    const tg = pickTarget(t, s.range, t.mode, { los: true });
    if (tg) { aimAt(t, tg); if (t.cd <= 0) { alchFire(t, tg); t.cd = cdOf(t); } }
};
orig('Alchemist', {
    name: 'Alchemist', cat: 'Magic', kind: 'o_alch', muzzle: 10,
    blurb: 'Throws acid potions and brews buffs for nearby towers.',
    aura: t => t.s.dip ? { x: t.x, y: t.y, r: t.s.dip.r, pierce: t.s.dip.pierce, cer: t.s.dip.cer, rate: t.s.dip.rate, dmg: t.s.dip.dmg, bli: t.s.dip.bli, vis: '#69f0ae', only: u => u.type !== 'Alchemist' && !u.xt.noBuff } : null,
    ground2: t => { for (const p of (t.pools || [])) { const a = Math.min(1, p.life / 60) * 0.55; ctx.globalAlpha = a; ell(ctx, p.x, p.y, p.r, p.r * 0.75, '#6edc4a', '#2f8a1f', 2); ell(ctx, p.x - p.r * 0.3, p.y - 2, p.r * 0.25, p.r * 0.18, '#c6ff8a'); ctx.globalAlpha = 1; } },
    base: mk({ range: 120, rate: 60, dmg: 1, pierce: 5, aoe: 40, maxHit: 5, acid: { d: 1, t: 120, n: 30 }, stun: 0, brew: null, dip: null, pool: null, cash: 0 }),
    stats: t => ['Splash ' + B(Math.round(t.s.aoe)), 'Acid ' + B(t.s.acid.d + '/' + (t.s.acid.n / 60).toFixed(1) + 's'), t.s.cash ? '💰 +$' + t.s.cash + '/bloon' : '', t.s.brew ? '⚡ Brew ' + B(abLeft(t, 'brew') + 's') : ''],
    paths: [
        { name: 'Acid', up: [
            U('Larger Potions', 250, '+25 blast radius, hits 3 more bloons.', s => { s.aoe += 25; s.maxHit += 3; s.pierce += 3; }),
            U('Stronger Acid', 500, 'Acid deals 2 damage and lasts 3s.', s => { s.acid = { d: 2, t: 180, n: 30 }; }),
            U('Perishing Potions', 1800, '+1 damage, acid 3 dmg (+2 vs ceramic).', s => { s.dmg += 1; s.acid = { d: 3, t: 240, n: 30, cer: 2 }; s.maxHit += 3; }),
            U('Unstable Concoction', 4200, 'Faster, +2 damage, stuns bloons, acid every 0.33s.', s => { s.rate = R(s.rate * 0.7); s.dmg += 2; s.stun = 50; s.acid = { d: 3, t: 300, n: 20, cer: 3, blimp: 2 }; s.aoe += 15; }),
            U('Total Transformation', 20000, 'Becomes a monster: 2x speed, +5 damage, acid that spreads between bloons.', s => { s.rate = R(s.rate * 0.5); s.dmg += 5; s.aoe += 30; s.maxHit += 10; s.pierce += 10; s.acid = { d: 6, t: 360, n: 15, cer: 5, blimp: 8, spread: 1 }; s.stun = 70; s.blimp += 8; }),
        ] },
        { name: 'Brews', up: [
            U('Acidic Mixture Dip', 500, 'Towers in range get +1 pierce and +1 vs ceramic (permanent aura).', s => { s.dip = { r: s.range, pierce: 1, cer: 1 }; }),
            U('Berserker Brew', 900, 'Every 8s brews the 2 nearest towers: +30% speed, +1 damage for 12s.', s => { s.brew = { every: 480, n: 2, dur: 720, rate: 0.7, dmg: 1, pierce: 0 }; }),
            U('Stronger Stimulant', 2200, '3 towers, 15s, +40% speed, +1 damage, +2 pierce.', s => { s.brew = { every: 450, n: 3, dur: 900, rate: 0.6, dmg: 1, pierce: 2 }; s.dip.cer = 2; }),
            U('Transforming Tonic', 5500, '4 towers, +100% speed. Alchemist itself +20% speed, +1 damage.', s => { s.brew = { every: 420, n: 4, dur: 900, rate: 0.5, dmg: 1, pierce: 3 }; s.rate = R(s.rate * 0.8); s.dmg += 1; s.dip = { r: s.range + 10, pierce: 2, cer: 2, bli: 1 }; }),
            U('Permanent Brew', 20000, 'Every tower in a huge range: +45% speed, +2 damage, +3 pierce, +3 vs blimps - permanently.', s => { s.dip = { r: s.range + 50, rate: 0.55, dmg: 2, pierce: 3, cer: 2, bli: 3 }; s.brew = { every: 360, n: 6, dur: 900, rate: 0.5, dmg: 2, pierce: 4 }; }),
        ] },
        { name: 'Alchemy', up: [
            U('Quick Brewing', 300, 'Throws 30% faster.', s => { s.rate = R(s.rate * 0.7); }),
            U('Acid Pool', 600, 'Potions leave an acid pool that damages bloons for 6s.', s => { s.pool = { r: 36, life: 360, d: 1 }; }),
            U('Lead to Gold', 1800, 'Every bloon hit by a potion pays +$1.', s => { s.cash = 1; s.maxHit += 2; }),
            U('Rubber to Gold', 4500, 'Pays +$2 per bloon hit. 15% faster.', s => { s.cash = 2; s.rate = R(s.rate * 0.85); s.pool = { r: 44, life: 420, d: 2 }; }),
            U('Bloon Master Alchemist', 17000, 'Pays +$3 per hit, +$400/round, big acid pools. 20% faster.', s => { s.cash = 3; s.income = 400; s.rate = R(s.rate * 0.8); s.pool = { r: 56, life: 540, d: 3 }; s.aoe += 20; s.maxHit += 5; }),
        ] },
    ]
});

/* ================================================================== *
 *  13. BANANA FARM
 * ================================================================== */
EXT.pre.push(function farmPre() {
    /* Marketplace line: farms boost other farms in range (strongest wins); EZ-collect pays bananas automatically */
    for (const f of towers) {
        if (!f.xt || f.type !== 'Farm') continue;
        let m = 0;
        for (const g of towers) if (g.xt && g.type === 'Farm' && g.s.market && Math.hypot(g.x - f.x, g.y - f.y) <= g.s.market.r) m = Math.max(m, g.s.market.m);
        f.fBoost = 1 + m;
    }
    const now = NOW();
    for (let i = bananas.length - 1; i >= 0; i--) {
        const b = bananas[i];
        if (b.auto && now >= b.auto) { money += b.value; addFx({ k: 'txt', x: b.x, y: b.y - 6, s: '+$' + b.value, col: '#ffe135', life: 36 }); bananas.splice(i, 1); updateMainUI(); }
    }
});
EXT.round.push(function farmRoundEnd() {
    for (const f of towers) {
        if (!f.xt || f.type !== 'Farm' || !f.s.bank || !f.bankSum) continue;
        const pay = Math.round(f.bankSum * (1 + f.s.bank)); f.bankSum = 0;
        money += pay; addFx({ k: 'txt', x: f.x, y: f.y - 34, s: 'BANK +$' + pay, col: '#ffe135', life: 80 }); updateMainUI();
    }
});
STEPS.o_farm = function (t) {
    const s = t.s;
    if (!roundInProgress) return;
    t.fc = (t.fc === undefined ? s.fRate * 0.5 : t.fc) - 1;
    if (t.fc > 0) return;
    t.fc = s.fRate;
    const val = Math.round(s.fVal * (t.fBoost || 1));
    for (let i = 0; i < s.fN; i++) {
        if (s.bank) { t.bankSum = (t.bankSum || 0) + val; addFx({ k: 'puff', x: t.x + rnd(-14, 14), y: t.y - 8, r: 4, life: 14, col: '#ffe135' }); continue; }
        const b = new Banana(t.x, t.y, val);
        b.value = val; b.life = s.bLife; if (s.auto) b.auto = NOW() + s.auto;
        bananas.push(b);
    }
    t.recoil = 1;
};
orig('Farm', {
    name: 'Banana Farm', cat: 'Support', kind: 'o_farm', noTarget: true, noBuff: true, noDmgStat: true,
    blurb: 'Grows bananas worth cash. Click them to collect before they spoil.',
    base: mk({ range: 0, rate: 350, dmg: 0, pierce: 0, fRate: 350, fVal: 40, fN: 1, bLife: 600, auto: 0, bank: 0, market: null, salvage: 0 }),
    stats: t => null,
    paths: [
        { name: 'Production', up: [
            U('Increased Production', 500, 'Grows bananas 20% faster.', s => { s.fRate = R(s.fRate * 0.8); }),
            U('Greater Production', 900, 'Grows bananas 25% faster again.', s => { s.fRate = R(s.fRate * 0.75); }),
            U('Banana Plantation', 3200, '2 bananas per harvest, each worth 25% more.', s => { s.fN = 2; s.fVal = Math.round(s.fVal * 1.25); }),
            U('Banana Research Facility', 11000, '3 bananas per harvest, more valuable, 15% faster.', s => { s.fN = 3; s.fVal = Math.round(s.fVal * 1.2); s.fRate = R(s.fRate * 0.85); }),
            U('Banana Central', 34000, '5 bananas per harvest, +40% value, 20% faster. Cash machine.', s => { s.fN = 5; s.fVal = Math.round(s.fVal * 1.4); s.fRate = R(s.fRate * 0.8); }),
        ] },
        { name: 'Collection', up: [
            U('Long Life Bananas', 400, 'Bananas last 25s before spoiling.', s => { s.bLife = 1500; }),
            U('Valuable Bananas', 800, 'Bananas are worth 40% more.', s => { s.fVal = Math.round(s.fVal * 1.4); }),
            U('Monkey Bank', 3500, 'No clicking: cash goes into a vault, paid at round end with +20% interest.', s => { s.bank = 0.2; }),
            U('IMF Loan', 11000, 'Vault interest +45%, bananas worth 20% more, +$400 each round.', s => { s.bank = 0.45; s.income += 400; s.fVal = Math.round(s.fVal * 1.2); }),
            U('Monkey-Nomics', 30000, 'Vault interest +90%, +30% value, +$1500 each round.', s => { s.bank = 0.9; s.income += 1500; s.fVal = Math.round(s.fVal * 1.3); }),
        ] },
        { name: 'Marketplace', up: [
            U('EZ Collect', 350, 'Bananas collect themselves after 1 second.', s => { s.auto = 60; }),
            U('Banana Salvage', 800, 'Sells for 90% of what you invested. +$60 per round.', s => { s.salvage = 1; s.income += 60; }),
            U('Marketplace', 3500, '+$300/round. Farms within 120 get +20% banana value.', s => { s.income += 300; s.market = { r: 120, m: 0.2 }; }),
            U('Central Market', 12000, '+$900/round. Farms within 150 get +50% value. Instant collection.', s => { s.income += 900; s.market = { r: 150, m: 0.5 }; s.auto = 30; }),
            U('Monkey Wall Street', 38000, '+$3500/round. Farms within 200 get +75% value.', s => { s.income += 3500; s.market = { r: 200, m: 0.75 }; s.fVal = Math.round(s.fVal * 1.15); }),
        ] },
    ]
});
DEFS.Farm.statLine = t => {
    const s = t.s, per = Math.round(s.fVal * (t.fBoost || 1)) * s.fN, perRound = Math.round(per * 1800 / s.fRate);
    return ['Harvest ' + B(s.fN + ' × $' + Math.round(s.fVal * (t.fBoost || 1))), 'Every ' + B((s.fRate / 60).toFixed(1) + 's'), '≈ ' + B('$' + perRound + '/1800 ticks'), s.income ? '💰 +$' + s.income + '/round' : '', s.bank ? '🏦 Vault ' + B('$' + Math.round(t.bankSum || 0)) + ' (+' + Math.round(s.bank * 100) + '%)' : ''].filter(Boolean).join(' · ');
};
const _sell = sellTower;
sellTower = function (e) {
    if (activeTower && activeTower.xt && activeTower.s.salvage && !activeTower.salvaged) { activeTower.salvaged = true; activeTower.invested = Math.round(activeTower.invested * 0.9 / 0.7); }
    return _sell.apply(this, arguments);
};

/* ================================================================== *
 *  14. MONKEY VILLAGE
 * ================================================================== */
STEPS.o_village = function (t) {
    const s = t.s, now = NOW();
    if (s.call && abReady(t, 'call', s.call.every)) {
        for (const u of towers) if (u !== t && u.xt && !u.xt.noBuff && Math.hypot(u.x - t.x, u.y - t.y) <= s.vr) { u.xCall = { until: now + s.call.dur, rate: s.call.rate, dmg: 0 }; addFx({ k: 'ring', x: u.x, y: u.y, r0: 6, r1: 26, life: 18, col: '#ff9f1c', w: 3 }); }
        addFx({ k: 'ring', x: t.x, y: t.y, r0: 10, r1: s.vr, life: 24, col: '#ff9f1c', w: 5 }); addFx({ k: 'txt', x: t.x, y: t.y - 36, s: 'CALL TO ARMS!', col: '#ffb347', life: 70 });
    }
    if (s.hd && abReady(t, 'hd', s.hd.every)) {
        for (const u of towers) if (u !== t && u.xt && !u.xt.noBuff) { u.xCall = { until: now + s.hd.dur, rate: s.hd.rate, dmg: s.hd.dmg }; addFx({ k: 'ring', x: u.x, y: u.y, r0: 6, r1: 24, life: 18, col: '#ff5252', w: 3 }); }
        addFx({ k: 'flash', x: W() / 2, y: H() / 2, r: 500, life: 12, col: 'rgba(255,90,60,0.25)' }); addFx({ k: 'txt', x: t.x, y: t.y - 36, s: 'HOMELAND DEFENSE!', col: '#ff8a80', life: 80 });
    }
    t.pulseA = (t.pulseA || 0) + 0.03;
};
orig('Village', {
    name: 'Monkey Village', cat: 'Support', kind: 'o_village', noTarget: true, noBuff: true, noDmgStat: true, noPierceStat: true,
    blurb: 'Boosts the attack speed of every tower in its radius.',
    ring: t => ({ x: t.x, y: t.y, r: t.s.vr }),
    aura: t => { const s = t.s; return { x: t.x, y: t.y, r: s.vr, rate: s.vrate, rangeP: s.rp, dmg: s.vdmg, pierce: s.vpierce, cer: s.vcer, bli: s.vbli, prim: s.prim, vis: s.vrate <= 0.65 ? '#7CFC00' : 'gold', only: u => !u.xt.noBuff }; },
    base: mk({ range: 140, rate: 0, dmg: 0, pierce: 0, vr: 140, vrate: 0.8, rp: 0, vdmg: 0, vpierce: 0, vcer: 0, vbli: 0, prim: null, disc: 0, call: null, hd: null }),
    stats: t => null,
    paths: [
        { name: 'Radius & Training', up: [
            U('Bigger Radius', 400, '+30 radius.', s => { s.vr += 30; s.range = s.vr; }),
            U('Radar Scanner', 900, 'All towers in range gain +10% range. +10 radius.', s => { s.rp = 0.1; s.vr += 10; s.range = s.vr; }),
            U('Primary Training', 1800, 'Primary towers: +15% range, +1 pierce.', s => { s.prim = { rangeP: 0.15, pierce: 1 }; }),
            U('Primary Mentoring', 6500, 'Primary towers: +20% range, +1 damage, +2 pierce, 30% faster.', s => { s.prim = { rangeP: 0.2, pierce: 2, dmg: 1, rate: 0.7 }; }),
            U('Primary Expertise', 20000, 'Primary: +30% range, +1 dmg, +4 pierce, 45% faster. All towers +15% range.', s => { s.prim = { rangeP: 0.3, pierce: 4, dmg: 1, rate: 0.55, cer: 2 }; s.rp = 0.15; s.vr += 40; s.range = s.vr; }),
        ] },
        { name: 'Economy', up: [
            U('Monkey Business', 400, '+$120 every round.', s => { s.income += 120; }),
            U('Monkey Commerce', 1200, 'Upgrades cost 10% less for towers in the radius.', s => { s.disc = 0.1; }),
            U('Monkey Town', 3500, '+$300 per round, 15% upgrade discount.', s => { s.income = 300; s.disc = 0.15; }),
            U('Monkey City', 9000, '+$700 per round, 20% upgrade discount.', s => { s.income = 700; s.disc = 0.2; s.vr += 20; s.range = s.vr; }),
            U('Monkey Metropolis', 26000, '+$2000 per round, 30% upgrade discount.', s => { s.income = 2000; s.disc = 0.3; s.vr += 30; s.range = s.vr; }),
        ] },
        { name: 'Command', up: [
            U('Jungle Drums', 1200, 'Towers in range fire 35% faster (up from 20%).', s => { s.vrate = 0.65; }),
            U('Monkey Intelligence Bureau', 2200, 'Towers in range: +1 pierce, +1 vs ceramic and blimps.', s => { s.vpierce = 1; s.vcer = 1; s.vbli = 1; }),
            U('Call to Arms', 5500, 'Every 40s, towers in range fire 45% faster for 8s.', s => { s.call = { every: 2400, dur: 480, rate: 0.55 }; }),
            U('Command Banner', 12000, 'Permanent 45% speed, +1 damage, +2 vs ceramic/blimps in range. Stronger Call to Arms.', s => { s.vrate = 0.55; s.vdmg = 1; s.vcer = 2; s.vbli = 2; s.call = { every: 1800, dur: 540, rate: 0.45 }; }),
            U('Homeland Defense', 28000, 'Every 50s EVERY tower fires 2x faster with +1 damage for 10s. Permanent 50% speed.', s => { s.vrate = 0.5; s.vpierce = 2; s.hd = { every: 3000, dur: 600, rate: 0.5, dmg: 1 }; s.call = { every: 1500, dur: 600, rate: 0.4 }; }),
        ] },
    ]
});
DEFS.Village.statLine = t => {
    const s = t.s;
    return ['Radius ' + B(Math.round(s.vr)), 'Speed ' + B('+' + Math.round((1 / s.vrate - 1) * 100) + '%'), s.rp ? 'Range ' + B('+' + Math.round(s.rp * 100) + '%') : '', s.disc ? 'Discount ' + B(Math.round(s.disc * 100) + '%') : '', s.income ? '💰 +$' + s.income + '/round' : '', s.call ? '⚡ Call to Arms ' + B(abLeft(t, 'call') + 's') : '', s.hd ? '⚡ Homeland ' + B(abLeft(t, 'hd') + 's') : ''].filter(Boolean).join(' · ');
};

/* ================================================================== *
 *  15. ARTWORK  (original Canvas drawings, same monkey face language as the game)
 * ================================================================== */
const tt = t => (t ? t.tiers : [0, 0, 0]);
const SK = '#8b5a2b', EAR = '#6b4c3a', MUZ = '#d4a373';
const eyes = (c, col) => { circ(c, 5, -3, 1.6, col || '#111'); circ(c, 5, 3, 1.6, col || '#111'); };
const dartIn = (c, x, y, col) => { rect(c, x, y, 9, 2, '#ddd'); poly(c, [[x + 9, y - 1.4], [x + 14, y + 1], [x + 9, y + 3.4]], col || '#e74c3c'); };

SPR.Dart = function (c, t, a) {
    const k = tt(t); c.save(); c.rotate(a);
    if (k[1] >= 4) poly(c, [[-2, -9], [-18, 0], [-2, 9]], k[1] >= 5 ? '#ff4fd8' : '#dc143c', '#600', 1);
    monkeyHead(c, 0, 0, 11, SK, EAR, MUZ);
    if (k[0] >= 1) { c.strokeStyle = '#cc0000'; c.lineWidth = 2.6; c.beginPath(); c.arc(0, 0, 11, Math.PI * 0.78, Math.PI * 1.22); c.stroke(); }
    if (k[2] >= 1) { circ(c, 6, -3, 2.6, null, '#4fc3f7', 1.3); circ(c, 6, 3, 2.6, null, '#4fc3f7', 1.3); }
    if (k[2] >= 3) { rect(c, 4, -11, 3, 22, '#5d4037', '#2b1b14', 1); poly(c, [[7, -11], [18, -1], [18, 1], [7, 11], [8, 0]], '#8d6e63', '#3e2723', 1); rect(c, 7, -0.8, 14, 1.6, '#cfd8dc'); }
    else if (k[0] >= 4) circ(c, 13, 7, k[0] >= 5 ? 9 : 7, '#b3402a', '#4a1208', 1.5);
    else if (k[0] >= 3) { circ(c, 12, 7, 6, '#8d9096', '#33363a', 1.2); for (let i = 0; i < 8; i++) { const q = i * TAU / 8; poly(c, [[12 + Math.cos(q) * 6, 7 + Math.sin(q) * 6], [12 + Math.cos(q + 0.2) * 9, 7 + Math.sin(q + 0.2) * 9], [12 + Math.cos(q + 0.4) * 6, 7 + Math.sin(q + 0.4) * 6]], '#d0d3d8'); } }
    else { dartIn(c, 6, 5); if (k[1] >= 3) { dartIn(c, 6, -7); dartIn(c, 9, -1); } }
    c.restore();
};
SPR.Boomerang = function (c, t, a, T) {
    const k = tt(t); c.save(); c.rotate(a);
    monkeyHead(c, 0, 0, 11, SK, EAR, MUZ);
    if (k[2] >= 1) { circ(c, 6, -3, 2.4, null, '#ff7043', 1.2); circ(c, 6, 3, 2.4, null, '#ff7043', 1.2); }
    const glv = k[1] >= 2, col = glv ? '#d8dde3' : (k[2] >= 2 ? '#ff6d00' : '#ff8c00');
    poly(c, [[-2, -11], [4, -9], [3, 0], [4, 9], [-2, 11], [0, 0]], col, '#5d3a00', 1.2);
    if (glv) circ(c, 2, 0, 2, '#7f8c8d');
    if (k[0] >= 3) { ell(c, 12, 0, 3, 8, null, 'rgba(120,200,255,0.8)', 1.5); }
    if (k[1] >= 5) { c.restore(); return; }
    c.restore();
};
SPR.Bomb = function (c, t, a) {
    const k = tt(t), rec = t ? t.recoil : 0; c.save(); c.rotate(a);
    rect(c, -11, -12, 10, 24, '#5c4033', '#2b1c14', 1, 2);
    circ(c, 0, 0, 10.5, k[2] >= 3 ? '#37474f' : '#1a1a1a', '#000', 1.5);
    const bw = k[1] >= 1 ? 9 : 7, L = 16 + (k[2] >= 1 ? 4 : 0) + (k[2] >= 2 ? 3 : 0) - rec * 2;
    rect(c, 0, -bw, L, bw * 2, k[1] >= 2 ? '#455a64' : '#222', '#000', 1);
    rect(c, L - 2, -bw - 1, 4, bw * 2 + 2, '#111');
    if (k[0] >= 2) rect(c, 6, -bw, 3, bw * 2, '#cc0000');
    if (k[2] >= 3) { rect(c, 2, -bw - 3, 6, 3, '#f1c40f'); rect(c, 2, bw, 6, 3, '#f1c40f'); }
    if (k[1] >= 5) circ(c, 4, 0, 4, '#ff7a1a');
    c.restore();
};
SPR.Tack = function (c, t, a, T) {
    const k = tt(t); c.save(); c.rotate(k[1] >= 4 ? 0 : (t ? (t.angle || 0) : 0) * 0.3);
    const col = k[2] >= 1 ? (k[2] >= 4 ? '#ff3d00' : '#ff7043') : (k[0] >= 3 ? '#32cd32' : '#ff66b2');
    const n = k[0] >= 3 ? 8 : 4;
    for (let i = 0; i < n; i++) { c.save(); c.rotate(i * TAU / n); rect(c, 0, -2, 17, 4, col, '#444', 0.8); poly(c, [[17, -2], [22, 0], [17, 2]], '#ddd'); c.restore(); }
    circ(c, 0, 0, 13, col, '#555', 1.5); circ(c, 0, 0, 7.5, '#333');
    if (k[2] >= 3) { c.strokeStyle = 'rgba(255,140,30,' + (0.5 + 0.3 * Math.sin(T * 0.2)) + ')'; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, 19, 0, TAU); c.stroke(); }
    if (k[1] >= 3) { circ(c, 0, 0, 4.5, '#cfd8dc'); }
    circ(c, 2, -2, 1.3, '#fff'); circ(c, 2, 2, 1.3, '#fff');
    c.restore();
};
SPR.Ice = function (c, t, a, T) {
    const k = tt(t); c.save();
    if (k[1] >= 3) { c.globalAlpha = 0.25 + 0.1 * Math.sin(T * 0.1); circ(c, 0, 0, 20, '#bfe9ff'); c.globalAlpha = 1; }
    monkeyHead(c, 0, 0, 11, '#add8e6', '#87ceeb', '#e0ffff');
    if (k[0] >= 1) { poly(c, [[-8, -7], [-4, -15], [0, -7]], '#fff', '#8ad', 0.8); poly(c, [[0, -7], [4, -14], [8, -7]], '#fff', '#8ad', 0.8); }
    if (k[2] >= 3) { rect(c, 2, -3, 14, 6, '#4fc3f7', '#01579b', 1, 2); circ(c, 16, 0, 3, '#e1f5fe'); }
    if (k[0] >= 3) { for (let i = 0; i < 4; i++) poly(c, [[-12 + i * 8, 9], [-9 + i * 8, 9], [-10.5 + i * 8, 17]], '#e1f5fe', '#81d4fa', 0.6); }
    if (k[1] >= 4) { c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1.5; for (let i = 0; i < 6; i++) { const q = i * TAU / 6 + T * 0.02; c.beginPath(); c.moveTo(Math.cos(q) * 14, Math.sin(q) * 14); c.lineTo(Math.cos(q) * 20, Math.sin(q) * 20); c.stroke(); } }
    c.restore();
};
SPR.Glue = function (c, t, a) {
    const k = tt(t); c.save(); c.rotate(a);
    monkeyHead(c, 0, 0, 11, SK, EAR, MUZ);
    const col = k[0] >= 2 ? '#32cd32' : (k[2] >= 4 ? '#ffe44d' : '#ffcc00');
    c.beginPath(); c.arc(0, 0, 11.5, Math.PI / 2, Math.PI * 1.5); c.closePath(); c.fillStyle = col; c.fill(); c.strokeStyle = '#7a5a00'; c.lineWidth = 1; c.stroke();
    rect(c, 6, 3.5, 10 + (k[1] >= 3 ? 4 : 0), 5, '#aaa', '#555', 1); rect(c, 16 + (k[1] >= 3 ? 4 : 0), 2.5, 4, 7, k[0] >= 2 ? '#00ff00' : '#ffb833');
    if (k[1] >= 3) rect(c, 6, -9, 12, 4, '#9e9e9e', '#555', 1);
    if (k[2] >= 3) circ(c, -3, 0, 4, '#ff5252');
    c.restore();
};
SPR.Sniper = function (c, t, a) {
    const k = tt(t), rec = t ? t.recoil : 0; c.save(); c.rotate(a);
    c.beginPath(); c.arc(-2, 0, 11, Math.PI / 2, Math.PI * 1.5); c.fillStyle = k[1] >= 1 ? '#5c4033' : '#2e8b57'; c.fill();
    monkeyHead(c, 0, 0, 11, SK, EAR, MUZ);
    c.beginPath(); c.arc(-2, 0, 11, Math.PI / 2, Math.PI * 1.5); c.fillStyle = k[1] >= 1 ? '#5c4033' : '#2e8b57'; c.fill();
    if (k[2] >= 1) { rect(c, 3, -5, 7, 3, '#76ff03', '#1b5e20', 0.8); rect(c, 3, 2, 7, 3, '#76ff03', '#1b5e20', 0.8); }
    const L = 18 + (k[1] >= 3 ? 4 : 0) - rec * 3;
    rect(c, 4, 4, L, 3, k[0] >= 3 ? '#222' : '#444', '#000', 0.8);
    rect(c, 8, 1.5, 6, 2.5, '#111');
    if (k[0] >= 3) rect(c, 6, 7, 6, 5, '#222');
    if (k[1] >= 1) rect(c, 9, 2, 5, 3, '#111');
    if (k[2] >= 4) rect(c, -9, -12, 7, 6, '#8d6e3b', '#3e2f12', 1);
    c.restore();
};
function drawHeli(c, x, y, ang, rot, k, scale) {
    c.save(); c.translate(x, y); c.scale(scale || 1, scale || 1);
    c.save(); c.rotate(ang);
    const body = k[0] >= 4 ? '#37474f' : (k[1] >= 4 ? '#5d4037' : (k[2] >= 4 ? '#1565c0' : '#2E8B57'));
    rect(c, -24, -3, 15, 6, '#111', null, 0, 2);
    if (k[0] >= 4) rect(c, 4, 7, 9, 3, '#90a4ae', '#222', 0.8), rect(c, 4, -10, 9, 3, '#90a4ae', '#222', 0.8);
    ell(c, 0, 0, 14, 10, body, '#0f2a1a', 1.5); ell(c, 8, 0, 6, 5.5, '#add8e6', '#476', 1);
    if (k[1] >= 2) { rect(c, -2, 9, 12, 2.5, '#cfd8dc', '#444', 0.8); rect(c, -2, -11.5, 12, 2.5, '#cfd8dc', '#444', 0.8); }
    if (k[2] >= 4) circ(c, -4, 0, 3, '#ffd54a');
    c.restore();
    c.rotate(rot);
    if (k[0] >= 3) { circ(c, 0, 0, 25, 'rgba(210,210,210,0.35)', '#ddd', 1); rect(c, -27, -3, 54, 6, 'rgba(210,210,210,0.9)'); rect(c, -3, -27, 6, 54, 'rgba(210,210,210,0.9)'); }
    else { rect(c, -24, -2, 48, 4, 'rgba(40,40,40,0.8)'); rect(c, -2, -24, 4, 48, 'rgba(40,40,40,0.8)'); }
    circ(c, 0, 0, 3, '#222');
    c.restore();
}
SPR.Heli = function (c, t, a, T) {
    if (!t) { drawHeli(c, 0, 0, 0, T * 0.4, [0, 0, 0], 0.85); return; }
    circ(c, 0, 0, 18, '#444', '#222', 3);
    c.fillStyle = '#fff'; c.font = 'bold 20px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('H', 0, 1);
};
SPR.Ninja = function (c, t, a) {
    const k = tt(t); c.save(); c.rotate(a);
    monkeyHead(c, 0, 0, 11, '#2b2b2b', '#1a1a1a', '#d4a373');
    rect(c, 0, -5, 9, 10, '#d4a373');
    c.fillStyle = '#111'; c.beginPath(); c.arc(0, 0, 11.4, Math.PI * 0.5, Math.PI * 1.5); c.fill();
    rect(c, -1, -9, 3, 18, k[0] >= 3 ? '#b71c1c' : '#c62828');
    eyes(c, '#fff'); circ(c, 5.5, -3, 0.8, '#111'); circ(c, 5.5, 3, 0.8, '#111');
    if (k[0] >= 4) poly(c, [[-9, 0], [-24, -5], [-20, 0], [-24, 5]], '#c62828');
    if (k[1] >= 3) { circ(c, -3, -11, 2.5, '#9575cd'); circ(c, -3, 11, 2.5, '#9575cd'); }
    if (k[2] >= 2) { circ(c, 10, 9, 4.5, '#263238', '#000', 1); rect(c, 10, 4, 2, 4, '#ffd54a'); }
    if (k[0] >= 2) { poly(c, [[7, 8], [10, 6], [13, 8], [10, 10]], '#eee', '#333', 0.8); }
    c.restore();
};
SPR.Wizard = function (c, t, a) {
    const k = tt(t); c.save(); c.rotate(a);
    const robe = k[2] >= 2 ? '#2e1a47' : '#4B0082';
    ell(c, -2, 0, 5, 12.5, robe); poly(c, [[-2, -9], [-20, 0], [-2, 9]], robe);
    monkeyHead(c, 0, 0, 10.5, SK, EAR, MUZ);
    const beard = '#eeeeee'; circ(c, 6, -5, 3.6, beard); circ(c, 9.5, -2, 3.6, beard); circ(c, 10.5, 1, 4.4, beard); circ(c, 9, 4, 3.6, beard); circ(c, 5, 6, 3.6, beard);
    poly(c, [[-6, -5], [3, -2], [-6, 5], [-14, 0]], k[0] >= 1 ? '#c62828' : '#6a1b9a', '#220', 1);
    circ(c, -8, 0, 1.8, 'gold');
    const orb = k[0] >= 2 ? '#ff6d00' : (k[1] >= 2 ? '#40c4ff' : (k[2] >= 2 ? '#b388ff' : '#ff4fd8'));
    rect(c, 3, 8, 15, 2, '#6d4c41'); circ(c, 18, 9, 3.4, orb, '#fff', 0.8);
    if (k[2] >= 2) { circ(c, -6, -12, 3, '#eceff1', '#455a64', 1); }
    if (k[1] >= 4) { c.strokeStyle = 'rgba(180,220,255,0.8)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(14, 2); c.lineTo(18, -2); c.lineTo(16, -4); c.lineTo(21, -9); c.stroke(); }
    c.restore();
};
SPR.Super = function (c, t, a, T) {
    const k = tt(t); c.save(); c.rotate(a);
    const dark = k[2] >= 3, sun = k[0] >= 3;
    if (sun) { c.globalAlpha = 0.28 + 0.1 * Math.sin(T * 0.1); circ(c, 0, 0, 20, '#ffd54a'); c.globalAlpha = 1; }
    poly(c, [[-3, -10], [-22, 0], [-3, 10]], dark ? '#311b92' : '#dc143c');
    monkeyHead(c, 0, 0, 11, dark ? '#303f9f' : '#1e3cff', dark ? '#1a237e' : '#0a1a8a', '#e8c9a0');
    c.beginPath(); c.arc(-2, 0, 11, Math.PI / 2, Math.PI * 1.5); c.fillStyle = dark ? '#1a237e' : '#0000ff'; c.fill();
    circ(c, 5, -3, 2.2, '#fff'); circ(c, 5, 3, 2.2, '#fff');
    circ(c, 5.5, -3, 1, k[0] >= 1 ? '#f00' : '#111'); circ(c, 5.5, 3, 1, k[0] >= 1 ? '#f00' : '#111');
    if (k[0] >= 1) rect(c, 1, -5, 9, 10, k[0] >= 2 ? '#ff4fd8' : '#ff2020', null, 0, 3);
    if (k[1] >= 3) { rect(c, 2, -12, 7, 4, '#90a4ae', '#263238', 1); rect(c, 2, 8, 7, 4, '#90a4ae', '#263238', 1); circ(c, 9, -10, 1.5, '#ff1744'); circ(c, 9, 10, 1.5, '#ff1744'); }
    if (dark) { poly(c, [[-4, -9], [-8, -16], [-2, -11]], '#111'); poly(c, [[-4, 9], [-8, 16], [-2, 11]], '#111'); }
    if (k[2] >= 5) { circ(c, 0, 0, 16, null, 'rgba(160,120,255,0.8)', 2); }
    c.restore();
};
SPR.Alchemist = function (c, t, a) {
    const k = tt(t); c.save(); c.rotate(a);
    ell(c, -3, 0, 6, 12, k[1] >= 3 ? '#00897b' : '#800080');
    monkeyHead(c, 0, 0, 10.5, SK, EAR, MUZ);
    circ(c, 6, -4, 3, null, '#fff', 1); circ(c, 6, 4, 3, null, '#fff', 1);
    rect(c, 2, -8, 4, 16, k[2] >= 4 ? '#ffb300' : '#6a1b9a');
    circ(c, 8, -5, 3.2 + (k[0] >= 1 ? 1.3 : 0), k[0] >= 2 ? '#76ff03' : '#00ffff', '#055', 0.8);
    circ(c, 8, 5, 3.2 + (k[0] >= 1 ? 1.3 : 0), k[1] >= 2 ? '#ff8c00' : '#e040fb', '#505', 0.8);
    if (k[2] >= 3) { circ(c, -8, -10, 3.4, '#ffd54a', '#7a5a00', 1); circ(c, -8, 10, 3.4, '#ffd54a', '#7a5a00', 1); }
    c.restore();
};
SPR.Farm = function (c, t, a, T) {
    const k = tt(t);
    rect(c, -5, 0, 10, 15, '#8B4513');
    const g = k[0] >= 3 ? '#2e7d32' : '#228B22';
    circ(c, 0, -5, 14, g); circ(c, -10, 0, 12, g); circ(c, 10, 0, 12, g);
    const n = 2 + Math.min(4, k[0]);
    for (let i = 0; i < n; i++) { c.fillStyle = '#ffd700'; c.beginPath(); c.arc(-9 + i * 18 / Math.max(1, n - 1), -2 - (i % 2) * 5, 3.6, 0, Math.PI, false); c.fill(); }
    if (k[1] >= 3) { rect(c, -9, 6, 18, 9, '#ffe082', '#8d6e00', 1.5, 2); c.fillStyle = '#5d4037'; c.font = 'bold 9px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('$', 0, 11); }
    if (k[2] >= 3) { rect(c, -17, -19, 34, 9, '#c62828', '#7f0000', 1, 2); for (let i = 0; i < 5; i++) rect(c, -17 + i * 6.8, -19, 3.4, 9, '#fff'); }
    if (k[0] >= 5 || k[1] >= 5 || k[2] >= 5) { c.globalAlpha = 0.4 + 0.2 * Math.sin(T * 0.1); circ(c, 0, -2, 26, null, '#ffd54a', 3); c.globalAlpha = 1; }
};
SPR.Village = function (c, t, a, T) {
    const k = tt(t);
    rect(c, -14, -10, 28, 24, k[1] >= 3 ? '#a1887f' : '#8b5a2b'); rect(c, -6, 4, 12, 10, '#3e2723');
    poly(c, [[-18, -10], [18, -10], [0, -26]], k[2] >= 3 ? '#ef6c00' : '#cd853f');
    c.strokeStyle = '#eee'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(0, -26); c.lineTo(0, -37); c.stroke();
    rect(c, 0, -37, 11, 7, k[2] >= 5 ? '#d50000' : (k[1] >= 4 ? '#ffd54a' : '#ff3333'));
    if (k[2] >= 1) { rect(c, -9, -14, 6, 4, '#f4a460'); rect(c, 3, -14, 6, 4, '#f4a460'); }
    if (k[0] >= 3) { circ(c, -20, 10, 3.5, '#388e3c'); circ(c, 20, 10, 3.5, '#388e3c'); }
    if (k[1] >= 1) { circ(c, 0, -3, 4, '#ffd54a', '#8d6e00', 1); }
    if (Math.max(k[0], k[1], k[2]) >= 5) { c.globalAlpha = 0.35; circ(c, 0, 0, 28, null, '#ffd54a', 3); c.globalAlpha = 1; }
};

/* ---------- projectile styles ---------- */
const ST = EXT.style;
ST.sball = (c, p) => { c.rotate((p.x + p.y) * 0.1); circ(c, 0, 0, 7, '#8d9096', '#33363a', 1.2); for (let i = 0; i < 8; i++) { c.save(); c.rotate(i * TAU / 8); poly(c, [[6, -2], [11, 0], [6, 2]], '#d0d3d8', '#333', 0.5); c.restore(); } };
ST.jug = (c, p) => { c.rotate((p.x + p.y) * 0.06); circ(c, 0, 0, 11, '#b3402a', '#4a1208', 1.8); c.strokeStyle = '#ffab91'; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 7, 0.3, 2.2); c.stroke(); circ(c, -3, -3, 2.4, 'rgba(255,255,255,0.4)'); };
ST.xbow = (c) => { rect(c, -9, -1, 16, 2, '#8d6e63', '#3e2723', 0.6); poly(c, [[7, -3], [14, 0], [7, 3]], '#cfd8dc', '#333', 0.6); poly(c, [[-9, 0], [-12, -3], [-7, 0], [-12, 3]], '#c62828'); };
ST.shuriken = (c, p) => { c.rotate((p.x + p.y) * 0.14); poly(c, [[0, -8], [2, -2], [8, 0], [2, 2], [0, 8], [-2, 2], [-8, 0], [-2, -2]], '#eceff1', '#37474f', 1); circ(c, 0, 0, 1.5, '#37474f'); };
ST.tack = (c) => { rect(c, -3, -1, 7, 2, '#cfd8dc', '#555', 0.5); rect(c, -5, -3.6, 2.4, 7.2, '#444'); };
ST.blade = (c, p) => { c.rotate((p.x + p.y) * 0.2); poly(c, [[0, -7], [2, -2], [7, 0], [2, 2], [0, 7], [-2, 2], [-7, 0], [-2, -2]], '#e0e6ea', '#455a64', 1); };
ST.frag = (c) => { circ(c, 0, 0, 2.6, '#ff9800', '#bf360c', 0.8); };
ST.glob = (c) => { circ(c, 0, 0, 5, '#ffcc00', '#a67c00', 1); circ(c, -1.5, -1.5, 1.4, 'rgba(255,255,255,0.6)'); };
ST.potion = (c, p) => { c.rotate((p.x + p.y) * 0.1); circ(c, 0, 1.5, 4.5, '#b388ff', '#4a148c', 1); rect(c, -1.3, -6, 2.6, 4, '#ddd', '#555', 0.6); circ(c, -1, 0.5, 1.2, 'rgba(255,255,255,0.7)'); };
ST.fireb = (c) => { circ(c, 0, 0, 7, 'rgba(255,90,20,0.45)'); circ(c, 0, 0, 5, '#ff5a14'); circ(c, 0, 0, 2.6, '#ffe066'); poly(c, [[-5, -2], [-14, 0], [-5, 2]], 'rgba(255,140,40,0.7)'); };
ST.arcane = (c) => { circ(c, 0, 0, 7, 'rgba(255,79,216,0.35)'); circ(c, 0, 0, 5, '#ff4fd8'); circ(c, 0, 0, 2.4, '#ffe066'); };
ST.flame = (c, p) => { circ(c, 0, 0, 5 + Math.sin(p.life) * 1.2, 'rgba(255,120,20,0.75)'); circ(c, 0, 0, 2.6, 'rgba(255,230,120,0.9)'); };
ST.shard = (c) => { poly(c, [[-5, 0], [0, -2.4], [8, 0], [0, 2.4]], '#e1f5fe', '#4fc3f7', 0.8); };
ST.bomb = (c) => { circ(c, 0, 0, 5.5, '#1a1a1a', '#000', 1); circ(c, -1.6, -1.6, 1.5, 'rgba(255,255,255,0.4)'); c2(c, 5.5); };
ST.bigbomb = (c) => { circ(c, 0, 0, 8, '#263238', '#000', 1.2); rect(c, -1.5, -8, 3, 16, '#c62828'); circ(c, -2.4, -2.4, 2, 'rgba(255,255,255,0.4)'); c2(c, 8); };
function c2(c, r) { c.strokeStyle = '#ffd54a'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(r * 0.6, -r * 0.6); c.lineTo(r, -r); c.stroke(); }

EXT.draw.boom = function (p) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.t * 0.5 + p.spin); ctx.scale(p.size, p.size);
    if (p.style === 'glaive') { poly(ctx, [[0, -11], [3, -3], [11, 0], [3, 3], [0, 11], [-3, 3], [-11, 0], [-3, -3]], '#d8dde3', '#5d6770', 1.2); circ(ctx, 0, 0, 2.4, '#7f8c8d'); }
    else { poly(ctx, [[-2, -10], [4, -8], [3, 0], [4, 8], [-2, 10], [0, 0]], p.burn ? '#ff6d00' : '#d97b00', '#5d3a00', 1.2); }
    ctx.restore();
};
EXT.fx.lbeam = function (f, u) {
    ctx.globalAlpha = u; ctx.lineCap = 'round';
    ctx.strokeStyle = f.col; ctx.lineWidth = f.w * 1.8; ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = f.w * 0.5; ctx.stroke(); ctx.globalAlpha = 1;
};

/* ---------- overlay: helis, status marks ---------- */
EXT.overlay.push(function () {
    const now = NOW();
    for (const t of towers) {
        if (!t.xt || t.type !== 'Heli') continue;
        ctx.globalAlpha = 0.22; ell(ctx, t.hx + 6, t.hy + 12, 13, 4.5, '#000'); ctx.globalAlpha = 1;
        drawHeli(ctx, t.hx, t.hy, t.hang, t.rot, t.tiers, 1 + (topTier(t) >= 5 ? 0.2 : 0));
    }
    for (const b of bloons) {
        if (b.hp <= 0) continue;
        if (b.xAcid) { ctx.globalAlpha = 0.85; ell(ctx, b.x + b.radius * 0.5, b.y - b.radius * 0.2 + Math.sin(now * 0.4 + b.x) * 1.5, 2.2, 3.6, '#8bdc3a'); ctx.globalAlpha = 1; }
        if (b.xVuln && b.xVuln.until > now) { poly(ctx, [[b.x, b.y - b.radius - 11], [b.x + 4, b.y - b.radius - 7], [b.x, b.y - b.radius - 3], [b.x - 4, b.y - b.radius - 7]], '#b388ff', '#4a148c', 1); }
    }
});

/* ================================================================== *
 *  16. BOOT
 * ================================================================== */
for (const type of Object.keys(DEFS)) { const d = DEFS[type]; if (d.orig) { for (let p = 0; p < 3; p++) if (d.paths[p].up.length !== 5) console.error('[BTDO] ' + type + ' path ' + p + ' is not 5 tiers'); } }
if (typeof generateMenuIcons === 'function') generateMenuIcons();
A.rebuildMenu();
updateMainUI();
BT.originals = { version: '1.0', types: Object.keys(DEFS).filter(k => DEFS[k].orig), helpers: { setVuln, acid, pushBack, slowAny, freezeBloon, abLeft } };
console.log('[BTDO] Original-tower upgrades loaded: ' + BT.originals.types.length + ' towers x 3 paths x 5 tiers (map: ' + MAP + ')');
})();
