// Chess Rounds rules engine.
// Full standard chess (legal moves, check, mate, castling, en passant, promotion, stalemate,
// 50-move rule, threefold repetition, insufficient material) plus the hooks card effects use:
// per-piece statuses (frozen, immune, shield, noCapture, extra movement), walls and traps.
//
// Squares are 0..63, index = rank * 8 + file, a1 = 0, h8 = 63.
// King safety is always computed conservatively: a piece "attacks" a square by geometry,
// ignoring freezes, disarms and walls, so no status can expire into an illegal position.

export const W = 'w', B = 'b';
export const opp = c => (c === W ? B : W);
export const F = s => s & 7, R = s => s >> 3;
export const sqName = s => 'abcdefgh'[s & 7] + ((s >> 3) + 1);
export const sqIdx = n => (n.charCodeAt(1) - 49) * 8 + (n.charCodeAt(0) - 97);
export const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const NAME = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };

const KN = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KG = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const CM = [[1, 3], [3, 1], [3, -1], [1, -3], [-1, -3], [-3, -1], [-3, 1], [-1, 3]];
export const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]], ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export function off(s, df, dr) { const f = F(s) + df, r = R(s) + dr; return f < 0 || f > 7 || r < 0 || r > 7 ? -1 : r * 8 + f; }
const table = d => Array.from({ length: 64 }, (_, s) => d.map(([a, b]) => off(s, a, b)).filter(x => x >= 0));
export const NT = table(KN), KT = table(KG), CT = table(CM);
export const adjacent = (a, b) => a !== b && Math.abs(F(a) - F(b)) <= 1 && Math.abs(R(a) - R(b)) <= 1;

// ---------- state ----------
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function fromFEN(fen) {
  const [pos, turn, cas, ep, half, full] = fen.trim().split(/\s+/);
  const board = Array(64).fill(null);
  let id = 1;
  pos.split('/').forEach((row, i) => {
    let f = 0; const r = 7 - i;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      const c = ch === ch.toUpperCase() ? W : B;
      board[r * 8 + f] = { t: ch.toLowerCase(), c, id: id++, home: r * 8 + f, fx: {} };
      f++;
    }
  });
  return {
    board, turn: turn || W, castle: cas && cas !== '-' ? cas : '', ep: ep && ep !== '-' ? sqIdx(ep) : -1,
    half: +(half || 0), full: +(full || 1), ply: 0, nextId: id, walls: [], traps: [], pfx: { w: {}, b: {} },
    captured: { w: [], b: [] }, keys: [], noFx: -1,
  };
}

export function toFEN(s) {
  let out = '';
  for (let r = 7; r >= 0; r--) {
    let e = 0;
    for (let f = 0; f < 8; f++) {
      const p = s.board[r * 8 + f];
      if (!p) { e++; continue; }
      if (e) { out += e; e = 0; }
      out += p.c === W ? p.t.toUpperCase() : p.t;
    }
    if (e) out += e;
    if (r) out += '/';
  }
  return `${out} ${s.turn} ${s.castle || '-'} ${s.ep >= 0 ? sqName(s.ep) : '-'} ${s.half} ${s.full}`;
}

export const kingSq = (s, c) => { for (let i = 0; i < 64; i++) { const p = s.board[i]; if (p && p.t === 'k' && p.c === c) return i; } return -1; };
export const has = (s, p, k) => !!(p && p.fx && p.fx[k] != null && p.fx[k] > s.ply);
export const fxOn = s => s.noFx !== s.ply; // restrictions are lifted for one ply by the "restriction break" rule
export const wallAt = (s, sq) => s.walls.some(w => w.sq === sq && w.until > s.ply);

// ---------- attacks (geometry, conservative) ----------
function slideHits(s, from, dirs, target, phaseColor) {
  for (const [df, dr] of dirs) {
    let x = from;
    for (;;) {
      x = off(x, df, dr);
      if (x < 0) break;
      if (x === target) return true;
      const p = s.board[x];
      if (p && !(phaseColor && p.c === phaseColor)) break;
    }
  }
  return false;
}

// Can the piece on `from` capture on `target` by geometry (ignores whose piece is on target)?
export function pieceAttacks(s, from, target) {
  const p = s.board[from]; if (!p) return false;
  const ph = has(s, p, 'phase') ? p.c : null;
  switch (p.t) {
    case 'p': {
      const d = p.c === W ? 1 : -1;
      if (R(target) - R(from) === d && Math.abs(F(target) - F(from)) === 1) return true;
      if (has(s, p, 'pawnFwdCap') && target === off(from, 0, d)) return true;
      return false;
    }
    case 'n': if (NT[from].includes(target)) return true; break;
    case 'b': if (slideHits(s, from, DIAG, target, ph)) return true; break;
    case 'r': if (slideHits(s, from, ORTH, target, ph)) return true; break;
    case 'q': if (slideHits(s, from, DIAG, target, ph) || slideHits(s, from, ORTH, target, ph)) return true; break;
    case 'k': return KT[from].includes(target);
  }
  if (has(s, p, 'mvN') && NT[from].includes(target)) return true;
  if (has(s, p, 'mvK') && KT[from].includes(target)) return true;
  if (has(s, p, 'mvCamel') && CT[from].includes(target)) return true;
  if (has(s, p, 'mvB') && slideHits(s, from, DIAG, target, ph)) return true;
  if (has(s, p, 'mvR') && slideHits(s, from, ORTH, target, ph)) return true;
  return false;
}

export function attackers(s, sq, by) {
  const out = [];
  for (let i = 0; i < 64; i++) { const p = s.board[i]; if (p && p.c === by && i !== sq && pieceAttacks(s, i, sq)) out.push(i); }
  return out;
}

const hasFx = p => p.fx && Object.keys(p.fx).length;
// Fast path for plain positions; falls back to the generic check when any piece has movement statuses.
export function attacked(s, sq, by) {
  const b = s.board;
  // pawns
  const pd = by === W ? -1 : 1;
  for (const df of [-1, 1]) { const x = off(sq, df, pd); if (x >= 0) { const p = b[x]; if (p && p.c === by && p.t === 'p') return true; } }
  for (const x of NT[sq]) { const p = b[x]; if (p && p.c === by && p.t === 'n') return true; }
  for (const x of KT[sq]) { const p = b[x]; if (p && p.c === by && p.t === 'k') return true; }
  for (const [df, dr] of DIAG) { let x = sq; for (;;) { x = off(x, df, dr); if (x < 0) break; const p = b[x]; if (p) { if (p.c === by && (p.t === 'b' || p.t === 'q')) return true; break; } } }
  for (const [df, dr] of ORTH) { let x = sq; for (;;) { x = off(x, df, dr); if (x < 0) break; const p = b[x]; if (p) { if (p.c === by && (p.t === 'r' || p.t === 'q')) return true; break; } } }
  for (let i = 0; i < 64; i++) { const p = b[i]; if (p && p.c === by && hasFx(p) && i !== sq && pieceAttacks(s, i, sq)) return true; }
  return false;
}

export const inCheck = (s, c) => { const k = kingSq(s, c); return k >= 0 && attacked(s, k, opp(c)); };

// ---------- move generation ----------
const PROMOS = ['q', 'r', 'b', 'n'];

function canLand(s, p, to, restrict) {
  // returns 0 = blocked, 1 = quiet, 2 = capture, 3 = bounce (shield)
  if (restrict && wallAt(s, to)) return 0;
  const q = s.board[to];
  if (!q) return 1;
  if (q.c === p.c || q.t === 'k') return 0;
  if (restrict) {
    if (has(s, p, 'noCapture')) return 0;
    if (has(s, q, 'immune')) return 0;
    if (has(s, q, 'shield')) return 3;
  }
  return 2;
}

function push(out, from, to, kind, extra) {
  const m = { from, to };
  if (kind === 2) m.cap = true; else if (kind === 3) m.bounce = true;
  if (extra) Object.assign(m, extra);
  out.push(m);
}

function slideGen(s, p, from, dirs, out, restrict) {
  const ph = has(s, p, 'phase');
  for (const [df, dr] of dirs) {
    let x = from;
    for (;;) {
      x = off(x, df, dr);
      if (x < 0) break;
      if (restrict && wallAt(s, x)) break;
      const q = s.board[x];
      if (q && ph && q.c === p.c) continue; // phase: pass through friendly pieces
      const k = canLand(s, p, x, restrict);
      if (k) push(out, from, x, k);
      if (q) break;
    }
  }
}

function stepGen(s, p, from, tbl, out, restrict) { for (const x of tbl[from]) { const k = canLand(s, p, x, restrict); if (k) push(out, from, x, k); } }

export function pseudoMoves(s, from, restrict = fxOn(s)) {
  const p = s.board[from]; const out = [];
  if (!p) return out;
  if (restrict && has(s, p, 'frozen')) return out;
  if (p.t === 'p') {
    const d = p.c === W ? 1 : -1, last = p.c === W ? 7 : 0, start = p.c === W ? 1 : 6;
    const addP = (to, kind, extra) => { if (R(to) === last) for (const pr of PROMOS) push(out, from, to, kind, { ...extra, promo: pr }); else push(out, from, to, kind, extra); };
    const one = off(from, 0, d);
    if (one >= 0 && !s.board[one] && !(restrict && wallAt(s, one))) {
      addP(one, 1);
      const two = off(from, 0, 2 * d);
      if (R(from) === start && two >= 0 && !s.board[two] && !(restrict && wallAt(s, two))) push(out, from, two, 1, { dbl: true });
    }
    if (has(s, p, 'pawnFwdCap') && one >= 0 && s.board[one]) { const k = canLand(s, p, one, restrict); if (k >= 2) addP(one, k); }
    for (const df of [-1, 1]) {
      const x = off(from, df, d); if (x < 0) continue;
      const q = s.board[x];
      if (q) { const k = canLand(s, p, x, restrict); if (k >= 2) addP(x, k); }
      else if (x === s.ep && !(restrict && (wallAt(s, x) || has(s, p, 'noCapture')))) {
        const vic = s.board[x - 8 * d];
        if (vic && vic.t === 'p' && vic.c !== p.c && !(restrict && has(s, vic, 'immune'))) push(out, from, x, 2, { epc: x - 8 * d });
      } else if (has(s, p, 'pawnDiag') && !(restrict && wallAt(s, x)) && R(x) !== last) push(out, from, x, 1, { slant: true });
    }
    return out;
  }
  switch (p.t) {
    case 'n': stepGen(s, p, from, NT, out, restrict); break;
    case 'b': slideGen(s, p, from, DIAG, out, restrict); break;
    case 'r': slideGen(s, p, from, ORTH, out, restrict); break;
    case 'q': slideGen(s, p, from, DIAG, out, restrict); slideGen(s, p, from, ORTH, out, restrict); break;
    case 'k': stepGen(s, p, from, KT, out, restrict); castleGen(s, p, from, out, restrict); return out;
  }
  if (has(s, p, 'mvN')) stepGen(s, p, from, NT, out, restrict);
  if (has(s, p, 'mvK')) stepGen(s, p, from, KT, out, restrict);
  if (has(s, p, 'mvCamel')) stepGen(s, p, from, CT, out, restrict);
  if (has(s, p, 'mvB')) slideGen(s, p, from, DIAG, out, restrict);
  if (has(s, p, 'mvR')) slideGen(s, p, from, ORTH, out, restrict);
  // dedupe (extra movement can overlap normal movement)
  const seen = new Set();
  return out.filter(m => { const k = m.to; if (seen.has(k)) return false; seen.add(k); return true; });
}

function castleGen(s, k, from, out, restrict) {
  const c = k.c, home = c === W ? 4 : 60;
  if (from !== home) return;
  const rights = c === W ? ['K', 'Q'] : ['k', 'q'];
  const e = opp(c);
  for (const r of rights) {
    if (!s.castle.includes(r)) continue;
    const side = r.toUpperCase() === 'K' ? 1 : -1;
    const rookSq = side === 1 ? home + 3 : home - 4;
    const rook = s.board[rookSq];
    if (!rook || rook.t !== 'r' || rook.c !== c) continue;
    if (restrict && (has(s, rook, 'frozen') || has(s, k, 'frozen'))) continue;
    let clear = true;
    for (let x = Math.min(home, rookSq) + 1; x < Math.max(home, rookSq); x++) if (s.board[x] || (restrict && wallAt(s, x))) clear = false;
    if (!clear) continue;
    if (attacked(s, home, e) || attacked(s, home + side, e) || attacked(s, home + 2 * side, e)) continue;
    out.push({ from, to: home + 2 * side, castle: side === 1 ? 'K' : 'Q', rookFrom: rookSq, rookTo: home + side });
  }
}

// Apply a move to a shallow copy (board array copied, pieces shared). Pure: never mutates `s`.
export function applyMove(s, m) {
  const b = s.board.slice();
  const n = { ...s, board: b };
  const p = b[m.from];
  let castle = s.castle;
  if (m.bounce) { n.ep = -1; return n; } // capture repelled by a shield: nothing moves
  const captured = m.epc != null ? b[m.epc] : b[m.to];
  if (m.epc != null) b[m.epc] = null;
  b[m.to] = m.promo ? { ...p, t: m.promo, fx: { ...p.fx } } : p;
  b[m.from] = null;
  if (m.castle) { b[m.rookTo] = b[m.rookFrom]; b[m.rookFrom] = null; }
  if (p.t === 'k') castle = castle.replace(p.c === W ? /[KQ]/g : /[kq]/g, '');
  const strip = sq => { if (sq === 0) castle = castle.replace('Q', ''); if (sq === 7) castle = castle.replace('K', ''); if (sq === 56) castle = castle.replace('q', ''); if (sq === 63) castle = castle.replace('k', ''); };
  strip(m.from); strip(m.to);
  n.castle = castle;
  n.ep = m.dbl ? (m.from + m.to) >> 1 : -1;
  n._captured = captured || null;
  return n;
}

export function isLegal(s, m) {
  const c = s.board[m.from].c;
  if (m.bounce) return !inCheck(s, c);
  const n = applyMove(s, m);
  return !inCheck(n, c);
}

export function legalMovesFrom(s, from, restrict = fxOn(s)) { return pseudoMoves(s, from, restrict).filter(m => isLegal(s, m)); }

export function legalMoves(s, c = s.turn, restrict = fxOn(s)) {
  const out = [];
  for (let i = 0; i < 64; i++) { const p = s.board[i]; if (p && p.c === c) for (const m of pseudoMoves(s, i, restrict)) if (isLegal(s, m)) out.push(m); }
  return out;
}

export function hasLegalMove(s, c = s.turn, restrict = fxOn(s)) {
  for (let i = 0; i < 64; i++) { const p = s.board[i]; if (p && p.c === c) for (const m of pseudoMoves(s, i, restrict)) if (isLegal(s, m)) return true; }
  return false;
}

// Full make for perft / pure play (turn, clocks)
export function play(s, m) {
  const n = applyMove(s, m);
  const p = s.board[m.from];
  n.half = (p.t === 'p' || n._captured) ? 0 : s.half + 1;
  if (s.turn === B) n.full = s.full + 1;
  n.turn = opp(s.turn);
  delete n._captured;
  return n;
}

export function perft(s, d) {
  if (d === 0) return 1;
  const ms = legalMoves(s, s.turn, false);
  if (d === 1) return ms.length;
  let t = 0; for (const m of ms) t += perft(play(s, m), d - 1);
  return t;
}

// ---------- position validity (what every card result must satisfy) ----------
export function validPosition(s, sideToMove) {
  let wk = 0, bk = 0;
  for (let i = 0; i < 64; i++) {
    const p = s.board[i]; if (!p) continue;
    if (p.t === 'k') p.c === W ? wk++ : bk++;
    if (p.t === 'p' && (R(i) === 0 || R(i) === 7)) return false;
  }
  if (wk !== 1 || bk !== 1) return false;
  if (inCheck(s, opp(sideToMove))) return false; // the side that is not to move may never be in check
  // kings may never touch
  return !adjacent(kingSq(s, W), kingSq(s, B));
}

// ---------- draw rules ----------
export function posKey(s) {
  let k = '';
  for (let i = 0; i < 64; i++) { const p = s.board[i]; k += p ? (p.c === W ? p.t.toUpperCase() : p.t) : '.'; }
  let ep = '-';
  if (s.ep >= 0) {
    const d = s.turn === W ? -1 : 1;
    for (const df of [-1, 1]) { const x = off(s.ep, df, d); if (x >= 0 && s.board[x] && s.board[x].t === 'p' && s.board[x].c === s.turn) ep = s.ep; }
  }
  return `${k}|${s.turn}|${s.castle}|${ep}`;
}

export function insufficient(s) {
  const pcs = []; for (let i = 0; i < 64; i++) { const p = s.board[i]; if (p && p.t !== 'k') pcs.push([p, i]); }
  if (pcs.length === 0) return true;
  if (pcs.length === 1 && (pcs[0][0].t === 'n' || pcs[0][0].t === 'b')) return true;
  if (pcs.every(([p]) => p.t === 'b')) { const col = new Set(pcs.map(([, i]) => (F(i) + R(i)) & 1)); if (col.size === 1) return true; }
  return false;
}

// ---------- notation ----------
export function san(s, m, after) {
  const p = s.board[m.from];
  let t;
  if (m.castle) t = m.castle === 'K' ? 'O-O' : 'O-O-O';
  else {
    const cap = m.cap || m.bounce;
    if (p.t === 'p') t = (cap ? 'abcdefgh'[F(m.from)] + 'x' : '') + sqName(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
    else {
      const L = p.t.toUpperCase();
      const rivals = legalMoves(s, p.c).filter(o => o.to === m.to && o.from !== m.from && s.board[o.from].t === p.t);
      let dis = '';
      if (rivals.length) {
        if (!rivals.some(o => F(o.from) === F(m.from))) dis = 'abcdefgh'[F(m.from)];
        else if (!rivals.some(o => R(o.from) === R(m.from))) dis = String(R(m.from) + 1);
        else dis = sqName(m.from);
      }
      t = L + dis + (cap ? 'x' : '') + sqName(m.to);
    }
    if (m.bounce) t += '⛨';
  }
  if (after) {
    const e = opp(p.c);
    if (inCheck(after, e)) t += hasLegalMove({ ...after, turn: e }, e) ? '+' : '#';
  }
  return t;
}
