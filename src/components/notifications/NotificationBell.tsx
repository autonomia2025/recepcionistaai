import { useState } from 'react';
import { Bell, Check, CheckCheck, MessageSquare, X, BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { useNotifications, Notification } from '@/hooks/useNotifications';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

const NotificationItem = ({ 
  notification, 
  onMarkAsRead, 
  onAddNote 
}: { 
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onAddNote: (id: string, notes: string) => Promise<void>;
}) => {
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteText, setNoteText] = useState(notification.notes || '');
  const { toast } = useToast();

  const handleSaveNote = () => {
    onAddNote(notification.id, noteText);
    setShowNoteInput(false);
    toast({
      title: 'Nota guardada',
      description: 'La nota se ha guardado correctamente'
    });
  };

  return (
    <div
      className={cn(
        'p-3 border-b last:border-0 transition-colors',
        !notification.is_read && 'bg-primary/5'
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn(
          'mt-1 h-2 w-2 rounded-full flex-shrink-0',
          !notification.is_read ? 'bg-primary' : 'bg-muted'
        )} />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">{notification.title}</p>
          {notification.message && (
            <p className="text-sm text-muted-foreground mt-1">{notification.message}</p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            {formatDistanceToNow(new Date(notification.created_at), { 
              addSuffix: true, 
              locale: es 
            })}
          </p>

          {notification.notes && !showNoteInput && (
            <div className="mt-2 p-2 bg-muted rounded text-xs">
              <span className="font-medium">Nota:</span> {notification.notes}
            </div>
          )}

          {showNoteInput && (
            <div className="mt-2 space-y-2">
              <Textarea
                placeholder="Escribe una nota..."
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                className="text-sm min-h-[60px]"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveNote}>
                  Guardar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowNoteInput(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {!showNoteInput && (
            <div className="mt-2 flex gap-2">
              {!notification.is_read && (
                <Button 
                  size="sm" 
                  variant="ghost" 
                  className="h-7 text-xs"
                  onClick={() => onMarkAsRead(notification.id)}
                >
                  <Check className="h-3 w-3 mr-1" />
                  Marcar vista
                </Button>
              )}
              <Button 
                size="sm" 
                variant="ghost" 
                className="h-7 text-xs"
                onClick={() => setShowNoteInput(true)}
              >
                <MessageSquare className="h-3 w-3 mr-1" />
                {notification.notes ? 'Editar nota' : 'Agregar nota'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const NotificationBell = () => {
  const { 
    notifications, 
    unreadCount, 
    markAsRead, 
    addNote, 
    markAllAsRead,
    browserNotificationPermission,
    requestBrowserNotificationPermission 
  } = useNotifications();
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const handleEnableNotifications = async () => {
    const granted = await requestBrowserNotificationPermission();
    if (granted) {
      toast({
        title: 'Notificaciones activadas',
        description: 'Recibirás alertas cuando un cliente solicite hablar con un humano',
      });
    } else {
      toast({
        title: 'Notificaciones bloqueadas',
        description: 'Permite las notificaciones en la configuración de tu navegador',
        variant: 'destructive',
      });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between p-3 border-b">
          <h4 className="font-semibold">Notificaciones</h4>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button 
                size="sm" 
                variant="ghost" 
                className="h-7 text-xs"
                onClick={() => markAllAsRead()}
              >
                <CheckCheck className="h-3 w-3 mr-1" />
                Marcar todas
              </Button>
            )}
          </div>
        </div>
        
        {/* Browser Notification Permission Banner */}
        {browserNotificationPermission !== 'granted' && (
          <div className="p-3 bg-primary/5 border-b">
            <div className="flex items-start gap-2">
              <BellRing className="w-4 h-4 text-primary mt-0.5" />
              <div className="flex-1">
                <p className="text-xs font-medium">Activa las notificaciones</p>
                <p className="text-xs text-muted-foreground">
                  Recibe alertas cuando un cliente quiera hablar con un humano
                </p>
                <Button 
                  size="sm" 
                  variant="default"
                  className="h-6 text-xs mt-2"
                  onClick={handleEnableNotifications}
                >
                  Activar notificaciones
                </Button>
              </div>
            </div>
          </div>
        )}
        <ScrollArea className="max-h-[400px]">
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No hay notificaciones</p>
            </div>
          ) : (
            notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onMarkAsRead={markAsRead}
                onAddNote={(id, notes) => addNote({ notificationId: id, notes })}
              />
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};
