-- F2 · Tarea 4 — PDF oficial de la cotización (solo agrega).
--
-- El PDF se genera en el navegador al generar la cotización oficial y se sube al
-- bucket privado 'quotations' en {workshop_id}/quotes/{número}.pdf.
-- set_quote_pdf() lo registra en la cotización:
--   · solo si la cotización ya es oficial (no un borrador),
--   · solo con la ruta esperada y si el archivo existe,
--   · una sola vez: nunca reemplaza un PDF ya registrado.
-- Además, los PDF oficiales (carpeta /quotes/) no se pueden sobrescribir ni
-- borrar desde la aplicación. Los archivos del flujo manual ("Marcar cotización
-- enviada") viven en otra ruta y no cambian.
-- Idempotente.

CREATE OR REPLACE FUNCTION public.set_quote_pdf(_quote_id uuid, _path text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _q public.quotes%ROWTYPE;
  _expected text;
BEGIN
  SELECT * INTO _q FROM public.quotes WHERE id = _quote_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotización no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_work_quote(_q.workshop_id, _q.contact_id) THEN
    RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
  END IF;
  IF _q.status = 'draft' OR _q.quote_number IS NULL THEN
    RAISE EXCEPTION 'Solo una cotización oficial tiene PDF' USING ERRCODE = '55000';
  END IF;
  IF _q.pdf_path IS NOT NULL THEN
    RETURN _q.pdf_path;   -- already registered: never replaced
  END IF;

  _expected := _q.workshop_id::text || '/quotes/' || _q.quote_number || '.pdf';
  IF _path IS DISTINCT FROM _expected THEN
    RAISE EXCEPTION 'Ruta de PDF inválida' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'quotations' AND o.name = _expected) THEN
    RAISE EXCEPTION 'El PDF no está subido' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.quotes SET pdf_path = _expected WHERE id = _quote_id;
  RETURN _expected;
END;
$$;

REVOKE ALL ON FUNCTION public.set_quote_pdf(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_quote_pdf(uuid, text) TO authenticated;

-- Official PDFs cannot be overwritten or deleted from the app.
DROP POLICY IF EXISTS "official_quote_pdfs_no_update" ON storage.objects;
CREATE POLICY "official_quote_pdfs_no_update" ON storage.objects
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (bucket_id = 'quotations' AND name LIKE '%/quotes/%'));

DROP POLICY IF EXISTS "official_quote_pdfs_no_delete" ON storage.objects;
CREATE POLICY "official_quote_pdfs_no_delete" ON storage.objects
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (bucket_id = 'quotations' AND name LIKE '%/quotes/%'));

-- The generated types mark quote_lines.workshop_id as required on insert, so the
-- app sends it. Allow the column; quote_lines_before_write always overwrites it
-- with the quote's workshop, so a wrong value can never be stored.
GRANT INSERT (workshop_id) ON public.quote_lines TO authenticated;
