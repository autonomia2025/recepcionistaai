import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Building2, Users, MessageSquare, Search, Settings, Power, Wifi, WifiOff, Plus, Copy, ExternalLink, Bot, Trash2, RefreshCw, Eye, EyeOff, Instagram, Globe, Clock } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { WhatsAppConfigDialog } from '@/components/admin/WhatsAppConfigDialog';
import { TwilioConfigDialog } from '@/components/admin/TwilioConfigDialog';
import { InstagramConfigDialog } from '@/components/admin/InstagramConfigDialog';
import { BotSettingsEditor } from '@/components/admin/BotSettingsEditor';
import { WebChatConfigDialog } from '@/components/admin/WebChatConfigDialog';

interface Workshop {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  slug: string | null;
  is_active: boolean;
  created_at: string;
  whatsapp_phone_number_id: string | null;
  whatsapp_business_account_id: string | null;
  whatsapp_access_token: string | null;
  whatsapp_verify_token: string | null;
  whatsapp_connected: boolean;
  whatsapp_connected_at: string | null;
  whatsapp_provider: 'meta' | 'twilio';
  twilio_phone_number: string | null;
  twilio_phone_sid: string | null;
  bot_enabled: boolean | null;
  booking_url: string | null;
  booking_mode: 'with_scheduling' | 'chatbot_only';
  category: string | null;
  instagram_connected?: boolean;
  instagram_page_id?: string | null;
  instagram_access_token?: string | null;
  instagram_connected_at?: string | null;
  web_chat_enabled?: boolean;
  web_chat_allowed_domains?: string[];
}

interface CreateWorkshopForm {
  name: string;
  city: string;
  address: string;
  phone: string;
  plan_id: string;
  admin_email: string;
  admin_password: string;
  admin_name: string;
  booking_mode: 'with_scheduling' | 'chatbot_only';
  category: string;
  initial_channel: 'whatsapp' | 'instagram' | 'web' | 'none';
  whatsapp_provider: 'meta' | 'twilio';
}

interface Subscription {
  id: string;
  workshop_id: string;
  plan_id: string;
  status: string;
  max_users: number | null;
  plans: {
    id: string;
    name: string;
    max_users: number | null;
    price_clp: number;
  } | null;
}

interface Plan {
  id: string;
  name: string;
  max_users: number | null;
  price_clp: number;
}

const initialFormState: CreateWorkshopForm = {
  name: '',
  city: '',
  address: '',
  phone: '',
  plan_id: '',
  admin_email: '',
  admin_password: '',
  admin_name: '',
  booking_mode: 'with_scheduling',
  category: '',
  initial_channel: 'whatsapp',
  whatsapp_provider: 'twilio',
};

export default function AdminWorkshopsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWorkshop, setSelectedWorkshop] = useState<Workshop | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isWhatsAppDialogOpen, setIsWhatsAppDialogOpen] = useState(false);
  const [whatsAppWorkshop, setWhatsAppWorkshop] = useState<Workshop | null>(null);
  const [createForm, setCreateForm] = useState<CreateWorkshopForm>(initialFormState);
  const [isCreating, setIsCreating] = useState(false);
  const [botSettingsWorkshop, setBotSettingsWorkshop] = useState<Workshop | null>(null);
  const [isBotSettingsOpen, setIsBotSettingsOpen] = useState(false);
  const [deleteWorkshop, setDeleteWorkshop] = useState<Workshop | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [workshopUsers, setWorkshopUsers] = useState<{ id: string; email: string; full_name: string }[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [showNewUserPassword, setShowNewUserPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [twilioWorkshop, setTwilioWorkshop] = useState<Workshop | null>(null);
  const [isTwilioDialogOpen, setIsTwilioDialogOpen] = useState(false);
  const [instagramWorkshop, setInstagramWorkshop] = useState<Workshop | null>(null);
  const [isInstagramDialogOpen, setIsInstagramDialogOpen] = useState(false);
  const [webChatWorkshop, setWebChatWorkshop] = useState<Workshop | null>(null);
  const [isWebChatDialogOpen, setIsWebChatDialogOpen] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { setImpersonatedWorkshopId } = useAuth();
  const queryClient = useQueryClient();

  const handleImpersonate = (workshopId: string) => {
    setImpersonatedWorkshopId(workshopId);
    toast({
      title: 'Modo Impersonación',
      description: 'Ahora estás viendo el panel como el cliente'
    });
    navigate('/dashboard');
  };

  const openWhatsAppConfig = (workshop: Workshop) => {
    if (workshop.whatsapp_provider === 'twilio') {
      setTwilioWorkshop(workshop);
      setIsTwilioDialogOpen(true);
    } else {
      setWhatsAppWorkshop(workshop);
      setIsWhatsAppDialogOpen(true);
    }
  };

  const getWhatsAppStatus = (workshop: Workshop) => {
    const provider = workshop.whatsapp_provider === 'twilio' ? ' (Twilio)' : ' (Meta)';
    if (workshop.whatsapp_connected) return { icon: Wifi, label: '🟢', className: 'text-success', provider };
    if (workshop.whatsapp_phone_number_id || workshop.twilio_phone_number) return { icon: WifiOff, label: '🟡', className: 'text-warning', provider };
    return { icon: WifiOff, label: '⚪', className: 'text-muted-foreground', provider };
  };

  const openBotSettings = (workshop: Workshop) => {
    setBotSettingsWorkshop(workshop);
    setIsBotSettingsOpen(true);
  };

  const toggleBotMutation = useMutation({
    mutationFn: async ({ workshopId, enabled }: { workshopId: string; enabled: boolean }) => {
      const { error } = await supabase.from('workshops').update({ bot_enabled: enabled }).eq('id', workshopId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-workshops'] });
      toast({ title: 'Bot actualizado' });
    },
  });

  // Fetch all workshops
  const { data: workshops, isLoading } = useQuery({
    queryKey: ['admin-workshops'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workshops')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Workshop[];
    },
  });

  // Fetch all plans
  const { data: plans } = useQuery({
    queryKey: ['plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plans')
        .select('*')
        .order('price_clp', { ascending: true });
      if (error) throw error;
      return data as Plan[];
    },
  });

  // Fetch subscriptions for all workshops
  const { data: subscriptions } = useQuery({
    queryKey: ['admin-subscriptions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*, plans(*)')
        .in('status', ['active', 'trial']);
      if (error) throw error;
      return data as Subscription[];
    },
  });

  // Fetch profiles count per workshop
  const { data: profileCounts } = useQuery({
    queryKey: ['admin-profile-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('workshop_id')
        .neq('status', 'disabled');
      if (error) throw error;

      const counts: Record<string, number> = {};
      data?.forEach((p) => {
        if (p.workshop_id) {
          counts[p.workshop_id] = (counts[p.workshop_id] || 0) + 1;
        }
      });
      return counts;
    },
  });

  // Fetch conversation counts per workshop
  const { data: conversationCounts } = useQuery({
    queryKey: ['admin-conversation-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select('workshop_id');
      if (error) throw error;

      const counts: Record<string, number> = {};
      data?.forEach((c) => {
        counts[c.workshop_id] = (counts[c.workshop_id] || 0) + 1;
      });
      return counts;
    },
  });


  // Toggle workshop active status
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ workshopId, isActive }: { workshopId: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('workshops')
        .update({ is_active: isActive })
        .eq('id', workshopId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-workshops'] });
      toast({ title: 'Éxito', description: 'Estado del negocio actualizado' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Change plan mutation
  const changePlanMutation = useMutation({
    mutationFn: async ({ workshopId, planId }: { workshopId: string; planId: string }) => {
      const plan = plans?.find(p => p.id === planId);
      if (!plan) throw new Error('Plan no encontrado');

      // Update existing subscription or create new one
      const existingSubscription = subscriptions?.find(s => s.workshop_id === workshopId);

      if (existingSubscription) {
        const { error } = await supabase
          .from('subscriptions')
          .update({
            plan_id: planId,
            max_users: plan.max_users,
            status: 'active'
          })
          .eq('id', existingSubscription.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('subscriptions')
          .insert({
            workshop_id: workshopId,
            plan_id: planId,
            max_users: plan.max_users,
            status: 'active'
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-subscriptions'] });
      toast({ title: 'Éxito', description: 'Plan actualizado correctamente' });
      setIsDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const getWorkshopSubscription = (workshopId: string) => {
    return subscriptions?.find(s => s.workshop_id === workshopId);
  };

  const filteredWorkshops = workshops?.filter(w =>
    w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    w.city?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const openWorkshopDetails = async (workshop: Workshop) => {
    setSelectedWorkshop(workshop);
    setIsDialogOpen(true);
    await loadWorkshopUsers(workshop.id);
  };

  const selectedSubscription = selectedWorkshop ? getWorkshopSubscription(selectedWorkshop.id) : null;

  const generateSlug = (name: string) => {
    return name.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  };

  const handleCreateWorkshop = async () => {
    if (!createForm.name || !createForm.plan_id || !createForm.admin_email || !createForm.admin_password || !createForm.admin_name) {
      toast({ title: 'Error', description: 'Nombre empresa, plan, nombre admin, email y contraseña son requeridos', variant: 'destructive' });
      return;
    }

    if (createForm.admin_password.length < 6) {
      toast({ title: 'Error', description: 'La contraseña debe tener al menos 6 caracteres', variant: 'destructive' });
      return;
    }

    setIsCreating(true);
    try {
      const slug = generateSlug(createForm.name) + '-' + Math.random().toString(36).substring(2, 8);
      const selectedPlan = plans?.find(p => p.id === createForm.plan_id);

      // 1. Create workshop with channel configuration
      const workshopData: any = {
        name: createForm.name,
        city: createForm.city || null,
        address: createForm.address || null,
        phone: createForm.phone || null,
        slug,
        is_active: true,
        booking_mode: createForm.booking_mode,
        category: createForm.category || null,
        whatsapp_provider: createForm.initial_channel === 'whatsapp' ? createForm.whatsapp_provider : 'twilio',
        web_chat_enabled: createForm.initial_channel === 'web',
      };

      const { data: workshop, error: workshopError } = await supabase
        .from('workshops')
        .insert(workshopData)
        .select()
        .single();

      if (workshopError) throw workshopError;

      // 2. Create subscription
      const { error: subError } = await supabase
        .from('subscriptions')
        .insert({
          workshop_id: workshop.id,
          plan_id: createForm.plan_id,
          max_users: selectedPlan?.max_users ?? null,
          status: 'active',
        });

      if (subError) throw subError;

      // 3. Create bot_settings
      const { error: botError } = await supabase
        .from('bot_settings')
        .insert({ workshop_id: workshop.id });

      if (botError) throw botError;

      // 4. Create automations_settings
      const { error: autoError } = await supabase
        .from('automations_settings')
        .insert({ workshop_id: workshop.id });

      if (autoError) throw autoError;

      // 5. Create admin user via edge function
      const { data: userData, error: userError } = await supabase.functions.invoke('create-workshop-user', {
        body: {
          workshop_id: workshop.id,
          email: createForm.admin_email,
          password: createForm.admin_password,
          full_name: createForm.admin_name,
          role: 'ADMIN',
        },
      });

      if (userError || userData?.error) {
        throw new Error(userData?.error || userError?.message || 'Error creando usuario');
      }

      queryClient.invalidateQueries({ queryKey: ['admin-workshops'] });
      queryClient.invalidateQueries({ queryKey: ['admin-subscriptions'] });

      toast({
        title: 'Empresa creada exitosamente',
        description: `Usuario ${createForm.admin_email} creado con acceso de administrador`,
      });

      setIsCreateDialogOpen(false);

      // Open the appropriate channel config dialog based on selection
      if (createForm.initial_channel === 'whatsapp') {
        if (createForm.whatsapp_provider === 'twilio') {
          setTwilioWorkshop(workshop as Workshop);
          setIsTwilioDialogOpen(true);
        } else {
          setWhatsAppWorkshop(workshop as Workshop);
          setIsWhatsAppDialogOpen(true);
        }
      } else if (createForm.initial_channel === 'instagram') {
        setInstagramWorkshop(workshop as Workshop);
        setIsInstagramDialogOpen(true);
      } else if (createForm.initial_channel === 'web') {
        setWebChatWorkshop(workshop as Workshop);
        setIsWebChatDialogOpen(true);
      }

      setCreateForm(initialFormState);
    } catch (error: any) {
      console.error('Error creating workshop:', error);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setIsCreating(false);
    }
  };

  const copyBookingLink = (slug: string) => {
    const url = `${window.location.origin}/agenda/${slug}`;
    navigator.clipboard.writeText(url);
    toast({ title: 'Link copiado al portapapeles' });
  };

  const handleDeleteWorkshop = async () => {
    if (!deleteWorkshop) return;

    setIsDeleting(true);
    try {
      // Use edge function with service role to delete workshop and all related data
      const { data, error } = await supabase.functions.invoke('delete-workshop', {
        body: { workshop_id: deleteWorkshop.id },
      });

      if (error || data?.error) {
        throw new Error(data?.error || error?.message || 'Error eliminando empresa');
      }

      queryClient.invalidateQueries({ queryKey: ['admin-workshops'] });
      queryClient.invalidateQueries({ queryKey: ['admin-subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['admin-profile-counts'] });
      queryClient.invalidateQueries({ queryKey: ['admin-conversation-counts'] });

      toast({ title: 'Empresa eliminada', description: `${deleteWorkshop.name} ha sido eliminada correctamente` });
      setDeleteWorkshop(null);
    } catch (error: any) {
      console.error('Error deleting workshop:', error);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  };

  const handleGeneratePassword = () => {
    const newPassword = generateRandomPassword();
    setCreateForm({ ...createForm, admin_password: newPassword });
    setShowPassword(true);
  };

  const copyPasswordToClipboard = () => {
    navigator.clipboard.writeText(createForm.admin_password);
    toast({ title: 'Contraseña copiada al portapapeles' });
  };

  const loadWorkshopUsers = async (workshopId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .eq('workshop_id', workshopId)
      .neq('status', 'disabled');

    if (!error && data) {
      setWorkshopUsers(data);
      if (data.length > 0) {
        setSelectedUserId(data[0].id);
      }
    }
  };

  const handleChangeUserPassword = async () => {
    if (!selectedUserId || !newUserPassword) {
      toast({ title: 'Error', description: 'Selecciona un usuario e ingresa la nueva contraseña', variant: 'destructive' });
      return;
    }

    if (newUserPassword.length < 6) {
      toast({ title: 'Error', description: 'La contraseña debe tener al menos 6 caracteres', variant: 'destructive' });
      return;
    }

    setIsChangingPassword(true);
    try {
      const { data, error } = await supabase.functions.invoke('update-user-password', {
        body: { user_id: selectedUserId, new_password: newUserPassword },
      });

      if (error || data?.error) {
        throw new Error(data?.error || error?.message || 'Error cambiando contraseña');
      }

      toast({ title: 'Contraseña actualizada', description: 'La contraseña ha sido cambiada exitosamente' });
      setNewUserPassword('');
      setShowNewUserPassword(false);
    } catch (error: any) {
      console.error('Error changing password:', error);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const generateUserPassword = () => {
    const newPwd = generateRandomPassword();
    setNewUserPassword(newPwd);
    setShowNewUserPassword(true);
  };

  const copyUserPasswordToClipboard = () => {
    navigator.clipboard.writeText(newUserPassword);
    toast({ title: 'Contraseña copiada al portapapeles' });
  };

  return (
    <div className="page-shell page-stack">
      <PageHeader
        title="Gestión de Negocios"
        description="Panel de administración de todos los negocios"
        actions={
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Nuevo Negocio
          </Button>
        }
      />

      {/* Search */}
      <div className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o ciudad..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-primary/10">
              <Building2 className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Negocios</p>
              <p className="text-2xl font-bold">{workshops?.length || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-success/10">
              <Power className="w-6 h-6 text-success" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Activos</p>
              <p className="text-2xl font-bold">{workshops?.filter(w => w.is_active).length || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-destructive/10">
              <Power className="w-6 h-6 text-destructive" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Bloqueados</p>
              <p className="text-2xl font-bold">{workshops?.filter(w => !w.is_active).length || 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Workshops Table */}
      <Card>
        <CardHeader>
          <CardTitle>Negocios</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Cargando...</div>
          ) : filteredWorkshops?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No se encontraron negocios</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 font-medium text-muted-foreground">Negocio</th>
                    <th className="pb-3 font-medium text-muted-foreground">Plan</th>
                    <th className="pb-3 font-medium text-muted-foreground">WhatsApp</th>
                    <th className="pb-3 font-medium text-muted-foreground">Instagram</th>
                    <th className="pb-3 font-medium text-muted-foreground">Web</th>
                    <th className="pb-3 font-medium text-muted-foreground">Bot</th>
                    <th className="pb-3 font-medium text-muted-foreground">Usuarios</th>
                    <th className="pb-3 font-medium text-muted-foreground">Conversaciones</th>
                    <th className="pb-3 font-medium text-muted-foreground">Estado</th>
                    <th className="pb-3 font-medium text-muted-foreground">Booking</th>
                    <th className="pb-3 font-medium text-muted-foreground">Creado</th>
                    <th className="pb-3 font-medium text-muted-foreground">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWorkshops?.map((workshop) => {
                    const subscription = getWorkshopSubscription(workshop.id);
                    const userCount = profileCounts?.[workshop.id] || 0;
                    const convCount = conversationCounts?.[workshop.id] || 0;
                    const maxUsers = subscription?.max_users;
                    const userDisplay = maxUsers === null ? `${userCount} / ∞` : `${userCount} / ${maxUsers}`;

                    return (
                      <tr key={workshop.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="py-4">
                          <div>
                            <p className="font-medium">{workshop.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {workshop.city || 'Sin ciudad'}
                            </p>
                          </div>
                        </td>
                        <td className="py-4">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                            {subscription?.plans?.name || 'Sin plan'}
                          </span>
                        </td>
                        <td className="py-4">
                          <Button
                            size="sm"
                            className={cn(
                              "gap-2",
                              workshop.whatsapp_connected && "text-green-600 hover:text-green-700",
                              !workshop.whatsapp_connected && workshop.whatsapp_phone_number_id && "text-yellow-600 hover:text-yellow-700",
                              !workshop.whatsapp_connected && !workshop.whatsapp_phone_number_id && "text-muted-foreground"
                            )}
                            onClick={() => openWhatsAppConfig(workshop)}
                          >
                            {workshop.whatsapp_connected ? (
                              <Wifi className="w-4 h-4" />
                            ) : (
                              <WifiOff className="w-4 h-4" />
                            )}
                            <span className="text-xs">
                              {workshop.whatsapp_connected ? 'Conectado' : workshop.whatsapp_phone_number_id ? 'Pendiente' : 'Configurar'}
                            </span>
                          </Button>
                        </td>
                        <td className="py-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                              "gap-2",
                              workshop.instagram_connected && "text-pink-600 hover:text-pink-700",
                              !workshop.instagram_connected && "text-muted-foreground"
                            )}
                            onClick={() => {
                              setInstagramWorkshop(workshop);
                              setIsInstagramDialogOpen(true);
                            }}
                          >
                            <Instagram className="w-4 h-4" />
                            <span className="text-xs">
                              {workshop.instagram_connected ? 'Conectado' : 'Configurar'}
                            </span>
                          </Button>
                        </td>
                        <td className="py-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                              "gap-2",
                              workshop.web_chat_enabled && "text-emerald-600 hover:text-emerald-700",
                              !workshop.web_chat_enabled && "text-muted-foreground"
                            )}
                            onClick={() => {
                              setWebChatWorkshop(workshop);
                              setIsWebChatDialogOpen(true);
                            }}
                          >
                            <Globe className="w-4 h-4" />
                            <span className="text-xs">
                              {workshop.web_chat_enabled ? 'Activo' : 'Configurar'}
                            </span>
                          </Button>
                        </td>
                        <td className="py-4">
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn(
                                "gap-1",
                                workshop.bot_enabled ? "text-green-600" : "text-muted-foreground"
                              )}
                              onClick={() => toggleBotMutation.mutate({ workshopId: workshop.id, enabled: !workshop.bot_enabled })}
                            >
                              <Bot className="w-4 h-4" />
                              <span className="text-xs">{workshop.bot_enabled ? 'On' : 'Off'}</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => openBotSettings(workshop)}
                            >
                              <Settings className="w-3 h-3" />
                            </Button>
                          </div>
                        </td>
                        <td className="py-4">
                          <div className="flex items-center gap-2">
                            <Users className="w-4 h-4 text-muted-foreground" />
                            <span>{userDisplay}</span>
                          </div>
                        </td>
                        <td className="py-4">
                          <div className="flex items-center gap-2">
                            <MessageSquare className="w-4 h-4 text-muted-foreground" />
                            <span>{convCount}</span>
                          </div>
                        </td>
                        <td className="py-4">
                          <StatusBadge status={workshop.is_active ? 'active' : 'disabled'} />
                        </td>
                        <td className="py-4">
                          {workshop.slug ? (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => copyBookingLink(workshop.slug!)}
                              >
                                <Copy className="w-3 h-3 mr-1" />
                                Copiar link
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => window.open(`/agenda/${workshop.slug}`, '_blank')}
                              >
                                <ExternalLink className="w-3 h-3" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Sin slug</span>
                          )}
                        </td>
                        <td className="py-4 text-sm text-muted-foreground">
                          {format(new Date(workshop.created_at), 'dd MMM yyyy', { locale: es })}
                        </td>
                        <td className="py-4">
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                              title="Ver como cliente"
                              onClick={() => handleImpersonate(workshop.id)}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openWorkshopDetails(workshop)}
                            >
                              <Settings className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => toggleActiveMutation.mutate({
                                workshopId: workshop.id,
                                isActive: !workshop.is_active
                              })}
                            >
                              <Power className={`w-4 h-4 ${workshop.is_active ? 'text-success' : 'text-destructive'}`} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteWorkshop(workshop)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Workshop Details Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        setIsDialogOpen(open);
        if (open && selectedWorkshop) {
          loadWorkshopUsers(selectedWorkshop.id);
        }
        if (!open) {
          setNewUserPassword('');
          setShowNewUserPassword(false);
        }
      }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedWorkshop?.name}</DialogTitle>
            <DialogDescription>
              Gestiona el plan y estado de este negocio
            </DialogDescription>
          </DialogHeader>

          {selectedWorkshop && (
            <div className="space-y-6">
              {/* Workshop Info */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">Información</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Ciudad:</span>
                    <p className="font-medium">{selectedWorkshop.city || 'No especificada'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Teléfono:</span>
                    <p className="font-medium">{selectedWorkshop.phone || 'No especificado'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Usuarios activos:</span>
                    <p className="font-medium">{profileCounts?.[selectedWorkshop.id] || 0}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Conversaciones:</span>
                    <p className="font-medium">{conversationCounts?.[selectedWorkshop.id] || 0}</p>
                  </div>
                </div>
              </div>

              {/* Change Plan */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground">Cambiar Plan</h4>
                <div className="flex items-center gap-3">
                  <Select
                    defaultValue={selectedSubscription?.plan_id}
                    onValueChange={(planId) => {
                      changePlanMutation.mutate({
                        workshopId: selectedWorkshop.id,
                        planId,
                      });
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Seleccionar plan" />
                    </SelectTrigger>
                    <SelectContent>
                      {plans?.map((plan) => (
                        <SelectItem key={plan.id} value={plan.id}>
                          <div className="flex items-center justify-between gap-4">
                            <span>{plan.name}</span>
                            <span className="text-muted-foreground text-sm">
                              {plan.max_users === null ? '∞ usuarios' : `${plan.max_users} usuarios`} •
                              ${plan.price_clp.toLocaleString('es-CL')} CLP
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  Plan actual: <strong>{selectedSubscription?.plans?.name || 'Sin plan'}</strong>
                </p>
              </div>

              {/* Toggle Status */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground">Estado del Negocio</h4>
                <div className="flex items-center gap-3">
                  <Button
                    variant={selectedWorkshop.is_active ? 'destructive' : 'default'}
                    onClick={() => {
                      toggleActiveMutation.mutate({
                        workshopId: selectedWorkshop.id,
                        isActive: !selectedWorkshop.is_active,
                      });
                      setSelectedWorkshop({
                        ...selectedWorkshop,
                        is_active: !selectedWorkshop.is_active,
                      });
                    }}
                    className="w-full"
                  >
                    <Power className="w-4 h-4 mr-2" />
                    {selectedWorkshop.is_active ? 'Bloquear Negocio' : 'Activar Negocio'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Los negocios bloqueados no podrán acceder al sistema.
                </p>
              </div>

              {/* Change User Password */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground">Cambiar Contraseña de Usuario</h4>
                {workshopUsers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay usuarios en esta empresa</p>
                ) : (
                  <>
                    <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Seleccionar usuario" />
                      </SelectTrigger>
                      <SelectContent>
                        {workshopUsers.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.full_name} ({user.email})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showNewUserPassword ? 'text' : 'password'}
                          placeholder="Nueva contraseña"
                          value={newUserPassword}
                          onChange={(e) => setNewUserPassword(e.target.value)}
                          className="pr-10"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full w-10"
                          onClick={() => setShowNewUserPassword(!showNewUserPassword)}
                        >
                          {showNewUserPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={generateUserPassword}
                        title="Generar contraseña"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                      {newUserPassword && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={copyUserPasswordToClipboard}
                          title="Copiar contraseña"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <Button
                      onClick={handleChangeUserPassword}
                      disabled={isChangingPassword || !newUserPassword}
                      className="w-full"
                    >
                      {isChangingPassword ? 'Cambiando...' : 'Cambiar Contraseña'}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Workshop Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Crear Nueva Empresa</DialogTitle>
            <DialogDescription>
              Completa los datos para crear una nueva empresa y enviar la invitación al administrador.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre de la Empresa *</Label>
              <Input
                id="name"
                placeholder="Mi Empresa"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Rubro / Categoría</Label>
              <Input
                id="category"
                placeholder="Ej: Clínica, Academia, Tienda..."
                value={createForm.category}
                onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">Ciudad</Label>
                <Input
                  id="city"
                  placeholder="Santiago"
                  value={createForm.city}
                  onChange={(e) => setCreateForm({ ...createForm, city: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Teléfono</Label>
                <Input
                  id="phone"
                  placeholder="+56 9 1234 5678"
                  value={createForm.phone}
                  onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Dirección</Label>
              <Input
                id="address"
                placeholder="Av. Principal 123"
                value={createForm.address}
                onChange={(e) => setCreateForm({ ...createForm, address: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo de Empresa *</Label>
              <Select
                value={createForm.booking_mode}
                onValueChange={(value: 'with_scheduling' | 'chatbot_only') =>
                  setCreateForm({ ...createForm, booking_mode: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="with_scheduling">
                    <div className="flex flex-col">
                      <span>📅 Con Agendamiento</span>
                      <span className="text-xs text-muted-foreground">Talleres, clínicas, spas - agendan citas</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="chatbot_only">
                    <div className="flex flex-col">
                      <span>💬 Solo Chatbot</span>
                      <span className="text-xs text-muted-foreground">Tiendas, soporte, ventas - sin agenda</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-3">
              <Label>Canal a Configurar</Label>
              <RadioGroup
                value={createForm.initial_channel}
                onValueChange={(value) => setCreateForm({
                  ...createForm,
                  initial_channel: value as 'whatsapp' | 'instagram' | 'web' | 'none'
                })}
                className="grid grid-cols-2 gap-2"
              >
                <div className={cn(
                  "flex items-center space-x-2 border rounded-lg p-3 cursor-pointer hover:bg-muted transition-colors",
                  createForm.initial_channel === 'web' && "border-primary bg-primary/5"
                )}>
                  <RadioGroupItem value="web" id="channel-web" />
                  <Label htmlFor="channel-web" className="flex items-center gap-2 cursor-pointer flex-1">
                    <Globe className="h-4 w-4 text-emerald-500" />
                    Web Chat
                  </Label>
                </div>
                <div className={cn(
                  "flex items-center space-x-2 border rounded-lg p-3 cursor-pointer hover:bg-muted transition-colors",
                  createForm.initial_channel === 'instagram' && "border-primary bg-primary/5"
                )}>
                  <RadioGroupItem value="instagram" id="channel-instagram" />
                  <Label htmlFor="channel-instagram" className="flex items-center gap-2 cursor-pointer flex-1">
                    <Instagram className="h-4 w-4 text-pink-500" />
                    Instagram
                  </Label>
                </div>
                <div className={cn(
                  "flex items-center space-x-2 border rounded-lg p-3 cursor-pointer hover:bg-muted transition-colors",
                  createForm.initial_channel === 'whatsapp' && "border-primary bg-primary/5"
                )}>
                  <RadioGroupItem value="whatsapp" id="channel-whatsapp" />
                  <Label htmlFor="channel-whatsapp" className="flex items-center gap-2 cursor-pointer flex-1">
                    <MessageSquare className="h-4 w-4 text-green-500" />
                    WhatsApp
                  </Label>
                </div>
                <div className={cn(
                  "flex items-center space-x-2 border rounded-lg p-3 cursor-pointer hover:bg-muted transition-colors",
                  createForm.initial_channel === 'none' && "border-primary bg-primary/5"
                )}>
                  <RadioGroupItem value="none" id="channel-none" />
                  <Label htmlFor="channel-none" className="flex items-center gap-2 cursor-pointer flex-1 text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    Después
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* WhatsApp Provider - Only show when WhatsApp is selected */}
            {createForm.initial_channel === 'whatsapp' && (
              <div className="space-y-2">
                <Label>Proveedor WhatsApp</Label>
                <Select
                  value={createForm.whatsapp_provider}
                  onValueChange={(value: 'meta' | 'twilio') =>
                    setCreateForm({ ...createForm, whatsapp_provider: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="twilio">
                      <div className="flex flex-col">
                        <span>📱 Twilio</span>
                        <span className="text-xs text-muted-foreground">Recomendado para nuevos negocios</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="meta">
                      <div className="flex flex-col">
                        <span>📘 Meta Cloud API</span>
                        <span className="text-xs text-muted-foreground">Configuración manual avanzada</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="plan">Plan *</Label>
              <Select
                value={createForm.plan_id}
                onValueChange={(value) => setCreateForm({ ...createForm, plan_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar plan" />
                </SelectTrigger>
                <SelectContent>
                  {plans?.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name} • {plan.max_users === null ? '∞' : plan.max_users} usuarios
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin_name">Nombre del Administrador *</Label>
              <Input
                id="admin_name"
                placeholder="Juan Pérez"
                value={createForm.admin_name}
                onChange={(e) => setCreateForm({ ...createForm, admin_name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin_email">Email del Administrador *</Label>
              <Input
                id="admin_email"
                type="email"
                placeholder="admin@ejemplo.com"
                value={createForm.admin_email}
                onChange={(e) => setCreateForm({ ...createForm, admin_email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin_password">Contraseña *</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="admin_password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Mínimo 6 caracteres"
                    value={createForm.admin_password}
                    onChange={(e) => setCreateForm({ ...createForm, admin_password: e.target.value })}
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full w-10"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleGeneratePassword}
                  title="Generar contraseña"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
                {createForm.admin_password && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={copyPasswordToClipboard}
                    title="Copiar contraseña"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Usa el botón de generar para crear una contraseña segura automáticamente.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateWorkshop} disabled={isCreating}>
              {isCreating ? 'Creando...' : 'Crear Empresa'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WhatsApp Config Dialog */}
      <WhatsAppConfigDialog
        workshop={whatsAppWorkshop}
        open={isWhatsAppDialogOpen}
        onOpenChange={setIsWhatsAppDialogOpen}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteWorkshop} onOpenChange={(open) => !open && setDeleteWorkshop(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar empresa?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará permanentemente <strong>{deleteWorkshop?.name}</strong> y todos sus datos asociados:
              <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
                <li>Usuarios y perfiles</li>
                <li>Conversaciones y mensajes</li>
                <li>Citas y eventos del calendario</li>
                <li>Contactos y solicitudes de servicio</li>
                <li>Configuraciones del bot</li>
              </ul>
              <p className="mt-3 font-medium text-destructive">Esta acción no se puede deshacer.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteWorkshop}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Eliminando...' : 'Eliminar empresa'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bot Settings Editor */}
      {botSettingsWorkshop && (
        <BotSettingsEditor
          workshopId={botSettingsWorkshop.id}
          workshopName={botSettingsWorkshop.name}
          open={isBotSettingsOpen}
          onOpenChange={setIsBotSettingsOpen}
        />
      )}

      {/* Twilio Config Dialog */}
      <TwilioConfigDialog
        workshop={twilioWorkshop}
        open={isTwilioDialogOpen}
        onOpenChange={setIsTwilioDialogOpen}
      />

      {/* Instagram Config Dialog */}
      <InstagramConfigDialog
        workshop={instagramWorkshop}
        open={isInstagramDialogOpen}
        onOpenChange={setIsInstagramDialogOpen}
      />

      {/* Web Chat Config Dialog */}
      <WebChatConfigDialog
        workshop={webChatWorkshop}
        open={isWebChatDialogOpen}
        onOpenChange={setIsWebChatDialogOpen}
      />
    </div>
  );
}
