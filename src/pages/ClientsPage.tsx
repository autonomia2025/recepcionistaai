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
import { Plus, Users, Search, Phone, Target, Clock, Filter, CalendarCheck, CheckCircle2, XCircle, MoreHorizontal, Trash2, MessageSquare, CircleCheckBig, Undo2, LayoutGrid, List } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
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
  closed_at: string | null;
  // Aggregated data
  service_requests_count?: number;
  total_estimated_value?: number;
  last_comuna?: string | null;
  last_contact_at?: string | null;
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

function formatLastContact(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: es });
  } catch {
    return null;
  }
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
  const [lastContactFilter, setLastContactFilter] = useState<string>('all');
  const [closeContactId, setCloseContactId] = useState<string | null>(null);
  const [closeStep, setCloseStep] = useState<1 | 2>(1);
  const [viewMode, setViewMode] = useState<'table' | 'pipeline'>('table');

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

      // Fetch last_message_at from conversations for each contact
      const contactIds = filteredContacts.map(c => c.id);
      if (contactIds.length > 0) {
        const { data: conversations } = await supabase
          .from('conversations')
          .select('contact_id, last_message_at')
          .eq('workshop_id', profile.workshop_id)
          .in('contact_id', contactIds);

        // Group by contact_id, take the max last_message_at
        const lastContactMap: Record<string, string> = {};
        conversations?.forEach(conv => {
          if (conv.last_message_at) {
            if (!lastContactMap[conv.contact_id] || conv.last_message_at > lastContactMap[conv.contact_id]) {
              lastContactMap[conv.contact_id] = conv.last_message_at;
            }
          }
        });

        filteredContacts = filteredContacts.map(c => ({
          ...c,
          last_contact_at: lastContactMap[c.id] || null,
        }));
      }

      // For chatbot_only mode, fetch service request aggregates
      if (isChatbotOnly) {
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

      // Sort by last_contact_at DESC (most recent first), then by created_at DESC
      filteredContacts.sort((a, b) => {
        const aDate = a.last_contact_at || '';
        const bDate = b.last_contact_at || '';
        if (bDate && !aDate) return 1;
        if (aDate && !bDate) return -1;
        if (aDate && bDate) return bDate.localeCompare(aDate);
        return b.created_at.localeCompare(a.created_at);
      });

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
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast({ title: 'Cliente archivado correctamente' });
      setDeleteContactId(null);
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Close client mutation
  const closeContactMutation = useMutation({
    mutationFn: async (contactId: string) => {
      const { error } = await supabase
        .from('contacts')
        .update({ closed_at: new Date().toISOString() })
        .eq('id', contactId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast({ title: '✅ Cliente marcado como cerrado' });
      setCloseContactId(null);
      setCloseStep(1);
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Reopen client mutation
  const reopenContactMutation = useMutation({
    mutationFn: async (contactId: string) => {
      const { error } = await supabase
        .from('contacts')
        .update({ closed_at: null })
        .eq('id', contactId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast({ title: 'Cliente reabierto' });
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

    let matchesLastContact = true;
    if (lastContactFilter !== 'all' && contact.last_contact_at) {
      const lastContactDate = new Date(contact.last_contact_at);
      const now = new Date();
      const diffHours = (now.getTime() - lastContactDate.getTime()) / (1000 * 60 * 60);
      if (lastContactFilter === 'today') matchesLastContact = diffHours <= 24;
      else if (lastContactFilter === 'week') matchesLastContact = diffHours <= 168;
      else if (lastContactFilter === 'month') matchesLastContact = diffHours <= 720;
      else if (lastContactFilter === 'older') matchesLastContact = diffHours > 720;
    } else if (lastContactFilter === 'never') {
      matchesLastContact = !contact.last_contact_at;
    }
    
    return matchesSearch && matchesScore && matchesIntent && matchesRecontact && matchesSchedule && matchesLastContact;
  });

  const stats = {
    total: contacts?.length || 0,
    hot: contacts?.filter(c => c.lead_score >= 80).length || 0,
    warm: contacts?.filter(c => c.lead_score >= 50 && c.lead_score < 80).length || 0,
    cold: contacts?.filter(c => c.lead_score < 50).length || 0,
    pendingRecontact: contacts?.filter(c => c.should_recontact).length || 0,
    scheduled: contacts?.filter(c => c.did_schedule === true).length || 0,
    closed: contacts?.filter(c => c.closed_at !== null).length || 0,
  };

  return (
    <div className="page-shell page-stack animate-in">
      <div className="flex items-center justify-between">
        <PageHeader 
          title="Clientes" 
          description="Gestiona tu base de clientes y leads"
        />
        <div className="flex items-center bg-background/50 border border-border/60 p-1 rounded-xl gap-1">
          <Button
            variant={viewMode === 'table' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('table')}
            className={cn(
              "h-8 px-3 rounded-lg flex items-center gap-2 transition-all",
              viewMode === 'table' ? "bg-white shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <List className="w-4 h-4" />
            <span className="text-xs font-medium">Tabla</span>
          </Button>
          <Button
            variant={viewMode === 'pipeline' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('pipeline')}
            className={cn(
              "h-8 px-3 rounded-lg flex items-center gap-2 transition-all",
              viewMode === 'pipeline' ? "bg-white shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <LayoutGrid className="w-4 h-4" />
            <span className="text-xs font-medium">Pipeline</span>
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="page-panel">
        <div className="section-header">
          <h2 className="section-title">Resumen</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
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

          <Card className="card-premium border-emerald-200/50">
            <CardContent className="p-3 md:p-4 flex items-center gap-3">
              <div className="p-2 rounded-xl bg-emerald-50">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-emerald-600">{stats.closed}</p>
                <p className="text-xs text-muted-foreground">Cerrados</p>
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
        <div className="grid grid-cols-2 sm:flex sm:flex-row sm:flex-wrap gap-2 md:gap-3">
        <div className="relative col-span-2 sm:flex-1 sm:min-w-[180px] sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
          <Input
            placeholder="Buscar cliente..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-background border-border/60"
          />
        </div>
        
        <Select value={scoreFilter} onValueChange={setScoreFilter}>
          <SelectTrigger className="w-full sm:w-[130px] bg-background border-border/60 text-xs sm:text-sm">
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
           <SelectTrigger className="w-full sm:w-[140px] bg-background border-border/60 text-xs sm:text-sm">
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
             <SelectTrigger className="w-full sm:w-[140px] bg-background border-border/60 text-xs sm:text-sm">
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
          <SelectTrigger className="w-full sm:w-[140px] bg-background border-border/60 text-xs sm:text-sm">
            <Clock className="w-4 h-4 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Recontacto" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pending">⏰ Pendientes</SelectItem>
            <SelectItem value="none">Sin recontacto</SelectItem>
          </SelectContent>
        </Select>

        <Select value={lastContactFilter} onValueChange={setLastContactFilter}>
          <SelectTrigger className="w-full sm:w-[160px] bg-background border-border/60 text-xs sm:text-sm">
            <MessageSquare className="w-4 h-4 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Última conversación" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="today">📅 Hoy</SelectItem>
            <SelectItem value="week">📆 Esta semana</SelectItem>
            <SelectItem value="month">🗓️ Este mes</SelectItem>
            <SelectItem value="older">🕰️ Más antiguo</SelectItem>
            <SelectItem value="never">🚫 Sin conversación</SelectItem>
          </SelectContent>
        </Select>
        </div>
      </div>

      {/* Client List */}
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
            <>
              {/* Mobile Card View */}
              <div className="md:hidden divide-y divide-border/50">
                {filteredContacts?.map((contact) => {
                  const scoreInfo = getLeadScoreInfo(contact.lead_score);
                  const lastContact = formatLastContact(contact.last_contact_at);
                  
                  return (
                    <div 
                      key={contact.id}
                      className="p-4 active:bg-muted/50 cursor-pointer"
                      onClick={() => setSelectedContact(contact)}
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          'w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0',
                          contact.lead_score >= 80 ? 'bg-orange-50' : 
                          contact.lead_score >= 50 ? 'bg-amber-50' : 'bg-gray-100'
                        )}>
                          {scoreInfo.emoji}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <p className="font-medium text-sm truncate">{contact.name}</p>
                              {contact.closed_at && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-600 border border-emerald-200/50 flex-shrink-0">
                                  <CheckCircle2 className="w-2.5 h-2.5" /> Cerrado
                                </span>
                              )}
                            </div>
                            <span className={cn(
                              'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border flex-shrink-0',
                              scoreInfo.className
                            )}>
                              {contact.lead_score}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            {contact.phone && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Phone className="w-3 h-3" />
                                {contact.phone}
                              </span>
                            )}
                          </div>
                          {lastContact && (
                            <p className="text-xs text-muted-foreground/70 mt-1 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {lastContact}
                            </p>
                          )}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            {contact.closed_at ? (
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  reopenContactMutation.mutate(contact.id);
                                }}
                              >
                                <Undo2 className="w-4 h-4 mr-2" />
                                Reabrir cliente
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                className="text-emerald-600 focus:text-emerald-600"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCloseContactId(contact.id);
                                  setCloseStep(1);
                                }}
                              >
                                <CircleCheckBig className="w-4 h-4 mr-2" />
                                Marcar como cerrado
                              </DropdownMenuItem>
                            )}
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
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table/Pipeline View */}
              <div className="hidden md:block">
                {viewMode === 'table' ? (
                  <div className="overflow-x-auto">
                    <Table className="table-premium">
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="pl-4 md:pl-6">Cliente</TableHead>
                          <TableHead>Teléfono</TableHead>
                          <TableHead>Score</TableHead>
                          <TableHead>Último contacto</TableHead>
                          <TableHead className="hidden lg:table-cell">Intención</TableHead>
                          {!isChatbotOnly && (
                            <TableHead className="hidden lg:table-cell">Agendó</TableHead>
                          )}
                          <TableHead className="hidden lg:table-cell">Recontacto</TableHead>
                          <TableHead className="w-[50px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredContacts?.map((contact) => {
                          const scoreInfo = getLeadScoreInfo(contact.lead_score);
                          const intentInfo = getIntentLabel(contact.detected_intent);
                          const lastContact = formatLastContact(contact.last_contact_at);
                          
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
                                    <div className="flex items-center gap-1.5">
                                      <p className="font-medium text-sm truncate">{contact.name}</p>
                                      {contact.closed_at && (
                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-600 border border-emerald-200/50 flex-shrink-0">
                                          <CheckCircle2 className="w-2.5 h-2.5" /> Cerrado
                                        </span>
                                      )}
                                    </div>
                                    {contact.email && (
                                      <p className="text-xs text-muted-foreground truncate">
                                        {contact.email}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
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
                              <TableCell>
                                {lastContact ? (
                                  <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                                    <Clock className="w-3.5 h-3.5" />
                                    {lastContact}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/50">-</span>
                                )}
                              </TableCell>
                              <TableCell className="hidden lg:table-cell">
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
                              
                              <TableCell className="hidden lg:table-cell">
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
                              <TableCell>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                      <MoreHorizontal className="w-4 h-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-48">
                                    {contact.closed_at ? (
                                      <DropdownMenuItem
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          reopenContactMutation.mutate(contact.id);
                                        }}
                                      >
                                        <Undo2 className="w-4 h-4 mr-2" />
                                        Reabrir cliente
                                      </DropdownMenuItem>
                                    ) : (
                                      <DropdownMenuItem
                                        className="text-emerald-600 focus:text-emerald-600"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setCloseContactId(contact.id);
                                          setCloseStep(1);
                                        }}
                                      >
                                        <CircleCheckBig className="w-4 h-4 mr-2" />
                                        Marcar como cerrado
                                      </DropdownMenuItem>
                                    )}
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
                ) : (
                  <div className="p-4 bg-muted/20 min-h-[500px]">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
                      {[
                        { 
                          name: 'Nuevo', 
                          contacts: filteredContacts?.filter(c => !c.detected_intent && !c.closed_at && !c.should_recontact) || [] 
                        },
                        { 
                          name: 'En conversación', 
                          contacts: filteredContacts?.filter(c => c.detected_intent && !c.closed_at && !c.should_recontact) || [] 
                        },
                        { 
                          name: 'Recontacto', 
                          contacts: filteredContacts?.filter(c => c.should_recontact && !c.closed_at) || [] 
                        },
                        { 
                          name: 'Cerrado', 
                          contacts: filteredContacts?.filter(c => c.closed_at) || [] 
                        }
                      ].map((column) => (
                        <div key={column.name} className="flex flex-col gap-3 min-w-0">
                          <div className="flex items-center justify-between px-1">
                            <h3 className="font-semibold text-sm flex items-center gap-2">
                              {column.name}
                              <span className="bg-muted px-2 py-0.5 rounded-full text-[10px] text-muted-foreground font-bold">
                                {column.contacts.length}
                              </span>
                            </h3>
                          </div>
                          
                          <div className="flex flex-col gap-2 max-h-[700px] overflow-y-auto pr-1 scrollbar-thin">
                            {column.contacts.length === 0 ? (
                              <div className="border border-dashed border-border/60 rounded-xl p-6 text-center">
                                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider font-semibold">Vacío</p>
                              </div>
                            ) : (
                              column.contacts.map((contact) => {
                                const scoreInfo = getLeadScoreInfo(contact.lead_score);
                                const lastContact = formatLastContact(contact.last_contact_at);
                                
                                return (
                                  <div 
                                    key={contact.id}
                                    className="group bg-background border border-border/60 rounded-xl p-3 shadow-sm hover:shadow-md hover:border-primary/20 transition-all cursor-pointer relative"
                                    onClick={() => setSelectedContact(contact)}
                                  >
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <p className="font-semibold text-sm truncate">{contact.name}</p>
                                        <span className={cn(
                                          'px-1.5 py-0.5 rounded-md text-[10px] font-bold border flex-shrink-0',
                                          scoreInfo.className
                                        )}>
                                          {contact.lead_score}
                                        </span>
                                      </div>
                                      
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                          <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1 -mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <MoreHorizontal className="w-3 h-3" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-48">
                                          {contact.closed_at ? (
                                            <DropdownMenuItem
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                reopenContactMutation.mutate(contact.id);
                                              }}
                                            >
                                              <Undo2 className="w-4 h-4 mr-2" />
                                              Reabrir cliente
                                            </DropdownMenuItem>
                                          ) : (
                                            <DropdownMenuItem
                                              className="text-emerald-600 focus:text-emerald-600"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setCloseContactId(contact.id);
                                                setCloseStep(1);
                                              }}
                                            >
                                              <CircleCheckBig className="w-4 h-4 mr-2" />
                                              Marcar como cerrado
                                            </DropdownMenuItem>
                                          )}
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
                                    </div>
                                    
                                    <div className="space-y-1.5">
                                      {contact.phone && (
                                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground/80">
                                          <Phone className="w-3 h-3" />
                                          {contact.phone}
                                        </div>
                                      )}
                                      {lastContact && (
                                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                                          <Clock className="w-3 h-3" />
                                          {lastContact}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
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

      {/* Close Client Double Confirmation Dialog */}
      <AlertDialog open={!!closeContactId} onOpenChange={(open) => { if (!open) { setCloseContactId(null); setCloseStep(1); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {closeStep === 1 ? '¿Marcar como cliente cerrado?' : '⚠️ Confirmación final'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {closeStep === 1 
                ? 'Este cliente será marcado como cerrado/listo. Esta acción quedará reflejada en las métricas del dashboard.' 
                : '¿Estás completamente seguro? Esta acción marcará al cliente como cerrado de forma definitiva en las métricas.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            {closeStep === 1 ? (
              <AlertDialogAction
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={(e) => {
                  e.preventDefault();
                  setCloseStep(2);
                }}
              >
                Sí, continuar
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => closeContactId && closeContactMutation.mutate(closeContactId)}
              >
                ✅ Confirmar cierre
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
