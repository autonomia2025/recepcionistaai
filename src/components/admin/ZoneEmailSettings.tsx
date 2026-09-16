import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Loader2, MapPin, Plus, X, ArrowUp, ArrowDown, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useWorkshopFeatures } from '@/hooks/useWorkshopFeatures';
import {
  useWorkshopZones,
  zoneDotClass,
  ZONE_COLOR_LABELS,
  ZONE_COLOR_TOKENS,
  type WorkshopZone,
} from '@/hooks/useWorkshopZones';

interface ZoneEmailSettingsProps {
  workshopId: string;
}

const slugify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

export function ZoneEmailSettings({ workshopId }: ZoneEmailSettingsProps) {
  const queryClient = useQueryClient();
  const { features, isLoading: featuresLoading } = useWorkshopFeatures(workshopId);
  const { zones, isLoading: zonesLoading } = useWorkshopZones(workshopId, { includeInactive: true });

  const [drafts, setDrafts] = useState<Record<string, Partial<WorkshopZone>>>({});
  const [aliasInputs, setAliasInputs] = useState<Record<string, string>>({});
  const [openZone, setOpenZone] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['workshop-zones', workshopId] });

  const valueOf = <K extends keyof WorkshopZone>(zone: WorkshopZone, field: K): WorkshopZone[K] =>
    (drafts[zone.id]?.[field] ?? zone[field]) as WorkshopZone[K];

  const setDraft = (zoneId: string, field: keyof WorkshopZone, value: unknown) =>
    setDrafts((prev) => ({ ...prev, [zoneId]: { ...prev[zoneId], [field]: value } }));

  const discard = (zoneId: string) =>
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[zoneId];
      return next;
    });

  const saveMutation = useMutation({
    mutationFn: async (zone: WorkshopZone) => {
      const draft = drafts[zone.id] ?? {};
      const label = (draft.label ?? zone.label).trim();
      if (!label) throw new Error('La zona necesita un nombre');
      const { error } = await supabase
        .from('workshop_zones')
        .update({
          label,
          color: draft.color ?? zone.color,
          notification_email: ((draft.notification_email ?? zone.notification_email) || '').trim() || null,
          aliases: (draft.aliases ?? zone.aliases) as string[],
        })
        .eq('id', zone.id);
      if (error) throw error;
    },
    onSuccess: (_, zone) => {
      discard(zone.id);
      invalidate();
      toast.success('Zona guardada');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ zone, isActive }: { zone: WorkshopZone; isActive: boolean }) => {
      const { error } = await supabase.from('workshop_zones').update({ is_active: isActive }).eq('id', zone.id);
      if (error) throw error;
    },
    onSuccess: (_, { isActive }) => {
      invalidate();
      toast.success(isActive ? 'Zona activada' : 'Zona desactivada');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const moveMutation = useMutation({
    mutationFn: async ({ zone, neighbour }: { zone: WorkshopZone; neighbour: WorkshopZone }) => {
      const [moved, swapped] = await Promise.all([
        supabase.from('workshop_zones').update({ sort_order: neighbour.sort_order }).eq('id', zone.id),
        supabase.from('workshop_zones').update({ sort_order: zone.sort_order }).eq('id', neighbour.id),
      ]);
      if (moved.error) throw moved.error;
      if (swapped.error) throw swapped.error;
    },
    onSuccess: () => invalidate(),
    onError: (error: Error) => toast.error(error.message),
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const label = newLabel.trim();
      const key = slugify(label);
      if (!label || !key) throw new Error('Escribe un nombre de zona válido');
      if (zones.some((zone) => zone.key === key)) throw new Error('Ya existe una zona con ese nombre');
      const { error } = await supabase.from('workshop_zones').insert({
        workshop_id: workshopId,
        key,
        label,
        color: ZONE_COLOR_TOKENS[zones.length % ZONE_COLOR_TOKENS.length],
        sort_order: zones.length + 1,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewLabel('');
      invalidate();
      toast.success('Zona creada');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const addAlias = (zone: WorkshopZone) => {
    const raw = aliasInputs[zone.id] ?? '';
    const additions = raw.split(',').map((alias) => alias.trim().toLowerCase()).filter(Boolean);
    if (additions.length === 0) return;
    const current = (valueOf(zone, 'aliases') ?? []) as string[];
    setDraft(zone.id, 'aliases', [...new Set([...current, ...additions])]);
    setAliasInputs((prev) => ({ ...prev, [zone.id]: '' }));
  };

  const removeAlias = (zone: WorkshopZone, alias: string) => {
    const current = (valueOf(zone, 'aliases') ?? []) as string[];
    setDraft(zone.id, 'aliases', current.filter((item) => item !== alias));
  };

  if (featuresLoading || !features.zones) return null;

  return (
    <Card className="bg-background/80">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-primary/10 shrink-0">
            <MapPin className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base">Zonas de atención</CardTitle>
            <CardDescription>
              El bot asigna la zona del cliente según las comunas que definas aquí, y avisa al correo de esa zona.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {zonesLoading && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Cargando zonas...
          </p>
        )}

        {!zonesLoading && zones.length === 0 && (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <MapPin className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Todavía no hay zonas configuradas.</p>
            <p className="text-xs text-muted-foreground/70">Agrega la primera abajo.</p>
          </div>
        )}

        {zones.map((zone, index) => {
          const aliases = (valueOf(zone, 'aliases') ?? []) as string[];
          const email = (valueOf(zone, 'notification_email') ?? '') as string;
          const isDirty = !!drafts[zone.id];
          const isOpen = openZone === zone.id;

          return (
            <Collapsible
              key={zone.id}
              open={isOpen}
              onOpenChange={(open) => setOpenZone(open ? zone.id : null)}
              className={cn('rounded-xl border transition-colors', !zone.is_active && 'opacity-60', isDirty && 'border-primary/40')}
            >
              <div className="flex items-center gap-3 p-3">
                <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', zoneDotClass(valueOf(zone, 'color')))} />

                <CollapsibleTrigger className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate">{valueOf(zone, 'label')}</span>
                    {isDirty && (
                      <Badge variant="outline" className="text-[10px] border-primary/40 text-primary shrink-0">
                        sin guardar
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    <code className="bg-muted px-1 py-0.5 rounded mr-1.5">{zone.key}</code>
                    {aliases.length} {aliases.length === 1 ? 'comuna' : 'comunas'}
                    {email ? ` · avisa a ${email}` : ' · sin correo de alertas'}
                  </p>
                </CollapsibleTrigger>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={index === 0 || moveMutation.isPending}
                    onClick={() => moveMutation.mutate({ zone, neighbour: zones[index - 1] })}
                    title="Subir"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={index === zones.length - 1 || moveMutation.isPending}
                    onClick={() => moveMutation.mutate({ zone, neighbour: zones[index + 1] })}
                    title="Bajar"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </Button>
                  <Switch
                    checked={zone.is_active}
                    onCheckedChange={(checked) => toggleActiveMutation.mutate({ zone, isActive: checked })}
                    title={zone.is_active ? 'Activa' : 'Inactiva'}
                  />
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <ChevronDown className={cn('w-4 h-4 transition-transform', isOpen && 'rotate-180')} />
                    </Button>
                  </CollapsibleTrigger>
                </div>
              </div>

              <CollapsibleContent>
                <div className="px-3 pb-3 space-y-4 border-t pt-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`zone-label-${zone.id}`} className="text-xs text-muted-foreground">Nombre</Label>
                      <Input
                        id={`zone-label-${zone.id}`}
                        value={valueOf(zone, 'label')}
                        onChange={(event) => setDraft(zone.id, 'label', event.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`zone-email-${zone.id}`} className="text-xs text-muted-foreground">
                        <Mail className="w-3 h-3 inline mr-1" />
                        Correo de alertas
                      </Label>
                      <Input
                        id={`zone-email-${zone.id}`}
                        type="email"
                        placeholder="alertas@empresa.cl"
                        value={email}
                        onChange={(event) => setDraft(zone.id, 'notification_email', event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Color</Label>
                    <div className="flex flex-wrap gap-2">
                      {ZONE_COLOR_TOKENS.map((token) => (
                        <button
                          key={token}
                          type="button"
                          title={ZONE_COLOR_LABELS[token]}
                          onClick={() => setDraft(zone.id, 'color', token)}
                          className={cn(
                            'w-6 h-6 rounded-full transition-all',
                            zoneDotClass(token),
                            valueOf(zone, 'color') === token
                              ? 'ring-2 ring-offset-2 ring-foreground/40 scale-110'
                              : 'opacity-60 hover:opacity-100',
                          )}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`zone-alias-${zone.id}`} className="text-xs text-muted-foreground">
                      Comunas y ciudades que identifican la zona
                    </Label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {aliases.length === 0 && (
                        <span className="text-xs text-muted-foreground/70">
                          Sin comunas: el bot no podrá asignar esta zona automáticamente.
                        </span>
                      )}
                      {aliases.map((alias) => (
                        <Badge key={alias} variant="secondary" className="gap-1 font-normal">
                          {alias}
                          <button
                            type="button"
                            onClick={() => removeAlias(zone, alias)}
                            className="hover:text-destructive"
                            title="Quitar"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        id={`zone-alias-${zone.id}`}
                        placeholder="Agregar comuna y presionar Enter"
                        value={aliasInputs[zone.id] ?? ''}
                        onChange={(event) => setAliasInputs((prev) => ({ ...prev, [zone.id]: event.target.value }))}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            addAlias(zone);
                          }
                        }}
                      />
                      <Button variant="outline" size="sm" onClick={() => addAlias(zone)}>
                        Agregar
                      </Button>
                    </div>
                  </div>

                  {isDirty && (
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <Button variant="ghost" size="sm" onClick={() => discard(zone.id)}>
                        Descartar
                      </Button>
                      <Button size="sm" onClick={() => saveMutation.mutate(zone)} disabled={saveMutation.isPending}>
                        {saveMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
                        Guardar cambios
                      </Button>
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}

        <div className="flex items-end gap-2 pt-1">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="new-zone" className="text-xs text-muted-foreground">Agregar zona</Label>
            <Input
              id="new-zone"
              placeholder="Ej: Concepción"
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addMutation.mutate();
                }
              }}
            />
          </div>
          <Button size="sm" onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !newLabel.trim()}>
            <Plus className="w-4 h-4 mr-1.5" />
            Agregar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
