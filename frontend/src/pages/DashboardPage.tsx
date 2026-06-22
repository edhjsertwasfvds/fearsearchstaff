import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Users, Shield, Activity, BarChart3, TrendingUp, Clock, Award, Zap, Globe } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '../hooks/useAuth';
import { api } from '../services/api';
import type { StaffMember, DashboardStats } from '../types';

const roleColors: Record<string, string> = {
  OWNER: 'from-red-500 to-red-600',
  GLADMIN: 'from-orange-500 to-orange-600',
  STADMIN: 'from-yellow-500 to-yellow-600',
  ADMIN: 'from-amber-500 to-amber-600',
  ADMIN_PLUS: 'from-amber-500 to-amber-600',
  STMODER: 'from-emerald-500 to-emerald-600',
  MODER: 'from-blue-500 to-blue-600',
  MLMODER: 'from-cyan-500 to-cyan-600',
  CURATOR: 'from-purple-500 to-purple-600',
};

const roleBadgeColors: Record<string, string> = {
  OWNER: 'bg-red-500/20 text-red-400 border-red-500/30',
  GLADMIN: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  STADMIN: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  ADMIN: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  ADMIN_PLUS: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  STMODER: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  MODER: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  MLMODER: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  CURATOR: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

const roleNames: Record<string, string> = {
  OWNER: 'Владелец',
  GLADMIN: 'Гл. Администратор',
  STADMIN: 'Ст. Администратор',
  ADMIN: 'Администратор',
  ADMIN_PLUS: 'Администратор+',
  STMODER: 'Ст. Модератор',
  MODER: 'Модератор',
  MLMODER: 'Мл. Модератор',
  CURATOR: 'Куратор',
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activityData, setActivityData] = useState<any[]>([]);
  const [activitySummary, setActivitySummary] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      api.getStaff().catch(() => ({ data: [] })),
      api.getDashboardStats().catch(() => ({ data: { total_staff: 0, staff_by_role: {} } })),
      api.getServerActivity(24).catch(() => ({ data: [] })),
      api.getServerActivitySummary().catch(() => null),
    ]).then(([staffRes, statsRes, activityRes, summaryRes]) => {
      setStaff(staffRes.data || []);
      setStats(statsRes.data);
      setActivityData(activityRes?.data || []);
      setActivitySummary(summaryRes);
      setLoading(false);
    });
  }, []);

  const chartData = activityData.map((d: any) => ({
    time: new Date(d.timestamp * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    players: d.total_players,
    admins: d.total_admins,
  }));

  const hourlyData = activitySummary?.hourly
    ? Object.entries(activitySummary.hourly).map(([h, v]) => ({
        hour: `${String(h).padStart(2, '0')}:00`,
        players: v,
      })).sort((a: any, b: any) => a.hour.localeCompare(b.hour))
    : [];

  const statCards = [
    { label: 'Total Staff', value: stats?.total_staff || 0, icon: Users, color: 'from-accent-blue to-accent-purple' },
    { label: 'Your Level', value: user?.level || 0, icon: Award, color: 'from-emerald-500 to-emerald-600' },
    { label: 'Permissions', value: user?.permissions?.length || 0, icon: Shield, color: 'from-amber-500 to-amber-600' },
    { label: 'Groups Active', value: Object.keys(stats?.staff_by_role || {}).length, icon: BarChart3, color: 'from-cyan-500 to-cyan-600' },
  ];

  const onlineCards = [
    { label: 'Online Now', value: activitySummary?.current || 0, icon: Globe, color: 'from-green-500 to-green-600' },
    { label: 'Max (24h)', value: activitySummary?.max_24h || 0, icon: TrendingUp, color: 'from-blue-500 to-blue-600' },
    { label: 'Avg (24h)', value: activitySummary?.avg_24h || 0, icon: Activity, color: 'from-purple-500 to-purple-600' },
    { label: 'Snapshots', value: activitySummary?.snapshots_24h || 0, icon: Clock, color: 'from-amber-500 to-amber-600' },
  ];

  const topStaff = staff.sort((a, b) => (b.level || 0) - (a.level || 0)).slice(0, 6);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-12 h-12 border-4 border-accent-blue/30 border-t-accent-blue rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <h1 className="text-3xl font-bold text-white mb-2">
          Welcome back, <span className="gradient-text">{user?.display_name || user?.username}</span>
        </h1>
        <p className="text-gray-400">
          {user?.staff_role && user.staff_role !== 'Пользователь' ? `${user.staff_role} - ${user.staff_group}` : 'Staff Panel Dashboard'}
        </p>
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card, i) => (
          <motion.div key={card.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.1 }} whileHover={{ y: -4 }}
            className="glass-card p-6"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-400 mb-1">{card.label}</p>
                <p className="text-3xl font-bold text-white">{card.value}</p>
              </div>
              <div className={`w-12 h-12 bg-gradient-to-br ${card.color} rounded-xl flex items-center justify-center shadow-lg`}>
                <card.icon className="w-6 h-6 text-white" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Online Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {onlineCards.map((card, i) => (
          <motion.div key={card.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 + i * 0.1 }} whileHover={{ y: -4 }}
            className="glass-card p-5"
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 bg-gradient-to-br ${card.color} rounded-xl flex items-center justify-center`}>
                <card.icon className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-xs text-gray-400">{card.label}</p>
                <p className="text-2xl font-bold text-white">{card.value}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Server Activity Chart */}
      {chartData.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }}
          className="glass-card p-6"
        >
          <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
            <Activity className="w-5 h-5 text-accent-blue" />
            Server Activity (24h)
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorPlayers" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4f7cff" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#4f7cff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2333" />
              <XAxis dataKey="time" stroke="#6b7280" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis stroke="#6b7280" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#1a1f2e', border: '1px solid #2d3548', borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="players" stroke="#4f7cff" fillOpacity={1} fill="url(#colorPlayers)" strokeWidth={2} />
              <Area type="monotone" dataKey="admins" stroke="#f59e0b" fillOpacity={0.1} fill="#f59e0b" strokeWidth={1} strokeDasharray="5 5" />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>
      )}

      {/* Hourly Average Chart */}
      {hourlyData.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.35 }}
          className="glass-card p-6"
        >
          <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
            <Clock className="w-5 h-5 text-accent-blue" />
            Average Players by Hour
          </h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={hourlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2333" />
              <XAxis dataKey="hour" stroke="#6b7280" tick={{ fontSize: 10 }} />
              <YAxis stroke="#6b7280" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#1a1f2e', border: '1px solid #2d3548', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="players" fill="#4f7cff" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      )}

      {/* Role Distribution */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.4 }}
        className="glass-card p-6"
      >
        <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-accent-blue" />
          Staff Distribution
        </h2>
        <div className="space-y-3">
          {Object.entries(stats?.staff_by_role || {})
            .sort(([, a], [, b]) => b - a)
            .map(([role, count], i) => {
              const maxCount = Math.max(...Object.values(stats?.staff_by_role || {}));
              const percentage = maxCount > 0 ? (count / maxCount) * 100 : 0;
              return (
                <motion.div key={role} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.5 + i * 0.05 }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full bg-gradient-to-r ${roleColors[role] || 'from-gray-500 to-gray-600'}`} />
                      <span className="text-sm text-gray-300">{roleNames[role] || role}</span>
                    </div>
                    <span className="text-sm font-semibold text-white">{count}</span>
                  </div>
                  <div className="h-2 bg-dark-800 rounded-full overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${percentage}%` }}
                      transition={{ duration: 0.8, delay: 0.6 + i * 0.1 }}
                      className={`h-full bg-gradient-to-r ${roleColors[role] || 'from-gray-500 to-gray-600'} rounded-full`}
                    />
                  </div>
                </motion.div>
              );
            })}
        </div>
      </motion.div>

      {/* Top Staff */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.5 }}
        className="glass-card p-6"
      >
        <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-accent-blue" />
          Top Staff Members
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {topStaff.map((member, i) => (
            <motion.div key={member.steam_id} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, delay: 0.6 + i * 0.1 }} whileHover={{ scale: 1.02 }}
              className="glass-card-hover p-4"
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className={`w-12 h-12 bg-gradient-to-br ${roleColors[member.group_name] || 'from-gray-500 to-gray-600'} rounded-xl flex items-center justify-center shadow-lg`}>
                    <span className="text-white font-bold text-lg">{member.name?.charAt(0)?.toUpperCase() || '?'}</span>
                  </div>
                  {i < 3 && (
                    <div className={`absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                      i === 0 ? 'bg-yellow-500' : i === 1 ? 'bg-gray-400' : 'bg-amber-600'
                    }`}>{i + 1}</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white truncate">{member.name}</p>
                  <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border ${roleBadgeColors[member.group_name] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
                    {member.role}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-white">LVL {member.level}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
