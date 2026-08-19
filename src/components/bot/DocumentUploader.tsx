import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';

interface ExistingDoc {
  file_name: string;
  file_size: number | null;
}

interface DocumentUploaderProps {
  workshopId: string;
  onUploadComplete: () => void;
  documentCount: number;
  /** Bytes already used by this workshop's knowledge base */
  usedBytes?: number;
  /** Storage quota in bytes (default 1 GB) */
  maxStorageBytes?: number;
  /** Existing docs, used to skip duplicates (same name + size) */
  existingDocs?: ExistingDoc[];
}

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const DEFAULT_QUOTA = 1024 * 1024 * 1024; // 1GB
const CONCURRENCY = 3;
const SMALL_FILE_THRESHOLD = 4 * 1024 * 1024; // <4MB → still use base64 path (legacy fallback)
const ACCEPTED_TYPES = {
  'text/plain': ['.txt'],
  'text/markdown': ['.md'],
  'text/csv': ['.csv'],
  'application/json': ['.json'],
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'application/vnd.ms-powerpoint': ['.ppt'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls'],
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function DocumentUploader({
  workshopId,
  onUploadComplete,
  documentCount,
  usedBytes = 0,
  maxStorageBytes = DEFAULT_QUOTA,
  existingDocs = [],
}: DocumentUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentFile, setCurrentFile] = useState<string>('');
  const [queueTotal, setQueueTotal] = useState(0);
  const [queueDone, setQueueDone] = useState(0);
  const { toast } = useToast();

  const remainingBytes = Math.max(0, maxStorageBytes - usedBytes);
  const canUpload = remainingBytes > 0;
  const usagePercent = Math.min(100, Math.round((usedBytes / maxStorageBytes) * 100));

  const fileToBase64 = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return btoa(binary);
  };

  const processFile = async (file: File) => {
    setCurrentFile(file.name);
    setUploadProgress(0);

    // Create document record first (status=processing, progress=0)
    const { data: doc, error: docError } = await supabase
      .from('bot_documents')
      .insert({
        workshop_id: workshopId,
        file_name: file.name,
        file_size: file.size,
        file_type: file.type || 'application/octet-stream',
        status: 'processing',
        processing_progress: 0,
      })
      .select()
      .single();

    if (docError) throw docError;

    const isSmallFile = file.size <= SMALL_FILE_THRESHOLD;
    let storagePath: string | null = `${workshopId}/${doc.id}-${file.name.replace(/[^\w.\-]/g, '_')}`;
    let base64Content: string | null = null;

    // Always keep the original file in private storage so it can be re-sent later
    // (e.g. attaching the original PDF datasheet over WhatsApp).
    setUploadProgress(10);
    const { error: uploadError } = await supabase.storage
      .from('bot-documents')
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: true,
        contentType: file.type || 'application/octet-stream',
      });

    if (uploadError) {
      if (!isSmallFile) {
        await supabase
          .from('bot_documents')
          .update({ status: 'error', error_message: `Error subiendo archivo: ${uploadError.message}` })
          .eq('id', doc.id);
        throw uploadError;
      }
      // Small file: keep going with the base64 path, only the attachment feature is lost
      console.warn('Storage upload failed, continuing with base64 processing:', uploadError.message);
      storagePath = null;
    } else {
      await supabase
        .from('bot_documents')
        .update({ storage_path: storagePath })
        .eq('id', doc.id);
    }

    setUploadProgress(40);

    if (isSmallFile) {
      // Small file → keep the proven base64 processing path
      base64Content = await fileToBase64(file);
    }

    setUploadProgress(60);

    // Invoke edge function (it handles processing async via background tasks)
    const { error: processError } = await supabase.functions.invoke('process-rag-document', {
      body: {
        document_id: doc.id,
        workshop_id: workshopId,
        file_name: file.name,
        file_type: file.type || 'application/octet-stream',
        // Small files keep the proven base64 path; large ones are read from storage
        ...(base64Content
          ? { file_content: base64Content }
          : storagePath
            ? { storage_path: storagePath }
            : {}),
      },
    });

    setUploadProgress(100);

    if (processError) {
      await supabase
        .from('bot_documents')
        .update({ status: 'error', error_message: processError.message })
        .eq('id', doc.id);
      throw processError;
    }

    return doc;
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (!canUpload) {
      toast({
        title: 'Espacio agotado',
        description: `Ya usaste ${formatBytes(usedBytes)} de ${formatBytes(maxStorageBytes)}. Elimina documentos para liberar espacio.`,
        variant: 'destructive',
      });
      return;
    }

    let tooBig = 0;
    let duplicates = 0;
    const dupKeys = new Set(existingDocs.map((d) => `${d.file_name}|${d.file_size ?? 0}`));

    let budget = remainingBytes;
    let skippedByQuota = 0;
    const filesToProcess: File[] = [];

    for (const file of acceptedFiles) {
      if (file.size > MAX_FILE_SIZE) {
        tooBig++;
        continue;
      }
      if (dupKeys.has(`${file.name}|${file.size}`)) {
        duplicates++;
        continue;
      }
      if (file.size > budget) {
        skippedByQuota++;
        continue;
      }
      budget -= file.size;
      dupKeys.add(`${file.name}|${file.size}`);
      filesToProcess.push(file);
    }

    if (tooBig > 0) {
      toast({
        title: 'Archivos muy grandes',
        description: `${tooBig} archivo(s) superan el límite de 100 MB por archivo.`,
        variant: 'destructive',
      });
    }
    if (duplicates > 0) {
      toast({
        title: 'Duplicados omitidos',
        description: `${duplicates} archivo(s) ya estaban cargados con el mismo nombre y tamaño.`,
      });
    }
    if (skippedByQuota > 0) {
      toast({
        title: 'Espacio insuficiente',
        description: `${skippedByQuota} archivo(s) no caben en el espacio disponible (${formatBytes(remainingBytes)}).`,
        variant: 'destructive',
      });
    }

    if (filesToProcess.length === 0) return;

    setIsUploading(true);
    setQueueTotal(filesToProcess.length);
    setQueueDone(0);

    let succeeded = 0;
    const failed: string[] = [];
    let cursor = 0;

    const worker = async () => {
      while (cursor < filesToProcess.length) {
        const index = cursor++;
        const file = filesToProcess[index];
        try {
          await processFile(file);
          succeeded++;
        } catch (error) {
          console.error('Upload error:', file.name, error);
          failed.push(file.name);
        } finally {
          setQueueDone((prev) => prev + 1);
        }
      }
    };

    try {
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, filesToProcess.length) }, () => worker())
      );

      toast({
        title: failed.length === 0 ? '¡Documentos subidos!' : 'Subida completada con errores',
        description:
          failed.length === 0
            ? `${succeeded} archivo(s) subidos. El procesamiento continúa en segundo plano.`
            : `${succeeded} subidos, ${failed.length} con error: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`,
        variant: failed.length === 0 ? 'default' : 'destructive',
      });

      onUploadComplete();
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setCurrentFile('');
      setQueueTotal(0);
      setQueueDone(0);
    }
  }, [workshopId, canUpload, remainingBytes, usedBytes, maxStorageBytes, existingDocs, toast, onUploadComplete]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    disabled: isUploading || !canUpload,
  });

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {formatBytes(usedBytes)} de {formatBytes(maxStorageBytes)} usados · {documentCount} documento{documentCount !== 1 ? 's' : ''}
          </span>
          <span>{usagePercent}%</span>
        </div>
        <Progress value={usagePercent} className="h-1.5" />
      </div>
    <div
      {...getRootProps()}
      className={cn(
        "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
        isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
        (isUploading || !canUpload) && "opacity-50 cursor-not-allowed"
      )}
    >
      <input {...getInputProps()} />
      
      <div className="flex flex-col items-center gap-2">
        {isUploading ? (
          <>
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground truncate max-w-full px-4">
              Subiendo {queueDone}/{queueTotal} · {currentFile}...
            </p>
            {queueTotal > 0 && (
              <div className="w-full max-w-xs mt-2">
                <Progress value={Math.round((queueDone / queueTotal) * 100)} className="h-2" />
                <p className="text-xs text-muted-foreground mt-1">
                  {Math.round((queueDone / queueTotal) * 100)}%
                </p>
              </div>
            )}
          </>
        ) : !canUpload ? (
          <>
            <AlertCircle className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Espacio agotado ({formatBytes(maxStorageBytes)}). Elimina documentos para liberar espacio.
            </p>
          </>
        ) : isDragActive ? (
          <>
            <FileText className="w-8 h-8 text-primary" />
            <p className="text-sm text-primary font-medium">Suelta el archivo aquí</p>
          </>
        ) : (
          <>
            <Upload className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Arrastra archivos o carpetas aquí, o haz clic para seleccionar
            </p>
            <p className="text-xs text-muted-foreground">
              PDF, Word, Excel, PowerPoint, TXT • Máximo 100 MB por archivo · {formatBytes(remainingBytes)} disponibles
            </p>
            <p className="text-[10px] text-muted-foreground/70 mt-1">
              💡 Para mejor calidad, divide manuales muy largos por capítulos
            </p>
          </>
        )}
      </div>
    </div>
    </div>
  );
}