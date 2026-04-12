import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { MapPin, Save } from 'lucide-react';
import { toast } from 'sonner';

const SOC_WORKSHOP_ID = '610fb257-a649-4115-b944-21f31e7952db';

const ZONES = [
  { key: 'talca', label: 'Talca' },
  { key: 'puerto_montt', label: 'Puerto Montt' },
  { key: 'santiago', label: 'Santiago' },
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
      .update({ zone_notification_emails: emails } as any)
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
          <MapPin className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-base">Emails de notificación por zona</CardTitle>
            <CardDescription>
              Cuando se detecte un lead caliente, se enviará la alerta al email de la zona correspondiente
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {ZONES.map(zone => (
          <div key={zone.key} className="space-y-1">
            <Label htmlFor={`zone-email-${zone.key}`}>{zone.label}</Label>
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
