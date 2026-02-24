import { cn } from '@/lib/utils';

type ConversationStatus = 'new' | 'in_progress' | 'booked' | 'closed' | 'lost';
type AppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'canceled';
type UserStatus = 'active' | 'invited' | 'disabled';
type SubscriptionStatus = 'active' | 'trial' | 'past_due' | 'canceled';

type Status = ConversationStatus | AppointmentStatus | UserStatus | SubscriptionStatus;

const statusConfig: Record<Status, { label: string; className: string }> = {
  // Conversation status
  new: { label: 'Nuevo', className: 'bg-emerald-100 text-emerald-800' },
  in_progress: { label: 'En progreso', className: 'bg-yellow-100 text-yellow-800' },
  booked: { label: 'Reservado', className: 'bg-green-100 text-green-800' },
  closed: { label: 'Cerrado', className: 'bg-gray-100 text-gray-800' },
  lost: { label: 'Perdido', className: 'bg-red-100 text-red-800' },
  // Appointment status
  scheduled: { label: 'Programado', className: 'bg-emerald-100 text-emerald-800' },
  confirmed: { label: 'Confirmado', className: 'bg-green-100 text-green-800' },
  completed: { label: 'Completado', className: 'bg-gray-100 text-gray-800' },
  no_show: { label: 'No asistió', className: 'bg-red-100 text-red-800' },
  canceled: { label: 'Cancelado', className: 'bg-red-100 text-red-800' },
  // User status
  active: { label: 'Activo', className: 'bg-green-100 text-green-800' },
  invited: { label: 'Invitado', className: 'bg-yellow-100 text-yellow-800' },
  disabled: { label: 'Desactivado', className: 'bg-gray-100 text-gray-800' },
  // Subscription status
  trial: { label: 'Prueba', className: 'bg-amber-100 text-amber-800' },
  past_due: { label: 'Vencido', className: 'bg-red-100 text-red-800' },
};

interface StatusBadgeProps {
  status: Status;
  className?: string;
}

export const StatusBadge = ({ status, className }: StatusBadgeProps) => {
  const config = statusConfig[status] || { label: status, className: 'bg-gray-100 text-gray-800' };

  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  );
};
