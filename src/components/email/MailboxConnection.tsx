import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { AlertTriangle, Loader2, Mail, MoreHorizontal, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useConnectOutlook, useDisconnectMailbox, useMailbox, useSyncMailbox } from '@/hooks/useClientEmail';
import { cn } from '@/lib/utils';

const errorText = (err: unknown) => (err instanceof Error ? err.message : undefined);

const CONNECT_ERRORS: Record<string, string> = {
  denied: 'Cancelaste el permiso en Microsoft.',
  invalid_state: 'El enlace de conexión venció. Inténtalo de nuevo.',
  token: 'Microsoft no entregó el acceso. Inténtalo de nuevo.',
  no_email: 'Esa cuenta de Microsoft no tiene correo.',
};

export function ConnectOutlookButton({ size = 'default', variant = 'default', label = 'Conectar Outlook' }: {
  size?: 'default' | 'sm';
  variant?: 'default' | 'outline';
  label?: string;
}) {
  const connect = useConnectOutlook();
  return (
    <Button size={size} variant={variant} disabled={connect.isPending}
      onClick={() => connect.mutate(undefined, { onError: err => toast.error('No se pudo iniciar la conexión', { description: errorText(err) }) })}>
      {connect.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Mail className="w-4 h-4 mr-1" />}
      {label}
    </Button>
  );
}

// Card for "Mi día": invites to connect, warns when the connection expired,
// or shows the connected mailbox in one line. Also handles the return from
// Microsoft (?mail=connected|error).
export function MailboxConnection() {
  const { data: mailbox, isLoading, error } = useMailbox();
  const sync = useSyncMailbox();
  const disconnect = useDisconnectMailbox();
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    const result = params.get('mail');
    if (!result) return;
    if (result === 'connected') {
      toast.success('Correo conectado', { description: 'Trayendo tus correos con clientes de los últimos 30 días…' });
      sync.mutate();
    } else {
      toast.error('No se pudo conectar tu correo', { description: CONNECT_ERRORS[params.get('reason') ?? ''] ?? 'Inténtalo de nuevo.' });
    }
    const next = new URLSearchParams(params);
    next.delete('mail');
    next.delete('reason');
    setParams(next, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || error) return null;

  const runSync = () => sync.mutate(undefined, {
    onSuccess: result => toast.success(result.stored ? `${result.stored} ${result.stored === 1 ? 'correo nuevo' : 'correos nuevos'} con clientes` : 'Todo al día'),
    onError: err => toast.error('No se pudo actualizar', { description: errorText(err) }),
  });

  if (!mailbox) {
    return (
      <div className="rounded-lg border bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex gap-3 flex-1 min-w-0">
          <Mail className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium">Conecta tu correo de Outlook</p>
            <p className="text-muted-foreground">Envía cotizaciones desde tu propio correo y ve aquí lo que te responden tus clientes. Solo se traen los correos con clientes, nunca el resto de tu bandeja.</p>
          </div>
        </div>
        <ConnectOutlookButton />
      </div>
    );
  }

  if (mailbox.status === 'error') {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex gap-3 flex-1 min-w-0 text-sm">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Tu correo {mailbox.email} se desconectó</p>
            <p className="text-muted-foreground">{mailbox.last_error ?? 'Vuelve a conectarlo para seguir recibiendo las respuestas de tus clientes.'}</p>
          </div>
        </div>
        <ConnectOutlookButton label="Volver a conectar" />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <Mail className="w-4 h-4" />
      <span>Correo conectado: <span className="text-foreground">{mailbox.email}</span></span>
      <span>· {mailbox.last_sync_at ? `actualizado ${formatDistanceToNow(new Date(mailbox.last_sync_at), { addSuffix: true, locale: es })}` : 'sincronizando…'}</span>
      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={runSync} disabled={sync.isPending}>
        <RefreshCw className={cn('w-3.5 h-3.5 mr-1', sync.isPending && 'animate-spin')} /> Actualizar
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Opciones del correo"><MoreHorizontal className="w-4 h-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => disconnect.mutate(undefined, {
            onSuccess: () => toast.success('Correo desconectado', { description: 'Los correos ya traídos se mantienen en las solicitudes.' }),
            onError: err => toast.error('No se pudo desconectar', { description: errorText(err) }),
          })}>
            Desconectar mi correo
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
