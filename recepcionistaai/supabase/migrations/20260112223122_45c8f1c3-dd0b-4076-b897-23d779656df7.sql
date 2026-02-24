-- Create notifications table for staff
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id UUID NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'new_appointment',
  title TEXT NOT NULL,
  message TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- RLS policies for notifications
CREATE POLICY "Users can view notifications in their workshop"
ON public.notifications
FOR SELECT
TO authenticated
USING (workshop_id = public.get_user_workshop_id(auth.uid()));

CREATE POLICY "Users can update notifications in their workshop"
ON public.notifications
FOR UPDATE
TO authenticated
USING (workshop_id = public.get_user_workshop_id(auth.uid()));

CREATE POLICY "Service role can insert notifications"
ON public.notifications
FOR INSERT
TO anon, authenticated
WITH CHECK (public.is_workshop_active(workshop_id));

-- Add cancellation token to appointments for client access
ALTER TABLE public.appointments 
ADD COLUMN IF NOT EXISTS cancel_token TEXT DEFAULT encode(extensions.gen_random_bytes(16), 'hex');

-- Enable realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;