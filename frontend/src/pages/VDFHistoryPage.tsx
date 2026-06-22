import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Download, ExternalLink, Loader2, Calendar, AlertCircle, ChevronDown, ChevronUp, ShieldX, Check, RefreshCw } from 'lucide-react';
import { api } from '../services/api';

interface VDFHistoryItem {
  steamid: string;
  nickname: string;
  avatar?: string;
  fear_banned: boolean;
  fear_reason: string;
  fear_unban_time: string;
  vac_banned: boolean;
  vac_days_ago: number;
  game_bans: number;
  yooma_banned: boolean;
  yooma_reason: string;
  admin_group: string;
}

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
  results: VDFHistoryItem[];
}

export default function VDFHistoryPage() {
  const [checks, setChecks] = useState<VDFCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [recheckingId, setRecheckingId] = useState<number | null>(null);
  const [recheckStatus, setRecheckStatus] = useState<Record<number, string>>({});

  useEffect(() => {
    const load = () => {
      api.getVDFHistory()
        .then((res) => setChecks(res.data || []))
        .catch(() => setError('Не удалось загрузить историю VDF-проверок'))
        .finally(() => setLoading(false));
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
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

  const isAccountBanned = (r: VDFHistoryItem) => {
    return r.fear_banned || r.vac_banned || r.game_bans > 0 || r.yooma_banned;
  };

  const handleRecheck = async (check: VDFCheck) => {
    if (recheckingId === check.id) return;
    setRecheckingId(check.id);
    setRecheckStatus(prev => ({ ...prev, [check.id]: 'pending' }));
    try {
      const res = await api.requestVDFRecheck(check.id, check.steamids);
      const recheckId = res.recheck_id;
      setRecheckStatus(prev => ({ ...prev, [check.id]: 'processing' }));
      const poll = setInterval(async () => {
        try {
          const result = await api.getVDFRecheckResult(recheckId);
          if (result.status === 'done') {
            setRecheckStatus(prev => ({ ...prev, [check.id]: 'done' }));
            setRecheckingId(null);
            clearInterval(poll);
            api.getVDFHistory().then((res) => setChecks(res.data || []));
          } else if (result.status === 'error') {
            setRecheckStatus(prev => ({ ...prev, [check.id]: 'error: ' + (result.error || 'unknown') }));
            setRecheckingId(null);
            clearInterval(poll);
          }
        } catch {
          setRecheckStatus(prev => ({ ...prev, [check.id]: 'error polling' }));
          setRecheckingId(null);
          clearInterval(poll);
        }
      }, 5000);
      setTimeout(() => { clearInterval(poll); setRecheckingId(null); }, 120000);
    } catch (e: any) {
      setRecheckStatus(prev => ({ ...prev, [check.id]: 'error: ' + (e.message || 'failed') }));
      setRecheckingId(null);
    }
  };

  const getBanSources = (r: VDFHistoryItem) => {
    const sources: { source: string; reason: string; duration: string; until: string }[] = [];

    if (r.fear_banned) {
      sources.push({
        source: 'Fear',
        reason: r.fear_reason || 'Обход',
        duration: r.fear_unban_time ? `до ${r.fear_unban_time}` : 'Навсегда',
        until: r.fear_unban_time || 'Навсегда',
      });
    }
    if (r.vac_banned) {
      sources.push({
        source: 'VAC',
        reason: 'VAC Ban',
        duration: r.vac_days_ago ? `${r.vac_days_ago} дн. назад` : 'Навсегда',
        until: 'Навсегда',
      });
    }
    if (r.game_bans > 0) {
      sources.push({
        source: 'Game',
        reason: `Game Ban (×${r.game_bans})`,
        duration: 'Навсегда',
        until: 'Навсегда',
      });
    }
    if (r.yooma_banned) {
      sources.push({
        source: 'Yooma',
        reason: r.yooma_reason || 'Yooma Ban',
        duration: 'Навсегда',
        until: 'Навсегда',
      });
    }
    return sources;
  };

  return (
    <div className="max-w-[1100px] mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl font-bold text-white">История VDF-проверок</h1>
        <p className="text-sm text-gray-500 mt-1">
          Архив загруженных config.vdf с SteamID и статусами банов
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
                        <div className="flex items-center justify-between mt-3 mb-2">
                          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
                            Аккаунты ({check.results.length}):
                          </p>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRecheck(check); }}
                            disabled={recheckingId === check.id}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all ${
                              recheckingId === check.id
                                ? 'bg-yellow-500/10 text-yellow-400 cursor-wait'
                                : recheckStatus[check.id] === 'done'
                                ? 'bg-green-500/10 text-green-400'
                                : 'bg-[#1e2333] hover:bg-[#262c3f] text-gray-300'
                            }`}
                          >
                            {recheckingId === check.id ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin" />
                                {recheckStatus[check.id] || 'Проверка...'}
                              </>
                            ) : recheckStatus[check.id] === 'done' ? (
                              <>
                                <Check className="w-3 h-3" />
                                Готово
                              </>
                            ) : (
                              <>
                                <RefreshCw className="w-3 h-3" />
                                Перепроверить
                              </>
                            )}
                          </button>
                        </div>
                        {check.results.length > 0 ? (
                          <div className="space-y-1.5">
                            {check.results.map((r, ri) => {
                              const banned = isAccountBanned(r);
                              const banSources = getBanSources(r);
                              return (
                                <div
                                  key={ri}
                                  className={`px-3 py-2.5 rounded-lg border ${banned ? 'bg-red-500/5 border-red-500/10' : 'bg-[#0c0e14] border-white/5'}`}
                                >
                                  <div className="flex items-center gap-2 mb-1.5">
                                    {r.avatar ? (
                                      <img src={r.avatar} alt="" className="w-7 h-7 rounded-lg object-cover ring-1 ring-white/10 flex-shrink-0" />
                                    ) : banned ? (
                                      <ShieldX className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                                    ) : (
                                      <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                                    )}
                                    <span className="text-xs font-medium text-white">{r.nickname || 'Unknown'}</span>
                                    <span className={`text-xs font-mono ${banned ? 'text-red-400' : 'text-gray-400'}`}>{r.steamid}</span>
                                    <a
                                      href={`https://fearproject.ru/profile/${r.steamid}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-gray-600 hover:text-blue-400 transition-colors flex-shrink-0"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                    <a
                                      href={`https://steamcommunity.com/profiles/${r.steamid}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-gray-600 hover:text-blue-400 transition-colors flex-shrink-0"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  </div>

                                  {banned && banSources.length > 0 ? (
                                    <div className="space-y-1 ml-5">
                                      {banSources.map((bs, bsi) => (
                                        <div key={bsi} className="flex items-center gap-3 text-[11px]">
                                          <span className={`px-1.5 py-0.5 rounded font-bold ${
                                            bs.source === 'Fear' ? 'bg-[#4f7cff]/10 text-[#7aa2ff]' :
                                            bs.source === 'VAC' ? 'bg-red-500/10 text-red-400' :
                                            bs.source === 'Game' ? 'bg-orange-500/10 text-orange-400' :
                                            'bg-purple-500/10 text-purple-400'
                                          }`}>
                                            {bs.source}
                                          </span>
                                          <span className="text-gray-400">Причина: <span className="text-white">{bs.reason}</span></span>
                                          <span className="text-gray-400">Срок: <span className="text-red-400">{bs.duration}</span></span>
                                          {bs.until !== 'Навсегда' && (
                                            <span className="text-gray-400">До: <span className="text-yellow-400">{bs.until}</span></span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-[11px] text-green-400/60 ml-5">чисто</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-600">Данные результатов не сохранены</p>
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
