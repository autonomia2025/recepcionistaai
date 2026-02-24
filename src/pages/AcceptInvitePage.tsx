import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, XCircle, Building2 } from 'lucide-react';

interface InviteData {
  id: string;
  email: string;
  role: string;
  workshop_id: string;
  status: string;
  expires_at: string;
  workshop_name: string | null;
}

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<InviteData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isSignUp, setIsSignUp] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Fetch invite data using the secure RPC
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

  // If user is already logged in, try to accept invite using secure RPC
  useEffect(() => {
    const acceptForLoggedInUser = async () => {
      if (user && invite && !submitting && token) {
        // Check if user email matches invite email
        if (user.email?.toLowerCase() !== invite.email.toLowerCase()) {
          setError(`Esta invitación es para ${invite.email}. Cierra sesión e intenta de nuevo.`);
          return;
        }

        setSubmitting(true);
        await acceptInviteSecure();
      }
    };

    acceptForLoggedInUser();
  }, [user, invite]);

  const acceptInviteSecure = async () => {
    if (!token) return;

    try {
      const { data, error: rpcError } = await supabase
        .rpc('accept_invite', { invite_token: token });

      if (rpcError) {
        console.error('Accept invite error:', rpcError);
        throw new Error(rpcError.message);
      }

      const result = data as { success: boolean; workshop_name?: string } | null;

      await refreshProfile();

      toast({
        title: '¡Bienvenido al equipo!',
        description: `Te has unido a ${result?.workshop_name || 'el negocio'}`,
      });

      navigate('/dashboard');
    } catch (err: any) {
      console.error('Accept invite error:', err);
      setError(err.message || 'Error al aceptar la invitación');
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite || !token) return;

    setSubmitting(true);
    setError(null);

    try {
      if (isSignUp) {
        // Sign up new user with metadata
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              role: invite.role,
            },
            emailRedirectTo: `${window.location.origin}/invite/${token}`,
          },
        });

        if (signUpError) throw signUpError;

        if (signUpData.user) {
          // Use the secure RPC to accept invite (this will update profile and invite)
          const { data, error: rpcError } = await supabase
            .rpc('accept_invite', { invite_token: token });

          if (rpcError) {
            console.error('Accept invite after signup error:', rpcError);
          }

          const result = data as { success: boolean; workshop_name?: string } | null;

          toast({
            title: '¡Cuenta creada!',
            description: `Bienvenido a ${result?.workshop_name || invite.workshop_name || 'el negocio'}`,
          });

          navigate('/dashboard');
        }
      } else {
        // Sign in existing user
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) throw signInError;

        if (signInData.user) {
          await acceptInviteSecure();
        }
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
          <CardDescription>
            {invite?.workshop_name || 'Un negocio'} te ha invitado como <strong>{invite?.role}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && (
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
                onChange={(e) => setEmail(e.target.value)}
                disabled={!!invite?.email}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isSignUp ? 'Crea una contraseña' : 'Tu contraseña'}
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Procesando...
                </>
              ) : isSignUp ? (
                'Crear cuenta y unirme'
              ) : (
                'Iniciar sesión y unirme'
              )}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <Button
              variant="link"
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-sm"
            >
              {isSignUp ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
