-- Create app_role enum
CREATE TYPE public.app_role AS ENUM ('SUPERADMIN', 'ADMIN', 'STAFF');

-- Create user_status enum
CREATE TYPE public.user_status AS ENUM ('active', 'invited', 'disabled');

-- Create subscription_status enum
CREATE TYPE public.subscription_status AS ENUM ('active', 'trial', 'past_due', 'canceled');

-- Create invite_status enum
CREATE TYPE public.invite_status AS ENUM ('pending', 'accepted', 'expired');

-- Create conversation_status enum
CREATE TYPE public.conversation_status AS ENUM ('new', 'in_progress', 'booked', 'closed', 'lost');

-- Create message_direction enum
CREATE TYPE public.message_direction AS ENUM ('inbound', 'outbound');

-- Create appointment_status enum
CREATE TYPE public.appointment_status AS ENUM ('scheduled', 'confirmed', 'completed', 'no_show', 'canceled');

-- 1. Plans table
CREATE TABLE public.plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  max_users INTEGER, -- NULL means unlimited
  price_clp INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert default plans
INSERT INTO public.plans (name, max_users, price_clp) VALUES
  ('Starter', 3, 29990),
  ('Pro', 6, 59990),
  ('Premium', NULL, 99990);

-- 2. Workshops table
CREATE TABLE public.workshops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Subscriptions table
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id UUID NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.plans(id),
  status subscription_status NOT NULL DEFAULT 'trial',
  max_users INTEGER, -- Snapshot from plan at subscription time
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Profiles table (linked to auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  workshop_id UUID REFERENCES public.workshops(id) ON DELETE SET NULL, -- NULL for SUPERADMIN
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role app_role NOT NULL DEFAULT 'STAFF',
  status user_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. User roles table (for has_role function)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- 6. Invites table
CREATE TABLE public.invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id UUID NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role app_role NOT NULL DEFAULT 'STAFF',
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  status invite_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days')
);

-- 7. Contacts table
CREATE TABLE public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id UUID NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  vehicle_brand TEXT,
  vehicle_model TEXT,
  vehicle_year INTEGER,
  tags TEXT[],
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Conversations table
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id UUID NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  status conversation_status NOT NULL DEFAULT 'new',
  assigned_to_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. Messages table
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id UUID NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction message_direction NOT NULL,
  text TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. Appointments table
CREATE TABLE public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id UUID NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  service_type TEXT NOT NULL,
  start_datetime TIMESTAMPTZ NOT NULL,
  end_datetime TIMESTAMPTZ NOT NULL,
  assigned_to_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status appointment_status NOT NULL DEFAULT 'scheduled',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 11. Bot settings table
CREATE TABLE public.bot_settings (
  workshop_id UUID PRIMARY KEY REFERENCES public.workshops(id) ON DELETE CASCADE,
  business_description TEXT,
  services_json JSONB DEFAULT '[]'::jsonb,
  faq_json JSONB DEFAULT '[]'::jsonb,
  urgency_rules_json JSONB DEFAULT '[]'::jsonb,
  tone TEXT DEFAULT 'professional',
  handoff_rules_json JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 12. Automations settings table
CREATE TABLE public.automations_settings (
  workshop_id UUID PRIMARY KEY REFERENCES public.workshops(id) ON DELETE CASCADE,
  confirm_24h BOOLEAN NOT NULL DEFAULT true,
  remind_3h BOOLEAN NOT NULL DEFAULT true,
  followup_no_booking BOOLEAN NOT NULL DEFAULT false,
  reengagement_6_months BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workshops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automations_settings ENABLE ROW LEVEL SECURITY;

-- Security definer function to check if user is SUPERADMIN
CREATE OR REPLACE FUNCTION public.is_superadmin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND role = 'SUPERADMIN'
  )
$$;

-- Security definer function to get user's workshop_id
CREATE OR REPLACE FUNCTION public.get_user_workshop_id(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT workshop_id FROM public.profiles WHERE id = _user_id
$$;

-- Security definer function to check role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND role = _role
  )
$$;

-- Function to get workshop seat info
CREATE OR REPLACE FUNCTION public.get_workshop_seats(_workshop_id UUID)
RETURNS TABLE(used_seats INTEGER, max_seats INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    (SELECT COUNT(*)::INTEGER FROM public.profiles WHERE workshop_id = _workshop_id AND status != 'disabled') +
    (SELECT COUNT(*)::INTEGER FROM public.invites WHERE workshop_id = _workshop_id AND status = 'pending') AS used_seats,
    (SELECT s.max_users FROM public.subscriptions s WHERE s.workshop_id = _workshop_id AND s.status IN ('active', 'trial') ORDER BY s.started_at DESC LIMIT 1) AS max_seats
$$;

-- RLS Policies

-- Plans: Everyone can read
CREATE POLICY "Anyone can view plans" ON public.plans FOR SELECT USING (true);

-- Workshops policies
CREATE POLICY "SUPERADMIN can view all workshops" ON public.workshops
  FOR SELECT USING (public.is_superadmin(auth.uid()));

CREATE POLICY "Users can view their own workshop" ON public.workshops
  FOR SELECT USING (id = public.get_user_workshop_id(auth.uid()));

CREATE POLICY "SUPERADMIN can update all workshops" ON public.workshops
  FOR UPDATE USING (public.is_superadmin(auth.uid()));

CREATE POLICY "ADMIN can update their workshop" ON public.workshops
  FOR UPDATE USING (
    id = public.get_user_workshop_id(auth.uid()) AND
    public.has_role(auth.uid(), 'ADMIN')
  );

CREATE POLICY "Anyone can insert workshops" ON public.workshops
  FOR INSERT WITH CHECK (true);

-- Subscriptions policies
CREATE POLICY "SUPERADMIN can view all subscriptions" ON public.subscriptions
  FOR SELECT USING (public.is_superadmin(auth.uid()));

CREATE POLICY "Users can view their workshop subscriptions" ON public.subscriptions
  FOR SELECT USING (workshop_id = public.get_user_workshop_id(auth.uid()));

CREATE POLICY "SUPERADMIN can manage all subscriptions" ON public.subscriptions
  FOR ALL USING (public.is_superadmin(auth.uid()));

CREATE POLICY "System can insert subscriptions" ON public.subscriptions
  FOR INSERT WITH CHECK (true);

-- Profiles policies
CREATE POLICY "SUPERADMIN can view all profiles" ON public.profiles
  FOR SELECT USING (public.is_superadmin(auth.uid()));

CREATE POLICY "Users can view profiles in their workshop" ON public.profiles
  FOR SELECT USING (
    workshop_id = public.get_user_workshop_id(auth.uid()) OR
    id = auth.uid()
  );

CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY "ADMIN can update profiles in their workshop" ON public.profiles
  FOR UPDATE USING (
    workshop_id = public.get_user_workshop_id(auth.uid()) AND
    public.has_role(auth.uid(), 'ADMIN')
  );

CREATE POLICY "System can insert profiles" ON public.profiles
  FOR INSERT WITH CHECK (true);

-- User roles policies
CREATE POLICY "Users can view their own roles" ON public.user_roles
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "SUPERADMIN can view all roles" ON public.user_roles
  FOR SELECT USING (public.is_superadmin(auth.uid()));

CREATE POLICY "System can manage roles" ON public.user_roles
  FOR ALL USING (true);

-- Invites policies
CREATE POLICY "SUPERADMIN can view all invites" ON public.invites
  FOR SELECT USING (public.is_superadmin(auth.uid()));

CREATE POLICY "ADMIN can view invites in their workshop" ON public.invites
  FOR SELECT USING (
    workshop_id = public.get_user_workshop_id(auth.uid()) AND
    public.has_role(auth.uid(), 'ADMIN')
  );

CREATE POLICY "ADMIN can create invites in their workshop" ON public.invites
  FOR INSERT WITH CHECK (
    workshop_id = public.get_user_workshop_id(auth.uid()) AND
    public.has_role(auth.uid(), 'ADMIN')
  );

CREATE POLICY "ADMIN can update invites in their workshop" ON public.invites
  FOR UPDATE USING (
    workshop_id = public.get_user_workshop_id(auth.uid()) AND
    public.has_role(auth.uid(), 'ADMIN')
  );

CREATE POLICY "Anyone can view invite by token" ON public.invites
  FOR SELECT USING (true);

-- Contacts policies
CREATE POLICY "SUPERADMIN can view all contacts" ON public.contacts
  FOR SELECT USING (public.is_superadmin(auth.uid()));

CREATE POLICY "Users can view contacts in their workshop" ON public.contacts
  FOR SELECT USING (workshop_id = public.get_user_workshop_id(auth.uid()));

CREATE POLICY "Users can manage contacts in their workshop" ON public.contacts
  FOR ALL USING (workshop_id = public.get_user_workshop_id(auth.uid()));

-- Conversations policies
CREATE POLICY "SUPERADMIN can view all conversations" ON public.conversations
  FOR SELECT USING (public.is_superadmin(auth.uid()));

CREATE POLICY "Users can view conversations in their workshop" ON public.conversations
  FOR SELECT USING (workshop_id = public.get_user_workshop_id(auth.uid()));

CREATE POLICY "Users can manage conversations in their workshop" ON public.conversations
  FOR ALL USING (workshop_id = public.get_user_workshop_id(auth.uid()));

-- Messages policies
CREATE POLICY "SUPERADMIN can view all messages" ON public.messages
  FOR SELECT USING (public.is_superadmin(auth.uid()));

CREATE POLICY "Users can view messages in their workshop" ON public.messages
  FOR SELECT USING (workshop_id = public.get_user_workshop_id(auth.uid()));

CREATE POLICY "Users can manage messages in their workshop" ON public.messages
  FOR ALL USING (workshop_id = public.get_user_workshop_id(auth.uid()));

-- Appointments policies
CREATE POLICY "SUPERADMIN can view all appointments" ON public.appointments
  FOR SELECT USING (public.is_superadmin(auth.uid()));

CREATE POLICY "Users can view appointments in their workshop" ON public.appointments
  FOR SELECT USING (workshop_id = public.get_user_workshop_id(auth.uid()));

CREATE POLICY "Users can manage appointments in their workshop" ON public.appointments
  FOR ALL USING (workshop_id = public.get_user_workshop_id(auth.uid()));

-- Bot settings policies
CREATE POLICY "SUPERADMIN can view all bot_settings" ON public.bot_settings
  FOR SELECT USING (public.is_superadmin(auth.uid()));

CREATE POLICY "Users can view bot_settings in their workshop" ON public.bot_settings
  FOR SELECT USING (workshop_id = public.get_user_workshop_id(auth.uid()));

CREATE POLICY "ADMIN can manage bot_settings in their workshop" ON public.bot_settings
  FOR ALL USING (
    workshop_id = public.get_user_workshop_id(auth.uid()) AND
    public.has_role(auth.uid(), 'ADMIN')
  );

-- Automations settings policies
CREATE POLICY "SUPERADMIN can view all automations_settings" ON public.automations_settings
  FOR SELECT USING (public.is_superadmin(auth.uid()));

CREATE POLICY "Users can view automations_settings in their workshop" ON public.automations_settings
  FOR SELECT USING (workshop_id = public.get_user_workshop_id(auth.uid()));

CREATE POLICY "ADMIN can manage automations_settings in their workshop" ON public.automations_settings
  FOR ALL USING (
    workshop_id = public.get_user_workshop_id(auth.uid()) AND
    public.has_role(auth.uid(), 'ADMIN')
  );

-- Enable realtime for messages and conversations
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;

-- Trigger to create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
    COALESCE((NEW.raw_user_meta_data ->> 'role')::app_role, 'STAFF'),
    'active'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_bot_settings_updated_at
  BEFORE UPDATE ON public.bot_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_automations_settings_updated_at
  BEFORE UPDATE ON public.automations_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();