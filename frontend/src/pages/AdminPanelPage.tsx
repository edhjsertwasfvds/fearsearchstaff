import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Crown, Users, Search, Lock } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import type { AdminUser } from '../types';

const OWNER_DISCORD_ID = '1500235583367417866';

const LEVEL_OPTIONS = [
  { value: -1, label: 'Заблокирован', color: 'text-red-400' },
  { value: 1, label: 'LVL 1 — Админ', color: 'text-emerald-400' },
  { value: 2, label: 'LVL 2 — Модератор', color: 'text-purple-400' },
  { value: 3, label: 'LVL 3 — Ст.Модер', color: 'text-blue-400' },
  { value: 4, label: 'LVL 4 — Ст.Админ', color: 'text-orange-400' },
  { value: 5, label: 'LVL 5 — Владелец', color: 'text-yellow-400' },
];

const GROUP_MAP: Record<number, string> = {
  '-1': 'UNDEFINED',
  '1': 'ADMIN',
  '2': 'MODER',
  '3': 'STMODER',
  '4': 'STADMIN',
  '5': 'OWNER',
};

function getLevelColor(level: number) {
  if (level >= 5) return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
  if (level >= 4) return 'text-orange-400 bg-orange-400/10 border-orange-400/20';
  if (level >= 3) return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
  if (level >= 2) return 'text-purple-400 bg-purple-400/10 border-purple-400/20';
  if (level >= 1) return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
  return 'text-red-400 bg-red-400/10 border-red-400/20';
}

export default function AdminPanelPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [callerInfo, setCallerInfo] = useState<{ is_owner: boolean; caller_level: number }>({ is_owner: false, caller_level: 0 });

  const fetchUsers = async () => {
    try {
      const res = await api.getAdminUsers();
      setUsers(res.data || []);
      setCallerInfo({ is_owner: res.is_owner || false, caller_level: res.caller_level || 0 });
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleLevelChange = async (discordId: string, newLevel: number) => {
    if (discordId === OWNER_DISCORD_ID) return;
    setUpdating(discordId);
    try {
      const group = GROUP_MAP[newLevel] || 'UNDEFINED';
      await api.updateUserLevel(discordId, newLevel, group);
      setUsers(prev => prev.map(u =>
        u.discord_id === discordId
          ? { ...u, level: newLevel, is_blocked: newLevel < 0, staff_group: group }
          : u
      ));
    } catch (err) {
      console.error('Failed to update user:', err);
    } finally {
      setUpdating(null);
    }
  };

  const handleBlock = async (discordId: string) => {
    if (discordId === OWNER_DISCORD_ID) return;
    if (!confirm('Заблокировать пользователя?')) return;
    setUpdating(discordId);
    try {
      await api.blockUser(discordId);
      setUsers(prev => prev.map(u =>
        u.discord_id === discordId
          ? { ...u, level: -1, is_blocked: true, staff_group: 'UNDEFINED' }
          : u
      ));
    } catch (err) {
      console.error('Failed to block user:', err);
    } finally {
      setUpdating(null);
    }
  };

  const filtered = users.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.display_name?.toLowerCase().includes(q) ||
      u.username?.toLowerCase().includes(q) ||
      u.discord_id?.includes(q)
    );
  });

  const isProtected = (discordId: string, level: number) => {
    if (discordId === OWNER_DISCORD_ID) return true;
    if (level >= 5 && !callerInfo.is_owner) return true;
    return false;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <div className="flex items-center gap-3 mb-1">
          <Crown className="w-6 h-6 text-yellow-400" />
          <h1 className="text-2xl font-bold text-white">Панель Управления</h1>
        </div>
        <p className="text-sm text-[#8a8a93]">
          Только для LVL 5 — Управление пользователями и уровнями доступа
        </p>
      </motion.div>

      {/* Stats */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-4 gap-4 mb-6"
      >
        <div className="bg-[#12151e] rounded-xl border border-white/5 p-4">
          <p className="text-xs text-gray-500 mb-1">Всего</p>
          <p className="text-2xl font-bold text-white">{users.length}</p>
        </div>
        <div className="bg-[#12151e] rounded-xl border border-white/5 p-4">
          <p className="text-xs text-gray-500 mb-1">Активных</p>
          <p className="text-2xl font-bold text-emerald-400">{users.filter(u => u.level >= 1).length}</p>
        </div>
        <div className="bg-[#12151e] rounded-xl border border-white/5 p-4">
          <p className="text-xs text-gray-500 mb-1">Заблокировано</p>
          <p className="text-2xl font-bold text-red-400">{users.filter(u => u.level < 0).length}</p>
        </div>
        <div className="bg-[#12151e] rounded-xl border border-white/5 p-4">
          <p className="text-xs text-gray-500 mb-1">LVL 5</p>
          <p className="text-2xl font-bold text-yellow-400">{users.filter(u => u.level >= 5).length}</p>
        </div>
      </motion.div>

      {/* Search */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mb-4"
      >
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Поиск по имени / Discord ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-[#12151e] border border-white/5 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/30 transition-all"
          />
        </div>
      </motion.div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-[#12151e] rounded-xl border border-white/5 overflow-hidden"
      >
        <div className="grid grid-cols-[60px_1fr_1fr_100px_120px] gap-4 px-5 py-3 border-b border-white/5 text-xs text-gray-500 uppercase tracking-wider font-semibold">
          <span>Аватар</span>
          <span>Пользователь</span>
          <span>Discord ID</span>
          <span>Уровень</span>
          <span className="text-right">Действия</span>
        </div>

        <div className="divide-y divide-white/[0.03] max-h-[calc(100vh-380px)] overflow-y-auto">
          {filtered.map((user) => {
            const protected_ = isProtected(user.discord_id, user.level);
            return (
              <div
                key={user.discord_id}
                className="grid grid-cols-[60px_1fr_1fr_100px_120px] gap-4 px-5 py-3 hover:bg-[#161a25] transition-colors items-center"
              >
                {/* Avatar */}
                <div>
                  {user.avatar ? (
                    <img
                      src={`https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar}.png?size=64`}
                      alt={user.username}
                      className="w-10 h-10 rounded-full ring-1 ring-white/10"
                    />
                  ) : (
                    <div className="w-10 h-10 bg-[#1e2333] rounded-full flex items-center justify-center">
                      <Users className="w-5 h-5 text-gray-500" />
                    </div>
                  )}
                </div>

                {/* Name */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white truncate">{user.display_name || user.username}</p>
                    {user.discord_id === OWNER_DISCORD_ID && (
                      <Crown className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 truncate">{user.staff_role || 'Без роли'}</p>
                </div>

                {/* Discord ID */}
                <span className="text-sm text-gray-400 font-mono truncate">{user.discord_id}</span>

                {/* Level */}
                <div className="flex items-center gap-2">
                  {protected_ ? (
                    <div className="flex items-center gap-1.5">
                      <span className={`px-3 py-1.5 bg-[#1a1f2e] border border-white/5 rounded-lg text-xs font-medium ${getLevelColor(user.level)}`}>
                        LVL {user.level}
                      </span>
                      <Lock className="w-3 h-3 text-gray-600" />
                    </div>
                  ) : (
                    <select
                      value={user.level}
                      onChange={(e) => handleLevelChange(user.discord_id, parseInt(e.target.value))}
                      disabled={updating === user.discord_id}
                      className={`px-3 py-1.5 bg-[#1a1f2e] border border-white/5 rounded-lg text-xs font-medium focus:outline-none cursor-pointer ${getLevelColor(user.level)} disabled:opacity-50`}
                    >
                      {LEVEL_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Status */}
                <div className="flex items-center justify-end gap-2">
                  {user.level >= 1 ? (
                    <span className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded text-[10px] text-emerald-400 font-medium">
                      Активен
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 bg-red-500/10 border border-red-500/20 rounded text-[10px] text-red-400 font-medium">
                      Заблокирован
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">Пользователи не найдены</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
