import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Server, ExternalLink, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../services/api';

interface BanSourceDetail {
  reason: string;
  unban_date?: string;
}

interface BannedDetail {
  steam_id: string;
  name: string;
  bans: string;
  fear_ban?: BanSourceDetail;
  vac_ban: boolean;
  game_bans: number;
  yooma_ban?: BanSourceDetail;
}

interface Evader {
  steam_id: string;
  name: string;
  avatar?: string;
  check_id: number;
  filename: string;
  banned_steam_id: string;
  ban_reason: string;
  banned_count: number;
  banned_details: BannedDetail[];
  server_name: string;
  server_ip: string;
  server_port: string;
  detected_at: string;
}

export default function EvadersPage() {
  const [evaders, setEvaders] = useState<Evader[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedEvader, setExpandedEvader] = useState<string | null>(null);

  useEffect(() => {
    api.getEvaders()
      .then((res) => setEvaders(res.data || []))
      .catch(() => setError('Не удалось загрузить список обходников'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="max-w-[1100px] mx-auto flex flex-col items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-4" />
        <p className="text-gray-500">Загрузка...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-[1100px] mx-auto">
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl font-bold text-white">Обходники</h1>
        <p className="text-sm text-gray-500 mt-1">
          Игроки, у которых в конфиге есть забаненный аккаунт, а сейчас они играют с другого аккаунта
        </p>
      </motion.div>

      {evaders.length === 0 ? (
        <div className="bg-[#12151e] rounded-xl border border-white/5 p-8 text-center">
          <AlertTriangle className="w-8 h-8 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500">Обходников не найдено</p>
        </div>
      ) : (
        <div className="space-y-3">
          {evaders.map((evader, index) => {
            const key = `${evader.steam_id}-${evader.check_id}`;
            const isExpanded = expandedEvader === key;
            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-[#12151e] rounded-xl border border-white/5 p-4"
              >
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                  <div className="flex items-center gap-4 flex-1">
                    <div className="w-12 h-12 bg-[#1e2333] rounded-xl flex items-center justify-center">
                      <AlertTriangle className="w-5 h-5 text-red-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{evader.name || 'Unknown'}</p>
                      <p className="text-xs text-gray-500 font-mono">{evader.steam_id}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Server className="w-3.5 h-3.5" />
                    <span>{evader.server_name} ({evader.server_ip}:{evader.server_port})</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <a
                      href={`https://fearproject.ru/profile/${evader.steam_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#4f7cff] hover:bg-[#3d6aff] text-white rounded-lg text-xs font-medium transition-all"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Fear
                    </a>
                    <a
                      href={`https://steamcommunity.com/profiles/${evader.steam_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1b2838] hover:bg-[#1e2f42] border border-[#2a475e]/50 text-[#66c0f4] rounded-lg text-xs font-medium transition-all"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Steam
                    </a>
                    {evader.banned_details && evader.banned_details.length > 0 && (
                      <button
                        onClick={() => setExpandedEvader(isExpanded ? null : key)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-[#1a1f2e] border border-white/5 hover:border-white/10 text-gray-400 hover:text-white rounded-lg text-xs font-medium transition-all"
                      >
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        {evader.banned_details.length}
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && evader.banned_details && evader.banned_details.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-3 pt-3 border-t border-white/5 space-y-2"
                  >
                    <p className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold">
                      Забаненные аккаунты ({evader.banned_details.length}):
                    </p>
                    {evader.banned_details.map((bd, di) => (
                      <div key={di} className="px-3 py-2 bg-[#0c0e14] rounded-lg border border-white/5">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs text-white font-medium">{bd.name || 'Unknown'}</span>
                          <span className="text-xs text-gray-500 font-mono">{bd.steam_id}</span>
                          <a
                            href={`https://fearproject.ru/profile/${bd.steam_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-600 hover:text-blue-400 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                          <a
                            href={`https://steamcommunity.com/profiles/${bd.steam_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-600 hover:text-blue-400 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {bd.fear_ban && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#4f7cff]/10 border border-[#4f7cff]/20 rounded text-[11px] text-[#7aa2ff]">
                              Fear: {bd.fear_ban.reason}
                              {bd.fear_ban.unban_date && (
                                <span className="text-[#5a86d8] ml-1">до {bd.fear_ban.unban_date}</span>
                              )}
                            </span>
                          )}
                          {bd.vac_ban && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-500/10 border border-red-500/20 rounded text-[11px] text-red-400">
                              VAC Ban
                            </span>
                          )}
                          {bd.game_bans > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-500/10 border border-orange-500/20 rounded text-[11px] text-orange-400">
                              Game Ban (x{bd.game_bans})
                            </span>
                          )}
                          {bd.yooma_ban && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-500/10 border border-purple-500/20 rounded text-[11px] text-purple-400">
                              Yooma: {bd.yooma_ban.reason}
                              {bd.yooma_ban.unban_date && (
                                <span className="text-purple-400/70 ml-1">{bd.yooma_ban.unban_date}</span>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
