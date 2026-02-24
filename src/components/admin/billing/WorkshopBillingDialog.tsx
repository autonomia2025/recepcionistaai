import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BillingTab } from './BillingTab';
import { PaymentHistoryTab } from './PaymentHistoryTab';
import { useWorkshopBilling } from '@/hooks/admin/useWorkshopBilling';
import { BillingStatusBadge, getStatusFromDates } from './BillingStatusBadge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CreditCard, History, FileText, Building2 } from 'lucide-react';

interface WorkshopBillingDialogProps {
  workshopId: string | null;
  workshopName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WorkshopBillingDialog({
  workshopId,
  workshopName,
  open,
  onOpenChange,
}: WorkshopBillingDialogProps) {
  const { data: billing } = useWorkshopBilling(workshopId || undefined);
  
  if (!workshopId) return null;
  
  const status = getStatusFromDates(billing?.next_billing_date, billing?.last_payment_date);
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-xl">{workshopName}</DialogTitle>
                <DialogDescription>
                  Gestión de facturación y pagos
                </DialogDescription>
              </div>
            </div>
            <BillingStatusBadge status={status} nextBillingDate={billing?.next_billing_date} />
          </div>
        </DialogHeader>
        
        <Tabs defaultValue="billing" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="billing" className="flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              Facturación
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="w-4 h-4" />
              Historial de Pagos
            </TabsTrigger>
          </TabsList>
          
          <ScrollArea className="h-[60vh] mt-4 pr-4">
            <TabsContent value="billing" className="mt-0">
              <BillingTab workshopId={workshopId} />
            </TabsContent>
            
            <TabsContent value="history" className="mt-0">
              <PaymentHistoryTab workshopId={workshopId} workshopName={workshopName} />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
