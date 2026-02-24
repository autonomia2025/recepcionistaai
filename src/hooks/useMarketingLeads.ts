import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface MarketingLead {
  id: string;
  created_at: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  industry: string | null;
  message: string | null;
  source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  status: string;
  owner: string | null;
  metadata: Record<string, unknown> | null;
}

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';

export const LEAD_STATUSES: { value: LeadStatus; label: string; color: string }[] = [
  { value: 'new', label: 'Nuevo', color: 'bg-emerald-100 text-emerald-800' },
  { value: 'contacted', label: 'Contactado', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'qualified', label: 'Calificado', color: 'bg-amber-100 text-amber-800' },
  { value: 'converted', label: 'Convertido', color: 'bg-green-100 text-green-800' },
  { value: 'lost', label: 'Perdido', color: 'bg-gray-100 text-gray-800' },
];

interface UseMarketingLeadsOptions {
  status?: string;
  startDate?: Date;
  endDate?: Date;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

export function useMarketingLeads(options: UseMarketingLeadsOptions = {}) {
  const { status, startDate, endDate, utmSource, utmMedium, utmCampaign } = options;

  return useQuery({
    queryKey: ['marketing-leads', status, startDate?.toISOString(), endDate?.toISOString(), utmSource, utmMedium, utmCampaign],
    queryFn: async () => {
      let query = supabase
        .from('marketing_leads')
        .select('*')
        .order('created_at', { ascending: false });

      if (status && status !== 'all') {
        query = query.eq('status', status);
      }

      if (startDate) {
        query = query.gte('created_at', startDate.toISOString());
      }

      if (endDate) {
        query = query.lte('created_at', endDate.toISOString());
      }

      if (utmSource) {
        query = query.eq('utm_source', utmSource);
      }

      if (utmMedium) {
        query = query.eq('utm_medium', utmMedium);
      }

      if (utmCampaign) {
        query = query.eq('utm_campaign', utmCampaign);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as MarketingLead[];
    },
  });
}

export function useUpdateLeadStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ leadId, status }: { leadId: string; status: string }) => {
      const { error } = await supabase
        .from('marketing_leads')
        .update({ status })
        .eq('id', leadId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing-leads'] });
    },
  });
}

export function useAssignLeadOwner() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ leadId, ownerId }: { leadId: string; ownerId: string | null }) => {
      const { error } = await supabase
        .from('marketing_leads')
        .update({ owner: ownerId })
        .eq('id', leadId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing-leads'] });
    },
  });
}

export function useDeleteLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (leadId: string) => {
      const { error } = await supabase
        .from('marketing_leads')
        .delete()
        .eq('id', leadId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing-leads'] });
    },
  });
}

export function useLeadUtmOptions() {
  return useQuery({
    queryKey: ['lead-utm-options'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marketing_leads')
        .select('utm_source, utm_medium, utm_campaign');

      if (error) throw error;

      const sources = [...new Set(data.map(d => d.utm_source).filter(Boolean))];
      const mediums = [...new Set(data.map(d => d.utm_medium).filter(Boolean))];
      const campaigns = [...new Set(data.map(d => d.utm_campaign).filter(Boolean))];

      return { sources, mediums, campaigns };
    },
  });
}
