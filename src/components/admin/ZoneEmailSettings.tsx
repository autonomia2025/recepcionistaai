import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MapPin, Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
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
  const zonesEnabled = features.zones;
  const { zones, isLoading: zonesLoading } = useWorkshopZones(workshopId, { includeInactive: true });

  const [drafts, setDrafts] = useState<Record<string, Partial<WorkshopZone>>>({});
  const [newLabel, setNewLabel] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['workshop-zones', workshopId] });

  const valueOf = <K extends keyof WorkshopZone>(zone: WorkshopZone, field: K): WorkshopZone[K] =>
    (drafts[zone.id]?.[field] ?? zone[field]) as WorkshopZone[K];

  const setDraft = (zoneId: string, field: keyof WorkshopZone, value: unknown) =>
    setDrafts((prev) => ({ ...prev, [zoneId]: { ...prev[zoneId], [field]: value } }));

  const saveMutation = useMutation({
    mutationFn: async (zone: WorkshopZone) => {
      const draft = drafts[zone.id] ?? {};
      const { error } = await supabase
        .from('workshop_zones')
        .update({
          label: (draft.label ?? zone.label).trim(),
          color: draft.color ?? zone.color,
          notification_email: ((draft.notification_email ?? zone.notification_email) || '').trim() || null,
          aliases: (draft.aliases ?? zone.aliases) as string[],
          sort_order: Number(draft.sort_order ?? zone.sort_order),
        })
        .eq('id', zone.id);
      if (error) throw error;
    },
    onSuccess: (_, zone) => {
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[zone.id];
        return next;
      });
      invalidate();
      toast.success('Zona guardada');
    },
    onError: (error: Error) => toast.error(`Error al guardar la zona: ${error.message}`),
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
    onError: (error: Error) => toast.error(`Error al cambiar la zona: ${error.message}`),
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const label = newLabel.trim();
      const key = slugify(label);
      if (!label || !key) throw new Error('Escribe un nombre de zona válido');
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
    onError: (error: Error) => toast.error(`Error al crear la zona: ${error.message}`),
  });

  if (featuresLoading || !zonesEnabled) return null;

  return (
    <Card className="border-2 border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <MapPin className="w-5 h-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base">Zonas de atención</CardTitle>
            <CardDescription>
              Define las zonas, su correo de alertas y las comunas que las identifican. El bot usa estas comunas para asignar la zona del cliente.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {zonesLoading && <p className="text-sm text-muted-foreground">Cargando zonas...</p>}

        {!zonesLoading && zones.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Todavía no hay zonas configuradas. Agrega la primera abajo.
          </p>
        )}

        {zones.map((zone) => (
          <div key={zone.id} className="space-y-3 rounded-lg border p-3 bg-muted/30">
            <div className="flex flex-wrap items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${zoneDotClass(valueOf(zone, 'color'))}`} />
              <Input
                aria-label="Nombre de la zona"
                value={valueOf(zone, 'label')}
                onChange={(event) => setDraft(zone.id, 'label', event.target.value)}
                className="w-40"
              />
              <Select
                value={valueOf(zone, 'color')}
                onValueChange={(value) => setDraft(zone.id, 'color', value)}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ZONE_COLOR_TOKENS.map((token) => (
                    <SelectItem key={token} value={token}>
                      {ZONE_COLOR_LABELS[token]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label="Orden"
                type="number"
                value={valueOf(zone, 'sort_order')}
                onChange={(event) => setDraft(zone.id, 'sort_order', event.target.value)}
                className="w-20"
              />
              <div className="flex items-center gap-2 ml-auto">
                <Label htmlFor={`zone-active-${zone.id}`} className="text-xs text-muted-foreground">
                  Activa
                </Label>
                <Switch
                  id={`zone-active-${zone.id}`}
                  checked={zone.is_active}
                  onCheckedChange={(checked) => toggleActiveMutation.mutate({ zone, isActive: checked })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor={`zone-email-${zone.id}`} className="text-xs text-muted-foreground">
                  Correo de alertas
                </Label>
                <Input
                  id={`zone-email-${zone.id}`}
                  type="email"
                  placeholder="alertas@empresa.cl"
                  value={valueOf(zone, 'notification_email') ?? ''}
                  onChange={(event) => setDraft(zone.id, 'notification_email', event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`zone-aliases-${zone.id}`} className="text-xs text-muted-foreground">
                  Comunas y ciudades (separadas por coma)
                </Label>
                <Input
                  id={`zone-aliases-${zone.id}`}
                  placeholder="talca, maule, curico"
                  value={(valueOf(zone, 'aliases') ?? []).join(', ')}
                  onChange={(event) =>
                    setDraft(
                      zone.id,
                      'aliases',
                      event.target.value.split(',').map((alias) => alias.trim()).filter(Boolean),
                    )
                  }
                />
              </div>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={() => saveMutation.mutate(zone)}
              disabled={saveMutation.isPending || !drafts[zone.id]}
            >
              <Save className="w-4 h-4 mr-2" />
              Guardar zona
            </Button>
          </div>
        ))}

        <div className="flex items-end gap-2 pt-2 border-t">
          <div className="flex-1 space-y-1">
            <Label htmlFor="new-zone" className="text-xs text-muted-foreground">
              Agregar zona
            </Label>
            <Input
              id="new-zone"
              placeholder="Ej: Concepción"
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
            />
          </div>
          <Button size="sm" onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !newLabel.trim()}>
            <Plus className="w-4 h-4 mr-2" />
            Agregar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
