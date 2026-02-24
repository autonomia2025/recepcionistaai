import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldCheck, Sparkles, LockKeyhole, Loader2, Lock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export default function AuthPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [preflightStep, setPreflightStep] = useState(0);
  const [buttonStep, setButtonStep] = useState(0);
  const [performanceMode, setPerformanceMode] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [lockFlash, setLockFlash] = useState(false);
  const [errorPulse, setErrorPulse] = useState(false);
  const [focusBoost, setFocusBoost] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const emailValid = /\S+@\S+\.\S+/.test(email);
  const buttonStates = ['Acceder al sistema', 'Validando identidad…', 'Cargando entorno…', 'Sistema listo'];
  const preflightLines = [
    'Verificando identidad',
    'Cargando contexto operativo',
    'Sincronizando motor IA',
    'Verificando permisos',
    'Entorno listo',
  ];

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(media.matches);
    const handler = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (reducedMotion || performanceMode) {
      if (rootRef.current) {
        rootRef.current.style.setProperty('--parallax-x', '0px');
        rootRef.current.style.setProperty('--parallax-y', '0px');
      }
      return;
    }

    let raf = 0;
    const handleMove = (event: MouseEvent) => {
      const { innerWidth, innerHeight } = window;
      const x = (event.clientX / innerWidth - 0.5) * 12;
      const y = (event.clientY / innerHeight - 0.5) * 10;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!rootRef.current) return;
        rootRef.current.style.setProperty('--parallax-x', `${x}px`);
        rootRef.current.style.setProperty('--parallax-y', `${y}px`);
      });
    };

    window.addEventListener('mousemove', handleMove);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      cancelAnimationFrame(raf);
    };
  }, [reducedMotion, performanceMode]);

  useEffect(() => {
    const timers = preflightLines.map((_, index) =>
      setTimeout(() => setPreflightStep(index + 1), 180 + index * 150),
    );
    const finalTimer = setTimeout(() => setPreflightStep(preflightLines.length + 1), 180 + preflightLines.length * 150 + 160);
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      clearTimeout(finalTimer);
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      setButtonStep(0);
      return;
    }
    const steps = [1, 2];
    let index = 0;
    const interval = setInterval(() => {
      setButtonStep(steps[index]);
      index = (index + 1) % steps.length;
    }, 700);
    return () => clearInterval(interval);
  }, [loading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAuthError(null);

    try {
      const { error } = await signIn(email, password);
      if (error) throw error;
      setButtonStep(3);
      setTimeout(() => navigate('/dashboard'), 300);
    } catch (error: any) {
      setAuthError(error.message);
      setLockFlash(true);
      setErrorPulse(true);
      setTimeout(() => setLockFlash(false), 1200);
      setTimeout(() => setErrorPulse(false), 500);
      toast({ title: 'Acceso bloqueado', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div ref={rootRef} className={cn(
      "auth-root min-h-screen min-h-[100dvh] flex items-center justify-center app-surface p-4 sm:p-6 relative overflow-hidden",
      loading && "is-loading",
      authError && "is-error",
      reducedMotion && "reduce-motion",
      performanceMode && "perf-mode",
      focusBoost && "is-focus"
    )}>
      <div className="absolute inset-0 -z-10">
        <div className="auth-parallax">
          <div className="auth-orb auth-orb--one" />
          <div className="auth-orb auth-orb--two" />
          <div className="auth-orb auth-orb--three" />
          <div className="auth-grid" />
          <div className="auth-scanline" />
          <div className="auth-glyph-field" />
        </div>
      </div>
      <div className="auth-ring" />
      <Card className="w-full max-w-4xl animate-slide-up shadow-xl bg-white/80 border-white/50 backdrop-blur-xl auth-card relative z-10">
        <CardHeader className="text-center px-4 sm:px-6 pt-6 sm:pt-8 pb-2">
          <div className="w-40 h-24 sm:w-48 sm:h-32 flex items-center justify-center mx-auto mb-3 sm:mb-4">
            <img src="/logo-auth.png" alt="AutonomIA Suite" className="w-40 h-24 sm:w-48 sm:h-32 object-contain" />
          </div>
          <CardTitle className="text-xl sm:text-2xl">Acceso al entorno AutonomIA</CardTitle>
          <CardDescription className="text-sm sm:text-base">
            Conectando centro de comando inteligente
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 sm:px-6 pb-6 sm:pb-8 relative">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs text-muted-foreground">Portal de Acceso</span>
            <button
              type="button"
              className="auth-toggle"
              onClick={() => setPerformanceMode((prev) => !prev)}
            >
              {performanceMode ? 'Modo performance: ON' : 'Modo performance: OFF'}
            </button>
          </div>
          <div className="grid gap-6 md:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-2xl border border-border/60 bg-white/70 p-4 sm:p-5 shadow-sm order-2 md:order-none">
              <h3 className="text-lg font-semibold">Estado del sistema</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Supervisando canales, entornos y control inteligente.
              </p>
              <div className="mt-4 space-y-3">
                <div className="telemetry-card flex items-center justify-between rounded-xl bg-muted/40 p-3">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="h-5 w-5 text-emerald-600" />
                    <div>
                      <p className="text-sm font-medium">Motor IA operativo</p>
                      <p className="text-xs text-muted-foreground">Procesos activos · Estado nominal</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-emerald-600 font-medium">Nominal</p>
                    <p className="text-[11px] text-muted-foreground">hace 6s</p>
                  </div>
                </div>
                <div className="telemetry-card flex items-center justify-between rounded-xl bg-muted/40 p-3">
                  <div className="flex items-center gap-3">
                    <Sparkles className="h-5 w-5 text-sky-600" />
                    <div>
                      <p className="text-sm font-medium">Canales en tiempo real</p>
                      <p className="text-xs text-muted-foreground">Eventos sincronizados · Baja latencia</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-emerald-600 font-medium">Estable</p>
                    <p className="text-[11px] text-muted-foreground">hace 9s</p>
                  </div>
                </div>
                <div className="telemetry-card flex items-center justify-between rounded-xl bg-muted/40 p-3">
                  <div className="flex items-center gap-3">
                    <LockKeyhole className="h-5 w-5 text-amber-600" />
                    <div>
                      <p className="text-sm font-medium">Aislamiento por entorno</p>
                      <p className="text-xs text-muted-foreground">Accesos segmentados · Seguridad activa</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-emerald-600 font-medium">Nominal</p>
                    <p className="text-[11px] text-muted-foreground">hace 4s</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-white/70 p-4 sm:p-5 shadow-sm order-1 md:order-none">
              {preflightStep <= preflightLines.length && (
                <div className="space-y-3 auth-preflight">
                  <div className="auth-card-scan" />
                  {preflightLines.map((line, index) => (
                    <div
                      key={line}
                      className={cn(
                        "flex items-center gap-3 rounded-xl bg-muted/40 p-3 transition-all auth-preflight-row",
                        index < preflightStep ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"
                      )}
                      style={{ transitionDelay: `${index * 80}ms` }}
                    >
                      <div className="auth-dot" />
                      <p className="text-sm font-medium flex-1">{line}</p>
                      <span className={cn("auth-check", index < preflightStep && "is-active")} />
                      <span className={cn("auth-progress", index < preflightStep && "is-active")} />
                    </div>
                  ))}
                </div>
              )}

              {preflightStep > preflightLines.length && (
                <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4 auth-form">
                  <div className="space-y-1.5 sm:space-y-2">
                    <Label htmlFor="email" className="text-sm">Email</Label>
                    <div className={cn("relative auth-input", errorPulse && "pulse-error")}>
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onFocus={() => setFocusBoost(true)}
                        onBlur={() => setFocusBoost(false)}
                        required
                        className={cn(
                          "h-12 sm:h-10 text-base sm:text-sm pr-10",
                          email.length > 3 && (emailValid ? "border-emerald-400/70 ring-emerald-400/20" : "border-amber-400/60 ring-amber-400/20")
                        )}
                        autoComplete="email"
                      />
                      {email.length > 3 && (
                        <span className={cn(
                          "auth-glyph-check",
                          emailValid ? "is-valid" : "is-warning"
                        )} />
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5 sm:space-y-2">
                    <Label htmlFor="password" className="text-sm">Contraseña</Label>
                    <div className={cn("auth-input", errorPulse && "pulse-error")}>
                      <Input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onFocus={() => setFocusBoost(true)}
                        onBlur={() => setFocusBoost(false)}
                        required
                        minLength={6}
                        className="h-12 sm:h-10 text-base sm:text-sm"
                        autoComplete="current-password"
                      />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    className={cn(
                      "w-full h-12 sm:h-10 text-sm sm:text-base mt-2 touch-manipulation bg-blue-600 hover:bg-blue-700 text-white transition-transform auth-submit",
                      loading && "is-loading",
                      buttonStep === 3 && "is-ready"
                    )}
                    disabled={loading}
                  >
                    <span className="flex items-center justify-center gap-2">
                      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                      {loading ? buttonStates[buttonStep] : buttonStates[0]}
                    </span>
                    <span className={cn("auth-submit-energy", loading && "is-active")} />
                  </Button>
                  <div className="text-xs text-muted-foreground">
                    {authError
                      ? 'Acceso requiere habilitación previa del equipo AutonomIA'
                      : loading
                        ? 'Inicializando flujos y contexto del sistema…'
                        : 'Acceso privado a entorno operativo con IA activa'}
                  </div>
                </form>
              )}

              {preflightStep <= preflightLines.length && (
                <div className="mt-4 text-xs text-muted-foreground">
                  Conectando sistema operativo…
                </div>
              )}
            </div>
          </div>
          {lockFlash && (
            <div className="auth-lock-overlay">
              <Lock className="h-8 w-8" />
              <span>Acceso restringido</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
