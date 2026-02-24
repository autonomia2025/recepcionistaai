import { FileText, Trash2, Loader2, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useState } from 'react';

interface Document {
  id: string;
  file_name: string;
  file_size: number | null;
  status: string;
  chunk_count: number | null;
  error_message: string | null;
  created_at: string;
}

interface DocumentListProps {
  documents: Document[];
  onDelete: () => void;
  isLoading?: boolean;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusBadge({ status, errorMessage }: { status: string; errorMessage: string | null }) {
  switch (status) {
    case 'ready':
      return (
        <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">
          <CheckCircle className="w-3 h-3 mr-1" />
          Listo
        </Badge>
      );
    case 'processing':
      return (
        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          Procesando
        </Badge>
      );
    case 'error':
      return (
        <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30" title={errorMessage || 'Error'}>
          <AlertCircle className="w-3 h-3 mr-1" />
          Error
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export function DocumentList({ documents, onDelete, isLoading }: DocumentListProps) {
  const { toast } = useToast();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (doc: Document) => {
    if (!confirm(`¿Eliminar "${doc.file_name}"? Esto también eliminará su contenido del conocimiento del bot.`)) {
      return;
    }

    setDeletingId(doc.id);

    try {
      // Delete knowledge chunks first (cascade should handle this, but be explicit)
      await supabase
        .from('bot_knowledge')
        .delete()
        .eq('document_id', doc.id);

      // Delete document record
      const { error } = await supabase
        .from('bot_documents')
        .delete()
        .eq('id', doc.id);

      if (error) throw error;

      toast({
        title: 'Documento eliminado',
        description: `"${doc.file_name}" fue eliminado correctamente.`,
      });

      onDelete();
    } catch (error) {
      console.error('Delete error:', error);
      toast({
        title: 'Error al eliminar',
        description: error instanceof Error ? error.message : 'Error desconocido',
        variant: 'destructive',
      });
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <FileText className="w-10 h-10 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No hay documentos subidos</p>
        <p className="text-xs">Sube archivos de texto para que el bot los use como referencia</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-sm text-muted-foreground mb-3">
        {documents.length} documento{documents.length !== 1 ? 's' : ''} subido{documents.length !== 1 ? 's' : ''}
      </div>
      
      {documents.map((doc) => (
        <div
          key={doc.id}
          className="flex items-center gap-3 p-3 border rounded-lg bg-card hover:bg-muted/30 transition-colors"
        >
          <FileText className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" title={doc.file_name}>
              {doc.file_name}
            </p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{formatFileSize(doc.file_size)}</span>
              {doc.chunk_count && doc.status === 'ready' && (
                <>
                  <span>•</span>
                  <span>{doc.chunk_count} fragmentos</span>
                </>
              )}
              {doc.error_message && doc.status === 'error' && (
                <>
                  <span>•</span>
                  <span className="text-destructive truncate" title={doc.error_message}>
                    {doc.error_message.substring(0, 50)}...
                  </span>
                </>
              )}
            </div>
          </div>

          <StatusBadge status={doc.status} errorMessage={doc.error_message} />

          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleDelete(doc)}
            disabled={deletingId === doc.id}
            className="text-muted-foreground hover:text-destructive flex-shrink-0"
          >
            {deletingId === doc.id ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
          </Button>
        </div>
      ))}
    </div>
  );
}
