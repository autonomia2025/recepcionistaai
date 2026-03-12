import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Palette, Upload } from 'lucide-react';
import { LandingConfig } from '@/hooks/useLandingWizard';

export interface IdentityStepProps {
  config: LandingConfig | null;
  onUpdate: (data: Partial<LandingConfig>) => void;
}

const COLOR_PRESETS = [
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#0ea5e9', // Sky
  '#3b82f6', // Blue
];

export function IdentityStep({ config, onUpdate }: IdentityStepProps) {
  const [formData, setFormData] = useState({
    business_name: config?.business_name || '',
    primary_color: config?.primary_color || '#6366f1',
    welcome_message: config?.welcome_message || '',
    logo_url: config?.logo_url || '',
  });

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (config) {
      setFormData({
        business_name: config.business_name || '',
        primary_color: config.primary_color || '#6366f1',
        welcome_message: config.welcome_message || '',
        logo_url: config.logo_url || '',
      });
    }
  }, [config]);

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new timer to save after 1 second of inactivity
    debounceTimerRef.current = setTimeout(() => {
      onUpdate({ [field]: value });
    }, 1000);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Form */}
      <div className="card-premium p-6 space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-2">Identidad del Negocio</h2>
          <p className="text-muted-foreground">
            Define cómo se verá tu página de agendamiento
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="business_name">Nombre del negocio *</Label>
            <Input
              id="business_name"
              placeholder="Ej: Mi Negocio SpA"
              value={formData.business_name}
              onChange={(e) => handleChange('business_name', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Logo (opcional)</Label>
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-xl bg-muted flex items-center justify-center border-2 border-dashed">
                {formData.logo_url ? (
                  <img src={formData.logo_url} alt="Logo" className="w-full h-full object-cover rounded-xl" />
                ) : (
                  <Upload className="w-6 h-6 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1">
                <Input
                  placeholder="URL del logo"
                  value={formData.logo_url}
                  onChange={(e) => handleChange('logo_url', e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Pega una URL de imagen o sube a un servicio externo
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Palette className="w-4 h-4" />
              Color principal
            </Label>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((color) => (
                <button
                  key={color}
                  onClick={() => handleChange('primary_color', color)}
                  className={`w-8 h-8 rounded-full transition-transform hover:scale-110 ${formData.primary_color === color ? 'ring-2 ring-offset-2 ring-primary scale-110' : ''
                    }`}
                  style={{ backgroundColor: color }}
                />
              ))}
              <input
                type="color"
                value={formData.primary_color}
                onChange={(e) => handleChange('primary_color', e.target.value)}
                className="w-8 h-8 rounded-full cursor-pointer"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="welcome_message">Mensaje de bienvenida</Label>
            <Textarea
              id="welcome_message"
              placeholder="¡Bienvenido! Agenda tu cita de forma fácil y rápida."
              value={formData.welcome_message}
              onChange={(e) => handleChange('welcome_message', e.target.value)}
              rows={2}
            />
            <p className="text-xs text-muted-foreground">
              1-2 líneas que verán tus clientes al entrar
            </p>
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="lg:sticky lg:top-4">
        <div className="section-title mb-3">Vista previa</div>
        <Card className="overflow-hidden">
          <div
            className="p-6 text-white"
            style={{ backgroundColor: formData.primary_color }}
          >
            <div className="flex items-center gap-4">
              {formData.logo_url ? (
                <img src={formData.logo_url} alt="Logo" className="w-16 h-16 rounded-xl object-cover bg-white/20" />
              ) : (
                <div className="w-16 h-16 rounded-xl bg-white/20 flex items-center justify-center">
                  <span className="text-2xl font-bold">
                    {formData.business_name?.charAt(0) || '?'}
                  </span>
                </div>
              )}
              <div>
                <h3 className="text-xl font-bold">
                  {formData.business_name || 'Nombre del negocio'}
                </h3>
                <p className="text-white/80 text-sm">
                  {formData.welcome_message || 'Mensaje de bienvenida...'}
                </p>
              </div>
            </div>
          </div>
          <div className="p-6 bg-background">
            <div className="text-center text-muted-foreground">
              <p className="text-sm">Aquí aparecerán los servicios y formulario</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
