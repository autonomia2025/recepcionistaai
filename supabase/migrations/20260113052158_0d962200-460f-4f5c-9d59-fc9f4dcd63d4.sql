-- Create table for tracking API usage and costs
CREATE TABLE public.api_usage (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workshop_id UUID REFERENCES public.workshops(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- WhatsApp metrics
  whatsapp_messages_sent INTEGER NOT NULL DEFAULT 0,
  whatsapp_messages_received INTEGER NOT NULL DEFAULT 0,
  whatsapp_cost_usd DECIMAL(10,4) NOT NULL DEFAULT 0,
  
  -- AI metrics  
  ai_calls INTEGER NOT NULL DEFAULT 0,
  ai_tokens_used INTEGER NOT NULL DEFAULT 0,
  ai_cost_usd DECIMAL(10,4) NOT NULL DEFAULT 0,
  
  -- Conversation metrics
  conversations_handled INTEGER NOT NULL DEFAULT 0,
  conversations_auto_resolved INTEGER NOT NULL DEFAULT 0,
  
  -- Time saved (in minutes)
  estimated_minutes_saved INTEGER NOT NULL DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(workshop_id, usage_date)
);

-- Create table for global platform statistics (for superadmin)
CREATE TABLE public.platform_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  stat_date DATE NOT NULL UNIQUE DEFAULT CURRENT_DATE,
  
  -- Totals
  total_workshops INTEGER NOT NULL DEFAULT 0,
  active_workshops INTEGER NOT NULL DEFAULT 0,
  total_conversations INTEGER NOT NULL DEFAULT 0,
  total_messages INTEGER NOT NULL DEFAULT 0,
  
  -- Costs
  total_whatsapp_cost_usd DECIMAL(10,4) NOT NULL DEFAULT 0,
  total_ai_cost_usd DECIMAL(10,4) NOT NULL DEFAULT 0,
  
  -- Value metrics
  total_minutes_saved INTEGER NOT NULL DEFAULT 0,
  total_auto_resolved INTEGER NOT NULL DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_stats ENABLE ROW LEVEL SECURITY;

-- Policies for api_usage
CREATE POLICY "SUPERADMIN can view all api_usage"
ON public.api_usage FOR SELECT
USING (is_superadmin(auth.uid()));

CREATE POLICY "SUPERADMIN can manage all api_usage"
ON public.api_usage FOR ALL
USING (is_superadmin(auth.uid()))
WITH CHECK (is_superadmin(auth.uid()));

CREATE POLICY "ADMIN can view their workshop api_usage"
ON public.api_usage FOR SELECT
USING (workshop_id = get_user_workshop_id(auth.uid()));

-- Policies for platform_stats (superadmin only)
CREATE POLICY "SUPERADMIN can view platform_stats"
ON public.platform_stats FOR SELECT
USING (is_superadmin(auth.uid()));

CREATE POLICY "SUPERADMIN can manage platform_stats"
ON public.platform_stats FOR ALL
USING (is_superadmin(auth.uid()))
WITH CHECK (is_superadmin(auth.uid()));

-- Create trigger for updated_at
CREATE TRIGGER update_api_usage_updated_at
BEFORE UPDATE ON public.api_usage
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();