-- Add UNIQUE constraint for idempotency on email_reminder_logs
ALTER TABLE public.email_reminder_logs 
ADD CONSTRAINT unique_appointment_reminder 
UNIQUE (appointment_id, reminder_type);

-- Add index for faster lookups on appointments needing reminders
CREATE INDEX IF NOT EXISTS idx_appointments_reminder_lookup 
ON public.appointments (start_datetime, status) 
WHERE status = 'scheduled';