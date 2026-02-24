-- Add Google Calendar integration fields to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS google_calendar_connected BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS google_calendar_email TEXT,
ADD COLUMN IF NOT EXISTS google_refresh_token TEXT,
ADD COLUMN IF NOT EXISTS google_calendar_id TEXT,
ADD COLUMN IF NOT EXISTS google_connected_at TIMESTAMPTZ;

-- Create table for synced calendar events (workshop appointments + busy blocks)
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id UUID NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE,
  google_event_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'appointment', -- 'appointment' | 'busy' | 'personal'
  is_all_day BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  synced_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

-- Policies for calendar_events
CREATE POLICY "Users can view calendar events in their workshop" 
ON public.calendar_events 
FOR SELECT 
USING (workshop_id = get_user_workshop_id(auth.uid()));

CREATE POLICY "Users can manage their own calendar events" 
ON public.calendar_events 
FOR ALL 
USING (
  workshop_id = get_user_workshop_id(auth.uid()) AND 
  (user_id = auth.uid() OR has_role(auth.uid(), 'ADMIN'))
);

CREATE POLICY "SUPERADMIN can view all calendar events" 
ON public.calendar_events 
FOR SELECT 
USING (is_superadmin(auth.uid()));

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_calendar_events_workshop_time 
ON public.calendar_events(workshop_id, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_calendar_events_user 
ON public.calendar_events(user_id, start_time);

-- Trigger for updated_at
CREATE TRIGGER update_calendar_events_updated_at
BEFORE UPDATE ON public.calendar_events
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();