import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, ShieldX, AlertTriangle, TrendingUp, Users, Scissors, ExternalLink } from 'lucide-react';
import { api } from '../services/api';

interface StaffStats {
  steamid: string;
  name?: string;
  avatar?: string;
  total_bans: number;
  total_mutes: number;
  active_bans: number;
  active_mutes: number;
  removed_bans: number;
  removed_mutes: number;
  expired_bans: number;
  expired_mutes: number;
  total: number;
  active_total: number;
  expired_total: number;
  removed_total: number;
}

interface AdminEntry {
  steamid: string;
  name?: string;
  nickname?: string;
  group_name?: string;
  group_display_name?: string;
  discord_id?: string;
  discord_nickname?: string;
}

export default function StatsPage() {
  const [stats, setStats] = useState<StaffStats[]>([]);
  const [admins, setAdmins] = useState<AdminEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchStats = useCallback(async () => {
    try {
      const adminsRes = await api.getAdmins();
      const adminList: AdminEntry[] = adminsRes?.admins || [];
      setAdmins(adminList);

      const steamIds = adminList.map(a => a.steamid).filter(Boolean);
      if (steamIds.length > 0) {
        const res = await api.getStaffStats(steamIds);
        const statsList: StaffStats[] = res.stats || [];

        for (const s of statsList) {
          if (!s.name || s.name === s.steamid) {
            const admin = adminList.find(a => a.steamid === s.steamid);
            if (admin) {
              s.name = admin.name || admin.nickname || s.steamid;
            }
          }
        }
        setStats(statsList);
      }
      setLastRefresh(new Date());
    } catch {
      setStats([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const sorted = [...stats].sort((a, b) => (b.total || 0) - (a.total || 0));

  const totalStats = stats.reduce(
    (acc, s) => ({
      bans: acc.bans + (s.total_bans || 0),
      mutes: acc.mutes + (s.total_mutes || 0),
      active: acc.active + (s.active_total || 0),
      removed: acc.removed + (s.removed_total || 0),
      expired: acc.expired + (s.expired_total || 0),
    }),
    { bans: 0, mutes: 0, active: 0, removed: 0, expired: 0 }
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Статистика</h1>
          <p className="text-sm text-[#8a8a93] mt-1">
            Статистика стаффа ({admins.length} сотр.) • Обновлено: {lastRefresh.toLocaleTimeString('ru-RU')}
          </p>
        </div>
        <button onClick={() => { setLoading(true); fetchStats(); }}
          className="flex items-center gap-2 px-4 py-2 bg-[#141822] border border-white/5 rounded-lg text-sm text-gray-400 hover:text-white hover:border-blue-500/30 transition-all">
          <RefreshCw className="w-4 h-4" />Обновить
        </button>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="grid grid-cols-5 gap-4 mb-6">
        <div className="bg-[#12151e] rounded-xl p-4 border border-white/5">
          <div className="flex items-center gap-2 mb-2"><ShieldX className="w-4 h-4 text-red-400" /><span className="text-xs text-gray-500">Баны</span></div>
          <p className="text-2xl font-bold text-white">{totalStats.bans}</p>
        </div>
        <div className="bg-[#12151e] rounded-xl p-4 border border-white/5">
          <div className="flex items-center gap-2 mb-2"><AlertTriangle className="w-4 h-4 text-amber-400" /><span className="text-xs text-gray-500">Муты</span></div>
          <p className="text-2xl font-bold text-white">{totalStats.mutes}</p>
        </div>
        <div className="bg-[#12151e] rounded-xl p-4 border border-white/5">
          <div className="flex items-center gap-2 mb-2"><TrendingUp className="w-4 h-4 text-blue-400" /><span className="text-xs text-gray-500">Всего</span></div>
          <p className="text-2xl font-bold text-white">{totalStats.bans + totalStats.mutes}</p>
        </div>
        <div className="bg-[#12151e] rounded-xl p-4 border border-white/5">
          <div className="flex items-center gap-2 mb-2"><Scissors className="w-4 h-4 text-emerald-400" /><span className="text-xs text-gray-500">Снято</span></div>
          <p className="text-2xl font-bold text-white">{totalStats.removed}</p>
        </div>
        <div className="bg-[#12151e] rounded-xl p-4 border border-white/5">
          <div className="flex items-center gap-2 mb-2"><Users className="w-4 h-4 text-purple-400" /><span className="text-xs text-gray-500">Сотрудников</span></div>
          <p className="text-2xl font-bold text-white">{stats.length}</p>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="bg-[#12151e] rounded-xl border border-white/5 overflow-hidden">
        <div className="grid grid-cols-[40px_1fr_100px_80px_80px_80px_80px_80px] gap-3 px-5 py-3 border-b border-white/5 text-xs text-gray-500 uppercase tracking-wider font-semibold">
          <span>№</span><span>Сотрудник</span><span>Роль</span><span>Баны</span><span>Муты</span><span>Всего</span><span>Активных</span><span>Снято</span>
        </div>
        <div className="divide-y divide-white/[0.03] max-h-[calc(100vh-400px)] overflow-y-auto">
          {sorted.map((s, i) => {
            const admin = admins.find(a => a.steamid === s.steamid);
            return (
              <motion.div key={s.steamid} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.02, 0.5) }}
                className="grid grid-cols-[40px_1fr_100px_80px_80px_80px_80px_80px] gap-3 px-5 py-3 hover:bg-[#161a25] transition-colors items-center">
                <span className="text-sm text-gray-600">{i + 1}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {s.avatar ? (
                      <img src={s.avatar} alt="" className="w-7 h-7 rounded-lg object-cover ring-1 ring-white/10 flex-shrink-0" />
                    ) : (
                      <div className="w-7 h-7 bg-[#1e2333] rounded-lg flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-gray-500">{(s.name || admin?.name || admin?.nickname || '?').charAt(0).toUpperCase()}</span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white truncate">{s.name || admin?.name || admin?.nickname || s.steamid}</p>
                        <a href={`https://fearproject.ru/profile/${s.steamid}`} target="_blank" rel="noopener noreferrer"
                          className="text-gray-600 hover:text-blue-400 transition-colors flex-shrink-0">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      <p className="text-[11px] text-gray-500 font-mono truncate">{s.steamid}</p>
                    </div>
                  </div>
                </div>
                <span className="text-[11px] text-blue-400 truncate">{admin?.group_display_name || admin?.group_name || '—'}</span>
                <span className="text-sm text-red-400 font-medium">{s.total_bans || 0}</span>
                <span className="text-sm text-amber-400 font-medium">{s.total_mutes || 0}</span>
                <span className="text-sm text-white font-bold">{s.total || 0}</span>
                <span className="text-sm text-blue-400">{s.active_total || 0}</span>
                <span className="text-sm text-gray-400">{s.removed_total || 0}</span>
              </motion.div>
            );
          })}
        </div>
        {sorted.length === 0 && (
          <div className="text-center py-12">
            <Users className="w-8 h-8 text-gray-600 mx-auto mb-2" />
            <p className="text-gray-500">Нет данных о стаффе</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
