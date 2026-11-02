// Board mutation helpers shared by card effects. All of them keep castling rights and
// en passant consistent; legality of the end result is checked centrally by the resolver.
import { W, B, opp, F, R, off, has, wallAt, KT, attacked, pieceAttacks } from '../engine/chess.js';

export const fwd = c => (c === W ? 1 : -1);
export const backRank = c => (c === W ? 0 : 7);
export const pawnRank = c => (c === W ? 1 : 6);
export const lastRank = c => (c === W ? 7 : 0);
export const relRank = (c, sq) => (c === W ? R(sq) : 7 - R(sq)); // 0 = own back rank
export const FOREVER = 1e9;
export const T = { turn: s => s.ply + 1, myNext: s => s.ply + 2, theirTwo: s => s.ply + 4, threeMine: s => s.ply + 6, round: () => FOREVER };

export function squares(s, pred) { const o = []; for (let i = 0; i < 64; i++) if (pred(s.board[i], i)) o.push(i); return o; }
export const trapAt = (s, sq) => s.traps.find(t => t.sq === sq);
export const isEmpty = (s, sq) => sq >= 0 && !s.board[sq] && !wallAt(s, sq) && !trapAt(s, sq);

// Enemy pieces protected by Ward / Iron Will cannot be chosen by the opponent's cards.
export function targetable(ctx, sq) {
  const p = ctx.s.board[sq];
  if (!p || p.c !== ctx.foe) return true;
  return !(has(ctx.s, p, 'ward') || (ctx.s.pfx[ctx.foe].iron || 0) > ctx.s.ply);
}
export const own = (ctx, types, pred) => squares(ctx.s, (p, i) => p && p.c === ctx.me && (!types || types.includes(p.t)) && (!pred || pred(p, i)));
export const enemy = (ctx, types, pred) => squares(ctx.s, (p, i) => p && p.c === ctx.foe && (!types || types.includes(p.t)) && targetable(ctx, i) && (!pred || pred(p, i)));
export const empties = ctx => squares(ctx.s, (p, i) => isEmpty(ctx.s, i));
export const threatened = (ctx, sq) => attacked(ctx.s, sq, ctx.foe);
export const adjOf = sq => KT[sq];
export const orthAdj = sq => [off(sq, 1, 0), off(sq, -1, 0), off(sq, 0, 1), off(sq, 0, -1)].filter(x => x >= 0);
export const diagAdj = sq => [off(sq, 1, 1), off(sq, -1, 1), off(sq, 1, -1), off(sq, -1, -1)].filter(x => x >= 0);

const CORNER = { 0: 'Q', 7: 'K', 56: 'q', 63: 'k' };
export function stripCastle(s, sq, p) {
  if (p && p.t === 'k') s.castle = s.castle.replace(p.c === W ? /[KQ]/g : /[kq]/g, '');
  if (CORNER[sq]) s.castle = s.castle.replace(CORNER[sq], '');
}
export function fixCastle(s) {
  const ok = (k, r, c) => { const K = s.board[k], Rk = s.board[r]; return K && K.t === 'k' && K.c === c && Rk && Rk.t === 'r' && Rk.c === c; };
  let out = '';
  for (const ch of s.castle) if ((ch === 'K' && ok(4, 7, W)) || (ch === 'Q' && ok(4, 0, W)) || (ch === 'k' && ok(60, 63, B)) || (ch === 'q' && ok(60, 56, B))) out += ch;
  s.castle = out;
}
export function relocate(s, from, to) {
  const p = s.board[from];
  s.board[to] = p; s.board[from] = null;
  stripCastle(s, from, p); stripCastle(s, to, null);
}
export function swap(s, a, b) {
  const pa = s.board[a], pb = s.board[b];
  s.board[a] = pb; s.board[b] = pa;
  stripCastle(s, a, pa); stripCastle(s, b, pb);
}
export function addFx(s, sq, key, until) { const p = s.board[sq]; p.fx = { ...p.fx, [key]: Math.max(until, p.fx[key] || 0) }; }
export function delFx(s, sq, ...keys) { const p = s.board[sq]; if (!p) return; const fx = { ...p.fx }; keys.forEach(k => delete fx[k]); p.fx = fx; }
export function transform(s, sq, t) { const p = s.board[sq]; s.board[sq] = { ...p, t, fx: { ...p.fx } }; }
export function place(s, sq, piece) { s.board[sq] = { ...piece, fx: {} }; }
// En passant stays available after a card only if the double-pushed pawn is still where it landed.
export function fixEp(s) {
  if (s.ep < 0) return;
  const white = R(s.ep) === 2, pawnSq = s.ep + (white ? 8 : -8), p = s.board[pawnSq];
  if (s.board[s.ep] || !p || p.t !== 'p' || p.c !== (white ? W : B)) s.ep = -1;
}
export function newId(s) { return s.nextId++; }

// Destruction resolves protections in a fixed order: immunity, then shield. Kings are never removed.
export function destroy(s, sq) {
  const p = s.board[sq];
  if (!p || p.t === 'k') return false;
  if (has(s, p, 'immune')) return 'immune';
  if (has(s, p, 'shield')) { delFx(s, sq, 'shield'); return 'shield'; }
  s.board[sq] = null;
  s.captured[p.c].push({ t: p.t, id: p.id, home: p.home, c: p.c });
  stripCastle(s, sq, null);
  return true;
}

export function cloneS(s) {
  return {
    ...s,
    board: s.board.map(p => (p ? { ...p, fx: { ...p.fx } } : null)),
    walls: s.walls.map(w => ({ ...w })), traps: s.traps.map(t => ({ ...t })),
    pfx: { w: { ...s.pfx.w }, b: { ...s.pfx.b } },
    captured: { w: s.captured.w.map(x => ({ ...x })), b: s.captured.b.map(x => ({ ...x })) },
    events: (s.events || []).map(e => ({ ...e })), turnMoves: (s.turnMoves || []).map(m => ({ ...m })),
    bonus: s.bonus ? { ...s.bonus } : null,
  };
}

// Snapshot of the full board state (for Time Fracture / Rewind)
export function snapshot(s) {
  const c = cloneS(s);
  return { board: c.board, castle: s.castle, ep: s.ep, half: s.half, full: s.full, walls: c.walls, traps: c.traps, pfx: c.pfx, captured: c.captured, keysLen: s.keys.length, ply: s.ply };
}
export function restore(s, snap) {
  const c = cloneS({ ...s, ...snap });
  Object.assign(s, { board: c.board, castle: snap.castle, ep: snap.ep, half: snap.half, full: snap.full, walls: c.walls, traps: c.traps, pfx: c.pfx, captured: c.captured });
}

export function findId(s, id) { for (let i = 0; i < 64; i++) if (s.board[i] && s.board[i].id === id) return i; return -1; }
export { W, B, opp, F, R, off, has, wallAt, attacked, pieceAttacks };
