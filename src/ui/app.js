// Chess Rounds UI: screens, shared-screen play, private drafting, effects and input.
import { W, B, opp, F, R, sqName, kingSq, inCheck, legalMovesFrom, DIAG, off, has, NAME } from '../engine/chess.js';
import { CARDS, byId, RARITIES, RARITY_LABEL, TIMING_LABEL, DEFAULT_WEIGHTS } from '../cards/defs.js';
import { currentMoves, doMove, playCard, cardStatus, cardOptions, react, skipBonus, endPost, resign, agreeDraw, flag, cardLimit } from '../game/round.js';
import { MODES, DEFAULT_SETTINGS, CLOCKS, newMatch, startMatch, playerOf, colorOf, usesCards, drafter, revealDraft, draftPick, reroll, finishDraft, continueAfterRound, matchWinner, synergy, startChallenge, puzzleState, serialize, deserialize } from '../game/match.js';
import { CHALLENGES } from '../game/challenges.js';
import { pieceSVG, icon } from './art.js';
import { sfx, setSound } from './audio.js';

const $ = (q, el = document) => el.querySelector(q);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } }, raw(k) { try { return localStorage.getItem(k); } catch { return null; } }, setRaw(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }, del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } } };

const CFG = { sound: true, orient: 'p1', tabletop: false, motion: true, ...store.get('cr.cfg', {}) };
const saveCfg = () => { store.set('cr.cfg', CFG); setSound(CFG.sound); document.body.classList.toggle('calm', !CFG.motion); };
let SETUP = { ...DEFAULT_SETTINGS, ...store.get('cr.setup', {}) };
// Setups saved while 'draw every turn' defaulted to on go back to off once.
if (!store.get('cr.setupv', 0)) { SETUP.drawEachTurn = false; store.set('cr.setup', SETUP); store.set('cr.setupv', 2); }
SETUP.weights = { ...DEFAULT_WEIGHTS, ...(SETUP.weights || {}) };
SETUP.rarities = { ...DEFAULT_SETTINGS.rarities, ...(SETUP.rarities || {}) };
SETUP.loadout = SETUP.loadout || { 0: [], 1: [] };
SETUP.disabled = SETUP.disabled || [];

let G = null;
const U = { screen: 'menu', setupMode: 'rounds', sel: null, target: null, detail: null, promo: null, cursor: 12, focus: 0, reveal: { w: false, b: false }, hist: false, lib: { r: 'all', q: '' }, ann: [], annBusy: false, lastPly: -1, ended: null, menuOpen: false };
window.__CR = { get G() { return G; }, U };

// ---------- helpers ----------
const P = c => G.players[playerOf(G, c)];
const pName = c => esc(P(c).name);
const pCls = c => 'pl-' + P(c).color;
const actor = () => { const s = G.s; return s.phase === 'react' && s.pending ? s.pending.color : s.turn; };
const bottomColor = () => (CFG.orient === 'white' ? W : colorOf(G, 0));
const save = () => { if (G && G.mode !== 'challenge') store.setRaw('cr.save', serialize(G)); };
const pips = (n, left) => Array.from({ length: n }, (_, i) => `<i class="${i < left ? 'on' : ''}"></i>`).join('');

function cardFace(id, { inst, size = 'm', status, extra = '', syn = 0 } = {}) {
  const d = byId(id);
  const left = inst ? inst.left : d.uses;
  return `<div class="card r-${d.rarity} ${size} ${status && !status.ok ? 'off' : ''} ${inst && inst.left <= 0 ? 'spent' : ''}" ${extra}>
    <div class="c-top"><span class="c-ic">${icon(d.vfx)}</span><span class="c-rar">${RARITY_LABEL[d.rarity]}</span></div>
    <div class="c-name">${esc(d.name)}</div>
    <div class="c-time">${TIMING_LABEL[d.timing]}${d.free ? ' · free' : ''}</div>
    ${size !== 's' ? `<p class="c-text">${esc(d.text)}</p><dl class="c-meta"><dt>Lasts</dt><dd>${esc(d.dur)}</dd><dt>Limits</dt><dd>${esc(d.restrict)}</dd><dt>Uses</dt><dd>${d.uses} per ${d.per}${d.cd ? `, cooldown ${d.cd}` : ''}</dd></dl>` : ''}
    <div class="c-uses" title="${left} of ${d.uses} uses left">${pips(d.uses, left)}</div>
    ${syn ? `<div class="c-syn">Synergy with your deck</div>` : ''}
    ${inst && inst.temp ? '<div class="c-temp">This round</div>' : ''}
  </div>`;
}
const cardBack = () => `<div class="card back s"><div class="c-name">Chess<br>Rounds</div></div>`;

// ---------- render ----------
const app = () => $('#app');
export function render() {
  const sc = U.screen;
  document.body.dataset.screen = sc;
  if (sc === 'menu') return renderMenu();
  if (sc === 'setup') return renderSetup();
  if (sc === 'challenges') return renderChallenges();
  if (sc === 'library') return renderLibrary();
  if (sc === 'howto') return renderHowto();
  if (sc === 'settings') return renderSettings();
  if (sc === 'draft') return renderDraft();
  if (sc === 'play') return renderPlay();
}

function renderMenu() {
  const saved = store.raw('cr.save');
  app().innerHTML = `<div class="menu">
    <h1 class="logo"><span class="lo">Chess</span><span class="lb">Rounds</span></h1>
    <p class="tag">Two players. One board. A deck that grows every round.</p>
    <div class="modes">
      ${saved ? `<button class="mode cont" data-act="continue"><b>Continue match</b><span>Pick up where you left off</span></button>` : ''}
      ${Object.entries(MODES).map(([k, m]) => `<button class="mode m-${k}" data-act="mode" data-arg="${k}"><b>${m.name}</b><span>${m.blurb}</span></button>`).join('')}
    </div>
    <nav class="menu-links"><button data-act="go" data-arg="library">Card library (${CARDS.length})</button><button data-act="go" data-arg="howto">How to play</button><button data-act="go" data-arg="settings">Settings</button></nav>
    <p class="fine">Local couch play only: both players share this device.</p>
  </div>`;
}

function toggle(name, label, on, hint = '') { return `<label class="tog"><input type="checkbox" data-set="${name}" ${on ? 'checked' : ''}><span>${label}${hint ? `<small>${hint}</small>` : ''}</span></label>`; }
function num(name, label, v, min, max) { return `<label class="num"><span>${label}</span><span class="stepper"><button data-act="step" data-arg="${name}:-1" aria-label="Less">−</button><output>${v}</output><button data-act="step" data-arg="${name}:1" aria-label="More">+</button></span></label>`; }
function renderSetup() {
  const m = U.setupMode, st = SETUP, cards = MODES[m].cards;
  app().innerHTML = `<div class="page setup">
    <header class="ph"><button class="back" data-act="go" data-arg="menu">Back</button><h2>${MODES[m].name}</h2></header>
    <p class="lead">${MODES[m].blurb}</p>
    <section class="names">
      <label class="pname pl-orange"><span>Player 1 (orange)</span><input maxlength="14" data-name="0" value="${esc(st.names[0])}"></label>
      <label class="pname pl-blue"><span>Player 2 (blue)</span><input maxlength="14" data-name="1" value="${esc(st.names[1])}"></label>
    </section>
    <section class="opts">
      ${m !== 'endless' ? num('targetWins', m === 'classic' ? 'Games to win' : 'Rounds to win', st.targetWins, 1, 9) : ''}
      <label class="num"><span>Clock</span><select data-sel="clock">${Object.keys(CLOCKS).map(k => `<option value="${k}" ${st.clock === k ? 'selected' : ''}>${k === 'none' ? 'No clock' : k + ' (min + sec)'}</option>`).join('')}</select></label>
      ${cards ? num('cardsPerTurn', 'Cards per turn', st.cardsPerTurn, 1, 3) + num('draftSize', 'Cards offered per draft', st.draftSize, 2, 6) + num('startPicks', 'Picks before round 1', st.startPicks, 0, 3) : ''}
      ${toggle('alternateColors', 'Swap colours every round', st.alternateColors)}
      ${cards ? toggle('skip', 'Allow skipping a pick', st.skip) + toggle('comeback', 'Comeback picks for the loser', st.comeback, 'An extra Rare-or-better option and one reroll') + toggle('drawEachTurn', 'Draw a card every turn', st.drawEachTurn, 'At the start of each turn you draw a random card for this round') + (st.drawEachTurn ? num('handCap', 'Most drawn cards held', st.handCap, 2, 9) : '') + toggle('hiddenHands', 'Hidden hands', st.hiddenHands, 'Cards stay face down until played or peeked') : ''}
    </section>
    ${m === 'custom' ? customBlock() : ''}
    <div class="go"><button class="big" data-act="start">Start match</button></div>
  </div>`;
}
function customBlock() {
  const st = SETUP;
  return `<section class="custom">
    <h3>Rarity weights</h3><p class="hint">How often each rarity appears in drafts. A weight of 0 removes it from drafts.</p>
    <div class="weights">${RARITIES.map(r => `<label class="w r-${r}"><span>${RARITY_LABEL[r]}</span><input type="range" min="0" max="100" value="${st.weights[r]}" data-weight="${r}"><output>${st.weights[r]}</output><input type="checkbox" data-rar="${r}" ${st.rarities[r] ? 'checked' : ''} aria-label="Include ${RARITY_LABEL[r]}"></label>`).join('')}</div>
    <h3>Card pool and starting cards</h3><p class="hint">Untick a card to remove it from drafts. Give either player a card to start the match with it.</p>
    <div class="pool">${CARDS.map(c => `<div class="prow r-${c.rarity} ${st.disabled.includes(c.id) ? 'dis' : ''}"><label><input type="checkbox" data-pool="${c.id}" ${st.disabled.includes(c.id) ? '' : 'checked'}><span class="dot"></span>${esc(c.name)}</label><button class="lo ${st.loadout[0].includes(c.id) ? 'on' : ''}" data-act="load" data-arg="0:${c.id}" title="Starting card for player 1">P1</button><button class="lb ${st.loadout[1].includes(c.id) ? 'on' : ''}" data-act="load" data-arg="1:${c.id}" title="Starting card for player 2">P2</button></div>`).join('')}</div>
  </section>`;
}

function renderChallenges() {
  const row = c => `<button class="chal" data-act="challenge" data-arg="${c.id}"><b>${esc(c.name)}</b><span>${esc(c.desc)}</span><span class="cards">${[...new Set([...c.cards.w, ...c.cards.b])].slice(0, 6).map(id => `<i class="r-${byId(id).rarity}">${esc(byId(id).name)}</i>`).join('')}</span></button>`;
  const solved = store.get('cr.solved', []);
  app().innerHTML = `<div class="page">
    <header class="ph"><button class="back" data-act="go" data-arg="menu">Back</button><h2>Challenge Mode</h2></header>
    <h3>Puzzles</h3><p class="hint">White to move. Checkmate this turn using the card you are given.</p>
    <div class="chals">${CHALLENGES.filter(c => c.kind === 'puzzle').map(c => row(c).replace('<b>', solved.includes(c.id) ? '<b class="ok">✓ ' : '<b>')).join('')}</div>
    <h3>Scenarios</h3><p class="hint">One round for two players, with fixed positions and hands.</p>
    <div class="chals">${CHALLENGES.filter(c => c.kind === 'scenario').map(row).join('')}</div>
  </div>`;
}

function renderLibrary() {
  const { r, q } = U.lib;
  const list = CARDS.filter(c => (r === 'all' || c.rarity === r) && (!q || (c.name + ' ' + c.text).toLowerCase().includes(q.toLowerCase())));
  app().innerHTML = `<div class="page lib">
    <header class="ph"><button class="back" data-act="go" data-arg="menu">Back</button><h2>Card library</h2></header>
    <div class="filters"><input type="search" placeholder="Search cards" value="${esc(q)}" data-input="libq" aria-label="Search cards">
      ${['all', ...RARITIES].map(x => `<button class="chip ${x === r ? 'on' : ''} ${x !== 'all' ? 'r-' + x : ''}" data-act="libr" data-arg="${x}">${x === 'all' ? `All ${CARDS.length}` : `${RARITY_LABEL[x]} ${CARDS.filter(c => c.rarity === x).length}`}</button>`).join('')}</div>
    <div class="libgrid">${list.map(c => cardFace(c.id, { size: 'l' })).join('') || '<p>No card matches that search.</p>'}</div>
  </div>`;
}

function renderHowto() {
  app().innerHTML = `<div class="page prose">
    <header class="ph"><button class="back" data-act="go" data-arg="menu">Back</button><h2>How to play</h2></header>
    <h3>The round</h3><p>Every round is a full game of chess with every normal rule: check, checkmate, castling, en passant, promotion, stalemate, threefold repetition, the 50-move rule and insufficient material. Win the round by checkmate, resignation or on the clock. First to the target score wins the match. Colours swap every round.</p>
    <h3>Your turn</h3><p>Before you move you may play cards (one per turn unless the match says otherwise). Then make your move. Some cards replace your move, some are played after it in a short after-move window, and reactions are played during your opponent's turn when their trigger happens: a capture, a card, or a checkmate.</p>
    <h3>Cards never break chess</h3><p>Every card is tried on a copy of the board first. You are only offered targets that leave a legal position: your own king is never exposed, pawns never land on a back rank, and cards played before your move cannot give check. Kings can never be captured, destroyed or targeted.</p>
    <h3>Statuses</h3><ul>
      <li><b>Frozen</b> pieces cannot move. <b>Immune</b> pieces cannot be captured or destroyed. A <b>shield</b> repels the next capture: the attacker bounces back and the shield breaks.</li>
      <li><b>Barriers</b> block movement. Barriers and disarms never make a king safer: anything that would attack a king without them still counts as check.</li>
      <li><b>Restriction break</b>: if card restrictions would leave a player who is not in check without a legal move, they lift for that turn, so cards cannot force a stalemate. In check, they can force mate.</li></ul>
    <h3>When effects collide</h3><p>Effects resolve in a fixed order: counters, then wards, immunity, shields, restrictions, movement, destruction, transformation and card draw. When one capture triggers several things, the mover's effects resolve first in board order, then the victim may react at the end of the turn.</p>
    <h3>Drafting</h3><p>Between rounds each player privately picks a card from a random offer weighted by rarity. Cards that match the tags already in your deck show up more often. The player who lost the round picks first and gets an extra Rare-or-better option plus a reroll. One player picks while the other looks away, then the screen hides the choice and hands over.</p>
    <h3>Controls</h3><ul><li>Touch or mouse: tap a piece, then a square. Tap a card to read it, then play it.</li><li>Keyboard: arrow keys move the cursor, Enter selects, Esc cancels, 1 to 9 open your cards, E ends the turn or skips, H shows the move history.</li><li>Controller: d-pad moves, A selects, B cancels, LB/RB browse cards, X opens the card, Y ends the turn. With two controllers, each player uses their own.</li></ul>
  </div>`;
}

function renderSettings() {
  app().innerHTML = `<div class="page setup">
    <header class="ph"><button class="back" data-act="go" data-arg="menu">Back</button><h2>Settings</h2></header>
    <section class="opts">
      ${toggle('cfg.sound', 'Sound effects', CFG.sound)}
      ${toggle('cfg.motion', 'Animations', CFG.motion, 'Turn off for reduced motion')}
      <label class="num"><span>Board orientation</span><select data-sel="cfg.orient"><option value="p1" ${CFG.orient === 'p1' ? 'selected' : ''}>Player 1 at the bottom</option><option value="white" ${CFG.orient === 'white' ? 'selected' : ''}>White at the bottom</option></select></label>
      ${toggle('cfg.tabletop', 'Tabletop mode', CFG.tabletop, 'Flips the top player\'s panel for sitting face to face')}
    </section>
    <p class="hint">Saved matches stay on this device only.</p>
    <button data-act="clearsave">Delete saved match</button>
  </div>`;
}

// ---------- draft ----------
function renderDraft() {
  const d = G.draft;
  if (!d) return;
  const i = drafter(G), Pl = G.players[i], other = G.players[1 - i];
  let body;
  if (d.stage === 'curtain') {
    body = `<div class="curtain pl-${Pl.color}">
      <p class="rnd">${G.round === 0 ? 'Opening draft' : `After round ${G.round}`}</p>
      <h2>Pass the device to ${esc(Pl.name)}</h2>
      <p>${esc(other.name)}, look away while ${esc(Pl.name)} picks.</p>
      ${d.loser === i ? '<p class="cb">You lost the last round: you pick first and get a comeback option.</p>' : ''}
      <button class="big" data-act="reveal">I'm ${esc(Pl.name)}: show my cards</button>
    </div>`;
  } else if (d.stage === 'pick') {
    const offers = d.offers[i];
    body = `<div class="pick pl-${Pl.color}">
      <h2>${esc(Pl.name)}, pick ${d.left[i] > 1 ? `${d.left[i]} cards` : 'a card'}</h2>
      <div class="offers">${offers.map(id => `<div class="offer">${cardFace(id, { size: 'l', syn: synergy(Pl, id) })}<button class="take" data-act="take" data-arg="${id}">Take ${esc(byId(id).name)}</button></div>`).join('')}</div>
      <div class="pick-actions">${d.rerolls[i] ? `<button data-act="reroll">Reroll offers (${d.rerolls[i]})</button>` : ''}${G.settings.skip ? `<button data-act="take" data-arg="">Skip this pick</button>` : ''}</div>
      <div class="deck"><h3>Your deck (${Pl.deck.length})</h3><div class="mini">${Pl.deck.map(e => `<span class="r-${byId(e.id).rarity}">${esc(byId(e.id).name)}</span>`).join('') || '<em>Empty</em>'}</div></div>
    </div>`;
  } else {
    const show = j => d.chosen[j].filter(Boolean).map(id => (G.settings.hiddenHands ? cardBack() : cardFace(id, { size: 'm' }))).join('') || '<p class="none">Skipped</p>';
    body = `<div class="reveal">
      <h2>Round ${G.round + 1}</h2>
      <div class="both">${[0, 1].map(j => `<div class="side pl-${G.players[j].color}"><h3>${esc(G.players[j].name)}</h3><div class="got">${show(j)}</div></div>`).join('')}</div>
      <button class="big" data-act="beginround">Start round ${G.round + 1}</button>
    </div>`;
  }
  app().innerHTML = `<div class="draft">${scoreStrip()}${body}</div>`;
}
const scoreStrip = () => `<div class="score-strip">${G.players.map(p => `<span class="pl-${p.color}"><b>${esc(p.name)}</b> ${p.score}</span>`).join('<i>vs</i>')}${G.mode !== 'endless' ? `<small>First to ${G.settings.targetWins}</small>` : '<small>Endless</small>'}</div>`;

// ---------- play ----------
function renderPlay() {
  app().innerHTML = `<div class="play ${CFG.tabletop ? 'tabletop' : ''}">
    <header class="topbar" id="topbar"></header>
    <section class="panel ptop" id="ptop"></section>
    <main class="center"><div class="boardbox" id="boardbox"><div class="board" id="board">
      ${Array.from({ length: 64 }, (_, i) => `<button class="sq" data-sq-i="${i}" aria-label=""></button>`).join('')}
      <div class="marks" id="marks"></div><div class="pieces" id="pieces"></div><canvas class="vfx" id="vfx"></canvas>
      <div class="files" id="coords"></div></div><div class="announce" id="announce" aria-live="polite"></div></div>
      <div class="actionbar" id="actionbar" aria-live="polite"></div></main>
    <section class="panel pbot" id="pbot"></section>
    <aside class="hist ${U.hist ? 'open' : ''}" id="hist"></aside>
    <div class="modal" id="modal" hidden></div>
  </div>`;
  U.boardPieces = new Map();
  layout(); updatePlay();
}

function updatePlay() {
  if (U.screen !== 'play' || !G || !G.s) return;
  const s = G.s, top = opp(bottomColor());
  $('#topbar').innerHTML = topbar();
  $('#ptop').innerHTML = panel(top); $('#pbot').innerHTML = panel(opp(top));
  $('#ptop').className = `panel ptop ${pCls(top)} ${actor() === top && s.phase !== 'over' ? 'active' : ''}`;
  $('#pbot').className = `panel pbot ${pCls(opp(top))} ${actor() === opp(top) && s.phase !== 'over' ? 'active' : ''}`;
  $('#actionbar').innerHTML = actionbar();
  $('#actionbar').className = `actionbar ${pCls(actor())} ph-${s.phase}`;
  $('#hist').innerHTML = history();
  $('#hist').classList.toggle('open', U.hist);
  updateBoard();
  renderModal();
}

function topbar() {
  const s = G.s, ch = G.challenge && CHALLENGES.find(c => c.id === G.challenge.id);
  return `<button class="ib" data-act="menu" aria-label="Menu">☰</button>
    <div class="tb-mid">${ch ? `<b>${esc(ch.name)}</b><span>${esc(ch.desc)}</span>` : `<b>${G.mode === 'classic' ? 'Game' : 'Round'} ${G.round}</b><span>${MODES[G.mode].name}${G.mode !== 'endless' ? ` · first to ${G.settings.targetWins}` : ''}</span>`}</div>
    ${ch ? '' : `<div class="tb-score">${G.players.map(p => `<span class="pl-${p.color}">${esc(p.name)} <b>${p.score}</b></span>`).join('')}</div>`}
    <button class="ib hist-btn" data-act="hist" aria-label="Move history">≡ <span>Moves</span></button>`;
}

function clockStr(ms) { const t = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }

function panel(c) {
  const s = G.s, Pl = P(c), hand = G.hands[c], mine = actor() === c, pf = s.pfx[c];
  const hidden = G.settings.hiddenHands && !U.reveal[c];
  const tags = [];
  if (pf.silenced > s.ply) tags.push('Silenced');
  if (pf.doubleThreat > s.ply) tags.push('Double Threat armed');
  if (pf.shockwave > s.ply) tags.push('Shockwave armed');
  if (pf.iron > s.ply) tags.push('Iron Will');
  if (pf.extra && pf.extra.until > s.ply) tags.push(`+${pf.extra.n} card this turn`);
  const caps = s.captured[opp(c)].map(x => pieceSVG(x.t, opp(c))).join('');
  const turnTxt = s.phase === 'over' ? '' : mine ? (s.phase === 'react' ? 'Reacting' : 'Your turn') : '';
  return `<div class="p-head"><span class="p-chip"></span><div class="p-id"><b>${esc(Pl.name)}</b><span>plays ${c === W ? 'White' : 'Black'}${turnTxt ? ` · <em>${turnTxt}</em>` : ''}</span></div>
    ${G.clock ? `<span class="clock ${mine ? 'run' : ''} ${G.clock[c] < 20000 ? 'low' : ''}" data-clock="${c}">${clockStr(G.clock[c])}</span>` : ''}</div>
    <div class="caps" aria-label="Captured pieces">${caps}</div>
    ${tags.length ? `<div class="ptags">${tags.map(t => `<span>${t}</span>`).join('')}</div>` : ''}
    ${usesCards(G) || hand.length ? `<div class="hand">${hand.length ? hand.map((h, i) => {
      if (hidden) return `<button class="hc" data-act="peek" data-arg="${c}" aria-label="Hidden card">${cardBack()}</button>`;
      const st = cardStatus(G, c, h);
      const foc = mine && U.focus === i ? 'focus' : '';
      return `<button class="hc ${st.ok ? 'ready' : ''} ${foc} ${h.temp && h.fresh === s.ply ? 'fresh' : ''}" data-act="card" data-arg="${c}:${h.uid}" title="${esc(byId(h.id).name)}${st.ok ? '' : ': ' + esc(st.why)}">${cardFace(h.id, { inst: h, size: 's', status: st })}${i < 9 && mine ? `<kbd>${i + 1}</kbd>` : ''}</button>`;
    }).join('') : '<p class="empty">No cards yet. Win or lose, you draft one after this round.</p>'}</div>` : ''}
    ${G.settings.hiddenHands && hand.length ? `<button class="peek" data-act="peek" data-arg="${c}">${U.reveal[c] ? 'Hide my cards' : 'Peek at my cards'}</button>` : ''}`;
}

function actionbar() {
  const s = G.s, a = actor(), name = pName(a);
  const tgt = U.target;
  if (s.phase === 'over') return `<span class="ab-msg">${s.result.winner ? `${pName(s.result.winner)} wins by ${s.result.reason}` : `Draw: ${s.result.reason}`}</span><button data-act="toResult">Continue</button>`;
  if (tgt) {
    const d = byId(tgt.id);
    if (tgt.confirm) return `<span class="ab-msg">Play <b>${esc(d.name)}</b>${tgt.desc ? ': ' + esc(tgt.desc) : ''}?</span><button class="go" data-act="confirm">Play card</button><button data-act="cancel">Cancel</button>`;
    return `<span class="ab-msg"><b>${esc(d.name)}</b>: ${esc(d.steps[tgt.picks.length].prompt)}</span><button data-act="cancel">Cancel</button>`;
  }
  if (s.phase === 'react') {
    const pd = s.pending, why = { mate: `${name}, your king is checkmated. Use a reaction?`, captured: `${name}, your piece was captured. React?`, cardPlayed: `${pName(pd.play.color)} plays ${esc(byId(pd.play.id).name)}. ${name}, respond?` }[pd.type];
    const opts = G.hands[a].filter(h => byId(h.id).timing === 'reactive' && cardStatus(G, a, h).ok);
    return `<span class="ab-msg react">${why}</span>${opts.map(h => `<button class="go r-${h.rarity}" data-act="reactcard" data-arg="${h.uid}">${esc(h.name)}</button>`).join('')}<button data-act="pass">${pd.type === 'mate' ? 'Accept checkmate' : 'Pass'}</button>`;
  }
  if (s.phase === 'bonus') return `<span class="ab-msg"><b>${esc(s.bonus.label || 'Bonus move')}</b></span><button data-act="skip">Skip</button>`;
  if (s.phase === 'post') return `<span class="ab-msg">${name}: play an after-move card, or end your turn.</span><button class="go" data-act="endturn">End turn</button>`;
  const chk = inCheck(s, s.turn) ? ' You are in check.' : '';
  const lim = usesCards(G) ? ` <small>${Math.max(0, cardLimit(s, s.turn) - s.cardsPlayed)} card play${cardLimit(s, s.turn) - s.cardsPlayed === 1 ? '' : 's'} left</small>` : '';
  return `<span class="ab-msg"><b>${name}</b> to move.${chk}${lim}</span>${G.mode === 'challenge' && G.challenge.kind === 'puzzle' ? '<button data-act="retry">Restart puzzle</button>' : `<button class="quiet" data-act="drawoffer">Offer draw</button><button class="quiet" data-act="resign">Resign</button>`}`;
}

function history() {
  const rows = []; let cur = null;
  for (const h of G.history) {
    if (h.kind === 'move' && h.color === W && !h.bonus) { cur = { n: Math.floor(h.ply / 2) + 1, w: [], b: [] }; rows.push(cur); }
    if (!cur) { cur = { n: Math.floor(h.ply / 2) + 1, w: [], b: [] }; rows.push(cur); }
    cur[h.color].push(h);
    if (h.kind === 'move' && h.color === B && !h.bonus) cur = null;
  }
  const cell = list => list.map(h => `<span class="${h.kind === 'card' ? 'hc-card r-' + h.rarity : ''}">${esc(h.text)}</span>`).join(' ');
  return `<div class="h-head"><h3>Moves</h3><button class="ib" data-act="hist" aria-label="Close history">×</button></div>
    <ol class="moves">${rows.map(r => `<li><i>${r.n}.</i><span>${cell(r.w)}</span><span>${cell(r.b)}</span></li>`).join('') || '<li class="none">No moves yet</li>'}</ol>
    <h3>Effects log</h3><ul class="log">${G.log.slice(-14).reverse().map(l => `<li class="${l.color ? pCls(l.color) : ''} k-${l.kind}">${esc(l.text)}</li>`).join('')}</ul>`;
}

// ---------- board ----------
function sqPos(sq) { const flip = bottomColor() === B; return { x: flip ? 7 - F(sq) : F(sq), y: flip ? R(sq) : 7 - R(sq) }; }
function screenToSq(x, y) { const flip = bottomColor() === B; return flip ? (y * 8 + (7 - x)) : ((7 - y) * 8 + x); }

function sightInfo(s) {
  if (!s.sight) return null;
  const from = s.sight.sq, b = s.board[from]; if (!b) return null;
  const paths = legalMovesFrom(s, from).map(m => m.to), hits = [], pins = [];
  for (const [df, dr] of DIAG) {
    let x = from, first = null;
    for (;;) {
      x = off(x, df, dr); if (x < 0) break;
      const p = s.board[x]; if (!p) continue;
      if (!first) { if (p.c === b.c) break; first = x; if (p.t !== 'k') hits.push(x); continue; }
      if (p.c !== b.c && ['k', 'q', 'r'].includes(p.t)) pins.push(first);
      break;
    }
  }
  return { paths, hits, pins };
}

function updateBoard() {
  const s = G.s, board = $('#board'); if (!board) return;
  const sqs = board.querySelectorAll('.sq');
  const moves = !U.target && (s.phase === 'pre' || s.phase === 'bonus') ? currentMoves(G) : [];
  const selMoves = U.sel != null ? moves.filter(m => m.from === U.sel) : [];
  const movable = new Set(moves.map(m => m.from));
  const optSet = new Set(U.target && !U.target.confirm && U.target.opts && U.target.kind === 'square' ? U.target.opts : []);
  const picked = new Set(U.target ? U.target.picks.filter(x => typeof x === 'number') : []);
  const lm = U.lastMove;
  const chk = inCheck(s, s.turn) && s.phase !== 'over' ? kingSq(s, s.turn) : -1;
  const sight = sightInfo(s);
  sqs.forEach((el, i) => {
    const x = i % 8, y = Math.floor(i / 8), sq = screenToSq(x, y);
    const p = s.board[sq], dark = (F(sq) + R(sq)) % 2 === 0;
    const mv = selMoves.find(m => m.to === sq);
    const cls = ['sq', dark ? 'd' : 'l'];
    if (U.sel === sq) cls.push('sel');
    if (mv) cls.push(mv.cap || mv.bounce ? 'cap' : 'to');
    if (s.phase === 'bonus' && movable.has(sq) && U.sel == null) cls.push('can');
    if (optSet.has(sq)) cls.push('opt');
    if (picked.has(sq)) cls.push('picked');
    if (lm && (lm.from === sq || lm.to === sq)) cls.push('last');
    if (sq === chk) cls.push('check');
    if (U.cursor === sq && U.kbd) cls.push('cursor');
    if (sight) { if (sight.paths.includes(sq)) cls.push('sight'); if (sight.hits.includes(sq)) cls.push('sight-hit'); if (sight.pins.includes(sq)) cls.push('sight-pin'); if (s.sight.sq === sq) cls.push('sel'); }
    el.className = cls.join(' ');
    el.dataset.sq = sq;
    el.setAttribute('aria-label', `${sqName(sq)}${p ? ' ' + (p.c === W ? 'white ' : 'black ') + NAME[p.t] : ''}`);
    if (U.target && U.target.kind === 'square') el.style.setProperty('--opt', `var(--${byId(U.target.id).rarity})`);
  });
  // pieces (keyed by id so moves slide)
  const layer = $('#pieces'), seen = new Set();
  for (let sq = 0; sq < 64; sq++) {
    const p = s.board[sq]; if (!p) continue;
    seen.add(p.id);
    let el = U.boardPieces.get(p.id);
    if (!el) { el = document.createElement('div'); el.className = 'piece spawn'; layer.appendChild(el); U.boardPieces.set(p.id, el); requestAnimationFrame(() => el.classList.remove('spawn')); }
    const key = p.t + p.c + playerOf(G, p.c);
    if (el.dataset.key !== key) { el.innerHTML = pieceSVG(p.t, p.c); el.dataset.key = key; }
    const { x, y } = sqPos(sq);
    el.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
    const fxc = [];
    for (const k of ['frozen', 'immune', 'shield', 'ward', 'bounty', 'noCapture']) if (has(s, p, k)) fxc.push('fx-' + k);
    if (['mvN', 'mvK', 'mvCamel', 'phase', 'pawnDiag', 'pawnFwdCap'].some(k => has(s, p, k))) fxc.push('fx-power');
    if (s.pfx[p.c].iron > s.ply) fxc.push('fx-ward');
    el.className = `piece ${pCls(p.c)} ${fxc.join(' ')} ${movable.has(sq) && s.turn === p.c && !U.target ? 'movable' : ''}`;
    el.title = fxc.length ? fxc.map(c => ({ 'fx-frozen': 'Frozen', 'fx-immune': 'Immune', 'fx-shield': 'Shield', 'fx-ward': 'Warded', 'fx-bounty': 'Bounty', 'fx-noCapture': 'Disarmed', 'fx-power': 'Empowered' })[c]).join(', ') : '';
  }
  for (const [id, el] of U.boardPieces) if (!seen.has(id)) { el.classList.add('gone'); U.boardPieces.delete(id); setTimeout(() => el.remove(), 350); }
  // walls & traps
  $('#marks').innerHTML = [...s.walls.map(w => ({ sq: w.sq, cls: 'wall', i: 'wall', o: w.owner })), ...s.traps.map(t => ({ sq: t.sq, cls: 'trap-' + t.kind, i: 'trap', o: t.owner }))].map(m => { const { x, y } = sqPos(m.sq); return `<div class="mark ${m.cls} ${pCls(m.o)}" style="transform:translate(${x * 100}%,${y * 100}%)" title="${m.cls === 'wall' ? 'Barrier' : m.cls === 'trap-mine' ? 'Landmine' : 'Booby trap'}">${icon(m.i)}</div>`; }).join('');
  const flip = bottomColor() === B;
  $('#coords').innerHTML = Array.from({ length: 8 }, (_, i) => `<span class="f" style="left:${i * 12.5}%">${'abcdefgh'[flip ? 7 - i : i]}</span><span class="r" style="top:${i * 12.5}%">${flip ? i + 1 : 8 - i}</span>`).join('');
  $('#board').classList.toggle('flipped', flip);
  $('#boardbox').className = `boardbox turn-${P(actor()).color}`;
}

function layout() {
  const box = $('#boardbox'); if (!box) return;
  const c = box.parentElement, ab = $('#actionbar');
  const w = c.clientWidth - 12, h = c.clientHeight - Math.max(64, ab ? ab.offsetHeight : 0) - 14;
  const size = Math.max(240, Math.floor(Math.min(w, h) / 8) * 8);
  document.documentElement.style.setProperty('--bs', size + 'px');
  const cv = $('#vfx'); if (cv) { const d = window.devicePixelRatio || 1; cv.width = size * d; cv.height = size * d; }
}

// ---------- modal (card detail, choices, promotion, result) ----------
function renderModal() {
  const m = $('#modal'); if (!m) return;
  let html = '';
  if (U.promo) {
    const c = G.s.turn;
    html = `<div class="sheet promo"><h3>Promote to</h3><div class="pr">${['q', 'r', 'b', 'n'].map(t => `<button data-act="promo" data-arg="${t}" aria-label="${NAME[t]}">${pieceSVG(t, c)}<span>${NAME[t]}</span></button>`).join('')}</div><button data-act="cancel">Cancel</button></div>`;
  } else if (U.target && U.target.kind === 'choice' && !U.target.confirm) {
    const d = byId(U.target.id);
    html = `<div class="sheet"><h3>${esc(d.name)}</h3><p>${esc(d.steps[U.target.picks.length].prompt)}</p><div class="choices">${U.target.opts.map(o => `<button class="go" data-act="choose" data-arg="${esc(o.v)}">${esc(o.label)}</button>`).join('')}</div><button data-act="cancel">Cancel</button></div>`;
  } else if (U.detail) {
    const { color, uid } = U.detail, h = G.hands[color].find(x => x.uid === uid);
    if (h) {
      const st = cardStatus(G, color, h), d = byId(h.id);
      html = `<div class="sheet detail ${pCls(color)}">${cardFace(h.id, { inst: h, size: 'l', status: st })}
        <div class="dact">${st.ok ? `<button class="go big" data-act="play">${d.steps.length ? 'Choose targets' : 'Play card'}</button>` : `<p class="why">${esc(st.why)}</p>`}<button data-act="cancel">Close</button></div></div>`;
    }
  } else if (U.ended) html = resultSheet();
  else if (U.menuOpen) html = `<div class="sheet"><h3>Paused</h3><div class="choices col"><button data-act="menuclose">Resume</button><button data-act="toggleSound">${CFG.sound ? 'Mute sound' : 'Unmute sound'}</button><button data-act="quit">Save and quit to menu</button></div></div>`;
  m.innerHTML = html; m.hidden = !html;
  const f = m.querySelector('.go, button'); if (f && html && U.kbd) f.focus();
}

function resultSheet() {
  const e = U.ended, s = G.s;
  if (G.mode === 'challenge') {
    const ps = puzzleState(G), ch = CHALLENGES.find(c => c.id === G.challenge.id);
    if (ch.kind === 'puzzle') return `<div class="sheet result ${ps === 'solved' ? 'win' : ''}"><h2>${ps === 'solved' ? 'Solved' : 'Not checkmate'}</h2><p>${ps === 'solved' ? 'Checkmate this turn. Well played.' : 'The turn ended without checkmate. Look at what the card makes possible.'}</p><div class="choices"><button class="go" data-act="retry">${ps === 'solved' ? 'Play again' : 'Try again'}</button><button data-act="go" data-arg="challenges">All challenges</button></div></div>`;
    return `<div class="sheet result"><h2>${s.result.winner ? pName(s.result.winner) + ' wins' : 'Draw'}</h2><p>${esc(s.result.reason)}</p><div class="choices"><button class="go" data-act="retry">Play again</button><button data-act="go" data-arg="challenges">All challenges</button></div></div>`;
  }
  const w = s.result.winner, match = G.phase === 'matchEnd';
  const mw = matchWinner(G), champ = mw != null ? G.players[mw] : null;
  const st = G.stats;
  return `<div class="sheet result ${match ? 'match' : ''} ${w ? 'pl-' + P(w).color : ''}">
    ${match ? `<p class="rnd">Match over</p><h2 class="${champ ? 'pl-' + champ.color : ''}">${champ ? esc(champ.name) + ' wins the match' : 'The match is drawn'}</h2>` : `<p class="rnd">Round ${G.round}</p><h2>${w ? pName(w) + ' takes the round' : 'Round drawn'}</h2>`}
    <p class="reason">${w ? `${esc(s.result.reason[0].toUpperCase() + s.result.reason.slice(1))}${s.result.reason === 'checkmate' ? ` against ${pName(opp(w))}` : ''}` : esc(s.result.reason)}</p>
    <div class="sb">${G.players.map(p => `<div class="pl-${p.color}"><b>${esc(p.name)}</b><span>${p.score}</span></div>`).join('')}</div>
    <table class="stats"><tr><th></th><th>Moves</th><th>Captures</th><th>Cards</th></tr>${[W, B].map(c => `<tr class="${pCls(c)}"><td>${pName(c)}</td><td>${st[c].moves}</td><td>${st[c].captures}</td><td>${st[c].cards}</td></tr>`).join('')}</table>
    <div class="choices">${match ? `<button class="go big" data-act="rematch">Rematch</button><button data-act="quit">Main menu</button>` : `<button class="go big" data-act="nextround">${usesCards(G) ? 'Go to the draft' : 'Next game'}</button><button data-act="quit">Save and quit</button>`}</div>
  </div>`;
}

// ---------- actions ----------
function afterAction() {
  drainFx();
  if (G.s && G.s.ply !== U.lastPly) { // clock increment and per-turn resets
    if (G.clock && U.lastPly >= 0) { const mover = G.s.turn === W ? B : W; G.clock[mover] += G.clock.inc; }
    U.lastPly = G.s.ply; U.reveal = { w: false, b: false }; U.focus = 0;
  }
  if (G.s && G.s.phase === 'over' && !U.ended) {
    if (G.mode === 'challenge' && puzzleState(G) === 'solved') { const sv = store.get('cr.solved', []); if (!sv.includes(G.challenge.id)) store.set('cr.solved', [...sv, G.challenge.id]); }
    setTimeout(() => { U.ended = true; G.s.result.winner ? sfx.win() : sfx.draw2(); updatePlay(); }, 900);
  }
  if (G.mode === 'challenge' && puzzleState(G) === 'failed' && !U.ended) setTimeout(() => { U.ended = true; sfx.bad(); updatePlay(); }, 700);
  save();
  updatePlay();
}

function onSquare(sq) {
  if (!G || !G.s || U.ended || U.promo) return;
  const s = G.s;
  if (U.target) {
    const t = U.target;
    if (t.confirm || t.kind !== 'square') return;
    if (!t.opts.includes(sq)) { sfx.bad(); return; }
    sfx.ui(); t.picks.push(sq); advanceTarget(); return;
  }
  if (s.phase !== 'pre' && s.phase !== 'bonus') return;
  const ms = currentMoves(G);
  if (U.sel != null) {
    const cand = ms.filter(m => m.from === U.sel && m.to === sq);
    if (cand.length > 1) { U.promo = { from: U.sel, to: sq }; updatePlay(); return; }
    if (cand.length === 1) { const from = U.sel; U.sel = null; return performMove({ from, to: sq }); }
  }
  if (ms.some(m => m.from === sq)) { U.sel = U.sel === sq ? null : sq; sfx.ui(); }
  else { U.sel = null; if (s.board[sq] && s.board[sq].c === s.turn && s.phase === 'pre') { const p = s.board[sq]; if (has(s, p, 'frozen')) toast('That piece is frozen'); } }
  updateBoard();
}

function performMove(m) {
  const r = doMove(G, m);
  if (!r.ok) { sfx.bad(); return; }
  U.lastMove = { from: m.from, to: m.to };
  afterAction();
}

function startCard(color, uid, isReact = false) {
  const h = G.hands[color].find(x => x.uid === uid); if (!h) return;
  const d = byId(h.id);
  U.detail = null; U.sel = null;
  U.target = { color, uid, id: h.id, picks: [], react: isReact };
  if (!d.steps.length) { U.target.confirm = true; U.target.desc = ''; return commitCard(); }
  advanceTarget(true);
}
function advanceTarget(first) {
  const t = U.target, d = byId(t.id), h = G.hands[t.color].find(x => x.uid === t.uid);
  if (t.picks.length === d.steps.length) { t.confirm = true; t.desc = t.picks.map(x => (typeof x === 'number' ? sqName(x) : (NAME[x] || x))).join(' → '); updatePlay(); return; }
  t.kind = d.steps[t.picks.length].kind;
  const o = cardOptions(G, t.color, h, t.picks);
  t.opts = o;
  if (!o.length) { toast('No legal target'); U.target = null; }
  updatePlay();
}
function commitCard() {
  const t = U.target; U.target = null;
  const r = t.react ? react(G, t.color, t.uid, t.picks) : playCard(G, t.color, t.uid, t.picks);
  if (!r.ok) { toast(r.why); sfx.bad(); updatePlay(); return; }
  afterAction();
}

let toastT;
function toast(msg) { let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); } el.textContent = msg; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 1800); }

const ACT = {
  go(a) { U.menuOpen = false; U.screen = a; render(); },
  mode(a) { if (a === 'challenge') { U.screen = 'challenges'; return render(); } U.setupMode = a; U.screen = 'setup'; render(); },
  continue() { try { G = deserialize(store.raw('cr.save')); } catch { store.del('cr.save'); return render(); } U.ended = null; U.lastPly = G.s ? G.s.ply : -1; enterGame(); },
  step(a) { const [k, d] = a.split(':'); const lim = { handCap: [2, 9], targetWins: [1, 9], cardsPerTurn: [1, 3], draftSize: [2, 6], startPicks: [0, 3] }[k]; SETUP[k] = Math.max(lim[0], Math.min(lim[1], (SETUP[k] === Infinity ? 3 : SETUP[k]) + +d)); store.set('cr.setup', SETUP); render(); },
  load(a) { const [i, id] = a.split(':'); const l = SETUP.loadout[i]; SETUP.loadout[i] = l.includes(id) ? l.filter(x => x !== id) : [...l, id]; store.set('cr.setup', SETUP); render(); },
  start() {
    const m = U.setupMode;
    const st = { ...SETUP, loadout: m === 'custom' ? SETUP.loadout : { 0: [], 1: [] }, disabled: m === 'custom' ? SETUP.disabled : [], weights: m === 'custom' ? SETUP.weights : { ...DEFAULT_WEIGHTS }, rarities: m === 'custom' ? SETUP.rarities : { ...DEFAULT_SETTINGS.rarities } };
    if (m === 'classic' && !(SETUP.targetWins >= 1)) st.targetWins = 1;
    G = newMatch(m, st); startMatch(G); U.ended = null; U.lastPly = -1; enterGame();
  },
  challenge(a) { G = newMatch('challenge', { names: SETUP.names }); startChallenge(G, a); U.ended = null; U.lastPly = G.s.ply; U.lastMove = null; enterGame(); },
  retry() { const id = G.challenge.id; U.ended = null; startChallenge(G, id); U.lastPly = G.s.ply; U.lastMove = null; U.target = null; U.sel = null; renderPlay(); afterAction(); },
  libr(a) { U.lib.r = a; render(); },
  reveal() { revealDraft(G); sfx.ui(); render(); },
  take(a) { draftPick(G, a || null); a ? sfx.card(byId(a).rarity) : sfx.ui(); save(); render(); },
  reroll() { reroll(G); sfx.draw(); render(); },
  beginround() { finishDraft(G); U.ended = null; U.lastMove = null; enterGame(); },
  card(a) { const [c, uid] = a.split(':'); if (U.target) return; U.detail = { color: c, uid }; sfx.ui(); renderModal(); },
  play() { const { color, uid } = U.detail; startCard(color, uid, false); },
  reactcard(a) { startCard(G.s.pending.color, a, true); },
  pass() { react(G, G.s.pending.color, null); afterAction(); },
  confirm() { commitCard(); },
  choose(a) { const t = U.target; t.picks.push(a); advanceTarget(); },
  cancel() { U.target = null; U.detail = null; U.promo = null; U.sel = null; updatePlay(); },
  promo(a) { const { from, to } = U.promo; U.promo = null; U.sel = null; performMove({ from, to, promo: a }); },
  skip() { skipBonus(G); afterAction(); },
  endturn() { endPost(G); afterAction(); },
  resign() { if (confirm2('resign')) { resign(G, G.s.turn); afterAction(); } },
  drawoffer() { if (confirm2('draw')) { agreeDraw(G); afterAction(); } },
  toResult() { U.ended = true; updatePlay(); },
  nextround() { U.ended = null; continueAfterRound(G); save(); if (G.phase === 'draft') { U.screen = 'draft'; render(); } else enterGame(); },
  rematch() { const st = G.settings, m = G.mode; G = newMatch(m, st); startMatch(G); U.ended = null; U.lastPly = -1; enterGame(); },
  quit() { save(); if (G && G.phase === 'matchEnd') store.del('cr.save'); U.menuOpen = false; U.ended = null; U.screen = 'menu'; render(); },
  menu() { U.menuOpen = true; renderModal(); },
  menuclose() { U.menuOpen = false; renderModal(); },
  toggleSound() { CFG.sound = !CFG.sound; saveCfg(); renderModal(); },
  hist() { U.hist = !U.hist; $('#hist').classList.toggle('open', U.hist); },
  peek(a) { if (actor() !== a && !U.reveal[a]) { toast(`Only ${pName(a)} may look, on their turn`); return; } U.reveal[a] = !U.reveal[a]; updatePlay(); },
  clearsave() { store.del('cr.save'); toast('Saved match deleted'); },
};
let pendingConfirm = null;
function confirm2(kind) {
  if (pendingConfirm === kind) { pendingConfirm = null; return true; }
  pendingConfirm = kind; setTimeout(() => { if (pendingConfirm === kind) pendingConfirm = null; }, 2500);
  toast(kind === 'resign' ? `${pName(G.s.turn)}: tap Resign again to confirm` : `${pName(opp(G.s.turn))}, tap Offer draw again to accept`);
  return false;
}

function enterGame() {
  if (G.phase === 'draft') { U.screen = 'draft'; return render(); }
  U.screen = 'play'; U.target = null; U.sel = null; U.detail = null; U.menuOpen = false;
  if (G.phase === 'roundEnd' || G.phase === 'matchEnd') U.ended = true;
  render();
  drainFx(true);
  if (G.s && G.s.phase !== 'over' && G.mode !== 'challenge') announceRound();
}

// ---------- fx: announcements, particles, sounds ----------
function drainFx(silent = false) {
  const q = G.fxq || []; G.fxq = [];
  if (silent) return;
  for (const e of q) {
    if (e.type === 'move') { e.cap ? (sfx.capture(), burst(e.to, '#fff', 18)) : sfx.move(); if (e.cap) shake(); }
    else if (e.type === 'card') { const d = byId(e.id); queueAnnounce(e.color, e.id); sfx.card(d.rarity); }
    else if (e.type === 'resolved') { const d = byId(e.id); const sqs = (e.picks || []).filter(x => typeof x === 'number'); const col = getComputedStyle(document.documentElement).getPropertyValue('--' + d.rarity).trim() || '#fff'; (sqs.length ? sqs : [kingSq(G.s, e.color)]).forEach(x => burst(x, col, d.rarity === 'legendary' ? 40 : 22, e.vfx)); if (e.vfx === 'freeze') sfx.freeze(); if (e.vfx === 'shield' || e.vfx === 'immune' || e.vfx === 'fortress') sfx.shield(); if (e.vfx === 'lightning' || e.vfx === 'quake' || e.vfx === 'burst') { sfx.boom(); shake(); } }
    else if (e.type === 'countered') { toast(`${byId(e.id).name} was cancelled`); sfx.bad(); }
    else if (e.type === 'bounce') { burst(e.to, '#9fe8ff', 20); sfx.shield(); toast('Shield! The capture bounces back'); }
    else if (e.type === 'check') { sfx.check(); }
    else if (e.type === 'trap') { burst(e.sq, e.kind === 'mine' ? '#ff6a3d' : '#8fdcff', 30); e.kind === 'mine' ? (sfx.boom(), shake()) : sfx.freeze(); }
    else if (e.type === 'destroy') { burst(e.sq, '#ffd166', 16); }
    else if (e.type === 'draw') { sfx.draw(); if (e.turn && e.color === actor()) toast(`${pName(e.color)} draws ${byId(e.id).name}`); }
    else if (e.type === 'break') toast('Restriction break: card effects lift so a legal move exists');
    else if (e.type === 'mateThreat') { sfx.check(); }
    else if (e.type === 'trigger') { queueAnnounce(e.color, e.id, 'triggers'); }
  }
}

function queueAnnounce(color, id, verb = 'plays') { U.ann.push({ color, id, verb }); if (!U.annBusy) nextAnnounce(); }
function nextAnnounce() {
  const el = $('#announce'); const a = U.ann.shift();
  if (!el || !a) { U.annBusy = false; return; }
  U.annBusy = true;
  el.innerHTML = `<div class="ann ${pCls(a.color)} r-${byId(a.id).rarity}"><p>${pName(a.color)} ${a.verb}</p>${cardFace(a.id, { size: 'm' })}</div>`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  setTimeout(() => { el.classList.remove('show'); setTimeout(nextAnnounce, 160); }, CFG.motion ? 1250 : 900);
}
function announceRound() {
  const el = $('#announce'); if (!el) return;
  const wc = G.players[G.whiteIdx];
  el.innerHTML = `<div class="ann round"><h2>${G.mode === 'classic' ? 'Game' : 'Round'} ${G.round}</h2><p class="pl-${wc.color}">${esc(wc.name)} plays White</p></div>`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); sfx.round();
  setTimeout(() => el.classList.remove('show'), 1400);
}

const parts = []; let raf = 0;
function burst(sq, color, n = 20, kind) {
  if (!CFG.motion || sq == null || sq < 0) return;
  const cv = $('#vfx'); if (!cv) return;
  const { x, y } = sqPos(sq), cell = cv.width / 8;
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = (0.6 + Math.random()) * cell * 0.06; parts.push({ x: (x + 0.5) * cell, y: (y + 0.5) * cell, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (kind === 'revive' || kind === 'promote' ? cell * 0.03 : 0), life: 1, r: cell * (0.03 + Math.random() * 0.05), color, sq: kind === 'freeze' || kind === 'wall' }); }
  parts.push({ ring: true, x: (x + 0.5) * cell, y: (y + 0.5) * cell, life: 1, r: cell * 0.2, color });
  if (!raf) raf = requestAnimationFrame(tick);
}
function tick() {
  const cv = $('#vfx'); if (!cv) { raf = 0; parts.length = 0; return; }
  const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life -= p.ring ? 0.04 : 0.025;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    g.globalAlpha = Math.max(0, p.life); g.fillStyle = p.color; g.strokeStyle = p.color;
    if (p.ring) { g.lineWidth = cv.width / 160; g.beginPath(); g.arc(p.x, p.y, p.r + (1 - p.life) * cv.width / 10, 0, 7); g.stroke(); continue; }
    p.x += p.vx; p.y += p.vy; p.vy += cv.width / 9000; p.vx *= 0.98;
    if (p.sq) g.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2); else { g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill(); }
  }
  g.globalAlpha = 1;
  raf = parts.length ? requestAnimationFrame(tick) : 0;
}
function shake() { if (!CFG.motion) return; const b = $('#board'); if (!b) return; b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); }

// ---------- input ----------
document.addEventListener('click', e => {
  const sq = e.target.closest('.sq');
  if (sq && U.screen === 'play') { U.kbd = false; return onSquare(+sq.dataset.sq); }
  const b = e.target.closest('[data-act]');
  if (b && ACT[b.dataset.act]) { e.preventDefault(); ACT[b.dataset.act](b.dataset.arg); }
  else if (e.target.id === 'modal' && (U.detail || U.menuOpen)) { U.detail = null; U.menuOpen = false; renderModal(); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.set) { const k = t.dataset.set; if (k.startsWith('cfg.')) { CFG[k.slice(4)] = t.checked; saveCfg(); } else { SETUP[k] = t.checked; store.set('cr.setup', SETUP); if (k === 'drawEachTurn') render(); } }
  if (t.dataset.sel) { const k = t.dataset.sel; if (k.startsWith('cfg.')) { CFG[k.slice(4)] = t.value; saveCfg(); } else { SETUP[k] = t.value; store.set('cr.setup', SETUP); } }
  if (t.dataset.rar) { SETUP.rarities[t.dataset.rar] = t.checked; store.set('cr.setup', SETUP); }
  if (t.dataset.pool) { const id = t.dataset.pool; SETUP.disabled = t.checked ? SETUP.disabled.filter(x => x !== id) : [...SETUP.disabled, id]; store.set('cr.setup', SETUP); t.closest('.prow').classList.toggle('dis', !t.checked); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.name != null) { SETUP.names[+t.dataset.name] = t.value.trim() || ['Orange', 'Blue'][+t.dataset.name]; store.set('cr.setup', SETUP); }
  if (t.dataset.weight) { SETUP.weights[t.dataset.weight] = +t.value; t.nextElementSibling.textContent = t.value; store.set('cr.setup', SETUP); }
  if (t.dataset.input === 'libq') { U.lib.q = t.value; const pos = t.selectionStart; renderLibrary(); const n = $('[data-input="libq"]'); n.focus(); n.setSelectionRange(pos, pos); }
});

function moveCursor(dx, dy) {
  const { x, y } = sqPos(U.cursor);
  const nx = Math.max(0, Math.min(7, x + dx)), ny = Math.max(0, Math.min(7, y + dy));
  U.cursor = screenToSq(nx, ny); U.kbd = true; updateBoard();
}
function handCycle(d) {
  const c = actor(), h = G.hands[c]; if (!h.length) return;
  U.focus = (U.focus + d + h.length) % h.length; U.kbd = true; updatePlay();
}
function primary() {
  if (U.ended) { const b = $('#modal .go'); if (b) b.click(); return; }
  if (U.detail) return ACT.play();
  if (U.target && U.target.confirm) return commitCard();
  onSquare(U.cursor);
}
function secondary() { if (U.detail || U.target || U.promo || U.sel != null) ACT.cancel(); else if (U.menuOpen) ACT.menuclose(); }
function openFocused() { const c = actor(), h = G.hands[c][U.focus]; if (h && (!G.settings.hiddenHands || U.reveal[c])) ACT.card(`${c}:${h.uid}`); }
function endOrSkip() { const s = G.s; if (s.phase === 'post') ACT.endturn(); else if (s.phase === 'bonus') ACT.skip(); else if (s.phase === 'react') ACT.pass(); }

document.addEventListener('keydown', e => {
  if (U.screen !== 'play' || !G || !G.s) return;
  if (e.target.matches('input, select, textarea')) return;
  const k = e.key;
  if (k.startsWith('Arrow')) { e.preventDefault(); moveCursor(k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0); return; }
  if (k === 'Enter' || k === ' ') { if (document.activeElement && document.activeElement.matches('button') && !document.activeElement.classList.contains('sq')) return; e.preventDefault(); primary(); return; }
  if (k === 'Escape') { secondary(); return; }
  if (/^[1-9]$/.test(k)) { const c = actor(), h = G.hands[c][+k - 1]; if (h) { U.focus = +k - 1; ACT.card(`${c}:${h.uid}`); } return; }
  if (k === 'e' || k === 'E') return endOrSkip();
  if (k === 'h' || k === 'H') return ACT.hist();
  if (U.promo && 'qrbn'.includes(k.toLowerCase())) return ACT.promo(k.toLowerCase());
});

// Gamepad (standard mapping). Two pads: pad 0 is player 1 (orange), pad 1 is player 2 (blue).
const padPrev = {};
function pollPads() {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  if (pads.length && U.screen === 'play' && G && G.s) {
    pads.forEach((p, i) => {
      const prev = padPrev[p.index] || {}, now = {};
      const btn = n => !!(p.buttons[n] && p.buttons[n].pressed);
      const ax = (n, d) => (p.axes[n] || 0) * d > 0.6;
      now.l = btn(14) || ax(0, -1); now.r = btn(15) || ax(0, 1); now.u = btn(12) || ax(1, -1); now.d = btn(13) || ax(1, 1);
      ['a', 'b', 'x', 'y', 'lb', 'rb', 'st'].forEach((k, j) => { now[k] = btn([0, 1, 2, 3, 4, 5, 9][j]); });
      const press = k => now[k] && !prev[k];
      const owner = pads.length > 1 ? playerOf(G, actor()) === i : true;
      if (owner) {
        if (press('l')) moveCursor(-1, 0); if (press('r')) moveCursor(1, 0); if (press('u')) moveCursor(0, -1); if (press('d')) moveCursor(0, 1);
        if (press('a')) primary(); if (press('b')) secondary(); if (press('lb')) handCycle(-1); if (press('rb')) handCycle(1); if (press('x')) openFocused(); if (press('y')) endOrSkip();
      }
      if (press('st')) U.menuOpen ? ACT.menuclose() : ACT.menu();
      padPrev[p.index] = now;
    });
  }
  requestAnimationFrame(pollPads);
}

// clock
let lastT = performance.now();
setInterval(() => {
  const now = performance.now(), dt = now - lastT; lastT = now;
  if (U.screen !== 'play' || !G || !G.clock || !G.s || G.s.phase === 'over' || U.menuOpen) return;
  const a = actor(); G.clock[a] -= dt;
  const el = document.querySelector(`[data-clock="${a}"]`); if (el) { el.textContent = clockStr(G.clock[a]); el.classList.toggle('low', G.clock[a] < 20000); }
  if (G.clock[a] <= 0) { G.clock[a] = 0; flag(G, a); afterAction(); }
}, 200);

window.addEventListener('resize', () => { layout(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

export function boot() {
  saveCfg();
  render();
  requestAnimationFrame(pollPads);
  if ('ResizeObserver' in window) new ResizeObserver(() => layout()).observe(document.body);
  setInterval(() => { const c = document.querySelector('.center'); if (c && (c.clientWidth !== U.cw || c.clientHeight !== U.ch)) { U.cw = c.clientWidth; U.ch = c.clientHeight; layout(); } }, 400);
}
