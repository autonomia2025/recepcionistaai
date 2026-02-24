-- Allow public SELECT on contacts for checking existing contact by phone during booking
CREATE POLICY "Anyone can check existing contacts for booking" 
ON public.contacts 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.workshops w 
  WHERE w.id = workshop_id AND w.is_active = true
));