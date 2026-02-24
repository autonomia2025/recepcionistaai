import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWorkshopBilling, useUpdateWorkshopBilling, type WorkshopBilling } from '@/hooks/admin/useWorkshopBilling';
import { BillingStatusBadge, getStatusFromDates } from './BillingStatusBadge';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { Loader2, Save } from 'lucide-react';

interface BillingTabProps {
  workshopId: string;
}

export function BillingTab({ workshopId }: BillingTabProps) {
  const { data: billing, isLoading } = useWorkshopBilling(workshopId);
  const updateBilling = useUpdateWorkshopBilling();
  const { toast } = useToast();
  
  const [formData, setFormData] = useState({
    setup_fee_clp: '',
    setup_fee_paid: false,
    setup_paid_at: '',
    setup_notes: '',
    monthly_fee_clp: '',
    billing_day: '1',
    next_billing_date: '',
    discount_percent: '',
    discount_ends_at: '',
    payment_method: 'none',
    billing_contact_name: '',
    billing_contact_email: '',
    billing_contact_phone: '',
    rut: '',
    razon_social: '',
    internal_notes: '',
  });
  
  const [hasChanges, setHasChanges] = useState(false);
  
  useEffect(() => {
    if (billing) {
      setFormData({
        setup_fee_clp: billing.setup_fee_clp?.toString() || '',
        setup_fee_paid: billing.setup_fee_paid || false,
        setup_paid_at: billing.setup_paid_at ? format(parseISO(billing.setup_paid_at), 'yyyy-MM-dd') : '',
        setup_notes: billing.setup_notes || '',
        monthly_fee_clp: billing.monthly_fee_clp?.toString() || '',
        billing_day: billing.billing_day?.toString() || '1',
        next_billing_date: billing.next_billing_date || '',
        discount_percent: billing.discount_percent?.toString() || '',
        discount_ends_at: billing.discount_ends_at || '',
        payment_method: billing.payment_method || 'none',
        billing_contact_name: billing.billing_contact_name || '',
        billing_contact_email: billing.billing_contact_email || '',
        billing_contact_phone: billing.billing_contact_phone || '',
        rut: billing.rut || '',
        razon_social: billing.razon_social || '',
        internal_notes: billing.internal_notes || '',
      });
      setHasChanges(false);
    }
  }, [billing]);
  
  const handleChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };
  
  const handleSave = async () => {
    try {
      await updateBilling.mutateAsync({
        workshopId,
        data: {
          setup_fee_clp: formData.setup_fee_clp ? parseFloat(formData.setup_fee_clp) : null,
          setup_fee_paid: formData.setup_fee_paid,
          setup_paid_at: formData.setup_paid_at ? new Date(formData.setup_paid_at).toISOString() : null,
          setup_notes: formData.setup_notes || null,
          monthly_fee_clp: formData.monthly_fee_clp ? parseFloat(formData.monthly_fee_clp) : null,
          billing_day: parseInt(formData.billing_day) || 1,
          next_billing_date: formData.next_billing_date || null,
          discount_percent: formData.discount_percent ? parseFloat(formData.discount_percent) : null,
          discount_ends_at: formData.discount_ends_at || null,
          payment_method: formData.payment_method !== 'none' ? formData.payment_method : null,
          billing_contact_name: formData.billing_contact_name || null,
          billing_contact_email: formData.billing_contact_email || null,
          billing_contact_phone: formData.billing_contact_phone || null,
          rut: formData.rut || null,
          razon_social: formData.razon_social || null,
          internal_notes: formData.internal_notes || null,
        },
      });
      
      toast({ title: 'Guardado', description: 'Datos de facturación actualizados' });
      setHasChanges(false);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  const currentStatus = getStatusFromDates(formData.next_billing_date, billing?.last_payment_date);
  
  const billingDays = Array.from({ length: 28 }, (_, i) => ({
    value: (i + 1).toString(),
    label: `Día ${i + 1}`,
  }));
  
  const paymentMethods = [
    { value: 'none', label: 'Sin especificar' },
    { value: 'transferencia', label: 'Transferencia' },
    { value: 'tarjeta', label: 'Tarjeta' },
    { value: 'efectivo', label: 'Efectivo' },
    { value: 'cheque', label: 'Cheque' },
  ];
  
  return (
    <div className="space-y-6">
      {/* Setup/Onboarding Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Setup / Onboarding
        </h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Monto Setup (CLP)</Label>
            <Input
              type="number"
              placeholder="150000"
              value={formData.setup_fee_clp}
              onChange={(e) => handleChange('setup_fee_clp', e.target.value)}
            />
          </div>
          <div className="space-y-2 flex items-end gap-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="setup_paid"
                checked={formData.setup_fee_paid}
                onCheckedChange={(checked) => handleChange('setup_fee_paid', !!checked)}
              />
              <Label htmlFor="setup_paid">Pagado</Label>
            </div>
            {formData.setup_fee_paid && (
              <Input
                type="date"
                value={formData.setup_paid_at}
                onChange={(e) => handleChange('setup_paid_at', e.target.value)}
                className="w-40"
              />
            )}
          </div>
        </div>
        <div className="space-y-2">
          <Label>Notas Setup</Label>
          <Input
            placeholder="Notas sobre el setup/onboarding..."
            value={formData.setup_notes}
            onChange={(e) => handleChange('setup_notes', e.target.value)}
          />
        </div>
      </div>
      
      {/* Monthly Billing Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Mensualidad
          </h4>
          <BillingStatusBadge status={currentStatus} nextBillingDate={formData.next_billing_date} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Valor Mensual (CLP)</Label>
            <Input
              type="number"
              placeholder="79990"
              value={formData.monthly_fee_clp}
              onChange={(e) => handleChange('monthly_fee_clp', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Día de Cobro</Label>
            <Select
              value={formData.billing_day}
              onValueChange={(value) => handleChange('billing_day', value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {billingDays.map((day) => (
                  <SelectItem key={day.value} value={day.value}>
                    {day.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Próximo Cobro</Label>
            <Input
              type="date"
              value={formData.next_billing_date}
              onChange={(e) => handleChange('next_billing_date', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Último Pago</Label>
            <div className="text-sm py-2">
              {billing?.last_payment_date ? (
                <span>
                  {format(parseISO(billing.last_payment_date), 'dd MMM yyyy', { locale: es })} - 
                  ${billing.last_payment_amount?.toLocaleString('es-CL')} CLP
                </span>
              ) : (
                <span className="text-muted-foreground">Sin pagos registrados</span>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Descuento (%)</Label>
            <Input
              type="number"
              placeholder="0"
              min="0"
              max="100"
              value={formData.discount_percent}
              onChange={(e) => handleChange('discount_percent', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Descuento Hasta</Label>
            <Input
              type="date"
              value={formData.discount_ends_at}
              onChange={(e) => handleChange('discount_ends_at', e.target.value)}
            />
          </div>
        </div>
      </div>
      
      {/* Billing Contact Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Datos de Facturación
        </h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>RUT</Label>
            <Input
              placeholder="12.345.678-9"
              value={formData.rut}
              onChange={(e) => handleChange('rut', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Razón Social</Label>
            <Input
              placeholder="Empresa SpA"
              value={formData.razon_social}
              onChange={(e) => handleChange('razon_social', e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Contacto Facturación</Label>
            <Input
              placeholder="Nombre del contacto"
              value={formData.billing_contact_name}
              onChange={(e) => handleChange('billing_contact_name', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Email Facturación</Label>
            <Input
              type="email"
              placeholder="facturacion@empresa.cl"
              value={formData.billing_contact_email}
              onChange={(e) => handleChange('billing_contact_email', e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Teléfono Facturación</Label>
            <Input
              placeholder="+56 9 1234 5678"
              value={formData.billing_contact_phone}
              onChange={(e) => handleChange('billing_contact_phone', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Método de Pago</Label>
            <Select
              value={formData.payment_method}
              onValueChange={(value) => handleChange('payment_method', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                {paymentMethods.map((method) => (
                  <SelectItem key={method.value} value={method.value}>
                    {method.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      
      {/* Internal Notes */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Notas Internas
        </h4>
        <Textarea
          placeholder="Notas internas sobre este cliente..."
          value={formData.internal_notes}
          onChange={(e) => handleChange('internal_notes', e.target.value)}
          rows={3}
        />
      </div>
      
      {/* Save Button */}
      <Button
        onClick={handleSave}
        disabled={!hasChanges || updateBilling.isPending}
        className="w-full"
      >
        {updateBilling.isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Guardando...
          </>
        ) : (
          <>
            <Save className="w-4 h-4 mr-2" />
            Guardar Cambios
          </>
        )}
      </Button>
    </div>
  );
}
