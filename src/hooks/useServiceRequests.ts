import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export type ServiceRequestStatus = 
  | 'new'
  | 'contacting'
  | 'waiting_customer'
  | 'scheduled_visit'
  | 'quoted'
  | 'approved'
  | 'in_progress'
  | 'done'
  | 'lost';

export type RequestUrgency = 'low' | 'medium' | 'high';
export type RequestSource = 'whatsapp' | 'manual' | 'web';

export interface ServiceRequest {
  id: string;
  workshop_id: string;
  contact_id: string;
  conversation_id: string | null;
  service_category: string;
  description: string | null;
  address: string | null;
  comuna: string | null;
  preferred_time_window: string | null;
  urgency: RequestUrgency;
  status: ServiceRequestStatus;
  assigned_staff_id: string | null;
  estimated_value: number | null;
  notes: string | null;
  source: RequestSource;
  created_at: string;
  updated_at: string;
  contacts?: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
  };
  conversations?: {
    id: string;
    ai_summary: string | null;
    sentiment: string | null;
  } | null;
  assigned_staff?: {
    id: string;
    full_name: string;
  } | null;
}

export interface CreateServiceRequestData {
  contact_id: string;
  conversation_id?: string;
  service_category: string;
  description?: string;
  address?: string;
  comuna?: string;
  preferred_time_window?: string;
  urgency?: RequestUrgency;
  source?: RequestSource;
}

export interface UpdateServiceRequestData {
  status?: ServiceRequestStatus;
  assigned_staff_id?: string | null;
  estimated_value?: number | null;
  notes?: string;
  urgency?: RequestUrgency;
}

export const STATUS_LABELS: Record<ServiceRequestStatus, string> = {
  new: 'Nueva',
  contacting: 'Contactando',
  waiting_customer: 'Esperando cliente',
  scheduled_visit: 'Visita agendada',
  quoted: 'Cotizada',
  approved: 'Aprobada',
  in_progress: 'En progreso',
  done: 'Completada',
  lost: 'Perdida',
};

export const STATUS_COLORS: Record<ServiceRequestStatus, string> = {
  new: 'bg-emerald-500',
  contacting: 'bg-yellow-500',
  waiting_customer: 'bg-orange-500',
  scheduled_visit: 'bg-amber-500',
  quoted: 'bg-cyan-500',
  approved: 'bg-green-500',
  in_progress: 'bg-indigo-500',
  done: 'bg-emerald-600',
  lost: 'bg-red-500',
};

export const URGENCY_LABELS: Record<RequestUrgency, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
};

export const URGENCY_COLORS: Record<RequestUrgency, string> = {
  low: 'bg-gray-500',
  medium: 'bg-yellow-500',
  high: 'bg-red-500',
};

export function useServiceRequests() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'ADMIN';
  
  return useQuery({
    queryKey: ['service-requests', profile?.workshop_id],
    queryFn: async () => {
      if (!profile?.workshop_id) return [];
      
      const { data, error } = await supabase
        .from('service_requests')
        .select(`
          *,
          contacts (id, name, phone, email),
          conversations (id, ai_summary, sentiment),
          assigned_staff:profiles!service_requests_assigned_staff_id_fkey (id, full_name)
        `)
        .eq('workshop_id', profile.workshop_id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as ServiceRequest[];
    },
    enabled: !!profile?.workshop_id,
  });
}

export function useCreateServiceRequest() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (data: CreateServiceRequestData) => {
      if (!profile?.workshop_id) throw new Error('No workshop ID');
      
      const { data: result, error } = await supabase
        .from('service_requests')
        .insert({
          ...data,
          workshop_id: profile.workshop_id,
        })
        .select()
        .single();
      
      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-requests'] });
      toast({ title: 'Solicitud creada exitosamente' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });
}

export function useUpdateServiceRequest() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateServiceRequestData }) => {
      const { error } = await supabase
        .from('service_requests')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-requests'] });
      toast({ title: 'Solicitud actualizada' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });
}
