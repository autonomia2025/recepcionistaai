-- Add booking_mode column to workshops
ALTER TABLE workshops 
ADD COLUMN IF NOT EXISTS booking_mode text NOT NULL DEFAULT 'landing_slots';

-- Add check constraint for booking_mode
ALTER TABLE workshops 
ADD CONSTRAINT workshops_booking_mode_check 
CHECK (booking_mode IN ('landing_slots', 'internal_requests'));

-- Add category column to workshops
ALTER TABLE workshops 
ADD COLUMN IF NOT EXISTS category text;

-- Create ENUM types for service requests
DO $$ BEGIN
  CREATE TYPE service_request_status AS ENUM (
    'new',
    'contacting',
    'waiting_customer',
    'scheduled_visit',
    'quoted',
    'approved',
    'in_progress',
    'done',
    'lost'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE request_urgency AS ENUM ('low', 'medium', 'high');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE request_source AS ENUM ('whatsapp', 'manual', 'web');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create service_requests table
CREATE TABLE IF NOT EXISTS service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  
  -- Request data
  service_category text NOT NULL,
  description text,
  address text,
  comuna text,
  preferred_time_window text,
  urgency request_urgency NOT NULL DEFAULT 'medium',
  
  -- Management
  status service_request_status NOT NULL DEFAULT 'new',
  assigned_staff_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  estimated_value numeric,
  notes text,
  source request_source NOT NULL DEFAULT 'manual',
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on service_requests
ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;

-- RLS Policies for service_requests

-- Superadmin can manage all service_requests
CREATE POLICY "SUPERADMIN can manage all service_requests"
ON service_requests FOR ALL
USING (is_superadmin(auth.uid()))
WITH CHECK (is_superadmin(auth.uid()));

-- Admin can manage service_requests in their workshop
CREATE POLICY "ADMIN can manage service_requests in their workshop"
ON service_requests FOR ALL
USING (
  workshop_id = get_user_workshop_id(auth.uid()) 
  AND has_role(auth.uid(), 'ADMIN'::app_role)
)
WITH CHECK (
  workshop_id = get_user_workshop_id(auth.uid()) 
  AND has_role(auth.uid(), 'ADMIN'::app_role)
);

-- Staff can view service_requests assigned to them
CREATE POLICY "Staff can view assigned service_requests"
ON service_requests FOR SELECT
USING (
  workshop_id = get_user_workshop_id(auth.uid()) 
  AND assigned_staff_id = auth.uid()
);

-- Staff can update service_requests assigned to them
CREATE POLICY "Staff can update assigned service_requests"
ON service_requests FOR UPDATE
USING (
  workshop_id = get_user_workshop_id(auth.uid()) 
  AND assigned_staff_id = auth.uid()
)
WITH CHECK (
  workshop_id = get_user_workshop_id(auth.uid()) 
  AND assigned_staff_id = auth.uid()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_service_requests_workshop ON service_requests(workshop_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_status ON service_requests(status);
CREATE INDEX IF NOT EXISTS idx_service_requests_assigned ON service_requests(assigned_staff_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_contact ON service_requests(contact_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_created ON service_requests(created_at DESC);

-- Create trigger for updated_at
CREATE TRIGGER update_service_requests_updated_at
BEFORE UPDATE ON service_requests
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Enable realtime for service_requests
ALTER PUBLICATION supabase_realtime ADD TABLE service_requests;