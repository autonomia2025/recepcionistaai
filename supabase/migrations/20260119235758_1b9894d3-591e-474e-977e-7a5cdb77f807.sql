-- Landing configuration for booking pages
CREATE TABLE public.landing_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workshop_id UUID NOT NULL UNIQUE REFERENCES public.workshops(id) ON DELETE CASCADE,
  -- Identity
  business_name TEXT,
  logo_url TEXT,
  primary_color TEXT DEFAULT '#6366f1',
  welcome_message TEXT,
  -- Contact rules
  require_name BOOLEAN DEFAULT true,
  require_phone BOOLEAN DEFAULT true,
  require_email BOOLEAN DEFAULT false,
  require_reason BOOLEAN DEFAULT false,
  cancellation_policy TEXT,
  confirmation_message TEXT DEFAULT 'Tu cita ha sido agendada exitosamente. Te enviaremos un recordatorio.',
  -- Availability defaults
  default_schedule JSONB DEFAULT '{"monday": {"enabled": true, "start": "09:00", "end": "18:00"}, "tuesday": {"enabled": true, "start": "09:00", "end": "18:00"}, "wednesday": {"enabled": true, "start": "09:00", "end": "18:00"}, "thursday": {"enabled": true, "start": "09:00", "end": "18:00"}, "friday": {"enabled": true, "start": "09:00", "end": "18:00"}, "saturday": {"enabled": false, "start": "09:00", "end": "14:00"}, "sunday": {"enabled": false, "start": "09:00", "end": "14:00"}}',
  lunch_break_start TEXT,
  lunch_break_end TEXT,
  buffer_minutes INTEGER DEFAULT 15,
  -- Status
  is_published BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,
  wizard_completed BOOLEAN DEFAULT false,
  wizard_current_step INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Landing services
CREATE TABLE public.landing_services (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workshop_id UUID NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  price NUMERIC,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Landing team members
CREATE TABLE public.landing_team (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workshop_id UUID NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  role TEXT,
  photo_url TEXT,
  show_on_landing BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.landing_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_team ENABLE ROW LEVEL SECURITY;

-- RLS Policies for landing_config
CREATE POLICY "Users can view their workshop landing config"
ON public.landing_config FOR SELECT
USING (workshop_id IN (SELECT workshop_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can update their workshop landing config"
ON public.landing_config FOR UPDATE
USING (workshop_id IN (SELECT workshop_id FROM profiles WHERE id = auth.uid() AND role IN ('ADMIN', 'SUPERADMIN')));

CREATE POLICY "Admins can insert landing config"
ON public.landing_config FOR INSERT
WITH CHECK (workshop_id IN (SELECT workshop_id FROM profiles WHERE id = auth.uid() AND role IN ('ADMIN', 'SUPERADMIN')));

CREATE POLICY "Superadmins can do anything with landing config"
ON public.landing_config FOR ALL
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'SUPERADMIN'));

-- RLS Policies for landing_services
CREATE POLICY "Users can view their workshop services"
ON public.landing_services FOR SELECT
USING (workshop_id IN (SELECT workshop_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can manage their workshop services"
ON public.landing_services FOR ALL
USING (workshop_id IN (SELECT workshop_id FROM profiles WHERE id = auth.uid() AND role IN ('ADMIN', 'SUPERADMIN')));

CREATE POLICY "Superadmins can do anything with services"
ON public.landing_services FOR ALL
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'SUPERADMIN'));

-- Public access for booking page
CREATE POLICY "Public can view active services for published landings"
ON public.landing_services FOR SELECT
USING (
  is_active = true AND
  workshop_id IN (SELECT workshop_id FROM landing_config WHERE is_published = true)
);

-- RLS Policies for landing_team
CREATE POLICY "Users can view their workshop team"
ON public.landing_team FOR SELECT
USING (workshop_id IN (SELECT workshop_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can manage their workshop team"
ON public.landing_team FOR ALL
USING (workshop_id IN (SELECT workshop_id FROM profiles WHERE id = auth.uid() AND role IN ('ADMIN', 'SUPERADMIN')));

CREATE POLICY "Superadmins can do anything with team"
ON public.landing_team FOR ALL
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'SUPERADMIN'));

-- Public access for booking page
CREATE POLICY "Public can view team for published landings"
ON public.landing_team FOR SELECT
USING (
  show_on_landing = true AND
  workshop_id IN (SELECT workshop_id FROM landing_config WHERE is_published = true)
);

-- Trigger for updated_at
CREATE TRIGGER update_landing_config_updated_at
BEFORE UPDATE ON public.landing_config
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for performance
CREATE INDEX idx_landing_services_workshop ON public.landing_services(workshop_id);
CREATE INDEX idx_landing_team_workshop ON public.landing_team(workshop_id);