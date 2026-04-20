import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, Bot, MessageSquare, HelpCircle, Settings2, MapPin, Sparkles } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

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

interface BotSettings {
  workshop_id: string;
  business_description: string | null;
  services_json: Service[];
  faq_json: FAQ[];
  tone: string | null;
  system_prompt: string | null;
}

interface WorkshopInfo {
  address: string | null;
  phone: string | null;
  city: string | null;
  booking_url: string | null;
  zone_detection_enabled?: boolean | null;
}

interface BotSettingsEditorProps {
  workshopId: string;
  workshopName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TONE_OPTIONS = [
  { value: 'professional', label: 'Profesional', description: 'Formal pero amigable' },
  { value: 'friendly', label: 'Amigable', description: 'Cercano y cálido, usa emojis' },
  { value: 'casual', label: 'Casual', description: 'Muy relajado, como un amigo' },
  { value: 'formal', label: 'Formal', description: 'Muy respetuoso y formal' },
];

export function BotSettingsEditor({ workshopId, workshopName, open, onOpenChange }: BotSettingsEditorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Form state
  const [businessDescription, setBusinessDescription] = useState('');
  const [tone, setTone] = useState('professional');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [services, setServices] = useState<Service[]>([]);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  
  // Workshop info state
  const [workshopAddress, setWorkshopAddress] = useState('');
  const [workshopPhone, setWorkshopPhone] = useState('');
  const [workshopCity, setWorkshopCity] = useState('');
  const [bookingUrl, setBookingUrl] = useState('');
  const [zoneDetectionEnabled, setZoneDetectionEnabled] = useState(false);

  // Fetch current settings
  const { data: botSettings, isLoading: isLoadingBot } = useQuery({
    queryKey: ['bot-settings', workshopId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bot_settings')
        .select('*')
        .eq('workshop_id', workshopId)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: open && !!workshopId,
  });

  // Fetch workshop info
  const { data: workshopInfo, isLoading: isLoadingWorkshop } = useQuery({
    queryKey: ['workshop-info', workshopId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workshops')
        .select('address, phone, city, booking_url, zone_detection_enabled')
        .eq('id', workshopId)
        .single();
      
      if (error) throw error;
      return data as WorkshopInfo;
    },
    enabled: open && !!workshopId,
  });

  const isLoading = isLoadingBot || isLoadingWorkshop;

  // Initialize form when data loads
  useEffect(() => {
    if (botSettings) {
      setBusinessDescription(botSettings.business_description || '');
      setTone(botSettings.tone || 'professional');
      setSystemPrompt(botSettings.system_prompt || '');
      setServices((botSettings.services_json as unknown as Service[]) || []);
      setFaqs((botSettings.faq_json as unknown as FAQ[]) || []);
    } else if (!isLoading && open) {
      // Reset to defaults if no settings exist
      setBusinessDescription('');
      setTone('professional');
      setSystemPrompt('');
      setServices([]);
      setFaqs([]);
    }
  }, [botSettings, isLoading, open]);

  // Initialize workshop info when data loads
  useEffect(() => {
    if (workshopInfo) {
      setWorkshopAddress(workshopInfo.address || '');
      setWorkshopPhone(workshopInfo.phone || '');
      setWorkshopCity(workshopInfo.city || '');
      setBookingUrl(workshopInfo.booking_url || '');
      setZoneDetectionEnabled(!!workshopInfo.zone_detection_enabled);
    }
  }, [workshopInfo]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const servicesData = JSON.parse(JSON.stringify(services)) as Json;
      const faqsData = JSON.parse(JSON.stringify(faqs)) as Json;

      // Update workshop info
      const { error: workshopError } = await supabase
        .from('workshops')
        .update({
          address: workshopAddress || null,
          phone: workshopPhone || null,
          city: workshopCity || null,
          booking_url: bookingUrl || null,
          zone_detection_enabled: zoneDetectionEnabled,
        })
        .eq('id', workshopId);
      
      if (workshopError) throw workshopError;

      // Update or insert bot settings
      if (botSettings) {
        const { error } = await supabase
          .from('bot_settings')
          .update({
            business_description: businessDescription || null,
            tone,
            system_prompt: systemPrompt || null,
            services_json: servicesData,
            faq_json: faqsData,
            updated_at: new Date().toISOString(),
          })
          .eq('workshop_id', workshopId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('bot_settings')
          .insert({
            workshop_id: workshopId,
            business_description: businessDescription || null,
            tone,
            system_prompt: systemPrompt || null,
            services_json: servicesData,
            faq_json: faqsData,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bot-settings', workshopId] });
      queryClient.invalidateQueries({ queryKey: ['workshop-info', workshopId] });
      toast({ title: 'Configuración guardada', description: 'Los ajustes del bot se actualizaron correctamente.' });
      onOpenChange(false);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5" />
            Configuración del Bot - {workshopName}
          </DialogTitle>
          <DialogDescription>
            Personaliza cómo el bot responde a los clientes de este negocio.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">Cargando configuración...</div>
        ) : (
          <div className="space-y-6">
            <Accordion type="multiple" defaultValue={['workshop', 'general', 'services', 'faq']} className="w-full">
              {/* Workshop Info */}
              <AccordionItem value="workshop">
                <AccordionTrigger className="text-sm font-medium">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    Información del Negocio
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="workshop_address">Dirección</Label>
                      <Input
                        id="workshop_address"
                        placeholder="Av. Principal 123"
                        value={workshopAddress}
                        onChange={(e) => setWorkshopAddress(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="workshop_city">Ciudad</Label>
                      <Input
                        id="workshop_city"
                        placeholder="Santiago"
                        value={workshopCity}
                        onChange={(e) => setWorkshopCity(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="workshop_phone">Teléfono</Label>
                    <Input
                      id="workshop_phone"
                      placeholder="+56 9 1234 5678"
                      value={workshopPhone}
                      onChange={(e) => setWorkshopPhone(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="booking_url">URL de Agendamiento</Label>
                    <Input
                      id="booking_url"
                      placeholder="Se genera automáticamente al publicar la landing"
                      value={bookingUrl}
                      onChange={(e) => setBookingUrl(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      URL donde el bot enviará a los clientes para agendar. Se genera automáticamente al publicar la landing.
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="general">
                <AccordionTrigger className="text-sm font-medium">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    Personalidad del Bot
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="business_description">Descripción del Negocio</Label>
                    <Textarea
                      id="business_description"
                      placeholder="Somos un negocio especializado en..."
                      value={businessDescription}
                      onChange={(e) => setBusinessDescription(e.target.value)}
                      rows={3}
                    />
                    <p className="text-xs text-muted-foreground">
                      El bot usará esta información para describir el negocio.
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
                    <Label htmlFor="system_prompt">Prompt Personalizado (Avanzado)</Label>
                    <Textarea
                      id="system_prompt"
                      placeholder="Deja vacío para usar el prompt automático..."
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      rows={4}
                    />
                    <p className="text-xs text-muted-foreground">
                      Opcional. Sobrescribe el prompt del sistema completamente.
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Services */}
              <AccordionItem value="services">
                <AccordionTrigger className="text-sm font-medium">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" />
                    Servicios ({services.length})
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-4">
                  <p className="text-xs text-muted-foreground">
                    Lista de servicios que ofrece el negocio. El bot podrá informar precios y descripciones.
                  </p>

                  {services.map((service, index) => (
                    <div key={index} className="flex gap-2 items-start p-3 border rounded-lg bg-muted/30">
                      <div className="flex-1 grid grid-cols-4 gap-2">
                        <Input
                          placeholder="Nombre del servicio"
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
                    Agregar Servicio
                  </Button>
                </AccordionContent>
              </AccordionItem>

              {/* FAQ */}
              <AccordionItem value="faq">
                <AccordionTrigger className="text-sm font-medium">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="w-4 h-4" />
                    Preguntas Frecuentes ({faqs.length})
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-4">
                  <p className="text-xs text-muted-foreground">
                    Preguntas y respuestas que el bot usará para responder consultas comunes.
                  </p>

                  {faqs.map((faq, index) => (
                    <div key={index} className="space-y-2 p-3 border rounded-lg bg-muted/30">
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
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Guardando...' : 'Guardar Configuración'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
