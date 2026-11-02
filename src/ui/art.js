// Hand-drawn geometric pieces and card icons (inline SVG, no external assets).
const PIECE = {
  p: '<circle cx="50" cy="31" r="13"/><path d="M35 79 L40 51 Q50 43 60 51 L65 79 Z"/>',
  r: '<path d="M34 79 L37 45 H63 L66 79 Z"/><path d="M29 45 V21 H38 V29 H45 V21 H55 V29 H62 V21 H71 V45 Z"/>',
  n: '<path d="M30 79 H71 C71 60 69 40 56 27 L58 13 L47 21 C35 23 26 34 22 49 L29 56 L40 49 C43 58 35 66 30 79 Z"/><circle cx="43" cy="33" r="3.6" class="eye"/>',
  b: '<path d="M35 79 C29 62 31 46 50 23 C69 46 71 62 65 79 Z"/><circle cx="50" cy="16" r="6"/><path d="M50 40 L59 51" class="slit"/>',
  q: '<path d="M32 79 L25 33 L38 50 L44 24 L50 45 L56 24 L62 50 L75 33 L68 79 Z"/><circle cx="25" cy="31" r="5"/><circle cx="44" cy="21" r="5"/><circle cx="56" cy="21" r="5"/><circle cx="75" cy="31" r="5"/>',
  k: '<path d="M34 79 C29 62 31 49 50 40 C69 49 71 62 66 79 Z"/><path d="M46 12 H54 V20 H62 V28 H54 V40 H46 V28 H38 V20 H46 Z"/>',
};
export function pieceSVG(t, c) {
  return `<svg viewBox="0 0 100 100" class="pc pc-${c}" aria-hidden="true"><g class="body">${PIECE[t]}</g><rect x="25" y="79" width="50" height="10" rx="5" class="base"/></svg>`;
}

const I = {
  dash: '<path d="M4 12h12M12 6l6 6-6 6"/><path d="M2 8h4M2 16h4"/>',
  leap: '<path d="M4 18c2-9 10-13 16-12"/><path d="M15 3l5 3-3 5"/>',
  swap: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  teleport: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  immune: '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  shield: '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/>',
  ward: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  freeze: '<path d="M12 2v20M3 7l18 10M21 7L3 17"/><path d="M9 4l3 3 3-3M9 20l3-3 3 3"/>',
  wall: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 12h18M9 5v7M15 12v7"/>',
  trap: '<path d="M3 17h18M5 17l3-8 4 5 4-5 3 8"/>',
  mark: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5"/>',
  castle: '<path d="M5 21V9h3v3h3V9h2v3h3V9h3v12z"/>',
  cleanse: '<path d="M12 3c4 5 6 8 6 11a6 6 0 01-12 0c0-3 2-6 6-11z"/>',
  push: '<path d="M12 20V6M6 12l6-6 6 6"/><path d="M4 22h16"/>',
  draw: '<rect x="5" y="3" width="11" height="15" rx="2"/><rect x="9" y="6" width="11" height="15" rx="2"/>',
  empower: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
  disarm: '<path d="M5 19L19 5M14 5h5v5"/><path d="M4 4l16 16"/>',
  burst: '<path d="M12 2l2 6 6-2-4 5 5 4-6 1 1 6-4-4-4 4 1-6-6-1 5-4-4-5 6 2z"/>',
  pass: '<circle cx="12" cy="12" r="9"/><path d="M10 8v8M14 8v8"/>',
  silence: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6"/>',
  phase: '<path d="M4 12h3M10 12h4M17 12h3"/><path d="M15 8l5 4-5 4"/>',
  fortress: '<path d="M4 21V7h4v3h3V7h2v3h3V7h4v14z"/><path d="M10 21v-5h4v5"/>',
  revive: '<path d="M12 21V8M7 13l5-5 5 5"/><path d="M5 4h14"/>',
  promote: '<path d="M3 18l3-10 6 6 6-6 3 10z"/><path d="M3 21h18"/>',
  convert: '<path d="M4 12a8 8 0 0114-5M20 12a8 8 0 01-14 5"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  lightning: '<path d="M14 2L6 13h5l-2 9 9-12h-5z"/>',
  rewind: '<path d="M11 6L4 12l7 6zM20 6l-7 6 7 6z"/>',
  sight: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  royal: '<path d="M3 17l2-10 4 5 3-7 3 7 4-5 2 10z"/><path d="M4 20h16"/>',
  quake: '<path d="M2 14l4-4 3 5 4-8 3 6 3-3 3 4"/><path d="M2 20h20"/>',
};
export const icon = (k, cls = 'ic') => `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true">${I[k] || I.burst}</svg>`;
export const ICONS = I;
