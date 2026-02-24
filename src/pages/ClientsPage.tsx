import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkshopMode } from '@/hooks/useWorkshopMode';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ClientDetailDialog } from '@/components/clients/ClientDetailDialog';
import { useToast } from '@/hooks/use-toast';
import { Plus, Users, Search, Phone, Target, Clock, Filter, CalendarCheck, CheckCircle2, XCircle, MoreHorizontal, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
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
  recontact_at: string | null;
  recontact_reason: string | null;
  created_at: string;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  did_schedule: boolean | null;
  schedule_confidence: number | null;
  lead_score_reasoning: string | null;
  notes: string | null;
  tags: string[] | null;
  last_analyzed_at: string | null;
  // Aggregated data
  service_requests_count?: number;
  total_estimated_value?: number;
  last_comuna?: string | null;
}

function getLeadScoreInfo(score: number) {
  if (score >= 80) return { emoji: '🔥', label: 'Caliente', className: 'bg-orange-50 text-orange-700 border-orange-200/50' };
  if (score >= 50) return { emoji: '⚡', label: 'Tibio', className: 'bg-amber-50 text-amber-700 border-amber-200/50' };
  return { emoji: '💤', label: 'Frío', className: 'bg-gray-50 text-gray-600 border-gray-200/50' };
}

function getIntentLabel(intent: string | null) {
  const labels: Record<string, { label: string; emoji: string }> = {
    agendar_cita: { label: 'Agendar', emoji: '🎯' },
    cotizacion: { label: 'Cotización', emoji: '💰' },
    consulta: { label: 'Consulta', emoji: '💬' },
    reclamo: { label: 'Reclamo', emoji: '⚠️' },
    seguimiento: { label: 'Seguimiento', emoji: '🔄' },
    compra: { label: 'Compra', emoji: '🛒' },
    soporte: { label: 'Soporte', emoji: '🛠️' },
    otro: { label: 'Otro', emoji: '📝' },
  };
  return intent ? labels[intent] || { label: intent, emoji: '📝' } : null;
}

function TableSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="w-10 h-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export default function ClientsPage() {
  const { profile } = useAuth();
  const { data: workshopMode } = useWorkshopMode();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [scoreFilter, setScoreFilter] = useState<string>('all');
  const [intentFilter, setIntentFilter] = useState<string>('all');
  const [recontactFilter, setRecontactFilter] = useState<string>('all');
  const [scheduleFilter, setScheduleFilter] = useState<string>('all');
  const [deleteContactId, setDeleteContactId] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  const isAdmin = profile?.role === 'ADMIN' || profile?.role === 'SUPERADMIN';
  const isChatbotOnly = workshopMode?.booking_mode === 'chatbot_only';

  const { data: contacts, isLoading } = useQuery({
    queryKey: ['clients', profile?.workshop_id, profile?.id, isAdmin, isChatbotOnly],
    queryFn: async () => {
      if (!profile?.workshop_id) return [];
      
      // Get contacts
      const { data: allContacts, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('workshop_id', profile.workshop_id)
        .eq('archived', false)
        .order('lead_score', { ascending: false });
      
      if (error) throw error;

      let filteredContacts = allContacts as Contact[];

      // If staff, filter to only contacts that have appointments assigned to them
      if (!isAdmin && profile?.id) {
        const { data: appointments } = await supabase
          .from('appointments')
          .select('contact_id')
          .eq('workshop_id', profile.workshop_id)
          .eq('assigned_to_user_id', profile.id);

        const assignedContactIds = new Set(appointments?.map(a => a.contact_id) || []);
        filteredContacts = filteredContacts.filter(c => assignedContactIds.has(c.id));
      }

      // For chatbot_only mode, fetch service request aggregates
      if (isChatbotOnly) {
        const contactIds = filteredContacts.map(c => c.id);
        if (contactIds.length > 0) {
          const { data: serviceRequests } = await supabase
            .from('service_requests')
            .select('contact_id, estimated_value, comuna')
            .in('contact_id', contactIds);

          const aggregates: Record<string, { count: number; total: number; comuna: string | null }> = {};
          serviceRequests?.forEach(sr => {
            if (!aggregates[sr.contact_id]) {
              aggregates[sr.contact_id] = { count: 0, total: 0, comuna: null };
            }
            aggregates[sr.contact_id].count += 1;
            aggregates[sr.contact_id].total += sr.estimated_value || 0;
            if (sr.comuna) aggregates[sr.contact_id].comuna = sr.comuna;
          });

          filteredContacts = filteredContacts.map(c => ({
            ...c,
            service_requests_count: aggregates[c.id]?.count || 0,
            total_estimated_value: aggregates[c.id]?.total || 0,
            last_comuna: aggregates[c.id]?.comuna || null,
          }));
        }
      }

      return filteredContacts;
    },
    enabled: !!profile?.workshop_id,
  });

  // Archive contact mutation (soft-delete)
  const deleteContactMutation = useMutation({
    mutationFn: async (contactId: string) => {
      const { error } = await supabase
        .from('contacts')
        .update({ archived: true })
        .eq('id', contactId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast({ title: 'Cliente archivado correctamente' });
      setDeleteContactId(null);
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Filter contacts
  const filteredContacts = contacts?.filter((contact) => {
    const matchesSearch = 
      contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      contact.phone?.includes(searchQuery) ||
      contact.email?.toLowerCase().includes(searchQuery.toLowerCase());
    
    let matchesScore = true;
    if (scoreFilter === 'hot') matchesScore = contact.lead_score >= 80;
    else if (scoreFilter === 'warm') matchesScore = contact.lead_score >= 50 && contact.lead_score < 80;
    else if (scoreFilter === 'cold') matchesScore = contact.lead_score < 50;
    
    const matchesIntent = intentFilter === 'all' || contact.detected_intent === intentFilter;
    
    let matchesRecontact = true;
    if (recontactFilter === 'pending') matchesRecontact = contact.should_recontact;
    else if (recontactFilter === 'none') matchesRecontact = !contact.should_recontact;
    
    let matchesSchedule = true;
    if (!isChatbotOnly) {
      if (scheduleFilter === 'scheduled') matchesSchedule = contact.did_schedule === true;
      else if (scheduleFilter === 'not_scheduled') matchesSchedule = contact.did_schedule === false || contact.did_schedule === null;
    }
    
    return matchesSearch && matchesScore && matchesIntent && matchesRecontact && matchesSchedule;
  });

  const stats = {
    total: contacts?.length || 0,
    hot: contacts?.filter(c => c.lead_score >= 80).length || 0,
    warm: contacts?.filter(c => c.lead_score >= 50 && c.lead_score < 80).length || 0,
    cold: contacts?.filter(c => c.lead_score < 50).length || 0,
    pendingRecontact: contacts?.filter(c => c.should_recontact).length || 0,
    scheduled: contacts?.filter(c => c.did_schedule === true).length || 0,
  };

  return (
    <div className="page-shell page-stack animate-in">
      <PageHeader 
        title="Clientes" 
        description="Gestiona tu base de clientes y leads"
      />

      {/* Stats Cards */}
      <div className="page-panel">
        <div className="section-header">
          <h2 className="section-title">Resumen</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
          <Card className="card-premium">
            <CardContent className="p-3 md:p-4 flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary/10">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
            </CardContent>
          </Card>
          
          <Card className="card-premium border-orange-200/50">
            <CardContent className="p-3 md:p-4 flex items-center gap-3">
              <div className="p-2 rounded-xl bg-orange-50">
                <span className="text-xl">🔥</span>
              </div>
              <div>
                <p className="text-2xl font-bold text-orange-600">{stats.hot}</p>
                <p className="text-xs text-muted-foreground">Calientes</p>
              </div>
            </CardContent>
          </Card>
          
          <Card className="card-premium border-amber-200/50">
            <CardContent className="p-3 md:p-4 flex items-center gap-3">
              <div className="p-2 rounded-xl bg-amber-50">
                <span className="text-xl">⚡</span>
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-600">{stats.warm}</p>
                <p className="text-xs text-muted-foreground">Tibios</p>
              </div>
            </CardContent>
          </Card>
          
          <Card className="card-premium">
            <CardContent className="p-3 md:p-4 flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gray-100">
                <span className="text-xl">💤</span>
              </div>
              <div>
                <p className="text-2xl font-bold text-muted-foreground">{stats.cold}</p>
                <p className="text-xs text-muted-foreground">Fríos</p>
              </div>
            </CardContent>
          </Card>
          
          <Card className="card-premium border-amber-200/50">
            <CardContent className="p-3 md:p-4 flex items-center gap-3">
              <div className="p-2 rounded-xl bg-amber-50">
                <Clock className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-600">{stats.pendingRecontact}</p>
                <p className="text-xs text-muted-foreground">Recontacto</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Filters */}
      <div className="page-panel">
        <div className="section-header">
          <h2 className="section-title">Filtros</h2>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 md:gap-3">
        <div className="relative w-full sm:flex-1 sm:min-w-[180px] sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
          <Input
            placeholder="Buscar cliente..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-background border-border/60"
          />
        </div>
        
        <Select value={scoreFilter} onValueChange={setScoreFilter}>
          <SelectTrigger className="w-full sm:w-[130px] bg-background border-border/60">
            <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Score" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="hot">🔥 Calientes</SelectItem>
            <SelectItem value="warm">⚡ Tibios</SelectItem>
            <SelectItem value="cold">💤 Fríos</SelectItem>
          </SelectContent>
        </Select>

        <Select value={intentFilter} onValueChange={setIntentFilter}>
          <SelectTrigger className="w-full sm:w-[140px] bg-background border-border/60">
            <Target className="w-4 h-4 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Intención" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="cotizacion">💰 Cotización</SelectItem>
            <SelectItem value="consulta">💬 Consulta</SelectItem>
            <SelectItem value="agendar_cita">🎯 Agendar</SelectItem>
            <SelectItem value="compra">🛒 Compra</SelectItem>
            <SelectItem value="soporte">🛠️ Soporte</SelectItem>
            <SelectItem value="reclamo">⚠️ Reclamo</SelectItem>
          </SelectContent>
        </Select>

        {!isChatbotOnly && (
          <Select value={scheduleFilter} onValueChange={setScheduleFilter}>
            <SelectTrigger className="w-full sm:w-[140px] bg-background border-border/60">
              <CalendarCheck className="w-4 h-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Agendamiento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="scheduled">✅ Agendaron</SelectItem>
              <SelectItem value="not_scheduled">❌ Sin agendar</SelectItem>
            </SelectContent>
          </Select>
        )}

        <Select value={recontactFilter} onValueChange={setRecontactFilter}>
          <SelectTrigger className="w-full sm:w-[140px] bg-background border-border/60">
            <Clock className="w-4 h-4 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Recontacto" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pending">⏰ Pendientes</SelectItem>
            <SelectItem value="none">Sin recontacto</SelectItem>
          </SelectContent>
        </Select>
        </div>
      </div>

      {/* Table */}
      <Card className="card-premium overflow-hidden">
        <CardHeader className="py-4 px-4 md:px-6 border-b border-border/50">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {filteredContacts?.length || 0} cliente{(filteredContacts?.length || 0) !== 1 ? 's' : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <TableSkeleton />
          ) : filteredContacts?.length === 0 ? (
            <div className="empty-state py-16">
              <Users className="empty-state-icon" />
              <h3 className="empty-state-title">Sin clientes</h3>
              <p className="empty-state-description">
                No hay clientes que coincidan con los filtros aplicados
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="table-premium">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4 md:pl-6">Cliente</TableHead>
                    <TableHead className="hidden sm:table-cell">Teléfono</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead className="hidden md:table-cell">Intención</TableHead>
                    {!isChatbotOnly && (
                      <TableHead className="hidden lg:table-cell">Agendó</TableHead>
                    )}
                    <TableHead className="hidden md:table-cell">Recontacto</TableHead>
                    <TableHead className="hidden lg:table-cell">Fecha</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredContacts?.map((contact) => {
                    const scoreInfo = getLeadScoreInfo(contact.lead_score);
                    const intentInfo = getIntentLabel(contact.detected_intent);
                    
                    return (
                      <TableRow 
                        key={contact.id} 
                        className="cursor-pointer"
                        onClick={() => setSelectedContact(contact)}
                      >
                        <TableCell className="pl-4 md:pl-6">
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              'w-9 h-9 rounded-full flex items-center justify-center text-base',
                              contact.lead_score >= 80 ? 'bg-orange-50' : 
                              contact.lead_score >= 50 ? 'bg-amber-50' : 'bg-gray-100'
                            )}>
                              {scoreInfo.emoji}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{contact.name}</p>
                              {contact.email && (
                                <p className="text-xs text-muted-foreground truncate hidden md:block">
                                  {contact.email}
                                </p>
                              )}
                              <p className="text-xs text-muted-foreground sm:hidden">
                                {contact.phone || '-'}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Phone className="w-3.5 h-3.5" />
                            <span className="text-sm">{contact.phone || '-'}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
                            scoreInfo.className
                          )}>
                            {contact.lead_score}
                          </span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {intentInfo ? (
                            <span className="text-sm text-muted-foreground">
                              {intentInfo.emoji} {intentInfo.label}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50">-</span>
                          )}
                        </TableCell>
                        
                        {!isChatbotOnly && (
                          <TableCell className="hidden lg:table-cell">
                            {contact.did_schedule === true ? (
                              <div className="flex items-center gap-1.5 text-emerald-600">
                                <CheckCircle2 className="w-4 h-4" />
                                <span className="text-sm">Sí</span>
                              </div>
                            ) : contact.did_schedule === false ? (
                              <div className="flex items-center gap-1.5 text-muted-foreground">
                                <XCircle className="w-4 h-4" />
                                <span className="text-sm">No</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground/50">-</span>
                            )}
                          </TableCell>
                        )}
                        
                        <TableCell className="hidden md:table-cell">
                          {contact.should_recontact ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200/50">
                                ⏰ {contact.recontact_at 
                                  ? (() => {
                                      try {
                                        const dateStr = contact.recontact_at;
                                        const date = dateStr.includes('T') 
                                          ? new Date(dateStr) 
                                          : new Date(dateStr + 'T12:00:00');
                                        return format(date, 'dd MMM', { locale: es });
                                      } catch {
                                        return 'Pend.';
                                      }
                                    })()
                                  : 'Pend.'}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground/50">-</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                          {format(new Date(contact.created_at), 'dd MMM yy', { locale: es })}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteContactId(contact.id);
                                }}
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Eliminar
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Client Detail Dialog */}
      <ClientDetailDialog 
        contact={selectedContact}
        open={!!selectedContact}
        onOpenChange={(open) => !open && setSelectedContact(null)}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteContactId} onOpenChange={() => setDeleteContactId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Archivar cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              El cliente será archivado y dejará de aparecer en la lista. Sus conversaciones y datos se conservarán.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteContactId && deleteContactMutation.mutate(deleteContactId)}
            >
              Archivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
