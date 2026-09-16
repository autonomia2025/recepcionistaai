import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface WorkshopZone {
  id: string;
  key: string;
  label: string;
  color: string;
  notification_email: string | null;
  aliases: string[];
  is_active: boolean;
  sort_order: number;
}

// Tailwind only generates classes it can see in the source, so colours coming
// from the database are tokens mapped to static class strings here.
export const ZONE_COLOR_TOKENS = ['blue', 'emerald', 'violet', 'amber', 'rose', 'slate'] as const;

export const ZONE_COLOR_LABELS: Record<string, string> = {
  blue: 'Azul',
  emerald: 'Verde',
  violet: 'Violeta',
  amber: 'Ámbar',
  rose: 'Rosa',
  slate: 'Gris',
};

const BADGE_CLASSES: Record<string, string> = {
  blue: 'bg-blue-500/10 text-blue-700 border-blue-300 dark:text-blue-300',
  emerald: 'bg-emerald-500/10 text-emerald-700 border-emerald-300 dark:text-emerald-300',
  violet: 'bg-violet-500/10 text-violet-700 border-violet-300 dark:text-violet-300',
  amber: 'bg-amber-500/10 text-amber-700 border-amber-300 dark:text-amber-300',
  rose: 'bg-rose-500/10 text-rose-700 border-rose-300 dark:text-rose-300',
  slate: 'bg-slate-500/10 text-slate-700 border-slate-300 dark:text-slate-300',
};

const DOT_CLASSES: Record<string, string> = {
  blue: 'bg-blue-500',
  emerald: 'bg-emerald-500',
  violet: 'bg-violet-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  slate: 'bg-slate-500',
};

// The sidebar sits on a dark background, so it needs its own variant.
const SIDEBAR_CLASSES: Record<string, string> = {
  blue: 'bg-blue-500/20 text-blue-200 border border-blue-400/30',
  emerald: 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/30',
  violet: 'bg-violet-500/20 text-violet-200 border border-violet-400/30',
  amber: 'bg-amber-500/20 text-amber-200 border border-amber-400/30',
  rose: 'bg-rose-500/20 text-rose-200 border border-rose-400/30',
  slate: 'bg-slate-500/20 text-slate-200 border border-slate-400/30',
};

export const zoneBadgeClass = (color?: string | null) => BADGE_CLASSES[color ?? 'slate'] ?? BADGE_CLASSES.slate;
export const zoneSidebarClass = (color?: string | null) => SIDEBAR_CLASSES[color ?? 'slate'] ?? SIDEBAR_CLASSES.slate;
export const zoneDotClass = (color?: string | null) => DOT_CLASSES[color ?? 'slate'] ?? DOT_CLASSES.slate;

export function useWorkshopZones(workshopId?: string | null, options?: { includeInactive?: boolean }) {
  const { profile } = useAuth();
  const id = workshopId ?? profile?.workshop_id ?? null;
  const includeInactive = options?.includeInactive ?? false;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['workshop-zones', id, includeInactive],
    queryFn: async (): Promise<WorkshopZone[]> => {
      let query = supabase
        .from('workshop_zones')
        .select('id, key, label, color, notification_email, aliases, is_active, sort_order')
        .eq('workshop_id', id!)
        .order('sort_order', { ascending: true });

      if (!includeInactive) query = query.eq('is_active', true);

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as WorkshopZone[];
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  const zones = data ?? [];
  const labelOf = (key?: string | null) => zones.find((zone) => zone.key === key)?.label ?? key ?? '';
  const colorOf = (key?: string | null) => zones.find((zone) => zone.key === key)?.color ?? 'slate';

  return { zones, labelOf, colorOf, isLoading: !!id && isLoading, refetch };
}
