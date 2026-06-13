-- Stop granting admin privileges automatically on signup.
-- Admin roles must be assigned deliberately by an existing admin or service-role operation.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, nome)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'nome', NEW.email))
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;
