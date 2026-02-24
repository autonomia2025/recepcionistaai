import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle2, AlertTriangle, Lock } from 'lucide-react';

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let resolved = false;

    // Listen for PASSWORD_RECOVERY event (PKCE flow)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (resolved) return;
      if (event === 'PASSWORD_RECOVERY' && session) {
        resolved = true;
        setTokenValid(true);
      }
    });

    // Also check hash params (legacy/implicit flow fallback)
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const type = hashParams.get('type');
    const accessToken = hashParams.get('access_token');

    if (type === 'recovery' && accessToken) {
      resolved = true;
      setTokenValid(true);
    }

    // Check if already authenticated via recovery (page reload after token exchange)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (resolved) return;
      if (session) {
        // User has a valid session — allow password update
        resolved = true;
        setTokenValid(true);
      }
    });

    // Timeout: if nothing resolves in 5 seconds, show invalid
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        setTokenValid(false);
      }
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres');
      return;
    }

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);
      setTimeout(() => navigate('/auth'), 3000);
    } catch (err: any) {
      setError(err.message || 'Error al actualizar la contraseña');
    } finally {
      setLoading(false);
    }
  };

  if (tokenValid === null) {
    return (
      <div className="min-h-screen flex items-center justify-center app-surface">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Verificando enlace...</p>
        </div>
      </div>
    );
  }

  if (tokenValid === false) {
    return (
      <div className="min-h-screen min-h-[100dvh] flex items-center justify-center app-surface p-4 sm:p-6">
        <Card className="w-full max-w-md shadow-xl bg-white/80 border-white/50 backdrop-blur-xl">
          <CardContent className="p-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>
            <div>
              <p className="font-medium text-foreground">Enlace inválido o expirado</p>
              <p className="text-sm text-muted-foreground mt-1">
                El enlace de recuperación ha expirado o ya fue utilizado. Solicita uno nuevo.
              </p>
            </div>
            <Button onClick={() => navigate('/reset-password')} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
              Solicitar nuevo enlace
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen min-h-[100dvh] flex items-center justify-center app-surface p-4 sm:p-6">
      <Card className="w-full max-w-md shadow-xl bg-white/80 border-white/50 backdrop-blur-xl">
        <CardHeader className="text-center px-4 sm:px-6 pt-6 sm:pt-8 pb-2">
          <div className="w-40 h-24 sm:w-48 sm:h-32 flex items-center justify-center mx-auto mb-3 sm:mb-4">
            <img src="/logo-auth.png" alt="AutonomIA Suite" className="w-40 h-24 sm:w-48 sm:h-32 object-contain" />
          </div>
          <CardTitle className="text-xl sm:text-2xl">Nueva contraseña</CardTitle>
          <CardDescription>Ingresa tu nueva contraseña</CardDescription>
        </CardHeader>
        <CardContent className="px-4 sm:px-6 pb-6 sm:pb-8">
          {success ? (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              </div>
              <div>
                <p className="font-medium text-foreground">Contraseña actualizada</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Redirigiendo al login...
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Nueva contraseña</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    required
                    minLength={6}
                    className="pl-10 h-12 sm:h-10"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirmar contraseña</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repite la contraseña"
                    required
                    minLength={6}
                    className="pl-10 h-12 sm:h-10"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              {error && (
                <p className="text-sm text-destructive bg-destructive/10 rounded-md p-2">{error}</p>
              )}

              <Button
                type="submit"
                className="w-full h-12 sm:h-10 bg-blue-600 hover:bg-blue-700 text-white"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Actualizando...
                  </>
                ) : (
                  'Actualizar contraseña'
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
