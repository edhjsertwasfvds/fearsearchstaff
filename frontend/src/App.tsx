import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import PlayersPage from './pages/PlayersPage';
import PunishmentsPage from './pages/PunishmentsPage';
import CheckerPage from './pages/CheckerPage';
import WhitelistPage from './pages/WhitelistPage';
import SettingsPage from './pages/SettingsPage';
import AdminPanelPage from './pages/AdminPanelPage';
import AuthCallback from './pages/AuthCallback';
import BansAndMutesPage from './pages/BansAndMutesPage';
import StatsPage from './pages/StatsPage';
import LeaderboardPage from './pages/LeaderboardPage';
import EvadersPage from './pages/EvadersPage';
import VDFHistoryPage from './pages/VDFHistoryPage';

function ProtectedRoute({ children, minLevel = 1 }: { children: React.ReactNode; minLevel?: number }) {
  const { user, loading, hasLevel } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#080a10] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (!hasLevel(minLevel)) {
    return (
      <div className="min-h-screen bg-[#080a10] flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <span className="text-3xl">🚫</span>
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Доступ запрещён</h1>
          <p className="text-sm text-gray-500 mb-6">
            Ваш уровень доступа ({user.level}) недостаточен для просмотра этой страницы.
            Требуется минимум LVL {minLevel}.
          </p>
          <button
            onClick={() => {
              localStorage.removeItem('token');
              window.location.href = '/';
            }}
            className="px-6 py-2.5 bg-[#1a1f2e] hover:bg-[#222840] border border-white/10 text-gray-300 rounded-xl text-sm font-medium transition-all"
          >
            Выйти
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#080a10] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Загрузка...</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/" element={user ? <Navigate to="/players" replace /> : <LoginPage />} />
      <Route
        path="/players"
        element={
          <ProtectedRoute>
            <Layout>
              <PlayersPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/punishments"
        element={
          <ProtectedRoute>
            <Layout>
              <PunishmentsPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/checker"
        element={
          <ProtectedRoute>
            <Layout>
              <CheckerPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/leaderboard"
        element={
          <ProtectedRoute>
            <Layout>
              <LeaderboardPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/bans-mutes"
        element={
          <ProtectedRoute>
            <Layout>
              <BansAndMutesPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/staff-stats"
        element={
          <ProtectedRoute>
            <Layout>
              <StatsPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/evaders"
        element={
          <ProtectedRoute>
            <Layout>
              <EvadersPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/vdf-history"
        element={
          <ProtectedRoute>
            <Layout>
              <VDFHistoryPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/whitelist"
        element={
          <ProtectedRoute minLevel={2}>
            <Layout>
              <WhitelistPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <Layout>
              <SettingsPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute minLevel={5}>
            <Layout>
              <AdminPanelPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
