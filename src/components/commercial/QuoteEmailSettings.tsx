import { useState } from 'react';
import { CheckCircle2, Circle, Copy, Loader2, Mail, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { type DomainRecord, type EmailDomain, useEmailDomain, useEmailDomainAction } from '@/hooks/useQuoteEmail';
import { cn } from '@/lib/utils';

const STATUS: Record<string, { label: string; className: string }> = {
  verified: { label: 'Listo', className: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
  not_started: { label: 'Esperando los registros', className: 'border-amber-300 bg-amber-50 text-amber-800' },
  pending: { label: 'Comprobando…', className: 'border-sky-300 bg-sky-50 text-sky-800' },
  partially_verified: { label: 'Casi listo', className: 'border-sky-300 bg-sky-50 text-sky-800' },
  partially_failed: { label: 'Falta un registro', className: 'border-amber-300 bg-amber-50 text-amber-800' },
  failed: { label: 'No se encontraron los registros', className: 'border-red-300 bg-red-50 text-red-700' },
  temporary_failure: { label: 'Un registro desapareció', className: 'border-red-300 bg-red-50 text-red-700' },
};

const errorText = (err: unknown) => (err instanceof Error ? err.message : undefined);

async function copy(text: string, what = 'Copiado') {
  try { await navigator.clipboard.writeText(text); toast.success(what); }
  catch { toast.error('No se pudo copiar; selecciónalo y cópialo a mano'); }
}

// Ready-to-send message for whoever manages the business's domain.
function providerMessage(domain: EmailDomain): string {
  const root = domain.domain.split('.').slice(-2).join('.');
  const lines = domain.records.map((r, i) =>
    `${i + 1}) Tipo ${r.type} · Nombre: ${r.host} · Valor: ${r.value}${r.priority != null ? ` · Prioridad: ${r.priority}` : ''}`);
  return [
    `Hola, necesitamos agregar estos registros DNS en el dominio ${root} para enviar cotizaciones desde ${domain.domain}.`,
    `Son solo para el subdominio ${domain.domain}: no cambian el correo actual de @${root}.`,
    '',
    ...lines,
    '',
    'Si el panel pide el nombre sin el dominio, usar solo la parte antes de ' + `.${root}` + '.',
    '¡Gracias!',
  ].join('\n');
}

function RecordRow({ record }: { record: DomainRecord }) {
  const ok = record.status === 'verified';
  return (
    <li className="p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <Circle className="w-4 h-4 text-muted-foreground" />}
        <Badge variant="outline" className="font-mono text-[11px]">{record.type}</Badge>
        {record.priority != null && <span className="text-xs text-muted-foreground">prioridad {record.priority}</span>}
        <span className="ml-auto text-xs text-muted-foreground">{ok ? 'Encontrado' : 'Pendiente'}</span>
      </div>
      {([['Nombre', record.host], ['Valor', record.value]] as const).map(([label, value]) => (
        <div key={label} className="flex items-start gap-2">
          <span className="w-14 flex-shrink-0 pt-1.5 text-xs text-muted-foreground">{label}</span>
          <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1.5 text-xs">{value}</code>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" aria-label={`Copiar ${label.toLowerCase()}`}
            onClick={() => copy(value, `${label} copiado`)}>
            <Copy className="w-4 h-4" />
          </Button>
        </div>
      ))}
    </li>
  );
}

export function QuoteEmailSettings({ companyName }: { companyName: string | null }) {
  const { profile } = useAuth();
  const { data: domain, isLoading } = useEmailDomain();
  const action = useEmailDomainAction();
  const [editing, setEditing] = useState(false);
  const [domainInput, setDomainInput] = useState('');
  const [localInput, setLocalInput] = useState('cotizaciones');

  const canManage = profile?.role === 'ADMIN' || profile?.role === 'SUPERADMIN';
  const showForm = canManage && (!domain || editing);
  const status = STATUS[domain?.status ?? 'not_started'] ?? STATUS.not_started;
  const previewDomain = domainInput.trim().toLowerCase() || 'cotizaciones.tuempresa.cl';
  const previewFrom = `${profile?.full_name || 'Nombre del vendedor'}${companyName ? ` · ${companyName}` : ''} <${localInput || 'cotizaciones'}@${previewDomain}>`;

  const run = async (body: Parameters<typeof action.mutateAsync>[0], success?: string) => {
    try {
      const result = await action.mutateAsync(body);
      if (result.warning) toast.warning(result.warning);
      else if (success) toast.success(success);
      setEditing(false);
      return result;
    } catch (err) {
      toast.error('No se pudo completar', { description: errorText(err) });
      return null;
    }
  };

  const check = async () => {
    const result = await run({ action: 'verify' });
    if (result?.domain?.status === 'verified') toast.success('¡Listo! Ya se pueden enviar cotizaciones por correo.');
    else if (result) toast.message('Todavía no aparecen todos los registros', { description: 'Pueden tardar desde minutos hasta 24 horas. Vuelve a comprobar más tarde.' });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base flex items-center gap-2"><Mail className="w-4 h-4" /> Enviar cotizaciones por correo</CardTitle>
          {domain && <Badge variant="outline" className={cn('text-[11px]', status.className)}>{status.label}</Badge>}
        </div>
        <CardDescription>
          Los vendedores envían la cotización desde el panel y las respuestas del cliente vuelven a la solicitud.
          Los correos salen desde un subdominio de tu empresa (por ejemplo cotizaciones.soc.cl); el correo que ya usan no se toca.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {isLoading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</p>
        ) : showForm ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="mail-domain">Subdominio para las cotizaciones</Label>
                <Input id="mail-domain" placeholder="cotizaciones.soc.cl" value={domainInput} autoComplete="off"
                  onChange={event => setDomainInput(event.target.value)} />
                <p className="text-xs text-muted-foreground">Usa un subdominio (algo.tuempresa.cl), no el dominio principal.</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="mail-local">Dirección que ve el cliente</Label>
                <div className="flex items-center gap-1">
                  <Input id="mail-local" value={localInput} autoComplete="off" className="max-w-[12rem]"
                    onChange={event => setLocalInput(event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))} />
                  <span className="text-sm text-muted-foreground truncate">@{previewDomain}</span>
                </div>
              </div>
            </div>
            <p className="text-sm rounded-md bg-muted px-3 py-2">
              <span className="text-muted-foreground">El cliente verá: </span>{previewFrom}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => run({ action: 'setup', domain: domainInput, sender_local: localInput }, 'Registros preparados')}
                disabled={!domainInput.trim() || !localInput || action.isPending}>
                {action.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Preparar registros
              </Button>
              {editing && <Button variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>}
            </div>
          </div>
        ) : !domain ? (
          <p className="text-sm text-muted-foreground">Un administrador debe configurar el correo de cotizaciones.</p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">
              Los clientes reciben las cotizaciones desde <span className="font-medium">{domain.sender_local}@{domain.domain}</span>
              {domain.status === 'verified' ? ' y sus respuestas llegan al panel.' : '.'}
            </p>

            {domain.status === 'verified' ? (
              <p className="text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Todo listo. En cada cotización oficial aparece el botón "Enviar por correo".
              </p>
            ) : (
              <div className="space-y-3">
                <div className="text-sm space-y-1">
                  <p className="font-medium">Falta un paso: agregar estos registros en el dominio</p>
                  <p className="text-muted-foreground">
                    Pídeselo a quien administra el dominio de la empresa (quien hizo la página web o el proveedor del dominio, por ejemplo NIC Chile, GoDaddy o Cloudflare).
                    Con el botón "Copiar mensaje" les mandas todo listo.
                  </p>
                </div>
                <ul className="rounded-lg border divide-y">
                  {domain.records.map(record => <RecordRow key={`${record.type}-${record.host}-${record.value}`} record={record} />)}
                </ul>
                <p className="text-xs text-muted-foreground">Cuando los agreguen, pueden tardar desde minutos hasta 24 horas en aparecer.</p>
              </div>
            )}

            {canManage && (
              <div className="flex flex-wrap gap-2">
                {domain.status !== 'verified' && (
                  <>
                    <Button variant="outline" onClick={() => copy(providerMessage(domain), 'Mensaje copiado: pégalo en un correo o WhatsApp')}>
                      <Copy className="w-4 h-4 mr-1" /> Copiar mensaje para el proveedor
                    </Button>
                    <Button onClick={check} disabled={action.isPending}>
                      {action.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                      Comprobar ahora
                    </Button>
                  </>
                )}
                <Button variant="ghost" onClick={() => { setDomainInput(domain.domain); setLocalInput(domain.sender_local); setEditing(true); }}>
                  Cambiar dirección
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
