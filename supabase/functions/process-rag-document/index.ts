import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ===== PDF helpers =====

// Convert Uint8Array to base64 in chunks (avoids stack overflow on large buffers)
function bufferToBase64(buffer: Uint8Array): string {
  let binary = '';
  const chunkSize = 32768;
  for (let i = 0; i < buffer.length; i += chunkSize) {
    const chunk = buffer.subarray(i, Math.min(i + chunkSize, buffer.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

// Extract text from a single PDF batch using Gemini
async function extractPDFBatch(buffer: Uint8Array, apiKey: string, label: string): Promise<string> {
  const base64 = bufferToBase64(buffer);

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extrae TODO el texto de este PDF. Solo devuelve el texto extraído, sin comentarios. Si hay tablas, conviértelas a texto plano. Mantén la estructura y los párrafos.'
            },
            {
              type: 'file',
              file: {
                filename: 'document.pdf',
                file_data: `data:application/pdf;base64,${base64}`
              }
            }
          ]
        }
      ],
      max_tokens: 32000,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`PDF batch ${label} extraction failed:`, response.status, err);
    throw new Error(`Error procesando ${label}`);
  }

  const result = await response.json();
  return result.choices?.[0]?.message?.content || '';
}

// Extract text from PDF — splits into batches of N pages for large files
async function extractTextFromPDF(
  buffer: Uint8Array,
  apiKey: string,
  onProgress?: (processed: number, total: number) => Promise<void>
): Promise<string> {
  try {
    const PDFLib = await import("https://esm.sh/pdf-lib@1.17.1");
    const srcDoc = await PDFLib.PDFDocument.load(buffer, { ignoreEncryption: true });
    const totalPages = srcDoc.getPageCount();

    console.log(`PDF has ${totalPages} pages`);

    const BATCH_SIZE = 10;

    // Small PDFs (≤ 10 pages): single call
    if (totalPages <= BATCH_SIZE) {
      if (onProgress) await onProgress(0, totalPages);
      const text = await extractPDFBatch(buffer, apiKey, `PDF (${totalPages} págs)`);
      if (onProgress) await onProgress(totalPages, totalPages);
      return text;
    }

    // Large PDFs: split into batches and process sequentially (avoids rate limits)
    const allTexts: string[] = [];
    let processed = 0;
    if (onProgress) await onProgress(0, totalPages);

    for (let start = 0; start < totalPages; start += BATCH_SIZE) {
      const end = Math.min(start + BATCH_SIZE, totalPages);
      const batchDoc = await PDFLib.PDFDocument.create();
      const indices = Array.from({ length: end - start }, (_, i) => start + i);
      const copied = await batchDoc.copyPages(srcDoc, indices);
      copied.forEach((p) => batchDoc.addPage(p));
      const batchBytes = await batchDoc.save();

      const label = `págs ${start + 1}-${end}`;
      let batchText = '';
      let attempts = 0;
      while (attempts < 2) {
        try {
          batchText = await extractPDFBatch(batchBytes, apiKey, label);
          break;
        } catch (e) {
          attempts++;
          if (attempts >= 2) {
            console.error(`Batch ${label} failed after retries, skipping`);
            batchText = `[No se pudo extraer ${label}]`;
          } else {
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      }

      if (batchText) allTexts.push(`=== PÁGINAS ${start + 1}-${end} ===\n${batchText}`);
      processed = end;
      if (onProgress) await onProgress(processed, totalPages);

      // Small delay between batches to respect rate limits
      if (end < totalPages) await new Promise(r => setTimeout(r, 500));
    }

    return allTexts.join('\n\n');
  } catch (error) {
    console.error('PDF extraction error:', error);
    throw new Error('Error al extraer texto del PDF. Asegúrate de que el PDF contenga texto legible.');
  }
}

// Extract text from Word documents (DOCX) using JSZip
async function extractTextFromWord(buffer: Uint8Array): Promise<string> {
  try {
    const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
    const zip = await JSZip.loadAsync(buffer);

    // DOCX stores content in word/document.xml
    const documentFile = zip.files['word/document.xml'];
    if (!documentFile) {
      throw new Error('No se encontró el contenido del documento');
    }

    const content = await documentFile.async('string');

    // Extract text from <w:t> tags (Word text elements)
    const textMatches = content.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
    const text = textMatches
      .map(match => match.replace(/<\/?w:t[^>]*>/g, ''))
      .join(' ');

    // Also handle paragraph breaks
    return text.replace(/\s+/g, ' ').trim();
  } catch (error) {
    console.error('Word extraction error:', error);
    throw new Error('Error al extraer texto del documento Word');
  }
}

// Extract text from Excel (XLSX) using JSZip - full row-by-row extraction
async function extractTextFromExcel(buffer: Uint8Array): Promise<string> {
  try {
    const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
    const zip = await JSZip.loadAsync(buffer);

    // 1. Build shared strings lookup
    const sharedStrings: string[] = [];
    const sharedStringsFile = zip.files['xl/sharedStrings.xml'];
    if (sharedStringsFile) {
      const content = await sharedStringsFile.async('string');
      // Each <si> is one shared string entry; collect all <t> text inside it
      const siMatches = content.match(/<si>([\s\S]*?)<\/si>/g) || [];
      for (const si of siMatches) {
        const tMatches = si.match(/<t[^>]*>([^<]*)<\/t>/g) || [];
        const combined = tMatches.map(t => t.replace(/<\/?t[^>]*>/g, '')).join('');
        sharedStrings.push(combined);
      }
    }

    const allSheetTexts: string[] = [];

    // 2. Process each sheet
    const sheetFiles = Object.keys(zip.files)
      .filter(name => name.startsWith('xl/worksheets/sheet') && name.endsWith('.xml'))
      .sort();

    for (const sheetFile of sheetFiles) {
      const content = await zip.files[sheetFile].async('string');

      // Extract all <row> elements
      const rowMatches = content.match(/<row[^>]*>([\s\S]*?)<\/row>/g) || [];
      const rows: string[][] = [];

      for (const rowXml of rowMatches) {
        const cellMatches = rowXml.match(/<c[^>]*>([\s\S]*?)<\/c>|<c[^\/]*\/>/g) || [];
        const cellValues: string[] = [];

        for (const cellXml of cellMatches) {
          // Check cell type: t="s" = shared string, t="inlineStr" = inline, else number/formula
          const typeMatch = cellXml.match(/\bt="([^"]*)"/);
          const cellType = typeMatch ? typeMatch[1] : '';
          const valueMatch = cellXml.match(/<v>([^<]*)<\/v>/);
          const inlineMatch = cellXml.match(/<t[^>]*>([^<]*)<\/t>/);

          let value = '';
          if (cellType === 's' && valueMatch) {
            // Shared string index
            const idx = parseInt(valueMatch[1], 10);
            value = sharedStrings[idx] ?? valueMatch[1];
          } else if (cellType === 'inlineStr' && inlineMatch) {
            value = inlineMatch[1];
          } else if (valueMatch) {
            value = valueMatch[1];
          } else if (inlineMatch) {
            value = inlineMatch[1];
          }

          cellValues.push(value.trim());
        }

        if (cellValues.some(v => v.length > 0)) {
          rows.push(cellValues);
        }
      }

      if (rows.length === 0) continue;

      // Format as readable text: first row as header, rest as "Header: Value" pairs
      const header = rows[0];
      const hasHeader = header.some(h => h.length > 0 && isNaN(Number(h)));

      if (hasHeader && rows.length > 1) {
        for (let r = 1; r < rows.length; r++) {
          const parts: string[] = [];
          for (let c = 0; c < Math.max(header.length, rows[r].length); c++) {
            const h = header[c] || `Col${c + 1}`;
            const v = rows[r][c] || '';
            if (v) parts.push(`${h}: ${v}`);
          }
          if (parts.length > 0) {
            allSheetTexts.push(parts.join(' | '));
          }
        }
      } else {
        // No clear header - just join all cells
        for (const row of rows) {
          const line = row.filter(v => v).join(' | ');
          if (line) allSheetTexts.push(line);
        }
      }
    }

    const result = allSheetTexts.join('\n');
    console.log('Excel extraction result length:', result.length, 'rows:', allSheetTexts.length);
    return result;
  } catch (error) {
    console.error('Excel extraction error:', error);
    throw new Error('Error al extraer texto del archivo Excel');
  }
}

// Extract text from PowerPoint (PPTX) using JSZip
async function extractTextFromPowerPoint(buffer: Uint8Array): Promise<string> {
  try {
    const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
    const zip = await JSZip.loadAsync(buffer);

    const textParts: string[] = [];

    // Get slide files
    const slideFiles = Object.keys(zip.files)
      .filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'))
      .sort();

    for (const slideFile of slideFiles) {
      const content = await zip.files[slideFile].async('string');

      // Extract text from <a:t> tags (PowerPoint text elements)
      const textMatches = content.match(/<a:t>([^<]*)<\/a:t>/g) || [];
      const slideText = textMatches
        .map(match => match.replace(/<\/?a:t>/g, ''))
        .filter(text => text.trim())
        .join(' ');

      if (slideText.trim()) {
        textParts.push(slideText);
      }
    }

    return textParts.join('\n\n');
  } catch (error) {
    console.error('PowerPoint extraction error:', error);
    throw new Error('Error al extraer texto de la presentación');
  }
}

// Extract text based on file type
async function extractText(
  buffer: Uint8Array,
  fileType: string,
  fileName: string,
  apiKey: string,
  onProgress?: (processed: number, total: number) => Promise<void>
): Promise<string> {
  const extension = fileName.toLowerCase().split('.').pop() || '';

  console.log('Extracting text from:', { fileType, extension, bufferSize: buffer.length });

  // PDF - use Gemini Vision
  if (fileType === 'application/pdf' || extension === 'pdf') {
    return await extractTextFromPDF(buffer, apiKey, onProgress);
  }

  // Word documents (DOCX)
  if (fileType.includes('wordprocessingml') || extension === 'docx') {
    return await extractTextFromWord(buffer);
  }

  // Old Word format (.doc)
  if (fileType === 'application/msword' || extension === 'doc') {
    throw new Error('Los archivos .doc antiguos no son compatibles. Por favor, guarda el documento como .docx');
  }

  // Excel (XLSX)
  if (fileType.includes('spreadsheetml') || extension === 'xlsx') {
    return await extractTextFromExcel(buffer);
  }

  // Old Excel format (.xls)
  if (fileType === 'application/vnd.ms-excel' || extension === 'xls') {
    throw new Error('Los archivos .xls antiguos no son compatibles. Por favor, guarda el archivo como .xlsx');
  }

  // PowerPoint (PPTX)
  if (fileType.includes('presentationml') || extension === 'pptx') {
    return await extractTextFromPowerPoint(buffer);
  }

  // Old PowerPoint format (.ppt)
  if (fileType === 'application/vnd.ms-powerpoint' || extension === 'ppt') {
    throw new Error('Los archivos .ppt antiguos no son compatibles. Por favor, guarda el archivo como .pptx');
  }

  // Plain text files (TXT, MD, CSV, JSON)
  if (fileType.includes('text') || fileType === 'application/json' ||
    ['txt', 'md', 'csv', 'json'].includes(extension)) {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(buffer);
  }

  throw new Error(`Tipo de archivo no soportado: ${fileType || extension}`);
}

// Split text into chunks with overlap — semantic page-aware splitting for web content
function splitIntoChunks(text: string, chunkSize: number = 400, overlap: number = 50): string[] {
  // If text has page blocks (from web scraper), split by page first
  const pageBlocks = text.split(/={3,}\s*PÁGINA:[^\n]*={3,}/);

  if (pageBlocks.length > 1) {
    const chunks: string[] = [];
    for (const block of pageBlocks) {
      const trimmed = block.trim();
      if (trimmed.length < 50) continue;
      const words = trimmed.split(/\s+/);
      if (words.length <= chunkSize) {
        chunks.push(trimmed);
      } else {
        let i = 0;
        while (i < words.length) {
          const chunk = words.slice(i, i + chunkSize).join(' ').trim();
          if (chunk.length > 50) chunks.push(chunk);
          i += chunkSize - overlap;
        }
      }
    }
    return chunks;
  }

  // Generic text (PDFs, docs): normal word-based chunking
  const words = text.split(/\s+/).filter(w => w.trim());
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    const chunk = words.slice(i, i + chunkSize).join(' ').trim();
    if (chunk.length > 50) chunks.push(chunk);
    i += chunkSize - overlap;
  }
  return chunks;
}

// Generate embedding for a text chunk via the generate-embedding edge function
async function generateEmbedding(supabaseUrl: string, supabaseServiceKey: string, text: string): Promise<number[] | null> {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Embedding generation failed:', response.status, err);
      return null;
    }

    const result = await response.json();
    return result.embedding || null;
  } catch (error) {
    console.error('Embedding generation error:', error);
    return null;
  }
}

// Background processing — runs after the HTTP response is returned
async function processDocumentBackground(params: {
  supabase: ReturnType<typeof createClient>;
  supabaseUrl: string;
  supabaseServiceKey: string;
  lovableApiKey: string;
  document_id: string;
  workshop_id: string;
  file_name: string;
  file_type: string;
  file_content?: string;
  storage_path?: string;
  plain_text?: string;
}) {
  const {
    supabase, supabaseUrl, supabaseServiceKey, lovableApiKey,
    document_id, workshop_id, file_name, file_type,
    file_content, storage_path, plain_text,
  } = params;

  const updateProgress = async (progress: number, extra: Record<string, unknown> = {}) => {
    await supabase
      .from('bot_documents')
      .update({ processing_progress: progress, ...extra })
      .eq('id', document_id);
  };

  try {
    let textContent: string;

    if (plain_text) {
      console.log('Using plain text input, length:', plain_text.length);
      textContent = plain_text;
      await updateProgress(40);
    } else {
      let buffer: Uint8Array;

      if (storage_path) {
        // Download from Storage (preferred for large files)
        console.log('Downloading from storage:', storage_path);
        await updateProgress(10);
        const { data: blob, error: dlError } = await supabase.storage
          .from('bot-documents')
          .download(storage_path);

        if (dlError || !blob) {
          throw new Error(`No se pudo descargar el archivo: ${dlError?.message || 'desconocido'}`);
        }
        const ab = await blob.arrayBuffer();
        buffer = new Uint8Array(ab);
        console.log('Downloaded buffer size:', buffer.length);
        await updateProgress(20);
      } else if (file_content) {
        // Legacy base64 path (small files only)
        const binaryString = atob(file_content);
        buffer = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          buffer[i] = binaryString.charCodeAt(i);
        }
        console.log('Decoded base64 buffer size:', buffer.length);
        await updateProgress(20);
      } else {
        throw new Error('No file_content or storage_path provided');
      }

      // Extract text with progress callback (for PDFs with batches)
      textContent = await extractText(
        buffer,
        file_type,
        file_name,
        lovableApiKey,
        async (processed, total) => {
          // Map page progress to 20-70% range
          const pct = total > 0 ? 20 + Math.round((processed / total) * 50) : 20;
          await updateProgress(pct, {
            total_pages: total,
            processed_pages: processed,
          });
        }
      );
    }

    if (!textContent || textContent.trim().length < 10) {
      throw new Error('No se pudo extraer texto del documento. Verifica que el archivo contenga texto legible.');
    }

    console.log('Extracted text length:', textContent.length);
    await updateProgress(70);

    const chunks = splitIntoChunks(textContent, 400, 50);
    console.log('Created chunks:', chunks.length);

    if (chunks.length === 0) {
      throw new Error('El documento no contiene suficiente texto para procesar');
    }

    let successCount = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        const embedding = await generateEmbedding(supabaseUrl, supabaseServiceKey, chunk);

        const insertPayload: Record<string, unknown> = {
          workshop_id,
          document_id,
          file_name,
          content: chunk,
          chunk_index: i,
          metadata: { char_count: chunk.length, word_count: chunk.split(/\s+/).length },
        };
        if (embedding) insertPayload.embedding = `[${embedding.join(',')}]`;

        const { error: insertError } = await supabase.from('bot_knowledge').insert(insertPayload);
        if (insertError) {
          console.error('Error inserting chunk:', insertError);
        } else {
          successCount++;
        }

        // Update progress every 10 chunks (70 → 99%)
        if (i % 10 === 0 || i === chunks.length - 1) {
          const pct = 70 + Math.round(((i + 1) / chunks.length) * 29);
          await updateProgress(pct);
        }

        if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 150));
      } catch (chunkError) {
        console.error(`Error processing chunk ${i}:`, chunkError);
      }
    }

    if (successCount > 0) {
      await supabase
        .from('bot_documents')
        .update({
          status: 'ready',
          chunk_count: successCount,
          processing_progress: 100,
          error_message: null,
        })
        .eq('id', document_id);
      console.log('Document processed successfully:', { document_id, chunks: successCount });
    } else {
      throw new Error('No se pudieron procesar los fragmentos del documento');
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Error desconocido';
    console.error('Background processing error:', errorMessage);
    await supabase
      .from('bot_documents')
      .update({
        status: 'error',
        error_message: errorMessage,
        processing_progress: 0,
      })
      .eq('id', document_id);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const {
      document_id, workshop_id, file_name,
      file_content, file_type, plain_text, storage_path,
    } = await req.json();

    if (!document_id || !workshop_id || !file_name || (!file_content && !plain_text && !storage_path)) {
      return new Response(JSON.stringify({
        error: 'Missing required fields: document_id, workshop_id, file_name, and one of file_content/plain_text/storage_path',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Queued document processing:', { document_id, file_name, file_type, has_storage: !!storage_path });

    // Mark as processing immediately
    await supabase
      .from('bot_documents')
      .update({ status: 'processing', processing_progress: 5 })
      .eq('id', document_id);

    // Run heavy work in background — returns response immediately to avoid timeouts
    // @ts-ignore - EdgeRuntime is provided by Supabase Edge Functions runtime
    EdgeRuntime.waitUntil(
      processDocumentBackground({
        supabase, supabaseUrl, supabaseServiceKey, lovableApiKey,
        document_id, workshop_id, file_name,
        file_type: file_type || 'application/octet-stream',
        file_content, storage_path, plain_text,
      })
    );

    return new Response(JSON.stringify({
      success: true,
      document_id,
      status: 'queued',
      message: 'Procesamiento iniciado en segundo plano',
    }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Process RAG document error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
