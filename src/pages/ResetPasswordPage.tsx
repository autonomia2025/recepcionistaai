import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Loader2, Mail, CheckCircle2 } from 'lucide-react';

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/update-password`,
      });
      if (error) throw error;
      setSent(true);
    } catch (err: any) {
      setError(err.message || 'Error al enviar el enlace de recuperación');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen min-h-[100dvh] flex items-center justify-center app-surface p-4 sm:p-6">
      <Card className="w-full max-w-md shadow-xl bg-white/80 border-white/50 backdrop-blur-xl">
        <CardHeader className="text-center px-4 sm:px-6 pt-6 sm:pt-8 pb-2">
          <div className="w-40 h-24 sm:w-48 sm:h-32 flex items-center justify-center mx-auto mb-3 sm:mb-4">
            <img src="/logo-auth.png" alt="AutonomIA Suite" className="w-40 h-24 sm:w-48 sm:h-32 object-contain" />
          </div>
          <CardTitle className="text-xl sm:text-2xl">Recuperar contraseña</CardTitle>
          <CardDescription className="text-sm sm:text-base">
            Ingresa tu email y te enviaremos un enlace para restablecer tu contraseña
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 sm:px-6 pb-6 sm:pb-8">
          {sent ? (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              </div>
              <div>
                <p className="font-medium text-foreground">Enlace enviado</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Revisa tu bandeja de entrada en <strong>{email}</strong> y sigue las instrucciones.
                </p>
              </div>
              <Link to="/auth">
                <Button variant="outline" className="w-full mt-4">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Volver al login
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@email.com"
                    required
                    className="pl-10 h-12 sm:h-10"
                    autoComplete="email"
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
                    Enviando...
                  </>
                ) : (
                  'Enviar enlace de recuperación'
                )}
              </Button>

              <Link to="/auth" className="block">
                <Button variant="ghost" className="w-full text-muted-foreground">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Volver al login
                </Button>
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
