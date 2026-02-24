import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { usePaymentRecords } from '@/hooks/admin/usePaymentRecords';
import { useWorkshopBilling } from '@/hooks/admin/useWorkshopBilling';
import { PaymentRecordDialog } from './PaymentRecordDialog';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Plus, Loader2, Receipt, CreditCard, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PaymentHistoryTabProps {
  workshopId: string;
  workshopName: string;
}

const paymentTypeConfig = {
  setup: { label: 'Setup', icon: '💼', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' },
  monthly: { label: 'Mensual', icon: '📅', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' },
  extra: { label: 'Extra', icon: '➕', className: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400' },
};

export function PaymentHistoryTab({ workshopId, workshopName }: PaymentHistoryTabProps) {
  const { data: payments, isLoading } = usePaymentRecords(workshopId);
  const { data: billing } = useWorkshopBilling(workshopId);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  
  // Calculate totals
  const totalPaid = payments?.reduce((sum, p) => sum + (p.amount_clp || 0), 0) || 0;
  const setupPayments = payments?.filter(p => p.payment_type === 'setup') || [];
  const monthlyPayments = payments?.filter(p => p.payment_type === 'monthly') || [];
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 rounded-lg bg-muted/50">
          <p className="text-xs text-muted-foreground">Total Pagado</p>
          <p className="text-lg font-bold">${totalPaid.toLocaleString('es-CL')}</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/50">
          <p className="text-xs text-muted-foreground">Mensualidades</p>
          <p className="text-lg font-bold">{monthlyPayments.length}</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/50">
          <p className="text-xs text-muted-foreground">Setup</p>
          <p className="text-lg font-bold">
            {billing?.setup_fee_paid ? '✅' : '❌'} ${(billing?.setup_fee_clp || 0).toLocaleString('es-CL')}
          </p>
        </div>
      </div>
      
      {/* Add Payment Button */}
      <Button onClick={() => setIsAddDialogOpen(true)} className="w-full">
        <Plus className="w-4 h-4 mr-2" />
        Registrar Nuevo Pago
      </Button>
      
      {/* Payment History Table */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Historial de Pagos
        </h4>
        
        {payments?.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Receipt className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No hay pagos registrados</p>
          </div>
        ) : (
          <div className="space-y-2">
            {payments?.map((payment) => {
              const typeConfig = paymentTypeConfig[payment.payment_type];
              
              return (
                <div
                  key={payment.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                        typeConfig.className
                      )}
                    >
                      <span>{typeConfig.icon}</span>
                      <span>{typeConfig.label}</span>
                    </span>
                    <div>
                      <p className="font-medium">
                        ${payment.amount_clp.toLocaleString('es-CL')} CLP
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {format(parseISO(payment.payment_date), 'dd MMM yyyy', { locale: es })}
                        </span>
                        {payment.payment_method && (
                          <span className="flex items-center gap-1">
                            <CreditCard className="w-3 h-3" />
                            {payment.payment_method}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    {payment.payment_type === 'monthly' && payment.period_start && payment.period_end && (
                      <p className="text-xs text-muted-foreground">
                        {format(parseISO(payment.period_start), 'MMM', { locale: es })} - 
                        {format(parseISO(payment.period_end), 'MMM yyyy', { locale: es })}
                      </p>
                    )}
                    {payment.receipt_number && (
                      <p className="text-xs text-muted-foreground">
                        #{payment.receipt_number}
                      </p>
                    )}
                    {payment.notes && (
                      <p className="text-xs text-muted-foreground truncate max-w-[150px]">
                        {payment.notes}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      
      {/* Add Payment Dialog */}
      <PaymentRecordDialog
        workshopId={workshopId}
        workshopName={workshopName}
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        defaultAmount={billing?.monthly_fee_clp || undefined}
      />
    </div>
  );
}
