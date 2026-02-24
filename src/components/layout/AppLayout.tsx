import { useNavigate, Outlet } from 'react-router-dom';
import { AppSidebar } from './AppSidebar';
import { Button } from '@/components/ui/button';
import { Menu, LayoutDashboard } from 'lucide-react';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { NotificationToast } from '@/components/notifications/NotificationToast';
import { TutorialButton, AdminTutorial } from '@/components/tutorial';
import { LeadNotificationListener } from '@/components/admin/LeadNotificationListener';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkshop } from '@/hooks/useWorkshopData';
import { SuperAdminHealthSummary } from '@/components/admin/SuperAdminHealthSummary';

export const AppLayout = () => {
  const { user, profile, impersonatedWorkshopId, setImpersonatedWorkshopId } = useAuth();
  const { data: workshop } = useWorkshop();
  const navigate = useNavigate();
  const isSuperAdmin = profile?.role === 'SUPERADMIN';
  const isImpersonating = !!impersonatedWorkshopId;

  const handleStopImpersonation = () => {
    setImpersonatedWorkshopId(null);
    navigate('/admin/workshops');
  };

  return (
    <div className="flex h-screen h-[100dvh] bg-background overflow-hidden relative">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Impersonation Banner */}
        {isImpersonating && (
          <div className="bg-indigo-600 text-white px-4 py-1.5 flex items-center justify-between text-sm animate-in slide-in-from-top duration-300">
            <div className="flex items-center gap-2">
              <span className="font-medium">Modo Impersonación:</span>
              <span>Viendo como <strong>{workshop?.name}</strong></span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 text-xs bg-white text-indigo-600 hover:bg-indigo-50"
              onClick={handleStopImpersonation}
            >
              Detener y volver al panel
            </Button>
          </div>
        )}

        {/* Top bar with notifications */}
        {user && (
          <header className="h-14 border-b border-border/60 flex items-center justify-between px-4 bg-background/70 backdrop-blur-md shrink-0 gap-2 sticky top-0 z-10">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={() => window.dispatchEvent(new Event('autonomia:sidebar-toggle'))}
              >
                <Menu className="w-5 h-5" />
              </Button>
              {isImpersonating && (
                <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-indigo-50 border border-indigo-100 rounded-full text-indigo-700 text-xs font-medium">
                  <LayoutDashboard className="w-3 h-3" />
                  Viendo Panel de Cliente
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isSuperAdmin && !isImpersonating && <SuperAdminHealthSummary />}
              {(!isSuperAdmin || isImpersonating) && <TutorialButton />}
              <NotificationBell />
            </div>
          </header>
        )}
        <main className="flex-1 overflow-auto min-h-0">
          <Outlet />
        </main>
      </div>
      {/* Real-time notification toast listener */}
      {user && <NotificationToast />}
      {/* Lead notifications for superadmin only when NOT impersonating */}
      {user && isSuperAdmin && !isImpersonating && <LeadNotificationListener />}
      {/* Tutorial for non-superadmin users or during impersonation */}
      {user && (!isSuperAdmin || isImpersonating) && <AdminTutorial />}
    </div>
  );
};
