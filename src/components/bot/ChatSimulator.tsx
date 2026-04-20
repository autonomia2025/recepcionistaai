import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Send, Bot, User, Loader2, RotateCcw, Sparkles, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  intent?: string;
  confidence?: number;
  error?: boolean;
}

const createUuid = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `chat_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const REQUEST_TIMEOUT_MS = 45_000;

export function ChatSimulator() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState(() => createUuid());

  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    const el = scrollViewportRef.current;
    if (el) {
      // Defer to next frame so DOM is updated
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [messages, isLoading]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [input]);

  // Cleanup on unmount: abort any pending request
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    if (!profile?.workshop_id) {
      toast({
        title: 'Configuración incompleta',
        description: 'No se encontró el negocio asociado a tu cuenta.',
        variant: 'destructive',
      });
      return;
    }

    const userMessage: Message = {
      id: createUuid(),
      role: 'user',
      content: text,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Setup abort + timeout
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const { data, error } = await supabase.functions.invoke('build-ai-reply', {
        body: {
          conversation_id: conversationId,
          workshop_id: profile.workshop_id,
          message_text: text,
          contact_name: profile.full_name || 'Usuario de Prueba',
        },
      });

      clearTimeout(timeoutId);
      if (!isMountedRef.current || controller.signal.aborted) return;

      if (error) throw error;

      const replyText = Array.isArray(data?.replies)
        ? data.replies.filter(Boolean).join('\n\n')
        : data?.reply || '';

      if (!replyText) {
        throw new Error('El bot no devolvió una respuesta.');
      }

      setMessages((prev) => [
        ...prev,
        {
          id: createUuid(),
          role: 'assistant',
          content: replyText,
          intent: data?.intent,
          confidence: data?.confidence,
        },
      ]);
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (!isMountedRef.current) return;

      const aborted = controller.signal.aborted;
      const errorMsg = aborted
        ? 'La respuesta tardó demasiado. Intenta de nuevo.'
        : err?.message || 'Error al obtener respuesta. Verifica la configuración del bot.';

      console.error('[ChatSimulator] reply error:', err);

      setMessages((prev) => [
        ...prev,
        {
          id: createUuid(),
          role: 'assistant',
          content: errorMsg,
          error: true,
        },
      ]);

      toast({
        title: 'Error en el simulador',
        description: errorMsg,
        variant: 'destructive',
      });
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
        // Refocus input
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    }
  }, [input, isLoading, profile?.workshop_id, profile?.full_name, conversationId, toast]);

  const resetChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setInput('');
    setIsLoading(false);
    setConversationId(createUuid());
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <Card className="flex flex-col h-[420px] sm:h-[500px]">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="w-5 h-5 text-primary" />
            Simulador de Chat
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={resetChat}
            disabled={messages.length === 0 && !isLoading}
          >
            <RotateCcw className="w-4 h-4 mr-1" />
            Reiniciar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Prueba cómo responderá el bot a tus clientes
        </p>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
        <div
          ref={scrollViewportRef}
          className="flex-1 overflow-y-auto px-4"
          aria-live="polite"
        >
          <div className="space-y-4 py-4">
            {messages.length === 0 && !isLoading && (
              <div className="text-center py-8 text-muted-foreground">
                <Bot className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">Escribe un mensaje para probar el bot</p>
                <p className="text-xs mt-1">
                  Ej: "Hola", "¿Cuáles son sus precios?", "Quiero agendar"
                </p>
              </div>
            )}

            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  'flex gap-2',
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                {message.role === 'assistant' && (
                  <div
                    className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
                      message.error
                        ? 'bg-destructive/10'
                        : 'bg-primary/10'
                    )}
                  >
                    {message.error ? (
                      <AlertCircle className="w-4 h-4 text-destructive" />
                    ) : (
                      <Bot className="w-4 h-4 text-primary" />
                    )}
                  </div>
                )}

                <div
                  className={cn(
                    'max-w-[80%] rounded-lg px-3 py-2',
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : message.error
                      ? 'bg-destructive/10 text-destructive border border-destructive/20'
                      : 'bg-muted'
                  )}
                >
                  <p className="text-sm whitespace-pre-wrap break-words">
                    {message.content}
                  </p>
                  {message.role === 'assistant' && message.intent && !message.error && (
                    <div className="flex flex-wrap gap-2 mt-1.5 text-xs opacity-70">
                      <span className="bg-background/50 px-1.5 py-0.5 rounded">
                        {message.intent}
                      </span>
                      {typeof message.confidence === 'number' && (
                        <span className="bg-background/50 px-1.5 py-0.5 rounded">
                          {Math.round(message.confidence * 100)}% confianza
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {message.role === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-primary-foreground" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-2 justify-start">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
                <div className="bg-muted rounded-lg px-3 py-2 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-xs text-muted-foreground">
                    Pensando...
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="p-3 border-t flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            placeholder="Escribe un mensaje de prueba... (Shift+Enter para nueva línea)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            rows={1}
            className="flex-1 resize-none min-h-[40px] max-h-[120px] py-2"
          />
          <Button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            size="icon"
            className="flex-shrink-0"
            aria-label="Enviar mensaje"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
