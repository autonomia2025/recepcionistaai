import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { MapPin, Save, Mail } from 'lucide-react';
import { toast } from 'sonner';

const SOC_WORKSHOP_ID = '610fb257-a649-4115-b944-21f31e7952db';

const ZONES = [
  { key: 'talca', label: 'Talca', color: 'bg-blue-500' },
  { key: 'puerto_montt', label: 'Puerto Montt', color: 'bg-emerald-500' },
  { key: 'santiago', label: 'Santiago', color: 'bg-violet-500' },
];

interface ZoneEmailSettingsProps {
  workshopId: string;
}

export function ZoneEmailSettings({ workshopId }: ZoneEmailSettingsProps) {
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const isSOC = workshopId === SOC_WORKSHOP_ID;

  useEffect(() => {
    if (!isSOC) return;
    supabase
      .from('workshops')
      .select('zone_notification_emails')
      .eq('id', workshopId)
      .single()
      .then(({ data }) => {
        if (data?.zone_notification_emails) {
          setEmails(data.zone_notification_emails as Record<string, string>);
        }
      });
  }, [workshopId, isSOC]);

  if (!isSOC) return null;

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('workshops')
      .update({ zone_notification_emails: emails as unknown as Json })
      .eq('id', workshopId);

    if (error) {
      toast.error('Error al guardar emails por zona');
    } else {
      toast.success('Emails por zona guardados');
    }
    setSaving(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-base">Emails de notificación por zona</CardTitle>
            <CardDescription>
              Configura un email diferente para cada zona. Cuando se detecte un lead caliente, la alerta se enviará al email de su zona.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {ZONES.map(zone => (
          <div key={zone.key} className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${zone.color}`} />
              <Label htmlFor={`zone-email-${zone.key}`} className="font-medium text-sm">
                <MapPin className="w-3.5 h-3.5 inline mr-1 text-muted-foreground" />
                {zone.label}
              </Label>
            </div>
            <Input
              id={`zone-email-${zone.key}`}
              type="email"
              placeholder={`email-${zone.label.toLowerCase().replace(' ', '')}@empresa.cl`}
              value={emails[zone.key] || ''}
              onChange={(e) => setEmails(prev => ({ ...prev, [zone.key]: e.target.value }))}
            />
          </div>
        ))}
        <Button onClick={handleSave} disabled={saving} size="sm" className="w-full">
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Guardando...' : 'Guardar emails por zona'}
        </Button>
      </CardContent>
    </Card>
  );
}
