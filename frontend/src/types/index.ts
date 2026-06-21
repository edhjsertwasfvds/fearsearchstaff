export interface User {
  id?: string;
  discord_id: string;
  username: string;
  display_name: string;
  avatar: string;
  email?: string;
  staff_group: string;
  staff_role: string;
  steam_id?: string;
  level: number;
  permissions: string[];
  guild_roles: string[];
  created_at?: string;
  updated_at?: string;
  last_login?: string;
}

export interface StaffMember {
  steam_id: string;
  name: string;
  discord_id: string;
  discord_name: string;
  role: string;
  group_name: string;
  level: number;
  updated_at: string;
}

export interface Role {
  key: string;
  name: string;
  level: number;
  permissions: string[];
}

export interface DashboardStats {
  total_staff: number;
  staff_by_role: Record<string, number>;
  online_staff?: number;
}

export interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: () => void;
  logout: () => void;
  hasPermission: (perm: string) => boolean;
  hasLevel: (level: number) => boolean;
}

export interface FearAPIServer {
  id: number;
  name: string;
  ip: string;
  port: number;
  map: string;
  players_online: number;
  max_players: number;
  flag?: string;
  region?: string;
  live_data?: {
    players: FearAPIPlayer[];
  };
}

export interface FearAPIPlayer {
  steam_id: string;
  name: string;
  nickname?: string;
  avatar?: string;
  kills: number;
  deaths: number;
  kd: number;
  server?: string;
  server_id?: number;
  flag?: string;
  ping?: number;
  is_online?: boolean;
}

export interface FearProfile {
  steam_id: string;
  name: string;
  nickname?: string;
  avatar_full?: string;
  stats?: {
    kills?: number;
    deaths?: number;
    kd?: number;
    playtime?: number;
    vac_banned?: boolean;
    days_since_last_ban?: number;
    created_at?: string;
  };
  banInfo?: {
    isBanned: boolean;
    reason?: string;
    type?: string;
    date?: string;
  };
  servers?: Array<{
    id: number;
    name: string;
  }>;
  balance?: number;
  position?: number;
  value?: number;
  rank_name?: string;
}

export interface Punishment {
  id: number;
  admin_steamid: string;
  steamid: string;
  reason: string;
  type: number;
  status: number;
  time: string;
  server_id: number;
  admin_name?: string;
  duration?: number;
  created?: number;
  name?: string;
}

export interface AdminUser {
  discord_id: string;
  username: string;
  display_name: string;
  avatar: string;
  staff_group: string;
  staff_role: string;
  level: number;
  is_blocked: boolean;
  last_login: string;
  guild_roles: string[];
}

export interface SteamSummary {
  steamid: string;
  communityvisibilitystate: number;
  profilestate: number;
  personaname: string;
  profileurl: string;
  avatar: string;
  avatarmedium: string;
  avatarfull: string;
  lastlogoff: number;
  personastate: number;
  primaryclanid: string;
  timecreated: number;
  loccountrycode?: string;
  locstatecode?: string;
  loccityid?: number;
}

export interface SteamBan {
  steamId: string;
  communityBanned: boolean;
  vacBanned: boolean;
  numberofVACBans: number;
  daysSinceLastVACBan: number;
  numberofGameBans: number;
  economyBan: string;
}

export interface StaffStats {
  steamid: string;
  name: string;
  total_bans: number;
  total_mutes: number;
  total: number;
  active_bans: number;
  active_mutes: number;
  active_total: number;
  removed_bans: number;
  removed_mutes: number;
  removed_total: number;
}

export interface AccountResult {
  steam_id: string;
  name: string;
  avatar: string;
  status: string;
  ban_type?: string;
  ban_reason?: string;
  ban_days_ago?: number;
  ban_date?: string;
  fear_banned: boolean;
  fear_reason?: string;
  fear_unban_time?: string;
  vac_banned: boolean;
  vac_days_ago?: number;
  game_bans?: number;
  yooma_banned: boolean;
  yooma_reason?: string;
  fear_url?: string;
  steam_url?: string;
  yooma_url?: string;
}
