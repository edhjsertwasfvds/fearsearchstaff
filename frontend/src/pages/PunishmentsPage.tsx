import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Search, AlertTriangle, ShieldX, Clock, Check, Scissors } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../hooks/useAuth';

export default function PunishmentsPage() {
  const { user } = useAuth();
  const [steamId, setSteamId] = useState('');
  const [loading, setLoading] = useState(false);
  const [punishments, setPunishments] = useState<any[]>([]);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (id?: string) => {
    const sid = (id || steamId).trim();
    if (!sid) return;
    setLoading(true);
    setSearched(true);
    setSteamId(sid);
    try {
      const res = await api.getPunishmentsByAdmin(sid);
      setPunishments(res.punishments || []);
    } catch {
      setPunishments([]);
    } finally {
      setLoading(false);
    }
  };

  const handleShowOwn = async () => {
    if (!user?.steam_id) return;
    setSteamId(user.steam_id);
    await handleSearch(user.steam_id);
  };

  const bansActive = punishments.filter(p => p.type === 0 && p.status === 1).length;
  const bansRemoved = punishments.filter(p => p.type === 0 && p.status === 2).length;
  const bansExpired = punishments.filter(p => p.type === 0 && p.status === 4).length;
  const bansTotal = punishments.filter(p => p.type === 0).length;

  const mutesActive = punishments.filter(p => p.type === 1 && p.status === 1).length;
  const mutesRemoved = punishments.filter(p => p.type === 1 && p.status === 2).length;
  const mutesExpired = punishments.filter(p => p.type === 1 && p.status === 4).length;
  const mutesTotal = punishments.filter(p => p.type === 1).length;

  const effective = (bansTotal - bansRemoved) + (mutesTotal - mutesRemoved);

  const getServerName = (id: number) => {
    const servers: Record<number, string> = {
      1: 'MIRAGE #1', 2: 'MIRAGE #2', 3: 'DUST2 #1',
      4: 'NUKE #1', 5: 'INFERNO #1',
    };
    return servers[id] || `Server #${id}`;
  };

  const getStatusLabel = (status: number) => {
    switch (status) {
      case 1: return { label: 'Активен', color: 'text-red-400 bg-red-400/10' };
      case 2: return { label: 'Снят', color: 'text-emerald-400 bg-emerald-400/10' };
      case 4: return { label: 'Истёк', color: 'text-gray-400 bg-gray-400/10' };
      default: return { label: '—', color: 'text-gray-400 bg-gray-400/10' };
    }
  };

  const durStr = (dur?: number) => {
    if (dur == null) return '—';
    if (dur <= 0) return '∞';
    if (dur >= 2592000) return `${Math.floor(dur / 2592000)}мес`;
    if (dur >= 86400) return `${Math.floor(dur / 86400)}д`;
    if (dur >= 3600) return `${Math.floor(dur / 3600)}ч`;
    if (dur >= 60) return `${Math.floor(dur / 60)}м`;
    return `${dur}с`;
  };

  const sorted = [...punishments].sort((a, b) => (b.created || 0) - (a.created || 0));

  return (
    <div className="max-w-[1100px] mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <h1 className="text-2xl font-bold text-white">Наказания</h1>
        <p className="text-sm text-gray-500 mt-1">Наказания выданные стаффом</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="bg-[#12151e] rounded-xl border border-white/5 p-4 mb-6"
      >
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="SteamID стаффа (напр. 76561198751025670)"
              value={steamId}
              onChange={(e) => setSteamId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full pl-11 pr-4 py-3 bg-[#0c0e14] border border-white/5 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/30 transition-all"
            />
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => handleSearch()}
            disabled={loading || !steamId.trim()}
            className="px-6 py-3 bg-[#4f7cff] hover:bg-[#3d6aff] text-white font-medium rounded-xl transition-all disabled:opacity-50"
          >
            {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Проверить'}
          </motion.button>
          {user?.steam_id && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleShowOwn}
              disabled={loading}
              className="px-6 py-3 bg-[#1a1f2e] hover:bg-[#222840] border border-white/10 text-gray-300 font-medium rounded-xl transition-all disabled:opacity-50"
            >
              Мои наказания
            </motion.button>
          )}
        </div>

        {punishments.length > 0 && (
          <div className="grid grid-cols-5 gap-3 mt-4">
            <div className="flex items-center gap-2 px-3 py-2 bg-red-500/5 border border-red-500/10 rounded-lg">
              <ShieldX className="w-4 h-4 text-red-400" />
              <div>
                <p className="text-lg font-bold text-white">{bansTotal}</p>
                <p className="text-[10px] text-gray-500">Банов</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/5 border border-amber-500/10 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <div>
                <p className="text-lg font-bold text-white">{mutesTotal}</p>
                <p className="text-[10px] text-gray-500">Мутов</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/5 border border-blue-500/10 rounded-lg">
              <Check className="w-4 h-4 text-blue-400" />
              <div>
                <p className="text-lg font-bold text-white">{effective}</p>
                <p className="text-[10px] text-gray-500">Всего (без снятых)</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/5 border border-emerald-500/10 rounded-lg">
              <Scissors className="w-4 h-4 text-emerald-400" />
              <div>
                <p className="text-lg font-bold text-white">{bansRemoved + mutesRemoved}</p>
                <p className="text-[10px] text-gray-500">Снято</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 bg-purple-500/5 border border-purple-500/10 rounded-lg">
              <Clock className="w-4 h-4 text-purple-400" />
              <div>
                <p className="text-lg font-bold text-white">{bansExpired + mutesExpired}</p>
                <p className="text-[10px] text-gray-500">Истекло</p>
              </div>
            </div>
          </div>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-[#12151e] rounded-xl border border-white/5 overflow-hidden"
      >
        <div className="grid grid-cols-[40px_1fr_80px_1fr_80px_80px_80px_100px] gap-3 px-4 py-3 border-b border-white/5 text-xs text-gray-500 uppercase tracking-wider font-semibold">
          <span>№</span><span>Игрок</span><span>SteamID</span><span>Причина</span><span>Тип</span><span>Статус</span><span>Длит.</span><span>Дата</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : sorted.length > 0 ? (
          <div className="divide-y divide-white/[0.03] max-h-[calc(100vh-420px)] overflow-y-auto">
            {sorted.map((p, i) => {
              const statusInfo = getStatusLabel(p.status);
              return (
                <div key={p.id} className="grid grid-cols-[40px_1fr_80px_1fr_80px_80px_80px_100px] gap-3 px-4 py-3 hover:bg-[#161a25] transition-colors items-center">
                  <span className="text-sm text-gray-600">{i + 1}</span>
                  <div className="flex items-center gap-2 min-w-0">
                    {p.avatar ? (
                      <img src={p.avatar} alt="" className="w-7 h-7 rounded-lg object-cover ring-1 ring-white/10 flex-shrink-0" />
                    ) : (
                      <div className="w-7 h-7 bg-[#1e2333] rounded-lg flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-gray-500">{(p.name || '?').charAt(0).toUpperCase()}</span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate">{p.name || p.steamid}</p>
                      {p.name && p.name !== p.steamid && (
                        <a href={`https://fearproject.ru/profile/${p.steamid}`} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] text-gray-500 hover:text-blue-400 font-mono truncate block">{p.steamid}</a>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 font-mono truncate">{p.steamid}</span>
                  <span className="text-sm text-gray-300 truncate">{p.reason || '—'}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${p.type === 0 ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
                    {p.type === 0 ? 'BAN' : 'MUTE'}
                  </span>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${statusInfo.color}`}>{statusInfo.label}</span>
                  <span className="text-xs text-gray-400"><Clock className="w-3 h-3 inline mr-1" />{durStr(p.duration)}</span>
                  <span className="text-xs text-gray-500">
                    {p.time ? new Date(p.time).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
                      : p.created ? new Date(p.created * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12">
            {searched ? (
              <p className="text-gray-500">Наказания не найдены</p>
            ) : (
              <p className="text-gray-500">Введите SteamID стаффа</p>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
