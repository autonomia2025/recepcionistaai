-- First drop the old constraint
ALTER TABLE public.workshops DROP CONSTRAINT IF EXISTS workshops_booking_mode_check;

-- Now update existing values
UPDATE public.workshops SET booking_mode = 'with_scheduling' WHERE booking_mode = 'landing_slots';

-- Add new constraint with updated values
ALTER TABLE public.workshops ADD CONSTRAINT workshops_booking_mode_check 
CHECK (booking_mode IN ('with_scheduling', 'chatbot_only'));