import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, RefreshCw, Download, FileWarning, FileCheck2, ChevronDown } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface CoverageItem {
  code: string;
  source_file: string;
  has_pdf: boolean;
  pdf_file_name: string | null;
  ambiguous: boolean;
}

interface CoverageResult {
  total: number;
  total_detected: number;
  truncated: boolean;
  with_pdf: number;
  without_pdf: number;
  coverage_percent: number;
  items: CoverageItem[];
}

interface Props {
  workshopId: string;
}

export function DatasheetCoverage({ workshopId }: Props) {
  const { toast } = useToast();
  const [result, setResult] = useState<CoverageResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showWithPdf, setShowWithPdf] = useState(false);

  const runReport = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('datasheet-coverage', {
        body: { workshop_id: workshopId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResult(data as CoverageResult);
    } catch (e) {
      toast({
        title: 'No se pudo generar el reporte',
        description: (e as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const filterItems = (items: CoverageItem[]) => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(i => i.code.toLowerCase().includes(q) || i.source_file.toLowerCase().includes(q));
  };

  const missing = filterItems(result?.items.filter(i => !i.has_pdf) ?? []);
  const covered = filterItems(result?.items.filter(i => i.has_pdf) ?? []);

  const exportCsv = () => {
    if (!result) return;
    const rows = [
      ['codigo', 'tiene_pdf', 'archivo_pdf', 'documento_origen'],
      ...result.items.map(i => [
        i.code,
        i.has_pdf ? 'si' : 'no',
        i.pdf_file_name ?? '',
        i.source_file,
      ]),
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'cobertura-fichas.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={runReport} disabled={isLoading} size="sm">
          {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          {result ? 'Actualizar' : 'Analizar catálogo'}
        </Button>
        {result && (
          <Button onClick={exportCsv} size="sm" variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Exportar CSV
          </Button>
        )}
      </div>

      {isLoading && !result && (
        <p className="text-sm text-muted-foreground">
          Revisando la base de conocimiento. Esto puede tardar algunos segundos.
        </p>
      )}

      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Modelos detectados</p>
              <p className="text-xl font-semibold">{result.total}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Con ficha PDF</p>
              <p className="text-xl font-semibold text-emerald-600">{result.with_pdf}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Sin ficha PDF</p>
              <p className="text-xl font-semibold text-destructive">{result.without_pdf}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Cobertura</p>
              <p className="text-xl font-semibold">{result.coverage_percent}%</p>
            </div>
          </div>

          {result.truncated && (
            <p className="text-xs text-muted-foreground">
              Se analizaron los primeros {result.total} modelos de {result.total_detected} detectados.
            </p>
          )}

          <Input
            placeholder="Buscar por modelo o documento..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="space-y-2">
            <p className="text-sm font-medium flex items-center gap-2">
              <FileWarning className="w-4 h-4 text-destructive" />
              Modelos sin ficha PDF ({missing.length})
            </p>
            {missing.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Todos los modelos encontrados tienen una ficha PDF disponible.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-lg border divide-y">
                {missing.map(item => (
                  <div key={item.code} className="flex items-center justify-between gap-3 p-2 text-sm">
                    <span className="font-mono">{item.code}</span>
                    <div className="flex items-center gap-2 min-w-0">
                      {item.ambiguous && <Badge variant="outline">ambiguo</Badge>}
                      <span className="text-xs text-muted-foreground truncate" title={item.source_file}>
                        {item.source_file}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Collapsible open={showWithPdf} onOpenChange={setShowWithPdf}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="px-0">
                <FileCheck2 className="w-4 h-4 mr-2 text-emerald-600" />
                Modelos con ficha PDF ({covered.length})
                <ChevronDown className={`w-4 h-4 ml-2 transition-transform ${showWithPdf ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="max-h-72 overflow-y-auto rounded-lg border divide-y mt-2">
                {covered.map(item => (
                  <div key={item.code} className="flex items-center justify-between gap-3 p-2 text-sm">
                    <span className="font-mono">{item.code}</span>
                    <span className="text-xs text-muted-foreground truncate" title={item.pdf_file_name ?? ''}>
                      {item.pdf_file_name}
                    </span>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </>
      )}
    </div>
  );
}
