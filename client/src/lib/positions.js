// Single source of truth for position → color. Everywhere.

export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'OT', 'IOL', 'EDGE', 'DT', 'CB', 'S', 'LB'];

export const POS_HEX = {
  QB:   '#ef4444',
  RB:   '#22d3ee',
  WR:   '#3b82f6',
  TE:   '#f472b6',
  OT:   '#eab308',
  IOL:  '#ca8a04',
  EDGE: '#f97316',
  DT:   '#a78bfa',
  CB:   '#a3e635',
  S:    '#34d399',
  LB:   '#2dd4bf',
};

export function posHex(pos) {
  return POS_HEX[pos] || '#64748b';
}
