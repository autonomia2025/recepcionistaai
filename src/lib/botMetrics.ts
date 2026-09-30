// Plain-language explanations of the bot metrics already on the Dashboard
// (hours saved, conversations...), for the full explanation panel.
// Used for commercial workshops; the other workshops keep the old modal.
import { formatCLP } from '@/lib/quoteTotals';
import type { Explanation } from '@/lib/metrics';
import { MINUTES_SAVED_PER_CONVERSATION, VALUE_PER_HOUR_CLP } from '@/components/metrics/metricDefinitions';

const n = (v: number) => Math.round(v).toLocaleString('es-CL');
const base = { change: null, caption: null, tone: 'neutral' as const, counts: [] as string[], excludes: [] as string[], drivers: [] as string[], records: null, small: null };

export function botExplanation(metricId: string, value: number): Explanation | null {
  switch (metricId) {
    case 'hours_saved': {
      const conversations = Math.round((value * 60) / MINUTES_SAVED_PER_CONVERSATION);
      return {
        ...base, id: metricId, title: 'Horas ahorradas', value: value < 1 ? `${Math.round(value * 60)} min` : `${value.toFixed(1).replace('.', ',')} h`,
        caption: 'tiempo que el equipo no tuvo que responder WhatsApp',
        what: 'Una estimación del tiempo que el equipo se ahorra porque el bot atiende las conversaciones de WhatsApp (responde, recomienda equipos y envía fichas) en vez de que lo haga una persona.',
        steps: [
          { label: 'Conversaciones que atendió el bot (desde el inicio)', value: n(conversations) },
          { label: 'Minutos que tomaría a una persona cada una (estimado)', value: `${MINUTES_SAVED_PER_CONVERSATION} min` },
          { label: `${n(conversations)} × ${MINUTES_SAVED_PER_CONVERSATION} ÷ 60`, value: `${value.toFixed(1).replace('.', ',')} h` },
        ],
        result: `${value.toFixed(1).replace('.', ',')} horas ahorradas`,
        sources: [{ data: 'Conversaciones', where: 'Inbox: cada cliente que escribe por WhatsApp abre una conversación' }],
        counts: ['Todas las conversaciones desde que el bot está activo.'],
        excludes: ['El tiempo real que tardó cada conversación: se usa un promedio fijo de 8 minutos.'],
        drivers: ['Más clientes escribiendo por WhatsApp'],
      };
    }
    case 'value_generated': {
      const hours = value / VALUE_PER_HOUR_CLP;
      return {
        ...base, id: metricId, title: 'Valor del tiempo ahorrado', value: formatCLP(value),
        caption: 'horas ahorradas × costo de una hora de trabajo',
        what: 'Cuánto costaría pagarle a una persona por el tiempo que el bot le ahorró al equipo. Es un ahorro, no ventas: las ventas del bot están arriba, en "Resultados comerciales".',
        steps: [
          { label: 'Horas ahorradas', value: `${hours.toFixed(1).replace('.', ',')} h` },
          { label: 'Costo estimado de una hora de trabajo', value: formatCLP(VALUE_PER_HOUR_CLP) },
        ],
        result: `${hours.toFixed(1).replace('.', ',')} h × ${formatCLP(VALUE_PER_HOUR_CLP)} = ${formatCLP(value)}`,
        sources: [{ data: 'Horas ahorradas', where: 'Conversaciones del bot × 8 minutos' }],
        counts: ['Todo el tiempo desde que el bot está activo.'],
        excludes: ['Ventas (están en la North Star y el ROI).'],
      };
    }
    case 'conversations':
      return {
        ...base, id: metricId, title: 'Conversaciones', value: n(value), caption: 'clientes que escribieron por WhatsApp',
        what: 'Cada vez que un cliente escribe por WhatsApp se abre una conversación. Es el volumen de clientes que atendió el bot.',
        steps: [{ label: 'Conversaciones registradas (desde el inicio)', value: n(value) }], result: `${n(value)} conversaciones`,
        sources: [{ data: 'Conversaciones', where: 'Inbox' }], counts: ['Una por cliente y canal.'], excludes: ['Mensajes sueltos: se cuentan conversaciones, no mensajes.'],
      };
    case 'clients':
      return {
        ...base, id: metricId, title: 'Clientes', value: n(value), caption: 'contactos registrados',
        what: 'Personas o empresas que alguna vez escribieron. Se crean solas cuando alguien escribe por primera vez.',
        steps: [{ label: 'Contactos registrados', value: n(value) }], result: `${n(value)} clientes`,
        sources: [{ data: 'Contactos', where: 'Clientes (se crean solos al primer mensaje)' }], counts: ['Contactos únicos.'], excludes: [],
      };
    case 'closed_clients':
      return {
        ...base, id: metricId, title: 'Clientes cerrados', value: n(value), caption: 'marcados como cerrados en Clientes',
        what: 'Clientes que alguien del equipo marcó como cerrados en la ficha del cliente. No es lo mismo que una venta: las ventas del bot están en "Resultados comerciales".',
        steps: [{ label: 'Clientes con fecha de cierre', value: n(value) }], result: `${n(value)} clientes cerrados`,
        sources: [{ data: 'Cierre de cliente', where: 'Ficha del cliente (Clientes)' }], counts: [], excludes: ['Ventas registradas en cotizaciones (ver North Star).'],
      };
    case 'bot_messages':
    case 'messages_received':
      return {
        ...base, id: metricId, title: metricId === 'bot_messages' ? 'Mensajes del bot' : 'Mensajes recibidos', value: n(value),
        caption: metricId === 'bot_messages' ? 'respuestas enviadas por el bot' : 'mensajes que escribieron los clientes',
        what: metricId === 'bot_messages' ? 'Cuántos mensajes envió el bot a los clientes por WhatsApp.' : 'Cuántos mensajes escribieron los clientes por WhatsApp.',
        steps: [{ label: 'Mensajes (desde el inicio)', value: n(value) }], result: n(value),
        sources: [{ data: 'Mensajes', where: 'Inbox, dentro de cada conversación' }], counts: [], excludes: [],
      };
    default:
      return null;
  }
}
