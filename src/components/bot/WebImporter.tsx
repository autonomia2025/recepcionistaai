import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Globe, Loader2 } from 'lucide-react';

interface WebImporterProps {
  workshopId: string;
  onImportComplete: () => void;
}

export function WebImporter({ workshopId, onImportComplete }: WebImporterProps) {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const { toast } = useToast();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    setIsLoading(false);
    setStatusText('');
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const startPolling = (documentId: string) => {
    setStatusText('Analizando sitio... esto puede tardar 1-2 minutos');

    // 3-minute max timeout
    timeoutRef.current = setTimeout(() => {
      stopPolling();
      toast({ title: 'Timeout', description: 'La importación tardó demasiado. Revisa el estado del documento.', variant: 'destructive' });
    }, 180_000);

    pollingRef.current = setInterval(async () => {
      const { data, error } = await supabase
        .from('bot_documents')
        .select('status, chunk_count, error_message')
        .eq('id', documentId)
        .single();

      if (error) return;

      if (data.status === 'ready') {
        stopPolling();
        toast({
          title: '¡Sitio importado!',
          description: `Se crearon ${data.chunk_count ?? 0} fragmentos de conocimiento.`,
        });
        setUrl('');
        onImportComplete();
      } else if (data.status === 'error') {
        stopPolling();
        toast({ title: 'Error', description: data.error_message || 'Error al importar el sitio', variant: 'destructive' });
      }
    }, 4000);
  };

  const handleImport = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      toast({ title: 'Error', description: 'Ingresa una URL válida', variant: 'destructive' });
      return;
    }

    setIsLoading(true);
    setStatusText('Enviando solicitud...');

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const session = (await supabase.auth.getSession()).data.session;

      const response = await fetch(`${supabaseUrl}/functions/v1/scrape-website`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${session?.access_token || supabaseKey}`,
        },
        body: JSON.stringify({ url: trimmedUrl, workshop_id: workshopId }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'Error al importar el sitio');
      }

      if (data?.success && data?.document_id) {
        // Start polling for completion
        startPolling(data.document_id);
      } else {
        throw new Error(data?.error || 'Error al importar el sitio');
      }
    } catch (err) {
      const message = err instanceof Error
        ? (err.name === 'AbortError' ? 'La solicitud tardó demasiado. Intenta de nuevo.' : err.message)
        : 'Error al importar el sitio web';
      toast({ title: 'Error', description: message, variant: 'destructive' });
      setIsLoading(false);
      setStatusText('');
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="https://misitio.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="pl-9"
            disabled={isLoading}
            onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleImport()}
          />
        </div>
        <Button onClick={handleImport} disabled={isLoading || !url.trim()} variant="outline" size="sm">
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Globe className="w-4 h-4 mr-1" />}
          {isLoading ? 'Importando...' : 'Importar Web'}
        </Button>
      </div>
      {isLoading && statusText && (
        <p className="text-xs text-muted-foreground pl-1">{statusText}</p>
      )}
    </div>
  );
}
