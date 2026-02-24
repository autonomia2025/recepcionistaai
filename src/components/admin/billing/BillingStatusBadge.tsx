import { cn } from '@/lib/utils';
import { differenceInDays, parseISO } from 'date-fns';

export type PaymentStatus = 'pending' | 'current' | 'overdue';

interface BillingStatusBadgeProps {
  status: PaymentStatus;
  nextBillingDate?: string | null;
  className?: string;
}

const statusConfig: Record<PaymentStatus, { label: string; className: string; emoji: string }> = {
  current: {
    label: 'Al día',
    className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    emoji: '✅',
  },
  pending: {
    label: 'Por vencer',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    emoji: '⚠️',
  },
  overdue: {
    label: 'Vencido',
    className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    emoji: '🔴',
  },
};

export function BillingStatusBadge({ status, nextBillingDate, className }: BillingStatusBadgeProps) {
  const config = statusConfig[status];
  
  let daysText = '';
  if (nextBillingDate) {
    const days = differenceInDays(parseISO(nextBillingDate), new Date());
    if (days > 0) {
      daysText = ` (${days}d)`;
    } else if (days < 0) {
      daysText = ` (${Math.abs(days)}d atraso)`;
    } else {
      daysText = ' (hoy)';
    }
  }
  
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        config.className,
        className
      )}
    >
      <span>{config.emoji}</span>
      <span>{config.label}{daysText}</span>
    </span>
  );
}

// Helper function to derive status from date
export function getStatusFromDates(
  nextBillingDate: string | null | undefined,
  lastPaymentDate: string | null | undefined
): PaymentStatus {
  if (!nextBillingDate) return 'pending';
  
  const today = new Date();
  const nextBilling = parseISO(nextBillingDate);
  const days = differenceInDays(nextBilling, today);
  
  if (days < 0) return 'overdue';
  if (days <= 7) return 'pending';
  return 'current';
}
