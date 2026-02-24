import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UserPlus, Mail, Phone, Building2, MessageSquare, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';

interface NewLead {
  id: string;
  created_at: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  industry: string | null;
  message: string | null;
  source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
}

export const LeadNotificationListener = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [newLead, setNewLead] = useState<NewLead | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const isSuperAdmin = profile?.role === 'SUPERADMIN';

  useEffect(() => {
    if (!isSuperAdmin) return;

    const channel = supabase
      .channel('new-leads')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'marketing_leads',
        },
        (payload) => {
          console.log('New lead received:', payload);
          setNewLead(payload.new as NewLead);
          setIsOpen(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isSuperAdmin]);

  if (!isSuperAdmin) return null;

  const handleViewLeads = () => {
    setIsOpen(false);
    navigate('/admin/leads');
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="p-2 rounded-full bg-green-100">
              <UserPlus className="h-5 w-5 text-green-600" />
            </div>
            <span>¡Nuevo Lead!</span>
            <Badge className="bg-green-100 text-green-800 ml-2">Recién llegado</Badge>
          </DialogTitle>
        </DialogHeader>

        {newLead && (
          <div className="space-y-4">
            {/* Lead Info */}
            <div className="p-4 bg-muted rounded-lg space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-xl font-bold text-primary">
                    {newLead.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <h3 className="font-semibold text-lg">{newLead.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(newLead.created_at), "dd MMM yyyy 'a las' HH:mm", { locale: es })}
                  </p>
                </div>
              </div>

              <div className="grid gap-2 pt-2 border-t">
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <a href={`mailto:${newLead.email}`} className="text-primary hover:underline">
                    {newLead.email}
                  </a>
                </div>

                {newLead.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <a href={`tel:${newLead.phone}`} className="hover:underline">
                      {newLead.phone}
                    </a>
                  </div>
                )}

                {newLead.company && (
                  <div className="flex items-center gap-2 text-sm">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <span>{newLead.company}</span>
                    {newLead.industry && (
                      <Badge variant="secondary" className="text-xs">
                        {newLead.industry}
                      </Badge>
                    )}
                  </div>
                )}
              </div>

              {newLead.message && (
                <div className="pt-2 border-t">
                  <div className="flex items-start gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <p className="text-sm">{newLead.message}</p>
                  </div>
                </div>
              )}

              {/* UTM Info */}
              {(newLead.utm_source || newLead.utm_medium || newLead.utm_campaign) && (
                <div className="pt-2 border-t flex flex-wrap gap-1">
                  {newLead.source && (
                    <Badge variant="outline" className="text-xs">
                      {newLead.source}
                    </Badge>
                  )}
                  {newLead.utm_source && (
                    <Badge variant="outline" className="text-xs">
                      src: {newLead.utm_source}
                    </Badge>
                  )}
                  {newLead.utm_medium && (
                    <Badge variant="outline" className="text-xs">
                      med: {newLead.utm_medium}
                    </Badge>
                  )}
                  {newLead.utm_campaign && (
                    <Badge variant="outline" className="text-xs">
                      camp: {newLead.utm_campaign}
                    </Badge>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsOpen(false)} className="flex-1">
                Cerrar
              </Button>
              <Button onClick={handleViewLeads} className="flex-1 gap-2">
                <ExternalLink className="h-4 w-4" />
                Ver todos los leads
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
