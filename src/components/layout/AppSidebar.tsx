import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, MessageSquare, Users, Calendar, UserCog, Building2, LogOut, ChevronLeft, ChevronRight, BarChart3, BarChart2, Settings, Bot, DollarSign, Globe, Activity, Mail, UserPlus, ScrollText, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useSeatInfo, useSubscription, useWorkshop } from '@/hooks/useWorkshopData';
import { useWorkshopMode } from '@/hooks/useWorkshopMode';
import { Button } from '@/components/ui/button';
import { useEffect, useMemo, useState } from 'react';
import { UserSettingsDialog } from './UserSettingsDialog';
const superadminNavItems = [{
  to: '/admin/workshops',
  icon: Building2,
  label: 'Empresas'
}, {
  to: '/admin/cobranzas',
  icon: DollarSign,
  label: 'Cobranzas'
}, {
  to: '/admin/leads',
  icon: UserPlus,
  label: 'Leads'
}, {
  to: '/admin/web-chat-logs',
  icon: ScrollText,
  label: 'Web Chat Logs'
}, {
  to: '/admin/health',
  icon: Activity,
  label: 'Health Check'
}, {
  to: '/admin/stats',
  icon: BarChart3,
  label: 'Estadísticas'
}, {
  to: '/admin/settings',
  icon: Settings,
  label: 'Configuración'
}];
export const AppSidebar = () => {
  const {
    profile,
    signOut,
    impersonatedWorkshopId
  } = useAuth();
  const {
    data: seatInfo
  } = useSeatInfo();
  const {
    data: subscription
  } = useSubscription();
  const {
    data: workshopMode
  } = useWorkshopMode();
  const {
    data: workshop
  } = useWorkshop();
  const workshopName = workshopMode?.name || workshop?.name || null;
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isSuperAdmin = profile?.role === 'SUPERADMIN';
  const isImpersonating = !!impersonatedWorkshopId;
  const showLandingButton = (!isSuperAdmin || isImpersonating) && profile?.role === 'ADMIN' && workshopMode?.booking_mode === 'with_scheduling';

  // Dynamic nav items based on booking mode
  const navItems = useMemo(() => {
    if (isSuperAdmin && !isImpersonating) return superadminNavItems;
    const isAdmin = profile?.role === 'ADMIN';
    const baseItems = [{
      to: '/dashboard',
      icon: LayoutDashboard,
      label: 'Dashboard'
    }, {
      to: '/inbox',
      icon: MessageSquare,
      label: 'Inbox'
    }, {
      to: '/clients',
      icon: Users,
      label: 'Clientes'
    }];

    // Add Agenda only for with_scheduling mode (chatbot_only has no calendar)
    if (workshopMode?.booking_mode === 'with_scheduling') {
      baseItems.push({
        to: '/calendar',
        icon: Calendar,
        label: 'Agenda'
      });
    }

    // Everything below is ADMIN-only
    if (!isAdmin) return baseItems;

    baseItems.push({
      to: '/sales-control',
      icon: BarChart2,
      label: 'Control de Ventas'
    });

    baseItems.push({
      to: '/team',
      icon: UserCog,
      label: 'Equipo'
    }, {
      to: '/bot',
      icon: Bot,
      label: 'Configurar Bot'
    });

    // Only show Recordatorios for workshops with scheduling
    if (workshopMode?.booking_mode === 'with_scheduling') {
      baseItems.push({
        to: '/automations',
        icon: Mail,
        label: 'Recordatorios'
      });
    }

    baseItems.push({
      to: '/email-settings',
      icon: Mail,
      label: 'Correo'
    });
    return baseItems;
  }, [isSuperAdmin, workshopMode?.booking_mode, impersonatedWorkshopId, profile?.role]);
  const seatDisplay = seatInfo?.isUnlimited ? `${seatInfo.usedSeats} / ∞` : `${seatInfo?.usedSeats || 0} / ${seatInfo?.maxSeats || 0}`;
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const update = (event: MediaQueryList | MediaQueryListEvent) => {
      const matches = 'matches' in event ? event.matches : media.matches;
      setIsMobile(matches);
      if (matches) {
        setCollapsed(true);
        setMobileOpen(false);
      }
    };
    update(media);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const toggle = () => setMobileOpen((prev) => !prev);
    window.addEventListener('autonomia:sidebar-toggle', toggle);
    return () => window.removeEventListener('autonomia:sidebar-toggle', toggle);
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    setCollapsed(!mobileOpen);
  }, [isMobile, mobileOpen]);

  return (
    <>
      {isMobile && mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 bg-black/40 z-30"
          onClick={() => setMobileOpen(false)}
          aria-label="Cerrar menú"
        />
      )}
      <aside
        className={cn(
          'sidebar-gradient h-screen h-[100dvh] flex flex-col transition-all duration-300 shadow-xl overflow-hidden',
          collapsed ? 'w-16' : 'w-64',
          isMobile && 'fixed inset-y-0 left-0 z-40 w-72',
          isMobile && !mobileOpen && '-translate-x-full',
          isMobile && mobileOpen && 'translate-x-0'
        )}
      >
        {/* Logo */}
        <div className="pl-1 pr-3 py-3 border-b border-white/10">
          <div className={cn("flex flex-col w-full", collapsed ? "items-center" : "items-start")}>
            <div className={cn("flex", collapsed ? "items-center justify-center w-10 h-10" : "items-center justify-start w-36 h-18 ml-1")}>
              <img
                src={collapsed ? "/logo-collapsed.png" : "/logo.png"}
                alt="AutonomIA Suite"
                className={cn("object-contain", collapsed ? "w-10 h-10" : "w-36 h-18")}
              />
            </div>
            {!collapsed && (
              <p className="text-xs text-emerald-100/70 -mt-5 text-left pl-5">
                {subscription?.plans?.name || 'Starter'}
              </p>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto scrollbar-thin">
          {navItems.map(item => <NavLink key={item.to} to={item.to} onClick={() => isMobile && setMobileOpen(false)} className={({
            isActive
          }) => cn('flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group', 'text-white/70 hover:text-white', 'hover:bg-white/10', isActive && 'bg-white/15 text-white font-medium shadow-sm', collapsed && 'justify-center')}>
            <item.icon className={cn("w-5 h-5 flex-shrink-0 transition-transform duration-200", "group-hover:scale-110")} />
            {!collapsed && <span className="animate-fade-in">{item.label}</span>}
          </NavLink>)}

          {/* Landing Wizard Button */}
          {showLandingButton && <div className="mt-4 pt-4 border-t border-white/10">
            <Button variant="outline" onClick={() => navigate('/landing-wizard')} className={cn('w-full gap-2 bg-emerald-400/15 border-emerald-300/30 text-emerald-100 hover:bg-emerald-400/25 hover:text-white hover:border-emerald-300/50', collapsed && 'px-2')}>
              <Globe className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Configurar Landing</span>}
            </Button>
          </div>}
        </nav>

        {/* Seat Info */}
        {(!isSuperAdmin || isImpersonating) && !collapsed && seatInfo && <div className="px-4 py-3 border-t border-white/10">
          <div className="text-xs text-emerald-100/60 mb-2">Asientos usados</div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-emerald-400 to-teal-500 rounded-full transition-all duration-300" style={{
                width: seatInfo.isUnlimited ? '30%' : `${Math.min(seatInfo.usedSeats / (seatInfo.maxSeats || 1) * 100, 100)}%`
              }} />
            </div>
            <span className="text-sm font-medium text-white">
              {seatDisplay}
            </span>
          </div>
        </div>}

        {/* User & Logout */}
        <div className="p-3 border-t border-white/10">
          {!collapsed && profile && <button onClick={() => setSettingsOpen(true)} className="w-full px-3 py-2.5 mb-2 rounded-lg text-left hover:bg-white/10 transition-all duration-200 cursor-pointer group">
            <div className="text-sm font-medium text-white truncate group-hover:text-emerald-100 transition-colors">
              {profile.full_name}
            </div>
            <div className="text-xs text-emerald-100/60 truncate flex items-center gap-1">
              {profile.role}
              <Settings className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            {workshopName && (
              <div className="text-xs text-emerald-200/80 truncate mt-1">
                📍 {workshopName}
              </div>
            )}
            {profile.zone && (
              <div className="mt-1.5">
                <span className={cn(
                  "inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full",
                  profile.zone === 'santiago' && 'bg-blue-500/20 text-blue-200 border border-blue-400/30',
                  profile.zone === 'talca' && 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/30',
                  profile.zone === 'puerto_montt' && 'bg-violet-500/20 text-violet-200 border border-violet-400/30',
                )}>
                  {profile.zone === 'santiago' && 'Santiago'}
                  {profile.zone === 'talca' && 'Talca'}
                  {profile.zone === 'puerto_montt' && 'Puerto Montt'}
                </span>
              </div>
            )}
          </button>}

          <UserSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => (isMobile ? setMobileOpen(false) : setCollapsed(!collapsed))}
              className="text-emerald-100/70 hover:text-white hover:bg-white/10"
            >
              {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </Button>

            <Button variant="ghost" size={collapsed ? 'icon' : 'default'} onClick={signOut} className={cn('text-emerald-100/70 hover:text-white hover:bg-white/10', !collapsed && 'flex-1 justify-start')}>
              <LogOut className="w-4 h-4" />
              {!collapsed && <span className="ml-2">Cerrar sesión</span>}
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
};
