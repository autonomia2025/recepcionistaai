import type { StageKey } from '@/lib/leads';

export const STAGE_STYLE: Record<StageKey, { badge: string; dot: string }> = {
  replied: { badge: 'border-sky-300 bg-sky-50 text-sky-800', dot: 'bg-sky-500' },
  new: { badge: 'border-emerald-300 bg-emerald-50 text-emerald-800', dot: 'bg-emerald-500' },
  to_quote: { badge: 'border-amber-300 bg-amber-50 text-amber-800', dot: 'bg-amber-500' },
  ready: { badge: 'border-amber-300 bg-amber-50 text-amber-800', dot: 'bg-amber-500' },
  waiting_client: { badge: 'border-slate-300 bg-slate-50 text-slate-700', dot: 'bg-slate-400' },
  won: { badge: 'border-emerald-300 bg-emerald-50 text-emerald-800', dot: 'bg-emerald-600' },
  lost: { badge: 'border-red-300 bg-red-50 text-red-700', dot: 'bg-red-400' },
};
