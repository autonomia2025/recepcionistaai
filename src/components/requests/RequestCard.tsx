import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { User, Clock, MapPin, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { 
  ServiceRequest, 
  STATUS_LABELS, 
  STATUS_COLORS, 
  URGENCY_LABELS, 
  URGENCY_COLORS 
} from '@/hooks/useServiceRequests';

interface RequestCardProps {
  request: ServiceRequest;
  onClick: () => void;
}

export function RequestCard({ request, onClick }: RequestCardProps) {
  const timeAgo = formatDistanceToNow(new Date(request.created_at), {
    addSuffix: true,
    locale: es,
  });

  return (
    <Card 
      className="cursor-pointer transition-all border-l-4 border-border/50 bg-background/80 hover:shadow-lg"
      style={{ borderLeftColor: `var(--${request.urgency === 'high' ? 'destructive' : request.urgency === 'medium' ? 'warning' : 'muted-foreground'})` }}
      onClick={onClick}
    >
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                {request.contacts?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'NA'}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium text-sm">{request.contacts?.name || 'Sin nombre'}</p>
              <p className="text-xs text-muted-foreground">{request.contacts?.phone}</p>
            </div>
          </div>
          <Badge 
            variant="secondary" 
            className={cn('text-white text-xs', URGENCY_COLORS[request.urgency])}
          >
            {URGENCY_LABELS[request.urgency]}
          </Badge>
        </div>

        {/* Service Category */}
        <div>
          <p className="text-sm font-medium text-foreground">{request.service_category}</p>
          {request.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
              {request.description}
            </p>
          )}
        </div>

        {/* Location */}
        {(request.address || request.comuna) && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="w-3 h-3" />
            <span className="truncate">
              {[request.address, request.comuna].filter(Boolean).join(', ')}
            </span>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-border/50">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>{timeAgo}</span>
          </div>
          
          {request.assigned_staff ? (
            <div className="flex items-center gap-1 text-xs">
              <User className="w-3 h-3 text-muted-foreground" />
              <span className="text-muted-foreground">
                {request.assigned_staff.full_name.split(' ')[0]}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-xs text-orange-500">
              <AlertCircle className="w-3 h-3" />
              <span>Sin asignar</span>
            </div>
          )}
        </div>

        {/* Estimated Value */}
        {request.estimated_value && (
          <div className="text-xs font-medium text-emerald-600">
            Valor estimado: ${request.estimated_value.toLocaleString('es-CL')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
