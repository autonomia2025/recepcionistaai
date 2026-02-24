import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { 
  LayoutDashboard, 
  MessageSquare, 
  Users, 
  Calendar, 
  Bot, 
  Mail, 
  Globe, 
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  UserCog
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface TutorialStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  tips: string[];
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: '¡Bienvenido a AutonomIA Suite!',
    description: 'Tu asistente virtual de atención al cliente está listo. Te guiaremos por las funciones principales para que saques el máximo provecho.',
    icon: <Sparkles className="h-8 w-8 text-primary" />,
    tips: [
      'El bot ya está activo y responde automáticamente',
      'Todos los datos se guardan en tiempo real',
      'Puedes acceder desde cualquier dispositivo'
    ]
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    description: 'Tu centro de control. Aquí verás métricas clave como horas ahorradas, valor generado, conversaciones activas y clientes atendidos.',
    icon: <LayoutDashboard className="h-8 w-8 text-primary" />,
    tips: [
      'Las métricas se actualizan automáticamente',
      'Haz clic en cada métrica para ver más detalles',
      'El estado de salud muestra si todo funciona correctamente'
    ]
  },
  {
    id: 'inbox',
    title: 'Inbox',
    description: 'Todas las conversaciones con tus clientes en un solo lugar. El bot responde automáticamente pero puedes intervenir cuando quieras.',
    icon: <MessageSquare className="h-8 w-8 text-primary" />,
    tips: [
      'Las conversaciones nuevas aparecen en tiempo real',
      'Puedes pausar el bot para responder manualmente',
      'El análisis de sentimiento te ayuda a priorizar'
    ]
  },
  {
    id: 'clients',
    title: 'Clientes',
    description: 'Base de datos de todos tus contactos. El bot extrae automáticamente información de las conversaciones como nombre, teléfono y necesidades.',
    icon: <Users className="h-8 w-8 text-primary" />,
    tips: [
      'Cada cliente tiene un perfil con historial completo',
      'Puedes agregar notas y etiquetas',
      'Los leads calientes se identifican automáticamente'
    ]
  },
  {
    id: 'calendar',
    title: 'Agenda',
    description: 'Visualiza y gestiona todas las citas agendadas. Sincroniza con Google Calendar para mantener todo organizado.',
    icon: <Calendar className="h-8 w-8 text-primary" />,
    tips: [
      'Los clientes pueden agendar desde tu landing page',
      'Se envían recordatorios automáticos por email',
      'Conecta Google Calendar para sincronización bidireccional'
    ]
  },
  {
    id: 'team',
    title: 'Equipo',
    description: 'Invita a colaboradores y asigna roles. Los Admin tienen acceso total, mientras que Staff solo ve sus conversaciones asignadas.',
    icon: <UserCog className="h-8 w-8 text-primary" />,
    tips: [
      'Envía invitaciones por email',
      'Cada miembro puede conectar su Google Calendar',
      'Los asientos dependen de tu plan'
    ]
  },
  {
    id: 'bot',
    title: 'Configurar Bot',
    description: 'Personaliza cómo responde tu asistente. Define el tono, servicios, preguntas frecuentes y reglas de escalamiento.',
    icon: <Bot className="h-8 w-8 text-primary" />,
    tips: [
      'Sube documentos para que el bot aprenda tu negocio',
      'Prueba el bot con el simulador de chat',
      'Ajusta las reglas de handoff según tus necesidades'
    ]
  },
  {
    id: 'reminders',
    title: 'Recordatorios',
    description: 'Configura emails automáticos que se envían 24h y 3h antes de cada cita. Personaliza el contenido con variables dinámicas.',
    icon: <Mail className="h-8 w-8 text-primary" />,
    tips: [
      'Primero conecta Gmail en "Correo"',
      'Usa variables como {{nombre}} y {{fecha}}',
      'Los recordatorios reducen las inasistencias un 60%'
    ]
  },
  {
    id: 'landing',
    title: 'Landing Page',
    description: 'Publica una página de reservas personalizada donde tus clientes pueden agendar citas directamente.',
    icon: <Globe className="h-8 w-8 text-primary" />,
    tips: [
      'Accede desde el botón "Configurar Landing" en el menú',
      'El wizard te guía paso a paso',
      'Comparte el link en tu WhatsApp y redes sociales'
    ]
  },
  {
    id: 'done',
    title: '¡Listo para empezar!',
    description: 'Ya conoces lo básico. Explora el panel y no dudes en experimentar. Tu asistente ya está trabajando para ti.',
    icon: <CheckCircle2 className="h-8 w-8 text-primary" />,
    tips: [
      'Revisa el Dashboard diariamente',
      'Responde manualmente a casos complejos',
      'El bot aprende de cada interacción'
    ]
  }
];

const TUTORIAL_STORAGE_KEY = 'autonomia_tutorial_completed';

interface AdminTutorialProps {
  forceShow?: boolean;
  onClose?: () => void;
}

export function AdminTutorial({ forceShow = false, onClose }: AdminTutorialProps) {
  const [open, setOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    // Check if tutorial was already completed
    const completed = localStorage.getItem(TUTORIAL_STORAGE_KEY);
    if (!completed || forceShow) {
      setOpen(true);
    }
  }, [forceShow]);

  const handleComplete = () => {
    localStorage.setItem(TUTORIAL_STORAGE_KEY, 'true');
    setOpen(false);
    onClose?.();
  };

  const handleSkip = () => {
    handleComplete();
  };

  const step = TUTORIAL_STEPS[currentStep];
  const progress = ((currentStep + 1) / TUTORIAL_STEPS.length) * 100;
  const isLastStep = currentStep === TUTORIAL_STEPS.length - 1;
  const isFirstStep = currentStep === 0;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) handleComplete();
    }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="text-center pb-2">
          <div className="flex justify-center mb-4">
            <div className="p-4 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20">
              {step.icon}
            </div>
          </div>
          <DialogTitle className="text-xl">{step.title}</DialogTitle>
          <DialogDescription className="text-base mt-2">
            {step.description}
          </DialogDescription>
        </DialogHeader>

        {/* Tips */}
        <div className="space-y-2 my-4">
          {step.tips.map((tip, index) => (
            <div 
              key={index} 
              className="flex items-start gap-3 p-3 rounded-lg bg-muted/50"
            >
              <div className="flex-shrink-0 mt-0.5">
                <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">
                  {index + 1}
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{tip}</p>
            </div>
          ))}
        </div>

        {/* Progress */}
        <div className="space-y-2">
          <Progress value={progress} className="h-1.5" />
          <p className="text-xs text-center text-muted-foreground">
            Paso {currentStep + 1} de {TUTORIAL_STEPS.length}
          </p>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 mt-4">
          {!isFirstStep && (
            <Button
              variant="outline"
              onClick={() => setCurrentStep(prev => prev - 1)}
              className="w-full sm:w-auto"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Anterior
            </Button>
          )}
          
          {isFirstStep && (
            <Button
              variant="ghost"
              onClick={handleSkip}
              className="w-full sm:w-auto text-muted-foreground"
            >
              Omitir tutorial
            </Button>
          )}

          <Button
            onClick={() => {
              if (isLastStep) {
                handleComplete();
              } else {
                setCurrentStep(prev => prev + 1);
              }
            }}
            className={cn("w-full sm:w-auto", isFirstStep && "sm:ml-auto")}
          >
            {isLastStep ? (
              <>
                Comenzar
                <Sparkles className="h-4 w-4 ml-1" />
              </>
            ) : (
              <>
                Siguiente
                <ChevronRight className="h-4 w-4 ml-1" />
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Export function to reset tutorial
export function resetTutorial() {
  localStorage.removeItem(TUTORIAL_STORAGE_KEY);
}

// Export function to check if tutorial is completed
export function isTutorialCompleted(): boolean {
  return localStorage.getItem(TUTORIAL_STORAGE_KEY) === 'true';
}
