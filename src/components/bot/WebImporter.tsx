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
  const { toast } = useToast();

  const handleImport = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      toast({ title: 'Error', description: 'Ingresa una URL válida', variant: 'destructive' });
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('scrape-website', {
        body: { url: trimmedUrl, workshop_id: workshopId },
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: '¡Sitio importado!',
          description: `Se extrajeron ${data.chunks_created} fragmentos de ${data.domain}`,
        });
        setUrl('');
        onImportComplete();
      } else {
        throw new Error(data?.error || 'Error al importar el sitio');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al importar el sitio web';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
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
  );
}
