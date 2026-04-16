import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import AuthPage from "@/pages/AuthPage";
import DashboardPage from "@/pages/DashboardPage";
import InboxPage from "@/pages/InboxPage";
import ClientsPage from "@/pages/ClientsPage";
import CalendarPage from "@/pages/CalendarPage";
import TeamPage from "@/pages/TeamPage";
import RequestsPage from "@/pages/RequestsPage";
import BotSettingsPage from "@/pages/BotSettingsPage";
import AutomationsPage from "@/pages/AutomationsPage";
import AcceptInvitePage from "@/pages/AcceptInvitePage";
import AdminWorkshopsPage from "@/pages/admin/WorkshopsPage";
import AdminStatsPage from "@/pages/admin/StatsPage";
import CobranzasPage from "@/pages/admin/CobranzasPage";
import HealthCheckPage from "@/pages/admin/HealthCheckPage";
import LeadsPage from "@/pages/admin/LeadsPage";
import WebChatLogsPage from "@/pages/admin/WebChatLogsPage";
import BookingPage from "@/pages/BookingPage";
import CancelAppointmentPage from "@/pages/CancelAppointmentPage";
import LandingWizardPage from "@/pages/LandingWizardPage";
import EmailSettingsPage from "@/pages/EmailSettingsPage";
import SalesControlPage from "@/pages/SalesControlPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import UpdatePasswordPage from "@/pages/UpdatePasswordPage";
import NotFound from "@/pages/NotFound";
const queryClient = new QueryClient();

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center">Cargando...</div>;
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
};

const SuperAdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, profile, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center">Cargando...</div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (profile?.role !== 'SUPERADMIN') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
};

const AdminOnlyRoute = ({ children }: { children: React.ReactNode }) => {
  const { profile, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center">Cargando...</div>;
  if (profile?.role !== 'ADMIN' && profile?.role !== 'SUPERADMIN') {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
};

const AppRoutes = () => {
  const { user, profile, loading } = useAuth();
  
  if (loading) return <div className="flex h-screen items-center justify-center">Cargando...</div>;

  const defaultRoute = profile?.role === 'SUPERADMIN' ? '/admin/workshops' : '/dashboard';

  return (
    <Routes>
      {/* Public booking route - dynamic by slug */}
      <Route path="/agenda/:slug" element={<BookingPage />} />
      {/* Public cancel appointment route - direct from email */}
      <Route path="/cita/:appointmentId/:token" element={<CancelAppointmentPage />} />
      <Route path="/auth" element={user ? <Navigate to={defaultRoute} replace /> : <AuthPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/update-password" element={<UpdatePasswordPage />} />
      <Route path="/invite/:token" element={<AcceptInvitePage />} />
      <Route path="/" element={<Navigate to={user ? defaultRoute : "/auth"} replace />} />
      {/* Landing Wizard - Full screen, outside AppLayout - ADMIN only */}
      <Route path="/landing-wizard" element={<ProtectedRoute><AdminOnlyRoute><LandingWizardPage /></AdminOnlyRoute></ProtectedRoute>} />
      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/requests" element={<RequestsPage />} />
        {/* ADMIN-only routes */}
        <Route path="/team" element={<AdminOnlyRoute><TeamPage /></AdminOnlyRoute>} />
        <Route path="/bot" element={<AdminOnlyRoute><BotSettingsPage /></AdminOnlyRoute>} />
        <Route path="/automations" element={<AdminOnlyRoute><AutomationsPage /></AdminOnlyRoute>} />
        <Route path="/email-settings" element={<AdminOnlyRoute><EmailSettingsPage /></AdminOnlyRoute>} />
        <Route path="/sales-control" element={<AdminOnlyRoute><SalesControlPage /></AdminOnlyRoute>} />
        {/* Admin Routes */}
        <Route path="/admin/workshops" element={<SuperAdminRoute><AdminWorkshopsPage /></SuperAdminRoute>} />
        <Route path="/admin/cobranzas" element={<SuperAdminRoute><CobranzasPage /></SuperAdminRoute>} />
        <Route path="/admin/stats" element={<SuperAdminRoute><AdminStatsPage /></SuperAdminRoute>} />
        <Route path="/admin/health" element={<SuperAdminRoute><HealthCheckPage /></SuperAdminRoute>} />
        <Route path="/admin/leads" element={<SuperAdminRoute><LeadsPage /></SuperAdminRoute>} />
        <Route path="/admin/web-chat-logs" element={<SuperAdminRoute><WebChatLogsPage /></SuperAdminRoute>} />
        <Route path="/admin/settings" element={<SuperAdminRoute><div className="p-6"><h1 className="text-2xl font-bold">Configuración</h1><p className="text-muted-foreground">Próximamente...</p></div></SuperAdminRoute>} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
