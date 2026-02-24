import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Copy, Check, Globe, ExternalLink, Palette } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Workshop {
  id: string;
  name: string;
  web_chat_enabled?: boolean;
  web_chat_allowed_domains?: string[];
  web_chat_primary_color?: string;
  web_chat_position?: string;
  web_chat_title?: string;
  web_chat_welcome_message?: string;
  web_chat_z_index?: string;
}

interface WebChatConfigDialogProps {
  workshop: Workshop | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Default values for the widget
const DEFAULTS = {
  primaryColor: "#3B82F6",
  position: "bottom-right" as const,
  title: "Asistente Virtual",
  welcomeMessage: "¿En qué podemos ayudarte hoy?",
  zIndex: "999999",
};

export function WebChatConfigDialog({
  workshop,
  open,
  onOpenChange,
}: WebChatConfigDialogProps) {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [domains, setDomains] = useState("");
  const [copied, setCopied] = useState(false);

  // Customization options
  const [primaryColor, setPrimaryColor] = useState(DEFAULTS.primaryColor);
  const [position, setPosition] = useState<"bottom-right" | "bottom-left">(DEFAULTS.position);
  const [title, setTitle] = useState(DEFAULTS.title);
  const [welcomeMessage, setWelcomeMessage] = useState(DEFAULTS.welcomeMessage);
  const [zIndex, setZIndex] = useState(DEFAULTS.zIndex);

  useEffect(() => {
    if (workshop) {
      setEnabled(workshop.web_chat_enabled || false);
      setDomains((workshop.web_chat_allowed_domains || []).join("\n"));
      // Load saved customization values, falling back to defaults
      setPrimaryColor(workshop.web_chat_primary_color || DEFAULTS.primaryColor);
      setPosition((workshop.web_chat_position as "bottom-right" | "bottom-left") || DEFAULTS.position);
      setTitle(workshop.web_chat_title || DEFAULTS.title);
      setWelcomeMessage(workshop.web_chat_welcome_message || DEFAULTS.welcomeMessage);
      setZIndex(workshop.web_chat_z_index || DEFAULTS.zIndex);
    }
  }, [workshop]);

  const updateMutation = useMutation({
    mutationFn: async (data: { 
      enabled: boolean; 
      domains: string[];
      primaryColor: string;
      position: string;
      title: string;
      welcomeMessage: string;
      zIndex: string;
    }) => {
      const { error } = await supabase
        .from("workshops")
        .update({
          web_chat_enabled: data.enabled,
          web_chat_allowed_domains: data.domains,
          web_chat_primary_color: data.primaryColor,
          web_chat_position: data.position,
          web_chat_title: data.title,
          web_chat_welcome_message: data.welcomeMessage,
          web_chat_z_index: data.zIndex,
        })
        .eq("id", workshop!.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-workshops"] });
      toast.success("Configuración de Web Chat actualizada");
      onOpenChange(false);
    },
    onError: (error) => {
      console.error("Error updating web chat config:", error);
      toast.error("Error al actualizar configuración");
    },
  });

  const handleSave = () => {
    const domainList = domains
      .split("\n")
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 0);

    if (enabled && domainList.length === 0) {
      toast.error("Debes agregar al menos un dominio permitido");
      return;
    }

    updateMutation.mutate({ 
      enabled, 
      domains: domainList,
      primaryColor,
      position,
      title,
      welcomeMessage,
      zIndex,
    });
  };

  const getScriptTag = () => {
    if (!workshop) return "";
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

    const params = new URLSearchParams();
    params.set("id", workshop.id);

    // Only add non-default parameters
    if (primaryColor !== DEFAULTS.primaryColor) {
      params.set("primaryColor", primaryColor);
    }
    if (position !== DEFAULTS.position) {
      params.set("position", position);
    }
    if (title !== DEFAULTS.title) {
      params.set("title", title);
    }
    if (welcomeMessage !== DEFAULTS.welcomeMessage) {
      params.set("welcomeMessage", welcomeMessage);
    }
    if (zIndex !== DEFAULTS.zIndex) {
      params.set("zIndex", zIndex);
    }

    return `<script src="${supabaseUrl}/functions/v1/web-chat-widget?${params.toString()}" async></script>`;
  };

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(getScriptTag());
      setCopied(true);
      toast.success("Script copiado al portapapeles");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Error al copiar");
    }
  };

  const isValidHexColor = (color: string) => /^#[0-9A-Fa-f]{6}$/.test(color);

  if (!workshop) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Web Chat - {workshop.name}
          </DialogTitle>
          <DialogDescription>
            Configura el widget de chat para incrustar en la página web del cliente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="web-chat-enabled">Habilitar Web Chat</Label>
              <p className="text-sm text-muted-foreground">
                Permite que visitantes chateen desde la web del cliente
              </p>
            </div>
            <Switch
              id="web-chat-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>

          <Separator />

          {/* Allowed domains */}
          <div className="space-y-2">
            <Label htmlFor="domains">Dominios permitidos</Label>
            <p className="text-sm text-muted-foreground">
              Un dominio por línea. Usa <code className="bg-muted px-1 rounded">*.ejemplo.com</code> para incluir subdominios.
            </p>
            <Textarea
              id="domains"
              placeholder={`ejemplo.cl\n*.ejemplo.cl\notrodominio.com`}
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              rows={3}
              disabled={!enabled}
            />
            <div className="flex flex-wrap gap-1 mt-2">
              {domains
                .split("\n")
                .filter((d) => d.trim())
                .map((domain, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">
                    {domain.trim()}
                  </Badge>
                ))}
            </div>
          </div>

          <Separator />

          {/* Customization section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-muted-foreground" />
              <Label className="text-base font-medium">Personalización del Widget</Label>
            </div>

            {/* Primary color */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="primaryColor">Color primario</Label>
                <div className="flex gap-2">
                  <Input
                    id="primaryColor"
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-12 h-9 p-1 cursor-pointer"
                    disabled={!enabled}
                  />
                  <Input
                    type="text"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    placeholder="#3B82F6"
                    className={`flex-1 font-mono text-sm ${!isValidHexColor(primaryColor) ? "border-destructive" : ""}`}
                    maxLength={7}
                    disabled={!enabled}
                  />
                </div>
              </div>

              {/* Position */}
              <div className="space-y-2">
                <Label htmlFor="position">Posición</Label>
                <Select
                  value={position}
                  onValueChange={(v) => setPosition(v as "bottom-right" | "bottom-left")}
                  disabled={!enabled}
                >
                  <SelectTrigger id="position">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bottom-right">Inferior derecha</SelectItem>
                    <SelectItem value="bottom-left">Inferior izquierda</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Título del bot</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Asistente Virtual"
                maxLength={50}
                disabled={!enabled}
              />
            </div>

            {/* Welcome message */}
            <div className="space-y-2">
              <Label htmlFor="welcomeMessage">Mensaje de bienvenida</Label>
              <Input
                id="welcomeMessage"
                value={welcomeMessage}
                onChange={(e) => setWelcomeMessage(e.target.value)}
                placeholder="¿En qué podemos ayudarte hoy?"
                maxLength={200}
                disabled={!enabled}
              />
            </div>

            {/* Z-Index */}
            <div className="space-y-2">
              <Label htmlFor="zIndex">Z-Index</Label>
              <Input
                id="zIndex"
                type="number"
                value={zIndex}
                onChange={(e) => setZIndex(e.target.value)}
                placeholder="999999"
                min={1}
                max={2147483647}
                disabled={!enabled}
              />
              <p className="text-xs text-muted-foreground">
                Controla la capa del widget. Aumentar si queda oculto tras otros elementos.
              </p>
            </div>
          </div>

          <Separator />

          {/* Script to copy */}
          <div className="space-y-2">
            <Label>Script para incrustar</Label>
            <p className="text-sm text-muted-foreground">
              Pegar antes de <code className="bg-muted px-1 rounded">&lt;/body&gt;</code> en la web del cliente.
            </p>
            <div className="relative">
              <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto whitespace-pre-wrap break-all">
                {getScriptTag()}
              </pre>
              <Button
                size="sm"
                variant="secondary"
                className="absolute top-2 right-2"
                onClick={copyScript}
                disabled={!enabled}
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Preview link */}
          {enabled && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ExternalLink className="h-4 w-4" />
              <span>
                El widget aparecerá como un botón flotante en la esquina {position === "bottom-left" ? "inferior izquierda" : "inferior derecha"}.
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Guardando..." : "Guardar cambios"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
