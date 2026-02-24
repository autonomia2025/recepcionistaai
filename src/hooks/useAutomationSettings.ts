import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface AutomationSettings {
  workshop_id: string;
  confirm_24h: boolean;
  remind_3h: boolean;
  followup_no_booking: boolean;
  reengagement_6_months: boolean;
  reminder_24h_subject: string | null;
  reminder_24h_body: string | null;
  reminder_3h_subject: string | null;
  reminder_3h_body: string | null;
  updated_at: string;
}

const DEFAULT_24H_SUBJECT = 'Recordatorio: Tu cita mañana en {{taller}}';
const DEFAULT_24H_BODY = `Hola {{nombre}},

Te recordamos que tienes una cita agendada para mañana:

📆 Fecha: {{fecha}}
🕐 Hora: {{hora}}
🔧 Servicio: {{servicio}}
📍 Dirección: {{direccion}}

Si necesitas cancelar o reprogramar, por favor contáctanos con anticipación.

¡Te esperamos!

{{taller}}
{{telefono}}`;

const DEFAULT_3H_SUBJECT = 'Tu cita es en 3 horas - {{taller}}';
const DEFAULT_3H_BODY = `Hola {{nombre}},

Tu cita es en 3 horas. ¡Te esperamos!

🕐 Hora: {{hora}}
🔧 Servicio: {{servicio}}
📍 Dirección: {{direccion}}

{{taller}}
{{telefono}}`;

export function useAutomationSettings() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['automation-settings', profile?.workshop_id],
    queryFn: async () => {
      if (!profile?.workshop_id) return null;

      const { data, error } = await supabase
        .from('automations_settings')
        .select('*')
        .eq('workshop_id', profile.workshop_id)
        .single();

      if (error) {
        // If not found, return defaults
        if (error.code === 'PGRST116') {
          return {
            workshop_id: profile.workshop_id,
            confirm_24h: true,
            remind_3h: true,
            followup_no_booking: false,
            reengagement_6_months: false,
            reminder_24h_subject: DEFAULT_24H_SUBJECT,
            reminder_24h_body: DEFAULT_24H_BODY,
            reminder_3h_subject: DEFAULT_3H_SUBJECT,
            reminder_3h_body: DEFAULT_3H_BODY,
            updated_at: new Date().toISOString()
          } as AutomationSettings;
        }
        throw error;
      }

      return {
        ...data,
        reminder_24h_subject: (data as Record<string, unknown>).reminder_24h_subject || DEFAULT_24H_SUBJECT,
        reminder_24h_body: (data as Record<string, unknown>).reminder_24h_body || DEFAULT_24H_BODY,
        reminder_3h_subject: (data as Record<string, unknown>).reminder_3h_subject || DEFAULT_3H_SUBJECT,
        reminder_3h_body: (data as Record<string, unknown>).reminder_3h_body || DEFAULT_3H_BODY,
      } as AutomationSettings;
    },
    enabled: !!profile?.workshop_id
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (updates: Partial<AutomationSettings>) => {
      if (!profile?.workshop_id) throw new Error('No workshop');

      const { data, error } = await supabase
        .from('automations_settings')
        .upsert({
          workshop_id: profile.workshop_id,
          ...updates,
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-settings'] });
      toast({
        title: 'Configuración guardada',
        description: 'Los cambios se han guardado correctamente'
      });
    },
    onError: (error) => {
      console.error('Error updating automation settings:', error);
      toast({
        title: 'Error',
        description: 'No se pudo guardar la configuración',
        variant: 'destructive'
      });
    }
  });

  return {
    settings,
    isLoading,
    updateSettings: updateSettingsMutation.mutateAsync,
    isUpdating: updateSettingsMutation.isPending
  };
}
