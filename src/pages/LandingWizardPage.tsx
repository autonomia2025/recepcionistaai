import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Save, X, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WizardProgress } from '@/components/landing-wizard/WizardProgress';
import { IdentityStep } from '@/components/landing-wizard/steps/IdentityStep';
import { ServicesStep } from '@/components/landing-wizard/steps/ServicesStep';
import { TeamStep } from '@/components/landing-wizard/steps/TeamStep';
import { AvailabilityStep } from '@/components/landing-wizard/steps/AvailabilityStep';
import { ContactRulesStep } from '@/components/landing-wizard/steps/ContactRulesStep';
import { PublishStep } from '@/components/landing-wizard/steps/PublishStep';
import { useLandingWizard, LandingConfig } from '@/hooks/useLandingWizard';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const STEPS = [
  { title: 'Identidad', icon: null },
  { title: 'Servicios', icon: null },
  { title: 'Equipo', icon: null },
  { title: 'Disponibilidad', icon: null },
  { title: 'Contacto', icon: null },
  { title: 'Publicar', icon: null },
];

export default function LandingWizardPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    config,
    services,
    team,
    loading,
    updateConfig,
    addService,
    updateService,
    deleteService,
    addTeamMember,
    updateTeamMember,
    deleteTeamMember,
    applyTemplate,
    publishLanding,
    workshopSlug,
  } = useLandingWizard();

  const [currentStep, setCurrentStep] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);

  // Load saved step from config
  useEffect(() => {
    if (config?.wizard_current_step && config.wizard_current_step > 0) {
      setCurrentStep(config.wizard_current_step);
    }
  }, [config?.wizard_current_step]);

  const handleSave = async (data: Partial<LandingConfig>) => {
    setIsSaving(true);
    try {
      await updateConfig.mutateAsync({ ...data, wizard_current_step: currentStep });
      setShowSavedFeedback(true);
      setTimeout(() => setShowSavedFeedback(false), 2000);
    } catch (error) {
      toast({
        title: 'Error al guardar',
        description: 'No se pudieron guardar los cambios',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleNext = async () => {
    // Save current step progress
    try {
      await updateConfig.mutateAsync({ wizard_current_step: currentStep + 1 });
    } catch (error) {
      // Continue anyway
    }

    if (currentStep < 6) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleExit = () => {
    setShowExitDialog(true);
  };

  const confirmExit = async () => {
    try {
      await updateConfig.mutateAsync({ wizard_current_step: currentStep });
    } catch (error) {
      // Continue anyway
    }
    navigate('/dashboard');
  };

  const handleApplyTemplate = async () => {
    try {
      await applyTemplate('taller_mecanico');
      toast({
        title: 'Plantilla aplicada',
        description: 'Se han cargado los datos de Taller Mecánico',
      });
      setShowTemplateDialog(false);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'No se pudo aplicar la plantilla',
        variant: 'destructive',
      });
    }
  };

  const handlePublish = async () => {
    try {
      await publishLanding.mutateAsync();
      toast({
        title: '¡Landing publicada!',
        description: 'Tu página de agendamiento está lista',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'No se pudo publicar la landing',
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return (
      <div className="public-shell flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Cargando configuración...</div>
      </div>
    );
  }

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <IdentityStep
            config={config}
            onUpdate={handleSave}
          />
        );
      case 2:
        return (
          <ServicesStep
            services={services}
            primaryColor={config?.primary_color || '#3b82f6'}
            onAdd={(service) => addService.mutate(service)}
            onUpdate={(service) => updateService.mutate(service)}
            onDelete={(id) => deleteService.mutate(id)}
          />
        );
      case 3:
        return (
          <TeamStep
            team={team}
            primaryColor={config?.primary_color || '#3b82f6'}
            onAdd={(member) => addTeamMember.mutate(member)}
            onUpdate={(member) => updateTeamMember.mutate(member)}
            onDelete={(id) => deleteTeamMember.mutate(id)}
          />
        );
      case 4:
        return (
          <AvailabilityStep
            config={config}
            onUpdate={handleSave}
          />
        );
      case 5:
        return (
          <ContactRulesStep
            config={config}
            primaryColor={config?.primary_color || '#3b82f6'}
            onUpdate={handleSave}
          />
        );
      case 6:
        return (
          <PublishStep
            config={config}
            services={services}
            team={team}
            workshopSlug={workshopSlug}
            onPublish={handlePublish}
            isPublishing={publishLanding.isPending}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="public-shell">
      {/* Header */}
      <header className="border-b border-border/60 bg-card/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={handleExit}>
              <X className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold">Configurar Landing de Agendamiento</h1>
              <p className="text-sm text-muted-foreground">
                {config?.business_name || 'Tu negocio'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {showSavedFeedback && (
              <span className="text-sm text-primary animate-fade-in flex items-center gap-1">
                <Save className="w-4 h-4" />
                Guardado
              </span>
            )}

            {currentStep === 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowTemplateDialog(true)}
                className="gap-2"
              >
                <Sparkles className="w-4 h-4" />
                Modo rápido
              </Button>
            )}

            <Button variant="outline" size="sm" onClick={handleExit}>
              Guardar y salir
            </Button>
          </div>
        </div>
      </header>

      {/* Progress */}
      <div className="max-w-4xl mx-auto px-6 py-6">
        <WizardProgress
          currentStep={currentStep}
          totalSteps={6}
          steps={STEPS}
          onStepClick={(step) => setCurrentStep(step)}
        />
      </div>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-6 pb-32">
        {renderStep()}
      </main>

      {/* Footer Navigation */}
      <footer className="fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur-md border-t border-border/60">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 1}
            className="gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Atrás
          </Button>

          {currentStep < 6 && (
            <Button
              onClick={handleNext}
              disabled={isSaving}
              className="gap-2 min-w-32"
            >
              Continuar
              <ArrowRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      </footer>

      {/* Exit Dialog */}
      <AlertDialog open={showExitDialog} onOpenChange={setShowExitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Guardar y salir?</AlertDialogTitle>
            <AlertDialogDescription>
              Tu progreso se guardará y podrás continuar después.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmExit}>Guardar y salir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Template Dialog */}
      <AlertDialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              Modo Rápido: Taller Mecánico
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>Esta plantilla incluye:</p>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                <li>Servicios sugeridos (Diagnóstico, Mantención, Frenos, Cambio de aceite)</li>
                <li>Mensajes de bienvenida y confirmación</li>
                <li>Roles de equipo sugeridos</li>
              </ul>
              <p className="text-destructive text-sm mt-2">
                Esto reemplazará la configuración actual.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleApplyTemplate}>Aplicar plantilla</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
