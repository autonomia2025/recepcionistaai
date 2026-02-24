-- Create quotation_items table for storing structured quotation data
CREATE TABLE public.quotation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  conversation_id uuid,
  
  -- Product/service data
  product_name text NOT NULL,
  quantity integer DEFAULT 1,
  unit text,
  
  -- Additional details
  duration text,
  location text,
  address text,
  use_type text,
  specifications jsonb DEFAULT '{}'::jsonb,
  
  -- Values
  unit_price numeric,
  total_price numeric,
  currency text DEFAULT 'CLP',
  
  -- Metadata
  extracted_at timestamp with time zone DEFAULT now(),
  confidence numeric DEFAULT 0.8,
  status text DEFAULT 'pending',
  
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.quotation_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view quotation_items in their workshop"
  ON public.quotation_items FOR SELECT
  USING (workshop_id = get_user_workshop_id(auth.uid()));

CREATE POLICY "Users can manage quotation_items in their workshop"
  ON public.quotation_items FOR ALL
  USING (workshop_id = get_user_workshop_id(auth.uid()));

CREATE POLICY "SUPERADMIN can view all quotation_items"
  ON public.quotation_items FOR SELECT
  USING (is_superadmin(auth.uid()));

-- Index for faster lookups
CREATE INDEX idx_quotation_items_contact ON public.quotation_items(contact_id);
CREATE INDEX idx_quotation_items_conversation ON public.quotation_items(conversation_id);
CREATE INDEX idx_quotation_items_workshop ON public.quotation_items(workshop_id);