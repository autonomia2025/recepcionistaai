// Shared datasheet helpers used by build-ai-reply (attachment resolution) and
// datasheet-coverage (reporting which SKUs still lack an attachable PDF).

export interface DatasheetDocument {
  id: string;
  file_name: string;
  file_type: string | null;
  storage_path: string;
  created_at?: string | null;
}

function stripAccents(str: string): string {
  return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeProductCode(str: string): string {
  return stripAccents(str).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function extractProductCodes(text: string): string[] {
  const matches = (text || '').match(/\b[A-Za-z][A-Za-z0-9\-\/]{2,40}\b/g) || [];
  const codes: string[] = [];

  for (const raw of matches) {
    if (!/[A-Za-z]/.test(raw) || !/[0-9]/.test(raw)) continue;
    const normalized = normalizeProductCode(raw);
    if (normalized.length >= 3 && !codes.includes(raw)) codes.push(raw);
  }

  return codes;
}

export function isPdfDocument(doc: { file_type?: string | null; file_name: string }): boolean {
  return (doc.file_type || '').toLowerCase().includes('pdf') || doc.file_name.toLowerCase().endsWith('.pdf');
}

// Resolve attachments independently from RAG ranking. A SKU can be present in
// catalogs/Excel guides as well as its original PDF, so the first knowledge
// match is not necessarily an attachable datasheet.
// deno-lint-ignore no-explicit-any
export async function resolvePdfDatasheet(
  supabase: any,
  workshopId: string,
  requestedCodes: string[],
): Promise<{ document: DatasheetDocument | null; matchedCode: string | null; ambiguous: boolean }> {
  let foundAmbiguousCode = false;

  for (const requestedCode of requestedCodes) {
    const normalizedCode = normalizeProductCode(requestedCode);
    if (normalizedCode.length < 3) continue;

    const { data: chunks, error: chunkError } = await supabase
      .from('bot_knowledge')
      .select('document_id, content')
      .eq('workshop_id', workshopId)
      .ilike('content', `%${requestedCode}%`)
      .limit(100);

    if (chunkError) {
      console.error('Datasheet candidate search failed:', { requestedCode, error: chunkError });
      continue;
    }

    const documentIds = [...new Set((chunks || []).map((chunk: { document_id?: string | null }) => chunk.document_id).filter(Boolean))];
    if (documentIds.length === 0) continue;

    const { data: documents, error: documentsError } = await supabase
      .from('bot_documents')
      .select('id, file_name, file_type, storage_path, created_at')
      .eq('workshop_id', workshopId)
      .in('id', documentIds)
      .not('storage_path', 'is', null);

    if (documentsError) {
      console.error('Datasheet document lookup failed:', { requestedCode, error: documentsError });
      continue;
    }

    const pdfCandidates = ((documents || []) as DatasheetDocument[])
      .filter(doc => Boolean(doc.storage_path) && isPdfDocument(doc))
      .map(doc => {
        const normalizedFile = normalizeProductCode(doc.file_name.replace(/\.pdf$/i, ''));
        const exactFileCode = normalizedFile.endsWith(normalizedCode);
        return { doc, exactFileCode };
      });

    const exactCandidates = pdfCandidates.filter(candidate => candidate.exactFileCode);
    const candidates = exactCandidates.length > 0 ? exactCandidates : pdfCandidates;

    // A broad family code such as SOC250 may match several PDFs. Never choose
    // one arbitrarily, but keep checking later context for a complete model.
    if (candidates.length > 1) {
      foundAmbiguousCode = true;
      continue;
    }

    if (candidates.length === 1) {
      return { document: candidates[0].doc, matchedCode: requestedCode, ambiguous: false };
    }
  }

  return { document: null, matchedCode: null, ambiguous: foundAmbiguousCode };
}
