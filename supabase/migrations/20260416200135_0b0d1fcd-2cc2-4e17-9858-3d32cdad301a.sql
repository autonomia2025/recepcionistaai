ALTER TABLE public.landing_team 
  DROP CONSTRAINT landing_team_profile_id_fkey;

ALTER TABLE public.landing_team
  ADD CONSTRAINT landing_team_profile_id_fkey 
  FOREIGN KEY (profile_id) 
  REFERENCES public.profiles(id) 
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION public.accept_invite(invite_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_invite public.invites%ROWTYPE;
  v_user_email TEXT;
  v_user_name TEXT;
  v_workshop_name TEXT;
  v_profile_exists INTEGER;
BEGIN
  SELECT * INTO v_invite FROM public.invites WHERE token = invite_token LIMIT 1;
  IF v_invite.id IS NULL THEN RAISE EXCEPTION 'Invite not found'; END IF;
  IF v_invite.status <> 'pending' THEN RAISE EXCEPTION 'Invite already used'; END IF;
  IF v_invite.expires_at < now() THEN RAISE EXCEPTION 'Invite expired'; END IF;

  SELECT lower(email) INTO v_user_email FROM auth.users WHERE id = auth.uid();
  IF v_user_email IS NULL THEN RAISE EXCEPTION 'User not authenticated'; END IF;
  IF v_user_email <> lower(v_invite.email) THEN RAISE EXCEPTION 'Email mismatch'; END IF;

  UPDATE public.profiles
  SET workshop_id = v_invite.workshop_id,
      role = v_invite.role,
      status = 'active',
      zone = v_invite.zone
  WHERE id = auth.uid();

  GET DIAGNOSTICS v_profile_exists = ROW_COUNT;

  UPDATE public.invites SET status = 'accepted' WHERE id = v_invite.id;

  SELECT full_name INTO v_user_name FROM public.profiles WHERE id = auth.uid();

  IF v_profile_exists > 0 THEN
    INSERT INTO public.landing_team (workshop_id, profile_id, name, role, show_on_landing, sort_order)
    SELECT 
      v_invite.workshop_id,
      auth.uid(),
      COALESCE(v_user_name, v_user_email),
      CASE v_invite.role 
        WHEN 'ADMIN' THEN 'Administrador'
        WHEN 'STAFF' THEN 'Profesional'
        ELSE 'Equipo'
      END,
      true,
      COALESCE((SELECT MAX(sort_order) + 1 FROM public.landing_team WHERE workshop_id = v_invite.workshop_id), 0)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.landing_team 
      WHERE workshop_id = v_invite.workshop_id AND profile_id = auth.uid()
    );
  END IF;

  SELECT name INTO v_workshop_name FROM public.workshops WHERE id = v_invite.workshop_id;

  RETURN jsonb_build_object(
    'success', true,
    'workshop_id', v_invite.workshop_id,
    'workshop_name', v_workshop_name,
    'role', v_invite.role
  );
END;
$function$;