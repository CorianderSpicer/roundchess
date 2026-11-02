// Match layer: modes, rounds, scoring, drafting with rarity weights, synergies and comeback picks.
import { W, B, opp, fromFEN, START_FEN } from '../engine/chess.js';
import { CARDS, byId, RARITIES, DEFAULT_WEIGHTS } from '../cards/defs.js';
import { beginTurn, makeInst, rand, log } from './round.js';
import { CHALLENGES } from './challenges.js';

export const PLAYER_COLORS = ['orange', 'blue'];
export const MODES = {
  classic: { name: 'Classic Chess', blurb: 'Pure chess, no cards. Local two-player.', cards: false },
  rounds: { name: 'Chess Rounds', blurb: 'Draft a card before every round. First to the target wins the match.', cards: true },
  endless: { name: 'Endless Rounds', blurb: 'No finish line. Card rarity climbs every round and you draft two cards each time.', cards: true },
  custom: { name: 'Custom Match', blurb: 'Choose the card pool, rarity weights, rounds and rules.', cards: true },
  challenge: { name: 'Challenge Mode', blurb: 'Puzzles and scenarios with fixed positions and cards.', cards: true },
};

export const DEFAULT_SETTINGS = {
  targetWins: 3, cardsPerTurn: 1, draftSize: 3, startPicks: 1, skip: true, comeback: true, weights: { ...DEFAULT_WEIGHTS },
  rarities: { common: true, uncommon: true, rare: true, epic: true, legendary: true }, disabled: [], loadout: { 0: [], 1: [] },
  drawEachTurn: false, handCap: 5,
  clock: 'none', hiddenHands: false, alternateColors: true, names: ['Orange', 'Blue'],
};
export const CLOCKS = { none: null, '3+2': [180, 2], '5+3': [300, 3], '10+5': [600, 5], '15+10': [900, 10] };

export function newMatch(mode, settings = {}, seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0) {
  const st = { ...DEFAULT_SETTINGS, ...settings, weights: { ...DEFAULT_WEIGHTS, ...(settings.weights || {}) } };
  if (mode === 'classic') { st.startPicks = 0; }
  if (mode === 'classic' || mode === 'challenge') st.drawEachTurn = false;
  if (mode === 'endless') { st.targetWins = Infinity; }
  const G = {
    v: 1, mode, settings: st, seed, round: 0, phase: 'menu', s: null, fxq: [], log: [], history: [],
    players: [0, 1].map(i => ({ name: st.names[i], deck: [], score: 0, color: PLAYER_COLORS[i] })),
    whiteIdx: 0, hands: { w: [], b: [] }, results: [], stats: null, draft: null, challenge: null,
  };
  G.pool = CARDS.filter(c => st.rarities[c.rarity] && !st.disabled.includes(c.id)).map(c => c.id);
  for (const i of [0, 1]) for (const id of (st.loadout[i] || [])) if (byId(id)) G.players[i].deck.push({ id, usedMatch: 0 });
  return G;
}

export const playerOf = (G, color) => (color === W ? G.whiteIdx : 1 - G.whiteIdx);
export const colorOf = (G, idx) => (idx === G.whiteIdx ? W : B);
export const usesCards = G => MODES[G.mode].cards;

// Begin a match: drafting first if the mode uses cards
export function startMatch(G) {
  if (G.mode === 'challenge') return;
  if (usesCards(G) && G.settings.startPicks > 0) return openDraft(G, null, G.settings.startPicks);
  return startRound(G);
}

export function startRound(G, fen = START_FEN) {
  G.round++;
  if (G.round > 1 && G.settings.alternateColors && G.mode !== 'challenge') G.whiteIdx = 1 - G.whiteIdx;
  const s = fromFEN(fen);
  Object.assign(s, { phase: 'pre', cardsPlayed: 0, cardsPerTurn: G.settings.cardsPerTurn, lastTurn: { w: null, b: null }, lastCard: { w: null, b: null }, events: [], turnMoves: [], bonus: null, pending: null, result: null, sight: null });
  G.s = s; G.phase = 'play'; G.history = []; G.log = []; G.draft = null;
  G.stats = { w: { moves: 0, captures: 0, cards: 0 }, b: { moves: 0, captures: 0, cards: 0 } };
  G.hands = { w: [], b: [] };
  for (const c of [W, B]) {
    const P = G.players[playerOf(G, c)];
    if (usesCards(G)) P.deck.forEach((e, i) => {
      const d = byId(e.id);
      G.hands[c].push(makeInst(e.id, { left: d.per === 'match' ? Math.max(0, d.uses - e.usedMatch) : d.uses, deckRef: e, deckIdx: i }));
    });
  }
  const cl = CLOCKS[G.settings.clock];
  G.clock = cl ? { w: cl[0] * 1000, b: cl[0] * 1000, inc: cl[1] * 1000 } : null;
  G.onRoundEnd = onRoundEnd;
  log(G, W, `Round ${G.round}: ${G.players[G.whiteIdx].name} plays White`, 'round');
  beginTurn(G);
  return G;
}

function onRoundEnd(G, winner, reason) {
  const wi = winner ? playerOf(G, winner) : null;
  if (wi != null) G.players[wi].score++;
  G.results.push({ round: G.round, winner: wi, reason, white: G.whiteIdx });
  if (G.mode === 'challenge') { G.phase = 'roundEnd'; return; }
  const over = G.players.some(p => p.score >= G.settings.targetWins) || (G.mode === 'classic' && G.settings.targetWins <= 1);
  G.phase = over ? 'matchEnd' : 'roundEnd';
}

export function matchWinner(G) { const [a, b] = G.players; return a.score === b.score ? null : (a.score > b.score ? 0 : 1); }

// After the round result screen
export function continueAfterRound(G) {
  if (G.phase === 'matchEnd') return;
  if (!usesCards(G)) return startRound(G);
  const last = G.results[G.results.length - 1];
  const loser = last && last.winner != null ? 1 - last.winner : null;
  openDraft(G, loser, G.mode === 'endless' ? 2 : 1);
}

// ---------- drafting ----------
export function weightsFor(G) {
  const w = { ...G.settings.weights };
  if (G.mode === 'endless') {
    // progressively stronger: each round shifts weight from low tiers to high tiers
    const r = Math.max(0, G.round - 1);
    RARITIES.forEach((k, i) => { w[k] = w[k] * Math.pow(1 + 0.22 * r, i - 1.2); });
  }
  return w;
}

export function deckTags(P) { const t = {}; for (const e of P.deck) for (const g of byId(e.id).tags) t[g] = (t[g] || 0) + 1; return t; }
export function synergy(P, id) { const t = deckTags(P); return byId(id).tags.filter(g => t[g] && g !== 'draw').length; }

export const offerWeight = (P, w, id) => (w[byId(id).rarity] || 0) * (1 + 0.6 * Math.min(2, synergy(P, id)));

export function rollOffers(G, idx, n, { comeback = false } = {}) {
  const P = G.players[idx], w = weightsFor(G);
  const owned = new Set(P.deck.map(e => e.id));
  let pool = G.pool.filter(id => !owned.has(id));
  if (pool.length < n) pool = [...G.pool];
  const out = [];
  const pickOne = (filter) => {
    const cand = pool.filter(id => !out.includes(id) && (!filter || filter(byId(id))));
    if (!cand.length) return null;
    const ws = cand.map(id => offerWeight(P, w, id));
    const tot = ws.reduce((a, b) => a + b, 0) || 1;
    let r = rand(G) * tot;
    for (let i = 0; i < cand.length; i++) { r -= ws[i]; if (r <= 0) return cand[i]; }
    return cand[cand.length - 1];
  };
  for (let i = 0; i < n; i++) { const id = pickOne(); if (id) out.push(id); }
  if (comeback) { const id = pickOne(d => ['rare', 'epic', 'legendary'].includes(d.rarity)); if (id) out.push(id); }
  if (G.mode === 'endless' && G.round > 0 && G.round % 3 === 0) { const id = pickOne(d => d.rarity === 'legendary'); if (id) out.push(id); }
  return out;
}

// loser: player index that lost the last round (gets comeback options), picks: cards each player takes
export function openDraft(G, loser, picks = 1) {
  const comeback = G.settings.comeback && loser != null;
  G.phase = 'draft';
  const order = loser != null ? [loser, 1 - loser] : [0, 1];
  G.draft = {
    order, turn: 0, stage: 'curtain', picks, loser, chosen: { 0: [], 1: [] }, rerolls: { 0: comeback && loser === 0 ? 1 : 0, 1: comeback && loser === 1 ? 1 : 0 },
    offers: { 0: rollOffers(G, 0, G.settings.draftSize, { comeback: comeback && loser === 0 }), 1: rollOffers(G, 1, G.settings.draftSize, { comeback: comeback && loser === 1 }) },
    left: { 0: picks, 1: picks },
  };
  return G;
}

export const drafter = G => G.draft.order[G.draft.turn];
export function revealDraft(G) { if (G.draft) G.draft.stage = 'pick'; }

export function reroll(G) {
  const d = G.draft, i = drafter(G);
  if (!d.rerolls[i]) return false;
  d.rerolls[i]--;
  d.offers[i] = rollOffers(G, i, G.settings.draftSize, { comeback: G.settings.comeback && d.loser === i });
  return true;
}

export function draftPick(G, id) {
  const d = G.draft, i = drafter(G);
  if (id) {
    if (!d.offers[i].includes(id)) return false;
    G.players[i].deck.push({ id, usedMatch: 0 });
    d.chosen[i].push(id);
    d.offers[i] = d.offers[i].filter(x => x !== id);
  } else if (!G.settings.skip) return false;
  else d.chosen[i].push(null);
  d.left[i]--;
  if (d.left[i] > 0 && d.offers[i].length) return true; // same player picks again
  d.left[i] = 0;
  if (d.turn === 0) { d.turn = 1; d.stage = 'curtain'; return true; }
  d.stage = 'reveal';
  return true;
}

export function finishDraft(G) { G.draft = null; startRound(G); }

// ---------- challenges ----------
export function startChallenge(G, chId) {
  const ch = CHALLENGES.find(c => c.id === chId);
  G.challenge = { id: ch.id, kind: ch.kind, solved: false, attempts: (G.challenge && G.challenge.id === chId ? G.challenge.attempts : 0) + 1 };
  G.players.forEach(p => { p.deck = []; p.score = 0; });
  G.players[0].deck = (ch.cards.w || []).map(id => ({ id, usedMatch: 0 }));
  G.players[1].deck = (ch.cards.b || []).map(id => ({ id, usedMatch: 0 }));
  G.whiteIdx = 0; G.round = 0;
  startRound(G, ch.fen);
  if (ch.kind === 'puzzle') G.s.puzzle = { by: W, ply: G.s.ply };
  return ch;
}

// Puzzle check: called by the UI after each state change
export function puzzleState(G) {
  const s = G.s; if (!s || !s.puzzle) return null;
  if (s.phase === 'over') return s.result && s.result.winner === W && s.result.reason === 'checkmate' ? 'solved' : 'failed';
  if (s.ply > s.puzzle.ply) return 'failed';
  return 'playing';
}

export { opp, W, B };

// ---------- save / load (JSON; shared references are re-linked on load) ----------
export function serialize(G) {
  return JSON.stringify(G, (k, v) => (k === 'deckRef' || k === 'onRoundEnd' || k === 'fxq' ? undefined : v === Infinity ? '__inf' : v));
}
export function deserialize(str) {
  const G = JSON.parse(str, (k, v) => (v === '__inf' ? Infinity : v));
  G.fxq = []; G.onRoundEnd = onRoundEnd;
  if (G.hands) for (const c of [W, B]) for (const h of G.hands[c]) if (h.deckIdx != null) h.deckRef = G.players[playerOf(G, c)].deck[h.deckIdx];
  return G;
}
