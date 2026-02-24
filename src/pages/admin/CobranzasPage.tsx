import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, DollarSign } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { WorkshopBillingDialog, BillingStatusBadge, getStatusFromDates, PaymentStatus } from '@/components/admin/billing';
import { useAllWorkshopBilling } from '@/hooks/admin/useWorkshopBilling';
import { MetricCard } from '@/components/metrics';

interface Workshop {
  id: string;
  name: string;
  city: string | null;
  is_active: boolean;
}

interface Subscription {
  workshop_id: string;
  plans: {
    name: string;
    price_clp: number;
  } | null;
}

export default function CobranzasPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | PaymentStatus>('all');
  const [selectedWorkshop, setSelectedWorkshop] = useState<{ id: string; name: string } | null>(null);
  const [isBillingDialogOpen, setIsBillingDialogOpen] = useState(false);

  // Fetch workshops
  const { data: workshops } = useQuery({
    queryKey: ['cobranzas-workshops'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workshops')
        .select('id, name, city, is_active')
        .order('name', { ascending: true });
      if (error) throw error;
      return data as Workshop[];
    },
  });

  // Fetch subscriptions
  const { data: subscriptions } = useQuery({
    queryKey: ['cobranzas-subscriptions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('workshop_id, plans(name, price_clp)')
        .in('status', ['active', 'trial']);
      if (error) throw error;
      return data as Subscription[];
    },
  });

  // Fetch all billing
  const { data: allBilling, isLoading } = useAllWorkshopBilling();

  // Combine data
  const combinedData = useMemo(() => {
    if (!workshops || !allBilling) return [];

    return workshops.map(workshop => {
      const billing = allBilling.find(b => b.workshop_id === workshop.id);
      const subscription = subscriptions?.find(s => s.workshop_id === workshop.id);
      const paymentStatus = getStatusFromDates(billing?.next_billing_date, billing?.last_payment_date);

      return {
        ...workshop,
        billing,
        subscription,
        paymentStatus,
        monthlyFee: billing?.monthly_fee_clp || subscription?.plans?.price_clp || 0,
        planName: subscription?.plans?.name || 'Sin plan',
      };
    });
  }, [workshops, allBilling, subscriptions]);

  // Filter data
  const filteredData = useMemo(() => {
    return combinedData.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.city?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || item.paymentStatus === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [combinedData, searchQuery, statusFilter]);

  // Calculate summary stats
  const stats = useMemo(() => {
    const activeClients = combinedData.filter(c => c.is_active).length;
    const mrr = combinedData
      .filter(c => c.is_active)
      .reduce((sum, c) => sum + (c.monthlyFee || 0), 0);
    const pending = combinedData.filter(c => c.paymentStatus === 'pending').length;
    const overdue = combinedData.filter(c => c.paymentStatus === 'overdue').length;

    return { activeClients, mrr, pending, overdue };
  }, [combinedData]);

  const openBillingDialog = (workshop: { id: string; name: string }) => {
    setSelectedWorkshop(workshop);
    setIsBillingDialogOpen(true);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="page-shell page-stack">
      <PageHeader
        title="Cobranzas"
        description="Gestión de facturación y pagos de clientes"
      />

      {/* Summary Stats with MetricCards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <MetricCard
          metricId="active_clients"
          value={stats.activeClients}
          isAdmin
        />
        <MetricCard
          metricId="mrr"
          value={stats.mrr}
          isAdmin
        />
        <MetricCard
          metricId="pending_payments"
          value={stats.pending}
          isAdmin
        />
        <MetricCard
          metricId="overdue_payments"
          value={stats.overdue}
          isAdmin
        />
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o ciudad..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Estado de pago" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="current">✅ Al día</SelectItem>
            <SelectItem value="pending">⚠️ Por vencer</SelectItem>
            <SelectItem value="overdue">🔴 Vencido</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Clientes ({filteredData.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Cargando...</div>
          ) : filteredData.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No se encontraron clientes</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 font-medium text-muted-foreground">Cliente</th>
                    <th className="pb-3 font-medium text-muted-foreground">Plan</th>
                    <th className="pb-3 font-medium text-muted-foreground">Mensualidad</th>
                    <th className="pb-3 font-medium text-muted-foreground">Próximo Cobro</th>
                    <th className="pb-3 font-medium text-muted-foreground">Estado</th>
                    <th className="pb-3 font-medium text-muted-foreground">Último Pago</th>
                    <th className="pb-3 font-medium text-muted-foreground">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b last:border-0 hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => openBillingDialog({ id: item.id, name: item.name })}
                    >
                      <td className="py-4">
                        <div>
                          <p className="font-medium">{item.name}</p>
                          <p className="text-sm text-muted-foreground">{item.city || '-'}</p>
                        </div>
                      </td>
                      <td className="py-4">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                          {item.planName}
                        </span>
                      </td>
                      <td className="py-4 font-medium">
                        {formatCurrency(item.monthlyFee)}
                      </td>
                      <td className="py-4">
                        {item.billing?.next_billing_date ? (
                          <span className="text-sm">
                            {format(new Date(item.billing.next_billing_date), 'dd MMM yyyy', { locale: es })}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="py-4">
                        <BillingStatusBadge
                          status={item.paymentStatus}
                          nextBillingDate={item.billing?.next_billing_date}
                        />
                      </td>
                      <td className="py-4">
                        {item.billing?.last_payment_date ? (
                          <div>
                            <span className="text-sm">
                              {format(new Date(item.billing.last_payment_date), 'dd MMM yyyy', { locale: es })}
                            </span>
                            {item.billing.last_payment_amount && (
                              <p className="text-xs text-muted-foreground">
                                {formatCurrency(item.billing.last_payment_amount)}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Sin pagos</span>
                        )}
                      </td>
                      <td className="py-4">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            openBillingDialog({ id: item.id, name: item.name });
                          }}
                        >
                          <DollarSign className="w-4 h-4 mr-1" />
                          Ver detalle
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Billing Dialog */}
      <WorkshopBillingDialog
        workshopId={selectedWorkshop?.id || null}
        workshopName={selectedWorkshop?.name || ''}
        open={isBillingDialogOpen}
        onOpenChange={setIsBillingDialogOpen}
      />
    </div>
  );
}
