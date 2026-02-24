import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface PaymentRecord {
  id: string;
  workshop_id: string;
  payment_type: 'setup' | 'monthly' | 'extra';
  amount_clp: number;
  payment_date: string;
  payment_method: string | null;
  period_start: string | null;
  period_end: string | null;
  receipt_number: string | null;
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
}

export interface CreatePaymentRecord {
  workshop_id: string;
  payment_type: 'setup' | 'monthly' | 'extra';
  amount_clp: number;
  payment_date: string;
  payment_method?: string;
  period_start?: string;
  period_end?: string;
  receipt_number?: string;
  notes?: string;
}

export function usePaymentRecords(workshopId: string | undefined) {
  return useQuery({
    queryKey: ['payment-records', workshopId],
    queryFn: async () => {
      if (!workshopId) return [];
      
      const { data, error } = await supabase
        .from('payment_records')
        .select('*')
        .eq('workshop_id', workshopId)
        .order('payment_date', { ascending: false });
      
      if (error) throw error;
      
      return data as PaymentRecord[];
    },
    enabled: !!workshopId,
  });
}

export function useCreatePaymentRecord() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  
  return useMutation({
    mutationFn: async (record: CreatePaymentRecord) => {
      const { data, error } = await supabase
        .from('payment_records')
        .insert({
          ...record,
          recorded_by: profile?.id,
        })
        .select()
        .single();
      
      if (error) throw error;
      
      // If it's a monthly payment, update workshop_billing
      if (record.payment_type === 'monthly' || record.payment_type === 'setup') {
        const updateData: Record<string, unknown> = {
          last_payment_date: record.payment_date,
          last_payment_amount: record.amount_clp,
          payment_status: 'current',
        };
        
        if (record.payment_type === 'setup') {
          updateData.setup_fee_paid = true;
          updateData.setup_paid_at = new Date().toISOString();
        }
        
        if (record.payment_type === 'monthly') {
          // Calculate next billing date (1 month from payment)
          const paymentDate = new Date(record.payment_date);
          const { data: billingData } = await supabase
            .from('workshop_billing')
            .select('billing_day')
            .eq('workshop_id', record.workshop_id)
            .single();
          
          const billingDay = billingData?.billing_day || 1;
          const nextMonth = paymentDate.getMonth() + 1;
          const nextYear = nextMonth > 11 ? paymentDate.getFullYear() + 1 : paymentDate.getFullYear();
          const actualMonth = nextMonth > 11 ? 0 : nextMonth;
          
          const daysInMonth = new Date(nextYear, actualMonth + 1, 0).getDate();
          const actualDay = Math.min(billingDay, daysInMonth);
          
          const nextBillingDate = new Date(nextYear, actualMonth, actualDay);
          updateData.next_billing_date = nextBillingDate.toISOString().split('T')[0];
        }
        
        await supabase
          .from('workshop_billing')
          .update(updateData)
          .eq('workshop_id', record.workshop_id);
      }
      
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['payment-records', variables.workshop_id] });
      queryClient.invalidateQueries({ queryKey: ['workshop-billing', variables.workshop_id] });
      queryClient.invalidateQueries({ queryKey: ['all-workshop-billing'] });
    },
  });
}

export function useDeletePaymentRecord() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, workshopId }: { id: string; workshopId: string }) => {
      const { error } = await supabase
        .from('payment_records')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      
      return workshopId;
    },
    onSuccess: (workshopId) => {
      queryClient.invalidateQueries({ queryKey: ['payment-records', workshopId] });
    },
  });
}
