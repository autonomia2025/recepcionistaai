import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { ConversationList } from '@/components/inbox/ConversationList';
import { ChatView } from '@/components/inbox/ChatView';
import { useConversations, Conversation } from '@/hooks/useConversations';
import { MessageSquare, ArrowLeft, Inbox, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function ConversationListSkeleton() {
  return (
    <div className="space-y-1 p-4">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="flex items-start gap-3 p-3">
          <Skeleton className="w-10 h-10 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

const SOC_WORKSHOP_ID = '610fb257-a649-4115-b944-21f31e7952db';

export default function InboxPage() {
  const { profile } = useAuth();
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [zoneFilter, setZoneFilter] = useState<string>('all');
  const { data: conversations, isLoading } = useConversations();
  const showZoneFilter = profile?.workshop_id === SOC_WORKSHOP_ID;

  // Filter conversations by zone
  const filteredByZone = conversations?.filter(conv => {
    if (zoneFilter === 'all') return true;
    return (conv.contacts as any).zone === zoneFilter;
  });

  // On mobile, when a conversation is selected, show chat
  const handleSelectConversation = (conv: Conversation) => {
    setSelectedConversation(conv);
    setShowChat(true);
  };

  // On mobile, go back to list
  const handleBackToList = () => {
    setShowChat(false);
  };

  // Update selected conversation when data changes (for realtime updates)
  useEffect(() => {
    if (selectedConversation && conversations) {
      const updated = conversations.find(c => c.id === selectedConversation.id);
      if (updated) {
        setSelectedConversation(updated);
      }
    }
  }, [conversations, selectedConversation?.id]);

  if (isLoading) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <PageHeader title="Inbox" description="Gestiona las conversaciones con tus clientes" />
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <div className="w-full md:w-80 lg:w-96 border-r border-border/50 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-border/50 shrink-0">
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
            <div className="flex-1 overflow-auto">
              <ConversationListSkeleton />
            </div>
          </div>
          <div className="hidden md:flex flex-1 items-center justify-center">
            <Skeleton className="w-16 h-16 rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      {/* Header - hide on mobile when in chat view */}
      <div className={cn(
        "bg-background shrink-0",
        showChat && "hidden md:block"
      )}>
        <div className="flex items-center gap-3 flex-wrap">
          <PageHeader title="Inbox" description="Gestiona las conversaciones con tus clientes" />
          {showZoneFilter && (
            <Select value={zoneFilter} onValueChange={setZoneFilter}>
              <SelectTrigger className="w-[150px] h-9 text-xs">
                <MapPin className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="Zona" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las zonas</SelectItem>
                <SelectItem value="santiago">📍 Santiago</SelectItem>
                <SelectItem value="talca">📍 Talca</SelectItem>
                <SelectItem value="puerto_montt">📍 Puerto Montt</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
      
      {/* Mobile header when in chat */}
      {showChat && selectedConversation && (
        <div className="md:hidden px-4 pt-4 pb-3 flex items-center gap-3 border-b border-border/50 bg-card shrink-0">
          <Button variant="ghost" size="icon" onClick={handleBackToList} className="flex-shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm truncate">{selectedConversation.contacts.name}</h3>
            <p className="text-xs text-muted-foreground truncate">
              {selectedConversation.contacts.phone || selectedConversation.contacts.whatsapp_id}
            </p>
          </div>
        </div>
      )}
      
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Conversation List - hide on mobile when showing chat */}
        <div className={cn(
          "w-full md:w-80 lg:w-96 flex-shrink-0",
          showChat && "hidden md:block"
        )}>
          <ConversationList
            conversations={filteredByZone || []}
            selectedId={selectedConversation?.id || null}
            onSelect={handleSelectConversation}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />
        </div>

        {/* Chat View - full screen on mobile when selected */}
        <div className={cn(
          "flex-1 min-w-0 bg-background",
          !showChat && "hidden md:block"
        )}>
          {selectedConversation ? (
            <ChatView conversation={selectedConversation} />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-6">
              <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
                <Inbox className="w-8 h-8 text-muted-foreground/50" />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-1">
                Selecciona una conversación
              </h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                Elige una conversación de la lista para ver los mensajes y responder
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
