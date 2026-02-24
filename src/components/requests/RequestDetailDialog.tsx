import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { 
  User, Phone, Mail, MapPin, Clock, MessageSquare, 
  FileText, DollarSign, AlertCircle, Calendar 
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  ServiceRequest,
  ServiceRequestStatus,
  RequestUrgency,
  STATUS_LABELS,
  STATUS_COLORS,
  URGENCY_LABELS,
  URGENCY_COLORS,
  useUpdateServiceRequest,
} from '@/hooks/useServiceRequests';

interface RequestDetailDialogProps {
  request: ServiceRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_ORDER: ServiceRequestStatus[] = [
  'new', 'contacting', 'waiting_customer', 'scheduled_visit',
  'quoted', 'approved', 'in_progress', 'done', 'lost'
];

export function RequestDetailDialog({ request, open, onOpenChange }: RequestDetailDialogProps) {
  const { profile } = useAuth();
  const updateMutation = useUpdateServiceRequest();
  const isAdmin = profile?.role === 'ADMIN';
  
  const [notes, setNotes] = useState(request?.notes || '');
  const [estimatedValue, setEstimatedValue] = useState(request?.estimated_value?.toString() || '');
  
  // Fetch staff members for assignment
  const { data: staffMembers } = useQuery({
    queryKey: ['staff-members', profile?.workshop_id],
    queryFn: async () => {
      if (!profile?.workshop_id) return [];
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('workshop_id', profile.workshop_id)
        .neq('status', 'disabled');
      if (error) throw error;
      return data;
    },
    enabled: !!profile?.workshop_id && isAdmin,
  });

  // Fetch conversation messages if linked
  const { data: messages } = useQuery({
    queryKey: ['request-messages', request?.conversation_id],
    queryFn: async () => {
      if (!request?.conversation_id) return [];
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', request.conversation_id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!request?.conversation_id,
  });

  if (!request) return null;

  const handleStatusChange = (status: ServiceRequestStatus) => {
    updateMutation.mutate({ id: request.id, data: { status } });
  };

  const handleAssign = (staffId: string) => {
    updateMutation.mutate({ 
      id: request.id, 
      data: { assigned_staff_id: staffId === 'unassigned' ? null : staffId } 
    });
  };

  const handleUrgencyChange = (urgency: RequestUrgency) => {
    updateMutation.mutate({ id: request.id, data: { urgency } });
  };

  const handleSaveNotes = () => {
    updateMutation.mutate({
      id: request.id,
      data: {
        notes,
        estimated_value: estimatedValue ? parseFloat(estimatedValue) : null,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span>Solicitud: {request.service_category}</span>
            <Badge 
              variant="secondary" 
              className={cn('text-white', STATUS_COLORS[request.status])}
            >
              {STATUS_LABELS[request.status]}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Request Details */}
          <ScrollArea className="h-[60vh]">
            <div className="space-y-6 pr-4">
              {/* Contact Info */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Información del Cliente
                </h4>
                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">{request.contacts?.name}</span>
                  </div>
                  {request.contacts?.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-muted-foreground" />
                      <span>{request.contacts.phone}</span>
                    </div>
                  )}
                  {request.contacts?.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-muted-foreground" />
                      <span>{request.contacts.email}</span>
                    </div>
                  )}
                  {(request.address || request.comuna) && (
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-muted-foreground" />
                      <span>{[request.address, request.comuna].filter(Boolean).join(', ')}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Request Details */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Detalles de la Solicitud
                </h4>
                <div className="space-y-3">
                  {request.description && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Descripción</Label>
                      <p className="text-sm mt-1">{request.description}</p>
                    </div>
                  )}
                  {request.preferred_time_window && (
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm">Horario preferido: {request.preferred_time_window}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">
                      Creada: {format(new Date(request.created_at), "d 'de' MMMM, HH:mm", { locale: es })}
                    </span>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Status & Assignment Controls */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Estado</Label>
                  <Select value={request.status} onValueChange={handleStatusChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_ORDER.map((status) => (
                        <SelectItem key={status} value={status}>
                          <div className="flex items-center gap-2">
                            <div className={cn('w-2 h-2 rounded-full', STATUS_COLORS[status])} />
                            {STATUS_LABELS[status]}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Urgencia</Label>
                  <Select value={request.urgency} onValueChange={handleUrgencyChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['low', 'medium', 'high'] as RequestUrgency[]).map((urgency) => (
                        <SelectItem key={urgency} value={urgency}>
                          <div className="flex items-center gap-2">
                            <div className={cn('w-2 h-2 rounded-full', URGENCY_COLORS[urgency])} />
                            {URGENCY_LABELS[urgency]}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {isAdmin && (
                  <div className="space-y-2">
                    <Label>Asignar a</Label>
                    <Select 
                      value={request.assigned_staff_id || 'unassigned'} 
                      onValueChange={handleAssign}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Sin asignar" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Sin asignar</SelectItem>
                        {staffMembers?.map((staff) => (
                          <SelectItem key={staff.id} value={staff.id}>
                            {staff.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Valor Estimado (CLP)</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      placeholder="0"
                      value={estimatedValue}
                      onChange={(e) => setEstimatedValue(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Notas Internas</Label>
                  <Textarea
                    placeholder="Agregar notas..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                  />
                </div>

                <Button onClick={handleSaveNotes} className="w-full">
                  Guardar Cambios
                </Button>
              </div>
            </div>
          </ScrollArea>

          {/* Right Column - Conversation History */}
          <div className="border rounded-lg flex flex-col h-[60vh]">
            <div className="p-3 border-b bg-muted/30">
              <div className="flex items-center gap-2 text-sm font-medium">
                <MessageSquare className="w-4 h-4" />
                Historial de Conversación
              </div>
              {request.conversations?.ai_summary && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {request.conversations.ai_summary}
                </p>
              )}
            </div>
            
            <ScrollArea className="flex-1 p-3">
              {!request.conversation_id ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <FileText className="w-8 h-8 mb-2" />
                  <p className="text-sm">Sin conversación vinculada</p>
                </div>
              ) : messages?.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <MessageSquare className="w-8 h-8 mb-2" />
                  <p className="text-sm">Sin mensajes</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {messages?.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        'max-w-[85%] rounded-lg p-3',
                        msg.direction === 'inbound'
                          ? 'bg-muted mr-auto'
                          : 'bg-primary text-primary-foreground ml-auto'
                      )}
                    >
                      <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                      <p className={cn(
                        'text-xs mt-1',
                        msg.direction === 'inbound' ? 'text-muted-foreground' : 'text-primary-foreground/70'
                      )}>
                        {format(new Date(msg.created_at), 'HH:mm', { locale: es })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
