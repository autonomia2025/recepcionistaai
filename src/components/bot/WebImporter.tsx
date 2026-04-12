import { useState } from 'react';
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

  const handleImport = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      toast({ title: 'Error', description: 'Ingresa una URL válida', variant: 'destructive' });
      return;
    }

    setIsLoading(true);
    setStatusText('Rastreando páginas del sitio...');

    try {
      // Use a manual fetch with longer timeout instead of supabase.functions.invoke
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000); // 120s timeout

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

      if (data?.success) {
        toast({
          title: '¡Sitio importado!',
          description: `Se analizaron ${data.pages_scraped || 1} páginas y se crearon ${data.chunks_created} fragmentos de ${data.domain}`,
        });
        setUrl('');
        onImportComplete();
      } else {
        throw new Error(data?.error || 'Error al importar el sitio');
      }
    } catch (err) {
      const message = err instanceof Error
        ? (err.name === 'AbortError' ? 'La importación tardó demasiado. Intenta con una URL más específica.' : err.message)
        : 'Error al importar el sitio web';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
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
