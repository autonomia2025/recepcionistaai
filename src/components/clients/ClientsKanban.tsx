import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Phone, Clock, MoreHorizontal, CircleCheckBig, Trash2, Undo2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface Contact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  lead_score: number;
  detected_intent: string | null;
  intent_confidence: number | null;
  should_recontact: boolean;
  did_schedule: boolean | null;
  closed_at: string | null;
  created_at: string;
  last_contact_at?: string | null;
  tags: string[] | null;
  notes: string | null;
  // service request fields
  service_requests_count?: number;
}

interface PipelineStage {
  id: string;
  label: string;
  emoji: string;
  borderColor: string;
  headerBg: string;
  headerText: string;
  dotColor: string;
}

const STAGES: PipelineStage[] = [
  {
    id: 'nuevo',
    label: 'Nuevo',
    emoji: '💤',
    borderColor: 'border-slate-200',
    headerBg: 'bg-slate-50',
    headerText: 'text-slate-700',
    dotColor: 'bg-slate-400',
  },
  {
    id: 'interesado',
    label: 'Interesado',
    emoji: '⚡',
    borderColor: 'border-amber-200',
    headerBg: 'bg-amber-50',
    headerText: 'text-amber-700',
    dotColor: 'bg-amber-400',
  },
  {
    id: 'caliente',
    label: 'Caliente',
    emoji: '🔥',
    borderColor: 'border-orange-200',
    headerBg: 'bg-orange-50',
    headerText: 'text-orange-700',
    dotColor: 'bg-orange-500',
  },
  {
    id: 'cotizacion',
    label: 'Cotización',
    emoji: '💰',
    borderColor: 'border-blue-200',
    headerBg: 'bg-blue-50',
    headerText: 'text-blue-700',
    dotColor: 'bg-blue-500',
  },
  {
    id: 'cerrado',
    label: 'Cerrado',
    emoji: '✅',
    borderColor: 'border-emerald-200',
    headerBg: 'bg-emerald-50',
    headerText: 'text-emerald-700',
    dotColor: 'bg-emerald-500',
  },
];

function classifyContact(contact: Contact): string {
  if (contact.closed_at) return 'cerrado';
  if (contact.detected_intent === 'cotizacion' || (contact.service_requests_count && contact.service_requests_count > 0)) return 'cotizacion';
  if (contact.lead_score >= 80) return 'caliente';
  if (contact.lead_score >= 50 || contact.detected_intent) return 'interesado';
  return 'nuevo';
}

function formatLastContact(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: es });
  } catch {
    return null;
  }
}

interface ClientsKanbanProps {
  contacts: Contact[];
  onSelectContact: (contact: Contact) => void;
  onCloseContact: (contactId: string) => void;
  onReopenContact: (contactId: string) => void;
  onDeleteContact: (contactId: string) => void;
}

export function ClientsKanban({
  contacts,
  onSelectContact,
  onCloseContact,
  onReopenContact,
  onDeleteContact,
}: ClientsKanbanProps) {
  const grouped = useMemo(() => {
    const groups: Record<string, Contact[]> = {};
    STAGES.forEach(s => { groups[s.id] = []; });
    contacts.forEach(c => {
      const stage = classifyContact(c);
      groups[stage].push(c);
    });
    return groups;
  }, [contacts]);

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 -mx-2 px-2">
      {STAGES.map(stage => (
        <div
          key={stage.id}
          className={cn(
            'flex-shrink-0 w-[260px] lg:w-auto lg:flex-1 rounded-xl border bg-card',
            stage.borderColor
          )}
        >
          {/* Column Header */}
          <div className={cn('px-4 py-3 rounded-t-xl flex items-center justify-between', stage.headerBg)}>
            <div className="flex items-center gap-2">
              <div className={cn('w-2.5 h-2.5 rounded-full', stage.dotColor)} />
              <span className={cn('text-sm font-semibold', stage.headerText)}>
                {stage.emoji} {stage.label}
              </span>
            </div>
            <span className={cn(
              'text-xs font-bold px-2 py-0.5 rounded-full',
              stage.headerBg, stage.headerText,
              'border', stage.borderColor
            )}>
              {grouped[stage.id].length}
            </span>
          </div>

          {/* Cards */}
          <ScrollArea className="h-[calc(100vh-360px)] min-h-[300px]">
            <div className="p-2 space-y-2">
              {grouped[stage.id].length === 0 ? (
                <div className="text-center py-8 text-muted-foreground/50 text-xs">
                  Sin clientes
                </div>
              ) : (
                grouped[stage.id].map(contact => {
                  const lastContact = formatLastContact(contact.last_contact_at);
                  return (
                    <Card
                      key={contact.id}
                      className={cn(
                        'p-3 cursor-pointer hover:shadow-md transition-shadow border-l-[3px]',
                        stage.id === 'cerrado' ? 'border-l-emerald-500' :
                        stage.id === 'cotizacion' ? 'border-l-blue-500' :
                        stage.id === 'caliente' ? 'border-l-orange-500' :
                        stage.id === 'interesado' ? 'border-l-amber-400' :
                        'border-l-slate-300'
                      )}
                      onClick={() => onSelectContact(contact)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">{contact.name}</p>
                          {contact.phone && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                              <Phone className="w-3 h-3" />
                              {contact.phone}
                            </p>
                          )}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0">
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            {contact.closed_at ? (
                              <DropdownMenuItem onClick={e => { e.stopPropagation(); onReopenContact(contact.id); }}>
                                <Undo2 className="w-4 h-4 mr-2" /> Reabrir
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                className="text-emerald-600 focus:text-emerald-600"
                                onClick={e => { e.stopPropagation(); onCloseContact(contact.id); }}
                              >
                                <CircleCheckBig className="w-4 h-4 mr-2" /> Cerrar
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={e => { e.stopPropagation(); onDeleteContact(contact.id); }}
                            >
                              <Trash2 className="w-4 h-4 mr-2" /> Eliminar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {/* Bottom info */}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded-full font-medium border',
                          contact.lead_score >= 80 ? 'bg-orange-50 text-orange-700 border-orange-200/50' :
                          contact.lead_score >= 50 ? 'bg-amber-50 text-amber-700 border-amber-200/50' :
                          'bg-gray-50 text-gray-600 border-gray-200/50'
                        )}>
                          Score: {contact.lead_score}
                        </span>
                        {contact.detected_intent && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                            {contact.detected_intent}
                          </span>
                        )}
                      </div>
                      {lastContact && (
                        <p className="text-[10px] text-muted-foreground/60 mt-1.5 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {lastContact}
                        </p>
                      )}
                    </Card>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>
      ))}
    </div>
  );
}
