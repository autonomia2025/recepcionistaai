import { useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { ArrowLeft, Building2, ExternalLink, Flame, Mail, MapPin, PenSquare, Phone, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CallGuideCard } from '@/components/requests/CallGuideCard';
import { LeadReasonCard } from '@/components/requests/LeadReasonCard';
import { RequestDetailDialog } from '@/components/requests/RequestDetailDialog';
import { RequestQuotesSection } from '@/components/quotes/RequestQuotesSection';
import { ClientEmailThread } from '@/components/email/ClientEmailThread';
import { SendClientEmailDialog, type SendTarget } from '@/components/email/SendClientEmailDialog';
import type { ServiceRequest } from '@/hooks/useServiceRequests';
import { formatCLP } from '@/lib/quoteTotals';
import { type LeadRow, type LeadStage, type PriorityView, leadAmount } from '@/lib/leads';
import { cn } from '@/lib/utils';
import { STAGE_STYLE } from './stageStyle';

// Everything about one lead on one screen: why it arrived, the call guide,
// the quotes and the emails with the client.
export function LeadDetail({ lead, stage, priority, request, requestLoading = false, onBack }: {
  lead: LeadRow;
  stage: LeadStage;
  priority?: PriorityView;
  request: ServiceRequest | null;
  requestLoading?: boolean;
  onBack?: () => void;
}) {
  const [showFull, setShowFull] = useState(false);
  const [compose, setCompose] = useState<SendTarget | null>(null);
  const amount = leadAmount(lead);
  const title = lead.company || lead.client;

  const writeEmail = () => setCompose({
    kind: 'message', contactId: lead.contact_id, requestId: lead.id,
    workshopId: request?.workshop_id ?? '', to: lead.client_email, clientName: lead.client,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        {onBack && (
          <Button variant="ghost" size="sm" className="-ml-2 h-8 md:hidden" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Mis leads
          </Button>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold truncate">{title}</h2>
              <Badge variant="outline" className={cn('text-[11px]', STAGE_STYLE[stage.key].badge)}>{stage.label}</Badge>
              {stage.late && <Badge variant="outline" className="text-[11px] border-red-300 bg-red-50 text-red-700">Atrasado</Badge>}
              {priority?.urgent && stage.key !== 'won' && stage.key !== 'lost' && (
                <Badge variant="outline" className="text-[11px] border-orange-300 bg-orange-50 text-orange-700"><Flame className="w-3 h-3 mr-0.5" />Urgente</Badge>
              )}
            </div>
            <p className={cn('text-sm', stage.late ? 'text-destructive' : 'text-muted-foreground')}>{stage.note}</p>
            {priority?.attention && (
              <p className={cn('text-sm font-medium', priority.attention.overdue ? 'text-destructive' : 'text-orange-700')}>{priority.attention.text}</p>
            )}
            {(priority?.kind || priority?.why) && (
              <p className="text-sm"><span className="font-medium">{priority.kind}</span>{priority.why ? <span className="italic">{priority.kind ? ': ' : ''}{priority.why}</span> : null}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={writeEmail} disabled={!request}>
              <PenSquare className="w-4 h-4 mr-1" /> Escribir correo
            </Button>
            <Button variant="ghost" onClick={() => setShowFull(true)} disabled={!request}>
              <ExternalLink className="w-4 h-4 mr-1" /> Ficha completa
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
          {lead.company && <span className="flex items-center gap-1.5"><Building2 className="w-4 h-4" />{lead.client}</span>}
          {lead.client_phone && <span className="flex items-center gap-1.5"><Phone className="w-4 h-4" />{lead.client_phone}</span>}
          {lead.client_email && <span className="flex items-center gap-1.5"><Mail className="w-4 h-4" />{lead.client_email}</span>}
          {lead.zone_label && <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" />{lead.zone_label}</span>}
          {lead.staff_name && <span className="flex items-center gap-1.5"><UserRound className="w-4 h-4" />{lead.staff_name}</span>}
          <span>Llegó el {format(new Date(lead.created_at), "d 'de' MMMM, HH:mm", { locale: es })}</span>
          {amount && <span className="text-foreground">{amount.estimate ? '~' : ''}{formatCLP(amount.value)}{amount.estimate ? ' estimado' : ' neto'}</span>}
        </div>
      </div>

      {!request ? (
        <p className="text-sm text-muted-foreground">{requestLoading ? 'Cargando la ficha…' : 'No se encontró la ficha de esta solicitud.'}</p>
      ) : (
        <>
          {/* The conversation with the client, first when they wrote */}
          <ClientEmailThread
            contactId={lead.contact_id}
            emptyText="Aún no hay correos con este cliente. Envía la cotización o escríbele para seguir la conversación por correo."
          />

          <section className="space-y-3">
            {request.auto_created && request.qualification ? (
              <LeadReasonCard contactId={request.contact_id} workshopId={request.workshop_id} qualification={request.qualification} />
            ) : request.description ? (
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">Qué pidió</h4>
                <p className="text-sm whitespace-pre-line">{request.description}</p>
              </div>
            ) : null}
          </section>

          <CallGuideCard requestId={request.id} conversationId={request.conversation_id} />

          <RequestQuotesSection requestId={request.id} />
        </>
      )}

      {request && <RequestDetailDialog request={request} open={showFull} onOpenChange={setShowFull} />}
      <SendClientEmailDialog target={compose} open={!!compose} onOpenChange={open => !open && setCompose(null)} />
    </div>
  );
}
