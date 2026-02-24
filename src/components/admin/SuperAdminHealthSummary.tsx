import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, Activity } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';

export const SuperAdminHealthSummary = () => {
    const navigate = useNavigate();

    const { data: healthStats } = useQuery({
        queryKey: ['superadmin-health-summary'],
        queryFn: async () => {
            const { data: workshops, error } = await supabase
                .from('workshops')
                .select('id, whatsapp_connected')
                .eq('is_active', true);

            if (error) throw error;

            // In a real scenario, we would also check health_logs for errors
            // or other metrics that define "critical".
            // For now, let's focus on WhatsApp connection as requested.
            const disconnectedWhatsApp = workshops?.filter(w => !w.whatsapp_connected).length || 0;

            return {
                disconnectedWhatsApp,
                totalActive: workshops?.length || 0
            };
        },
        refetchInterval: 30000, // Refresh every 30 seconds
    });

    if (!healthStats || healthStats.disconnectedWhatsApp === 0) return null;

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div
                        className="flex items-center gap-1.5 px-3 py-1 bg-red-50 text-red-600 rounded-full cursor-pointer hover:bg-red-100 transition-colors border border-red-100 animate-pulse"
                        onClick={() => navigate('/admin/health')}
                    >
                        <AlertTriangle className="w-4 h-4" />
                        <span className="text-xs font-bold">{healthStats.disconnectedWhatsApp}</span>
                        <span className="hidden sm:inline text-[10px] uppercase tracking-wider font-semibold">WSP Caídos</span>
                    </div>
                </TooltipTrigger>
                <TooltipContent>
                    <p>{healthStats.disconnectedWhatsApp} clientes con WhatsApp desconectado.</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Haz clic para ver el Health Check</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};
