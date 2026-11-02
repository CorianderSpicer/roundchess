// The card library: 105 cards, every one of which changes the game state when played.
// Each card declares: id, name, rarity, text (what it does), timing (activation type),
// steps (target requirements, as option generators), apply (the effect), dur (duration),
// uses / per (round or match), cd (cooldown in your own turns), restrict (restrictions),
// vfx (visual effect), tags (for draft synergies).
//
// timing:
//   action   Immediate, played before your move. Your turn continues. May not give check.
//   arm      Before-move modifier for an upcoming move (it changes what your move can do).
//   move     Replaces your move (ends your turn).
//   after    Played after your move, in the after-move window.
//   reactive Played during the opponent's turn when its trigger happens.
// Legality of every result is enforced centrally in resolver.js, so a card can never
// produce an illegal position.
import { NT, KT, DIAG, ORTH, NAME, kingSq, pseudoMoves, legalMovesFrom, inCheck } from '../engine/chess.js';
import {
  W, B, F, R, off, has, fwd, backRank, pawnRank, lastRank, relRank, T, FOREVER, own, enemy, empties, isEmpty, threatened,
  orthAdj, diagAdj, relocate, swap, addFx, delFx, transform, place, destroy, restore, findId, pieceAttacks, targetable, squares,
} from './util.js';

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
export const RARITY_LABEL = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
export const DEFAULT_WEIGHTS = { common: 46, uncommon: 28, rare: 15, epic: 8, legendary: 3 };
export const TIMING_LABEL = { action: 'Immediate', arm: 'Before move', move: 'Replaces your move', after: 'After your move', reactive: 'Reactive' };

const sq = (prompt, opts) => ({ kind: 'square', prompt, opts });
const ch = (prompt, opts) => ({ kind: 'choice', prompt, opts });
const D = { instant: 'Instant', turn: 'This turn', next: 'Until your next turn', two: "For the opponent's next two turns", round: 'This round', used: 'Until used (this round)', perm: 'Permanent' };
const lastMove = ctx => { const t = ctx.s.turnMoves || []; return t.length ? t[t.length - 1] : null; };
const fwdSq = (c, x, n = 1) => off(x, 0, fwd(c) * n);
const notLast = (c, x) => R(x) !== lastRank(c) && R(x) !== backRank(c);
const HOMES = { n: [1, 6], b: [2, 5], r: [0, 7], q: [3] };
const homeSquares = (c, t) => (HOMES[t] || []).map(f => (c === W ? f : 56 + f));
const isNeg = k => ['frozen', 'noCapture', 'bounty'].includes(k);
const usedCards = (ctx, pred) => (ctx.hand || []).filter(h => h.left <= 0 && pred(h)).map(h => ({ v: h.uid, label: h.name }));

const C = []; const add = o => C.push(o);

// ═══════════════════ COMMON ═══════════════════
const common = o => add({ rarity: 'common', uses: 2, per: 'round', cd: 0, ...o });

common({ id: 'pawn_rally', name: 'Pawn Rally', timing: 'action', dur: D.instant, vfx: 'dash', tags: ['pawn', 'tempo'],
  text: 'Select one of your pawns. It immediately moves one square forward if that square is empty.', restrict: 'Cannot reach the last rank. The result must be legal.',
  steps: [sq('Choose a pawn', ctx => own(ctx, ['p'], (p, i) => isEmpty(ctx.s, fwdSq(ctx.me, i)) && notLast(ctx.me, fwdSq(ctx.me, i))))],
  apply(ctx, [a]) { relocate(ctx.s, a, fwdSq(ctx.me, a)); return `${ctx.n(a, fwdSq(ctx.me, a))}`; } });

common({ id: 'pawn_sacrifice', name: 'Pawn Sacrifice', timing: 'action', dur: D.instant, vfx: 'burst', tags: ['pawn', 'draw'],
  text: 'Sacrifice one of your pawns to draw a replacement card for this round.', restrict: 'Not if removing the pawn exposes your king.',
  steps: [sq('Choose a pawn to sacrifice', ctx => own(ctx, ['p']))],
  apply(ctx, [a]) { const p = ctx.s.board[a]; ctx.s.board[a] = null; ctx.s.captured[ctx.me].push({ t: 'p', id: p.id, home: p.home, c: p.c }); ctx.draw(); return ctx.n(a); } });

common({ id: 'quick_retreat', name: 'Quick Retreat', timing: 'action', dur: D.instant, vfx: 'dash', tags: ['defense', 'tempo'],
  text: 'Move one threatened non-king piece to another square it could legally move to. Your turn continues.', restrict: 'The piece must be attacked. The retreat cannot capture, promote or give check.',
  steps: [sq('Choose a threatened piece', ctx => own(ctx, ['p', 'n', 'b', 'r', 'q'], (p, i) => threatened(ctx, i))),
    sq('Choose where it retreats', (ctx, [a]) => legalMovesFrom(ctx.s, a).filter(m => !m.cap && !m.bounce && !m.promo && !m.castle).map(m => m.to))],
  apply(ctx, [a, b]) { relocate(ctx.s, a, b); return ctx.n(a, b); } });

common({ id: 'sidestep', name: 'Sidestep', timing: 'action', dur: D.instant, vfx: 'dash', tags: ['pawn'],
  text: 'Move one of your pawns one square sideways to an empty square.', restrict: 'Result must be legal and must not give check.',
  steps: [sq('Choose a pawn', ctx => own(ctx, ['p'], (p, i) => [off(i, 1, 0), off(i, -1, 0)].some(x => isEmpty(ctx.s, x)))),
    sq('Choose a side', (ctx, [a]) => [off(a, 1, 0), off(a, -1, 0)].filter(x => isEmpty(ctx.s, x)))],
  apply(ctx, [a, b]) { relocate(ctx.s, a, b); return ctx.n(a, b); } });

common({ id: 'double_time', name: 'Double Time', timing: 'action', dur: D.instant, vfx: 'dash', tags: ['pawn', 'tempo'],
  text: 'One of your pawns advances two squares, even if it has already moved.', restrict: 'Both squares must be empty. Cannot reach the last rank. No en passant is created.',
  steps: [sq('Choose a pawn', ctx => own(ctx, ['p'], (p, i) => isEmpty(ctx.s, fwdSq(ctx.me, i)) && isEmpty(ctx.s, fwdSq(ctx.me, i, 2)) && notLast(ctx.me, fwdSq(ctx.me, i, 2))))],
  apply(ctx, [a]) { relocate(ctx.s, a, fwdSq(ctx.me, a, 2)); return ctx.n(a, fwdSq(ctx.me, a, 2)); } });

common({ id: 'fall_back', name: 'Fall Back', timing: 'action', dur: D.instant, vfx: 'dash', tags: ['pawn', 'defense'],
  text: 'One of your pawns steps one square backward to an empty square.', restrict: 'Cannot step onto your back rank.',
  steps: [sq('Choose a pawn', ctx => own(ctx, ['p'], (p, i) => { const x = fwdSq(ctx.me, i, -1); return isEmpty(ctx.s, x) && R(x) !== backRank(ctx.me); }))],
  apply(ctx, [a]) { const b = fwdSq(ctx.me, a, -1); relocate(ctx.s, a, b); return ctx.n(a, b); } });

common({ id: 'pawn_vault', name: 'Pawn Vault', timing: 'action', dur: D.instant, vfx: 'leap', tags: ['pawn', 'knight'],
  text: "One of your pawns jumps like a knight to an empty square.", restrict: 'Cannot land on either back rank. Cannot capture.',
  steps: [sq('Choose a pawn', ctx => own(ctx, ['p'], (p, i) => NT[i].some(x => isEmpty(ctx.s, x) && notLast(ctx.me, x)))),
    sq('Choose the landing square', (ctx, [a]) => NT[a].filter(x => isEmpty(ctx.s, x) && notLast(ctx.me, x)))],
  apply(ctx, [a, b]) { relocate(ctx.s, a, b); return ctx.n(a, b); } });

common({ id: 'trot', name: 'Trot', timing: 'action', dur: D.instant, vfx: 'dash', tags: ['knight'],
  text: 'One of your knights steps one square orthogonally to an empty square.', restrict: 'Cannot capture or give check.',
  steps: [sq('Choose a knight', ctx => own(ctx, ['n'], (p, i) => orthAdj(i).some(x => isEmpty(ctx.s, x)))), sq('Choose a square', (ctx, [a]) => orthAdj(a).filter(x => isEmpty(ctx.s, x)))],
  apply(ctx, [a, b]) { relocate(ctx.s, a, b); return ctx.n(a, b); } });

common({ id: 'color_shift', name: 'Color Shift', timing: 'action', dur: D.instant, vfx: 'dash', tags: ['bishop'],
  text: 'One of your bishops steps one square orthogonally, switching square colour.', restrict: 'Empty square only. Cannot give check.',
  steps: [sq('Choose a bishop', ctx => own(ctx, ['b'], (p, i) => orthAdj(i).some(x => isEmpty(ctx.s, x)))), sq('Choose a square', (ctx, [a]) => orthAdj(a).filter(x => isEmpty(ctx.s, x)))],
  apply(ctx, [a, b]) { relocate(ctx.s, a, b); return ctx.n(a, b); } });

common({ id: 'rook_roll', name: 'Rook Roll', timing: 'action', dur: D.instant, vfx: 'dash', tags: ['rook'],
  text: 'One of your rooks steps one square diagonally to an empty square.', restrict: 'Cannot give check. Moving a rook loses its castling right.',
  steps: [sq('Choose a rook', ctx => own(ctx, ['r'], (p, i) => diagAdj(i).some(x => isEmpty(ctx.s, x)))), sq('Choose a square', (ctx, [a]) => diagAdj(a).filter(x => isEmpty(ctx.s, x)))],
  apply(ctx, [a, b]) { relocate(ctx.s, a, b); return ctx.n(a, b); } });

common({ id: 'shuffle', name: 'Shuffle', timing: 'action', dur: D.instant, vfx: 'swap', tags: ['tempo'],
  text: 'Swap two of your adjacent non-king pieces.', restrict: 'A pawn cannot end on a back rank. Cannot give check.',
  steps: [sq('Choose the first piece', ctx => own(ctx, ['p', 'n', 'b', 'r', 'q'], (p, i) => KT[i].some(x => ctx.s.board[x] && ctx.s.board[x].c === ctx.me && ctx.s.board[x].t !== 'k' && ctx.s.board[x].t !== p.t))),
    sq('Choose an adjacent piece', (ctx, [a]) => KT[a].filter(x => ctx.s.board[x] && ctx.s.board[x].c === ctx.me && ctx.s.board[x].t !== 'k' && ctx.s.board[x].t !== ctx.s.board[a].t))],
  apply(ctx, [a, b]) { swap(ctx.s, a, b); return ctx.n(a, b, '⇄'); } });

common({ id: 'pawn_swap', name: 'Pawn Swap', timing: 'action', dur: D.instant, vfx: 'swap', tags: ['pawn'],
  text: 'Swap the positions of any two of your pawns on different files.', restrict: 'Cannot give check.',
  steps: [sq('Choose a pawn', ctx => own(ctx, ['p'])), sq('Choose another pawn', (ctx, [a]) => own(ctx, ['p'], (p, i) => F(i) !== F(a)))],
  apply(ctx, [a, b]) { swap(ctx.s, a, b); return ctx.n(a, b, '⇄'); } });

common({ id: 'recall', name: 'Recall', timing: 'action', dur: D.instant, vfx: 'teleport', tags: ['defense', 'tempo'],
  text: 'Return one knight, bishop, rook or queen to an empty starting square of its type.', restrict: 'Bishops keep their square colour. Cannot give check. Castling rights are not restored.',
  steps: [sq('Choose a piece', ctx => own(ctx, ['n', 'b', 'r', 'q'], (p, i) => recallTargets(ctx, i).length > 0)), sq('Choose its starting square', (ctx, [a]) => recallTargets(ctx, a))],
  apply(ctx, [a, b]) { relocate(ctx.s, a, b); return ctx.n(a, b); } });
function recallTargets(ctx, a) { const p = ctx.s.board[a]; return homeSquares(ctx.me, p.t).filter(x => x !== a && isEmpty(ctx.s, x) && (p.t !== 'b' || ((F(x) + R(x)) & 1) === ((F(a) + R(a)) & 1))); }

common({ id: 'hold_the_line', name: 'Hold the Line', timing: 'action', dur: D.next, vfx: 'immune', tags: ['pawn', 'defense'],
  text: 'One of your pawns cannot be captured or destroyed until your next turn.', restrict: 'Pawns only.',
  steps: [sq('Choose a pawn', ctx => own(ctx, ['p'], p => !has(ctx.s, p, 'immune')))],
  apply(ctx, [a]) { addFx(ctx.s, a, 'immune', T.myNext(ctx.s)); return ctx.n(a); } });

common({ id: 'brace', name: 'Brace', timing: 'action', dur: 'Until used or three of your turns', vfx: 'shield', tags: ['pawn', 'defense', 'shield'],
  text: 'One of your pawns gains a shield. The next capture against it is repelled: the attacker bounces back and the shield breaks.', restrict: 'Pawns only.',
  steps: [sq('Choose a pawn', ctx => own(ctx, ['p'], p => !has(ctx.s, p, 'shield')))],
  apply(ctx, [a]) { addFx(ctx.s, a, 'shield', T.threeMine(ctx.s)); return ctx.n(a); } });

common({ id: 'frostbite', name: 'Frostbite', timing: 'action', dur: D.next, vfx: 'freeze', tags: ['freeze', 'pawn'],
  text: 'Freeze one enemy pawn: it cannot move during your opponent\'s next turn.', restrict: 'If freezes would leave a player with no legal move, all restrictions break for that turn.',
  steps: [sq('Choose an enemy pawn', ctx => enemy(ctx, ['p'], p => !has(ctx.s, p, 'frozen')))],
  apply(ctx, [a]) { addFx(ctx.s, a, 'frozen', T.myNext(ctx.s)); return ctx.n(a); } });

common({ id: 'caltrops', name: 'Caltrops', timing: 'action', dur: D.next, vfx: 'wall', tags: ['wall', 'control'],
  text: 'Place a barrier on an empty square. No piece can move onto or through it until your next turn.', restrict: 'Barriers never block check: kings stay just as safe as without them.',
  steps: [sq('Choose an empty square', ctx => empties(ctx))],
  apply(ctx, [a]) { ctx.s.walls.push({ sq: a, until: T.myNext(ctx.s), owner: ctx.me }); return ctx.n(a); } });

common({ id: 'pinned_down', name: 'Pinned Down', timing: 'action', dur: D.next, vfx: 'freeze', tags: ['freeze', 'pawn'],
  text: 'Freeze one enemy non-king, non-queen piece that one of your pawns attacks.', restrict: 'Target must be attacked by your pawn.',
  steps: [sq('Choose an enemy piece your pawn attacks', ctx => enemy(ctx, ['p', 'n', 'b', 'r'], (p, i) => !has(ctx.s, p, 'frozen') && own(ctx, ['p']).some(x => pieceAttacks(ctx.s, x, i))))],
  apply(ctx, [a]) { addFx(ctx.s, a, 'frozen', T.myNext(ctx.s)); return ctx.n(a); } });

common({ id: 'bounty', name: 'Bounty', timing: 'action', dur: D.round, vfx: 'mark', tags: ['draw', 'attack'],
  text: 'Mark an enemy non-king piece. If you capture it this round, you draw a card.', restrict: 'One mark per piece.',
  steps: [sq('Choose an enemy piece', ctx => enemy(ctx, ['p', 'n', 'b', 'r', 'q'], p => !has(ctx.s, p, 'bounty')))],
  apply(ctx, [a]) { addFx(ctx.s, a, 'bounty', FOREVER); return ctx.n(a); } });

common({ id: 'late_castle', name: 'Late Castle', timing: 'action', dur: D.round, vfx: 'castle', tags: ['king', 'defense'], uses: 1,
  text: 'Restore your castling rights for every rook still on its starting square, if your king is on its starting square.', restrict: 'All normal castling rules still apply when you castle.',
  can(ctx) { return restorable(ctx).length ? true : 'King and rook must be on their starting squares'; }, steps: [],
  apply(ctx) { for (const r of restorable(ctx)) ctx.s.castle += r; return 'castling restored'; } });
function restorable(ctx) {
  const s = ctx.s, c = ctx.me, k = c === W ? 4 : 60, K = s.board[k];
  if (!K || K.t !== 'k' || K.c !== c) return [];
  return [[c === W ? 'K' : 'k', k + 3], [c === W ? 'Q' : 'q', k - 4]].filter(([r, x]) => !s.castle.includes(r) && s.board[x] && s.board[x].t === 'r' && s.board[x].c === c).map(([r]) => r);
}

common({ id: 'thaw', name: 'Thaw', timing: 'action', dur: D.instant, vfx: 'cleanse', tags: ['defense'],
  text: 'Remove every freeze, disarm and bounty mark from your pieces.', restrict: 'Only when one of your pieces has such an effect.',
  can(ctx) { return own(ctx, null, p => Object.keys(p.fx).some(k => isNeg(k) && has(ctx.s, p, k))).length ? true : 'None of your pieces is affected'; }, steps: [],
  apply(ctx) { for (const x of own(ctx)) delFx(ctx.s, x, 'frozen', 'noCapture', 'bounty'); return 'effects removed'; } });

common({ id: 'shove', name: 'Shove', timing: 'action', dur: D.instant, vfx: 'push', tags: ['pawn', 'control'],
  text: 'Push an enemy pawn next to one of your pieces one square back toward its own side.', restrict: 'The square behind must be empty and not its back rank.',
  steps: [sq('Choose an enemy pawn next to your piece', ctx => enemy(ctx, ['p'], (p, i) => KT[i].some(x => ctx.s.board[x] && ctx.s.board[x].c === ctx.me) && shoveTo(ctx, i) >= 0))],
  apply(ctx, [a]) { const b = shoveTo(ctx, a); relocate(ctx.s, a, b); return ctx.n(a, b); } });
function shoveTo(ctx, a) { const b = fwdSq(ctx.foe, a, -1); return b >= 0 && isEmpty(ctx.s, b) && R(b) !== backRank(ctx.foe) ? b : -1; }

common({ id: 'supply_drop', name: 'Supply Drop', timing: 'action', dur: D.instant, vfx: 'draw', tags: ['draw'], uses: 1,
  text: 'Draw a random Common card for this round.', restrict: 'The drawn card lasts this round only.', steps: [],
  apply(ctx) { ctx.draw({ rarity: ['common'] }); return 'drew a card'; } });

common({ id: 'guard_post', name: 'Guard Post', timing: 'action', dur: D.next, vfx: 'immune', tags: ['defense', 'knight', 'bishop'],
  text: 'One of your knights or bishops cannot be captured or destroyed until your next turn.', restrict: 'Knights and bishops only.',
  steps: [sq('Choose a knight or bishop', ctx => own(ctx, ['n', 'b'], p => !has(ctx.s, p, 'immune')))],
  apply(ctx, [a]) { addFx(ctx.s, a, 'immune', T.myNext(ctx.s)); return ctx.n(a); } });

common({ id: 'slant_step', name: 'Slant Step', timing: 'arm', dur: 'Your move this turn (its threat lasts until your next turn)', vfx: 'empower', tags: ['pawn'],
  text: 'This turn, one of your pawns may also move one square diagonally forward onto an empty square.', restrict: 'Not onto the last rank.',
  steps: [sq('Choose a pawn', ctx => own(ctx, ['p'], (p, i) => [off(i, 1, fwd(ctx.me)), off(i, -1, fwd(ctx.me))].some(x => isEmpty(ctx.s, x) && notLast(ctx.me, x))))],
  apply(ctx, [a]) { addFx(ctx.s, a, 'pawnDiag', T.myNext(ctx.s)); return ctx.n(a); } });

common({ id: 'lunge', name: 'Lunge', timing: 'arm', dur: 'Your move this turn (its threat lasts until your next turn)', vfx: 'empower', tags: ['pawn', 'attack'],
  text: 'This turn, one of your pawns may capture the enemy piece directly in front of it.', restrict: 'Cannot capture a king (so it cannot be used to give check).',
  steps: [sq('Choose a pawn', ctx => own(ctx, ['p'], (p, i) => { const x = fwdSq(ctx.me, i); const q = x >= 0 && ctx.s.board[x]; return q && q.c === ctx.foe && q.t !== 'k'; }))],
  apply(ctx, [a]) { addFx(ctx.s, a, 'pawnFwdCap', T.myNext(ctx.s)); return ctx.n(a); } });

common({ id: 'rally_point', name: 'Rally Point', timing: 'action', dur: D.next, vfx: 'immune', tags: ['pawn', 'defense', 'king'],
  text: 'Every pawn of yours next to your king cannot be captured or destroyed until your next turn.', restrict: 'Needs at least one pawn next to your king.',
  can(ctx) { return rallyPawns(ctx).length ? true : 'No pawn next to your king'; }, steps: [],
  apply(ctx) { const ps = rallyPawns(ctx); ps.forEach(x => addFx(ctx.s, x, 'immune', T.myNext(ctx.s))); return `${ps.length} pawns`; } });
const rallyPawns = ctx => KT[kingSq(ctx.s, ctx.me)].filter(x => ctx.s.board[x] && ctx.s.board[x].c === ctx.me && ctx.s.board[x].t === 'p');

common({ id: 'blunt', name: 'Blunt', timing: 'action', dur: D.next, vfx: 'disarm', tags: ['control', 'pawn'],
  text: 'One enemy pawn cannot capture until your next turn.', restrict: 'It still counts as attacking for king safety.',
  steps: [sq('Choose an enemy pawn', ctx => enemy(ctx, ['p'], p => !has(ctx.s, p, 'noCapture')))],
  apply(ctx, [a]) { addFx(ctx.s, a, 'noCapture', T.myNext(ctx.s)); return ctx.n(a); } });

common({ id: 'echo_step', name: 'Echo Step', timing: 'after', dur: D.instant, vfx: 'dash', tags: ['pawn', 'tempo'],
  text: 'After moving a pawn one square forward, it may advance one more square.', restrict: 'The extra step cannot capture.',
  can(ctx) { const m = lastMove(ctx); return m && m.t === 'p' && !m.cap && Math.abs(m.to - m.from) === 8 && findId(ctx.s, m.id) >= 0 ? true : 'Move a pawn one square first'; }, steps: [],
  apply(ctx) { ctx.s.bonus = { ids: [lastMove(ctx).id], fwdOne: true, noCapture: true, then: 'end', label: 'Echo Step: advance the pawn again' }; return ''; } });

common({ id: 'advance_guard', name: 'Advance Guard', timing: 'after', dur: D.instant, vfx: 'dash', tags: ['pawn', 'tempo'],
  text: 'After moving a pawn, one of your pawns on a neighbouring file may advance one square.', restrict: 'The advance cannot capture.',
  can(ctx) { const m = lastMove(ctx); return m && m.t === 'p' ? true : 'Move a pawn first'; }, steps: [],
  apply(ctx) { const m = lastMove(ctx); const ids = own(ctx, ['p'], (p, i) => Math.abs(F(i) - F(m.to)) === 1).map(i => ctx.s.board[i].id); ctx.s.bonus = { ids, fwdOne: true, noCapture: true, then: 'end', label: 'Advance Guard: advance a neighbouring pawn' }; return ''; } });

common({ id: 'dig_in', name: 'Dig In', timing: 'after', dur: D.next, vfx: 'shield', tags: ['defense', 'shield'],
  text: 'After your move, the piece you moved gains a shield until your next turn.', restrict: 'Not the king.',
  can(ctx) { const m = lastMove(ctx); return m && m.t !== 'k' && findId(ctx.s, m.id) >= 0 ? true : 'Move a non-king piece first'; }, steps: [],
  apply(ctx) { const x = findId(ctx.s, lastMove(ctx).id); addFx(ctx.s, x, 'shield', T.myNext(ctx.s)); return ctx.n(x); } });

common({ id: 'spur', name: 'Spur', timing: 'arm', dur: 'Your move this turn (its threat lasts until your next turn)', vfx: 'empower', tags: ['knight'],
  text: 'This turn, one of your knights may also move one square in any direction, like a king.', restrict: 'Cannot be used if it would give check right away.',
  steps: [sq('Choose a knight', ctx => own(ctx, ['n']))], apply(ctx, [a]) { addFx(ctx.s, a, 'mvK', T.myNext(ctx.s)); return ctx.n(a); } });

common({ id: 'hustle', name: 'Hustle', timing: 'action', free: true, dur: D.turn, vfx: 'draw', tags: ['tempo'], uses: 1,
  text: 'You may play one extra card this turn. Hustle itself does not count toward the card limit.', restrict: 'Once per round.', steps: [],
  apply(ctx) { ctx.s.pfx[ctx.me].extra = { until: T.turn(ctx.s), n: ((ctx.s.pfx[ctx.me].extra && ctx.s.pfx[ctx.me].extra.until > ctx.s.ply) ? ctx.s.pfx[ctx.me].extra.n : 0) + 1 }; return '+1 card this turn'; } });

common({ id: 'recycle', name: 'Recycle', timing: 'action', dur: D.instant, vfx: 'draw', tags: ['draw'], uses: 1,
  text: 'Restore one use of one of your spent Common cards.', restrict: 'Cannot restore Recycle.',
  steps: [ch('Choose a spent Common card', ctx => usedCards(ctx, h => h.rarity === 'common' && h.id !== 'recycle'))],
  apply(ctx, [u]) { ctx.refresh(u); return ''; } });

common({ id: 'ward', name: 'Ward', timing: 'action', dur: "For the opponent's next two turns", vfx: 'ward', tags: ['defense'],
  text: 'One of your non-king pieces cannot be chosen by enemy cards and ignores enemy traps.', restrict: 'Does not stop normal captures.',
  steps: [sq('Choose a piece', ctx => own(ctx, ['p', 'n', 'b', 'r', 'q'], p => !has(ctx.s, p, 'ward')))], apply(ctx, [a]) { addFx(ctx.s, a, 'ward', T.theirTwo(ctx.s)); return ctx.n(a); } });

// ═══════════════════ UNCOMMON ═══════════════════
const unc = o => add({ rarity: 'uncommon', uses: 1, per: 'round', cd: 0, ...o });

unc({ id: 'knights_gambit', name: "Knight's Gambit", timing: 'after', dur: D.instant, vfx: 'leap', tags: ['knight', 'tempo'],
  text: 'After moving a knight normally, make one additional legal move with that knight.', restrict: 'Both moves must keep your king safe. No castling.',
  can(ctx) { const m = lastMove(ctx); return m && m.t === 'n' && !m.bonus && findId(ctx.s, m.id) >= 0 ? true : 'Move a knight first'; }, steps: [],
  apply(ctx) { ctx.s.bonus = { ids: [lastMove(ctx).id], then: 'end', label: "Knight's Gambit: move the knight again" }; return ''; } });

unc({ id: 'bishops_sight', name: "Bishop's Sight", timing: 'action', free: true, uses: 2, dur: D.turn, vfx: 'sight', tags: ['bishop', 'info'],
  text: "Select a bishop to highlight its legal diagonal paths, the pieces it attacks and any enemy piece pinned along its diagonals. Information only: it does not count toward your card limit.", restrict: 'Shows information; it changes nothing on the board.',
  steps: [sq('Choose a bishop', ctx => own(ctx, ['b']))], apply(ctx, [a]) { ctx.s.sight = { sq: a, until: T.turn(ctx.s) }; return ctx.n(a); } });

unc({ id: 'double_threat', name: 'Double Threat', timing: 'arm', dur: 'Until your next knight move (this round)', vfx: 'empower', tags: ['knight', 'tempo'],
  text: 'Your next knight move can be followed by an additional legal move with that knight.', restrict: 'Triggers on your next normal knight move this round.',
  can(ctx) { return ctx.s.pfx[ctx.me].doubleThreat > ctx.s.ply ? 'Already armed' : true; }, steps: [],
  apply(ctx) { ctx.s.pfx[ctx.me].doubleThreat = FOREVER; return 'armed'; } });

unc({ id: 'ice_lance', name: 'Ice Lance', timing: 'action', dur: D.next, vfx: 'freeze', tags: ['freeze'],
  text: 'Freeze one enemy knight, bishop or rook until your next turn.', restrict: 'Not the king or queen.',
  steps: [sq('Choose an enemy piece', ctx => enemy(ctx, ['n', 'b', 'r'], p => !has(ctx.s, p, 'frozen')))], apply(ctx, [a]) { addFx(ctx.s, a, 'frozen', T.myNext(ctx.s)); return ctx.n(a); } });

unc({ id: 'barricade', name: 'Barricade', timing: 'action', dur: "For the opponent's next two turns", vfx: 'wall', tags: ['wall', 'control'],
  text: 'Place barriers on two empty squares. No piece can move onto or through them.', restrict: 'Barriers never block check.',
  steps: [sq('Choose the first square', ctx => empties(ctx)), sq('Choose the second square', (ctx, [a]) => empties(ctx).filter(x => x !== a))],
  apply(ctx, [a, b]) { for (const x of [a, b]) ctx.s.walls.push({ sq: x, until: T.theirTwo(ctx.s), owner: ctx.me }); return ctx.n(a, b, '+'); } });

unc({ id: 'bide', name: 'Bide', timing: 'move', dur: D.instant, vfx: 'pass', tags: ['tempo', 'defense'],
  text: 'Pass: end your turn without moving. Perfect for escaping zugzwang.', restrict: 'Not while you are in check.',
  can(ctx) { return inCheck(ctx.s, ctx.me) ? 'You are in check' : true; }, steps: [], apply() { return 'passed'; } });

unc({ id: 'silence', name: 'Silence', timing: 'action', dur: "The opponent's next turn", vfx: 'silence', tags: ['control'],
  text: 'Your opponent cannot play any cards (including reactions) during their next turn.', restrict: 'Wears off when your next turn starts.', steps: [],
  can(ctx) { return ctx.s.pfx[ctx.foe].silenced > ctx.s.ply ? 'Already silenced' : true; },
  apply(ctx) { ctx.s.pfx[ctx.foe].silenced = T.myNext(ctx.s); return 'opponent silenced'; } });

unc({ id: 'phalanx', name: 'Phalanx', timing: 'action', dur: D.next, vfx: 'immune', tags: ['pawn', 'defense'],
  text: 'Every pawn of yours with a friendly pawn directly beside it cannot be captured or destroyed until your next turn.', restrict: 'Needs at least two pawns side by side.',
  can(ctx) { return phalanx(ctx).length ? true : 'No pawns side by side'; }, steps: [],
  apply(ctx) { const ps = phalanx(ctx); ps.forEach(x => addFx(ctx.s, x, 'immune', T.myNext(ctx.s))); return `${ps.length} pawns`; } });
const phalanx = ctx => own(ctx, ['p'], (p, i) => [off(i, 1, 0), off(i, -1, 0)].some(x => x >= 0 && ctx.s.board[x] && ctx.s.board[x].c === ctx.me && ctx.s.board[x].t === 'p'));

unc({ id: 'forward_march', name: 'Forward March', timing: 'move', dur: D.instant, vfx: 'dash', tags: ['pawn', 'tempo'],
  text: 'Every pawn of yours on its starting rank with an empty square ahead advances one square. This is your move.', restrict: 'The result must be legal.',
  can(ctx) { return marchers(ctx).length ? true : 'No pawn can march'; }, steps: [],
  apply(ctx) { const ps = marchers(ctx); ps.forEach(x => relocate(ctx.s, x, fwdSq(ctx.me, x))); return `${ps.length} pawns advance`; } });
const marchers = ctx => own(ctx, ['p'], (p, i) => R(i) === pawnRank(ctx.me) && isEmpty(ctx.s, fwdSq(ctx.me, i)));

unc({ id: 'switcheroo', name: 'Switcheroo', timing: 'action', dur: D.instant, vfx: 'swap', tags: ['pawn', 'control'],
  text: 'Swap one of your pawns with an adjacent enemy pawn.', restrict: 'Cannot give check. The result must be legal.',
  steps: [sq('Choose your pawn', ctx => own(ctx, ['p'], (p, i) => KT[i].some(x => enemy(ctx, ['p']).includes(x)))), sq('Choose an adjacent enemy pawn', (ctx, [a]) => KT[a].filter(x => enemy(ctx, ['p']).includes(x)))],
  apply(ctx, [a, b]) { swap(ctx.s, a, b); return ctx.n(a, b, '⇄'); } });

unc({ id: 'camel_leap', name: 'Camel Leap', timing: 'arm', dur: 'Your move this turn (its threat lasts until your next turn)', vfx: 'empower', tags: ['knight'],
  text: 'This turn, one of your knights may also leap like a camel: three squares one way and one square the other.', restrict: 'Cannot be used if it would give check right away.',
  steps: [sq('Choose a knight', ctx => own(ctx, ['n']))], apply(ctx, [a]) { addFx(ctx.s, a, 'mvCamel', T.myNext(ctx.s)); return ctx.n(a); } });

unc({ id: 'phase_rook', name: 'Phase Rook', timing: 'arm', dur: 'Your move this turn (its threat lasts until your next turn)', vfx: 'phase', tags: ['rook'],
  text: 'This turn, one of your rooks can move through your own pieces.', restrict: 'It still cannot land on them.',
  steps: [sq('Choose a rook', ctx => own(ctx, ['r']))], apply(ctx, [a]) { addFx(ctx.s, a, 'phase', T.myNext(ctx.s)); return ctx.n(a); } });

unc({ id: 'dispel', name: 'Dispel', timing: 'action', dur: D.instant, vfx: 'cleanse', tags: ['control'],
  text: "Remove every beneficial enemy effect: immunity, shields, wards, their barriers and traps, and their armed abilities.", restrict: 'Only when the opponent has such an effect.',
  can(ctx) { return dispellable(ctx) ? true : 'Nothing to dispel'; }, steps: [],
  apply(ctx) {
    const s = ctx.s;
    for (const x of squares(s, p => p && p.c === ctx.foe)) delFx(s, x, 'immune', 'shield', 'ward', 'phase', 'mvN', 'mvK', 'mvCamel', 'mvB', 'mvR');
    s.walls = s.walls.filter(w => w.owner !== ctx.foe); s.traps = s.traps.filter(t => t.owner !== ctx.foe);
    const pf = s.pfx[ctx.foe]; delete pf.iron; delete pf.doubleThreat; delete pf.shockwave; return 'dispelled';
  } });
function dispellable(ctx) {
  const s = ctx.s, pf = s.pfx[ctx.foe];
  return squares(s, p => p && p.c === ctx.foe && ['immune', 'shield', 'ward'].some(k => has(s, p, k))).length || s.walls.some(w => w.owner === ctx.foe) || s.traps.some(t => t.owner === ctx.foe) || pf.iron > s.ply || pf.doubleThreat > s.ply || pf.shockwave > s.ply;
}

unc({ id: 'booby_trap', name: 'Booby Trap', timing: 'action', dur: 'Until triggered (this round)', vfx: 'trap', tags: ['trap', 'freeze', 'control'],
  text: 'Set a trap on an empty square. The first enemy piece to end a move there is frozen for two of its turns.', restrict: 'Traps are visible. Warded pieces ignore them.',
  steps: [sq('Choose an empty square', ctx => empties(ctx))], apply(ctx, [a]) { ctx.s.traps.push({ sq: a, kind: 'freeze', owner: ctx.me }); return ctx.n(a); } });

unc({ id: 'disarm', name: 'Disarm', timing: 'action', dur: D.next, vfx: 'disarm', tags: ['control'],
  text: 'One enemy knight, bishop or rook cannot capture until your next turn.', restrict: 'It still counts as attacking for king safety.',
  steps: [sq('Choose an enemy piece', ctx => enemy(ctx, ['n', 'b', 'r'], p => !has(ctx.s, p, 'noCapture')))], apply(ctx, [a]) { addFx(ctx.s, a, 'noCapture', T.myNext(ctx.s)); return ctx.n(a); } });

unc({ id: 'cavalry', name: 'Cavalry Training', timing: 'arm', dur: 'Your move this turn (its threat lasts until your next turn)', vfx: 'empower', tags: ['bishop', 'knight'],
  text: 'This turn, one of your bishops may also move like a knight.', restrict: 'Cannot be used if it would give check right away.',
  steps: [sq('Choose a bishop', ctx => own(ctx, ['b']))], apply(ctx, [a]) { addFx(ctx.s, a, 'mvN', T.myNext(ctx.s)); return ctx.n(a); } });

unc({ id: 'leapfrog', name: 'Leapfrog', timing: 'action', dur: D.instant, vfx: 'leap', tags: ['pawn'],
  text: 'One of your pawns jumps over the piece directly in front of it to the empty square beyond.', restrict: 'Cannot land on the last rank.',
  steps: [sq('Choose a pawn', ctx => own(ctx, ['p'], (p, i) => { const a = fwdSq(ctx.me, i), b = fwdSq(ctx.me, i, 2); return a >= 0 && ctx.s.board[a] && isEmpty(ctx.s, b) && notLast(ctx.me, b); }))],
  apply(ctx, [a]) { const b = fwdSq(ctx.me, a, 2); relocate(ctx.s, a, b); return ctx.n(a, b); } });

unc({ id: 'rook_swap', name: 'Rook Swap', timing: 'action', dur: D.instant, vfx: 'swap', tags: ['rook'],
  text: 'Swap one of your rooks with one of your knights or bishops anywhere on the board.', restrict: 'Cannot give check. Loses that rook\'s castling right.',
  steps: [sq('Choose a rook', ctx => own(ctx, ['r'])), sq('Choose a knight or bishop', ctx => own(ctx, ['n', 'b']))], apply(ctx, [a, b]) { swap(ctx.s, a, b); return ctx.n(a, b, '⇄'); } });

unc({ id: 'reinforcements', name: 'Reinforcements', timing: 'action', dur: D.instant, vfx: 'draw', tags: ['draw'],
  text: 'Draw a random Uncommon card for this round.', restrict: 'Lasts this round only.', steps: [], apply(ctx) { ctx.draw({ rarity: ['uncommon'] }); return 'drew a card'; } });

unc({ id: 'retaliation', name: 'Retaliation', timing: 'reactive', trigger: 'captured', dur: 'Their next turn', vfx: 'freeze', tags: ['freeze', 'defense'],
  text: "When the opponent captures one of your pieces, freeze the capturing piece for their next turn.", restrict: 'Not the king. Wards protect it.',
  can(ctx) { const x = capturer(ctx); return x >= 0 && ctx.s.board[x].t !== 'k' && targetable(ctx, x) ? true : 'No valid capturer'; }, steps: [],
  apply(ctx) { const x = capturer(ctx); addFx(ctx.s, x, 'frozen', ctx.s.ply + 3); return ctx.n(x); } });
function capturer(ctx) { const e = ctx.event; return e ? findId(ctx.s, e.byId) : -1; }

unc({ id: 'hit_and_run', name: 'Hit and Run', timing: 'after', dur: D.instant, vfx: 'dash', tags: ['knight', 'bishop', 'attack'],
  text: 'After capturing with a knight or bishop, that piece may make one more non-capturing move.', restrict: 'Must keep your king safe.',
  can(ctx) { const m = lastMove(ctx); return m && m.cap && (m.t === 'n' || m.t === 'b') && findId(ctx.s, m.id) >= 0 ? true : 'Capture with a knight or bishop first'; }, steps: [],
  apply(ctx) { ctx.s.bonus = { ids: [lastMove(ctx).id], noCapture: true, then: 'end', label: 'Hit and Run: move away' }; return ''; } });

unc({ id: 'tunnel', name: 'Tunnel', timing: 'action', dur: D.instant, vfx: 'teleport', tags: ['knight'],
  text: 'One of your knights teleports to an empty square next to your other knight.', restrict: 'You need two knights. Cannot give check.',
  steps: [sq('Choose a knight to tunnel', ctx => own(ctx, ['n'], (p, i) => tunnelTo(ctx, i).length > 0)), sq('Choose the exit', (ctx, [a]) => tunnelTo(ctx, a))],
  apply(ctx, [a, b]) { relocate(ctx.s, a, b); return ctx.n(a, b); } });
const tunnelTo = (ctx, a) => [...new Set(own(ctx, ['n']).filter(x => x !== a).flatMap(x => KT[x]))].filter(x => isEmpty(ctx.s, x));

unc({ id: 'slipstream', name: 'Slipstream', timing: 'after', dur: D.instant, vfx: 'dash', tags: ['tempo'],
  text: 'After your move, another of your pieces that could move into the vacated square may do so.', restrict: 'Non-capturing; normal movement rules.',
  can(ctx) { const m = lastMove(ctx); return m && !m.castle ? true : 'Make a move first'; }, steps: [],
  apply(ctx) { const m = lastMove(ctx); ctx.s.bonus = { notId: m.id, toSq: m.from, noCapture: true, then: 'end', label: 'Slipstream: fill the vacated square' }; return ''; } });

unc({ id: 'royal_guard', name: 'Royal Guard', timing: 'action', dur: D.next, vfx: 'shield', tags: ['king', 'defense', 'shield'],
  text: 'Every piece of yours next to your king gains a shield until your next turn.', restrict: 'Needs at least one piece next to your king.',
  can(ctx) { return guards(ctx).length ? true : 'No piece next to your king'; }, steps: [],
  apply(ctx) { const g = guards(ctx); g.forEach(x => addFx(ctx.s, x, 'shield', T.myNext(ctx.s))); return `${g.length} guards`; } });
const guards = ctx => KT[kingSq(ctx.s, ctx.me)].filter(x => ctx.s.board[x] && ctx.s.board[x].c === ctx.me);

unc({ id: 'gambit_accepted', name: 'Gambit Accepted', timing: 'action', dur: D.instant, vfx: 'burst', tags: ['draw'],
  text: 'Sacrifice one of your knights or bishops to draw two cards for this round.', restrict: 'Not if removing it exposes your king.',
  steps: [sq('Choose a knight or bishop', ctx => own(ctx, ['n', 'b']))],
  apply(ctx, [a]) { const p = ctx.s.board[a]; ctx.s.board[a] = null; ctx.s.captured[ctx.me].push({ t: p.t, id: p.id, home: p.home, c: p.c }); ctx.draw(); ctx.draw(); return ctx.n(a); } });

unc({ id: 'burn_bridges', name: 'Burn Bridges', timing: 'action', dur: D.round, vfx: 'burst', tags: ['control', 'king'],
  text: 'Your opponent loses all castling rights for the rest of the round.', restrict: 'Only if they can still castle.',
  can(ctx) { return ctx.s.castle.split('').some(c => (ctx.foe === W ? 'KQ' : 'kq').includes(c)) ? true : 'They cannot castle anyway'; }, steps: [],
  apply(ctx) { ctx.s.castle = ctx.s.castle.replace(ctx.foe === W ? /[KQ]/g : /[kq]/g, ''); return 'castling burned'; } });

unc({ id: 'overclock', name: 'Overclock', timing: 'action', dur: D.instant, vfx: 'draw', tags: ['draw'],
  text: 'Restore one use of one of your spent cards (not Legendary).', restrict: 'Cannot restore Overclock.',
  steps: [ch('Choose a spent card', ctx => usedCards(ctx, h => h.rarity !== 'legendary' && h.id !== 'overclock'))], apply(ctx, [u]) { ctx.refresh(u); return ''; } });

unc({ id: 'pawn_storm', name: 'Pawn Storm', timing: 'action', dur: D.instant, vfx: 'dash', tags: ['pawn', 'tempo'],
  text: 'Two of your pawns each advance one square.', restrict: 'Empty squares only, not onto the last rank. Cannot give check.',
  steps: [sq('Choose the first pawn', ctx => stormers(ctx)), sq('Choose the second pawn', (ctx, [a]) => stormers(ctx).filter(x => x !== a))],
  apply(ctx, [a, b]) { relocate(ctx.s, a, fwdSq(ctx.me, a)); if (!isEmpty(ctx.s, fwdSq(ctx.me, b)) || ctx.s.board[b] == null) return false; relocate(ctx.s, b, fwdSq(ctx.me, b)); return ctx.n(a, b, '+'); } });
const stormers = ctx => own(ctx, ['p'], (p, i) => isEmpty(ctx.s, fwdSq(ctx.me, i)) && notLast(ctx.me, fwdSq(ctx.me, i)));

// ═══════════════════ RARE ═══════════════════
const rare = o => add({ rarity: 'rare', uses: 1, per: 'round', cd: 0, ...o });

rare({ id: 'fortress', name: 'Fortress', timing: 'action', dur: D.next, vfx: 'fortress', tags: ['rook', 'defense'],
  text: 'Select one of your rooks. Until your next turn it cannot be captured, but it cannot move while protected.', restrict: 'Rooks only.',
  steps: [sq('Choose a rook', ctx => own(ctx, ['r']))], apply(ctx, [a]) { addFx(ctx.s, a, 'immune', T.myNext(ctx.s)); addFx(ctx.s, a, 'frozen', T.myNext(ctx.s)); return ctx.n(a); } });

rare({ id: 'resurrection', name: 'Resurrection', timing: 'action', dur: D.perm, vfx: 'revive', tags: ['pawn', 'revive'],
  text: 'Return one of your captured pawns to an empty square on your pawns\' home rank.', restrict: 'Needs a captured pawn. Cannot give check.',
  can(ctx) { return ctx.s.captured[ctx.me].some(x => x.t === 'p') ? true : 'No captured pawn'; },
  steps: [sq('Choose an empty home-rank square', ctx => squares(ctx.s, (p, i) => R(i) === pawnRank(ctx.me) && isEmpty(ctx.s, i)))],
  apply(ctx, [a]) { const l = ctx.s.captured[ctx.me]; const i = l.findIndex(x => x.t === 'p'); const p = l.splice(i, 1)[0]; place(ctx.s, a, { t: 'p', c: ctx.me, id: p.id, home: a }); return ctx.n(a); } });

rare({ id: 'last_stand', name: 'Last Stand', timing: 'action', dur: D.used, vfx: 'shield', tags: ['defense', 'shield'],
  text: 'Protect one of your pieces from its next otherwise legal capture: the attacker bounces back and the protection breaks.', restrict: 'Not the king. Lasts until used this round.',
  steps: [sq('Choose a piece', ctx => own(ctx, ['p', 'n', 'b', 'r', 'q'], p => !has(ctx.s, p, 'shield')))], apply(ctx, [a]) { addFx(ctx.s, a, 'shield', FOREVER); return ctx.n(a); } });

rare({ id: 'deep_freeze', name: 'Deep Freeze', timing: 'action', dur: D.two, vfx: 'freeze', tags: ['freeze'],
  text: "Freeze the enemy queen for your opponent's next two turns.", restrict: 'Restrictions break if they would leave the opponent without a legal move.',
  steps: [sq('Choose the enemy queen', ctx => enemy(ctx, ['q'], p => !has(ctx.s, p, 'frozen')))], apply(ctx, [a]) { addFx(ctx.s, a, 'frozen', T.theirTwo(ctx.s)); return ctx.n(a); } });

rare({ id: 'nullify', name: 'Nullify', timing: 'reactive', trigger: 'cardPlayed', dur: D.instant, vfx: 'silence', tags: ['control'],
  text: 'When your opponent plays a card, cancel it. Their card is still spent.', restrict: 'Cannot cancel a reaction.', steps: [], apply() { return 'card cancelled'; } });

rare({ id: 'landmine', name: 'Landmine', timing: 'action', dur: 'Until triggered (this round)', vfx: 'trap', tags: ['trap', 'attack'],
  text: 'Set a mine on an empty square. The first enemy non-king piece to end a move there is destroyed.', restrict: 'Visible to both. Fizzles if destruction would be illegal; shields and immunity absorb it.',
  steps: [sq('Choose an empty square', ctx => empties(ctx))], apply(ctx, [a]) { ctx.s.traps.push({ sq: a, kind: 'mine', owner: ctx.me }); return ctx.n(a); } });

rare({ id: 'battlefield_promotion', name: 'Battlefield Promotion', timing: 'move', dur: D.perm, vfx: 'promote', tags: ['pawn', 'promote'], check: true,
  text: 'Promote one of your pawns on its sixth or seventh rank right now, to any piece. This is your move.', restrict: 'The result must be legal.',
  steps: [sq('Choose a pawn', ctx => own(ctx, ['p'], (p, i) => relRank(ctx.me, i) >= 5)), ch('Promote to', () => ['q', 'r', 'b', 'n'].map(v => ({ v, label: NAME[v] })))],
  apply(ctx, [a, t]) { transform(ctx.s, a, t); return `${ctx.n(a)}=${t.toUpperCase()}`; } });

rare({ id: 'rally_fallen', name: 'Rally the Fallen', timing: 'action', dur: D.perm, vfx: 'revive', tags: ['revive', 'knight', 'bishop'],
  text: 'Return one of your captured knights or bishops to its starting square.', restrict: 'That square must be empty. Cannot give check.',
  can(ctx) { return fallen(ctx).length ? true : 'No captured knight or bishop whose square is free'; },
  steps: [sq('Choose a starting square', ctx => fallen(ctx).map(f => f.home))],
  apply(ctx, [a]) { const l = ctx.s.captured[ctx.me]; const i = l.findIndex(x => (x.t === 'n' || x.t === 'b') && x.home === a); const p = l.splice(i, 1)[0]; place(ctx.s, a, p); return ctx.n(a); } });
const fallen = ctx => ctx.s.captured[ctx.me].filter(x => (x.t === 'n' || x.t === 'b') && x.home != null && isEmpty(ctx.s, x.home));

rare({ id: 'shield_wall', name: 'Shield Wall', timing: 'action', dur: D.next, vfx: 'shield', tags: ['pawn', 'defense', 'shield'],
  text: 'All of your pawns gain shields until your next turn.', restrict: 'Needs at least one pawn.',
  can(ctx) { return own(ctx, ['p']).length ? true : 'No pawns'; }, steps: [], apply(ctx) { const ps = own(ctx, ['p']); ps.forEach(x => addFx(ctx.s, x, 'shield', T.myNext(ctx.s))); return `${ps.length} pawns`; } });

rare({ id: 'vengeance', name: 'Vengeance', timing: 'reactive', trigger: 'captured', dur: D.instant, vfx: 'burst', tags: ['attack', 'defense'],
  text: 'When the opponent captures your queen or a rook, destroy the capturing piece.', restrict: 'Not if the capturer is a king. Fizzles if illegal; shields and immunity absorb it.',
  can(ctx) { const e = ctx.event, x = capturer(ctx); return e && (e.piece.t === 'q' || e.piece.t === 'r') && x >= 0 && ctx.s.board[x].t !== 'k' && targetable(ctx, x) ? true : 'Only after losing a queen or rook'; }, steps: [],
  apply(ctx) { const x = capturer(ctx); const r = destroy(ctx.s, x); return r === true ? ctx.n(x) : `${r} absorbed it`; } });

rare({ id: 'blink_knight', name: 'Blink Knight', timing: 'action', dur: D.instant, vfx: 'teleport', tags: ['knight', 'teleport'],
  text: 'Teleport one of your knights to any empty square.', restrict: 'Cannot give check. The result must be legal.',
  steps: [sq('Choose a knight', ctx => own(ctx, ['n'])), sq('Choose a destination', ctx => empties(ctx))], apply(ctx, [a, b]) { relocate(ctx.s, a, b); return ctx.n(a, b); } });

rare({ id: 'haste', name: 'Haste', timing: 'after', dur: D.instant, vfx: 'dash', tags: ['tempo'],
  text: 'After your move, make one more non-capturing move with a different piece.', restrict: 'The extra move cannot give check. No castling.',
  can(ctx) { return lastMove(ctx) ? true : 'Make a move first'; }, steps: [],
  apply(ctx) { ctx.s.bonus = { notId: lastMove(ctx).id, noCapture: true, noCheck: true, then: 'end', label: 'Haste: move a different piece' }; return ''; } });

rare({ id: 'aegis', name: 'Aegis', timing: 'action', dur: D.next, vfx: 'immune', tags: ['defense'],
  text: 'Your queen cannot be captured or destroyed until your next turn.', restrict: 'Queen only.',
  steps: [sq('Choose your queen', ctx => own(ctx, ['q'], p => !has(ctx.s, p, 'immune')))], apply(ctx, [a]) { addFx(ctx.s, a, 'immune', T.myNext(ctx.s)); return ctx.n(a); } });

rare({ id: 'conscript', name: 'Conscript', timing: 'action', dur: D.perm, vfx: 'convert', tags: ['pawn', 'control'],
  text: 'An enemy pawn on your half of the board switches sides and becomes your pawn.', restrict: 'Cannot give check. The result must be legal.',
  steps: [sq('Choose an enemy pawn on your half', ctx => enemy(ctx, ['p'], (p, i) => relRank(ctx.me, i) <= 3))], apply(ctx, [a]) { ctx.s.board[a] = { ...ctx.s.board[a], c: ctx.me, fx: {} }; return ctx.n(a); } });

rare({ id: 'shockwave', name: 'Shockwave', timing: 'arm', dur: 'Until your next capture (this round)', vfx: 'empower', tags: ['attack'],
  text: 'Your next capture also destroys every enemy pawn next to the captured square.', restrict: 'Each removal must be legal; shields and immunity absorb it.',
  can(ctx) { return ctx.s.pfx[ctx.me].shockwave > ctx.s.ply ? 'Already armed' : true; }, steps: [], apply(ctx) { ctx.s.pfx[ctx.me].shockwave = FOREVER; return 'armed'; } });

rare({ id: 'displace', name: 'Displace', timing: 'action', dur: D.instant, vfx: 'swap', tags: ['control'],
  text: 'Swap the positions of two enemy non-king pieces of different types.', restrict: 'A pawn cannot land on a back rank. Cannot give check.',
  steps: [sq('Choose an enemy piece', ctx => enemy(ctx, ['p', 'n', 'b', 'r', 'q'])), sq('Choose another enemy piece', (ctx, [a]) => enemy(ctx, ['p', 'n', 'b', 'r', 'q'], p => p.t !== ctx.s.board[a].t))],
  apply(ctx, [a, b]) { swap(ctx.s, a, b); return ctx.n(a, b, '⇄'); } });

rare({ id: 'royal_escape', name: 'Royal Escape', timing: 'action', dur: D.instant, vfx: 'swap', tags: ['king', 'rook', 'defense'],
  text: 'Your king swaps places with one of your rooks anywhere on the board.', restrict: 'Your king must be safe afterwards. Loses castling rights.',
  steps: [sq('Choose a rook', ctx => own(ctx, ['r']))], apply(ctx, [a]) { const k = kingSq(ctx.s, ctx.me); swap(ctx.s, k, a); return ctx.n(k, a, '⇄'); } });

rare({ id: 'pincer', name: 'Pincer', timing: 'action', dur: D.instant, vfx: 'burst', tags: ['attack', 'pawn'],
  text: 'Destroy an enemy pawn that two or more of your pieces attack.', restrict: 'Cannot give check. Shields and immunity absorb it.',
  steps: [sq('Choose an enemy pawn', ctx => enemy(ctx, ['p'], (p, i) => !has(ctx.s, p, 'immune') && own(ctx).filter(x => pieceAttacks(ctx.s, x, i)).length >= 2))],
  apply(ctx, [a]) { const r = destroy(ctx.s, a); return r === true ? ctx.n(a) : `${r} absorbed it`; } });

rare({ id: 'quartermaster', name: 'Quartermaster', timing: 'action', dur: D.instant, vfx: 'draw', tags: ['draw'],
  text: 'Draw a random Rare card for this round.', restrict: 'Lasts this round only.', steps: [], apply(ctx) { ctx.draw({ rarity: ['rare'] }); return 'drew a card'; } });

rare({ id: 'reinforce_line', name: 'Reinforce Line', timing: 'action', dur: D.perm, vfx: 'revive', tags: ['revive', 'pawn'],
  text: 'Replace one of your pawns with one of your captured knights or bishops.', restrict: 'Cannot give check. The result must be legal.',
  can(ctx) { return ctx.s.captured[ctx.me].some(x => x.t === 'n' || x.t === 'b') ? true : 'No captured knight or bishop'; },
  steps: [sq('Choose a pawn', ctx => own(ctx, ['p'])), ch('Bring back', ctx => [...new Set(ctx.s.captured[ctx.me].filter(x => x.t === 'n' || x.t === 'b').map(x => x.t))].map(v => ({ v, label: NAME[v] })))],
  apply(ctx, [a, t]) {
    const l = ctx.s.captured[ctx.me], i = l.findIndex(x => x.t === t), back = l.splice(i, 1)[0], pawn = ctx.s.board[a];
    l.push({ t: 'p', id: pawn.id, home: pawn.home, c: pawn.c }); place(ctx.s, a, { ...back, c: ctx.me }); return ctx.n(a);
  } });

// ═══════════════════ EPIC ═══════════════════
const epic = o => add({ rarity: 'epic', uses: 1, per: 'round', cd: 0, ...o });

epic({ id: 'royal_exchange', name: 'Royal Exchange', timing: 'action', dur: D.instant, vfx: 'swap', tags: ['queen', 'tempo'],
  text: 'Swap your queen with one of your own pieces.', restrict: 'Not the king. A pawn cannot land on a back rank. Cannot give check.',
  can(ctx) { return own(ctx, ['q']).length ? true : 'You have no queen'; },
  steps: [sq('Choose a piece to swap with your queen', ctx => own(ctx, ['p', 'n', 'b', 'r']))], apply(ctx, [a]) { const q = own(ctx, ['q'])[0]; swap(ctx.s, q, a); return ctx.n(q, a, '⇄'); } });

epic({ id: 'shadow_step', name: 'Shadow Step', timing: 'move', noCheck: true, dur: D.instant, vfx: 'teleport', tags: ['teleport'],
  text: 'Teleport one of your non-king pieces to any empty square. This is your move.', restrict: 'Cannot give check. The result must be legal.',
  steps: [sq('Choose a piece', ctx => own(ctx, ['p', 'n', 'b', 'r', 'q'])), sq('Choose a destination', (ctx, [a]) => empties(ctx).filter(x => ctx.s.board[a].t !== 'p' || notLast(ctx.me, x)))],
  apply(ctx, [a, b]) { relocate(ctx.s, a, b); return ctx.n(a, b); } });

epic({ id: 'time_fracture', name: 'Time Fracture', timing: 'action', dur: D.instant, vfx: 'rewind', tags: ['tempo', 'rewind'],
  text: "Reverse your opponent's most recent move if it did not capture, restoring the exact previous position. Then make your move.", restrict: 'Their last turn must have been a single normal non-capturing move. The result must be legal.',
  can(ctx) {
    const lt = ctx.s.lastTurn && ctx.s.lastTurn[ctx.foe];
    if (!lt || lt.ply !== ctx.s.ply - 1) return 'They have not moved yet';
    if (lt.kind !== 'move' || !lt.pure) return 'Their last turn was not a single normal move';
    if (lt.cap) return 'Their last move was a capture';
    return true;
  }, steps: [],
  apply(ctx) { const lt = ctx.s.lastTurn[ctx.foe]; restore(ctx.s, lt.snap); ctx.restored = lt.snap; return `${lt.san} undone`; } });

epic({ id: 'lightning', name: 'Lightning', timing: 'move', dur: D.instant, vfx: 'lightning', tags: ['attack', 'queen'], check: true,
  text: 'Destroy an enemy knight, bishop, rook or pawn that your queen attacks. This is your move.', restrict: 'Shields and immunity absorb it.',
  steps: [sq('Choose a target your queen attacks', ctx => { const q = own(ctx, ['q']); return enemy(ctx, ['p', 'n', 'b', 'r'], (p, i) => !has(ctx.s, p, 'immune') && q.some(x => pieceAttacks(ctx.s, x, i))); })],
  apply(ctx, [a]) { const r = destroy(ctx.s, a); return r === true ? ctx.n(a) : `${r} absorbed it`; } });

epic({ id: 'blizzard', name: 'Blizzard', timing: 'action', dur: D.next, vfx: 'freeze', tags: ['freeze', 'control'],
  text: 'Freeze every enemy pawn until your next turn.', restrict: 'Wards protect. Restrictions break if they would leave the opponent without a legal move.',
  can(ctx) { return enemy(ctx, ['p']).length ? true : 'No enemy pawns'; }, steps: [],
  apply(ctx) { const ps = enemy(ctx, ['p']); ps.forEach(x => addFx(ctx.s, x, 'frozen', T.myNext(ctx.s))); return `${ps.length} pawns frozen`; } });

epic({ id: 'mirror_image', name: 'Mirror Image', timing: 'action', dur: D.round, vfx: 'draw', tags: ['draw'],
  text: 'Copy the last card your opponent played this round into your hand, with one use.', restrict: 'Cannot copy Legendary cards or Mirror Image.',
  can(ctx) { const id = ctx.s.lastCard && ctx.s.lastCard[ctx.foe]; return id && id !== 'mirror_image' && byId(id).rarity !== 'legendary' ? true : 'Nothing to copy'; }, steps: [],
  apply(ctx) { ctx.draw({ id: ctx.s.lastCard[ctx.foe] }); return byId(ctx.s.lastCard[ctx.foe]).name; } });

epic({ id: 'polymorph', name: 'Polymorph', timing: 'action', dur: D.perm, vfx: 'convert', tags: ['control'],
  text: 'Transform an enemy knight, bishop or rook into a pawn.', restrict: 'Not on a back rank. Cannot give check.',
  steps: [sq('Choose an enemy piece', ctx => enemy(ctx, ['n', 'b', 'r'], (p, i) => R(i) !== 0 && R(i) !== 7))], apply(ctx, [a]) { transform(ctx.s, a, 'p'); stripCastle2(ctx.s, a); return ctx.n(a); } });
function stripCastle2(s, a) { const m = { 0: 'Q', 7: 'K', 56: 'q', 63: 'k' }; if (m[a]) s.castle = s.castle.replace(m[a], ''); }

epic({ id: 'phantom_army', name: 'Phantom Army', timing: 'arm', dur: 'Your move this turn (its threat lasts until your next turn)', vfx: 'phase', tags: ['tempo'],
  text: 'This turn, all your bishops, rooks and queens can move through your own pieces.', restrict: 'Cannot be used if a phased line would give check right away.', steps: [],
  can(ctx) { return own(ctx, ['b', 'r', 'q']).length ? true : 'No long-range pieces'; },
  apply(ctx) { own(ctx, ['b', 'r', 'q']).forEach(x => addFx(ctx.s, x, 'phase', T.myNext(ctx.s))); return 'phased'; } });

epic({ id: 'banish', name: 'Banish', timing: 'move', dur: D.instant, vfx: 'lightning', tags: ['attack'], check: true,
  text: 'Destroy one enemy knight or bishop anywhere. This is your move.', restrict: 'Shields and immunity absorb it.',
  steps: [sq('Choose an enemy knight or bishop', ctx => enemy(ctx, ['n', 'b'], p => !has(ctx.s, p, 'immune')))], apply(ctx, [a]) { const r = destroy(ctx.s, a); return r === true ? ctx.n(a) : `${r} absorbed it`; } });

epic({ id: 'treason', name: 'Treason', timing: 'action', dur: D.perm, vfx: 'convert', tags: ['pawn', 'control'],
  text: 'Any enemy pawn switches sides and becomes yours.', restrict: 'Cannot give check. The result must be legal.',
  steps: [sq('Choose an enemy pawn', ctx => enemy(ctx, ['p']))], apply(ctx, [a]) { ctx.s.board[a] = { ...ctx.s.board[a], c: ctx.me, fx: {} }; return ctx.n(a); } });

epic({ id: 'time_stop', name: 'Time Stop', timing: 'after', dur: D.instant, vfx: 'rewind', tags: ['tempo'],
  text: 'After your move, take one more move with any piece. It may capture.', restrict: 'The extra move cannot give check. No castling.',
  can(ctx) { return lastMove(ctx) ? true : 'Make a move first'; }, steps: [],
  apply(ctx) { ctx.s.bonus = { noCheck: true, then: 'end', label: 'Time Stop: take another move' }; return ''; } });

epic({ id: 'grand_resurrection', name: 'Grand Resurrection', timing: 'move', dur: D.perm, vfx: 'revive', tags: ['revive', 'queen'], check: true,
  text: 'Return your captured queen to its starting square. This is your move.', restrict: 'The square must be empty and the result legal.',
  can(ctx) { return ctx.s.captured[ctx.me].some(x => x.t === 'q') ? (isEmpty(ctx.s, homeSquares(ctx.me, 'q')[0]) ? true : 'Its starting square is occupied') : 'Your queen has not been captured'; }, steps: [],
  apply(ctx) { const l = ctx.s.captured[ctx.me], i = l.findIndex(x => x.t === 'q'), q = l.splice(i, 1)[0], h = homeSquares(ctx.me, 'q')[0]; place(ctx.s, h, { ...q, home: h }); return ctx.n(h); } });

epic({ id: 'arsenal', name: 'Arsenal', timing: 'action', dur: D.instant, vfx: 'draw', tags: ['draw'],
  text: 'Draw two random cards (Rare or lower) for this round.', restrict: 'Lasts this round only.', steps: [], apply(ctx) { ctx.draw({ rarity: ['common', 'uncommon', 'rare'] }); ctx.draw({ rarity: ['common', 'uncommon', 'rare'] }); return 'drew two cards'; } });

// ═══════════════════ LEGENDARY ═══════════════════
const leg = o => add({ rarity: 'legendary', uses: 1, per: 'match', cd: 0, ...o });

leg({ id: 'second_reign', name: 'Second Reign', timing: 'reactive', trigger: 'mate', dur: D.instant, vfx: 'royal', tags: ['king', 'defense'],
  text: 'If your king would be checkmated, prevent the checkmate: your king swaps onto a legal adjacent square held by one of your own pieces. This uses your turn.', restrict: 'Cannot activate if no adjacent square is legal.',
  steps: [sq('Choose where your king escapes', ctx => { const k = kingSq(ctx.s, ctx.me); return KT[k].filter(x => ctx.s.board[x] && ctx.s.board[x].c === ctx.me); })],
  apply(ctx, [a]) { const k = kingSq(ctx.s, ctx.me); swap(ctx.s, k, a); return ctx.n(k, a); } });

leg({ id: 'army_of_one', name: 'Army of One', timing: 'action', dur: D.perm, vfx: 'promote', tags: ['pawn', 'promote'],
  text: 'Transform one of your pawns into a knight, rook or bishop, wherever it stands.', restrict: 'Cannot give check. The result must be legal.',
  steps: [sq('Choose a pawn', ctx => own(ctx, ['p'])), ch('Transform into', () => ['n', 'r', 'b'].map(v => ({ v, label: NAME[v] })))],
  apply(ctx, [a, t]) { transform(ctx.s, a, t); return `${ctx.n(a)}=${t.toUpperCase()}`; } });

leg({ id: 'kings_gambit', name: "King's Gambit", timing: 'action', dur: D.turn, vfx: 'royal', tags: ['king', 'tempo'],
  text: 'Your king makes one additional legal move this turn, then you make your normal move.', restrict: 'No castling. The king can never enter check, and this king move cannot give check.', steps: [],
  apply(ctx) { ctx.s.bonus = { king: true, noCheck: true, then: 'pre', label: "King's Gambit: move your king" }; return ''; } });

leg({ id: 'coronation', name: 'Coronation', timing: 'move', dur: D.perm, vfx: 'promote', tags: ['pawn', 'promote', 'queen'], check: true,
  text: 'Crown one of your pawns: it becomes a queen where it stands. This is your move.', restrict: 'The result must be legal.',
  steps: [sq('Choose a pawn', ctx => own(ctx, ['p']))], apply(ctx, [a]) { transform(ctx.s, a, 'q'); return `${ctx.n(a)}=Q`; } });

leg({ id: 'undying', name: 'Undying', timing: 'reactive', trigger: 'captured', dur: D.perm, vfx: 'revive', tags: ['revive', 'defense'],
  text: 'When one of your non-pawn pieces is captured, return it to its starting square.', restrict: 'The square must be empty and the result legal.',
  can(ctx) { const e = ctx.event; return e && e.piece.t !== 'p' && e.piece.home != null && isEmpty(ctx.s, e.piece.home) && ctx.s.captured[ctx.me].some(x => x.id === e.piece.id) ? true : 'Its starting square is not free'; }, steps: [],
  apply(ctx) { const e = ctx.event, l = ctx.s.captured[ctx.me], i = l.findIndex(x => x.id === e.piece.id), p = l.splice(i, 1)[0]; place(ctx.s, p.home, p); return ctx.n(p.home); } });

leg({ id: 'earthquake', name: 'Earthquake', timing: 'move', dur: D.instant, vfx: 'quake', tags: ['attack', 'pawn'], check: true,
  text: 'Choose a rank: every pawn on it (both sides) is destroyed. This is your move.', restrict: 'Shields and immunity absorb it. The result must be legal.',
  steps: [sq('Choose any square on the rank', ctx => squares(ctx.s, (p, i) => F(i) === 0 && squares(ctx.s, (q, j) => q && q.t === 'p' && R(j) === R(i)).length > 0))],
  apply(ctx, [a]) { let n = 0; for (const x of squares(ctx.s, (q, j) => q && q.t === 'p' && R(j) === R(a))) if (destroy(ctx.s, x) === true) n++; return `rank ${R(a) + 1}: ${n} pawns`; } });

leg({ id: 'rewind', name: 'Rewind', timing: 'action', dur: D.instant, vfx: 'rewind', tags: ['rewind', 'tempo'],
  text: 'Restore the exact position from your previous turn, undoing your last move and your opponent\'s reply. Then move again.', restrict: 'Spent cards stay spent.',
  can(ctx) { const lt = ctx.s.lastTurn && ctx.s.lastTurn[ctx.me]; return lt && lt.ply === ctx.s.ply - 2 ? true : 'No previous turn to return to'; }, steps: [],
  apply(ctx) { const lt = ctx.s.lastTurn[ctx.me]; restore(ctx.s, lt.snap); ctx.restored = lt.snap; return 'time rewound'; } });

leg({ id: 'ascension', name: 'Ascension', timing: 'arm', dur: 'Your move this turn (its threat lasts until your next turn)', vfx: 'empower', tags: ['knight', 'tempo'],
  text: 'This turn, all your bishops, rooks and queens may also move like knights.', restrict: 'Cannot be used if it would give check right away.', steps: [],
  can(ctx) { return own(ctx, ['b', 'r', 'q']).length ? true : 'No pieces to ascend'; }, apply(ctx) { own(ctx, ['b', 'r', 'q']).forEach(x => addFx(ctx.s, x, 'mvN', T.myNext(ctx.s))); return 'ascended'; } });

leg({ id: 'iron_will', name: 'Iron Will', timing: 'action', dur: D.round, vfx: 'ward', tags: ['defense'],
  text: 'For the rest of the round, enemy cards cannot target your pieces and enemy traps ignore them. Removes current freezes and disarms from your pieces.', restrict: 'Does not stop normal captures.', steps: [],
  can(ctx) { return (ctx.s.pfx[ctx.me].iron || 0) > ctx.s.ply ? 'Already active' : true; },
  apply(ctx) { ctx.s.pfx[ctx.me].iron = FOREVER; for (const x of own(ctx)) delFx(ctx.s, x, 'frozen', 'noCapture', 'bounty'); return 'iron will'; } });

export const CARDS = C;
const BY = Object.fromEntries(C.map(c => [c.id, c]));
export const byId = id => BY[id];
