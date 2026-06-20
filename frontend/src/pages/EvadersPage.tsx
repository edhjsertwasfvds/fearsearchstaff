import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Search, RefreshCw, ExternalLink } from 'lucide-react';
import { api } from '../services/api';

interface Evader {
  steam_id: string;
  name: string;
  avatar?: string;
  check_id: number;
  filename: string;
  banned_steam_id: string;
  ban_reason: string;
  server_name: string;
  server_ip: string;
  server_port: string;
  detected_at: string;
}

export default function EvadersPage() {
  const [evaders, setEvaders] = useState<Evader[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const fetchEvaders = async () => {
    setRefreshing(true);
    try {
      const res = await api.getEvaders();
      setEvaders(res.data || []);
    } catch (err) {
      console.error('Failed to fetch evaders:', err);
      setEvaders([]);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvaders();
  }, []);

  const filtered = evaders.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.name?.toLowerCase().includes(q) ||
      e.steam_id?.includes(q) ||
      e.banned_steam_id?.includes(q) ||
      e.server_name?.toLowerCase().includes(q)
    );
  });

  const getBanReasonColor = (reason: string) => {
    if (reason.includes('VAC')) return 'text-red-400 bg-red-400/10 border-red-400/20';
    if (reason.includes('Fear')) return 'text-orange-400 bg-orange-400/10 border-orange-400/20';
    if (reason.includes('Community')) return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
    if (reason.includes('Game')) return 'text-purple-400 bg-purple-400/10 border-purple-400/20';
    return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <div className="flex items-center gap-3 mb-1">
          <AlertTriangle className="w-6 h-6 text-red-400" />
          <h1 className="text-2xl font-bold text-white">Обходники</h1>
        </div>
        <p className="text-sm text-[#8a8a93]">
          Игроки, которые забанены на одном аккаунте, но играют с другого из того же .vdf файла
        </p>
      </motion.div>

      {/* Stats */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6"
      >
        <div className="bg-[#12151e] rounded-xl border border-white/5 p-4">
          <p className="text-xs text-gray-500 mb-1">Всего обходников</p>
          <p className="text-2xl font-bold text-red-400">{evaders.length}</p>
        </div>
        <div className="bg-[#12151e] rounded-xl border border-white/5 p-4">
          <p className="text-xs text-gray-500 mb-1">Уникальных серверов</p>
          <p className="text-2xl font-bold text-blue-400">
            {new Set(evaders.map(e => e.server_name)).size}
          </p>
        </div>
        <div className="bg-[#12151e] rounded-xl border border-white/5 p-4">
          <p className="text-xs text-gray-500 mb-1">Уникальных .vdf файлов</p>
          <p className="text-2xl font-bold text-purple-400">
            {new Set(evaders.map(e => e.filename)).size}
          </p>
        </div>
      </motion.div>

      {/* Search & Refresh */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="flex gap-3 mb-4"
      >
        <div className="flex-1 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Поиск по имени, Steam ID, серверу..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-[#12151e] border border-white/5 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/30 transition-all"
          />
        </div>
        <button
          onClick={fetchEvaders}
          disabled={refreshing}
          className="px-4 py-3 bg-[#12151e] hover:bg-[#1a1f2e] border border-white/5 rounded-xl text-white transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </motion.div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-[#12151e] rounded-xl border border-white/5 overflow-hidden"
      >
        <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_120px] gap-4 px-5 py-3 border-b border-white/5 text-xs text-gray-500 uppercase tracking-wider font-semibold">
          <span>Игрок (Текущий)</span>
          <span>Забанен на</span>
          <span>Причина бана</span>
          <span>Сервер</span>
          <span>.vdf файл</span>
          <span className="text-right">Действия</span>
        </div>

        <div className="divide-y divide-white/[0.03] max-h-[calc(100vh-380px)] overflow-y-auto">
          {filtered.map((evader, idx) => (
            <div
              key={`${evader.steam_id}-${idx}`}
              className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_120px] gap-4 px-5 py-3 hover:bg-[#161a25] transition-colors items-center text-sm"
            >
              {/* Current Player */}
              <div>
                <p className="font-medium text-white truncate">{evader.name}</p>
                <p className="text-[11px] text-gray-500 font-mono truncate">{evader.steam_id}</p>
              </div>

              {/* Banned Account */}
              <div>
                <p className="text-gray-400 truncate">Аккаунт</p>
                <p className="text-[11px] text-gray-500 font-mono truncate">{evader.banned_steam_id}</p>
              </div>

              {/* Ban Reason */}
              <div>
                <span className={`px-2 py-1 rounded text-[10px] font-medium border ${getBanReasonColor(evader.ban_reason)}`}>
                  {evader.ban_reason}
                </span>
              </div>

              {/* Server */}
              <div>
                <p className="text-gray-400 truncate">{evader.server_name}</p>
                <p className="text-[11px] text-gray-500 font-mono truncate">
                  {evader.server_ip}:{evader.server_port}
                </p>
              </div>

              {/* VDF File */}
              <div>
                <p className="text-gray-400 truncate text-[11px]">{evader.filename}</p>
                <p className="text-[10px] text-gray-600">
                  Проверка #{evader.check_id}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2">
                <a
                  href={`https://steamcommunity.com/profiles/${evader.steam_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 hover:bg-[#1a1f2e] rounded-lg transition-colors"
                  title="Открыть профиль Steam"
                >
                  <ExternalLink className="w-4 h-4 text-gray-500 hover:text-blue-400" />
                </a>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-12">
            <AlertTriangle className="w-12 h-12 text-gray-600 mx-auto mb-3 opacity-50" />
            <p className="text-gray-500">
              {evaders.length === 0 ? 'Обходников не найдено' : 'По вашему запросу ничего не найдено'}
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}

