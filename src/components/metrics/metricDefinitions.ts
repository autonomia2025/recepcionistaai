import { 
  Clock, 
  DollarSign, 
  MessageSquare, 
  Users, 
  Bot, 
  Calendar, 
  TrendingUp, 
  Building2,
  Calculator,
  Zap,
  AlertTriangle,
  ClipboardList
} from 'lucide-react';
import { LucideIcon } from 'lucide-react';

export type MetricUnit = 'currency_clp' | 'currency_usd' | 'hours' | 'count' | 'percentage';

export interface MetricDefinition {
  id: string;
  name: string;
  description: string;
  dataSource: string;
  formula: string;
  unit: MetricUnit;
  icon: LucideIcon;
  colorClass: string;
  bgClass: string;
}

// Constants used in calculations (exported for reuse)
export const MINUTES_SAVED_PER_CONVERSATION = 8;
export const VALUE_PER_HOUR_CLP = 15000;
export const LABOR_COST_PER_HOUR_USD = 3.5;
export const COST_PER_WHATSAPP_MESSAGE = 0.005;
export const COST_PER_AI_CALL = 0.001;

export const metricDefinitions: Record<string, MetricDefinition> = {
  // ==================== Dashboard Cliente ====================
  hours_saved: {
    id: 'hours_saved',
    name: 'Horas Ahorradas',
    description: 'El tiempo que tu equipo se ahorra gracias a que el bot responde automáticamente a los clientes, en lugar de tener que hacerlo manualmente.',
    dataSource: 'Se cuenta cada conversación con clientes desde WhatsApp. Estimamos 8 minutos ahorrados por cada conversación que el bot maneja.',
    formula: 'Conversaciones × 8 minutos ÷ 60 = Horas',
    unit: 'hours',
    icon: Clock,
    colorClass: 'text-primary',
    bgClass: 'bg-primary/10',
  },

  value_generated: {
    id: 'value_generated',
    name: 'Valor Generado',
    description: 'El valor monetario del tiempo que tu equipo ahorra. Representa cuánto dinero ahorras en mano de obra gracias a la automatización.',
    dataSource: 'Calculado a partir de las horas ahorradas, multiplicado por el costo promedio de una hora de trabajo.',
    formula: 'Horas ahorradas × $15,000 CLP/hora = Valor',
    unit: 'currency_clp',
    icon: DollarSign,
    colorClass: 'text-green-600',
    bgClass: 'bg-green-500/10',
  },

  conversations: {
    id: 'conversations',
    name: 'Conversaciones',
    description: 'Total de chats únicos con clientes. Cada conversación representa una interacción completa con un cliente desde que inicia hasta que termina.',
    dataSource: 'Tabla de conversaciones en la base de datos. Cada entrada representa un hilo de chat con un contacto.',
    formula: 'Conteo directo de conversaciones únicas',
    unit: 'count',
    icon: MessageSquare,
    colorClass: 'text-emerald-600',
    bgClass: 'bg-emerald-500/10',
  },

  clients: {
    id: 'clients',
    name: 'Clientes',
    description: 'Contactos únicos registrados en tu sistema. Cada cliente representa una persona que ha interactuado contigo por WhatsApp.',
    dataSource: 'Tabla de contactos. Cada contacto se crea automáticamente cuando alguien te escribe por primera vez.',
    formula: 'Conteo de contactos únicos',
    unit: 'count',
    icon: Users,
    colorClass: 'text-amber-600',
    bgClass: 'bg-amber-500/10',
  },

  bot_messages: {
    id: 'bot_messages',
    name: 'Mensajes del Bot',
    description: 'Cantidad de mensajes que el bot ha enviado automáticamente a tus clientes. Cada mensaje representa una respuesta generada por IA.',
    dataSource: 'Tabla de mensajes, filtrada por dirección "saliente" (outbound).',
    formula: 'Conteo de mensajes con direction = "outbound"',
    unit: 'count',
    icon: Bot,
    colorClass: 'text-orange-600',
    bgClass: 'bg-orange-500/10',
  },

  messages_received: {
    id: 'messages_received',
    name: 'Mensajes Recibidos',
    description: 'Total de mensajes que tus clientes te han enviado por WhatsApp.',
    dataSource: 'Tabla de mensajes, filtrada por dirección "entrante" (inbound).',
    formula: 'Conteo de mensajes con direction = "inbound"',
    unit: 'count',
    icon: MessageSquare,
    colorClass: 'text-teal-600',
    bgClass: 'bg-teal-500/10',
  },

  appointments: {
    id: 'appointments',
    name: 'Citas',
    description: 'Reservas confirmadas a través del sistema. Incluye citas agendadas vía bot o manualmente.',
    dataSource: 'Tabla de citas (appointments) del sistema de reservas.',
    formula: 'Conteo de citas registradas',
    unit: 'count',
    icon: Calendar,
    colorClass: 'text-indigo-600',
    bgClass: 'bg-indigo-500/10',
  },

  conversion_rate: {
    id: 'conversion_rate',
    name: 'Tasa de Conversión',
    description: 'Porcentaje de conversaciones que terminan en una acción exitosa. Para empresas con agenda: citas agendadas. Para empresas de cotizaciones: solicitudes de servicio creadas.',
    dataSource: 'Calculado comparando conversiones (citas o cotizaciones según tu modelo de negocio) contra el total de conversaciones.',
    formula: '(Conversiones ÷ Conversaciones) × 100 = %',
    unit: 'percentage',
    icon: TrendingUp,
    colorClass: 'text-rose-600',
    bgClass: 'bg-rose-500/10',
  },

  avg_response_time: {
    id: 'avg_response_time',
    name: 'Tiempo Resp. Prom.',
    description: 'Tiempo promedio que tarda el bot en responder a los mensajes de los clientes.',
    dataSource: 'Estimación basada en el rendimiento del sistema de IA.',
    formula: 'Estimado en ~3 minutos promedio',
    unit: 'count',
    icon: Clock,
    colorClass: 'text-amber-600',
    bgClass: 'bg-amber-500/10',
  },

  active_requests: {
    id: 'active_requests',
    name: 'Solicitudes Activas',
    description: 'Solicitudes de servicio que están en proceso o pendientes de atención.',
    dataSource: 'Tabla de solicitudes de servicio, excluyendo las finalizadas (done) y perdidas (lost).',
    formula: 'Conteo de solicitudes con status ≠ done y ≠ lost',
    unit: 'count',
    icon: ClipboardList,
    colorClass: 'text-violet-600',
    bgClass: 'bg-violet-500/10',
  },

  // ==================== StatsPage Superadmin ====================
  active_clients: {
    id: 'active_clients',
    name: 'Clientes Activos',
    description: 'Número de negocios (workshops) que tienen el servicio activo actualmente.',
    dataSource: 'Tabla de workshops, filtrada por estado activo.',
    formula: 'Conteo de workshops con is_active = true',
    unit: 'count',
    icon: Building2,
    colorClass: 'text-primary',
    bgClass: 'bg-primary/10',
  },

  mrr: {
    id: 'mrr',
    name: 'MRR',
    description: 'Ingreso Mensual Recurrente. Suma de todas las mensualidades de los clientes activos.',
    dataSource: 'Tabla workshop_billing, sumando los valores de monthly_fee_clp de clientes activos.',
    formula: 'Suma de monthly_fee_clp de todos los clientes activos',
    unit: 'currency_clp',
    icon: DollarSign,
    colorClass: 'text-green-600',
    bgClass: 'bg-green-500/10',
  },

  roi: {
    id: 'roi',
    name: 'ROI',
    description: 'Retorno sobre la inversión. Indica cuánto valor se genera por cada peso gastado en costos operacionales.',
    dataSource: 'Calculado comparando el valor generado contra los costos operacionales.',
    formula: '((Valor generado - Costos) ÷ Costos) × 100 = %',
    unit: 'percentage',
    icon: Calculator,
    colorClass: 'text-amber-600',
    bgClass: 'bg-amber-500/10',
  },

  value_generated_usd: {
    id: 'value_generated_usd',
    name: 'Valor Generado',
    description: 'Valor monetario del tiempo ahorrado a nivel plataforma, calculado en USD.',
    dataSource: 'Horas ahorradas multiplicadas por el costo estimado de mano de obra.',
    formula: 'Horas ahorradas × $3.50 USD/hora',
    unit: 'currency_usd',
    icon: TrendingUp,
    colorClass: 'text-green-600',
    bgClass: 'bg-green-500/10',
  },

  operational_cost: {
    id: 'operational_cost',
    name: 'Costo Operacional',
    description: 'Costo total de operar la plataforma, incluyendo WhatsApp Business API y llamadas a IA.',
    dataSource: 'Calculado sumando costos de mensajes WhatsApp y llamadas AI.',
    formula: '(Mensajes × $0.005) + (Llamadas AI × $0.001)',
    unit: 'currency_usd',
    icon: DollarSign,
    colorClass: 'text-orange-600',
    bgClass: 'bg-orange-500/10',
  },

  net_profit: {
    id: 'net_profit',
    name: 'Beneficio Neto',
    description: 'Diferencia entre el valor generado y los costos operacionales.',
    dataSource: 'Calculado restando costos del valor generado.',
    formula: 'Valor generado - Costos operacionales',
    unit: 'currency_usd',
    icon: TrendingUp,
    colorClass: 'text-emerald-600',
    bgClass: 'bg-emerald-500/10',
  },

  ai_calls: {
    id: 'ai_calls',
    name: 'Llamadas AI',
    description: 'Número de invocaciones a la inteligencia artificial para generar respuestas.',
    dataSource: 'Estimado como igual al número de mensajes salientes (cada respuesta = 1 llamada AI).',
    formula: 'Igual a mensajes enviados',
    unit: 'count',
    icon: Zap,
    colorClass: 'text-yellow-600',
    bgClass: 'bg-yellow-500/10',
  },

  auto_resolved: {
    id: 'auto_resolved',
    name: 'Auto-resueltas',
    description: 'Conversaciones que el bot resolvió sin necesidad de intervención humana.',
    dataSource: 'Conversaciones con status "booked" o "closed".',
    formula: 'Conteo de conversaciones auto-resueltas',
    unit: 'count',
    icon: Bot,
    colorClass: 'text-green-600',
    bgClass: 'bg-green-500/10',
  },

  // ==================== CobranzasPage ====================
  pending_payments: {
    id: 'pending_payments',
    name: 'Por Vencer',
    description: 'Clientes cuyo próximo cobro está cerca (dentro de los próximos 7 días).',
    dataSource: 'Tabla workshop_billing, filtrando por fecha de próximo cobro.',
    formula: 'Clientes con next_billing_date en los próximos 7 días',
    unit: 'count',
    icon: Clock,
    colorClass: 'text-yellow-600',
    bgClass: 'bg-yellow-500/10',
  },

  overdue_payments: {
    id: 'overdue_payments',
    name: 'Vencidos',
    description: 'Clientes cuyo cobro ya venció y no han pagado.',
    dataSource: 'Tabla workshop_billing, filtrando por fecha de cobro pasada sin pago registrado.',
    formula: 'Clientes con next_billing_date < hoy y sin pago reciente',
    unit: 'count',
    icon: AlertTriangle,
    colorClass: 'text-red-600',
    bgClass: 'bg-red-500/10',
  },
};

export function getMetricDefinition(metricId: string): MetricDefinition | undefined {
  return metricDefinitions[metricId];
}
