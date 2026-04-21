import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';

interface DocumentUploaderProps {
  workshopId: string;
  onUploadComplete: () => void;
  documentCount: number;
  maxDocuments?: number;
}

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
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

export function DocumentUploader({ 
  workshopId, 
  onUploadComplete, 
  documentCount,
  maxDocuments = 50 
}: DocumentUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentFile, setCurrentFile] = useState<string>('');
  const { toast } = useToast();

  const canUpload = documentCount < maxDocuments;

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

    const useStorage = file.size > SMALL_FILE_THRESHOLD;
    let storagePath: string | null = null;
    let base64Content: string | null = null;

    if (useStorage) {
      // Upload to Supabase Storage (handles large files efficiently)
      storagePath = `${workshopId}/${doc.id}-${file.name.replace(/[^\w.\-]/g, '_')}`;

      setUploadProgress(10);
      const { error: uploadError } = await supabase.storage
        .from('bot-documents')
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type || 'application/octet-stream',
        });

      if (uploadError) {
        await supabase
          .from('bot_documents')
          .update({ status: 'error', error_message: `Error subiendo archivo: ${uploadError.message}` })
          .eq('id', doc.id);
        throw uploadError;
      }

      setUploadProgress(60);

      // Save storage path on the doc record
      await supabase
        .from('bot_documents')
        .update({ storage_path: storagePath })
        .eq('id', doc.id);
    } else {
      // Small file → keep base64 path (faster, fewer roundtrips)
      setUploadProgress(30);
      base64Content = await fileToBase64(file);
      setUploadProgress(60);
    }

    // Invoke edge function (it handles processing async via background tasks)
    const { error: processError } = await supabase.functions.invoke('process-rag-document', {
      body: {
        document_id: doc.id,
        workshop_id: workshopId,
        file_name: file.name,
        file_type: file.type || 'application/octet-stream',
        ...(storagePath ? { storage_path: storagePath } : {}),
        ...(base64Content ? { file_content: base64Content } : {}),
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
        title: 'Límite alcanzado',
        description: `Máximo ${maxDocuments} documentos permitidos`,
        variant: 'destructive',
      });
      return;
    }

    const validFiles = acceptedFiles.filter(file => {
      if (file.size > MAX_FILE_SIZE) {
        toast({
          title: 'Archivo muy grande',
          description: `${file.name} excede el límite de 100MB`,
          variant: 'destructive',
        });
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;

    // Check if adding these would exceed limit
    const remainingSlots = maxDocuments - documentCount;
    const filesToProcess = validFiles.slice(0, remainingSlots);

    if (filesToProcess.length < validFiles.length) {
      toast({
        title: 'Algunos archivos no se subirán',
        description: `Solo quedan ${remainingSlots} espacios disponibles`,
        variant: 'default',
      });
    }

    setIsUploading(true);

    try {
      for (const file of filesToProcess) {
        await processFile(file);
      }

      toast({
        title: '¡Documento(s) subido(s)!',
        description: 'El procesamiento continúa en segundo plano. Verás el progreso en tiempo real.',
      });

      onUploadComplete();
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: 'Error al subir',
        description: error instanceof Error ? error.message : 'Error desconocido',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setCurrentFile('');
    }
  }, [workshopId, canUpload, documentCount, maxDocuments, toast, onUploadComplete]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxFiles: maxDocuments - documentCount,
    disabled: isUploading || !canUpload,
  });

  return (
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
              Subiendo {currentFile}...
            </p>
            {uploadProgress > 0 && (
              <div className="w-full max-w-xs mt-2">
                <Progress value={uploadProgress} className="h-2" />
                <p className="text-xs text-muted-foreground mt-1">{uploadProgress}%</p>
              </div>
            )}
          </>
        ) : !canUpload ? (
          <>
            <AlertCircle className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Límite de {maxDocuments} documentos alcanzado
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
              Arrastra archivos aquí o haz clic para seleccionar
            </p>
            <p className="text-xs text-muted-foreground">
              PDF, Word, Excel, PowerPoint, TXT • Máximo 100MB · {maxDocuments} archivos
            </p>
            <p className="text-[10px] text-muted-foreground/70 mt-1">
              💡 Para mejor calidad, divide manuales muy largos por capítulos
            </p>
          </>
        )}
      </div>
    </div>
  );
}