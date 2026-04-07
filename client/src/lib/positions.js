// Canonical position color system. Used everywhere for badges / list grouping.
export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'OT', 'IOL', 'EDGE', 'DT', 'LB', 'CB', 'S'];

export const POSITION_COLORS = {
  QB:   { bg: 'bg-red-500/15',    text: 'text-red-300',    ring: 'ring-red-500/30' },
  RB:   { bg: 'bg-emerald-500/15',text: 'text-emerald-300',ring: 'ring-emerald-500/30' },
  WR:   { bg: 'bg-sky-500/15',    text: 'text-sky-300',    ring: 'ring-sky-500/30' },
  TE:   { bg: 'bg-pink-500/15',   text: 'text-pink-300',   ring: 'ring-pink-500/30' },
  OT:   { bg: 'bg-yellow-500/15', text: 'text-yellow-300', ring: 'ring-yellow-500/30' },
  IOL:  { bg: 'bg-amber-500/15',  text: 'text-amber-300',  ring: 'ring-amber-500/30' },
  EDGE: { bg: 'bg-orange-500/15', text: 'text-orange-300', ring: 'ring-orange-500/30' },
  DT:   { bg: 'bg-stone-500/20',  text: 'text-stone-300',  ring: 'ring-stone-500/30' },
  LB:   { bg: 'bg-teal-500/15',   text: 'text-teal-300',   ring: 'ring-teal-500/30' },
  CB:   { bg: 'bg-purple-500/15', text: 'text-purple-300', ring: 'ring-purple-500/30' },
  S:    { bg: 'bg-green-500/15',  text: 'text-green-300',  ring: 'ring-green-500/30' },
};

export function posColor(pos) {
  return POSITION_COLORS[pos] || { bg: 'bg-slate-500/15', text: 'text-slate-300', ring: 'ring-slate-500/30' };
}
