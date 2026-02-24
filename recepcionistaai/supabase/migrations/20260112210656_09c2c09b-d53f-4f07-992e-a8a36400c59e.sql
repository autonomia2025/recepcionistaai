-- Allow public read access to workshops for booking page
CREATE POLICY "Anyone can view active workshops" 
ON public.workshops 
FOR SELECT 
USING (is_active = true);

-- Allow public read access to bot_settings for services
CREATE POLICY "Anyone can view bot_settings for active workshops" 
ON public.bot_settings 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.workshops w 
  WHERE w.id = workshop_id AND w.is_active = true
));

-- Allow public read access to profiles for team display
CREATE POLICY "Anyone can view active staff profiles" 
ON public.profiles 
FOR SELECT 
USING (status = 'active' AND workshop_id IS NOT NULL);

-- Allow public read access to calendar_events for availability check
CREATE POLICY "Anyone can view calendar events for availability" 
ON public.calendar_events 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.workshops w 
  WHERE w.id = workshop_id AND w.is_active = true
));

-- Allow public insert for contacts (for booking)
CREATE POLICY "Anyone can create contacts for booking" 
ON public.contacts 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM public.workshops w 
  WHERE w.id = workshop_id AND w.is_active = true
));

-- Allow public insert for appointments (for booking)
CREATE POLICY "Anyone can create appointments for booking" 
ON public.appointments 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM public.workshops w 
  WHERE w.id = workshop_id AND w.is_active = true
));

-- Allow public insert for calendar_events (for booking)
CREATE POLICY "Anyone can create calendar events for booking" 
ON public.calendar_events 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM public.workshops w 
  WHERE w.id = workshop_id AND w.is_active = true
));