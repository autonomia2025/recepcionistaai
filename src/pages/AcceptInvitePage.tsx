import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, XCircle, Building2, MapPin, LogOut, KeyRound } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InviteData {
  id: string;
  email: string;
  role: string;
  workshop_id: string;
  status: string;
  expires_at: string;
  workshop_name: string | null;
  zone: string | null;
}

const ZONE_LABELS: Record<string, string> = {
  santiago: 'Santiago',
  talca: 'Talca',
  puerto_montt: 'Puerto Montt',
};

const ZONE_STYLES: Record<string, string> = {
  santiago: 'bg-blue-500/10 text-blue-700 border-blue-300 dark:text-blue-300',
  talca: 'bg-emerald-500/10 text-emerald-700 border-emerald-300 dark:text-emerald-300',
  puerto_montt: 'bg-violet-500/10 text-violet-700 border-violet-300 dark:text-violet-300',
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, refreshProfile, signOut } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<InviteData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mode: 'signup' (default - create password) | 'login' (already has account)
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Fetch invite data
  useEffect(() => {
    const fetchInvite = async () => {
      if (!token) {
        setError('Link de invitación inválido');
        setLoading(false);
        return;
      }

      const { data, error: rpcError } = await supabase
        .rpc('get_invite_by_token', { invite_token: token });

      if (rpcError) {
        console.error('Invite fetch error:', rpcError);
        setError('Invitación no encontrada');
        setLoading(false);
        return;
      }

      const inviteData = Array.isArray(data) && data.length > 0 ? data[0] : null;

      if (!inviteData || !inviteData.id) {
        setError('Invitación no encontrada');
        setLoading(false);
        return;
      }

      if (inviteData.status !== 'pending') {
        setError('Esta invitación ya fue utilizada');
        setLoading(false);
        return;
      }

      if (new Date(inviteData.expires_at) < new Date()) {
        setError('Esta invitación ha expirado');
        setLoading(false);
        return;
      }

      setInvite(inviteData as InviteData);
      setEmail(inviteData.email);
      setLoading(false);
    };

    fetchInvite();
  }, [token]);

  // If session is logged in but with the wrong email, force signOut
  useEffect(() => {
    if (user && invite && user.email?.toLowerCase() !== invite.email.toLowerCase()) {
      signOut();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, invite]);

  // Set new password for already-logged-in user, then accept invite
  const handleSetPasswordAndAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite || !token || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) throw updErr;
      await sleep(300);
      await acceptInviteWithRetry();
    } catch (err: any) {
      setError(err.message || 'No se pudo establecer la contraseña');
      setSubmitting(false);
    }
  };

  // RPC call with retry to overcome handle_new_user trigger race
  const acceptInviteWithRetry = async (attempts = 3): Promise<void> => {
    if (!token || !invite) return;

    let lastErr: any = null;
    for (let i = 0; i < attempts; i++) {
      const { data, error: rpcError } = await supabase
        .rpc('accept_invite', { invite_token: token });

      if (!rpcError) {
        const result = data as { success: boolean; workshop_name?: string } | null;
        await refreshProfile();
        toast({
          title: '¡Bienvenido al equipo!',
          description: `Te has unido a ${result?.workshop_name || 'el negocio'}${invite.zone ? ` · Zona ${ZONE_LABELS[invite.zone] || invite.zone}` : ''}`,
        });
        navigate('/dashboard');
        return;
      }

      lastErr = rpcError;
      // Retry on the "profile not yet created" race
      if (rpcError.message?.includes('Profile not yet created')) {
        await sleep(600);
        continue;
      }
      break;
    }

    console.error('Accept invite error:', lastErr);
    setError(lastErr?.message || 'Error al aceptar la invitación');
    setSubmitting(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite || !token) return;

    setSubmitting(true);
    setError(null);

    try {
      if (mode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName, role: invite.role },
            emailRedirectTo: `${window.location.origin}/invite/${token}`,
          },
        });

        if (signUpError) {
          const msg = signUpError.message?.toLowerCase() || '';
          if (msg.includes('already registered') || msg.includes('already been registered')) {
            // Try logging in with the password they just typed (maybe they remember it)
            const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
            if (!signInError) {
              await sleep(400);
              await acceptInviteWithRetry();
              return;
            }
            // Wrong password: switch to login mode and offer reset
            setError('Ya existe una cuenta con este correo pero esa contraseña es incorrecta. Si no la recuerdas, usa "Olvidé mi contraseña" abajo.');
            setMode('login');
            setSubmitting(false);
            return;
          }
          throw signUpError;
        }

        // Try to sign in immediately (works when email confirmation is disabled)
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          toast({
            title: 'Cuenta creada',
            description: 'Revisa tu correo para confirmar tu cuenta y luego abre este link de invitación de nuevo.',
          });
          setSubmitting(false);
          return;
        }

        // Wait for handle_new_user trigger to populate profile, then accept with retry
        await sleep(800);
        await acceptInviteWithRetry();
      } else {
        // Login mode: existing account
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        await sleep(300);
        await acceptInviteWithRetry();
      }
    } catch (err: any) {
      setError(err.message || 'Error al procesar la solicitud');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="public-shell flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !invite) {
    return (
      <div className="public-shell flex items-center justify-center p-4">
        <Card className="public-card w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center">
              <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">Invitación inválida</h2>
              <p className="text-muted-foreground mb-4">{error}</p>
              <Button onClick={() => navigate('/auth')}>Ir al inicio</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (user && submitting) {
    return (
      <div className="public-shell flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Uniéndote al equipo...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="public-shell flex items-center justify-center p-4">
      <Card className="public-card w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center mb-4">
            <Building2 className="h-6 w-6 text-emerald-600" />
          </div>
          <CardTitle>Te han invitado a unirte</CardTitle>
          <CardDescription className="space-y-3 mt-2">
            <div>
              <strong className="text-foreground">{invite?.workshop_name || 'Un negocio'}</strong> te ha invitado
            </div>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <Badge variant="secondary">{invite?.role}</Badge>
              {invite?.zone && (
                <Badge variant="outline" className={cn('gap-1', ZONE_STYLES[invite.zone])}>
                  <MapPin className="h-3 w-3" />
                  Zona {ZONE_LABELS[invite.zone] || invite.zone}
                </Badge>
              )}
            </div>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          <div className="text-center text-sm text-muted-foreground mb-4">
            {mode === 'signup'
              ? 'Crea tu contraseña para activar tu cuenta'
              : 'Ingresa tu contraseña para unirte'}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div className="space-y-2">
                <Label htmlFor="fullName">Nombre completo</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Tu nombre"
                  required
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                disabled
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">
                {mode === 'signup' ? 'Crea tu contraseña' : 'Tu contraseña'}
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'Mínimo 6 caracteres' : 'Tu contraseña'}
                minLength={6}
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Procesando...
                </>
              ) : mode === 'signup' ? (
                'Crear contraseña y unirme'
              ) : (
                'Iniciar sesión y unirme'
              )}
            </Button>
          </form>

          <div className="mt-4 text-center space-y-2">
            <Button
              variant="link"
              onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(null); }}
              className="text-sm"
            >
              {mode === 'signup'
                ? '¿Ya tienes cuenta? Inicia sesión'
                : '¿Primera vez? Crea tu contraseña'}
            </Button>
            {mode === 'login' && (
              <div>
                <Button
                  variant="link"
                  className="text-sm text-muted-foreground"
                  onClick={async () => {
                    if (!email) return;
                    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, {
                      redirectTo: `${window.location.origin}/update-password`,
                    });
                    if (resetErr) {
                      toast({ title: 'Error', description: resetErr.message, variant: 'destructive' });
                    } else {
                      toast({
                        title: 'Correo enviado',
                        description: 'Revisa tu bandeja: te enviamos un link para crear una nueva contraseña. Luego vuelve a abrir esta invitación.',
                      });
                    }
                  }}
                >
                  Olvidé mi contraseña
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
