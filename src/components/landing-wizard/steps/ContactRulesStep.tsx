import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { User, Phone, Mail, MessageSquare, FileText, CheckCircle } from 'lucide-react';
import { LandingConfig } from '@/hooks/useLandingWizard';

export interface ContactRulesStepProps {
  config: LandingConfig | null;
  primaryColor: string;
  onUpdate: (data: Partial<LandingConfig>) => void;
}

export function ContactRulesStep({ config, primaryColor, onUpdate }: ContactRulesStepProps) {
  const [formData, setFormData] = useState({
    require_name: config?.require_name ?? true,
    require_phone: config?.require_phone ?? true,
    require_email: config?.require_email ?? false,
    require_reason: config?.require_reason ?? false,
    cancellation_policy: config?.cancellation_policy || '',
    confirmation_message: config?.confirmation_message || 'Tu cita ha sido agendada exitosamente. Te enviaremos un recordatorio.',
  });

  useEffect(() => {
    if (config) {
      setFormData({
        require_name: config.require_name ?? true,
        require_phone: config.require_phone ?? true,
        require_email: config.require_email ?? false,
        require_reason: config.require_reason ?? false,
        cancellation_policy: config.cancellation_policy || '',
        confirmation_message: config.confirmation_message || 'Tu cita ha sido agendada exitosamente. Te enviaremos un recordatorio.',
      });
    }
  }, [config]);

  const handleToggle = (field: string, value: boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    onUpdate({ [field]: value });
  };

  const handleTextChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    onUpdate({ [field]: value });
  };

  const fields = [
    { key: 'require_name', label: 'Nombre', icon: User, description: 'Nombre del cliente' },
    { key: 'require_phone', label: 'Teléfono', icon: Phone, description: 'Número de contacto' },
    { key: 'require_email', label: 'Email', icon: Mail, description: 'Correo electrónico' },
    { key: 'require_reason', label: 'Motivo', icon: MessageSquare, description: 'Razón de la cita' },
  ];

  const enabledFields = fields.filter(f => formData[f.key as keyof typeof formData]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Form */}
      <div className="space-y-6">
        <div className="card-premium p-6">
          <h2 className="text-2xl font-semibold mb-2">Contacto y Reglas</h2>
          <p className="text-muted-foreground">
            Configura qué datos pedir y los mensajes de confirmación
          </p>
        </div>

        {/* Required fields */}
        <Card className="p-4 bg-background/80">
          <h3 className="font-medium mb-4">Datos del Cliente</h3>
          <div className="space-y-4">
            {fields.map((field) => (
              <div key={field.key} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <field.icon className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <Label>{field.label}</Label>
                    <p className="text-xs text-muted-foreground">{field.description}</p>
                  </div>
                </div>
                <Switch
                  checked={formData[field.key as keyof typeof formData] as boolean}
                  onCheckedChange={(checked) => handleToggle(field.key, checked)}
                />
              </div>
            ))}
          </div>
        </Card>

        {/* Cancellation policy */}
        <Card className="p-4 bg-background/80">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <Label>Política de Cancelación</Label>
          </div>
          <Textarea
            value={formData.cancellation_policy}
            onChange={(e) => handleTextChange('cancellation_policy', e.target.value)}
            placeholder="Ej: Las cancelaciones deben realizarse con al menos 24 horas de anticipación."
            rows={2}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Se mostrará al cliente antes de confirmar (opcional)
          </p>
        </Card>

        {/* Confirmation message */}
        <Card className="p-4 bg-background/80">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="w-4 h-4 text-muted-foreground" />
            <Label>Mensaje de Confirmación</Label>
          </div>
          <Textarea
            value={formData.confirmation_message}
            onChange={(e) => handleTextChange('confirmation_message', e.target.value)}
            placeholder="Tu cita ha sido confirmada..."
            rows={3}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Se mostrará después de agendar exitosamente
          </p>
        </Card>
      </div>

      {/* Preview */}
      <div className="lg:sticky lg:top-4">
        <div className="section-title mb-3">Vista previa del formulario</div>
        <Card className="overflow-hidden">
          <div className="p-4 border-b" style={{ backgroundColor: `${primaryColor}10` }}>
            <h3 className="font-semibold" style={{ color: primaryColor }}>Tus datos</h3>
          </div>
          <div className="p-4 space-y-4">
            {enabledFields.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">
                Activa al menos un campo
              </p>
            ) : (
              enabledFields.map((field) => (
                <div key={field.key} className="space-y-1">
                  <Label className="text-sm flex items-center gap-2">
                    <field.icon className="w-4 h-4" />
                    {field.label}
                  </Label>
                  <div className="h-10 bg-muted rounded-md border" />
                </div>
              ))
            )}
            
            {formData.cancellation_policy && (
              <div className="pt-4 border-t">
                <p className="text-xs text-muted-foreground">
                  {formData.cancellation_policy}
                </p>
              </div>
            )}

            <button 
              className="w-full py-3 rounded-lg text-white font-medium"
              style={{ backgroundColor: primaryColor }}
              disabled
            >
              Confirmar Cita
            </button>
          </div>
        </Card>

        {/* Confirmation preview */}
        {formData.confirmation_message && (
          <Card className="mt-4 p-4 border-emerald-200 bg-emerald-50">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium text-emerald-800">¡Cita Confirmada!</h4>
                <p className="text-sm text-emerald-700 mt-1">
                  {formData.confirmation_message}
                </p>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
