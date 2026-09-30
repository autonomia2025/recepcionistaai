import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Lightbulb, Sparkles } from 'lucide-react';
import type { EmailReview } from '@/hooks/useClientEmail';
import { cn } from '@/lib/utils';

const ANSWERED: Record<string, string> = {
  all: 'Respondió todo',
  partial: 'Respondió en parte',
  none: 'No respondió lo preguntado',
  nothing_asked: '',
};

function reviewIsGood(review: EmailReview): boolean {
  return (review.tone ?? 0) >= 4 && (review.answered === 'all' || review.answered === 'nothing_asked')
    && review.next_step === true && review.risks.length === 0;
}

// The AI's review under a seller's email: one line, details on demand.
export function EmailReviewNote({ review }: { review: EmailReview }) {
  const [open, setOpen] = useState(false);
  const good = reviewIsGood(review);
  const parts = [
    review.tone ? `Tono ${review.tone}/5${review.tone_label ? ` (${review.tone_label})` : ''}` : null,
    review.answered ? ANSWERED[review.answered] : null,
    review.next_step ? 'Propuso siguiente paso' : 'Sin siguiente paso',
    review.risks.length ? `${review.risks.length} ${review.risks.length === 1 ? 'riesgo' : 'riesgos'}` : null,
  ].filter(Boolean);

  return (
    <div className={cn('rounded-md border text-xs', good ? 'border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/20' : 'border-amber-200 bg-amber-50/60 dark:bg-amber-950/20')}>
      <button type="button" onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left">
        <Sparkles className={cn('w-3.5 h-3.5 flex-shrink-0', good ? 'text-emerald-600' : 'text-amber-600')} />
        <span className="font-medium">Revisión IA:</span>
        <span className="text-muted-foreground truncate">{parts.join(' · ')}</span>
        <ChevronDown className={cn('w-3.5 h-3.5 ml-auto flex-shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 space-y-1.5">
          {review.summary && <p>{review.summary}</p>}
          {review.unanswered.length > 0 && (
            <div>
              <p className="font-medium">Quedó sin responder:</p>
              <ul className="list-disc pl-5">{review.unanswered.map(q => <li key={q} className="italic">{q}</li>)}</ul>
            </div>
          )}
          {review.risks.map(r => <p key={r} className="flex gap-1.5 text-red-700"><AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />{r}</p>)}
          {review.strengths.map(s => <p key={s} className="flex gap-1.5 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5 mt-px flex-shrink-0" />{s}</p>)}
          {review.next_step_text && <p className="text-muted-foreground">Siguiente paso propuesto: {review.next_step_text}</p>}
          {review.improve && <p className="flex gap-1.5"><Lightbulb className="w-3.5 h-3.5 mt-px flex-shrink-0 text-amber-600" /><span><span className="font-medium">Para mejorar:</span> {review.improve}</span></p>}
        </div>
      )}
    </div>
  );
}
