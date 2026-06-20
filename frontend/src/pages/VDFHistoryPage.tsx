import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FileText, Download, ExternalLink, Loader2, Calendar, AlertCircle } from 'lucide-react';
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
        <div className="bg-[#12151e] rounded-xl border border-white/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#1a1f2e] text-gray-400 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">#</th>
                  <th className="px-4 py-3 text-left font-medium">Файл</th>
                  <th className="px-4 py-3 text-left font-medium">Время</th>
                  <th className="px-4 py-3 text-center font-medium">Аккаунтов</th>
                  <th className="px-4 py-3 text-center font-medium">Банов</th>
                  <th className="px-4 py-3 text-left font-medium">Ссылки</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {checks.map((check, index) => (
                  <motion.tr
                    key={check.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                    className="hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-4 py-3 text-white font-mono">#{check.id}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 text-white">
                        <FileText className="w-4 h-4 text-gray-500" />
                        <span className="truncate max-w-[160px]" title={check.filename}>
                          {check.filename}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5 text-xs text-gray-400">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="w-3 h-3" />
                          {formatDate(check.timestamp)}
                        </span>
                        {check.last_recheck && (
                          <span className="text-gray-600">перепроверка: {formatDate(check.last_recheck)}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-300">{check.count}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs ${check.banned_count > 0 ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                        <AlertCircle className="w-3 h-3" />
                        {check.banned_count}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {check.attachment_url && (
                          <a
                            href={check.attachment_url}
                            target="_blank"
                            rel="noopener noreferrer"
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
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-[#4f7cff]/10 hover:bg-[#4f7cff]/20 text-[#4f7cff] rounded-lg text-xs transition-all"
                            title="Открыть сообщение в Discord"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Discord
                          </a>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
