import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UserPlus, Copy, Check, Link } from 'lucide-react';
import { Database } from '@/integrations/supabase/types';

type AppRole = Database['public']['Enums']['app_role'];

interface InviteDialogProps {
  disabled?: boolean;
}

export function InviteDialog({ disabled }: InviteDialogProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AppRole>('STAFF');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [emailStatus, setEmailStatus] = useState<'idle' | 'sent' | 'failed'>('idle');
  const [sendingEmail, setSendingEmail] = useState(false);

  const sendInviteEmail = async (link: string) => {
    setSendingEmail(true);

    const { error } = await supabase.auth.signInWithOtp({
      email: email.toLowerCase(),
      options: {
        emailRedirectTo: link,
        shouldCreateUser: true,
      },
    });

    setSendingEmail(false);

    if (error) {
      setEmailStatus('failed');
      toast({
        title: 'No se pudo enviar el correo',
        description: error.message,
        variant: 'destructive',
      });
      return false;
    }

    setEmailStatus('sent');
    toast({
      title: 'Invitación enviada',
      description: `Se envió un correo a ${email.toLowerCase()}`,
    });
    return true;
  };

  const createInviteMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.workshop_id) throw new Error('No workshop');

      // Check if invite already exists for this email
      const { data: existing } = await supabase
        .from('invites')
        .select('id, token, status')
        .eq('workshop_id', profile.workshop_id)
        .eq('email', email.toLowerCase())
        .eq('status', 'pending')
        .single();

      if (existing) {
        // Return existing invite link
        return existing.token;
      }

      // Create new invite
      const { data, error } = await supabase
        .from('invites')
        .insert({
          workshop_id: profile.workshop_id,
          email: email.toLowerCase(),
          role: role,
        })
        .select('token')
        .single();

      if (error) throw error;
      return data.token;
    },
    onSuccess: async (token) => {
      const baseUrl = window.location.origin;
      const link = `${baseUrl}/invite/${token}`;
      setInviteLink(link);
      await sendInviteEmail(link);
      queryClient.invalidateQueries({ queryKey: ['invites'] });
      queryClient.invalidateQueries({ queryKey: ['seat-info'] });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'No se pudo crear la invitación',
        variant: 'destructive',
      });
    },
  });

  const handleCopyLink = async () => {
    if (inviteLink) {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast({
        title: 'Link copiado',
        description: 'El link de invitación ha sido copiado al portapapeles',
      });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setEmail('');
    setRole('STAFF');
    setInviteLink(null);
    setCopied(false);
    setEmailStatus('idle');
    setSendingEmail(false);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) handleClose();
      else setOpen(true);
    }}>
      <DialogTrigger asChild>
        <Button disabled={disabled}>
          <UserPlus className="w-4 h-4 mr-2" />
          Invitar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invitar al equipo</DialogTitle>
          <DialogDescription>
            Enviamos un correo con un link seguro para crear la cuenta y unirse al equipo.
          </DialogDescription>
        </DialogHeader>

        {!inviteLink ? (
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email del invitado</Label>
              <Input
                id="email"
                type="email"
                placeholder="ejemplo@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Rol</Label>
              <Select value={role} onValueChange={(value: AppRole) => setRole(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="STAFF">Staff - Puede ver y gestionar citas</SelectItem>
                  <SelectItem value="ADMIN">Admin - Acceso completo al negocio</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full"
              onClick={() => createInviteMutation.mutate()}
              disabled={!email || createInviteMutation.isPending}
            >
              {createInviteMutation.isPending ? 'Enviando invitación...' : 'Enviar invitación por correo'}
            </Button>
          </div>
        ) : (
          <div className="space-y-5 pt-4">
            {/* Success header */}
            <div className="flex flex-col items-center text-center space-y-2">
              <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <Check className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">¡Link generado!</h3>
                <p className="text-sm text-muted-foreground">
                  Invitación para <span className="font-medium text-foreground">{email}</span>
                </p>
                {emailStatus === 'sent' && (
                  <p className="text-xs text-emerald-600 mt-1">Correo enviado con el link de acceso</p>
                )}
                {emailStatus === 'failed' && (
                  <p className="text-xs text-destructive mt-1">
                    No pudimos enviar el correo. Puedes copiar el link o reenviar.
                  </p>
                )}
              </div>
            </div>

            {/* Link display card */}
            <div className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Link className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground mb-1">Link de invitación</p>
                  <p className="text-sm font-mono text-muted-foreground">
                    {window.location.origin}/invite/...
                  </p>
                </div>
              </div>
              
              <Button 
                className="w-full transition-all" 
                variant={copied ? "outline" : "default"}
                onClick={handleCopyLink}
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 mr-2 text-green-600" />
                    <span className="text-green-600">¡Copiado al portapapeles!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-2" />
                    Copiar link
                  </>
                )}
              </Button>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => inviteLink && sendInviteEmail(inviteLink)}
                disabled={sendingEmail}
              >
                {sendingEmail ? 'Reenviando correo...' : 'Reenviar correo'}
              </Button>
            </div>

            {/* Info badge */}
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg py-2 px-3">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>El link expira en 7 días</span>
            </div>

            <Button variant="ghost" className="w-full" onClick={handleClose}>
              <UserPlus className="w-4 h-4 mr-2" />
              Crear otra invitación
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
