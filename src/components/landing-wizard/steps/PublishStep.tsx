import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Check, X, Copy, ExternalLink, Rocket, PartyPopper } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { LandingConfig, LandingService, LandingTeamMember } from '@/hooks/useLandingWizard';

export interface PublishStepProps {
  config: LandingConfig | null;
  services: LandingService[];
  team: LandingTeamMember[];
  workshopSlug: string | null;
  onPublish: () => void;
  isPublishing?: boolean;
}

export function PublishStep({ config, services, team, workshopSlug, onPublish, isPublishing = false }: PublishStepProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const checklist = {
    identity: !!(config?.business_name),
    services: services.length > 0,
    team: team.filter(t => t.show_on_landing).length > 0,
    availability: !!(config?.default_schedule),
  };

  const isPublished = config?.is_published ?? false;
  const primaryColor = config?.primary_color || '#3b82f6';
  const landingUrl = workshopSlug
    ? `${window.location.origin}/agenda/${workshopSlug}`
    : 'Generando URL...';

  const isReadyToPublish = Object.values(checklist).every(Boolean);

  const checklistItems = [
    { key: 'identity', label: 'Identidad del negocio', description: 'Nombre y mensaje de bienvenida' },
    { key: 'services', label: 'Servicios configurados', description: 'Al menos un servicio activo' },
    { key: 'team', label: 'Equipo agregado', description: 'Al menos un miembro visible' },
    { key: 'availability', label: 'Disponibilidad definida', description: 'Horarios de atención' },
  ];

  const copyLink = () => {
    if (!workshopSlug) {
      toast({
        title: 'Error',
        description: 'No se pudo generar el enlace. Intenta recargar la página.',
        variant: 'destructive'
      });
      return;
    }
    navigator.clipboard.writeText(landingUrl);
    setCopied(true);
    toast({ title: 'Link copiado', description: 'El enlace se ha copiado al portapapeles' });
    setTimeout(() => setCopied(false), 2000);
  };

  const openLanding = () => {
    if (!workshopSlug) return;
    window.open(landingUrl, '_blank');
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-semibold mb-2">
          {isPublished ? '¡Tu Landing está Publicada!' : 'Publicar Landing'}
        </h2>
        <p className="text-muted-foreground">
          {isPublished
            ? 'Tu página de agendamiento ya está disponible para tus clientes'
            : 'Revisa que todo esté listo antes de publicar'
          }
        </p>
      </div>

      {isPublished && (
        <Card className="p-6 text-center border-primary/20 bg-primary/5">
          <PartyPopper className="w-12 h-12 text-primary mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">
            ¡Felicidades!
          </h3>
          <p className="text-muted-foreground mb-4">
            Tu página de agendamiento está activa y recibiendo clientes
          </p>
        </Card>
      )}

      {/* Checklist */}
      <Card className="p-6 bg-background/80">
        <h3 className="font-semibold mb-4">Checklist Final</h3>
        <div className="space-y-4">
          {checklistItems.map((item) => {
            const isComplete = checklist[item.key as keyof typeof checklist];
            return (
              <div
                key={item.key}
                className="flex items-center gap-4 p-3 rounded-lg bg-muted/40 border border-border/50"
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center ${isComplete ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'
                    }`}
                >
                  {isComplete ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{item.label}</div>
                  <div className="text-sm text-muted-foreground">{item.description}</div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* URL and Actions */}
      <Card className="p-6 bg-background/80">
        <h3 className="font-semibold mb-4">Link de tu Landing</h3>
        <div className="flex gap-2 mb-4">
          <Input
            value={landingUrl}
            readOnly
            className="font-mono text-sm bg-muted"
          />
          <Button variant="outline" onClick={copyLink} disabled={!workshopSlug}>
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </Button>
          <Button variant="outline" onClick={openLanding} disabled={!workshopSlug}>
            <ExternalLink className="w-4 h-4" />
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">
          Comparte este enlace con tus clientes para que puedan agendar citas
        </p>
      </Card>

      {/* Publish button */}
      {!isPublished && (
        <Button
          size="lg"
          className="w-full h-14 text-lg btn-primary-glow"
          disabled={!isReadyToPublish || isPublishing}
          onClick={onPublish}
        >
          <Rocket className="w-5 h-5 mr-2" />
          {isPublishing ? 'Publicando...' : 'Publicar Landing'}
        </Button>
      )}

      {!isReadyToPublish && !isPublished && (
        <p className="text-center text-sm text-muted-foreground">
          Completa todos los pasos del checklist para poder publicar
        </p>
      )}

      {isPublished && (
        <div className="flex gap-4">
          <Button variant="outline" className="flex-1" onClick={copyLink} disabled={!workshopSlug}>
            <Copy className="w-4 h-4 mr-2" />
            Copiar Link
          </Button>
          <Button className="flex-1" onClick={openLanding} disabled={!workshopSlug}>
            <ExternalLink className="w-4 h-4 mr-2" />
            Ver Landing
          </Button>
        </div>
      )}
    </div>
  );
}
