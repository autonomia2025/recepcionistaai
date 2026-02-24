-- Create marketing_leads table for lead capture
CREATE TABLE public.marketing_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  company TEXT,
  industry TEXT,
  message TEXT,
  source TEXT DEFAULT 'website',
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  owner UUID REFERENCES public.profiles(id),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Enable RLS
ALTER TABLE public.marketing_leads ENABLE ROW LEVEL SECURITY;

-- SUPERADMIN can SELECT all leads
CREATE POLICY "SUPERADMIN can view all leads"
ON public.marketing_leads
FOR SELECT
USING (is_superadmin(auth.uid()));

-- SUPERADMIN can UPDATE leads
CREATE POLICY "SUPERADMIN can update leads"
ON public.marketing_leads
FOR UPDATE
USING (is_superadmin(auth.uid()));

-- SUPERADMIN can DELETE leads
CREATE POLICY "SUPERADMIN can delete leads"
ON public.marketing_leads
FOR DELETE
USING (is_superadmin(auth.uid()));

-- NO INSERT policy for authenticated users - only service role can insert
-- This is intentional: leads are only inserted via edge function with service role

-- Create index for common queries
CREATE INDEX idx_marketing_leads_status ON public.marketing_leads(status);
CREATE INDEX idx_marketing_leads_created_at ON public.marketing_leads(created_at DESC);
CREATE INDEX idx_marketing_leads_email ON public.marketing_leads(email);