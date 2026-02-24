import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Eye, EyeOff, RefreshCw, Copy, Check, Key, User, Mail, Shield, Camera, Briefcase } from 'lucide-react';

interface UserSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const generateSecurePassword = (length: number = 12): string => {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const special = '!@#$%^&*';
  const allChars = uppercase + lowercase + numbers + special;
  
  let password = '';
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];
  
  for (let i = password.length; i < length; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }
  
  return password.split('').sort(() => Math.random() - 0.5).join('');
};

export function UserSettingsDialog({ open, onOpenChange }: UserSettingsDialogProps) {
  const { profile, user } = useAuth();
  const queryClient = useQueryClient();
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Landing profile state
  const [landingRole, setLandingRole] = useState('');
  const [landingPhotoUrl, setLandingPhotoUrl] = useState('');
  const [landingShowOnLanding, setLandingShowOnLanding] = useState(true);

  // Fetch landing_team entry for current user
  const { data: landingProfile, isLoading: loadingLandingProfile } = useQuery({
    queryKey: ['landing-team-profile', user?.id, profile?.workshop_id],
    queryFn: async () => {
      if (!user?.id || !profile?.workshop_id) return null;

      const { data, error } = await supabase
        .from('landing_team')
        .select('*')
        .eq('workshop_id', profile.workshop_id)
        .eq('profile_id', user.id)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!user?.id && !!profile?.workshop_id,
  });

  // Populate form when data loads
  useEffect(() => {
    if (landingProfile) {
      setLandingRole(landingProfile.role || '');
      setLandingPhotoUrl(landingProfile.photo_url || '');
      setLandingShowOnLanding(landingProfile.show_on_landing ?? true);
    }
  }, [landingProfile]);

  // Save landing profile mutation
  const saveLandingProfile = useMutation({
    mutationFn: async () => {
      if (!user?.id || !profile?.workshop_id) throw new Error('No user/workshop');

      const updates = {
        name: profile.full_name || profile.email,
        role: landingRole || null,
        photo_url: landingPhotoUrl || null,
        show_on_landing: landingShowOnLanding,
      };

      if (landingProfile) {
        // Update existing
        const { error } = await supabase
          .from('landing_team')
          .update(updates)
          .eq('id', landingProfile.id);
        if (error) throw error;
      } else {
        // Create new entry
        const { error } = await supabase
          .from('landing_team')
          .insert({
            workshop_id: profile.workshop_id,
            profile_id: user.id,
            ...updates,
            sort_order: 0,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['landing-team-profile'] });
      queryClient.invalidateQueries({ queryKey: ['landing-team'] });
      toast.success('Perfil público actualizado');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al guardar');
    },
  });

  const handleGeneratePassword = () => {
    const password = generateSecurePassword(12);
    setNewPassword(password);
    setShowPassword(true);
  };

  const handleCopyPassword = async () => {
    if (!newPassword) return;
    try {
      await navigator.clipboard.writeText(newPassword);
      setCopied(true);
      toast.success('Contraseña copiada');
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error('Error al copiar');
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres');
      return;
    }

    if (!user?.id) {
      toast.error('No se pudo identificar al usuario');
      return;
    }

    setIsLoading(true);
    try {
      const response = await supabase.functions.invoke('update-user-password', {
        body: { user_id: user.id, new_password: newPassword },
      });

      if (response.error) throw new Error(response.error.message);
      if (response.data?.error) throw new Error(response.data.error);

      toast.success('Contraseña actualizada correctamente');
      setNewPassword('');
      setShowPassword(false);
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error updating password:', error);
      toast.error(error.message || 'Error al actualizar la contraseña');
    } finally {
      setIsLoading(false);
    }
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'SUPERADMIN': return 'destructive';
      case 'ADMIN': return 'default';
      default: return 'secondary';
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'SUPERADMIN': return 'Super Admin';
      case 'ADMIN': return 'Administrador';
      case 'STAFF': return 'Staff';
      default: return role;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="w-5 h-5" />
            Configuración de Cuenta
          </DialogTitle>
        </DialogHeader>

        {/* Profile Info Header */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
          {landingPhotoUrl ? (
            <img src={landingPhotoUrl} alt="Avatar" className="w-12 h-12 rounded-full object-cover" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="w-6 h-6 text-primary" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{profile?.full_name || 'Usuario'}</p>
            <div className="flex items-center gap-2 mt-1">
              <Mail className="w-3 h-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground truncate">{profile?.email}</p>
            </div>
          </div>
          <Badge variant={getRoleBadgeVariant(profile?.role || '')}>
            <Shield className="w-3 h-3 mr-1" />
            {getRoleLabel(profile?.role || '')}
          </Badge>
        </div>

        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="profile">
              <Briefcase className="w-4 h-4 mr-2" />
              Perfil Público
            </TabsTrigger>
            <TabsTrigger value="security">
              <Key className="w-4 h-4 mr-2" />
              Seguridad
            </TabsTrigger>
          </TabsList>

          {/* Landing Profile Tab */}
          <TabsContent value="profile" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">
              Este perfil se muestra en la página de agendamiento de tu negocio.
            </p>

            <div className="space-y-2">
              <Label htmlFor="landing-photo">URL de foto de perfil</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Camera className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="landing-photo"
                    value={landingPhotoUrl}
                    onChange={(e) => setLandingPhotoUrl(e.target.value)}
                    placeholder="https://ejemplo.com/mi-foto.jpg"
                    className="pl-10"
                  />
                </div>
              </div>
              {landingPhotoUrl && (
                <div className="flex justify-center pt-2">
                  <img
                    src={landingPhotoUrl}
                    alt="Preview"
                    className="w-20 h-20 rounded-full object-cover ring-2 ring-primary/20"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="landing-role">Especialidad / Cargo</Label>
              <Input
                id="landing-role"
                value={landingRole}
                onChange={(e) => setLandingRole(e.target.value)}
                placeholder="Ej: Mecánico Jefe, Terapeuta, Instructor"
              />
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div>
                <p className="text-sm font-medium">Visible en la landing</p>
                <p className="text-xs text-muted-foreground">Mostrar tu perfil en la página de agendamiento</p>
              </div>
              <Switch
                checked={landingShowOnLanding}
                onCheckedChange={setLandingShowOnLanding}
              />
            </div>

            <Button
              className="w-full"
              onClick={() => saveLandingProfile.mutate()}
              disabled={saveLandingProfile.isPending || loadingLandingProfile}
            >
              {saveLandingProfile.isPending ? 'Guardando...' : 'Guardar Perfil Público'}
            </Button>
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security" className="space-y-4 mt-4">
            <div className="space-y-3">
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Nueva contraseña"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="pr-24"
                />
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleCopyPassword}
                    disabled={!newPassword}
                  >
                    {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleGeneratePassword}
                  className="flex-1"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Generar automática
                </Button>
              </div>

              <Button
                onClick={handleChangePassword}
                disabled={isLoading || !newPassword}
                className="w-full"
              >
                {isLoading ? 'Actualizando...' : 'Actualizar Contraseña'}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}