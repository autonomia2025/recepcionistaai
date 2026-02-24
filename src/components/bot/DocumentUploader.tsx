import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface DocumentUploaderProps {
  workshopId: string;
  onUploadComplete: () => void;
  documentCount: number;
  maxDocuments?: number;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB for binary docs
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
  maxDocuments = 10 
}: DocumentUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const canUpload = documentCount < maxDocuments;

  const processFile = async (file: File) => {
    // Read file as ArrayBuffer for binary files
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Convert to base64
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    const base64Content = btoa(binary);

    // Create document record
    const { data: doc, error: docError } = await supabase
      .from('bot_documents')
      .insert({
        workshop_id: workshopId,
        file_name: file.name,
        file_size: file.size,
        file_type: file.type || 'application/octet-stream',
        status: 'processing',
      })
      .select()
      .single();

    if (docError) throw docError;

    // Call edge function to process
    const { error: processError } = await supabase.functions.invoke('process-rag-document', {
      body: {
        document_id: doc.id,
        workshop_id: workshopId,
        file_name: file.name,
        file_content: base64Content,
        file_type: file.type || 'application/octet-stream',
      },
    });

    if (processError) {
      // Update document status to error
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
          description: `${file.name} excede el límite de 10MB`,
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
        description: 'El procesamiento puede tomar unos segundos.',
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
            <p className="text-sm text-muted-foreground">Procesando documento...</p>
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
              PDF, Word, Excel, PowerPoint, TXT • Máximo 10MB
            </p>
          </>
        )}
      </div>
    </div>
  );
}