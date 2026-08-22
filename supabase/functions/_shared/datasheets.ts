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
  const raw = text || '';
  const tokens = raw.match(/\b[A-Za-z0-9][A-Za-z0-9\-\/]{0,40}\b/g) || [];
  const codes: string[] = [];

  const push = (candidate: string) => {
    if (!/[A-Za-z]/.test(candidate) || !/[0-9]/.test(candidate)) return;
    const normalized = normalizeProductCode(candidate);
    if (normalized.length < 3) return;
    if (!codes.some(existing => normalizeProductCode(existing) === normalized)) codes.push(candidate);
  };

  // Codes typed with a space ("soc170 13ef") must resolve like "SOC170-13EF",
  // so adjacent tokens are also tested as a single merged candidate.
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.length >= 3) push(token);

    const next = tokens[i + 1];
    if (!next) continue;
    const merged = `${token}${next}`;
    if (merged.length <= 41 && /^[A-Za-z0-9\-\/]+$/.test(merged)) push(merged);
  }

  // Longer (more specific) codes first so a full model wins over its family code.
  return codes.sort((a, b) => normalizeProductCode(b).length - normalizeProductCode(a).length);
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

    // Prefer the original PDF inventory itself. Extracted/OCR text may format a
    // SKU differently (spaces, missing separators), while uploaded filenames
    // consistently carry the canonical product code.
    const { data: inventoryDocuments, error: inventoryError } = await supabase
      .from('bot_documents')
      .select('id, file_name, file_type, storage_path, created_at')
      .eq('workshop_id', workshopId)
      .not('storage_path', 'is', null)
      .limit(1000);

    if (inventoryError) {
      console.error('Datasheet inventory lookup failed:', { requestedCode, error: inventoryError });
    } else {
      const filenameCandidates = ((inventoryDocuments || []) as DatasheetDocument[])
        .filter(doc => Boolean(doc.storage_path) && isPdfDocument(doc))
        .filter(doc => normalizeProductCode(doc.file_name.replace(/\.pdf$/i, '')).endsWith(normalizedCode));

      if (filenameCandidates.length === 1) {
        return { document: filenameCandidates[0], matchedCode: requestedCode, ambiguous: false };
      }
      if (filenameCandidates.length > 1) {
        foundAmbiguousCode = true;
        continue;
      }
    }

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
