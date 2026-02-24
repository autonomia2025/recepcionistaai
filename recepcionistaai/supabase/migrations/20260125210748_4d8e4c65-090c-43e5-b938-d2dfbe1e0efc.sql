-- Create secure table for Gmail OAuth tokens (service role only access)
CREATE TABLE public.workshop_gmail_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id UUID NOT NULL UNIQUE REFERENCES public.workshops(id) ON DELETE CASCADE,
  gmail_email TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  token_expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS but with NO user-facing policies (service role only)
ALTER TABLE public.workshop_gmail_tokens ENABLE ROW LEVEL SECURITY;

-- Only service role can access this table (no policies = no user access)
-- This ensures tokens are NEVER visible to ADMIN/STAFF

-- Add trigger for updated_at
CREATE TRIGGER update_workshop_gmail_tokens_updated_at
  BEFORE UPDATE ON public.workshop_gmail_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster lookups
CREATE INDEX idx_workshop_gmail_tokens_workshop_id ON public.workshop_gmail_tokens(workshop_id);

-- Add comment for documentation
COMMENT ON TABLE public.workshop_gmail_tokens IS 'Secure storage for Gmail OAuth tokens. Access restricted to service role only for security.';