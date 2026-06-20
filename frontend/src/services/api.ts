const isDefaultOrPlaceholder = (val?: string) =>
  !val || val.includes('localhost') || val.includes('api.example.com');

const PROD_API_URL = 'https://gggggggggggfffffffffffffffff-production.up.railway.app';

const API_BASE = (() => {
  const env = import.meta.env.VITE_API_URL as string | undefined;
  if (typeof window !== 'undefined' && window.location.hostname === 'fearsearchstaff.vercel.app') {
    if (isDefaultOrPlaceholder(env)) return PROD_API_URL;
  }
  return env || 'http://localhost:8080';
})();

class ApiService {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  private async request(path: string, options: RequestInit = {}) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    if (res.status === 401) {
      this.token = null;
      localStorage.removeItem('token');
      window.location.href = '/';
      throw new Error('Unauthorized');
    }

    if (res.status === 403) {
      const text = await res.json().catch(() => ({}));
      throw new Error(text.message || 'Доступ запрещён');
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API Error ${res.status}: ${text}`);
    }

    return res.json();
  }

  async getLoginUrl() {
    const res = await this.request('/api/auth/login');
    return res.url as string;
  }

  async getMe() {
    return this.request('/api/auth/me');
  }

  async getStaff() {
    return this.request('/api/staff');
  }

  async getStaffByGroup(group: string) {
    return this.request(`/api/staff/group?group=${group}`);
  }

  async getRoles() {
    return this.request('/api/roles');
  }

  async getDashboardStats() {
    return this.request('/api/dashboard/stats');
  }

  async getServers() {
    return this.request('/api/servers');
  }

  async getLeaderboard() {
    return this.request('/api/leaderboard');
  }

  async getProfile(steamId: string) {
    return this.request(`/api/profile/${steamId}`);
  }

  async getSkinchanger(steamId: string) {
    return this.request(`/api/skinchanger/${steamId}`);
  }

  async getPunishments(params?: { page?: number; limit?: number; type?: number; status?: number; search?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.type !== undefined) searchParams.set('type', String(params.type));
    if (params?.status !== undefined) searchParams.set('status', String(params.status));
    if (params?.search) searchParams.set('search', params.search);
    const qs = searchParams.toString();
    return this.request(`/api/punishments${qs ? '?' + qs : ''}`);
  }

  async getPunishmentsByAdmin(adminSteamId: string) {
    return this.request(`/api/punishments/admin?admin_steamid=${adminSteamId}`);
  }

  async getAllPunishments(params?: { page?: number; type?: string; status?: string; search?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.type) searchParams.set('type', params.type);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.search) searchParams.set('search', params.search);
    const qs = searchParams.toString();
    return this.request(`/api/punishments/all${qs ? '?' + qs : ''}`);
  }

  async getStaffStats(steamids: string[]) {
    return this.request(`/api/punishments/staff-stats?steamids=${steamids.join(',')}`);
  }

  async checkBan(steamId: string) {
    return this.request(`/api/bans/check/${steamId}`);
  }

  async getYoomaBans(steamId: string) {
    return this.request(`/api/yooma/bans/${steamId}`);
  }

  async getSteamSummary(steamId: string) {
    return this.request(`/api/steam/summary/${steamId}`);
  }

  async getSteamBans(steamId: string) {
    return this.request(`/api/steam/bans/${steamId}`);
  }

  async getSteamFriends(steamId: string) {
    return this.request(`/api/steam/friends/${steamId}`);
  }

  async getSteamLevel(steamId: string) {
    return this.request(`/api/steam/level/${steamId}`);
  }

  async checkAccounts(steamIds: string[]) {
    return this.request('/api/check', {
      method: 'POST',
      body: JSON.stringify({ steam_ids: steamIds }),
    });
  }

  async getEvaders() {
    return this.request('/api/evaders');
  }

  async getVDFHistory() {
    return this.request('/api/vdf-history');
  }

  async getAdminUsers() {
    return this.request('/api/admin/users');
  }

  async updateUserLevel(discordId: string, level: number, group: string) {
    return this.request('/api/admin/user/level', {
      method: 'POST',
      body: JSON.stringify({ discord_id: discordId, level, group }),
    });
  }

  async blockUser(discordId: string) {
    return this.request('/api/admin/user/block', {
      method: 'POST',
      body: JSON.stringify({ discord_id: discordId }),
    });
  }

  async getWhitelist() {
    return this.request('/api/whitelist');
  }

  async addToWhitelist(steamId: string, name: string) {
    return this.request('/api/whitelist/add', {
      method: 'POST',
      body: JSON.stringify({ steam_id: steamId, name }),
    });
  }

  async deleteFromWhitelist(id: string) {
    return this.request('/api/whitelist/delete', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
  }

  async getHealth() {
    const res = await fetch(`${API_BASE}/api/health`);
    return res.json();
  }
}

export const api = new ApiService();
