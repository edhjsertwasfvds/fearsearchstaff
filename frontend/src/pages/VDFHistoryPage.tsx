import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Download, ExternalLink, Loader2, Calendar, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../services/api';

interface VDFCheck {
  id: number;
  filename: string;
  timestamp: string;
  last_recheck?: string;
  attachment_url?: string;
  message_url?: string;
  count: number;
  banned_count: number;
  steamids: string[];
}

export default function VDFHistoryPage() {
  const [checks, setChecks] = useState<VDFCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    api.getVDFHistory()
      .then((res) => setChecks(res.data || []))
      .catch(() => setError('Не удалось загрузить историю VDF-проверок'))
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

  const formatDate = (iso: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="max-w-[1100px] mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl font-bold text-white">История VDF-проверок</h1>
        <p className="text-sm text-gray-500 mt-1">
          Архив загруженных config.vdf с SteamID и ссылками на файлы
        </p>
      </motion.div>

      {checks.length === 0 ? (
        <div className="bg-[#12151e] rounded-xl border border-white/5 p-8 text-center">
          <FileText className="w-8 h-8 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500">История проверок пуста</p>
        </div>
      ) : (
        <div className="space-y-2">
          {checks.map((check, index) => {
            const isExpanded = expandedId === check.id;
            return (
              <motion.div
                key={check.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                className="bg-[#12151e] rounded-xl border border-white/5 overflow-hidden"
              >
                <button
                  onClick={() => setExpandedId(isExpanded ? null : check.id)}
                  className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-white/[0.02] transition-colors text-left"
                >
                  <span className="text-sm text-gray-600 font-mono w-10">#{check.id}</span>
                  <div className="flex items-center gap-2 text-white min-w-0 flex-1">
                    <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <span className="truncate text-sm" title={check.filename}>{check.filename}</span>
                  </div>
                  <div className="flex flex-col gap-0.5 text-xs text-gray-400 flex-shrink-0">
                    <span className="flex items-center gap-1.5">
                      <Calendar className="w-3 h-3" />
                      {formatDate(check.timestamp)}
                    </span>
                    {check.last_recheck && (
                      <span className="text-gray-600">перепроверка: {formatDate(check.last_recheck)}</span>
                    )}
                  </div>
                  <span className="text-sm text-gray-300 flex-shrink-0 w-16 text-center">{check.count} акк.</span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs flex-shrink-0 w-16 justify-center ${check.banned_count > 0 ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                    <AlertCircle className="w-3 h-3" />
                    {check.banned_count}
                  </span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {check.attachment_url && (
                      <a
                        href={check.attachment_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-[#1e2333] hover:bg-[#262c3f] text-gray-300 rounded-lg text-xs transition-all"
                        title="Скачать файл"
                      >
                        <Download className="w-3 h-3" />
                        .vdf
                      </a>
                    )}
                    {check.message_url && (
                      <a
                        href={check.message_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-[#4f7cff]/10 hover:bg-[#4f7cff]/20 text-[#4f7cff] rounded-lg text-xs transition-all"
                        title="Discord"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  )}
                </button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-4 border-t border-white/5">
                        <p className="text-xs text-gray-500 uppercase tracking-wider mt-3 mb-2 font-semibold">
                          SteamID из файла ({check.steamids.length}):
                        </p>
                        {check.steamids.length > 0 ? (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                            {check.steamids.map((sid, si) => (
                              <div
                                key={si}
                                className="flex items-center gap-2 px-3 py-2 bg-[#0c0e14] rounded-lg border border-white/5"
                              >
                                <span className="text-xs text-gray-400 font-mono truncate">{sid}</span>
                                <a
                                  href={`https://steamcommunity.com/profiles/${sid}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-gray-600 hover:text-blue-400 transition-colors flex-shrink-0"
                                  title="Steam профиль"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-600">SteamID не сохранены</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
