import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WizardProgressProps {
  currentStep: number;
  totalSteps: number;
  steps: { title: string; icon?: React.ReactNode }[];
  onStepClick?: (step: number) => void;
}

export function WizardProgress({ currentStep, totalSteps, steps, onStepClick }: WizardProgressProps) {
  return (
    <div className="w-full">
      {/* Progress bar */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-muted-foreground">
          Paso {currentStep} de {totalSteps}
        </span>
        <span className="text-sm text-muted-foreground">
          {Math.round((currentStep / totalSteps) * 100)}% completado
        </span>
      </div>
      
      <div className="h-2 bg-muted rounded-full overflow-hidden mb-6">
        <div 
          className="h-full bg-primary transition-all duration-500 ease-out rounded-full"
          style={{ width: `${(currentStep / totalSteps) * 100}%` }}
        />
      </div>
      
      {/* Step indicators */}
      <div className="flex justify-between">
        {steps.map((step, index) => {
          const stepNumber = index + 1;
          const isCompleted = stepNumber < currentStep;
          const isCurrent = stepNumber === currentStep;
          const isClickable = isCompleted || isCurrent;
          
          return (
            <div 
              key={index} 
              className={cn(
                "flex flex-col items-center gap-2 flex-1",
                stepNumber > currentStep && "opacity-40",
                isClickable && onStepClick && "cursor-pointer"
              )}
              onClick={() => isClickable && onStepClick?.(stepNumber)}
            >
              <div 
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-all",
                  isCompleted && "bg-primary text-primary-foreground",
                  isCurrent && "bg-primary text-primary-foreground ring-4 ring-primary/20",
                  !isCompleted && !isCurrent && "bg-muted text-muted-foreground",
                  isClickable && onStepClick && "hover:ring-4 hover:ring-primary/10"
                )}
              >
                {isCompleted ? <Check className="w-5 h-5" /> : stepNumber}
              </div>
              <span 
                className={cn(
                  "text-xs text-center max-w-[80px] hidden md:block",
                  isCurrent && "font-medium text-foreground",
                  !isCurrent && "text-muted-foreground"
                )}
              >
                {step.title}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
