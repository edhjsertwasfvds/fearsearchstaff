import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Search, Filter, ChevronDown, ExternalLink, Shield, Ban, VolumeX, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { api } from '../services/api';
import type { StaffMember } from '../types';

const roleColors: Record<string, string> = {
  OWNER: 'from-red-500 to-red-600',
  GLADMIN: 'from-orange-500 to-orange-600',
  STADMIN: 'from-yellow-500 to-yellow-600',
  ADMIN: 'from-amber-500 to-amber-600',
  ADMIN_PLUS: 'from-amber-500 to-amber-600',
  STMODER: 'from-emerald-500 to-emerald-600',
  MODER: 'from-blue-500 to-blue-600',
  MLMODER: 'from-cyan-500 to-cyan-600',
  CURATOR: 'from-purple-500 to-purple-600',
};

const roleBadgeColors: Record<string, string> = {
  OWNER: 'bg-red-500/20 text-red-400 border-red-500/30',
  GLADMIN: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  STADMIN: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  ADMIN: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  ADMIN_PLUS: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  STMODER: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  MODER: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  MLMODER: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  CURATOR: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

const roleNames: Record<string, string> = {
  OWNER: 'Владелец',
  GLADMIN: 'Гл. Администратор',
  STADMIN: 'Ст. Администратор',
  ADMIN: 'Администратор',
  ADMIN_PLUS: 'Администратор+',
  STMODER: 'Ст. Модератор',
  MODER: 'Модератор',
  MLMODER: 'Мл. Модератор',
  CURATOR: 'Куратор',
};

const groups = ['ALL', 'OWNER', 'GLADMIN', 'STADMIN', 'ADMIN', 'STMODER', 'MODER', 'MLMODER', 'CURATOR'];

interface StaffStatsMap {
  [steamid: string]: {
    total_bans: number;
    total_mutes: number;
  };
}

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterGroup, setFilterGroup] = useState('ALL');
  const [showFilter, setShowFilter] = useState(false);
  const [statsMap, setStatsMap] = useState<StaffStatsMap>({});
  const [monthCompare, setMonthCompare] = useState<{ current: { bans: number; mutes: number; total: number }; previous: { bans: number; mutes: number; total: number } } | null>(null);

  useEffect(() => {
    api.getStaff()
      .then((res) => {
        const data = res.data || [];
        setStaff(data);
        const steamids = data.map((m: StaffMember) => m.steam_id).filter(Boolean);
        if (steamids.length > 0) {
          api.getStaffStats(steamids)
            .then((stats: any) => setStatsMap(stats))
            .catch(() => {});
        }
      })
      .catch(() => setStaff([]))
      .finally(() => setLoading(false));

    api.getPunishmentsMonthCompare()
      .then((data) => setMonthCompare(data))
      .catch(() => {});
  }, []);

  const filtered = staff.filter((m) => {
    const matchesSearch = !search ||
      m.name?.toLowerCase().includes(search.toLowerCase()) ||
      m.discord_name?.toLowerCase().includes(search.toLowerCase()) ||
      m.steam_id?.includes(search);
    const matchesGroup = filterGroup === 'ALL' || m.group_name === filterGroup;
    return matchesSearch && matchesGroup;
  });

  const groupedStaff = groups.reduce((acc, group) => {
    if (group === 'ALL') return acc;
    const members = filtered.filter(m => m.group_name === group);
    if (members.length > 0) acc[group] = members;
    return acc;
  }, {} as Record<string, StaffMember[]>);

  const totalStats = useMemo(() => {
    let totalBans = 0, totalMutes = 0;
    Object.values(statsMap).forEach((s) => {
      totalBans += s.total_bans || 0;
      totalMutes += s.total_mutes || 0;
    });
    return { bans: totalBans, mutes: totalMutes, total: totalBans + totalMutes };
  }, [statsMap]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-12 h-12 border-4 border-accent-blue/30 border-t-accent-blue rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Users className="w-8 h-8 text-accent-blue" />
            Staff Members
          </h1>
          <p className="text-gray-400 mt-1">
            {filtered.length} members {filterGroup !== 'ALL' ? `in ${roleNames[filterGroup]}` : 'total'}
          </p>
        </div>
      </motion.div>

      {/* Summary Stats */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
      >
        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-600/20 flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Staff</p>
              <p className="text-xl font-bold text-white">{staff.length}</p>
            </div>
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500/20 to-red-600/20 flex items-center justify-center">
              <Ban className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Bans</p>
              <p className="text-xl font-bold text-white">{totalStats.bans}</p>
            </div>
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500/20 to-yellow-600/20 flex items-center justify-center">
              <VolumeX className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Mutes</p>
              <p className="text-xl font-bold text-white">{totalStats.mutes}</p>
            </div>
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500/20 to-green-600/20 flex items-center justify-center">
              {monthCompare && (monthCompare.current.total >= monthCompare.previous.total)
                ? <ArrowUpRight className="w-5 h-5 text-green-400" />
                : <ArrowDownRight className="w-5 h-5 text-red-400" />
              }
            </div>
            <div>
              <p className="text-sm text-gray-400">This Month</p>
              <p className="text-xl font-bold text-white">{monthCompare?.current?.total || 0}</p>
              {monthCompare && (
                <p className={`text-xs ${monthCompare.current.total >= monthCompare.previous.total ? 'text-green-400' : 'text-red-400'}`}>
                  {monthCompare.current.total >= monthCompare.previous.total ? '+' : ''}
                  {monthCompare.current.total - monthCompare.previous.total} vs last month
                </p>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
          <input type="text" placeholder="Search by name, Discord, or SteamID..." value={search} onChange={(e) => setSearch(e.target.value)} className="input-field pl-12" />
        </div>
        <div className="relative">
          <button onClick={() => setShowFilter(!showFilter)} className="flex items-center gap-2 px-4 py-3 glass-card hover:border-accent-blue/30 transition-all">
            <Filter className="w-5 h-5 text-gray-400" />
            <span className="text-sm text-gray-300">{filterGroup === 'ALL' ? 'All Roles' : roleNames[filterGroup]}</span>
            <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${showFilter ? 'rotate-180' : ''}`} />
          </button>
          <AnimatePresence>
            {showFilter && (
              <motion.div initial={{ opacity: 0, y: -10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.95 }}
                className="absolute right-0 top-full mt-2 w-56 glass-card p-2 z-20"
              >
                {groups.map((g) => (
                  <button key={g} onClick={() => { setFilterGroup(g); setShowFilter(false); }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${filterGroup === g ? 'bg-accent-blue/10 text-accent-blue' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                  >
                    {g === 'ALL' ? 'All Roles' : (
                      <span className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full bg-gradient-to-r ${roleColors[g] || 'from-gray-500 to-gray-600'}`} />
                        {roleNames[g] || g}
                      </span>
                    )}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {filterGroup !== 'ALL' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((member, i) => (
            <StaffCard key={member.steam_id} member={member} index={i} stats={statsMap[member.steam_id]} />
          ))}
        </div>
      ) : (
        Object.entries(groupedStaff).map(([group, members]) => (
          <motion.div key={group} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full bg-gradient-to-r ${roleColors[group] || 'from-gray-500 to-gray-600'}`} />
              <h2 className="text-xl font-bold text-white">{roleNames[group] || group}</h2>
              <span className="text-sm text-gray-500">({members.length})</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {members.map((member, i) => (
                <StaffCard key={member.steam_id} member={member} index={i} stats={statsMap[member.steam_id]} />
              ))}
            </div>
          </motion.div>
        ))
      )}

      {filtered.length === 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12">
          <Shield className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">No staff members found</p>
        </motion.div>
      )}
    </div>
  );
}

function StaffCard({ member, index, stats }: { member: StaffMember; index: number; stats?: { total_bans: number; total_mutes: number } }) {
  const [expanded, setExpanded] = useState(false);
  const bans = stats?.total_bans || 0;
  const mutes = stats?.total_mutes || 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      whileHover={{ y: -2 }}
      className="glass-card-hover p-5 cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center gap-4">
        <div className={`w-14 h-14 bg-gradient-to-br ${roleColors[member.group_name] || 'from-gray-500 to-gray-600'} rounded-2xl flex items-center justify-center shadow-lg`}>
          <span className="text-white font-bold text-xl">{member.name?.charAt(0)?.toUpperCase() || '?'}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-white truncate">{member.name}</h3>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${roleBadgeColors[member.group_name] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
              {member.role}
            </span>
          </div>
          <p className="text-sm text-gray-400 truncate">@{member.discord_name}</p>
          {(bans > 0 || mutes > 0) && (
            <div className="flex items-center gap-3 mt-1">
              {bans > 0 && (
                <span className="flex items-center gap-1 text-xs text-red-400">
                  <Ban className="w-3 h-3" />
                  {bans}
                </span>
              )}
              {mutes > 0 && (
                <span className="flex items-center gap-1 text-xs text-yellow-400">
                  <VolumeX className="w-3 h-3" />
                  {mutes}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-white">LVL {member.level}</p>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="pt-4 mt-4 border-t border-white/5 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">SteamID</span>
                <span className="text-gray-300 font-mono">{member.steam_id}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Discord ID</span>
                <span className="text-gray-300 font-mono">{member.discord_id}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Last Updated</span>
                <span className="text-gray-300">{member.updated_at ? new Date(member.updated_at).toLocaleDateString('ru-RU') : '—'}</span>
              </div>
              {(bans > 0 || mutes > 0) && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Punishments</span>
                  <span className="text-gray-300">
                    <span className="text-red-400">{bans} bans</span>
                    <span className="text-gray-600 mx-1">/</span>
                    <span className="text-yellow-400">{mutes} mutes</span>
                  </span>
                </div>
              )}
              <div className="flex gap-2 mt-3">
                {member.steam_id && (
                  <a href={`https://steamcommunity.com/profiles/${member.steam_id}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 px-3 py-1.5 bg-dark-600 hover:bg-dark-500 rounded-lg text-xs text-gray-300 transition-all">
                    <ExternalLink className="w-3 h-3" /> Steam
                  </a>
                )}
                <a href={`https://fearproject.ru/profile/${member.steam_id}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 px-3 py-1.5 bg-dark-600 hover:bg-dark-500 rounded-lg text-xs text-gray-300 transition-all">
                  <ExternalLink className="w-3 h-3" /> FearProject
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
