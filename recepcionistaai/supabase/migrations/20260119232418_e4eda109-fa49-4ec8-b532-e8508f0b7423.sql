-- Create workshop_billing table for billing/invoicing data per workshop
CREATE TABLE public.workshop_billing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL UNIQUE REFERENCES public.workshops(id) ON DELETE CASCADE,
  
  -- Setup/Onboarding
  setup_fee_clp numeric DEFAULT 0,
  setup_fee_paid boolean DEFAULT false,
  setup_paid_at timestamp with time zone,
  setup_notes text,
  
  -- Monthly billing
  monthly_fee_clp numeric DEFAULT 0,
  billing_day integer DEFAULT 1 CHECK (billing_day >= 1 AND billing_day <= 28),
  next_billing_date date,
  
  -- Discounts
  discount_percent numeric DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  discount_ends_at date,
  
  -- Payment status
  payment_status text DEFAULT 'pending' CHECK (payment_status IN ('pending', 'current', 'overdue')),
  last_payment_date date,
  last_payment_amount numeric,
  
  -- Payment method
  payment_method text,
  
  -- Billing contact info
  billing_contact_name text,
  billing_contact_email text,
  billing_contact_phone text,
  rut text,
  razon_social text,
  
  -- Internal notes
  internal_notes text,
  
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Create payment_records table for payment history
CREATE TABLE public.payment_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  
  payment_type text NOT NULL CHECK (payment_type IN ('setup', 'monthly', 'extra')),
  amount_clp numeric NOT NULL,
  payment_date date NOT NULL,
  payment_method text,
  
  -- Period covered (for monthly payments)
  period_start date,
  period_end date,
  
  -- Receipt info
  receipt_number text,
  notes text,
  
  -- Who recorded this
  recorded_by uuid REFERENCES public.profiles(id),
  
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.workshop_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;

-- RLS Policies for workshop_billing (SUPERADMIN only)
CREATE POLICY "SUPERADMIN can manage all workshop_billing"
ON public.workshop_billing
FOR ALL
USING (is_superadmin(auth.uid()))
WITH CHECK (is_superadmin(auth.uid()));

CREATE POLICY "SUPERADMIN can view all workshop_billing"
ON public.workshop_billing
FOR SELECT
USING (is_superadmin(auth.uid()));

-- RLS Policies for payment_records (SUPERADMIN only)
CREATE POLICY "SUPERADMIN can manage all payment_records"
ON public.payment_records
FOR ALL
USING (is_superadmin(auth.uid()))
WITH CHECK (is_superadmin(auth.uid()));

CREATE POLICY "SUPERADMIN can view all payment_records"
ON public.payment_records
FOR SELECT
USING (is_superadmin(auth.uid()));

-- Create trigger to update updated_at
CREATE TRIGGER update_workshop_billing_updated_at
BEFORE UPDATE ON public.workshop_billing
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to auto-create billing record when workshop is created
CREATE OR REPLACE FUNCTION public.create_workshop_billing()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.workshop_billing (workshop_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$;

-- Create trigger to auto-create billing record
CREATE TRIGGER create_workshop_billing_trigger
AFTER INSERT ON public.workshops
FOR EACH ROW
EXECUTE FUNCTION public.create_workshop_billing();

-- Create billing records for existing workshops
INSERT INTO public.workshop_billing (workshop_id)
SELECT id FROM public.workshops
WHERE id NOT IN (SELECT workshop_id FROM public.workshop_billing);