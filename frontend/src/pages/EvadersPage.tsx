import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Server, ShieldX, ExternalLink, Loader2 } from 'lucide-react';
import { api } from '../services/api';

interface BannedDetail {
  steam_id: string;
  name: string;
  bans: string;
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
          {evaders.map((evader, index) => (
            <motion.div
              key={`${evader.steam_id}-${evader.check_id}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="bg-[#12151e] rounded-xl border border-white/5 p-4"
            >
              <div className="flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex items-center gap-4 flex-1">
                  {evader.avatar ? (
                    <img
                      src={evader.avatar}
                      alt={evader.name}
                      className="w-12 h-12 rounded-xl object-cover ring-1 ring-white/10"
                    />
                  ) : (
                    <div className="w-12 h-12 bg-[#1e2333] rounded-xl flex items-center justify-center">
                      <AlertTriangle className="w-5 h-5 text-red-400" />
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium text-white">{evader.name || 'Unknown'}</p>
                    <p className="text-xs text-gray-500 font-mono">{evader.steam_id}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <Server className="w-3.5 h-3.5" />
                  <span>
                    {evader.server_name} ({evader.server_ip}:{evader.server_port})
                  </span>
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
                </div>
              </div>

              {evader.banned_details && evader.banned_details.length > 0 && (
                <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
                  <p className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold">
                    Забаненные аккаунты ({evader.banned_details.length}):
                  </p>
                  {evader.banned_details.map((bd, di) => (
                    <div key={di} className="flex items-center gap-2 px-3 py-2 bg-[#0c0e14] rounded-lg border border-white/5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 font-mono">{bd.steam_id}</span>
                          <a
                            href={`https://fearproject.ru/profile/${bd.steam_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-600 hover:text-blue-400 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        <p className="text-xs text-red-400 mt-0.5">{bd.bans}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
