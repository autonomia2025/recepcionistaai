import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useServiceRequests, STATUS_LABELS, ServiceRequest, ServiceRequestStatus } from '@/hooks/useServiceRequests';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/PageHeader';
import { RequestDetailDialog } from '@/components/requests/RequestDetailDialog';
import { AlertTriangle, BarChart2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const ZONE_LABELS: Record<string, string> = {
  santiago: 'Santiago',
  talca: 'Talca',
  puerto_montt: 'Puerto Montt',
};

const ZONE_BADGE: Record<string, string> = {
  santiago: 'bg-blue-100 text-blue-700 border-blue-300',
  talca: 'bg-green-100 text-green-700 border-green-300',
  puerto_montt: 'bg-violet-100 text-violet-700 border-violet-300',
};

const HOURS_48 = 48 * 60 * 60 * 1000;

const formatCLP = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

const monthOf = (iso: string) => iso.slice(0, 7); // YYYY-MM

export default function SalesControlPage() {
  const { profile } = useAuth();
  const { data: requests = [], isLoading } = useServiceRequests();

  const currentMonth = new Date().toISOString().slice(0, 7);
  const [filterZone, setFilterZone] = useState<string>('all');
  const [filterStaff, setFilterStaff] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterMonth, setFilterMonth] = useState<string>(currentMonth);
  const [selected, setSelected] = useState<ServiceRequest | null>(null);

  // Fetch staff members of workshop
  const { data: staff = [] } = useQuery({
    queryKey: ['workshop-staff', profile?.workshop_id],
    queryFn: async () => {
      if (!profile?.workshop_id) return [];
      const { data, error } = await supabase.rpc('get_workshop_profiles', {
        _workshop_id: profile.workshop_id,
      });
      if (error) throw error;
      return (data || []).filter((p: any) => p.role === 'STAFF' && p.status === 'active');
    },
    enabled: !!profile?.workshop_id,
  });

  // Available months from data
  const months = useMemo(() => {
    const set = new Set<string>([currentMonth]);
    requests.forEach((r) => set.add(monthOf(r.created_at)));
    return Array.from(set).sort().reverse();
  }, [requests, currentMonth]);

  // Per-staff metrics for current month
  const staffMetrics = useMemo(() => {
    const now = Date.now();
    return staff.map((s: any) => {
      const myReqs = requests.filter(
        (r) => r.assigned_staff_id === s.id && monthOf(r.created_at) === currentMonth
      );
      const quoted = myReqs.filter((r) => r.quoted_by === s.id && r.quoted_at);
      const closed = myReqs.filter((r) => r.status === 'done' && r.quoted_by === s.id);
      const overdue = requests.some(
        (r) =>
          r.assigned_staff_id === s.id &&
          !r.quoted_at &&
          r.status !== 'done' &&
          r.status !== 'lost' &&
          now - new Date(r.created_at).getTime() > HOURS_48
      );
      const closeRate = quoted.length > 0 ? Math.round((closed.length / quoted.length) * 100) : 0;
      return {
        ...s,
        leads: myReqs.length,
        quoted: quoted.length,
        closed: closed.length,
        closeRate,
        overdue,
      };
    });
  }, [staff, requests, currentMonth]);

  // Filtered table
  const filtered = useMemo(() => {
    return requests.filter((r: any) => {
      if (filterMonth !== 'all' && monthOf(r.created_at) !== filterMonth) return false;
      if (filterZone !== 'all' && r.contacts?.zone !== filterZone) return false;
      if (filterStaff !== 'all' && r.assigned_staff_id !== filterStaff) return false;
      if (filterStatus !== 'all' && r.status !== filterStatus) return false;
      return true;
    });
  }, [requests, filterMonth, filterZone, filterStaff, filterStatus]);

  const getQuoteSemaphore = (r: ServiceRequest) => {
    if (r.quoted_at) return { emoji: '🟢', label: 'Cotizada' };
    const ageMs = Date.now() - new Date(r.created_at).getTime();
    if (ageMs > HOURS_48) return { emoji: '🔴', label: '+48h sin cotizar' };
    return { emoji: '🟡', label: 'Pendiente' };
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Control de Ventas"
        description="Seguimiento de vendedores, cotizaciones y cierres"
        icon={BarChart2}
      />

      {/* Section A - Staff cards */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Resumen por vendedor — {filterMonth === 'all' ? 'Todos' : currentMonth}</h2>
        {isLoading ? (
          <div className="text-muted-foreground">Cargando...</div>
        ) : staffMetrics.length === 0 ? (
          <Card><CardContent className="p-6 text-muted-foreground text-center">No hay vendedores STAFF activos.</CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {staffMetrics.map((s: any) => (
              <Card
                key={s.id}
                className={cn(
                  'transition-all',
                  s.overdue && 'border-2 border-red-500 shadow-md shadow-red-200/50'
                )}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                        {(s.full_name || '?').charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{s.full_name}</div>
                      {s.zone && (
                        <Badge variant="outline" className={cn('text-xs mt-0.5', ZONE_BADGE[s.zone])}>
                          {ZONE_LABELS[s.zone] || s.zone}
                        </Badge>
                      )}
                    </div>
                    {s.overdue && (
                      <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="bg-muted/50 rounded p-2">
                      <div className="text-xs text-muted-foreground">Leads</div>
                      <div className="font-bold text-lg">{s.leads}</div>
                    </div>
                    <div className="bg-muted/50 rounded p-2">
                      <div className="text-xs text-muted-foreground">Cotizadas</div>
                      <div className="font-bold text-lg">{s.quoted}</div>
                    </div>
                    <div className="bg-muted/50 rounded p-2">
                      <div className="text-xs text-muted-foreground">Cerradas</div>
                      <div className="font-bold text-lg text-emerald-600">{s.closed}</div>
                    </div>
                    <div className="bg-muted/50 rounded p-2">
                      <div className="text-xs text-muted-foreground">Tasa cierre</div>
                      <div className="font-bold text-lg">{s.closeRate}%</div>
                    </div>
                  </div>

                  {s.overdue && (
                    <div className="text-xs text-red-600 font-medium">
                      ⚠️ Tiene leads de +48h sin cotización
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Section B - Leads table */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Leads</h2>

        <div className="flex flex-wrap gap-2 mb-4">
          <Select value={filterMonth} onValueChange={setFilterMonth}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Mes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los meses</SelectItem>
              {months.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterZone} onValueChange={setFilterZone}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Zona" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las zonas</SelectItem>
              <SelectItem value="santiago">Santiago</SelectItem>
              <SelectItem value="talca">Talca</SelectItem>
              <SelectItem value="puerto_montt">Puerto Montt</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterStaff} onValueChange={setFilterStaff}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Vendedor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los vendedores</SelectItem>
              {staff.map((s: any) => (
                <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Zona</TableHead>
                  <TableHead>Servicio</TableHead>
                  <TableHead>Vendedor</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>¿Cotizó?</TableHead>
                  <TableHead>Monto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Resultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      Sin resultados para los filtros aplicados
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r: any) => {
                    const sem = getQuoteSemaphore(r);
                    const zone = r.contacts?.zone;
                    const result =
                      r.status === 'done' ? '✅ Vendido' :
                      r.status === 'lost' ? '❌ Perdido' :
                      '— En curso';
                    return (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelected(r)}
                      >
                        <TableCell className="font-medium">{r.contacts?.name || '—'}</TableCell>
                        <TableCell>
                          {zone ? (
                            <Badge variant="outline" className={cn('text-xs', ZONE_BADGE[zone])}>
                              {ZONE_LABELS[zone] || zone}
                            </Badge>
                          ) : '—'}
                        </TableCell>
                        <TableCell className="max-w-[180px] truncate">{r.service_category}</TableCell>
                        <TableCell>{r.assigned_staff?.full_name || <span className="text-muted-foreground">Sin asignar</span>}</TableCell>
                        <TableCell className="text-xs">{new Date(r.created_at).toLocaleDateString('es-CL')}</TableCell>
                        <TableCell title={sem.label}>
                          <span className="text-lg">{sem.emoji}</span>
                        </TableCell>
                        <TableCell>{formatCLP(r.quote_amount)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{STATUS_LABELS[r.status as ServiceRequestStatus]}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{result}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {selected && (
        <RequestDetailDialog
          request={selected}
          open={!!selected}
          onOpenChange={(open) => !open && setSelected(null)}
        />
      )}
    </div>
  );
}
