import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ShieldX, Check, AlertTriangle, ExternalLink, Users, Upload, FileText } from 'lucide-react';
import { api } from '../services/api';
import type { AccountResult } from '../types';

interface AccountCheckResult extends AccountResult {
  steam_id: string;
  name: string;
  avatar: string;
  status: string;
  ban_type?: string;
  ban_reason?: string;
  ban_days_ago?: number;
  ban_date?: string;
  fear_status?: string;
  kd?: number;
  playtime?: number;
}

interface VDFResult {
  steamid: string;
  nickname: string;
  fear_banned: boolean;
  fear_reason: string;
  vac_banned: boolean;
  game_bans: number;
  community_ban: boolean;
  status: string;
}

type SearchMode = 'steamid' | 'discord' | 'vdf';

export default function CheckerPage() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<SearchMode>('steamid');
  const [results, setResults] = useState<AccountCheckResult[]>([]);
  const [vdfResults, setVdfResults] = useState<VDFResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchNote, setSearchNote] = useState('');
  const [vdfFile, setVdfFile] = useState<File | null>(null);
  const [vdfCount, setVdfCount] = useState(0);
  const [vdfBannedCount, setVdfBannedCount] = useState(0);

  const handleCheck = useCallback(async () => {
    const raw = input.trim();
    if (!raw) return;
    setLoading(true);
    setResults([]);
    setVdfResults([]);
    setSearchNote('');

    try {
      if (mode === 'discord') {
        const searchRes = await api.searchByQuery(raw);
        const steamIds: string[] = searchRes.steam_ids || [];
        if (steamIds.length === 0) {
          setSearchNote(`По запросу "${raw}" ничего не найдено в базе`);
          setLoading(false);
          return;
        }
        setSearchNote(`Найдено ${steamIds.length} SteamID по запросу "${raw}"`);
        const checkRes = await api.checkAccounts(steamIds);
        setResults(checkRes.data || []);
      } else {
        const ids = raw.split(/[\n,;\s]+/).map(s => s.trim()).filter(Boolean);
        if (ids.length > 50) {
          setSearchNote('Максимум 50 аккаунтов');
          setLoading(false);
          return;
        }
        const res = await api.checkAccounts(ids);
        setResults(res.data || []);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [input, mode]);

  const handleVDFUpload = useCallback(async () => {
    if (!vdfFile) return;
    setLoading(true);
    setVdfResults([]);
    setResults([]);
    setSearchNote('');

    try {
      const res = await api.checkVDF(vdfFile);
      setVdfResults(res.results || []);
      setVdfCount(res.count || 0);
      setVdfBannedCount(res.banned_count || 0);
      setSearchNote(`Найдено ${res.count} SteamID, ${res.banned_count} забанено`);
    } catch {
      setVdfResults([]);
    } finally {
      setLoading(false);
    }
  }, [vdfFile]);

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'clean': return { label: 'Чист', color: 'text-emerald-400 bg-emerald-400/10', icon: Check };
      case 'banned': return { label: 'Забанен', color: 'text-red-400 bg-red-400/10', icon: ShieldX };
      case 'not_found': return { label: 'Не найден', color: 'text-gray-400 bg-gray-400/10', icon: AlertTriangle };
      default: return { label: status, color: 'text-gray-400 bg-gray-400/10', icon: AlertTriangle };
    }
  };

  return (
    <div className="max-w-[1100px] mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl font-bold text-white">Проверка</h1>
        <p className="text-sm text-gray-500 mt-1">Проверка аккаунтов на баны и статус</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="bg-[#12151e] rounded-xl border border-white/5 p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => setMode('steamid')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${mode === 'steamid' ? 'bg-[#4f7cff] text-white' : 'bg-[#1a1f2e] text-gray-400 border border-white/5 hover:text-white'}`}>
            SteamID
          </button>
          <button onClick={() => setMode('discord')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${mode === 'discord' ? 'bg-[#5865F2] text-white' : 'bg-[#1a1f2e] text-gray-400 border border-white/5 hover:text-white'}`}>
            Discord / Никнейм
          </button>
          <button onClick={() => setMode('vdf')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${mode === 'vdf' ? 'bg-amber-500 text-white' : 'bg-[#1a1f2e] text-gray-400 border border-white/5 hover:text-white'}`}>
            <FileText className="w-4 h-4 inline mr-1" />
            VDF Файл
          </button>
        </div>

        {mode === 'vdf' ? (
          <div className="flex gap-3 items-center">
            <label className="flex-1 flex items-center gap-3 px-4 py-3 bg-[#0c0e14] border border-dashed border-white/10 rounded-xl text-sm text-gray-400 hover:border-amber-500/30 hover:text-gray-300 cursor-pointer transition-all">
              <Upload className="w-5 h-5" />
              {vdfFile ? vdfFile.name : 'Выберите config.vdf файл'}
              <input type="file" accept=".vdf" className="hidden" onChange={e => {
                const f = e.target.files?.[0];
                if (f) setVdfFile(f);
              }} />
            </label>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={handleVDFUpload} disabled={loading || !vdfFile}
              className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-xl transition-all disabled:opacity-50">
              {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Проверить'}
            </motion.button>
          </div>
        ) : (
          <>
            <div className="flex gap-3 mb-3">
              <div className="flex-1 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input type="text"
                  placeholder={mode === 'steamid' ? 'Введите SteamID (через запятую или пробел)...' : 'Введите Discord ID, Discord username или никнейм...'}
                  value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCheck()}
                  className="w-full pl-11 pr-4 py-3 bg-[#0c0e14] border border-white/5 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/30 transition-all" />
              </div>
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                onClick={handleCheck} disabled={loading || !input.trim()}
                className="px-6 py-3 bg-[#4f7cff] hover:bg-[#3d6aff] text-white font-medium rounded-xl transition-all disabled:opacity-50">
                {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Проверить'}
              </motion.button>
            </div>
            <p className="text-xs text-gray-600">
              {mode === 'steamid' ? 'Максимум 50 аккаунтов за раз' : 'Поиск по базе пользователей Discord / Steam'}
            </p>
          </>
        )}
        {searchNote && <p className="text-xs text-blue-400 mt-2">{searchNote}</p>}
      </motion.div>

      <div className="space-y-3">
        <AnimatePresence>
          {mode === 'vdf' ? (
            vdfResults.map((r, i) => {
              const banned = r.fear_banned || r.vac_banned || r.game_bans > 0 || r.community_ban;
              return (
                <motion.div key={r.steamid} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className={`bg-[#12151e] rounded-xl border p-4 ${banned ? 'border-red-500/20' : 'border-white/5'}`}>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-[#1e2333] rounded-xl flex items-center justify-center">
                      {banned ? <ShieldX className="w-5 h-5 text-red-400" /> : <Check className="w-5 h-5 text-green-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{r.nickname || r.steamid}</p>
                      <p className="text-xs text-gray-500 font-mono">{r.steamid}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {r.fear_banned && <span className="px-2 py-0.5 bg-red-500/10 border border-red-500/20 rounded text-[11px] text-red-400">Fear: {r.fear_reason || 'Обход'}</span>}
                      {r.vac_banned && <span className="px-2 py-0.5 bg-red-500/10 border border-red-500/20 rounded text-[11px] text-red-400">VAC</span>}
                      {r.game_bans > 0 && <span className="px-2 py-0.5 bg-orange-500/10 border border-orange-500/20 rounded text-[11px] text-orange-400">Game Ban</span>}
                      {r.community_ban && <span className="px-2 py-0.5 bg-yellow-500/10 border border-yellow-500/20 rounded text-[11px] text-yellow-400">Community</span>}
                    </div>
                    <div className="flex gap-2">
                      <a href={`https://fearproject.ru/profile/${r.steamid}`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-[#4f7cff] hover:bg-[#3d6aff] text-white rounded-lg text-xs font-medium transition-all">
                        <ExternalLink className="w-3 h-3" />Fear
                      </a>
                      <a href={`https://steamcommunity.com/profiles/${r.steamid}`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-[#1b2838] hover:bg-[#1e2f42] border border-[#2a475e]/50 text-[#66c0f4] rounded-lg text-xs font-medium transition-all">
                        <ExternalLink className="w-3 h-3" />Steam
                      </a>
                    </div>
                  </div>
                </motion.div>
              );
            })
          ) : (
            results.map((r, i) => {
              const statusInfo = getStatusInfo(r.status);
              const StatusIcon = statusInfo.icon;
              return (
                <motion.div key={r.steam_id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                  className="bg-[#12151e] rounded-xl border border-white/5 p-4">
                  <div className="flex items-center gap-4">
                    {r.avatar ? (
                      <img src={r.avatar} alt={r.name} className="w-12 h-12 rounded-xl object-cover ring-1 ring-white/10" />
                    ) : (
                      <div className="w-12 h-12 bg-[#1e2333] rounded-xl flex items-center justify-center">
                        <Users className="w-5 h-5 text-gray-500" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{r.name || 'Unknown'}</p>
                      <p className="text-xs text-gray-500 font-mono">{r.steam_id}</p>
                    </div>
                    <span className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium ${statusInfo.color}`}>
                      <StatusIcon className="w-3.5 h-3.5" />{statusInfo.label}
                    </span>
                  </div>
                  {r.status === 'banned' && (
                    <div className="mt-3 p-3 bg-red-500/5 border border-red-500/10 rounded-lg">
                      <p className="text-sm text-red-400">
                        {r.ban_type}: {r.ban_reason || 'Без причины'}
                        {r.ban_days_ago != null && ` (${r.ban_days_ago} дней назад)`}
                      </p>
                      {r.ban_date && <p className="text-xs text-gray-500 mt-1">{r.ban_date}</p>}
                    </div>
                  )}
                  {r.fear_status && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-gray-500">FEAR:</span>
                      <span className="text-xs text-blue-400">{r.fear_status}</span>
                    </div>
                  )}
                  <div className="mt-3 flex gap-2">
                    <a href={`https://steamcommunity.com/profiles/${r.steam_id}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1b2838] hover:bg-[#1e2f42] border border-[#2a475e]/50 text-[#66c0f4] rounded-lg text-xs font-medium transition-all">
                      <ExternalLink className="w-3 h-3" />Steam
                    </a>
                    <a href={`https://fearproject.ru/profile/${r.steam_id}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#4f7cff] hover:bg-[#3d6aff] text-white rounded-lg text-xs font-medium transition-all">
                      <ExternalLink className="w-3 h-3" />FEAR
                    </a>
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>

        {results.length === 0 && vdfResults.length === 0 && !loading && (
          <div className="text-center py-12">
            <Search className="w-8 h-8 text-gray-600 mx-auto mb-2" />
            <p className="text-gray-500">
              {mode === 'steamid' ? 'Введите SteamID для проверки' : mode === 'discord' ? 'Введите Discord ID, username или никнейм для поиска' : 'Загрузите config.vdf файл для проверки'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
