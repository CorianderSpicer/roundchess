// Round flow and the centralized effect-resolution system.
//
// Everything that changes a round goes through this file: normal moves, bonus moves,
// card plays, reactions, traps, statuses and round results. Every card result is simulated
// on a copy first and only offered if the resulting position is legal.
//
// Deterministic priority when effects meet (lowest number resolves first):
//   0 Counter (Nullify) - cancels a card before anything else happens
//   1 Ward / Iron Will  - warded pieces cannot be chosen by enemy cards and ignore traps
//   2 Immunity          - immune pieces cannot be captured or destroyed
//   3 Shield            - absorbs the next capture (attacker bounces) or destruction
//   4 Restrictions      - freezes, disarms, barriers. If they would leave a player who is NOT
//                          in check without a legal move, they lift for that turn ("restriction
//                          break"), so cards never force a stalemate. In check, they can force mate.
//   5 Movement / bonus moves
//   6 Destruction (traps, Shockwave, Vengeance), each checked for legality in board order a1→h8
//   7 Transformation / revival
//   8 Card draw
// Simultaneous triggers from one move resolve: mover's own effects (traps, Shockwave, Bounty)
// in the order above, then the victim's reactions at the end of the mover's turn.
import { W, B, opp, applyMove, legalMoves, hasLegalMove, inCheck, validPosition, posKey, insufficient, san, kingSq, sqName, KT, has, NAME } from '../engine/chess.js';
import { cloneS, snapshot, addFx, delFx, destroy, fixCastle, fixEp, findId, FOREVER } from '../cards/util.js';
import { byId } from '../cards/defs.js';

export const STATUS_KEYS = ['frozen', 'immune', 'shield', 'noCapture', 'ward', 'bounty', 'mvN', 'mvK', 'mvCamel', 'mvB', 'mvR', 'phase', 'pawnDiag', 'pawnFwdCap'];

// ---------- RNG (seeded, stored in the match so saves replay identically) ----------
export function rand(G) { let t = (G.seed = (G.seed + 0x6d2b79f5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }

// ---------- context ----------
export function makeCtx(G, color, extra = {}) {
  const s = G.s;
  const ctx = {
    G, s, me: color, foe: opp(color), hand: G.hands[color], sim: false,
    n: (a, b, sep = '→') => (b == null ? sqName(a) : `${sqName(a)}${sep}${sqName(b)}`),
    draw: f => drawCard(G, color, f),
    refresh: uid => refreshCard(G, color, uid),
    ...extra,
  };
  return ctx;
}
const simCtx = (ctx, s2) => ({ ...ctx, s: s2, sim: true, draw() {}, refresh() {}, restored: null });

export function expire(s) {
  for (const p of s.board) if (p && p.fx) { for (const k in p.fx) if (!(p.fx[k] > s.ply)) { const fx = { ...p.fx }; delete fx[k]; p.fx = fx; } }
  s.walls = s.walls.filter(w => w.until > s.ply);
  for (const c of [W, B]) { const pf = s.pfx[c]; for (const k in pf) { const v = pf[k]; const u = typeof v === 'object' ? v.until : v; if (!(u > s.ply)) delete pf[k]; } }
  if (s.sight && !(s.sight.until > s.ply)) s.sight = null;
}

// ---------- bonus moves ----------
export function bonusMoves(s, c = s.turn) {
  const b = s.bonus; if (!b) return [];
  const fwd = c === W ? 8 : -8;
  return legalMoves(s, c).filter(m => {
    const p = s.board[m.from];
    if (m.castle) return false;
    if (b.ids && !b.ids.includes(p.id)) return false;
    if (b.notId != null && p.id === b.notId) return false;
    if (b.king && p.t !== 'k') return false;
    if (b.toSq != null && m.to !== b.toSq) return false;
    if (b.fwdOne && (m.to - m.from !== fwd || m.cap || m.bounce)) return false;
    if (b.noCapture && (m.cap || m.bounce)) return false;
    if (b.noCheck || b.then === 'pre') {
      const a = applyMove(s, m);
      if (b.noCheck && inCheck(a, opp(c))) return false;
      if (b.then === 'pre' && !hasLegalMove(a, c)) return false;
    }
    return true;
  });
}

// ---------- card availability, options and validation ----------
export function cardLimit(s, c) { const e = s.pfx[c].extra; return (s.cardsPerTurn || 1) + (e && e.until > s.ply ? e.n : 0); }

function phaseAllows(G, color, def) {
  const s = G.s;
  if (s.phase === 'over') return 'Round over';
  if (def.timing === 'reactive') {
    const pd = s.pending;
    if (s.phase !== 'react' || !pd || pd.color !== color || pd.type !== def.trigger) return 'Reaction: ' + ({ mate: 'when you would be checkmated', captured: 'when your piece is captured', cardPlayed: 'when your opponent plays a card' })[def.trigger];
    return true;
  }
  if (s.turn !== color) return 'Not your turn';
  if (def.timing === 'after') return s.phase === 'post' ? true : 'Play after your move';
  return s.phase === 'pre' ? true : (s.phase === 'post' ? 'You have already moved' : 'Finish the current action first');
}

export function cardStatus(G, color, inst, quick = false) {
  const s = G.s, def = byId(inst.id);
  if (inst.left <= 0) return { ok: false, why: 'Spent' };
  if (inst.cdUntil > s.ply) return { ok: false, why: `Cooldown: ${Math.ceil((inst.cdUntil - s.ply) / 2)} turn(s)` };
  if ((s.pfx[color].silenced || 0) > s.ply) return { ok: false, why: 'Silenced this turn' };
  const ph = phaseAllows(G, color, def); if (ph !== true) return { ok: false, why: ph };
  if (def.timing !== 'reactive' && !def.free && s.cardsPlayed >= cardLimit(s, color)) return { ok: false, why: 'Card limit reached this turn' };
  const ctx = makeCtx(G, color, { event: s.pending && s.pending.event, inst });
  if (def.can) { const r = def.can(ctx); if (r !== true) return { ok: false, why: r || 'Not possible now' }; }
  if (quick) return { ok: true };
  if (!hasCompletion(ctx, def, [])) return { ok: false, why: 'No legal target right now' };
  return { ok: true };
}

const stepOpts = (ctx, def, picks) => (def.steps[picks.length].opts(ctx, picks) || []);
const optVal = o => (typeof o === 'object' ? o.v : o);

function hasCompletion(ctx, def, picks) {
  if (picks.length === def.steps.length) return simulate(ctx, def, picks).ok;
  for (const o of stepOpts(ctx, def, picks)) if (hasCompletion(ctx, def, [...picks, optVal(o)])) return true;
  return false;
}

// Valid options for the next target step (only those that lead to a legal result)
export function cardOptions(G, color, inst, picks) {
  const def = byId(inst.id), ctx = makeCtx(G, color, { event: G.s.pending && G.s.pending.event, inst });
  return stepOpts(ctx, def, picks).filter(o => hasCompletion(ctx, def, [...picks, optVal(o)]));
}

export function simulate(ctx, def, picks) {
  const before = ctx.s, s2 = cloneS(before), c2 = simCtx(ctx, s2);
  const r = def.apply(c2, picks);
  if (r === false) return { ok: false };
  if (c2.restored) postRestore(s2, c2.restored, def.id);
  fixCastle(s2); fixEp(s2);
  if (def.timing === 'move') s2.ep = -1;
  return { ok: validAfter(ctx, def, before, s2), s: s2 };
}

function validAfter(ctx, def, before, s2) {
  const { me, foe } = ctx;
  if (def.timing === 'reactive') {
    if (def.trigger === 'mate') return validPosition(s2, foe);
    if (def.trigger === 'captured') return validPosition(s2, me);
    return true;
  }
  if (def.timing === 'move') return validPosition(s2, foe) && !(def.noCheck && inCheck(s2, foe));
  if (def.timing === 'after') return s2.bonus ? bonusMoves(s2, me).length > 0 : validPosition(s2, foe);
  // action / arm: your turn continues
  if (!validPosition(s2, me)) return false; // may not give check, structure must be legal
  if (inCheck(s2, me) && !inCheck(before, me)) return false; // may not expose your own king
  if (s2.bonus) return bonusMoves(s2, me).length > 0;
  return hasLegalMove(s2, me);
}

function postRestore(s, snap, id) {
  s.keys = s.keys.slice(0, snap.keysLen);
  if (id === 'time_fracture') s.keys.push(posKey(s));
  s.turnMoves = []; s.events = [];
  expire(s);
}

// ---------- hand ----------
let uidN = 1;
export function makeInst(id, extra = {}) { const d = byId(id); return { uid: 'c' + (uidN++) + Math.floor(Math.random() * 1e6).toString(36), id, name: d.name, rarity: d.rarity, left: d.uses, cdUntil: 0, ...extra }; }

export function drawCard(G, color, f = {}) {
  let id = f.id;
  if (!id) {
    const pool = G.pool.filter(x => (!f.rarity || f.rarity.includes(byId(x).rarity)) && byId(x).id !== 'supply_drop');
    if (!pool.length) return null;
    id = pool[Math.floor(rand(G) * pool.length)];
  }
  const inst = makeInst(id, { left: 1, temp: true });
  G.hands[color].push(inst);
  fx(G, { type: 'draw', color, id });
  log(G, color, `drew ${inst.name}`, 'draw');
  return inst;
}
function refreshCard(G, color, uid) {
  const inst = G.hands[color].find(h => h.uid === uid); if (!inst) return;
  const d = byId(inst.id); inst.left = Math.min(d.uses, inst.left + 1); inst.cdUntil = 0;
  if (inst.deckRef) inst.deckRef.usedMatch = Math.max(0, inst.deckRef.usedMatch - 1);
  log(G, color, `restored ${inst.name}`, 'draw');
}

export const log = (G, color, text, kind = 'info') => { G.log.push({ ply: G.s ? G.s.ply : 0, color, text, kind }); if (G.log.length > 300) G.log.shift(); };
export const fx = (G, e) => { (G.fxq || (G.fxq = [])).push(e); };

// ---------- playing cards ----------
export function playCard(G, color, uid, picks = []) {
  const s = G.s, inst = G.hands[color].find(h => h.uid === uid);
  if (!inst) return { ok: false, why: 'No such card' };
  const def = byId(inst.id);
  const st = cardStatus(G, color, inst, true); if (!st.ok) return st;
  const ctx = makeCtx(G, color, { event: s.pending && s.pending.event, inst });
  if (picks.length !== def.steps.length) return { ok: false, why: 'Targets missing' };
  for (let i = 0; i < picks.length; i++) if (!stepOpts(ctx, def, picks.slice(0, i)).some(o => optVal(o) === picks[i])) return { ok: false, why: 'Invalid target' };
  if (!simulate(ctx, def, picks).ok) return { ok: false, why: 'That would produce an illegal position' };
  // spend
  inst.left--; inst.cdUntil = s.ply + 2 * (def.cd + 1) - 1;
  if (def.per === 'match' && inst.deckRef) inst.deckRef.usedMatch++;
  if (def.timing !== 'reactive' && !def.free) s.cardsPlayed++;
  if (def.timing !== 'reactive') s.lastCard[color] = def.id;
  G.stats[color].cards++;
  fx(G, { type: 'card', color, id: def.id, picks });
  // counter window (priority 0)
  if (def.timing !== 'reactive' && hasReaction(G, opp(color), 'cardPlayed')) {
    s.pending = { type: 'cardPlayed', color: opp(color), play: { color, id: def.id, picks, uid }, resume: s.phase };
    s.phase = 'react';
    log(G, color, `plays ${def.name}…`, 'card');
    return { ok: true, pending: true };
  }
  resolveCard(G, color, def, picks, inst);
  return { ok: true };
}

function resolveCard(G, color, def, picks, inst) {
  const s = G.s;
  if (def.timing === 'move') s.lastTurn[color] = { snap: snapshot(s), kind: 'card', ply: s.ply, pure: false, cap: false };
  if (def.timing === 'after' && s.lastTurn[color] && s.lastTurn[color].ply === s.ply) s.lastTurn[color].pure = false;
  const before = posKey(s);
  const ctx = makeCtx(G, color, { event: s.pending && s.pending.event, inst });
  const text = def.apply(ctx, picks);
  if (ctx.restored) {
    postRestore(s, ctx.restored, def.id);
    if (def.id === 'time_fracture') s.lastTurn[opp(color)] = null;
    if (def.id === 'rewind') { s.lastTurn[color] = null; s.lastTurn[opp(color)] = null; }
  }
  fixCastle(s); fixEp(s);
  if (def.timing === 'move') s.ep = -1;
  if (posKey(s) !== before && !ctx.restored) s.half = 0;
  log(G, color, `${def.name}${text ? ': ' + text : ''}`, 'card');
  G.history.push({ ply: s.ply, color, kind: 'card', text: `◆ ${def.name}${text ? ' ' + text : ''}`, rarity: def.rarity });
  fx(G, { type: 'resolved', color, id: def.id, picks, vfx: def.vfx });
  if (def.timing === 'reactive') return;
  if (def.timing === 'move' || (def.timing === 'after' && !s.bonus)) return endTurn(G);
  if (s.bonus) { s.phase = 'bonus'; return; }
}

// Respond to a pending reaction window. uid = null means pass.
export function react(G, color, uid, picks = []) {
  const s = G.s, pd = s.pending;
  if (!pd || pd.color !== color) return { ok: false, why: 'Nothing to react to' };
  if (uid) {
    const r = playCard(G, color, uid, picks);
    if (!r.ok) return r;
  }
  if (pd.type === 'cardPlayed') {
    s.pending = null; s.phase = pd.resume;
    const def = byId(pd.play.id);
    if (uid) { log(G, color, `cancels ${def.name}`, 'card'); fx(G, { type: 'countered', color: pd.play.color, id: def.id }); G.history.push({ ply: s.ply, color: pd.play.color, kind: 'card', text: `◆ ${def.name} (cancelled)`, rarity: def.rarity }); return { ok: true }; }
    resolveCard(G, pd.play.color, def, pd.play.picks, G.hands[pd.play.color].find(h => h.uid === pd.play.uid));
    return { ok: true };
  }
  if (pd.type === 'mate') {
    s.pending = null;
    if (uid) { s.lastTurn[color] = { kind: 'card', ply: s.ply, pure: false, snap: snapshot(s) }; return finishTurn(G), { ok: true }; }
    endRound(G, opp(color), 'checkmate'); return { ok: true };
  }
  if (pd.type === 'captured') {
    if (uid && hasReaction(G, color, 'captured')) return { ok: true }; // may chain another reaction
    s.pending = null; finishTurn(G); return { ok: true };
  }
  return { ok: true };
}

export function hasReaction(G, color, trigger) {
  const s = G.s;
  if ((s.pfx[color].silenced || 0) > s.ply) return false;
  const saved = { phase: s.phase, pending: s.pending };
  const ev = trigger === 'captured' ? lastCapture(s, color) : null;
  s.phase = 'react'; s.pending = { type: trigger, color, event: ev };
  const ok = G.hands[color].some(h => byId(h.id).timing === 'reactive' && byId(h.id).trigger === trigger && cardStatus(G, color, h).ok);
  s.phase = saved.phase; s.pending = saved.pending;
  return ok;
}
const lastCapture = (s, victim) => { const e = (s.events || []).filter(x => x.type === 'captured' && x.victim === victim); return e[e.length - 1] || null; };

// ---------- moves ----------
export function currentMoves(G) {
  const s = G.s;
  if (s.phase === 'bonus') return bonusMoves(s);
  if (s.phase !== 'pre') return [];
  return legalMoves(s);
}

export function doMove(G, m) {
  const s = G.s, c = s.turn, p = s.board[m.from];
  const legal = currentMoves(G).find(x => x.from === m.from && x.to === m.to && (x.promo || null) === (m.promo || null));
  if (!legal) return { ok: false, why: 'Illegal move' };
  m = legal;
  const isBonus = s.phase === 'bonus';
  const after = applyMove(s, m);
  const sanStr = san(s, m, { ...after, ply: s.ply });
  if (!isBonus) s.lastTurn[c] = { snap: snapshot(s), kind: 'move', ply: s.ply, pure: true, cap: !!m.cap, san: sanStr };
  else if (s.lastTurn[c] && s.lastTurn[c].ply === s.ply) s.lastTurn[c].pure = false;
  const rec = { id: p.id, t: p.t, from: m.from, to: m.to, cap: !!m.cap, castle: m.castle || null, promo: m.promo || null, bonus: isBonus, bounce: !!m.bounce };
  if (m.bounce) {
    delFx(s, m.to, 'shield'); s.ep = -1; s.half++;
    log(G, c, `${sanStr}: the shield repels the capture`, 'shield');
    fx(G, { type: 'bounce', color: c, from: m.from, to: m.to });
  } else {
    const cap = after._captured;
    s.board = after.board; s.castle = after.castle; s.ep = after.ep;
    s.half = p.t === 'p' || cap ? 0 : s.half + 1;
    fx(G, { type: 'move', color: c, from: m.from, to: m.to, cap: !!cap, castle: m.castle, rookFrom: m.rookFrom, rookTo: m.rookTo, epc: m.epc, promo: m.promo });
    if (cap) {
      s.captured[cap.c].push({ t: cap.t, id: cap.id, home: cap.home, c: cap.c });
      s.events.push({ type: 'captured', victim: cap.c, piece: { t: cap.t, id: cap.id, home: cap.home }, byId: p.id, sq: m.to });
      G.stats[c].captures++;
      if (has(s, cap, 'bounty')) { log(G, c, `collects the bounty on the ${NAME[cap.t]}`, 'draw'); drawCard(G, c); }
      // Shockwave (priority 6), board order
      if ((s.pfx[c].shockwave || 0) > s.ply) {
        delete s.pfx[c].shockwave;
        let n = 0;
        for (const x of [...KT[m.to]].sort((a, b) => a - b)) {
          const q = s.board[x];
          if (!q || q.c === c || q.t !== 'p') continue;
          const t = cloneS(s); if (destroy(t, x) === true && !validPosition(t, opp(c))) continue;
          const r = destroy(s, x); if (r === true) { n++; fx(G, { type: 'destroy', sq: x }); }
        }
        log(G, c, `Shockwave destroys ${n} pawn${n === 1 ? '' : 's'}`, 'card');
      }
    }
    // Traps (priority 1 ward → 6 destruction)
    const tr = s.traps.find(t => t.sq === m.to && t.owner !== c);
    const moved = s.board[m.to];
    if (tr && moved && !has(s, moved, 'ward') && !((s.pfx[c].iron || 0) > s.ply)) {
      if (tr.kind === 'freeze') {
        addFx(s, m.to, 'frozen', s.ply + 5); s.traps = s.traps.filter(t => t !== tr);
        log(G, c, `${NAME[moved.t]} springs a Booby Trap and is frozen`, 'trap'); fx(G, { type: 'trap', sq: m.to, kind: 'freeze' });
      } else if (tr.kind === 'mine' && moved.t !== 'k') {
        const t = cloneS(s); const r0 = destroy(t, m.to);
        if (r0 !== true || validPosition(t, opp(c))) {
          const r = destroy(s, m.to); s.traps = s.traps.filter(t => t !== tr);
          log(G, c, r === true ? `${NAME[moved.t]} hits a Landmine and is destroyed` : `Landmine absorbed by ${r}`, 'trap'); fx(G, { type: 'trap', sq: m.to, kind: 'mine' });
        } else log(G, c, 'Landmine fizzles (destruction would be illegal)', 'trap');
      }
    }
  }
  s.turnMoves.push(rec);
  G.history.push({ ply: s.ply, color: c, kind: 'move', text: sanStr, bonus: isBonus });
  G.stats[c].moves++;
  // Double Threat
  if (!isBonus && p.t === 'n' && (s.pfx[c].doubleThreat || 0) > s.ply && findId(s, p.id) >= 0) {
    delete s.pfx[c].doubleThreat;
    s.bonus = { ids: [p.id], then: 'end', label: 'Double Threat: move the knight again' };
    if (bonusMoves(s).length) { s.phase = 'bonus'; log(G, c, 'Double Threat triggers', 'card'); fx(G, { type: 'trigger', color: c, id: 'double_threat' }); return { ok: true }; }
    s.bonus = null;
  }
  if (isBonus) {
    const then = s.bonus.then; s.bonus = null;
    if (then === 'pre') { s.phase = 'pre'; return { ok: true }; }
    endTurn(G); return { ok: true };
  }
  if (afterWindow(G, c)) s.phase = 'post'; else endTurn(G);
  return { ok: true };
}

function afterWindow(G, c) {
  const s = G.s; s.phase = 'post';
  const ok = G.hands[c].some(h => byId(h.id).timing === 'after' && cardStatus(G, c, h).ok);
  s.phase = 'pre';
  return ok;
}

export function skipBonus(G) { const s = G.s; if (s.phase !== 'bonus') return; const then = s.bonus.then; s.bonus = null; if (then === 'pre') s.phase = 'pre'; else endTurn(G); }
export function endPost(G) { if (G.s.phase === 'post') endTurn(G); }

export function endTurn(G) {
  const s = G.s; s.bonus = null; s.sight = null;
  const victim = opp(s.turn);
  if (lastCapture(s, victim) && hasReaction(G, victim, 'captured')) {
    s.pending = { type: 'captured', color: victim, event: lastCapture(s, victim) };
    s.phase = 'react';
    return;
  }
  finishTurn(G);
}

export function finishTurn(G) {
  const s = G.s;
  s.events = []; s.turnMoves = []; s.pending = null;
  if (s.turn === B) s.full++;
  s.turn = opp(s.turn); s.ply++;
  beginTurn(G);
}

export function beginTurn(G) {
  const s = G.s;
  expire(s);
  s.cardsPlayed = 0; s.phase = 'pre'; s.pending = null; s.bonus = null;
  s.keys.push(posKey(s));
  const k = s.keys[s.keys.length - 1];
  if (s.keys.filter(x => x === k).length >= 3) return endRound(G, null, 'threefold repetition');
  if (s.half >= 100) return endRound(G, null, '50-move rule');
  if (insufficient(s) && !cardsLeft(G)) return endRound(G, null, 'insufficient material');
  let any = hasLegalMove(s);
  if (!any && !inCheck(s, s.turn) && hasLegalMove(s, s.turn, false)) { s.noFx = s.ply; any = true; log(G, s.turn, 'Restriction break: card restrictions lift so a legal move exists', 'info'); fx(G, { type: 'break', color: s.turn }); }
  if (!any) {
    if (inCheck(s, s.turn)) {
      if (hasReaction(G, s.turn, 'mate')) { s.phase = 'react'; s.pending = { type: 'mate', color: s.turn }; fx(G, { type: 'mateThreat', color: s.turn }); return; }
      return endRound(G, opp(s.turn), 'checkmate');
    }
    return endRound(G, null, 'stalemate');
  }
  if (inCheck(s, s.turn)) fx(G, { type: 'check', color: s.turn, sq: kingSq(s, s.turn) });
  turnDraw(G);
}

// "Draw every turn": the player about to move draws a random card for this round.
// Weighted by the match's rarity weights. Spent drawn cards are cleared; at the hand cap the oldest drawn card is discarded.
export function turnDraw(G) {
  const st = G.settings || {};
  if (!st.drawEachTurn || !G.pool || !G.pool.length) return null;
  const c = G.s.turn, hand = G.hands[c];
  for (let i = hand.length - 1; i >= 0; i--) if (hand[i].temp && hand[i].left <= 0) hand.splice(i, 1);
  const temps = hand.filter(h => h.temp), cap = st.handCap || 5;
  if (temps.length >= cap) hand.splice(hand.indexOf(temps[0]), 1);
  const w = st.weights || {}, pool = G.pool.filter(id => byId(id).id !== 'supply_drop');
  const ws = pool.map(id => w[byId(id).rarity] ?? 1), tot = ws.reduce((a, b) => a + b, 0);
  if (!tot) return null;
  let r = rand(G) * tot, id = pool[pool.length - 1];
  for (let i = 0; i < pool.length; i++) { r -= ws[i]; if (r <= 0) { id = pool[i]; break; } }
  const inst = makeInst(id, { left: 1, temp: true, fresh: G.s.ply });
  hand.push(inst);
  fx(G, { type: 'draw', color: c, id, turn: true });
  log(G, c, `draws ${inst.name}`, 'draw');
  return inst;
}
// With unspent cards a lone minor piece can still matter, so the automatic draw waits until both hands are spent.
function cardsLeft(G) { return [W, B].some(c => G.hands[c].some(h => h.left > 0 && !h.temp)); }

export function endRound(G, winner, reason) {
  const s = G.s;
  s.phase = 'over'; s.pending = null; s.result = { winner, reason };
  fx(G, { type: 'roundOver', winner, reason });
  if (G.onRoundEnd) G.onRoundEnd(G, winner, reason);
}

export function resign(G, color) { if (G.s.phase !== 'over') endRound(G, opp(color), 'resignation'); }
export function agreeDraw(G) { if (G.s.phase !== 'over') endRound(G, null, 'agreement'); }
export function flag(G, color) { if (G.s.phase === 'over') return; const s = G.s; const other = opp(color); const onlyKingOrMinor = (() => { const ps = s.board.filter(p => p && p.c === other && p.t !== 'k'); return ps.length === 0 || (ps.length === 1 && 'nb'.includes(ps[0].t)); })(); endRound(G, onlyKingOrMinor ? null : other, onlyKingOrMinor ? 'timeout vs insufficient material' : 'timeout'); }

export { FOREVER };
