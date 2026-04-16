import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useSeatInfo, useSubscription } from '@/hooks/useWorkshopData';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, Clock, Mail, Trash2, MapPin } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { InviteDialog } from '@/components/team/InviteDialog';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';

const SOC_WORKSHOP_ID = '610fb257-a649-4115-b944-21f31e7952db';
const ZONE_LABELS: Record<string, string> = {
  santiago: 'Santiago',
  talca: 'Talca',
  puerto_montt: 'Puerto Montt',
};

export default function TeamPage() {
  const { profile } = useAuth();
  const { data: seatInfo } = useSeatInfo();
  const { data: subscription } = useSubscription();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const deleteInviteMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase
        .from('invites')
        .update({ status: 'expired' })
        .eq('id', inviteId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invites'] });
      toast({
        title: 'Invitación eliminada',
        description: 'La invitación ha sido cancelada',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'No se pudo eliminar la invitación',
        variant: 'destructive',
      });
    },
  });

  const { data: teamMembers } = useQuery({
    queryKey: ['team', profile?.workshop_id],
    queryFn: async () => {
      if (!profile?.workshop_id) return [];
      const { data, error } = await supabase
        .rpc('get_workshop_profiles', { _workshop_id: profile.workshop_id });
      if (error) throw error;
      // Sort by created_at ascending
      return (data || []).sort((a: any, b: any) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    },
    enabled: !!profile?.workshop_id,
  });

  const { data: pendingInvites } = useQuery({
    queryKey: ['invites', profile?.workshop_id],
    queryFn: async () => {
      if (!profile?.workshop_id) return [];
      const { data } = await supabase
        .from('invites')
        .select('*')
        .eq('workshop_id', profile.workshop_id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      return data || [];
    },
    enabled: !!profile?.workshop_id && profile.role === 'ADMIN',
  });

  const canInvite = seatInfo?.isUnlimited || (seatInfo && seatInfo.usedSeats < (seatInfo.maxSeats || 0));
  const seatDisplay = seatInfo?.isUnlimited 
    ? `${seatInfo.usedSeats} / Ilimitado` 
    : `${seatInfo?.usedSeats || 0} / ${seatInfo?.maxSeats || 0}`;

  const isAdmin = profile?.role === 'ADMIN';

  return (
    <div className="page-shell page-stack">
      <PageHeader 
        title="Equipo" 
        description={`Asientos: ${seatDisplay} • Plan ${subscription?.plans?.name || 'Starter'}`}
        actions={isAdmin && <InviteDialog disabled={!canInvite} />}
      />
      
      {!canInvite && isAdmin && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Límite de trabajadores alcanzado. <Button variant="link" className="p-0 h-auto">Sube de plan</Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Pending Invites */}
      {isAdmin && pendingInvites && pendingInvites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Invitaciones pendientes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {pendingInvites.map((invite) => (
                <div key={invite.id} className="py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{invite.email}</p>
                      <p className="text-xs text-muted-foreground">
                        Expira {format(new Date(invite.expires_at), "d 'de' MMMM", { locale: es })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{invite.role}</Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteInviteMutation.mutate(invite.id)}
                      disabled={deleteInviteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Team Members */}
      <Card>
        <CardHeader>
          <CardTitle>Miembros del equipo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {teamMembers?.map((member) => (
              <div key={member.id} className="py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-sm font-medium text-primary">
                      {member.full_name?.charAt(0)?.toUpperCase() || 'U'}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium">{member.full_name}</p>
                    <p className="text-sm text-muted-foreground">{member.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline">{member.role}</Badge>
                  {profile?.workshop_id === SOC_WORKSHOP_ID && member.role === 'STAFF' && (member as any).zone && (
                    <Badge variant="secondary" className="gap-1">
                      <MapPin className="w-3 h-3" />
                      {ZONE_LABELS[(member as any).zone] || (member as any).zone}
                    </Badge>
                  )}
                  <StatusBadge status={member.status} />
                </div>
              </div>
            ))}
            {(!teamMembers || teamMembers.length === 0) && (
              <p className="py-8 text-center text-muted-foreground">
                No hay miembros en el equipo
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
