import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreatePaymentRecord } from '@/hooks/admin/usePaymentRecords';
import { useToast } from '@/hooks/use-toast';
import { format, addMonths, startOfMonth, endOfMonth } from 'date-fns';

interface PaymentRecordDialogProps {
  workshopId: string;
  workshopName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultType?: 'setup' | 'monthly' | 'extra';
  defaultAmount?: number;
}

export function PaymentRecordDialog({
  workshopId,
  workshopName,
  open,
  onOpenChange,
  defaultType = 'monthly',
  defaultAmount,
}: PaymentRecordDialogProps) {
  const { toast } = useToast();
  const createPayment = useCreatePaymentRecord();
  
  const today = new Date();
  const [formData, setFormData] = useState<{
    payment_type: 'setup' | 'monthly' | 'extra';
    amount_clp: string;
    payment_date: string;
    payment_method: string;
    period_start: string;
    period_end: string;
    receipt_number: string;
    notes: string;
  }>({
    payment_type: defaultType,
    amount_clp: defaultAmount?.toString() || '',
    payment_date: format(today, 'yyyy-MM-dd'),
    payment_method: 'transferencia',
    period_start: format(startOfMonth(today), 'yyyy-MM-dd'),
    period_end: format(endOfMonth(today), 'yyyy-MM-dd'),
    receipt_number: '',
    notes: '',
  });
  
  const handleSubmit = async () => {
    if (!formData.amount_clp || !formData.payment_date) {
      toast({ title: 'Error', description: 'Monto y fecha son requeridos', variant: 'destructive' });
      return;
    }
    
    try {
      await createPayment.mutateAsync({
        workshop_id: workshopId,
        payment_type: formData.payment_type as 'setup' | 'monthly' | 'extra',
        amount_clp: parseFloat(formData.amount_clp),
        payment_date: formData.payment_date,
        payment_method: formData.payment_method || undefined,
        period_start: formData.payment_type === 'monthly' ? formData.period_start : undefined,
        period_end: formData.payment_type === 'monthly' ? formData.period_end : undefined,
        receipt_number: formData.receipt_number || undefined,
        notes: formData.notes || undefined,
      });
      
      toast({ title: 'Pago registrado', description: 'El pago ha sido registrado correctamente' });
      onOpenChange(false);
      
      // Reset form
      setFormData({
        payment_type: 'monthly',
        amount_clp: '',
        payment_date: format(new Date(), 'yyyy-MM-dd'),
        payment_method: 'transferencia',
        period_start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
        period_end: format(endOfMonth(new Date()), 'yyyy-MM-dd'),
        receipt_number: '',
        notes: '',
      });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };
  
  const paymentTypes = [
    { value: 'setup', label: '💼 Setup/Onboarding' },
    { value: 'monthly', label: '📅 Mensualidad' },
    { value: 'extra', label: '➕ Extra/Adicional' },
  ];
  
  const paymentMethods = [
    { value: 'transferencia', label: 'Transferencia' },
    { value: 'tarjeta', label: 'Tarjeta' },
    { value: 'efectivo', label: 'Efectivo' },
    { value: 'cheque', label: 'Cheque' },
    { value: 'otro', label: 'Otro' },
  ];
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar Pago</DialogTitle>
          <DialogDescription>
            Registrar un pago para <strong>{workshopName}</strong>
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Tipo de Pago</Label>
          <Select
              value={formData.payment_type}
              onValueChange={(value: 'setup' | 'monthly' | 'extra') => setFormData({ ...formData, payment_type: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {paymentTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label>Monto (CLP) *</Label>
            <Input
              type="number"
              placeholder="79990"
              value={formData.amount_clp}
              onChange={(e) => setFormData({ ...formData, amount_clp: e.target.value })}
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Fecha de Pago *</Label>
              <Input
                type="date"
                value={formData.payment_date}
                onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Método</Label>
              <Select
                value={formData.payment_method}
                onValueChange={(value) => setFormData({ ...formData, payment_method: value })}
              >
                <SelectTrigger>
                  <SelectValue />
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
          
          {formData.payment_type === 'monthly' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Periodo Inicio</Label>
                <Input
                  type="date"
                  value={formData.period_start}
                  onChange={(e) => setFormData({ ...formData, period_start: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Periodo Fin</Label>
                <Input
                  type="date"
                  value={formData.period_end}
                  onChange={(e) => setFormData({ ...formData, period_end: e.target.value })}
                />
              </div>
            </div>
          )}
          
          <div className="space-y-2">
            <Label>N° Comprobante</Label>
            <Input
              placeholder="Opcional"
              value={formData.receipt_number}
              onChange={(e) => setFormData({ ...formData, receipt_number: e.target.value })}
            />
          </div>
          
          <div className="space-y-2">
            <Label>Notas</Label>
            <Textarea
              placeholder="Notas adicionales..."
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={2}
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={createPayment.isPending}>
            {createPayment.isPending ? 'Registrando...' : 'Registrar Pago'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
