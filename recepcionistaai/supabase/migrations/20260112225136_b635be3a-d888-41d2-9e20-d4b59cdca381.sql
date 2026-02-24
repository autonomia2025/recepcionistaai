-- Add did_schedule field to contacts for tracking if client scheduled an appointment
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS did_schedule boolean DEFAULT false;

-- Add schedule_confidence field for AI confidence in schedule detection
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS schedule_confidence numeric DEFAULT NULL;

-- Add lead_score_reasoning field for AI explanation
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS lead_score_reasoning text DEFAULT NULL;