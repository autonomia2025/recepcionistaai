import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { ArrowLeft, Hand, Loader2, Mail, MapPin, MessageSquare, Phone, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTakeInterested } from '@/hooks/useCommercialFacts';
import { type InterestedRow, agoPhrase, interestLabel } from '@/lib/leads';

// One interested client: what they asked, what they looked at, and "Tomar".
export function InterestedDetail({ row, onBack, onTaken }: {
  row: InterestedRow;
  onBack?: () => void;
  onTaken: (requestId: string) => void;
}) {
  const navigate = useNavigate();
  const take = useTakeInterested();

  const handleTake = async () => {
    try {
      const id = await take.mutateAsync(row.contact_id);
      toast.success('Ahora es tu lead', { description: 'Quedó en Mis leads, asignado a ti.' });
      onTaken(id);
    } catch (err) {
      toast.error('No se pudo tomar', { description: err instanceof Error ? err.message : undefined });
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {onBack && (
          <Button variant="ghost" size="sm" className="-ml-2 h-8 md:hidden" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Interesados
          </Button>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold truncate">{row.company || row.client}</h2>
              <Badge variant="outline" className="text-[11px] border-violet-300 bg-violet-50 text-violet-800">{interestLabel(row)}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">Escribió por última vez {agoPhrase(row.last_inbound_at)}. Todavía no pide cotización.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleTake} disabled={take.isPending}>
              {take.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Hand className="w-4 h-4 mr-1" />}
              Tomar como mi lead
            </Button>
            <Button variant="ghost" onClick={() => navigate('/inbox')}>
              <MessageSquare className="w-4 h-4 mr-1" /> Ir al Inbox
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
          {row.company && <span>{row.client}</span>}
          {row.phone && <span className="flex items-center gap-1.5"><Phone className="w-4 h-4" />{row.phone}</span>}
          {row.email && <span className="flex items-center gap-1.5"><Mail className="w-4 h-4" />{row.email}</span>}
          {row.zone_label && <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" />{row.zone_label}</span>}
        </div>
      </div>

      {row.last_inbound_text && (
        <section className="space-y-1.5">
          <h4 className="text-sm font-semibold">Lo último que escribió</h4>
          <blockquote className="border-l-2 pl-3 text-sm italic">"{row.last_inbound_text}"</blockquote>
          <p className="text-xs text-muted-foreground">{format(new Date(row.last_inbound_at), "d 'de' MMMM, HH:mm", { locale: es })}</p>
        </section>
      )}

      {row.lead_score_reasoning && (
        <section className="space-y-1.5">
          <h4 className="text-sm font-semibold flex items-center gap-1.5"><Sparkles className="w-4 h-4" /> Lectura de la IA sobre la conversación</h4>
          <p className="text-sm">{row.lead_score_reasoning}</p>
          {row.lead_score != null && <p className="text-xs text-muted-foreground">Interés estimado: {row.lead_score} de 100.</p>}
        </section>
      )}

      {(row.products?.length ?? 0) > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-sm font-semibold">Equipos que conversó con el bot</h4>
          <div className="flex flex-wrap gap-1.5">
            {row.products!.map(p => <Badge key={p} variant="secondary" className="font-mono text-[11px]">{p}</Badge>)}
          </div>
        </section>
      )}

      <p className="text-xs text-muted-foreground rounded-lg border border-dashed p-3">
        Los interesados no entran a Solicitudes. Si ves oportunidad, tómalo: queda como tu lead y puedes cotizarle y escribirle desde el panel.
        Si el cliente pide cotizar por WhatsApp, pasa solo a Mis leads como urgente.
      </p>
    </div>
  );
}
