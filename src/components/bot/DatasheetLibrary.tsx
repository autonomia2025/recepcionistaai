import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ExternalLink, FileText, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface DatasheetLibraryProps {
  workshopId: string;
}

interface DocumentRow {
  id: string;
  file_name: string;
  file_size: number | null;
  file_type: string | null;
  status: string;
  storage_path: string | null;
  created_at: string;
}

const formatSize = (bytes: number | null) => {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Storage keeps names like "041_MH130-10M-I.pdf"; the numeric prefix is noise.
const displayName = (fileName: string) => fileName.replace(/\.pdf$/i, '').replace(/^\d+[_-]/, '');

export function DatasheetLibrary({ workshopId }: DatasheetLibraryProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [opening, setOpening] = useState<string | null>(null);

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['datasheet-library', workshopId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bot_documents')
        .select('id, file_name, file_size, file_type, status, storage_path, created_at')
        .eq('workshop_id', workshopId)
        .order('file_name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as DocumentRow[];
    },
    enabled: open && !!workshopId,
  });

  const { data: catalog = [] } = useQuery({
    queryKey: ['datasheet-library-catalog', workshopId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_catalog')
        .select('sku, datasheet_file')
        .eq('workshop_id', workshopId);
      if (error) throw error;
      return (data ?? []) as Array<{ sku: string; datasheet_file: string | null }>;
    },
    enabled: open && !!workshopId,
  });

  const skusByFile = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of catalog) {
      if (!row.datasheet_file) continue;
      map.set(row.datasheet_file, [...(map.get(row.datasheet_file) ?? []), row.sku]);
    }
    return map;
  }, [catalog]);

  const pdfs = useMemo(
    () =>
      documents.filter(
        (doc) => (doc.file_type ?? '').toLowerCase().includes('pdf') || doc.file_name.toLowerCase().endsWith('.pdf'),
      ),
    [documents],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return pdfs;
    return pdfs.filter((doc) => {
      const skus = skusByFile.get(doc.file_name) ?? [];
      return doc.file_name.toLowerCase().includes(query) || skus.some((sku) => sku.toLowerCase().includes(query));
    });
  }, [pdfs, search, skusByFile]);

  const linkedCount = pdfs.filter((doc) => (skusByFile.get(doc.file_name) ?? []).length > 0).length;

  const openDatasheet = async (doc: DocumentRow) => {
    if (!doc.storage_path) {
      toast.error('Esta ficha no tiene archivo guardado');
      return;
    }
    setOpening(doc.id);
    try {
      const { data, error } = await supabase.storage.from('bot-documents').createSignedUrl(doc.storage_path, 3600);
      if (error || !data?.signedUrl) throw error ?? new Error('No se pudo generar el enlace');
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(`No se pudo abrir la ficha: ${(error as Error).message}`);
    } finally {
      setOpening(null);
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border">
      <CollapsibleTrigger asChild>
        <button type="button" className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/40 transition-colors rounded-xl">
          <div className="p-2 rounded-lg bg-primary/10 shrink-0">
            <FileText className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">Fichas técnicas cargadas</p>
            <p className="text-xs text-muted-foreground">
              {open && !isLoading
                ? `${pdfs.length} en PDF · ${linkedCount} vinculadas a un modelo del catálogo`
                : 'Ver todas las fichas en PDF que el bot puede enviar'}
            </p>
          </div>
          <ChevronDown className={cn('w-4 h-4 shrink-0 transition-transform', open && 'rotate-180')} />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-3 pb-3 space-y-3 border-t pt-3">
          {isLoading && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Cargando fichas...
            </p>
          )}

          {!isLoading && pdfs.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Todavía no hay fichas en PDF. Súbelas en la base de conocimiento de arriba.
            </p>
          )}

          {!isLoading && pdfs.length > 0 && (
            <>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por archivo o modelo..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="pl-9"
                />
              </div>

              <div className="max-h-80 overflow-y-auto rounded-lg border divide-y">
                {filtered.map((doc) => {
                  const skus = skusByFile.get(doc.file_name) ?? [];
                  return (
                    <div key={doc.id} className="flex items-center gap-3 p-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" title={doc.file_name}>
                          {displayName(doc.file_name)}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          {skus.length > 0 ? (
                            skus.map((sku) => (
                              <Badge key={sku} variant="outline" className="text-[10px] font-mono">
                                {sku}
                              </Badge>
                            ))
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 bg-amber-500/10">
                              sin modelo vinculado
                            </Badge>
                          )}
                          {doc.status !== 'ready' && (
                            <Badge variant="secondary" className="text-[10px]">{doc.status}</Badge>
                          )}
                          <span className="text-[11px] text-muted-foreground">{formatSize(doc.file_size)}</span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openDatasheet(doc)}
                        disabled={opening === doc.id}
                        title="Abrir ficha"
                      >
                        {opening === doc.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ExternalLink className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  );
                })}

                {filtered.length === 0 && (
                  <p className="text-sm text-muted-foreground p-3">Ninguna ficha coincide con la búsqueda.</p>
                )}
              </div>

              {linkedCount < pdfs.length && (
                <p className="text-xs text-muted-foreground">
                  Las fichas sin modelo vinculado no se envían solas: el bot las encuentra únicamente si el nombre del
                  archivo coincide con el código del equipo.
                </p>
              )}
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
