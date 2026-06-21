import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Trophy, Users, Wifi } from 'lucide-react';
import { api } from '../services/api';
import type { FearAPIServer } from '../types';

interface LeaderboardPlayer {
  steam_id: string;
  name: string;
  kills: number;
  deaths: number;
  kd: number;
  avatar?: string;
}

function extractPlayers(data: any): LeaderboardPlayer[] {
  if (!data) return [];
  const raw = data.players || data.data?.players || data.data || data;
  if (!Array.isArray(raw)) return [];
  return raw.map((p: any) => ({
    steam_id: p.steam_id || p.steamid || '',
    name: p.name || p.nickname || p.personaname || 'Unknown',
    kills: Number(p.kills || 0),
    deaths: Number(p.deaths || 0),
    kd: Number(p.kd || (p.deaths > 0 ? p.kills / p.deaths : 0)),
    avatar: p.avatar || p.avatarfull || '',
  }));
}

export default function LeaderboardPage() {
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlineOnly, setOnlineOnly] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await api.getLeaderboard();
      let parsed = extractPlayers(res);
      if (parsed.length === 0 && res?.success === false) {
        throw new Error('API returned success:false');
      }
      if (parsed.length === 0) {
        throw new Error('No players in leaderboard response');
      }

      if (onlineOnly) {
        try {
          const serversRes = await api.getServers();
          const servers: FearAPIServer[] = Array.isArray(serversRes)
            ? serversRes
            : Array.isArray(serversRes?.data)
              ? serversRes.data
              : Array.isArray(serversRes?.servers)
                ? serversRes.servers
                : [];
          const onlineSet = new Set<string>();
          for (const s of servers) {
            const livePlayers = s.live_data?.players || [];
            for (const p of livePlayers) {
              onlineSet.add(p.steam_id);
            }
          }

          const onlineTop = parsed.filter(p => onlineSet.has(p.steam_id));

          for (const p of onlineTop) {
            for (const s of servers) {
              const lp = (s.live_data?.players || []).find((lp: any) => lp.steam_id === p.steam_id);
              if (lp?.avatar && !p.avatar) {
                p.avatar = lp.avatar;
              }
            }
          }

          setPlayers(onlineTop.slice(0, 1000));
        } catch {
          setPlayers(parsed.slice(0, 1000));
        }
      } else {
        setPlayers(parsed.slice(0, 1000));
      }
      setLastRefresh(new Date());
    } catch {
      try {
        const serversRes = await api.getServers();
        const servers: FearAPIServer[] = Array.isArray(serversRes)
          ? serversRes
          : Array.isArray(serversRes?.data)
            ? serversRes.data
            : Array.isArray(serversRes?.servers)
              ? serversRes.servers
              : [];
        const playerMap = new Map<string, LeaderboardPlayer>();
        for (const s of servers) {
          const livePlayers = s.live_data?.players || [];
          for (const p of livePlayers) {
            const existing = playerMap.get(p.steam_id);
            if (existing) {
              existing.kills += p.kills || 0;
              existing.deaths += p.deaths || 0;
              existing.kd = existing.deaths > 0 ? existing.kills / existing.deaths : existing.kills;
            } else {
              playerMap.set(p.steam_id, {
                steam_id: p.steam_id,
                name: p.name || p.nickname || 'Unknown',
                kills: p.kills || 0,
                deaths: p.deaths || 0,
                kd: p.kd || (p.deaths > 0 ? p.kills / p.deaths : p.kills),
                avatar: p.avatar,
              });
            }
          }
        }
        const sorted = Array.from(playerMap.values()).sort((a, b) => b.kills - a.kills).slice(0, 1000);
        setPlayers(sorted);
      } catch {
        setPlayers([]);
      }
    } finally {
      setLoading(false);
    }
  }, [onlineOnly]);

  useEffect(() => {
    setLoading(true);
    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 30000);
    return () => clearInterval(interval);
  }, [fetchLeaderboard]);

  const getMedal = (i: number) => {
    if (i === 0) return '🥇';
    if (i === 1) return '🥈';
    if (i === 2) return '🥉';
    return null;
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
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 flex items-center justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold text-white">Топ-1000</h1>
          <p className="text-sm text-gray-500 mt-1">
            {onlineOnly ? 'Онлайн игроки из топ-1000' : 'Лучшие игроки по убийствам'} • Обновлено: {lastRefresh.toLocaleTimeString('ru-RU')}
          </p>
        </div>
        <button
          onClick={() => setOnlineOnly(v => !v)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            onlineOnly
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-[#141822] text-gray-400 border border-white/5 hover:text-white'
          }`}
        >
          <Wifi className="w-4 h-4" />
          {onlineOnly ? 'Только онлайн' : 'Все из топа'}
        </button>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-[#12151e] rounded-xl border border-white/5 overflow-hidden"
      >
        <div className="grid grid-cols-[40px_1fr_80px_80px_80px] gap-4 px-5 py-3 border-b border-white/5 text-xs text-gray-500 uppercase tracking-wider font-semibold">
          <span>#</span>
          <span>Игрок</span>
          <span>Убийства</span>
          <span>Смерти</span>
          <span>K/D</span>
        </div>

        <div className="divide-y divide-white/[0.03] max-h-[calc(100vh-280px)] overflow-y-auto">
          {players.map((p, i) => {
            const medal = getMedal(i);
            return (
              <motion.div
                key={`${p.steam_id}-${i}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(i * 0.01, 0.5) }}
                className="grid grid-cols-[40px_1fr_80px_80px_80px] gap-4 px-5 py-3 hover:bg-[#161a25] transition-colors items-center"
              >
                <span className="text-sm text-gray-600">
                  {medal || i + 1}
                </span>
                <div className="flex items-center gap-3 min-w-0">
                  {p.avatar ? (
                    <img src={p.avatar} alt={p.name} className="w-8 h-8 rounded-lg object-cover ring-1 ring-white/10" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <div className="w-8 h-8 bg-[#1e2333] rounded-lg flex items-center justify-center">
                      <span className="text-xs font-bold text-gray-500">{p.name?.charAt(0)?.toUpperCase() || '?'}</span>
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{p.name}</p>
                    <p className="text-[11px] text-gray-500 font-mono truncate">{p.steam_id}</p>
                  </div>
                </div>
                <span className="text-sm text-white font-bold">{p.kills.toLocaleString()}</span>
                <span className="text-sm text-gray-400">{p.deaths.toLocaleString()}</span>
                <span className="text-sm text-gray-300">{p.kd.toFixed(2)}</span>
              </motion.div>
            );
          })}
        </div>

        {players.length === 0 && (
          <div className="text-center py-12">
            <Trophy className="w-8 h-8 text-gray-600 mx-auto mb-2" />
            <p className="text-gray-500">{onlineOnly ? 'Нет онлайн игроков из топа' : 'Нет данных'}</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
