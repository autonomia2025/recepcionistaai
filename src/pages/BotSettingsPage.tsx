import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Json } from '@/integrations/supabase/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, MessageSquare, HelpCircle, Sparkles, Save, Loader2, BookOpen } from 'lucide-react';
import { ChatSimulator } from '@/components/bot/ChatSimulator';
import * as XLSX from 'xlsx';
import { DocumentUploader } from '@/components/bot/DocumentUploader';
import { DocumentList } from '@/components/bot/DocumentList';
import { WebImporter } from '@/components/bot/WebImporter';
import { ZoneEmailSettings } from '@/components/admin/ZoneEmailSettings';

interface Service {
  name: string;
  price?: number;
  description?: string;
  stock?: number;
}

interface FAQ {
  question: string;
  answer: string;
}

interface BotDocument {
  id: string;
  file_name: string;
  file_size: number | null;
  status: string;
  chunk_count: number | null;
  error_message: string | null;
  created_at: string;
  processing_progress?: number | null;
  total_pages?: number | null;
  processed_pages?: number | null;
}

const TONE_OPTIONS = [
  { value: 'professional', label: 'Profesional', description: 'Formal pero amigable' },
  { value: 'friendly', label: 'Amigable', description: 'Cercano y cálido, usa emojis' },
  { value: 'casual', label: 'Casual', description: 'Muy relajado, como un amigo' },
  { value: 'formal', label: 'Formal', description: 'Muy respetuoso y formal' },
];

export default function BotSettingsPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Form state
  const [businessDescription, setBusinessDescription] = useState('');
  const [tone, setTone] = useState('professional');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [sendPdfDatasheets, setSendPdfDatasheets] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch current settings
  const { data: botSettings, isLoading } = useQuery({
    queryKey: ['bot-settings', profile?.workshop_id],
    queryFn: async () => {
      if (!profile?.workshop_id) return null;
      const { data, error } = await supabase
        .from('bot_settings')
        .select('*')
        .eq('workshop_id', profile.workshop_id)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!profile?.workshop_id,
  });

  // Fetch documents for RAG
  const { data: documents = [], isLoading: isLoadingDocs, refetch: refetchDocs } = useQuery({
    queryKey: ['bot-documents', profile?.workshop_id],
    queryFn: async () => {
      if (!profile?.workshop_id) return [];
      const { data, error } = await supabase
        .from('bot_documents')
        .select('*')
        .eq('workshop_id', profile.workshop_id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as BotDocument[];
    },
    enabled: !!profile?.workshop_id,
    refetchInterval: (query) => {
      const docs = query.state.data as BotDocument[] | undefined;
      const hasProcessing = docs?.some(d => d.status === 'processing');
      // Realtime handles updates; this is a fallback
      return hasProcessing ? 5000 : false;
    },
  });

  // Realtime subscription for live progress updates
  useEffect(() => {
    if (!profile?.workshop_id) return;
    const channel = supabase
      .channel(`bot-documents-${profile.workshop_id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bot_documents',
          filter: `workshop_id=eq.${profile.workshop_id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['bot-documents', profile.workshop_id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.workshop_id, queryClient]);

  // Initialize form when data loads
  useEffect(() => {
    if (botSettings) {
      setBusinessDescription(botSettings.business_description || '');
      setTone(botSettings.tone || 'professional');
      setSystemPrompt(botSettings.system_prompt || '');
      setSendPdfDatasheets(Boolean(botSettings.send_pdf_datasheets));
      setServices((botSettings.services_json as unknown as Service[]) || []);
      setFaqs((botSettings.faq_json as unknown as FAQ[]) || []);
    }
  }, [botSettings]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.workshop_id) throw new Error('No workshop ID');
      
      const servicesData = JSON.parse(JSON.stringify(services)) as Json;
      const faqsData = JSON.parse(JSON.stringify(faqs)) as Json;

      if (botSettings) {
        const { error } = await supabase
          .from('bot_settings')
          .update({
            business_description: businessDescription || null,
            tone,
            system_prompt: systemPrompt || null,
            services_json: servicesData,
            faq_json: faqsData,
            send_pdf_datasheets: sendPdfDatasheets,
            updated_at: new Date().toISOString(),
          })
          .eq('workshop_id', profile.workshop_id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('bot_settings')
          .insert({
            workshop_id: profile.workshop_id,
            business_description: businessDescription || null,
            tone,
            system_prompt: systemPrompt || null,
            services_json: servicesData,
            faq_json: faqsData,
            send_pdf_datasheets: sendPdfDatasheets,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bot-settings', profile?.workshop_id] });
      toast({ title: '¡Guardado!', description: 'La configuración del bot se actualizó correctamente.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Service handlers
  const addService = () => {
    setServices([...services, { name: '', price: undefined, description: '', stock: undefined }]);
  };

  const updateService = (index: number, field: keyof Service, value: string | number) => {
    const updated = [...services];
    if (field === 'price' || field === 'stock') {
      updated[index][field] = value ? Number(value) : undefined;
    } else {
      updated[index][field] = value as string;
    }
    setServices(updated);
  };

  const normalizeHeader = (value: unknown) =>
    String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const parseNumber = (value: unknown) => {
    if (value === null || value === undefined || value === '') return undefined;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    const cleaned = String(value).replace(/[^0-9.,-]/g, '').replace(',', '.');
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const parseServicesFile = async (file: File): Promise<Service[]> => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as Array<Array<unknown>>;

    if (!rows || rows.length < 2) {
      throw new Error('El archivo no tiene filas suficientes.');
    }

    const headers = rows[0].map(normalizeHeader);
    const findIndex = (keys: string[]) => headers.findIndex((h) => keys.some((k) => h.includes(k)));

    const nameIndex = findIndex(['nombre', 'name', 'producto', 'servicio', 'item', 'sku']);
    const priceIndex = findIndex(['precio', 'price', 'valor', 'costo', 'cost']);
    const stockIndex = findIndex(['stock', 'inventario', 'cantidad', 'qty', 'existencias']);
    const descriptionIndex = findIndex(['descripcion', 'description', 'detalle', 'desc']);

    const fallbackNameIndex = nameIndex >= 0 ? nameIndex : 0;

    const parsed = rows
      .slice(1)
      .map((row) => {
        const name = String(row[fallbackNameIndex] ?? '').trim();
        if (!name) return null;

        return {
          name,
          price: priceIndex >= 0 ? parseNumber(row[priceIndex]) : undefined,
          stock: stockIndex >= 0 ? parseNumber(row[stockIndex]) : undefined,
          description: descriptionIndex >= 0 ? String(row[descriptionIndex] ?? '').trim() || undefined : undefined,
        } as Service;
      })
      .filter(Boolean) as Service[];

    if (parsed.length === 0) {
      throw new Error('No se encontraron productos/servicios válidos en el archivo.');
    }

    return parsed;
  };

  const mergeServices = (existing: Service[], incoming: Service[]) => {
    const byName = new Map(existing.map((service) => [service.name.toLowerCase().trim(), service]));
    incoming.forEach((service) => {
      const key = service.name.toLowerCase().trim();
      if (!key) return;
      if (byName.has(key)) {
        const current = byName.get(key)!;
        byName.set(key, { ...current, ...service });
      } else {
        byName.set(key, service);
      }
    });
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const imported = await parseServicesFile(file);
      setServices((prev) => mergeServices(prev, imported));
      toast({ title: 'Importado', description: `Se cargaron ${imported.length} items.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo importar el archivo.';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      event.target.value = '';
    }
  };

  const removeService = (index: number) => {
    setServices(services.filter((_, i) => i !== index));
  };

  // FAQ handlers
  const addFaq = () => {
    setFaqs([...faqs, { question: '', answer: '' }]);
  };

  const updateFaq = (index: number, field: keyof FAQ, value: string) => {
    const updated = [...faqs];
    updated[index][field] = value;
    setFaqs(updated);
  };

  const removeFaq = (index: number) => {
    setFaqs(faqs.filter((_, i) => i !== index));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="page-shell page-stack">
      <PageHeader 
        title="Configurar Bot" 
        description="Entrena y personaliza cómo tu bot responde a los clientes"
        actions={
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Guardar Cambios
          </Button>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left column - Settings */}
        <div className="xl:col-span-2 space-y-6">
          {/* Base de Conocimiento (RAG) */}
          <Card className="bg-background/80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="w-5 h-5" />
                Base de Conocimiento
              </CardTitle>
              <CardDescription>
                Sube documentos de texto que el bot usará como referencia para responder preguntas. 
                El bot buscará información relevante automáticamente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {profile?.workshop_id && (
                <>
                  <DocumentUploader
                    workshopId={profile.workshop_id}
                    onUploadComplete={() => refetchDocs()}
                    documentCount={documents.length}
                    maxDocuments={50}
                  />
                  <WebImporter
                    workshopId={profile.workshop_id}
                    onImportComplete={() => refetchDocs()}
                  />
                  <DocumentList
                    documents={documents}
                    onDelete={() => refetchDocs()}
                    isLoading={isLoadingDocs}
                  />
                </>
              )}
            </CardContent>
          </Card>

          {/* Personalidad */}
          <Card className="bg-background/80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5" />
                Personalidad del Bot
              </CardTitle>
              <CardDescription>
                Define cómo se presenta y comunica tu bot con los clientes
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="business_description">Descripción del Negocio</Label>
                <Textarea
                  id="business_description"
                  placeholder="Describe tu negocio: qué hacen, cuáles son sus especialidades, qué los diferencia..."
                  value={businessDescription}
                  onChange={(e) => setBusinessDescription(e.target.value)}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  El bot usará esta información para describir tu negocio a los clientes.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tone">Tono de Comunicación</Label>
                <Select value={tone} onValueChange={setTone}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TONE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <div>
                          <span className="font-medium">{option.label}</span>
                          <span className="text-muted-foreground ml-2">- {option.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="system_prompt">Instrucciones Personalizadas (Avanzado)</Label>
                <Textarea
                  id="system_prompt"
                  placeholder="Opcional: Instrucciones específicas para el bot. Deja vacío para usar el comportamiento automático..."
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  Opcional. Si lo completas, sobrescribirá el comportamiento automático del bot.
                </p>
              </div>

              <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                <div className="space-y-1">
                  <Label htmlFor="send_pdf_datasheets">Enviar fichas técnicas en PDF</Label>
                  <p className="text-xs text-muted-foreground">
                    Cuando el cliente consulte por un código de producto, el bot adjuntará por WhatsApp el PDF original de la base de conocimiento.
                  </p>
                </div>
                <Switch
                  id="send_pdf_datasheets"
                  checked={sendPdfDatasheets}
                  onCheckedChange={setSendPdfDatasheets}
                />
              </div>
            </CardContent>
          </Card>

          {/* Servicios */}
          <Card className="bg-background/80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                Servicios / Productos ({services.length})
              </CardTitle>
              <CardDescription>
                Lista de servicios o productos que ofreces. El bot podrá informar precios y descripciones.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={handleImportFile}
                />
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  Importar Excel/CSV
                </Button>
                <p className="text-xs text-muted-foreground">
                  Columnas soportadas: nombre, precio, stock, descripcion. Se actualiza por nombre y se ordena A-Z.
                </p>
              </div>

              {services.map((service, index) => (
                <div key={index} className="flex gap-2 items-start p-3 border border-border/50 rounded-lg bg-background/70">
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-2">
                    <Input
                      placeholder="Nombre del servicio/producto"
                      value={service.name}
                      onChange={(e) => updateService(index, 'name', e.target.value)}
                    />
                    <Input
                      type="number"
                      placeholder="Precio (opcional)"
                      value={service.price || ''}
                      onChange={(e) => updateService(index, 'price', e.target.value)}
                    />
                    <Input
                      type="number"
                      placeholder="Stock (opcional)"
                      value={service.stock ?? ''}
                      onChange={(e) => updateService(index, 'stock', e.target.value)}
                    />
                    <Input
                      placeholder="Descripción breve"
                      value={service.description || ''}
                      onChange={(e) => updateService(index, 'description', e.target.value)}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeService(index)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}

              <Button variant="outline" size="sm" onClick={addService} className="w-full">
                <Plus className="w-4 h-4 mr-2" />
                Agregar Servicio / Producto
              </Button>
            </CardContent>
          </Card>

          {/* FAQ */}
          <Card className="bg-background/80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HelpCircle className="w-5 h-5" />
                Preguntas Frecuentes ({faqs.length})
              </CardTitle>
              <CardDescription>
                Preguntas y respuestas que el bot usará para responder consultas comunes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {faqs.map((faq, index) => (
                <div key={index} className="space-y-2 p-3 border border-border/50 rounded-lg bg-background/70">
                  <div className="flex gap-2 items-start">
                    <div className="flex-1 space-y-2">
                      <Input
                        placeholder="Pregunta (ej: ¿Cuál es el horario de atención?)"
                        value={faq.question}
                        onChange={(e) => updateFaq(index, 'question', e.target.value)}
                      />
                      <Textarea
                        placeholder="Respuesta"
                        value={faq.answer}
                        onChange={(e) => updateFaq(index, 'answer', e.target.value)}
                        rows={2}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeFaq(index)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}

              <Button variant="outline" size="sm" onClick={addFaq} className="w-full">
                <Plus className="w-4 h-4 mr-2" />
                Agregar Pregunta Frecuente
              </Button>
            </CardContent>
          </Card>

          {/* Save button at bottom too */}
          <div className="flex justify-end">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} size="lg" className="btn-primary-glow">
              {saveMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Guardar Cambios
            </Button>
          </div>
        </div>

        {/* Right column - Chat Simulator + Zone Emails */}
        <div className="xl:col-span-1 space-y-4">
          <div className="xl:sticky xl:top-6 space-y-4">
            <ChatSimulator />
            {profile?.workshop_id && <ZoneEmailSettings workshopId={profile.workshop_id} />}
          </div>
        </div>
      </div>
    </div>
  );
}
