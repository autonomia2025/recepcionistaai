import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { HelpCircle } from 'lucide-react';
import { AdminTutorial, resetTutorial } from './AdminTutorial';
import { cn } from '@/lib/utils';

interface TutorialButtonProps {
  className?: string;
  variant?: 'default' | 'outline' | 'ghost' | 'link';
}

export function TutorialButton({ className, variant = 'ghost' }: TutorialButtonProps) {
  const [showTutorial, setShowTutorial] = useState(false);

  const handleClick = () => {
    resetTutorial();
    setShowTutorial(true);
  };

  return (
    <>
      <Button
        variant={variant}
        size="sm"
        onClick={handleClick}
        className={cn("gap-2", className)}
      >
        <HelpCircle className="h-4 w-4" />
        <span className="hidden sm:inline">Ver tutorial</span>
      </Button>
      
      {showTutorial && (
        <AdminTutorial 
          forceShow 
          onClose={() => setShowTutorial(false)} 
        />
      )}
    </>
  );
}
