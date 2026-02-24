import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { 
  useCreateServiceRequest, 
  RequestUrgency, 
  URGENCY_LABELS 
} from '@/hooks/useServiceRequests';

interface CreateRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillContactId?: string;
  prefillConversationId?: string;
  prefillDescription?: string;
}

const SERVICE_CATEGORIES = [
  'Mantención general',
  'Reparación motor',
  'Sistema eléctrico',
  'Frenos',
  'Suspensión',
  'Aire acondicionado',
  'Carrocería',
  'Pintura',
  'Scanner/Diagnóstico',
  'Otro',
];

export function CreateRequestDialog({
  open,
  onOpenChange,
  prefillContactId,
  prefillConversationId,
  prefillDescription,
}: CreateRequestDialogProps) {
  const { profile } = useAuth();
  const createMutation = useCreateServiceRequest();
  
  const [formData, setFormData] = useState({
    contact_id: prefillContactId || '',
    service_category: '',
    description: prefillDescription || '',
    address: '',
    comuna: '',
    preferred_time_window: '',
    urgency: 'medium' as RequestUrgency,
  });

  // Fetch contacts for selection
  const { data: contacts } = useQuery({
    queryKey: ['contacts-list', profile?.workshop_id],
    queryFn: async () => {
      if (!profile?.workshop_id) return [];
      const { data, error } = await supabase
        .from('contacts')
        .select('id, name, phone')
        .eq('workshop_id', profile.workshop_id)
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: !!profile?.workshop_id && !prefillContactId,
  });

  const handleSubmit = () => {
    if (!formData.contact_id || !formData.service_category) return;
    
    createMutation.mutate({
      contact_id: formData.contact_id,
      conversation_id: prefillConversationId,
      service_category: formData.service_category,
      description: formData.description || undefined,
      address: formData.address || undefined,
      comuna: formData.comuna || undefined,
      preferred_time_window: formData.preferred_time_window || undefined,
      urgency: formData.urgency,
      source: prefillConversationId ? 'whatsapp' : 'manual',
    }, {
      onSuccess: () => {
        onOpenChange(false);
        setFormData({
          contact_id: '',
          service_category: '',
          description: '',
          address: '',
          comuna: '',
          preferred_time_window: '',
          urgency: 'medium',
        });
      },
    });
  };

  // Update form when prefill changes
  useState(() => {
    if (prefillContactId) {
      setFormData(prev => ({ ...prev, contact_id: prefillContactId }));
    }
    if (prefillDescription) {
      setFormData(prev => ({ ...prev, description: prefillDescription }));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva Solicitud</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Contact Selection */}
          {!prefillContactId && (
            <div className="space-y-2">
              <Label>Cliente *</Label>
              <Select
                value={formData.contact_id}
                onValueChange={(value) => setFormData({ ...formData, contact_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar cliente" />
                </SelectTrigger>
                <SelectContent>
                  {contacts?.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.name} {contact.phone && `(${contact.phone})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Service Category */}
          <div className="space-y-2">
            <Label>Categoría de Servicio *</Label>
            <Select
              value={formData.service_category}
              onValueChange={(value) => setFormData({ ...formData, service_category: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar categoría" />
              </SelectTrigger>
              <SelectContent>
                {SERVICE_CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>Descripción</Label>
            <Textarea
              placeholder="Detalles del servicio requerido..."
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
            />
          </div>

          {/* Address */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Dirección</Label>
              <Input
                placeholder="Av. Principal 123"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Comuna</Label>
              <Input
                placeholder="Las Condes"
                value={formData.comuna}
                onChange={(e) => setFormData({ ...formData, comuna: e.target.value })}
              />
            </div>
          </div>

          {/* Preferred Time */}
          <div className="space-y-2">
            <Label>Horario Preferido</Label>
            <Input
              placeholder="Ej: Mañanas, Lunes a Viernes"
              value={formData.preferred_time_window}
              onChange={(e) => setFormData({ ...formData, preferred_time_window: e.target.value })}
            />
          </div>

          {/* Urgency */}
          <div className="space-y-2">
            <Label>Urgencia</Label>
            <Select
              value={formData.urgency}
              onValueChange={(value: RequestUrgency) => setFormData({ ...formData, urgency: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">{URGENCY_LABELS.low}</SelectItem>
                <SelectItem value="medium">{URGENCY_LABELS.medium}</SelectItem>
                <SelectItem value="high">{URGENCY_LABELS.high}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={!formData.contact_id || !formData.service_category || createMutation.isPending}
          >
            {createMutation.isPending ? 'Creando...' : 'Crear Solicitud'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
