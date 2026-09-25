import { useQuery } from '@tanstack/react-query';
import { FileText, MessageSquareQuote, Receipt } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type Reason =
  | { rule: 'quote_requested'; evidence?: string }
  | { rule: 'billing_data'; company_name?: string | null; tax_id?: string | null }
  | { rule: string };

const EQUIPMENT_ORDER = ['chosen', 'customer_asked', 'datasheet_sent', 'recommended'] as const;

function equipmentNote(types: Set<string>): string {
  const parts: string[] = [];
  if (types.has('chosen')) parts.push('la eligió');
  else if (types.has('customer_asked')) parts.push('la preguntó');
  if (types.has('datasheet_sent')) parts.push('recibió la ficha');
  if (parts.length === 0) return 'Se la recomendamos';
  const text = parts.join(' y ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// "Why is this lead here", for requests the bot created. Written for the seller
// in plain language; equipment is read live from what the bot recorded.
export function LeadReasonCard({ contactId, workshopId, qualification }: {
  contactId: string;
  workshopId: string;
  qualification: unknown;
}) {
  const reasons = ((qualification as { reasons?: Reason[] } | null)?.reasons ?? []) as Reason[];
  const quote = reasons.find((r): r is { rule: 'quote_requested'; evidence?: string } => r.rule === 'quote_requested');
  const billing = reasons.find((r): r is { rule: 'billing_data'; company_name?: string | null; tax_id?: string | null } => r.rule === 'billing_data');

  const { data: equipment } = useQuery({
    queryKey: ['lead-equipment', contactId],
    queryFn: async () => {
      const { data: events } = await supabase
        .from('conversation_product_events')
        .select('event_type, sku_normalized, created_at')
        .eq('contact_id', contactId)
        .not('sku_normalized', 'is', null)
        .order('created_at');
      const bySku = new Map<string, Set<string>>();
      for (const e of events || []) {
        const sku = e.sku_normalized as string;
        if (!bySku.has(sku)) bySku.set(sku, new Set());
        bySku.get(sku)!.add(e.event_type);
      }
      if (bySku.size === 0) return [];
      const { data: catalog } = await supabase
        .from('product_catalog')
        .select('sku, sku_normalized')
        .eq('workshop_id', workshopId)
        .in('sku_normalized', [...bySku.keys()]);
      const labels = new Map((catalog || []).map(r => [r.sku_normalized, r.sku]));
      const rank = (types: Set<string>) => EQUIPMENT_ORDER.findIndex(type => types.has(type));
      return [...bySku.entries()]
        .map(([sku, types]) => ({ sku, label: labels.get(sku) ?? sku, types }))
        .sort((a, b) => rank(a.types) - rank(b.types));
    },
  });

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <p className="text-sm font-medium">Por qué llegó a Solicitudes</p>

      {quote && (
        <div className="flex gap-3">
          <MessageSquareQuote className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
          <div className="text-sm space-y-1">
            <p>Pidió una cotización por WhatsApp:</p>
            {quote.evidence && (
              <blockquote className="border-l-2 border-primary/40 pl-3 text-muted-foreground italic">“{quote.evidence}”</blockquote>
            )}
          </div>
        </div>
      )}

      {billing && (
        <div className="flex gap-3">
          <Receipt className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
          <p className="text-sm">
            Dejó sus datos para facturar:{' '}
            <span className="font-medium">{[billing.company_name, billing.tax_id ? `RUT ${billing.tax_id}` : null].filter(Boolean).join(' · ')}</span>
          </p>
        </div>
      )}

      {equipment && equipment.length > 0 && (
        <div className="flex gap-3">
          <FileText className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
          <div className="text-sm space-y-1.5">
            <p>Equipos que le interesan:</p>
            <ul className="space-y-1">
              {equipment.map(item => (
                <li key={item.sku} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{item.label}</span>
                  <span className="text-xs text-muted-foreground">{equipmentNote(item.types)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
