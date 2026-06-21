import { ReactNode, useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Search, Shield, Settings, LogOut, AlertTriangle,
  ChevronRight, Menu, X, Crown, Ban, BarChart3, ShieldCheck, FileText
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../services/api';
const ghostLogo = '/ghost-logo.webp';

const navSections = [
  {
    title: 'ОСНОВНОЕ',
    items: [
      { path: '/players', label: 'Игроки', icon: Users, minLevel: 1 },
      { path: '/punishments', label: 'Наказания', icon: AlertTriangle, minLevel: 1 },
      { path: '/checker', label: 'Проверка', icon: Search, minLevel: 1 },
    ],
  },
  {
    title: 'МОНИТОРИНГ',
    items: [
      { path: '/leaderboard', label: 'Топ-1000', icon: BarChart3, minLevel: 1 },
      { path: '/bans-mutes', label: 'Баны и муты', icon: Ban, minLevel: 1 },
      { path: '/staff-stats', label: 'Статистика', icon: BarChart3, minLevel: 1 },
      { path: '/vdf-history', label: 'История VDF', icon: FileText, minLevel: 1 },
    ],
  },
  {
    title: 'УПРАВЛЕНИЕ',
    items: [
      { path: '/whitelist', label: 'Белый список', icon: ShieldCheck, minLevel: 2 },
    ],
  },
  {
    title: 'АДМИН-ПАНЕЛЬ',
    items: [
      { path: '/admin', label: 'Пользователи', icon: Crown, minLevel: 5 },
      { path: '/evaders', label: 'Обходники', icon: AlertTriangle, minLevel: 1 },
    ],
  },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout, hasLevel } = useAuth();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [serverStats, setServerStats] = useState({ admins: 0, players: 0 });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [serversRes, staffRes] = await Promise.allSettled([
          api.getServers(),
          api.getStaff(),
        ]);
        let totalPlayers = 0;
        if (serversRes.status === 'fulfilled') {
          const servers = Array.isArray(serversRes.value) ? serversRes.value : (serversRes.value?.data || serversRes.value?.servers || []);
          for (const s of servers) {
            totalPlayers += s.players_online || s.live_data?.players?.length || 0;
          }
        }
        let totalAdmins = 0;
        if (staffRes.status === 'fulfilled') {
          const staffData = staffRes.value;
          const staffList = Array.isArray(staffData?.data) ? staffData.data : (Array.isArray(staffData) ? staffData : []);
          totalAdmins = staffList.length;
        }
        setServerStats({ admins: totalAdmins, players: totalPlayers });
      } catch {
        setServerStats({ admins: 0, players: 0 });
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const getRoleLabel = (group: string) => {
    const labels: Record<string, string> = {
      OWNER: 'Владелец',
      OWNER_ALT: 'Владелец (Alt)',
      CURATOR: 'Куратор',
      GLADMIN: 'Гл. Администратор',
      STADMIN: 'Ст. Администратор',
      MODER: 'Модератор',
      STMODER: 'Ст. Модератор',
      MLMODER: 'Мл. Модератор',
      DOSTUP: 'Доступ',
      ADMIN: 'Администратор',
      ADMIN_PLUS: 'Администратор+',
      CHECKER: 'Чекер',
    };
    return labels[group] || 'Пользователь';
  };

  const getLevelColor = (level: number) => {
    if (level >= 5) return 'text-yellow-400/80 bg-yellow-400/5 border-yellow-400/10';
    if (level >= 4) return 'text-orange-400/80 bg-orange-400/5 border-orange-400/10';
    if (level >= 3) return 'text-blue-400/80 bg-blue-400/5 border-blue-400/10';
    if (level >= 2) return 'text-purple-400/80 bg-purple-400/5 border-purple-400/10';
    if (level >= 1) return 'text-emerald-400/80 bg-emerald-400/5 border-emerald-400/10';
    return 'text-red-400/80 bg-red-400/5 border-red-400/10';
  };

  return (
    <div className="min-h-screen bg-[#080a10] flex">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-[#0c0e14] border-b border-white/5 px-4 py-3 flex items-center justify-between">
        <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="text-gray-400 hover:text-white">
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
        <span className="text-sm font-bold text-white">FearSearch Staff</span>
        <div className="w-6" />
      </div>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="lg:hidden fixed inset-0 bg-black/60 z-40"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Left Sidebar */}
      <aside className={`w-[220px] flex-shrink-0 flex flex-col fixed h-full z-40 bg-[#0c0e14] border-r border-white/5 transition-transform lg:translate-x-0 ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Ghost Logo + Server Stats */}
        <div className="p-4">
          <div className="flex items-center gap-3 mb-4">
            <img src={ghostLogo} alt="FearSearch" className="w-10 h-10 rounded-xl" />
            <div>
              <p className="text-sm font-bold text-white">FearSearch</p>
              <p className="text-[10px] text-gray-500">Staff Panel</p>
            </div>
          </div>

          {/* Server Stats */}
          <div className="bg-[#12151e] rounded-xl p-3 border border-white/5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500">Админов</span>
              <span className="text-xs font-bold text-emerald-400">{serverStats.admins}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500">Игроков</span>
              <span className="text-xs font-bold text-blue-400">{serverStats.players}</span>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 space-y-4 overflow-y-auto">
          {navSections.map((section) => {
            const visibleItems = section.items.filter(item => hasLevel(item.minLevel));
            if (visibleItems.length === 0) return null;
            return (
              <div key={section.title}>
                <p className="text-[10px] text-gray-600 uppercase tracking-wider px-3 mb-1.5">{section.title}</p>
                <div className="space-y-0.5">
                  {visibleItems.map((item) => {
                    const isActive = location.pathname === item.path;
                    return (
                      <Link key={item.path} to={item.path} onClick={() => setMobileMenuOpen(false)}>
                        <motion.div
                          whileTap={{ scale: 0.98 }}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                            isActive
                              ? 'bg-[#1a1f2e] text-white'
                              : 'text-gray-400 hover:text-white hover:bg-[#141822]'
                          }`}
                        >
                          <item.icon className="w-4 h-4" />
                          <span>{item.label}</span>
                          <ChevronRight className="w-3 h-3 ml-auto opacity-40" />
                        </motion.div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 lg:ml-[220px] lg:mr-[260px] min-h-screen pt-14 lg:pt-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="p-4 lg:p-8"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Right Sidebar */}
      <aside className="hidden lg:block w-[260px] flex-shrink-0 fixed right-0 h-full z-30 p-4 space-y-4 border-l border-white/5 overflow-y-auto">
        {/* User Card */}
        <div className="bg-[#12151e] rounded-xl p-4 border border-white/5">
          <div className="flex items-center gap-3 mb-3">
            {user?.avatar ? (
              <img
                src={`https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar}.png?size=64`}
                alt={user.username}
                className="w-12 h-12 rounded-full ring-2 ring-blue-500/30"
              />
            ) : (
              <div className="w-12 h-12 bg-[#1e2333] rounded-full flex items-center justify-center">
                <Users className="w-6 h-6 text-gray-500" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white truncate">
                {user?.display_name || user?.username || 'User'}
              </p>
              <p className="text-[11px] text-gray-500 truncate">
                {getRoleLabel(user?.staff_group || '')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getLevelColor(user?.level || 0)}`}>
              LVL {user?.level || 0}
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#1a1f2e] border border-white/5 text-gray-400">
              {getRoleLabel(user?.staff_group || '')}
            </span>
          </div>
          <button
            onClick={logout}
            className="w-full px-4 py-2 bg-[#1e2333] hover:bg-red-500/10 border border-white/5 hover:border-red-500/20 rounded-lg text-xs text-gray-400 hover:text-red-400 transition-all flex items-center justify-center gap-2"
          >
            <LogOut className="w-3 h-3" />
            Выйти
          </button>
        </div>

        {/* Control Panel */}
        <div className="bg-[#12151e] rounded-xl p-4 border border-white/5">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Панель управления
          </h3>
          <div className="space-y-1">
            <Link to="/settings">
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-[#1e2333] transition-all cursor-pointer">
                <Settings className="w-4 h-4" />
                <span>Настройки</span>
              </div>
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
}
