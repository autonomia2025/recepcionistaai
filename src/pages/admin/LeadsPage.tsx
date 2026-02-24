import { useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useMarketingLeads, useUpdateLeadStatus, useDeleteLead, LEAD_STATUSES, MarketingLead } from '@/hooks/useMarketingLeads';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarIcon, Eye, Trash2, Users, TrendingUp, Clock, Filter, Code } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

export default function LeadsPage() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [utmSource, setUtmSource] = useState<string>('');
  const [selectedLead, setSelectedLead] = useState<MarketingLead | null>(null);
  const [showSnippet, setShowSnippet] = useState(false);

  const { data: leads, isLoading } = useMarketingLeads({
    status: statusFilter,
    startDate,
    endDate,
    utmSource: utmSource || undefined,
  });

  const updateStatus = useUpdateLeadStatus();
  const deleteLead = useDeleteLead();

  const handleStatusChange = async (leadId: string, newStatus: string) => {
    try {
      await updateStatus.mutateAsync({ leadId, status: newStatus });
      toast({ title: 'Estado actualizado' });
    } catch {
      toast({ title: 'Error al actualizar', variant: 'destructive' });
    }
  };

  const handleDelete = async (leadId: string) => {
    if (!confirm('¿Eliminar este lead?')) return;
    try {
      await deleteLead.mutateAsync(leadId);
      toast({ title: 'Lead eliminado' });
    } catch {
      toast({ title: 'Error al eliminar', variant: 'destructive' });
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = LEAD_STATUSES.find(s => s.value === status) || LEAD_STATUSES[0];
    return <Badge className={cn('font-medium', statusConfig.color)}>{statusConfig.label}</Badge>;
  };

  // Stats
  const totalLeads = leads?.length || 0;
  const newLeads = leads?.filter(l => l.status === 'new').length || 0;
  const convertedLeads = leads?.filter(l => l.status === 'converted').length || 0;
  const conversionRate = totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : '0';

  const snippetCode = `<!-- Lead Capture Form - AutonomIA Suite -->
<form id="lead-form">
  <input type="text" name="name" placeholder="Nombre" required />
  <input type="email" name="email" placeholder="Email" required />
  <input type="tel" name="phone" placeholder="Teléfono" />
  <input type="text" name="company" placeholder="Empresa" />
  <select name="industry">
    <option value="">Industria</option>
    <option value="automotive">Automotriz</option>
    <option value="healthcare">Salud</option>
    <option value="retail">Retail</option>
    <option value="services">Servicios</option>
    <option value="other">Otro</option>
  </select>
  <textarea name="message" placeholder="Mensaje"></textarea>
  <!-- Honeypot - hidden from users, bots fill it -->
  <input type="text" name="website" style="display:none" tabindex="-1" autocomplete="off" />
  <button type="submit">Enviar</button>
</form>

<script>
document.getElementById('lead-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const params = new URLSearchParams(window.location.search);
  
  const data = {
    name: form.name.value,
    email: form.email.value,
    phone: form.phone.value || null,
    company: form.company.value || null,
    industry: form.industry.value || null,
    message: form.message.value || null,
    website: form.website.value, // honeypot
    source: 'landing',
    utm_source: params.get('utm_source'),
    utm_medium: params.get('utm_medium'),
    utm_campaign: params.get('utm_campaign'),
  };

  try {
    const res = await fetch('${import.meta.env.VITE_SUPABASE_URL}/functions/v1/lead-capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    
    const result = await res.json();
    if (res.ok) {
      alert('¡Gracias! Nos pondremos en contacto pronto.');
      form.reset();
    } else {
      alert(result.error || 'Error al enviar');
    }
  } catch (err) {
    alert('Error de conexión');
  }
});
</script>`;

  return (
    <div className="page-shell page-stack">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Leads de Marketing"
          description="Gestiona los leads capturados desde landing pages"
        />
        <Button variant="outline" onClick={() => setShowSnippet(true)}>
          <Code className="h-4 w-4 mr-2" />
          Ver Snippet
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-lg bg-emerald-100">
                <Users className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Leads</p>
                <p className="text-2xl font-bold">{totalLeads}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-lg bg-yellow-100">
                <Clock className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Nuevos</p>
                <p className="text-2xl font-bold">{newLeads}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-lg bg-green-100">
                <TrendingUp className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Convertidos</p>
                <p className="text-2xl font-bold">{convertedLeads}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-lg bg-amber-100">
                <TrendingUp className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Tasa Conversión</p>
                <p className="text-2xl font-bold">{conversionRate}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {LEAD_STATUSES.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-44 justify-start">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {startDate ? format(startDate, 'dd/MM/yyyy') : 'Fecha inicio'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar mode="single" selected={startDate} onSelect={setStartDate} locale={es} />
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-44 justify-start">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {endDate ? format(endDate, 'dd/MM/yyyy') : 'Fecha fin'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar mode="single" selected={endDate} onSelect={setEndDate} locale={es} />
              </PopoverContent>
            </Popover>

            <Input
              placeholder="utm_source"
              value={utmSource}
              onChange={(e) => setUtmSource(e.target.value)}
              className="w-40"
            />

            <Button
              variant="ghost"
              onClick={() => {
                setStatusFilter('all');
                setStartDate(undefined);
                setEndDate(undefined);
                setUtmSource('');
              }}
            >
              Limpiar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Leads Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Fuente</TableHead>
                <TableHead>UTM</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    Cargando...
                  </TableCell>
                </TableRow>
              ) : !leads?.length ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No hay leads
                  </TableCell>
                </TableRow>
              ) : (
                leads.map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell className="text-sm">
                      {format(new Date(lead.created_at), 'dd/MM/yy HH:mm', { locale: es })}
                    </TableCell>
                    <TableCell className="font-medium">{lead.name}</TableCell>
                    <TableCell>{lead.email}</TableCell>
                    <TableCell>{lead.company || '-'}</TableCell>
                    <TableCell>{lead.source || '-'}</TableCell>
                    <TableCell className="text-xs">
                      {lead.utm_source && <span className="block">src: {lead.utm_source}</span>}
                      {lead.utm_medium && <span className="block">med: {lead.utm_medium}</span>}
                      {lead.utm_campaign && <span className="block">camp: {lead.utm_campaign}</span>}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={lead.status}
                        onValueChange={(value) => handleStatusChange(lead.id, value)}
                      >
                        <SelectTrigger className="w-32 h-8">
                          <SelectValue>{getStatusBadge(lead.status)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {LEAD_STATUSES.map(s => (
                            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setSelectedLead(lead)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(lead.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Lead Detail Dialog */}
      <Dialog open={!!selectedLead} onOpenChange={() => setSelectedLead(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalle del Lead</DialogTitle>
          </DialogHeader>
          {selectedLead && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Nombre</p>
                  <p className="font-medium">{selectedLead.name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <p className="font-medium">{selectedLead.email}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Teléfono</p>
                  <p className="font-medium">{selectedLead.phone || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Empresa</p>
                  <p className="font-medium">{selectedLead.company || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Industria</p>
                  <p className="font-medium">{selectedLead.industry || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Fuente</p>
                  <p className="font-medium">{selectedLead.source || '-'}</p>
                </div>
              </div>

              {selectedLead.message && (
                <div>
                  <p className="text-sm text-muted-foreground">Mensaje</p>
                  <p className="mt-1 p-3 bg-muted rounded-lg text-sm">{selectedLead.message}</p>
                </div>
              )}

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">UTM Source</p>
                  <p className="font-medium text-sm">{selectedLead.utm_source || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">UTM Medium</p>
                  <p className="font-medium text-sm">{selectedLead.utm_medium || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">UTM Campaign</p>
                  <p className="font-medium text-sm">{selectedLead.utm_campaign || '-'}</p>
                </div>
              </div>

              {selectedLead.metadata && (
                <div>
                  <p className="text-sm text-muted-foreground">Metadata</p>
                  <pre className="mt-1 p-3 bg-muted rounded-lg text-xs overflow-auto">
                    {JSON.stringify(selectedLead.metadata, null, 2)}
                  </pre>
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                Creado: {format(new Date(selectedLead.created_at), "dd/MM/yyyy HH:mm", { locale: es })}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Snippet Dialog */}
      <Dialog open={showSnippet} onOpenChange={setShowSnippet}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Snippet para Landing Page</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Copia este código en tu landing page para capturar leads. Incluye honeypot anti-spam y UTM tracking.
            </p>
            <pre className="p-4 bg-muted rounded-lg text-xs overflow-auto whitespace-pre-wrap">
              {snippetCode}
            </pre>
            <Button
              onClick={() => {
                navigator.clipboard.writeText(snippetCode);
                toast({ title: 'Copiado al portapapeles' });
              }}
            >
              Copiar Código
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
