import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useGoogleCalendar } from '@/hooks/useGoogleCalendar';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { Calendar, RefreshCw, Unlink, ExternalLink, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export function GoogleCalendarConnect() {
  const {
    isConnected,
    calendarEmail,
    connectedAt,
    isConnecting,
    isDisconnecting,
    isSyncing,
    initiateConnection,
    disconnect,
    syncCalendar
  } = useGoogleCalendar();
  
  const { refetch } = useCalendarEvents();

  const handleSync = async () => {
    await syncCalendar();
    await refetch();
  };

  if (isConnected) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/50">
        <CardHeader className="pb-3 px-3 sm:px-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-600" />
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle className="text-sm sm:text-base">Google Calendar conectado</CardTitle>
                <CardDescription className="text-xs sm:text-sm truncate">
                  {calendarEmail}
                </CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200 self-start sm:self-auto flex-shrink-0">
              Conectado
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="px-3 sm:px-6">
          {connectedAt && (
            <p className="text-xs text-muted-foreground mb-3">
              Conectado el {format(new Date(connectedAt), "d 'de' MMM 'a las' HH:mm", { locale: es })}
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={isSyncing}
              className="w-full sm:w-auto touch-manipulation"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Sincronizando...' : 'Sincronizar'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={disconnect}
              disabled={isDisconnecting}
              className="w-full sm:w-auto text-destructive hover:text-destructive hover:bg-destructive/10 touch-manipulation"
            >
              <Unlink className="h-4 w-4 mr-2" />
              {isDisconnecting ? 'Desconectando...' : 'Desconectar'}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/60 border-border/60">
      <CardHeader className="pb-3 px-3 sm:px-6">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
            <Calendar className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground" />
          </div>
          <div>
            <CardTitle className="text-sm sm:text-base">Conectar Google Calendar</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Sincroniza tus eventos con Google Calendar
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3 sm:px-6">
        <p className="text-xs sm:text-sm text-muted-foreground mb-4">
          Conecta tu calendario de Google para ver tus eventos aquí y sincronizar citas automáticamente.
        </p>
        <Button
          onClick={initiateConnection}
          disabled={isConnecting}
          className="w-full sm:w-auto touch-manipulation"
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          {isConnecting ? 'Conectando...' : 'Conectar con Google'}
        </Button>
      </CardContent>
    </Card>
  );
}
