import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Activity, Search, Filter, ChevronDown, AlertTriangle, Info, XCircle, Clock, RefreshCw } from 'lucide-react';
import { api } from '../services/api';

interface LogEntry {
  id: number;
  service: string;
  level: string;
  message: string;
  data?: any;
  created_at: string;
}

interface LogStats {
  total: number;
  today: number;
  errors_7d: number;
  services: Record<string, number>;
}

const levelColors: Record<string, string> = {
  error: 'bg-red-500/10 text-red-400 border-red-500/20',
  warning: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  info: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  debug: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

const levelIcons: Record<string, typeof AlertTriangle> = {
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
  debug: Activity,
};

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [service, setService] = useState('');
  const [level, setLevel] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [showServiceFilter, setShowServiceFilter] = useState(false);
  const [showLevelFilter, setShowLevelFilter] = useState(false);
  const limit = 50;

  const load = () => {
    api.getLogs({ service, level, search, limit, offset: page * limit })
      .then((res: any) => {
        setLogs(res.logs || []);
        setTotal(res.total || 0);
      })
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  };

  const loadStats = () => {
    api.getLogsStats()
      .then((data: any) => setStats(data))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    loadStats();
    const interval = setInterval(() => { load(); loadStats(); }, 15000);
    return () => clearInterval(interval);
  }, [service, level, search, page]);

  const formatTime = (iso: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  };

  const services = stats?.services ? Object.keys(stats.services) : [];
  const levels = ['error', 'warning', 'info', 'debug'];

  return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Activity className="w-7 h-7 text-accent-blue" />
          Logs
        </h1>
        <p className="text-sm text-gray-500 mt-1">Service logs and activity history</p>
      </motion.div>

      {/* Stats */}
      {stats && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="grid grid-cols-3 gap-4"
        >
          <div className="glass-card p-4 text-center">
            <p className="text-sm text-gray-400">Total</p>
            <p className="text-2xl font-bold text-white">{stats.total.toLocaleString()}</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-sm text-gray-400">Today</p>
            <p className="text-2xl font-bold text-blue-400">{stats.today.toLocaleString()}</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-sm text-gray-400">Errors (7d)</p>
            <p className="text-2xl font-bold text-red-400">{stats.errors_7d.toLocaleString()}</p>
          </div>
        </motion.div>
      )}

      {/* Filters */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="flex gap-3 flex-wrap"
      >
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input type="text" placeholder="Search logs..." value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="input-field pl-10 text-sm"
          />
        </div>
        <div className="relative">
          <button onClick={() => { setShowServiceFilter(!showServiceFilter); setShowLevelFilter(false); }}
            className="flex items-center gap-2 px-3 py-2 glass-card hover:border-accent-blue/30 transition-all text-sm"
          >
            <Filter className="w-4 h-4 text-gray-400" />
            <span className="text-gray-300">{service || 'All Services'}</span>
            <ChevronDown className={`w-3 h-3 text-gray-500 transition-transform ${showServiceFilter ? 'rotate-180' : ''}`} />
          </button>
          {showServiceFilter && (
            <div className="absolute right-0 top-full mt-1 w-48 glass-card p-1 z-20">
              <button onClick={() => { setService(''); setShowServiceFilter(false); setPage(0); }}
                className={`w-full text-left px-3 py-1.5 rounded text-sm ${!service ? 'bg-accent-blue/10 text-accent-blue' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
              >All Services</button>
              {services.map((s) => (
                <button key={s} onClick={() => { setService(s); setShowServiceFilter(false); setPage(0); }}
                  className={`w-full text-left px-3 py-1.5 rounded text-sm ${service === s ? 'bg-accent-blue/10 text-accent-blue' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                >{s} ({stats?.services?.[s] || 0})</button>
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <button onClick={() => { setShowLevelFilter(!showLevelFilter); setShowServiceFilter(false); }}
            className="flex items-center gap-2 px-3 py-2 glass-card hover:border-accent-blue/30 transition-all text-sm"
          >
            <span className="text-gray-300">{level || 'All Levels'}</span>
            <ChevronDown className={`w-3 h-3 text-gray-500 transition-transform ${showLevelFilter ? 'rotate-180' : ''}`} />
          </button>
          {showLevelFilter && (
            <div className="absolute right-0 top-full mt-1 w-36 glass-card p-1 z-20">
              <button onClick={() => { setLevel(''); setShowLevelFilter(false); setPage(0); }}
                className={`w-full text-left px-3 py-1.5 rounded text-sm ${!level ? 'bg-accent-blue/10 text-accent-blue' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
              >All Levels</button>
              {levels.map((l) => (
                <button key={l} onClick={() => { setLevel(l); setShowLevelFilter(false); setPage(0); }}
                  className={`w-full text-left px-3 py-1.5 rounded text-sm ${level === l ? 'bg-accent-blue/10 text-accent-blue' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                >{l}</button>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => { load(); loadStats(); }}
          className="flex items-center gap-2 px-3 py-2 glass-card hover:border-accent-blue/30 transition-all text-sm"
        >
          <RefreshCw className="w-4 h-4 text-gray-400" />
        </button>
      </motion.div>

      {/* Log Table */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-accent-blue/30 border-t-accent-blue rounded-full animate-spin" />
        </div>
      ) : logs.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <Activity className="w-8 h-8 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500">No logs found</p>
        </div>
      ) : (
        <div className="space-y-1">
          {logs.map((log) => {
            const Icon = levelIcons[log.level] || Info;
            return (
              <motion.div key={log.id}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-start gap-3 px-4 py-2.5 bg-[#12151e] rounded-lg border border-white/5 hover:border-white/10 transition-colors"
              >
                <span className="text-xs text-gray-600 font-mono w-16 flex-shrink-0 pt-0.5">{log.id}</span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase border flex-shrink-0 ${levelColors[log.level] || 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
                  <Icon className="w-3 h-3" />
                  {log.level}
                </span>
                <span className="px-2 py-0.5 bg-white/5 rounded text-[10px] text-gray-400 font-mono flex-shrink-0">{log.service}</span>
                <span className="text-sm text-gray-300 flex-1 min-w-0 truncate">{log.message}</span>
                <span className="text-xs text-gray-600 flex-shrink-0 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatTime(log.created_at)}
                </span>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">
            Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
              className="px-3 py-1.5 glass-card text-sm text-gray-300 disabled:opacity-30 hover:border-accent-blue/30 transition-all"
            >Prev</button>
            <button onClick={() => setPage(page + 1)} disabled={(page + 1) * limit >= total}
              className="px-3 py-1.5 glass-card text-sm text-gray-300 disabled:opacity-30 hover:border-accent-blue/30 transition-all"
            >Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
