import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Search, AlertTriangle, Clock, ShieldX, RefreshCw, Users, ExternalLink } from 'lucide-react';
import { api } from '../services/api';
import type { Punishment } from '../types';

type Tab = 'bans' | 'mutes';

function durStr(dur?: number): string {
  if (dur == null) return '—';
  if (dur <= 0) return '∞';
  if (dur >= 2592000) return `${Math.floor(dur / 2592000)}мес`;
  if (dur >= 86400) return `${Math.floor(dur / 86400)}д`;
  if (dur >= 3600) return `${Math.floor(dur / 3600)}ч`;
  if (dur >= 60) return `${Math.floor(dur / 60)}м`;
  return `${dur}с`;
}

function shortReason(s?: string): string {
  const r = (s || '—').replace(/\n/g, ' ').trim();
  return r.length > 45 ? r.slice(0, 45) + '…' : r;
}

interface ProfileInfo { name?: string; avatar?: string; }
type ProfileMap = Record<string, ProfileInfo>;

export default function BansAndMutesPage() {
  const [activeTab, setActiveTab] = useState<Tab>('bans');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [punishments, setPunishments] = useState<Punishment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [staffSteamIds, setStaffSteamIds] = useState<Set<string>>(new Set());
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [filterAdmin, setFilterAdmin] = useState('');

  useEffect(() => {
    api.getStaff()
      .then((res) => {
        const list = (res?.data || res?.staff || (Array.isArray(res) ? res : [])) as any[];
        const ids = new Set<string>();
        for (const s of list) {
          const sid = s.steam_id || s.steamid;
          if (sid) ids.add(sid);
        }
        setStaffSteamIds(ids);
      })
      .catch(() => {});
  }, []);

  const fetchPunishments = useCallback(async () => {
    setLoading(true);
    try {
      const type = activeTab === 'bans' ? '1' : '2';
      const res = await api.getAllPunishments({ page, type, search: search || undefined });
      let items: Punishment[] = res.punishments || [];

      if (staffSteamIds.size > 0) {
        items = items.filter((p) => staffSteamIds.has(p.admin_steamid));
      }

      items.sort((a: any, b: any) => (b.created || 0) - (a.created || 0));
      setPunishments(items);
      setTotal(res.total || items.length);
      setLastRefresh(new Date());

      const idsToResolve = new Set<string>();
      for (const p of items) {
        if (p.steamid && !profiles[p.steamid]) idsToResolve.add(p.steamid);
        if (p.admin_steamid && !profiles[p.admin_steamid]) idsToResolve.add(p.admin_steamid);
      }
      if (idsToResolve.size > 0) {
        try {
          const nameRes = await api.resolveNames([...idsToResolve]);
          if (nameRes?.profiles) {
            setProfiles(prev => ({ ...prev, ...nameRes.profiles }));
          }
        } catch {}
      }
    } catch {
      setPunishments([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [activeTab, page, search, staffSteamIds]);

  useEffect(() => {
    fetchPunishments();
    const interval = setInterval(fetchPunishments, 30000);
    return () => clearInterval(interval);
  }, [fetchPunishments]);

  useEffect(() => { setPage(1); }, [activeTab, search]);

  const getStatusLabel = (status: number) => {
    switch (status) {
      case 1: return { label: 'Активен', color: 'text-red-400 bg-red-400/10' };
      case 2: return { label: 'Снят', color: 'text-emerald-400 bg-emerald-400/10' };
      case 4: return { label: 'Истёк', color: 'text-gray-400 bg-gray-400/10' };
      default: return { label: 'Неизвестно', color: 'text-gray-400 bg-gray-400/10' };
    }
  };

  const getProfileName = (steamid: string, fallback?: string) => {
    const p = profiles[steamid];
    if (p?.name) return p.name;
    if (fallback) return fallback;
    return undefined;
  };

  const getProfileAvatar = (steamid: string) => {
    return profiles[steamid]?.avatar || '';
  };

  const displayPunishments = filterAdmin
    ? punishments.filter(p => p.admin_steamid === filterAdmin)
    : punishments;

  const uniqueAdmins = new Map<string, string>();
  for (const p of punishments) {
    if (p.admin_steamid && !uniqueAdmins.has(p.admin_steamid)) {
      uniqueAdmins.set(p.admin_steamid, getProfileName(p.admin_steamid, p.admin_name) || p.admin_steamid);
    }
  }

  return (
    <div className="max-w-[1100px] mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Баны и муты</h1>
          <p className="text-sm text-[#8a8a93] mt-1">
            Только от стаффа • Найдено: {displayPunishments.length} • Обновлено: {lastRefresh.toLocaleTimeString('ru-RU')}
          </p>
        </div>
        <button onClick={() => { setLoading(true); fetchPunishments(); }}
          className="flex items-center gap-2 px-4 py-2 bg-[#141822] border border-white/5 rounded-lg text-sm text-gray-400 hover:text-white hover:border-blue-500/30 transition-all">
          <RefreshCw className="w-4 h-4" />Обновить
        </button>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="bg-[#12151e] rounded-xl border border-white/5 p-4 mb-6">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <button onClick={() => setActiveTab('bans')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'bans' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-[#1a1f2e] text-gray-400 border border-white/5 hover:text-white'}`}>
            <ShieldX className="w-4 h-4" />Баны
          </button>
          <button onClick={() => setActiveTab('mutes')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'mutes' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-[#1a1f2e] text-gray-400 border border-white/5 hover:text-white'}`}>
            <AlertTriangle className="w-4 h-4" />Муты
          </button>
          <span className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a1f2e] border border-white/5 rounded-lg text-xs text-gray-500">
            <Users className="w-3 h-3" />Только стафф
          </span>
          {uniqueAdmins.size > 0 && (
            <select value={filterAdmin} onChange={e => setFilterAdmin(e.target.value)}
              className="px-3 py-2 bg-[#1a1f2e] border border-white/5 rounded-lg text-xs text-gray-400 focus:outline-none cursor-pointer">
              <option value="">Все админы</option>
              {[...uniqueAdmins.entries()].map(([sid, name]) => (
                <option key={sid} value={sid}>{name} ({sid})</option>
              ))}
            </select>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input type="text" placeholder="Поиск по нику / SteamID / админу / причине..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-[#0c0e14] border border-white/5 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/30 transition-all" />
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="bg-[#12151e] rounded-xl border border-white/5 overflow-hidden">
        <div className="grid grid-cols-[40px_1fr_1fr_1fr_120px_80px_80px_100px] gap-3 px-4 py-3 border-b border-white/5 text-xs text-gray-500 uppercase tracking-wider font-semibold">
          <span>№</span><span>Игрок</span><span>SteamID</span><span>Причина</span><span>Админ</span><span>Статус</span><span>Длит.</span><span>Дата</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : displayPunishments.length > 0 ? (
          <div className="divide-y divide-white/[0.03] max-h-[calc(100vh-400px)] overflow-y-auto">
            {displayPunishments.map((p, i) => {
              const statusInfo = getStatusLabel(p.status);
              const playerName = getProfileName(p.steamid, (p as any).name);
              const playerAvatar = getProfileAvatar(p.steamid);
              const adminName = getProfileName(p.admin_steamid, p.admin_name);
              const adminAvatar = getProfileAvatar(p.admin_steamid);
              return (
                <motion.div key={p.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.02, 0.5) }}
                  className="grid grid-cols-[40px_1fr_1fr_1fr_120px_80px_80px_100px] gap-3 px-4 py-3 hover:bg-[#161a25] transition-colors items-center">
                  <span className="text-sm text-gray-600">{i + 1}</span>
                  <div className="flex items-center gap-2 min-w-0">
                    {playerAvatar ? (
                      <img src={playerAvatar} alt="" className="w-7 h-7 rounded-lg object-cover ring-1 ring-white/10 flex-shrink-0" />
                    ) : (
                      <div className="w-7 h-7 bg-[#1e2333] rounded-lg flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-gray-500">{playerName?.charAt(0)?.toUpperCase() || '?'}</span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate">{playerName || p.steamid}</p>
                      {playerName && playerName !== p.steamid && (
                        <a href={`https://fearproject.ru/profile/${p.steamid}`} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] text-gray-500 hover:text-blue-400 font-mono truncate block">{p.steamid}</a>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 font-mono truncate">{p.steamid}</span>
                  <span className="text-sm text-gray-300 truncate">{shortReason(p.reason)}</span>
                  <div className="flex items-center gap-2 min-w-0">
                    {adminAvatar ? (
                      <img src={adminAvatar} alt="" className="w-5 h-5 rounded object-cover ring-1 ring-white/10 flex-shrink-0" />
                    ) : null}
                    <div className="min-w-0">
                      <span className="text-xs text-gray-400 truncate block">{adminName || '—'}</span>
                      {adminName && adminName !== p.admin_steamid && p.admin_steamid && (
                        <span className="text-[10px] text-gray-600 font-mono truncate block">{p.admin_steamid}</span>
                      )}
                    </div>
                  </div>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${statusInfo.color}`}>{statusInfo.label}</span>
                  <span className="text-xs text-gray-400"><Clock className="w-3 h-3 inline mr-1" />{durStr(p.duration)}</span>
                  <span className="text-xs text-gray-500">
                    {p.time ? new Date(p.time).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
                      : p.created ? new Date(p.created * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                  </span>
                </motion.div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12"><p className="text-gray-500">Наказания не найдены</p></div>
        )}
        {total > 50 && (
          <div className="flex items-center justify-center gap-2 py-4 border-t border-white/5">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 bg-[#1a1f2e] border border-white/5 rounded-lg text-xs text-gray-400 hover:text-white disabled:opacity-30 transition-all">Назад</button>
            <span className="text-xs text-gray-500">Стр. {page}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={displayPunishments.length < 50}
              className="px-3 py-1.5 bg-[#1a1f2e] border border-white/5 rounded-lg text-xs text-gray-400 hover:text-white disabled:opacity-30 transition-all">Далее</button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
