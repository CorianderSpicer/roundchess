// Challenge Mode: puzzles (White to move: deliver checkmate this turn using the given cards)
// and two-player scenarios (fixed positions and loadouts, played locally as one round).
// Every puzzle is verified by tests/cards.test.mjs: it must be solvable with the cards and
// must NOT be solvable without them.
export const CHALLENGES = [
  { id: 'p_smother', kind: 'puzzle', name: 'Smothered Gambit', fen: '6rk/6pp/8/8/2N5/8/8/2K5 w - - 0 1', cards: { w: ['knights_gambit'], b: [] },
    desc: 'Checkmate this turn. One knight move is not enough, so make it two.' },
  { id: 'p_phase', kind: 'puzzle', name: 'Through the Ranks', fen: '6k1/5ppp/8/8/8/8/P7/R5K1 w - - 0 1', cards: { w: ['phase_rook'], b: [] },
    desc: 'Your own pawn is in the way of a back-rank mate.' },
  { id: 'p_freeze', kind: 'puzzle', name: 'Frozen Guard', fen: '3r2k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1', cards: { w: ['ice_lance'], b: [] },
    desc: 'The black rook guards the back rank. Make sure it cannot answer.' },
  { id: 'p_exchange', kind: 'puzzle', name: 'Royal Exchange', fen: '6k1/p4ppp/8/8/8/8/Q6P/4N2K w - - 0 1', cards: { w: ['royal_exchange'], b: [] },
    desc: 'Your queen is on the wrong side of the board.' },
  { id: 'p_cavalry', kind: 'puzzle', name: 'Cavalry Charge', fen: '6rk/6pp/3B4/8/8/8/8/2K5 w - - 0 1', cards: { w: ['cavalry'], b: [] },
    desc: 'A bishop cannot deliver a smothered mate. Or can it?' },
  { id: 'p_promo', kind: 'puzzle', name: 'Field Coronation', fen: '8/6Pk/5K2/8/8/8/8/8 w - - 0 1', cards: { w: ['battlefield_promotion'], b: [] },
    desc: 'Promoting on g8 lets the king escape. Promote somewhere better.' },
  { id: 's_storm', kind: 'scenario', name: 'Card Storm', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    cards: { w: ['shadow_step', 'fortress', 'knights_gambit', 'frostbite', 'pawn_rally', 'last_stand'], b: ['time_fracture', 'royal_exchange', 'double_threat', 'ice_lance', 'quick_retreat', 'resurrection'] },
    desc: 'Both sides start with six cards. Two players, one round.' },
  { id: 's_pawnwar', kind: 'scenario', name: 'Pawn War', fen: '4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1',
    cards: { w: ['pawn_rally', 'double_time', 'pawn_vault', 'shove', 'conscript', 'army_of_one'], b: ['pawn_rally', 'double_time', 'pawn_vault', 'shove', 'conscript', 'army_of_one'] },
    desc: 'Kings and pawns only, with mirrored pawn cards. First to promote usually wins.' },
  { id: 's_siege', kind: 'scenario', name: 'The Siege', fen: 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    cards: { w: ['ice_lance', 'lightning'], b: ['second_reign', 'iron_will', 'fortress', 'last_stand', 'undying', 'shield_wall'] },
    desc: 'White has the full army. Black has no minor pieces or queen, but holds the legendary defences.' },
  { id: 's_duel', kind: 'scenario', name: 'Royal Duel', fen: '3qk3/pppppppp/8/8/8/8/PPPPPPPP/3QK3 w - - 0 1',
    cards: { w: ['kings_gambit', 'second_reign', 'aegis', 'deep_freeze'], b: ['kings_gambit', 'second_reign', 'aegis', 'deep_freeze'] },
    desc: 'Queens, pawns and identical legendary hands. Pure skill.' },
];
