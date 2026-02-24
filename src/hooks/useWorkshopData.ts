import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface Workshop {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  // Gmail & Email settings
  gmail_connected?: boolean | null;
  gmail_email?: string | null;
  email_sender_name?: string | null;
  email_reminders_enabled?: boolean | null;
  email_notifications_handoff?: boolean | null;
  email_notifications_hot_lead?: boolean | null;
  email_notifications_appointment?: boolean | null;
}

export interface Subscription {
  id: string;
  workshop_id: string;
  plan_id: string;
  status: 'active' | 'trial' | 'past_due' | 'canceled';
  max_users: number | null;
  started_at: string;
  ends_at: string | null;
  plans?: {
    name: string;
    price_clp: number;
  };
}

export interface SeatInfo {
  usedSeats: number;
  maxSeats: number | null;
  isUnlimited: boolean;
}

export const useWorkshop = () => {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ['workshop', profile?.workshop_id],
    queryFn: async (): Promise<Workshop | null> => {
      if (!profile?.workshop_id) return null;

      const { data, error } = await supabase
        .from('workshops')
        .select('*')
        .eq('id', profile.workshop_id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!profile?.workshop_id,
  });
};

export const useSubscription = () => {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ['subscription', profile?.workshop_id],
    queryFn: async (): Promise<Subscription | null> => {
      if (!profile?.workshop_id) return null;

      const { data, error } = await supabase
        .from('subscriptions')
        .select('*, plans(name, price_clp)')
        .eq('workshop_id', profile.workshop_id)
        .in('status', ['active', 'trial'])
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!profile?.workshop_id,
  });
};

export const useSeatInfo = () => {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ['seats', profile?.workshop_id],
    queryFn: async (): Promise<SeatInfo> => {
      if (!profile?.workshop_id) {
        return { usedSeats: 0, maxSeats: 0, isUnlimited: false };
      }

      // Use secure RPC to get seat info (bypasses need for workshop-level SELECT on profiles)
      const { data: seatData, error: seatError } = await supabase
        .rpc('get_workshop_seats', { _workshop_id: profile.workshop_id });

      if (seatError) throw seatError;

      const row = seatData?.[0];
      const usedSeats = row?.used_seats ?? 0;
      const maxSeats = row?.max_seats ?? null;

      return {
        usedSeats,
        maxSeats,
        isUnlimited: maxSeats === null,
      };
    },
    enabled: !!profile?.workshop_id,
  });
};
