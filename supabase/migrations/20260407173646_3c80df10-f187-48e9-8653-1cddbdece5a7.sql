ALTER TABLE public.contacts
ADD COLUMN quote_sent boolean DEFAULT false,
ADD COLUMN quote_sent_at timestamp with time zone DEFAULT NULL;