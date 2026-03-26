import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { 
  MINUTES_SAVED_PER_CONVERSATION, 
  VALUE_PER_HOUR_CLP,
  COST_PER_WHATSAPP_MESSAGE,
  COST_PER_AI_CALL,
  LABOR_COST_PER_HOUR_USD
} from '@/components/metrics/metricDefinitions';
import { startOfDay, startOfWeek, startOfMonth, subDays, format } from 'date-fns';

export type BreakdownPeriod = 'day' | 'week' | 'month' | 'all';

interface BreakdownDataPoint {
  date: string;
  value: number;
  label: string;
}

interface MetricBreakdownResult {
  currentValue: number;
  breakdown: BreakdownDataPoint[];
  comparison: {
    previous: number;
    change: number;
    trend: 'up' | 'down' | 'neutral';
  };
  calculationExample: string;
}

interface UseMetricBreakdownOptions {
  metricId: string;
  workshopId?: string | null;
  period: BreakdownPeriod;
  isAdmin?: boolean;
}

export function useMetricBreakdown({ 
  metricId, 
  workshopId, 
  period,
  isAdmin = false 
}: UseMetricBreakdownOptions) {
  return useQuery({
    queryKey: ['metric-breakdown', metricId, workshopId, period, isAdmin],
    queryFn: async (): Promise<MetricBreakdownResult> => {
      const now = new Date();
      let startDate: Date;
      let previousStartDate: Date;
      let groupBy: 'day' | 'week' | 'month' = 'day';

      switch (period) {
        case 'day':
          startDate = startOfDay(now);
          previousStartDate = startOfDay(subDays(now, 1));
          groupBy = 'day';
          break;
        case 'week':
          startDate = startOfWeek(now, { weekStartsOn: 1 });
          previousStartDate = startOfWeek(subDays(now, 7), { weekStartsOn: 1 });
          groupBy = 'day';
          break;
        case 'month':
          startDate = startOfMonth(now);
          previousStartDate = startOfMonth(subDays(now, 30));
          groupBy = 'week';
          break;
        default:
          startDate = new Date(0);
          previousStartDate = new Date(0);
          groupBy = 'month';
      }

      // Fetch data based on metric type
      const result = await fetchMetricData(metricId, workshopId, startDate, previousStartDate, groupBy, isAdmin);
      return result;
    },
    enabled: isAdmin || !!workshopId,
    staleTime: 60000, // 1 minute
  });
}

async function fetchMetricData(
  metricId: string,
  workshopId: string | null | undefined,
  startDate: Date,
  previousStartDate: Date,
  groupBy: 'day' | 'week' | 'month',
  isAdmin: boolean
): Promise<MetricBreakdownResult> {
  
  // Default empty result
  const emptyResult: MetricBreakdownResult = {
    currentValue: 0,
    breakdown: [],
    comparison: { previous: 0, change: 0, trend: 'neutral' },
    calculationExample: '',
  };

  switch (metricId) {
    case 'conversations':
    case 'hours_saved':
    case 'value_generated': {
      let query = supabase
        .from('conversations')
        .select('created_at')
        .gte('created_at', previousStartDate.toISOString());
      
      if (!isAdmin && workshopId) {
        query = query.eq('workshop_id', workshopId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const current = data?.filter(d => new Date(d.created_at) >= startDate).length || 0;
      const previous = data?.filter(d => new Date(d.created_at) < startDate).length || 0;
      
      // Build breakdown
      const breakdown = buildBreakdown(data || [], startDate, groupBy);
      
      let currentValue = current;
      let previousValue = previous;
      let calculationExample = `${current} conversaciones`;
      
      if (metricId === 'hours_saved') {
        currentValue = (current * MINUTES_SAVED_PER_CONVERSATION) / 60;
        previousValue = (previous * MINUTES_SAVED_PER_CONVERSATION) / 60;
        calculationExample = `${current} conversaciones × 8 min ÷ 60 = ${currentValue.toFixed(1)} horas`;
        breakdown.forEach(b => b.value = (b.value * MINUTES_SAVED_PER_CONVERSATION) / 60);
      } else if (metricId === 'value_generated') {
        const hoursCurrent = (current * MINUTES_SAVED_PER_CONVERSATION) / 60;
        const hoursPrevious = (previous * MINUTES_SAVED_PER_CONVERSATION) / 60;
        currentValue = hoursCurrent * VALUE_PER_HOUR_CLP;
        previousValue = hoursPrevious * VALUE_PER_HOUR_CLP;
        calculationExample = `${hoursCurrent.toFixed(1)} horas × $15,000/hora = $${Math.round(currentValue).toLocaleString('es-CL')} CLP`;
        breakdown.forEach(b => b.value = ((b.value * MINUTES_SAVED_PER_CONVERSATION) / 60) * VALUE_PER_HOUR_CLP);
      }

      const change = previousValue > 0 ? ((currentValue - previousValue) / previousValue) * 100 : 0;

      return {
        currentValue,
        breakdown,
        comparison: {
          previous: previousValue,
          change,
          trend: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral',
        },
        calculationExample,
      };
    }

    case 'clients': {
      let query = supabase
        .from('contacts')
        .select('created_at')
        .gte('created_at', previousStartDate.toISOString());
      
      if (!isAdmin && workshopId) {
        query = query.eq('workshop_id', workshopId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const current = data?.filter(d => new Date(d.created_at) >= startDate).length || 0;
      const previous = data?.filter(d => new Date(d.created_at) < startDate).length || 0;
      const breakdown = buildBreakdown(data || [], startDate, groupBy);
      const change = previous > 0 ? ((current - previous) / previous) * 100 : 0;

      return {
        currentValue: current,
        breakdown,
        comparison: {
          previous,
          change,
          trend: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral',
        },
        calculationExample: `${current} contactos nuevos`,
      };
    }

    case 'bot_messages':
    case 'messages_received': {
      const direction = metricId === 'bot_messages' ? 'outbound' : 'inbound';
      
      let query = supabase
        .from('messages')
        .select('created_at')
        .eq('direction', direction)
        .gte('created_at', previousStartDate.toISOString());
      
      if (!isAdmin && workshopId) {
        query = query.eq('workshop_id', workshopId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const current = data?.filter(d => new Date(d.created_at) >= startDate).length || 0;
      const previous = data?.filter(d => new Date(d.created_at) < startDate).length || 0;
      const breakdown = buildBreakdown(data || [], startDate, groupBy);
      const change = previous > 0 ? ((current - previous) / previous) * 100 : 0;

      return {
        currentValue: current,
        breakdown,
        comparison: {
          previous,
          change,
          trend: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral',
        },
        calculationExample: `${current} mensajes ${direction === 'outbound' ? 'enviados' : 'recibidos'}`,
      };
    }

    case 'appointments': {
      let query = supabase
        .from('appointments')
        .select('created_at')
        .gte('created_at', previousStartDate.toISOString());
      
      if (!isAdmin && workshopId) {
        query = query.eq('workshop_id', workshopId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const current = data?.filter(d => new Date(d.created_at) >= startDate).length || 0;
      const previous = data?.filter(d => new Date(d.created_at) < startDate).length || 0;
      const breakdown = buildBreakdown(data || [], startDate, groupBy);
      const change = previous > 0 ? ((current - previous) / previous) * 100 : 0;

      return {
        currentValue: current,
        breakdown,
        comparison: {
          previous,
          change,
          trend: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral',
        },
        calculationExample: `${current} citas agendadas`,
      };
    }

    case 'conversion_rate': {
      // First get the workshop's booking mode to determine what counts as conversion
      let bookingMode = 'with_scheduling'; // default
      
      if (!isAdmin && workshopId) {
        const { data: workshopData } = await supabase
          .from('workshops')
          .select('booking_mode')
          .eq('id', workshopId)
          .single();
        bookingMode = workshopData?.booking_mode || 'with_scheduling';
      }

      let convQuery = supabase
        .from('conversations')
        .select('created_at')
        .gte('created_at', previousStartDate.toISOString());
      
      if (!isAdmin && workshopId) {
        convQuery = convQuery.eq('workshop_id', workshopId);
      }

      const { data: convData } = await convQuery;

      let currentConversions = 0;
      let prevConversions = 0;
      let conversionType = 'citas';

      if (bookingMode === 'with_scheduling') {
        // For scheduling businesses: count appointments
        let apptQuery = supabase
          .from('appointments')
          .select('created_at')
          .gte('created_at', previousStartDate.toISOString());
        
        if (!isAdmin && workshopId) {
          apptQuery = apptQuery.eq('workshop_id', workshopId);
        }

        const { data: apptData } = await apptQuery;
        currentConversions = apptData?.filter(d => new Date(d.created_at) >= startDate).length || 0;
        prevConversions = apptData?.filter(d => new Date(d.created_at) < startDate).length || 0;
        conversionType = 'citas';
      } else {
        // For chatbot_only businesses: count quotations/service requests
        let quotesQuery = supabase
          .from('service_requests')
          .select('created_at')
          .gte('created_at', previousStartDate.toISOString());
        
        if (!isAdmin && workshopId) {
          quotesQuery = quotesQuery.eq('workshop_id', workshopId);
        }

        const { data: quotesData } = await quotesQuery;
        currentConversions = quotesData?.filter(d => new Date(d.created_at) >= startDate).length || 0;
        prevConversions = quotesData?.filter(d => new Date(d.created_at) < startDate).length || 0;
        conversionType = 'cotizaciones';
      }

      const currentConv = convData?.filter(d => new Date(d.created_at) >= startDate).length || 0;
      const prevConv = convData?.filter(d => new Date(d.created_at) < startDate).length || 0;

      const currentRate = currentConv > 0 ? (currentConversions / currentConv) * 100 : 0;
      const prevRate = prevConv > 0 ? (prevConversions / prevConv) * 100 : 0;
      const change = prevRate > 0 ? ((currentRate - prevRate) / prevRate) * 100 : 0;

      return {
        currentValue: currentRate,
        breakdown: [],
        comparison: {
          previous: prevRate,
          change,
          trend: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral',
        },
        calculationExample: `(${currentConversions} ${conversionType} ÷ ${currentConv} conv.) × 100 = ${currentRate.toFixed(0)}%`,
      };
    }

    case 'closed_clients': {
      let query = supabase
        .from('contacts')
        .select('name, phone, closed_at')
        .not('closed_at', 'is', null);
      
      if (!isAdmin && workshopId) {
        query = query.eq('workshop_id', workshopId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const currentPeriod = data?.filter(d => new Date(d.closed_at!) >= startDate) || [];
      const previousPeriod = data?.filter(d => new Date(d.closed_at!) >= previousStartDate && new Date(d.closed_at!) < startDate) || [];

      // Build breakdown with names
      const breakdown: BreakdownDataPoint[] = currentPeriod.map(c => ({
        date: c.closed_at!,
        value: 1,
        label: c.name || c.phone || 'Sin nombre',
      }));

      const change = previousPeriod.length > 0 
        ? ((currentPeriod.length - previousPeriod.length) / previousPeriod.length) * 100 
        : 0;

      return {
        currentValue: data?.length || 0,
        breakdown,
        comparison: {
          previous: previousPeriod.length,
          change,
          trend: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral',
        },
        calculationExample: `${data?.length || 0} clientes cerrados en total`,
      };
    }

    case 'active_requests': {
      let query = supabase
        .from('service_requests')
        .select('created_at')
        .not('status', 'in', '("done","lost")')
        .gte('created_at', previousStartDate.toISOString());
      
      if (!isAdmin && workshopId) {
        query = query.eq('workshop_id', workshopId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const current = data?.filter(d => new Date(d.created_at) >= startDate).length || 0;
      const previous = data?.filter(d => new Date(d.created_at) < startDate).length || 0;
      const breakdown = buildBreakdown(data || [], startDate, groupBy);
      const change = previous > 0 ? ((current - previous) / previous) * 100 : 0;

      return {
        currentValue: current,
        breakdown,
        comparison: { previous, change, trend: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral' },
        calculationExample: `${current} solicitudes activas`,
      };
    }

    default:
      return emptyResult;
  }
}

function buildBreakdown(
  data: { created_at: string }[],
  startDate: Date,
  groupBy: 'day' | 'week' | 'month'
): BreakdownDataPoint[] {
  const filteredData = data.filter(d => new Date(d.created_at) >= startDate);
  const grouped: Record<string, number> = {};

  filteredData.forEach(item => {
    const date = new Date(item.created_at);
    let key: string;
    let label: string;

    if (groupBy === 'day') {
      key = format(date, 'yyyy-MM-dd');
      label = format(date, 'EEE');
    } else if (groupBy === 'week') {
      key = format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      label = `Sem ${format(date, 'w')}`;
    } else {
      key = format(startOfMonth(date), 'yyyy-MM');
      label = format(date, 'MMM');
    }

    grouped[key] = (grouped[key] || 0) + 1;
  });

  return Object.entries(grouped)
    .map(([date, value]) => ({
      date,
      value,
      label: groupBy === 'day' 
        ? format(new Date(date), 'EEE') 
        : groupBy === 'week' 
          ? `Sem` 
          : format(new Date(date), 'MMM'),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
