import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, ChevronDown, ChevronUp, RefreshCw, Users, Flag
} from 'lucide-react';
import { api } from '../services/api';
import type { FearAPIServer, FearAPIPlayer } from '../types';
import PlayerCardModal from './PlayerCardModal';

type SortKey = 'name' | 'kd' | 'kills' | 'account_date' | 'flags';
type SortDir = 'asc' | 'desc';

interface PlayerRow extends FearAPIPlayer {
  status: 'clean' | 'banned' | 'online';
  avatar_url?: string;
  account_created?: number;
  flags?: string[];
  staffRole?: string;
  staffGroup?: string;
}

export default function PlayersPage() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('kills');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerRow | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchPlayers = useCallback(async () => {
    try {
      const res = await api.getServers();
      const servers: FearAPIServer[] = Array.isArray(res) ? res : (res.data || res.servers || []);
      const allPlayers: PlayerRow[] = [];

      for (const server of servers) {
        const serverPlayers = server.live_data?.players || [];
        for (const p of serverPlayers) {
          allPlayers.push({
            ...p,
            server: server.name || `Server #${server.id}`,
            server_id: server.id,
            flag: server.flag || '',
            status: 'online' as const,
            kd: p.kd || (p.deaths > 0 ? p.kills / p.deaths : p.kills),
          });
        }
      }

      // Fetch Steam summaries for account creation dates and ban flags
      const steamIds = allPlayers.map(p => p.steam_id).filter(Boolean);
      if (steamIds.length > 0) {
        try {
          const batch = steamIds.slice(0, 100);
          const fetches = batch.map(async (sid) => {
            try {
              const [summaryRes, banRes, yoomaRes] = await Promise.allSettled([
                api.getSteamSummary(sid),
                api.getSteamBans(sid),
                api.getYoomaBans(sid),
              ]);
              const player = summaryRes.status === 'fulfilled' ? summaryRes.value?.response?.players?.[0] : null;
              const ban = banRes.status === 'fulfilled' ? banRes.value?.players?.[0] : null;
              const yoomaData = yoomaRes.status === 'fulfilled' ? yoomaRes.value : null;
              const flags: string[] = [];
              if (ban?.vacBanned) flags.push('VAC');
              if (ban?.numberofGameBans > 0) flags.push('GAME BAN');
              if (yoomaData?.ok || (yoomaData?.punishments && yoomaData.punishments.length > 0)) flags.push('YOOMA');
              if (player) {
                const ageDays = player.timecreated ? Math.floor((Date.now() / 1000 - player.timecreated) / 86400) : null;
                if (ageDays !== null && ageDays < 365) flags.push(`NEW (${ageDays}д)`);
              }
              return {
                steam_id: sid,
                timecreated: player?.timecreated || 0,
                avatar: player?.avatarmedium || player?.avatarfull || '',
                flags,
              };
            } catch {
              return { steam_id: sid, timecreated: 0, flags: [] as string[] };
            }
          });

          const summaries = await Promise.all(fetches);
          const metaMap = new Map<string, { timecreated: number; flags: string[]; avatar: string }>();
          summaries.forEach(s => metaMap.set(s.steam_id, { timecreated: s.timecreated, flags: s.flags, avatar: s.avatar || '' }));

          for (const p of allPlayers) {
            const meta = metaMap.get(p.steam_id);
            if (meta) {
              p.account_created = meta.timecreated;
              p.flags = meta.flags;
              if (!p.avatar && meta.avatar) {
                p.avatar = meta.avatar;
              }
            }
          }
        } catch {}
      }

      // Fetch staff roles
      try {
        const staffRes = await api.getStaff();
        const staffList = (staffRes?.data || (Array.isArray(staffRes) ? staffRes : [])) as any[];
        const staffMap = new Map<string, { role: string; group: string }>();
        for (const s of staffList) {
          const sid = s.steam_id || s.steamid;
          if (sid) staffMap.set(sid, { role: s.role || s.staff_role || '', group: s.group_name || s.staff_group || '' });
        }
        for (const p of allPlayers) {
          const staffInfo = staffMap.get(p.steam_id);
          if (staffInfo) {
            p.staffRole = staffInfo.role;
            p.staffGroup = staffInfo.group;
          }
        }
      } catch {}

      setPlayers(allPlayers);
      setLastRefresh(new Date());
    } catch {
      setPlayers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlayers();
    const interval = setInterval(fetchPlayers, 30000);
    return () => clearInterval(interval);
  }, [fetchPlayers]);

  const filtered = useMemo(() => {
    let result = players;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(p =>
        p.name?.toLowerCase().includes(q) ||
        p.steam_id?.includes(q) ||
        p.nickname?.toLowerCase().includes(q)
      );
    }

    result.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = (a.name || '').localeCompare(b.name || '');
      else if (sortKey === 'kd') cmp = (a.kd || 0) - (b.kd || 0);
      else if (sortKey === 'kills') cmp = (a.kills || 0) - (b.kills || 0);
      else if (sortKey === 'account_date') cmp = (a.account_created || 0) - (b.account_created || 0);
      else if (sortKey === 'flags') cmp = (a.flags?.length || 0) - (b.flags?.length || 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [players, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'account_date' ? 'asc' : 'desc');
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronDown className="w-3 h-3 opacity-30" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  const formatDate = (ts?: number) => {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
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
        className="mb-6 flex items-center justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold text-white">Игроки</h1>
          <p className="text-sm text-gray-500 mt-1">
            Найдено: {filtered.length} • Обновлено: {lastRefresh.toLocaleTimeString('ru-RU')}
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchPlayers(); }}
          className="flex items-center gap-2 px-4 py-2 bg-[#141822] border border-white/5 rounded-lg text-sm text-gray-400 hover:text-white hover:border-blue-500/30 transition-all"
        >
          <RefreshCw className="w-4 h-4" />
          Обновить
        </button>
      </motion.div>

      {/* Sort Tabs + Search — matches screenshot 1 exactly */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="flex items-center gap-3 mb-4 flex-wrap"
      >
        {[
          { key: 'kills' as SortKey, label: 'По килам' },
          { key: 'kd' as SortKey, label: 'По K/D' },
          { key: 'flags' as SortKey, label: 'По флагам' },
          { key: 'account_date' as SortKey, label: 'По дате акка' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => toggleSort(f.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              sortKey === f.key
                ? 'bg-[#4f7cff] text-white'
                : 'bg-[#141822] text-gray-400 border border-white/5 hover:text-white'
            }`}
          >
            {f.label}
          </button>
        ))}

        <div className="flex-1" />

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Поиск по нику / SteamID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-[280px] pl-9 pr-4 py-2.5 bg-[#141822] border border-white/5 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/30 transition-all"
          />
        </div>
      </motion.div>

      {/* Table — matches screenshot 1: #, ИГРОК, K/D, УБИЙСТВА, ДЕЙСТВИЯ */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-[#12151e] rounded-xl border border-white/5 overflow-hidden"
      >
        <div className="grid grid-cols-[40px_1fr_80px_100px_120px] gap-4 px-5 py-3 border-b border-white/5 text-xs text-gray-500 uppercase tracking-wider font-semibold">
          <span>№</span>
          <button onClick={() => toggleSort('name')} className="flex items-center gap-1 hover:text-white transition-colors text-left">
            Игрок <SortIcon col="name" />
          </button>
          <button onClick={() => toggleSort('kd')} className="flex items-center gap-1 hover:text-white transition-colors text-left">
            K/D <SortIcon col="kd" />
          </button>
          <button onClick={() => toggleSort('kills')} className="flex items-center gap-1 hover:text-white transition-colors text-left">
            Убийства <SortIcon col="kills" />
          </button>
          <span className="text-right">Действия</span>
        </div>

        <div className="divide-y divide-white/[0.03] max-h-[calc(100vh-300px)] overflow-y-auto">
          {filtered.map((player, i) => (
            <motion.div
              key={`${player.steam_id}-${player.server_id}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: Math.min(i * 0.02, 0.5) }}
              className="grid grid-cols-[40px_1fr_80px_100px_120px] gap-4 px-5 py-3 hover:bg-[#161a25] transition-colors items-center group"
            >
              <span className="text-sm text-gray-600">{i + 1}</span>

              <div className="flex items-center gap-3 min-w-0">
                {player.avatar ? (
                  <img src={player.avatar} alt={player.name} className="w-9 h-9 rounded-lg object-cover ring-1 ring-white/10 hover:ring-blue-500/30 transition-all" />
                ) : (
                  <div className="w-9 h-9 bg-[#1e2333] rounded-lg flex items-center justify-center ring-1 ring-white/10">
                    <span className="text-sm font-bold text-gray-500">{player.name?.charAt(0)?.toUpperCase() || '?'}</span>
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white truncate">{player.name || player.nickname || 'Unknown'}</p>
                    {player.staffRole && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 whitespace-nowrap">
                        {player.staffRole}
                      </span>
                    )}
                    {player.flags && player.flags.length > 0 && (
                      <div className="flex gap-1">
                        {player.flags.map((f, fi) => (
                          <span key={fi} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            f.includes('VAC') || f.includes('BAN') ? 'bg-red-500/20 text-red-400' :
                            f.includes('YOOMA') ? 'bg-orange-500/20 text-orange-400' :
                            'bg-amber-500/20 text-amber-400'
                          }`}>
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 font-mono truncate">{player.steam_id}</p>
                </div>
              </div>

              <span className="text-sm text-gray-300">{(player.kd || 0).toFixed(2)}</span>
              <span className="text-sm text-white font-medium">{(player.kills || 0).toLocaleString()}</span>

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setSelectedPlayer(player)}
                  className="px-3 py-1.5 bg-[#4f7cff] hover:bg-[#3d6aff] text-white rounded-lg text-xs font-medium transition-all"
                >
                  Карточка
                </button>
              </div>
            </motion.div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-12">
            <Users className="w-8 h-8 text-gray-600 mx-auto mb-2" />
            <p className="text-gray-500">Игроки не найдены</p>
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {selectedPlayer && (
          <PlayerCardModal player={selectedPlayer} onClose={() => setSelectedPlayer(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
