import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertTriangle,
  BookOpen,
  Building2,
  Clock,
  FileText,
  ImageOff,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useWorkshopFeatures } from '@/hooks/useWorkshopFeatures';
import { useCommercialSettings, type CommercialSettings } from '@/hooks/useCommercialSettings';
import { formatRut, isValidRut } from '@/lib/rut';
import { formatQuoteNumber } from '@/lib/quoteNumber';

type PlaybookDoc = Database['public']['Tables']['sales_playbook_docs']['Row'];

const DAYS = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' },
  { value: 5, label: 'Vie' },
  { value: 6, label: 'Sáb' },
  { value: 7, label: 'Dom' },
];

const TIMEZONES = [
  { value: 'America/Santiago', label: 'Chile continental' },
  { value: 'America/Punta_Arenas', label: 'Magallanes' },
  { value: 'Pacific/Easter', label: 'Isla de Pascua' },
];

const PLAYBOOK_CATEGORIES: Record<string, string> = {
  general: 'General',
  producto: 'Producto',
  objeciones: 'Objeciones',
  competencia: 'Competencia',
  precios: 'Precios',
  servicio: 'Servicio',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

const EDITABLE_FIELDS = [
  'legal_name', 'tax_id', 'address', 'phones', 'email', 'primary_color', 'secondary_color',
  'quote_prefix', 'next_quote_number', 'quote_number_padding', 'quote_number_includes_year',
  'quote_validity_days', 'default_payment_terms', 'default_delivery_terms', 'legal_footer', 'vat_rate',
  'timezone', 'business_days', 'business_opens_at', 'business_closes_at', 'unquoted_lead_alert_hours',
  'discount_approval_threshold', 'lost_reasons',
] as const;

type EditableField = (typeof EDITABLE_FIELDS)[number];
type Draft = Pick<CommercialSettings, EditableField>;

function toDraft(settings: CommercialSettings): Draft {
  const draft = {} as Record<string, unknown>;
  for (const field of EDITABLE_FIELDS) draft[field] = settings[field];
  return {
    ...(draft as Draft),
    business_opens_at: settings.business_opens_at.slice(0, 5),
    business_closes_at: settings.business_closes_at.slice(0, 5),
  };
}

function validate(draft: Draft): string[] {
  const errors: string[] = [];
  if (draft.tax_id && !isValidRut(draft.tax_id)) errors.push('El RUT no es válido: revisa el dígito verificador.');
  if (draft.email && !EMAIL_RE.test(draft.email)) errors.push('El correo no tiene un formato válido.');
  if (!HEX_RE.test(draft.primary_color) || !HEX_RE.test(draft.secondary_color)) {
    errors.push('Los colores deben ser códigos hexadecimales, por ejemplo #1A9387.');
  }
  if (!/^[A-Z0-9]{1,10}$/.test(draft.quote_prefix)) errors.push('El prefijo debe tener de 1 a 10 letras mayúsculas o números.');
  if (!(draft.next_quote_number >= 1)) errors.push('El siguiente número de cotización debe ser 1 o mayor.');
  if (!(draft.quote_validity_days >= 1)) errors.push('La validez de la cotización debe ser de al menos 1 día.');
  if (draft.business_closes_at <= draft.business_opens_at) errors.push('La hora de cierre debe ser posterior a la de apertura.');
  if (draft.business_days.length === 0) errors.push('Selecciona al menos un día hábil.');
  if (draft.lost_reasons.length === 0) errors.push('Deja al menos un motivo de pérdida.');
  return errors;
}

function ChipsInput({ values, onChange, placeholder }: { values: string[]; onChange: (values: string[]) => void; placeholder: string }) {
  const [input, setInput] = useState('');

  const add = () => {
    const additions = input.split(',').map((value) => value.trim()).filter(Boolean);
    if (additions.length === 0) return;
    onChange([...new Set([...values, ...additions])]);
    setInput('');
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => (
          <Badge key={value} variant="secondary" className="gap-1 font-normal">
            {value}
            <button type="button" onClick={() => onChange(values.filter((item) => item !== value))} className="hover:text-destructive" title="Quitar">
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder={placeholder}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={add}>
          Agregar
        </Button>
      </div>
    </div>
  );
}

function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="text-sm">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function LogoField({
  workshopId,
  logoPath,
  onChange,
}: {
  workshopId: string;
  logoPath: string | null;
  onChange: (path: string | null) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);

  const { data: logoUrl } = useQuery({
    queryKey: ['commercial-logo', logoPath],
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('commercial-assets').createSignedUrl(logoPath!, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
    enabled: !!logoPath,
  });

  const upload = async (file: File) => {
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      toast.error('El logo debe ser PNG o JPG');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('El logo no puede superar 2 MB');
      return;
    }
    setBusy(true);
    try {
      const path = `${workshopId}/logo-${Date.now()}.${file.type === 'image/png' ? 'png' : 'jpg'}`;
      const { error } = await supabase.storage.from('commercial-assets').upload(path, file, { contentType: file.type });
      if (error) throw error;
      await onChange(path);
      if (logoPath) await supabase.storage.from('commercial-assets').remove([logoPath]);
      toast.success('Logo actualizado');
    } catch (error) {
      toast.error(`No se pudo subir el logo: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!logoPath) return;
    setBusy(true);
    try {
      await onChange(null);
      await supabase.storage.from('commercial-assets').remove([logoPath]);
      toast.success('Logo quitado: la cotización se generará sin logo');
    } catch (error) {
      toast.error(`No se pudo quitar el logo: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <div className="w-28 h-20 rounded-lg border bg-muted/40 flex items-center justify-center overflow-hidden shrink-0">
        {logoPath && logoUrl ? (
          <img src={logoUrl} alt="Logo de la empresa" className="max-w-full max-h-full object-contain" />
        ) : (
          <ImageOff className="w-6 h-6 text-muted-foreground/50" />
        )}
      </div>
      <div className="space-y-2">
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} asChild>
            <label className="cursor-pointer">
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              {logoPath ? 'Cambiar logo' : 'Subir logo'}
              <input
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) upload(file);
                }}
              />
            </label>
          </Button>
          {logoPath && (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={remove}>
              Quitar
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">PNG o JPG, hasta 2 MB. Sin logo, la cotización muestra la razón social.</p>
      </div>
    </div>
  );
}

function PlaybookTab({ workshopId }: { workshopId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['sales-playbook', workshopId];
  const [editing, setEditing] = useState<{ id?: string; title: string; category: string; content: string } | null>(null);

  const { data: docs = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_playbook_docs')
        .select('*')
        .eq('workshop_id', workshopId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as PlaybookDoc[];
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const saveDoc = useMutation({
    mutationFn: async (doc: { id?: string; title: string; category: string; content: string }) => {
      const payload = { title: doc.title.trim(), category: doc.category, content: doc.content };
      const { error } = doc.id
        ? await supabase.from('sales_playbook_docs').update(payload).eq('id', doc.id)
        : await supabase.from('sales_playbook_docs').insert({ ...payload, workshop_id: workshopId });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setEditing(null);
      toast.success('Documento guardado');
    },
    onError: (error: Error) => toast.error(`No se pudo guardar: ${error.message}`),
  });

  const toggleDoc = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase.from('sales_playbook_docs').update({ is_active: isActive }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteDoc = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('sales_playbook_docs').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Documento eliminado');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Argumentario de ventas</CardTitle>
          <CardDescription>
            Argumentos por producto, respuestas a objeciones y comparaciones con la competencia. El coaching de IA los usa
            para sugerir qué decirle a cada cliente; si está vacío, igual funciona con recomendaciones más generales.
          </CardDescription>
        </div>
        {!editing && (
          <Button size="sm" onClick={() => setEditing({ title: '', category: 'general', content: '' })}>
            <Plus className="w-4 h-4 mr-1.5" />
            Agregar
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {editing && (
          <div className="rounded-xl border border-primary/30 p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Título" className="md:col-span-2">
                <Input
                  value={editing.title}
                  placeholder="Ej: Por qué agua caliente para grasa"
                  onChange={(event) => setEditing({ ...editing, title: event.target.value })}
                />
              </Field>
              <Field label="Categoría">
                <Select value={editing.category} onValueChange={(category) => setEditing({ ...editing, category })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PLAYBOOK_CATEGORIES).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Contenido">
              <Textarea
                rows={8}
                value={editing.content}
                placeholder="Pega aquí el texto del argumento, la objeción y su respuesta, o la comparación."
                onChange={(event) => setEditing({ ...editing, content: event.target.value })}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button size="sm" onClick={() => saveDoc.mutate(editing)} disabled={saveDoc.isPending || !editing.title.trim()}>
                {saveDoc.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Guardar documento
              </Button>
            </div>
          </div>
        )}

        {isLoading && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Cargando argumentario...
          </p>
        )}

        {!isLoading && docs.length === 0 && !editing && (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <BookOpen className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Todavía no hay documentos en el argumentario.</p>
          </div>
        )}

        {docs.map((doc) => (
          <div key={doc.id} className={cn('rounded-xl border p-3 flex items-start gap-3', !doc.is_active && 'opacity-60')}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{doc.title}</span>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {PLAYBOOK_CATEGORIES[doc.category] ?? doc.category}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{doc.content || 'Sin contenido'}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Switch
                checked={doc.is_active}
                onCheckedChange={(checked) => toggleDoc.mutate({ id: doc.id, isActive: checked })}
                title={doc.is_active ? 'Lo usa el coaching' : 'El coaching lo ignora'}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setEditing({ id: doc.id, title: doc.title, category: doc.category, content: doc.content })}
                title="Editar"
              >
                <Pencil className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:text-destructive"
                onClick={() => {
                  if (confirm(`¿Eliminar "${doc.title}" del argumentario?`)) deleteDoc.mutate(doc.id);
                }}
                title="Eliminar"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function CommercialSettingsPage() {
  const { features, isLoading: featuresLoading } = useWorkshopFeatures();
  const { settings, isLoading, error, update, workshopId } = useCommercialSettings();
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (settings && !draft) setDraft(toDraft(settings));
  }, [settings, draft]);

  const baseline = useMemo(() => (settings ? toDraft(settings) : null), [settings]);
  const isDirty = !!draft && !!baseline && JSON.stringify(draft) !== JSON.stringify(baseline);
  const errors = draft ? validate(draft) : [];

  const set = <K extends EditableField>(field: K, value: Draft[K]) =>
    setDraft((previous) => (previous ? { ...previous, [field]: value } : previous));

  const save = async () => {
    if (!draft) return;
    if (errors.length > 0) {
      toast.error(errors[0]);
      return;
    }
    try {
      const saved = await update.mutateAsync({
        ...draft,
        legal_name: draft.legal_name?.trim() || null,
        tax_id: draft.tax_id ? formatRut(draft.tax_id) : null,
        address: draft.address?.trim() || null,
        email: draft.email?.trim() || null,
      });
      setDraft(toDraft(saved));
      toast.success('Configuración comercial guardada');
    } catch (saveError) {
      toast.error(`No se pudo guardar: ${(saveError as Error).message}`);
    }
  };

  if (featuresLoading || (features.commercial && isLoading)) {
    return (
      <div className="page-shell flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Cargando configuración comercial...
      </div>
    );
  }

  if (!features.commercial) {
    return (
      <div className="page-shell page-stack">
        <PageHeader title="Configuración comercial" />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            El módulo comercial no está activo para este negocio.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !draft || !workshopId) {
    return (
      <div className="page-shell page-stack">
        <PageHeader title="Configuración comercial" />
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">
            No se pudo cargar la configuración{error ? `: ${(error as Error).message}` : ''}.
          </CardContent>
        </Card>
      </div>
    );
  }

  const quotePreview = formatQuoteNumber(
    { prefix: draft.quote_prefix || 'COT', padding: draft.quote_number_padding, includesYear: draft.quote_number_includes_year },
    draft.next_quote_number,
  );
  const rutInvalid = !!draft.tax_id && !isValidRut(draft.tax_id);

  return (
    <div className="page-shell page-stack">
      <PageHeader
        title="Configuración comercial"
        description="Datos y reglas que usan las cotizaciones, las alertas y el coaching de ventas."
        actions={
          <Button onClick={save} disabled={!isDirty || update.isPending}>
            {update.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Guardar cambios
          </Button>
        }
      />

      {isDirty && errors.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200 flex gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <ul className="space-y-0.5">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      <Tabs defaultValue="identidad" className="w-full">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="identidad" className="gap-2">
            <Building2 className="w-4 h-4" />
            Identidad
          </TabsTrigger>
          <TabsTrigger value="cotizaciones" className="gap-2">
            <FileText className="w-4 h-4" />
            Cotizaciones
          </TabsTrigger>
          <TabsTrigger value="operacion" className="gap-2">
            <Clock className="w-4 h-4" />
            Operación
          </TabsTrigger>
          <TabsTrigger value="argumentario" className="gap-2">
            <BookOpen className="w-4 h-4" />
            Argumentario
          </TabsTrigger>
        </TabsList>

        <TabsContent value="identidad" className="mt-6 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Datos de la empresa</CardTitle>
              <CardDescription>Aparecen en el encabezado de cada cotización. Lo que quede vacío no se imprime.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Razón social">
                <Input value={draft.legal_name ?? ''} onChange={(event) => set('legal_name', event.target.value)} />
              </Field>
              <Field label="RUT" hint={rutInvalid ? 'Dígito verificador incorrecto' : 'Ej: 76.123.456-7'}>
                <Input
                  value={draft.tax_id ?? ''}
                  className={cn(rutInvalid && 'border-destructive focus-visible:ring-destructive')}
                  onChange={(event) => set('tax_id', event.target.value)}
                  onBlur={() => draft.tax_id && isValidRut(draft.tax_id) && set('tax_id', formatRut(draft.tax_id))}
                />
              </Field>
              <Field label="Dirección" className="md:col-span-2">
                <Input value={draft.address ?? ''} onChange={(event) => set('address', event.target.value)} />
              </Field>
              <Field label="Correo de contacto">
                <Input type="email" value={draft.email ?? ''} onChange={(event) => set('email', event.target.value)} />
              </Field>
              <Field label="Teléfonos">
                <ChipsInput values={draft.phones} onChange={(phones) => set('phones', phones)} placeholder="+56 9 1234 5678 y Enter" />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Marca en la cotización</CardTitle>
              <CardDescription>El logo se guarda al subirlo. Los colores se guardan con el resto de los cambios.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <Field label="Logo">
                  <LogoField
                    workshopId={workshopId}
                    logoPath={settings?.logo_path ?? null}
                    onChange={(path) => update.mutateAsync({ logo_path: path })}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  {(['primary_color', 'secondary_color'] as const).map((field) => (
                    <Field key={field} label={field === 'primary_color' ? 'Color principal' : 'Color secundario'}>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          value={HEX_RE.test(draft[field]) ? draft[field] : '#000000'}
                          onChange={(event) => set(field, event.target.value.toUpperCase())}
                          className="h-9 w-12 rounded-md border cursor-pointer bg-transparent"
                        />
                        <Input
                          value={draft[field]}
                          onChange={(event) => set(field, event.target.value)}
                          className="font-mono uppercase"
                        />
                      </div>
                    </Field>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border overflow-hidden bg-background text-xs">
                <div className="h-2" style={{ backgroundColor: HEX_RE.test(draft.primary_color) ? draft.primary_color : undefined }} />
                <div className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-sm">{draft.legal_name || 'Razón social'}</p>
                      <p className="text-muted-foreground">{draft.tax_id ? `RUT ${draft.tax_id}` : 'RUT sin definir'}</p>
                      <p className="text-muted-foreground">{draft.address || 'Dirección'}</p>
                    </div>
                    <div className="text-right">
                      <p className="uppercase tracking-wide text-muted-foreground">Cotización</p>
                      <p className="font-mono font-semibold" style={{ color: HEX_RE.test(draft.secondary_color) ? draft.secondary_color : undefined }}>
                        {quotePreview}
                      </p>
                    </div>
                  </div>
                  <div className="h-px" style={{ backgroundColor: HEX_RE.test(draft.secondary_color) ? draft.secondary_color : undefined }} />
                  <p className="text-muted-foreground">Vista previa del encabezado</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cotizaciones" className="mt-6 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Numeración</CardTitle>
              <CardDescription>
                La próxima cotización saldrá como <span className="font-mono font-semibold text-foreground">{quotePreview}</span>.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Field label="Prefijo">
                <Input
                  value={draft.quote_prefix}
                  maxLength={10}
                  className="font-mono uppercase"
                  onChange={(event) => set('quote_prefix', event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                />
              </Field>
              <Field label="Siguiente número">
                <Input
                  type="number"
                  min={1}
                  value={draft.next_quote_number}
                  onChange={(event) => set('next_quote_number', Number(event.target.value))}
                />
              </Field>
              <Field label="Dígitos del correlativo">
                <Select value={String(draft.quote_number_padding)} onValueChange={(value) => set('quote_number_padding', Number(value))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[3, 4, 5, 6].map((digits) => (
                      <SelectItem key={digits} value={String(digits)}>{digits} dígitos</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Incluir año">
                <div className="h-9 flex items-center">
                  <Switch
                    checked={draft.quote_number_includes_year}
                    onCheckedChange={(checked) => set('quote_number_includes_year', checked)}
                  />
                </div>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Condiciones por defecto</CardTitle>
              <CardDescription>El vendedor puede cambiarlas en cada cotización; estas son las que vienen precargadas.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Validez (días)">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={draft.quote_validity_days}
                  onChange={(event) => set('quote_validity_days', Number(event.target.value))}
                />
              </Field>
              <Field label="IVA (%)">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={draft.vat_rate}
                  onChange={(event) => set('vat_rate', Number(event.target.value))}
                />
              </Field>
              <Field label="Forma de pago">
                <Input value={draft.default_payment_terms} onChange={(event) => set('default_payment_terms', event.target.value)} />
              </Field>
              <Field label="Plazo de entrega">
                <Input value={draft.default_delivery_terms} onChange={(event) => set('default_delivery_terms', event.target.value)} />
              </Field>
              <Field label="Texto legal al pie" className="md:col-span-2">
                <Textarea rows={4} value={draft.legal_footer} onChange={(event) => set('legal_footer', event.target.value)} />
              </Field>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="operacion" className="mt-6 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Horario de atención</CardTitle>
              <CardDescription>Define qué cuenta como "fuera de horario" en las métricas y cuándo corren los plazos de alerta.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label="Zona horaria">
                  <Select value={draft.timezone} onValueChange={(value) => set('timezone', value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map((zone) => (
                        <SelectItem key={zone.value} value={zone.value}>{zone.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Abre">
                  <Input type="time" value={draft.business_opens_at} onChange={(event) => set('business_opens_at', event.target.value)} />
                </Field>
                <Field label="Cierra">
                  <Input type="time" value={draft.business_closes_at} onChange={(event) => set('business_closes_at', event.target.value)} />
                </Field>
              </div>
              <Field label="Días hábiles">
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((day) => {
                    const selected = draft.business_days.includes(day.value);
                    return (
                      <Button
                        key={day.value}
                        type="button"
                        size="sm"
                        variant={selected ? 'default' : 'outline'}
                        className="w-14"
                        onClick={() =>
                          set(
                            'business_days',
                            selected
                              ? draft.business_days.filter((value) => value !== day.value)
                              : [...draft.business_days, day.value].sort((a, b) => a - b),
                          )
                        }
                      >
                        {day.label}
                      </Button>
                    );
                  })}
                </div>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Alertas y aprobaciones</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Alertar lead sin cotizar después de (horas)" hint="El admin recibe el aviso cuando una solicitud supera este plazo.">
                <Input
                  type="number"
                  min={1}
                  value={draft.unquoted_lead_alert_hours}
                  onChange={(event) => set('unquoted_lead_alert_hours', Number(event.target.value))}
                />
              </Field>
              <Field label="Descuento que requiere aprobación (%)" hint="Descuentos por encima de este valor quedan pendientes de aprobación del admin.">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={draft.discount_approval_threshold}
                  onChange={(event) => set('discount_approval_threshold', Number(event.target.value))}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Motivos de pérdida</CardTitle>
              <CardDescription>Las opciones que ve el vendedor al marcar una venta como perdida.</CardDescription>
            </CardHeader>
            <CardContent>
              <ChipsInput values={draft.lost_reasons} onChange={(reasons) => set('lost_reasons', reasons)} placeholder="Nuevo motivo y Enter" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="argumentario" className="mt-6">
          <PlaybookTab workshopId={workshopId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
