import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface LandingConfig {
  id: string;
  workshop_id: string;
  business_name: string | null;
  logo_url: string | null;
  primary_color: string;
  welcome_message: string | null;
  require_name: boolean;
  require_phone: boolean;
  require_email: boolean;
  require_reason: boolean;
  cancellation_policy: string | null;
  confirmation_message: string;
  default_schedule: Record<string, { enabled: boolean; start: string; end: string }>;
  lunch_break_start: string | null;
  lunch_break_end: string | null;
  buffer_minutes: number;
  is_published: boolean;
  published_at: string | null;
  wizard_completed: boolean;
  wizard_current_step: number;
}

export interface LandingService {
  id: string;
  workshop_id: string;
  name: string;
  duration_minutes: number;
  price: number | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface LandingTeamMember {
  id: string;
  workshop_id: string;
  profile_id: string | null;
  name: string;
  role: string | null;
  photo_url: string | null;
  show_on_landing: boolean;
  sort_order: number;
}

const TEMPLATES = {
  taller_mecanico: {
    services: [
      { name: 'Diagnóstico General', duration_minutes: 30, price: 25000, description: 'Revisión completa del vehículo' },
      { name: 'Mantención Preventiva', duration_minutes: 90, price: 89000, description: 'Cambio de aceite, filtros y revisión general' },
      { name: 'Cambio de Aceite', duration_minutes: 45, price: 35000, description: 'Incluye aceite y filtro' },
      { name: 'Revisión de Frenos', duration_minutes: 60, price: 45000, description: 'Inspección y ajuste del sistema de frenos' },
    ],
    team_roles: ['Mecánico Jefe', 'Técnico Automotriz', 'Asesor de Servicio'],
    welcome_message: '¡Bienvenido! Agenda tu hora de forma fácil y rápida.',
    confirmation_message: 'Tu cita ha sido confirmada. Te esperamos en nuestro taller. Recuerda llegar 10 minutos antes.',
  },
};

export function useLandingWizard() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const workshopId = profile?.workshop_id;

  // Fetch workshop slug
  const { data: workshopSlug } = useQuery({
    queryKey: ['workshop-slug', workshopId],
    queryFn: async () => {
      if (!workshopId) return null;

      const { data, error } = await supabase
        .from('workshops')
        .select('slug')
        .eq('id', workshopId)
        .single();

      if (error) throw error;
      return data?.slug || null;
    },
    enabled: !!workshopId,
  });

  // Fetch config
  const { data: config, isLoading: loadingConfig } = useQuery({
    queryKey: ['landing-config', workshopId],
    queryFn: async () => {
      if (!workshopId) return null;

      const { data, error } = await supabase
        .from('landing_config')
        .select('*')
        .eq('workshop_id', workshopId)
        .maybeSingle();

      if (error) throw error;
      return data as unknown as LandingConfig | null;
    },
    enabled: !!workshopId,
  });

  // Fetch services
  const { data: services = [], isLoading: loadingServices } = useQuery({
    queryKey: ['landing-services', workshopId],
    queryFn: async () => {
      if (!workshopId) return [];

      const { data, error } = await supabase
        .from('landing_services')
        .select('*')
        .eq('workshop_id', workshopId)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      return data as LandingService[];
    },
    enabled: !!workshopId,
  });

  // Fetch team
  const { data: team = [], isLoading: loadingTeam } = useQuery({
    queryKey: ['landing-team', workshopId],
    queryFn: async () => {
      if (!workshopId) return [];

      const { data, error } = await supabase
        .from('landing_team')
        .select('*')
        .eq('workshop_id', workshopId)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      return data as LandingTeamMember[];
    },
    enabled: !!workshopId,
  });

  // Update config mutation
  const updateConfig = useMutation({
    mutationFn: async (updates: Partial<LandingConfig>) => {
      if (!workshopId) throw new Error('No workshop');

      // Check if config exists
      const { data: existing } = await supabase
        .from('landing_config')
        .select('id')
        .eq('workshop_id', workshopId)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('landing_config')
          .update(updates)
          .eq('workshop_id', workshopId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('landing_config')
          .insert({ workshop_id: workshopId, ...updates });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['landing-config', workshopId] });
    },
  });

  // Service mutations
  const addService = useMutation({
    mutationFn: async (service: Omit<LandingService, 'id' | 'workshop_id'>) => {
      if (!workshopId) throw new Error('No workshop');

      const { error } = await supabase
        .from('landing_services')
        .insert({ workshop_id: workshopId, ...service });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['landing-services', workshopId] });
    },
  });

  const updateService = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<LandingService> & { id: string }) => {
      const { error } = await supabase
        .from('landing_services')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['landing-services', workshopId] });
    },
  });

  const deleteService = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('landing_services')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['landing-services', workshopId] });
    },
  });

  // Team mutations
  const addTeamMember = useMutation({
    mutationFn: async (member: Omit<LandingTeamMember, 'id' | 'workshop_id'>) => {
      if (!workshopId) throw new Error('No workshop');

      const { error } = await supabase
        .from('landing_team')
        .insert({ workshop_id: workshopId, ...member });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['landing-team', workshopId] });
    },
  });

  const updateTeamMember = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<LandingTeamMember> & { id: string }) => {
      const { error } = await supabase
        .from('landing_team')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['landing-team', workshopId] });
    },
  });

  const deleteTeamMember = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('landing_team')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['landing-team', workshopId] });
    },
  });

  // Apply template
  const applyTemplate = useCallback(async (templateKey: keyof typeof TEMPLATES) => {
    if (!workshopId) return;

    const template = TEMPLATES[templateKey];

    // Add services
    for (let i = 0; i < template.services.length; i++) {
      await addService.mutateAsync({ ...template.services[i], sort_order: i, is_active: true });
    }

    // Update config with template messages
    await updateConfig.mutateAsync({
      welcome_message: template.welcome_message,
      confirmation_message: template.confirmation_message,
    });

    toast({ title: 'Plantilla aplicada', description: 'Se han agregado los servicios y mensajes sugeridos' });
  }, [workshopId, addService, updateConfig, toast]);

  // Publish landing
  const publishLanding = useMutation({
    mutationFn: async () => {
      if (!workshopId) throw new Error('No workshop');
      if (!workshopSlug) throw new Error('No workshop slug');

      // Update landing config
      await updateConfig.mutateAsync({
        is_published: true,
        published_at: new Date().toISOString(),
        wizard_completed: true,
      });

      // Sync booking_url in workshops table for WhatsApp bot
      // Use current domain so URLs are always correct regardless of .env
      const bookingUrl = `${window.location.origin}/agenda/${workshopSlug}`;

      const { error: workshopError } = await supabase
        .from('workshops')
        .update({ booking_url: bookingUrl })
        .eq('id', workshopId);

      if (workshopError) throw workshopError;
    },
    onSuccess: () => {
      toast({ title: '¡Landing publicada!', description: 'Tu página de agendamiento ya está disponible' });
    },
  });

  // Checklist validation
  const checklist = {
    identity: !!(config?.business_name),
    services: services.length > 0,
    team: team.filter(t => t.show_on_landing).length > 0,
    availability: !!(config?.default_schedule),
  };

  const isReadyToPublish = Object.values(checklist).every(Boolean);

  return {
    config,
    services,
    team,
    loading: loadingConfig || loadingServices || loadingTeam,
    updateConfig,
    addService,
    updateService,
    deleteService,
    addTeamMember,
    updateTeamMember,
    deleteTeamMember,
    applyTemplate,
    publishLanding,
    checklist,
    isReadyToPublish,
    workshopId,
    workshopSlug,
  };
}
