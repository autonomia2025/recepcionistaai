import { useState, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Search, Plus, LayoutGrid, List, Filter,
  Clock, CheckCircle, AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useServiceRequests,
  ServiceRequest,
  ServiceRequestStatus,
  STATUS_LABELS,
  STATUS_COLORS,
  URGENCY_LABELS,
} from '@/hooks/useServiceRequests';
import { RequestCard } from '@/components/requests/RequestCard';
import { RequestDetailDialog } from '@/components/requests/RequestDetailDialog';
import { CreateRequestDialog } from '@/components/requests/CreateRequestDialog';

const KANBAN_COLUMNS: { status: ServiceRequestStatus; label: string }[] = [
  { status: 'new', label: 'Nuevas' },
  { status: 'contacting', label: 'Contactando' },
  { status: 'waiting_customer', label: 'Esperando' },
  { status: 'scheduled_visit', label: 'Visita' },
  { status: 'quoted', label: 'Cotizada' },
  { status: 'approved', label: 'Aprobada' },
  { status: 'in_progress', label: 'En Progreso' },
  { status: 'done', label: 'Completada' },
  { status: 'lost', label: 'Perdida' },
];

export default function RequestsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { data: requests, isLoading } = useServiceRequests();
  
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>(isMobile ? 'table' : 'kanban');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [urgencyFilter, setUrgencyFilter] = useState<string>('all');
  const [assignedFilter, setAssignedFilter] = useState<string>('all');
  
  const [selectedRequest, setSelectedRequest] = useState<ServiceRequest | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Realtime subscription
  useEffect(() => {
    if (!profile?.workshop_id) return;
    
    const channel = supabase
      .channel('service-requests-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'service_requests',
          filter: `workshop_id=eq.${profile.workshop_id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['service-requests'] });
        }
      )
      .subscribe();
    
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.workshop_id, queryClient]);

  const isStaffWithZone = profile?.role === 'STAFF' && !!(profile as any)?.zone;

  // Filter requests
  const filteredRequests = useMemo(() => {
    if (!requests) return [];

    const filtered = requests.filter((req) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName = req.contacts?.name?.toLowerCase().includes(query);
        const matchesPhone = req.contacts?.phone?.includes(query);
        const matchesCategory = req.service_category.toLowerCase().includes(query);
        if (!matchesName && !matchesPhone && !matchesCategory) return false;
      }
      
      // Status filter
      if (statusFilter !== 'all' && req.status !== statusFilter) return false;
      
      // Urgency filter
      if (urgencyFilter !== 'all' && req.urgency !== urgencyFilter) return false;
      
      // Assigned filter
      if (assignedFilter === 'unassigned' && req.assigned_staff_id) return false;
      if (assignedFilter === 'assigned' && !req.assigned_staff_id) return false;
      if (assignedFilter !== 'all' && assignedFilter !== 'assigned' && assignedFilter !== 'unassigned') {
        if (req.assigned_staff_id !== assignedFilter) return false;
      }
      
      return true;
    });

    // Si es STAFF con zona, filtrar solo requests de su zona
    if (isStaffWithZone) {
      return filtered.filter((req) => (req.contacts as any)?.zone === (profile as any).zone);
    }
    return filtered;
  }, [requests, searchQuery, statusFilter, urgencyFilter, assignedFilter, isStaffWithZone, profile]);

  // Group requests by status for Kanban
  const requestsByStatus = useMemo(() => {
    const grouped: Record<ServiceRequestStatus, ServiceRequest[]> = {
      new: [], contacting: [], waiting_customer: [], scheduled_visit: [],
      quoted: [], approved: [], in_progress: [], done: [], lost: [],
    };
    
    filteredRequests.forEach((req) => {
      grouped[req.status].push(req);
    });
    
    return grouped;
  }, [filteredRequests]);

  const openDetail = (request: ServiceRequest) => {
    setSelectedRequest(request);
    setIsDetailOpen(true);
  };

  // Stats
  const stats = useMemo(() => {
    if (!requests) return { new: 0, inProgress: 0, done: 0 };
    return {
      new: requests.filter(r => r.status === 'new').length,
      inProgress: requests.filter(r => !['new', 'done', 'lost'].includes(r.status)).length,
      done: requests.filter(r => r.status === 'done').length,
    };
  }, [requests]);

  return (
    <div className="page-shell page-stack">
      <PageHeader
        title="Solicitudes"
        description="Gestiona las solicitudes de servicio de tus clientes"
        actions={
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Nueva Solicitud
          </Button>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-emerald-500/10">
              <AlertCircle className="w-6 h-6 text-emerald-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Nuevas</p>
              <p className="text-2xl font-bold">{stats.new}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-yellow-500/10">
              <Clock className="w-6 h-6 text-yellow-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">En Proceso</p>
              <p className="text-2xl font-bold">{stats.inProgress}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-green-500/10">
              <CheckCircle className="w-6 h-6 text-green-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Completadas</p>
              <p className="text-2xl font-bold">{stats.done}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="page-toolbar flex flex-col sm:flex-row">
        <div className="relative w-full sm:flex-1 sm:min-w-[200px] sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por cliente, teléfono o servicio..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {KANBAN_COLUMNS.map(col => (
              <SelectItem key={col.status} value={col.status}>{col.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        
        <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
          <SelectTrigger className="w-full sm:w-[130px]">
            <SelectValue placeholder="Urgencia" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="high">Alta</SelectItem>
            <SelectItem value="medium">Media</SelectItem>
            <SelectItem value="low">Baja</SelectItem>
          </SelectContent>
        </Select>
        
        <Select value={assignedFilter} onValueChange={setAssignedFilter}>
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue placeholder="Asignación" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="unassigned">Sin asignar</SelectItem>
            <SelectItem value="assigned">Asignados</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex border border-border/60 rounded-lg">
          <Button
            variant={viewMode === 'kanban' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('kanban')}
            className="rounded-r-none"
          >
            <LayoutGrid className="w-4 h-4" />
          </Button>
          <Button
            variant={viewMode === 'table' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('table')}
            className="rounded-l-none"
          >
            <List className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Cargando solicitudes...
        </div>
      ) : viewMode === 'kanban' ? (
        // Kanban View
        <ScrollArea className="w-full">
          <div className="flex gap-4 pb-4 min-w-max">
            {KANBAN_COLUMNS.map((column) => (
              <div
                key={column.status}
                className="w-72 flex-shrink-0 bg-muted/30 rounded-xl border border-border/50"
              >
                {/* Column Header */}
                <div className="p-3 border-b border-border/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={cn('w-2 h-2 rounded-full', STATUS_COLORS[column.status])} />
                    <span className="font-medium text-sm">{column.label}</span>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {requestsByStatus[column.status].length}
                  </Badge>
                </div>
                
                {/* Column Content */}
                <ScrollArea className="h-[calc(100vh-400px)] p-2">
                  <div className="space-y-2">
                    {requestsByStatus[column.status].length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-8">
                        Sin solicitudes
                      </p>
                    ) : (
                      requestsByStatus[column.status].map((request) => (
                        <RequestCard
                          key={request.id}
                          request={request}
                          onClick={() => openDetail(request)}
                        />
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            ))}
          </div>
        </ScrollArea>
      ) : (
        // Table View
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full table-premium">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Cliente</th>
                    <th className="p-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Servicio</th>
                    <th className="p-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Estado</th>
                    <th className="p-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Urgencia</th>
                    <th className="p-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Asignado a</th>
                    <th className="p-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Valor</th>
                    <th className="p-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Creada</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-muted-foreground">
                        No se encontraron solicitudes
                      </td>
                    </tr>
                  ) : (
                    filteredRequests.map((request) => (
                      <tr
                        key={request.id}
                        className="border-b last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => openDetail(request)}
                      >
                        <td className="p-4">
                          <div>
                            <p className="font-medium">{request.contacts?.name}</p>
                            <p className="text-sm text-muted-foreground">{request.contacts?.phone}</p>
                          </div>
                        </td>
                        <td className="p-4">
                          <p className="font-medium">{request.service_category}</p>
                          {request.description && (
                            <p className="text-sm text-muted-foreground line-clamp-1">
                              {request.description}
                            </p>
                          )}
                        </td>
                        <td className="p-4">
                          <Badge className={cn('text-white', STATUS_COLORS[request.status])}>
                            {STATUS_LABELS[request.status]}
                          </Badge>
                        </td>
                        <td className="p-4">
                          <Badge variant="outline">{URGENCY_LABELS[request.urgency]}</Badge>
                        </td>
                        <td className="p-4">
                          {request.assigned_staff?.full_name || (
                            <span className="text-orange-500 text-sm">Sin asignar</span>
                          )}
                        </td>
                        <td className="p-4">
                          {request.estimated_value 
                            ? `$${request.estimated_value.toLocaleString('es-CL')}`
                            : '-'
                          }
                        </td>
                        <td className="p-4 text-sm text-muted-foreground">
                          {new Date(request.created_at).toLocaleDateString('es-CL')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialogs */}
      <RequestDetailDialog
        request={selectedRequest}
        open={isDetailOpen}
        onOpenChange={setIsDetailOpen}
      />
      
      <CreateRequestDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
      />
    </div>
  );
}
