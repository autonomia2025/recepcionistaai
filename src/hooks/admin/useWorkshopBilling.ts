import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface WorkshopBilling {
  id: string;
  workshop_id: string;
  setup_fee_clp: number | null;
  setup_fee_paid: boolean;
  setup_paid_at: string | null;
  setup_notes: string | null;
  monthly_fee_clp: number | null;
  billing_day: number;
  next_billing_date: string | null;
  discount_percent: number | null;
  discount_ends_at: string | null;
  payment_status: 'pending' | 'current' | 'overdue';
  last_payment_date: string | null;
  last_payment_amount: number | null;
  payment_method: string | null;
  billing_contact_name: string | null;
  billing_contact_email: string | null;
  billing_contact_phone: string | null;
  rut: string | null;
  razon_social: string | null;
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
}

export type WorkshopBillingUpdate = Partial<Omit<WorkshopBilling, 'id' | 'workshop_id' | 'created_at' | 'updated_at'>>;

export function useWorkshopBilling(workshopId: string | undefined) {
  return useQuery({
    queryKey: ['workshop-billing', workshopId],
    queryFn: async () => {
      if (!workshopId) return null;
      
      const { data, error } = await supabase
        .from('workshop_billing')
        .select('*')
        .eq('workshop_id', workshopId)
        .single();
      
      if (error) {
        // If no billing record exists, return null (will be created on first update)
        if (error.code === 'PGRST116') return null;
        throw error;
      }
      
      return data as WorkshopBilling;
    },
    enabled: !!workshopId,
  });
}

export function useAllWorkshopBilling() {
  return useQuery({
    queryKey: ['all-workshop-billing'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workshop_billing')
        .select('*');
      
      if (error) throw error;
      
      return data as WorkshopBilling[];
    },
  });
}

export function useUpdateWorkshopBilling() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ workshopId, data }: { workshopId: string; data: WorkshopBillingUpdate }) => {
      // Check if billing record exists
      const { data: existing } = await supabase
        .from('workshop_billing')
        .select('id')
        .eq('workshop_id', workshopId)
        .single();
      
      if (existing) {
        // Update existing
        const { error } = await supabase
          .from('workshop_billing')
          .update(data)
          .eq('workshop_id', workshopId);
        
        if (error) throw error;
      } else {
        // Create new
        const { error } = await supabase
          .from('workshop_billing')
          .insert({ workshop_id: workshopId, ...data });
        
        if (error) throw error;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['workshop-billing', variables.workshopId] });
      queryClient.invalidateQueries({ queryKey: ['all-workshop-billing'] });
    },
  });
}

// Helper to calculate payment status
export function calculatePaymentStatus(
  nextBillingDate: string | null,
  lastPaymentDate: string | null
): 'pending' | 'current' | 'overdue' {
  if (!nextBillingDate) return 'pending';
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const nextBilling = new Date(nextBillingDate);
  nextBilling.setHours(0, 0, 0, 0);
  
  const diffDays = Math.ceil((nextBilling.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) return 'overdue';
  if (diffDays <= 7) return 'pending';
  return 'current';
}

// Helper to calculate next billing date
export function calculateNextBillingDate(billingDay: number, fromDate?: Date): string {
  const date = fromDate || new Date();
  const currentDay = date.getDate();
  const currentMonth = date.getMonth();
  const currentYear = date.getFullYear();
  
  let nextMonth = currentDay >= billingDay ? currentMonth + 1 : currentMonth;
  let nextYear = currentYear;
  
  if (nextMonth > 11) {
    nextMonth = 0;
    nextYear++;
  }
  
  // Handle months with fewer days
  const daysInMonth = new Date(nextYear, nextMonth + 1, 0).getDate();
  const actualDay = Math.min(billingDay, daysInMonth);
  
  const nextDate = new Date(nextYear, nextMonth, actualDay);
  return nextDate.toISOString().split('T')[0];
}
