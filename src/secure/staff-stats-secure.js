// Приватный модуль для расчёта статистики/выплат стаффа.
// Должен раздаваться сервером только для пользователей level >= 4 (новая таблица и выплаты).
//
// СТАРАЯ — punishmentsInPeriodForOldTable + computeStaffStatsRowsOld: только дата.
//   Все строки API в периоде: любые статусы (в т.ч. снятый/разбан), любые причины.
// НОВАЯ — punishmentsInPeriodForNewTable + computeStaffStatsRowsSecure: дата + newTablePunishmentIncluded
//   (только активные 1 и истёкшие 4; без «напиши тикет в дс» и аналогов). Ветки не смешивать.
(function () {
    'use strict';

    const PAY_CONFIG = {
        norms: {
            month: { punish: 0, tickets: 0 },
            week: { punish: 0, tickets: 0 }
        }
    };

    function toInt(x, def = 0) {
        const n = parseInt(x, 10);
        return Number.isFinite(n) ? n : def;
    }

    function normalizeReason(r) {
        return String(r || '').trim().toLowerCase();
    }

    /** Единый текст причины из разных полей ответа API. */
    function punishmentReasonText(p) {
        if (!p || typeof p !== 'object') return '';
        const raw = p.reason ?? p.ban_reason ?? p.message ?? p.comment ?? p.desc ?? p.punish_reason ?? p.text ?? '';
        return String(raw || '').trim();
    }

    /** Статус наказания (разбанен = 2 и т.д.). */
    function punishmentStatus(p) {
        if (!p || typeof p !== 'object') return -1;
        const keys = ['status', 'ban_status', 'state', 'punishment_status'];
        for (let i = 0; i < keys.length; i++) {
            const n = toInt(p[keys[i]], NaN);
            if (Number.isFinite(n)) return n;
        }
        return -1;
    }

    function isExcludedReason(reason) {
        const r = normalizeReason(reason);
        if (!r) return false;
        const compact = r.replace(/\s+/g, ' ').trim();
        const noSpace = compact.replace(/\s/g, '');
        // Явная фраза (регистр уже в r — lower)
        if (compact.includes('напиши тикет в дс')) return true;
        if (noSpace.includes('напишитикетвдс')) return true;
        const hasTicket = r.includes('тикет') || r.includes('ticket');
        const hasDs = r.includes('дс') || r.includes('ds') || r.includes('discord') || r.includes('дискорд');
        const hasWrite = r.includes('напиши') || r.includes('пиши') || r.includes('напишите');

        // expanded: любые похожие "напиши тикет в дс / тикет в дс / напиши в дс" и т.п.
        if (hasTicket && hasDs) return true;
        if (hasWrite && hasDs) return true;
        if (/напиши.*(тикет|ticket).*(дс|ds|discord|дискорд)/i.test(r)) return true;
        if (/(тикет|ticket).*(дс|ds|discord|дискорд)/i.test(r)) return true;
        return false;
    }

    function getPunishmentCreatedTs(p) {
        const raw = p && (p.created ?? p.created_at ?? p.date ?? p.timestamp ?? p.time ?? p.punish_time ?? p.ban_time ?? p.issue_time ?? p.start_time);
        if (typeof raw === 'number') return raw > 1e12 ? Math.floor(raw / 1000) : raw;
        if (typeof raw === 'string' && raw.trim()) {
            const trimmed = raw.trim();
            const asNum = parseInt(trimmed, 10);
            if (Number.isFinite(asNum)) return asNum > 1e12 ? Math.floor(asNum / 1000) : asNum;
            const ms = Date.parse(trimmed.replace(' ', 'T'));
            if (!Number.isNaN(ms)) return Math.floor(ms / 1000);
        }
        return null;
    }

    function inSelectedPeriod(p, selectedPeriod) {
        const sel = String(selectedPeriod || '').trim();
        if (!sel) return true;
        const ts = getPunishmentCreatedTs(p);
        if (ts == null) return false;
        const d = new Date(ts * 1000);
        if (sel.startsWith('week:')) {
            const startStr = sel.slice(5).trim(); // YYYY-MM-DD
            if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr)) return false;
            const start = new Date(startStr + 'T00:00:00');
            if (Number.isNaN(start.getTime())) return false;
            const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
            return d >= start && d < end;
        }
        // YYYY-MM
        const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        return ym === sel;
    }

    /** Только для НОВОЙ таблицы: активные/истёкшие (1, 4), без снятых (2), без причин «тикет в дс» и т.п. */
    function newTablePunishmentIncluded(p) {
        const st = punishmentStatus(p);
        if (!(st === 1 || st === 4)) return false;
        if (isExcludedReason(punishmentReasonText(p))) return false;
        return true;
    }

    /** СТАРАЯ: только срез по дате. Не вызывать newTablePunishmentIncluded. */
    function punishmentsInPeriodForOldTable(arr, selectedPeriod) {
        const raw = Array.isArray(arr) ? arr : [];
        if (!selectedPeriod) return raw.slice();
        return raw.filter(p => inSelectedPeriod(p, selectedPeriod));
    }

    /** НОВАЯ: дата + фильтры статуса/причины. */
    function punishmentsInPeriodForNewTable(arr, selectedPeriod) {
        const raw = Array.isArray(arr) ? arr : [];
        const timeScoped = selectedPeriod ? raw.filter(p => inSelectedPeriod(p, selectedPeriod)) : raw;
        return timeScoped.filter(newTablePunishmentIncluded);
    }

    function computeStaffStatsRowsSecure(staffList, statsDataBySid, selectedPeriod) {
        const list = Array.isArray(staffList) ? staffList : [];
        return list.map((s) => {
            const sid = String(s && s.steamid || '');
            const arr = Array.isArray(statsDataBySid && statsDataBySid[sid]) ? statsDataBySid[sid] : [];
            const counted = punishmentsInPeriodForNewTable(arr, selectedPeriod);
            const bans = counted.filter(p => toInt(p && p.type, 0) === 1).length;
            const mutes = counted.filter(p => toInt(p && p.type, 0) === 2).length;
            return {
                admin_steamid: sid,
                admin: (s && s.name) || '—',
                admin_avatar: (s && s.avatar_full) || '',
                group: (s && s.group_display_name) || '',
                bans,
                mutes,
                sum: bans + mutes
            };
        }).sort((a, b) => (b.sum || 0) - (a.sum || 0));
    }

    function computeStaffStatsRowsOld(staffList, statsDataBySid, selectedPeriod) {
        const list = Array.isArray(staffList) ? staffList : [];
        return list.map((s) => {
            const sid = String(s && s.steamid || '');
            const arr = Array.isArray(statsDataBySid && statsDataBySid[sid]) ? statsDataBySid[sid] : [];
            const scoped = punishmentsInPeriodForOldTable(arr, selectedPeriod);
            const bans = scoped.filter(p => toInt(p && p.type, 0) === 1).length;
            const mutes = scoped.filter(p => toInt(p && p.type, 0) === 2).length;
            const sum = scoped.length;
            return {
                admin_steamid: sid,
                admin: (s && s.name) || '—',
                admin_avatar: (s && s.avatar_full) || '',
                group: (s && s.group_display_name) || '',
                bans,
                mutes,
                sum
            };
        }).sort((a, b) => (b.sum || 0) - (a.sum || 0));
    }

    function progressivePay(count, tiers) {
        const c = Math.max(0, toInt(count, 0));
        let pay = 0;
        for (const t of tiers) {
            const from = Math.max(0, toInt(t.from, 0));
            const to = t.to == null ? Infinity : Math.max(from, toInt(t.to, 0));
            const rate = Number(t.rate) || 0;
            if (c <= from) continue;
            const units = Math.min(c, to) - from;
            if (units > 0) pay += units * rate;
        }
        return pay;
    }

    function marginalRate(count, tiers) {
        const c = Math.max(0, toInt(count, 0));
        let last = Number(tiers?.[0]?.rate) || 0;
        for (const t of tiers) {
            const from = Math.max(0, toInt(t.from, 0));
            const to = t.to == null ? Infinity : Math.max(from, toInt(t.to, 0));
            const rate = Number(t.rate) || 0;
            if (c >= from && c < to) return rate;
            last = rate;
        }
        return last;
    }

    const TICKET_TIERS = [
        { from: 0, to: 100, rate: 10 },
        { from: 100, to: 250, rate: 8 },
        { from: 250, to: 500, rate: 7 },
        { from: 500, to: null, rate: 6 }
    ];
    const BAN_TIERS = [
        { from: 0, to: 150, rate: 7 },
        { from: 150, to: 250, rate: 6 },
        { from: 250, to: 350, rate: 5 },
        { from: 350, to: 500, rate: 4 },
        { from: 500, to: null, rate: 3 }
    ];

    function payTicketsByCount(tickets) {
        return progressivePay(tickets, TICKET_TIERS);
    }
    function payBansByCount(bans) {
        return progressivePay(bans, BAN_TIERS);
    }

    function normalizeRole(roleRaw) {
        const r = String(roleRaw || '').trim().toUpperCase();
        return r || 'AUTO';
    }

    function roleFixedPay(role) {
        const r = normalizeRole(role);
        if (r === 'STM') return 1000;
        if (r === 'STA') return 3000;
        if (r === 'GA') return 6000;
        return 0;
    }

    // Месячные нормы (минимум). Считаем наказания = bans+mutes, тикеты = вручную.
    // Снятые и "напиши тикет в дс" уже исключены из bans/mutes в secure-расчёте.
    function roleMonthlyNorms(role) {
        const r = normalizeRole(role);
        if (r === 'ML') return { punish: 100, tickets: 0 };
        if (r === 'M') return { punish: 150, tickets: 0 };
        if (r === 'STM') return { punish: 80, tickets: 150 };
        if (r === 'STA') return { punish: 50, tickets: 150 };
        if (r === 'GA') return { punish: 0, tickets: 0 };
        return { punish: 0, tickets: 0 };
    }

    function computePayoutRow(row, ticketsCount, roleRaw) {
        const bans = toInt(row && row.bans, 0);
        const mutes = toInt(row && row.mutes, 0);
        const tickets = toInt(ticketsCount, 0);
        const role = normalizeRole(roleRaw);
        const banRate = marginalRate(bans, BAN_TIERS);
        const ticketRate = marginalRate(tickets, TICKET_TIERS);
        const muteRate = 4;
        const payBans = payBansByCount(bans);
        const payMutes = mutes * muteRate;
        const payTickets = payTicketsByCount(tickets);

        // Деньги у младших не считаются.
        if (role === 'ML') {
            return {
                ...row,
                tickets,
                role,
                norms: { punish: 0, tickets: 0 },
                rates: { banRate, muteRate, ticketRate },
                pay: { bans: 0, mutes: 0, tickets: 0, fixed: 0, total: 0 }
            };
        }

        const fixed = roleFixedPay(role);
        const norms = roleMonthlyNorms(role);
        const overrideMonthPunish = toInt(PAY_CONFIG?.norms?.month?.punish, 0);
        const overrideMonthTickets = toInt(PAY_CONFIG?.norms?.month?.tickets, 0);
        const effectiveNormPunish = overrideMonthPunish > 0 ? overrideMonthPunish : (norms.punish || 0);
        const effectiveNormTickets = overrideMonthTickets > 0 ? overrideMonthTickets : (norms.tickets || 0);
        const punishCount = bans + mutes;
        const meetsPunish = punishCount >= effectiveNormPunish;
        const meetsTickets = tickets >= effectiveNormTickets;
        const fixedPaid = (fixed > 0 && meetsPunish && meetsTickets) ? fixed : 0;
        return {
            ...row,
            tickets,
            role,
            norms: { punish: effectiveNormPunish, tickets: effectiveNormTickets },
            rates: { banRate, muteRate, ticketRate },
            pay: {
                bans: payBans,
                mutes: payMutes,
                tickets: payTickets,
                fixed: fixedPaid,
                total: payBans + payMutes + payTickets + fixedPaid
            }
        };
    }

    function toCsv(rows) {
        const escape = (v) => {
            const s = String(v ?? '');
            if (/[",\r\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
            return s;
        };
        const header = [
            'steamid',
            'name',
            'group',
            'role',
            'bans',
            'mutes',
            'tickets',
            'ban_rate',
            'mute_rate',
            'ticket_rate',
            'pay_bans',
            'pay_mutes',
            'pay_tickets',
            'pay_fixed',
            'pay_total'
        ];
        const lines = [header.join(';')];
        (Array.isArray(rows) ? rows : []).forEach(r => {
            lines.push([
                escape(r.admin_steamid),
                escape(r.admin),
                escape(r.group),
                escape(r.role || ''),
                escape(toInt(r.bans, 0)),
                escape(toInt(r.mutes, 0)),
                escape(toInt(r.tickets, 0)),
                escape(toInt(r.rates?.banRate, 0)),
                escape(toInt(r.rates?.muteRate, 0)),
                escape(toInt(r.rates?.ticketRate, 0)),
                escape(toInt(r.pay?.bans, 0)),
                escape(toInt(r.pay?.mutes, 0)),
                escape(toInt(r.pay?.tickets, 0)),
                escape(toInt(r.pay?.fixed, 0)),
                escape(toInt(r.pay?.total, 0))
            ].join(';'));
        });
        // Excel (RU) обычно любит ; и Windows-1251, но сделаем UTF-8 с BOM.
        return '\uFEFF' + lines.join('\r\n');
    }

    function downloadCsv(filename, csv) {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    window.StaffStatsSecure = {
        setConfig: (cfg) => {
            try {
                const c = cfg && typeof cfg === 'object' ? cfg : {};
                const nm = c.norms && typeof c.norms === 'object' ? c.norms : {};
                const month = nm.month && typeof nm.month === 'object' ? nm.month : {};
                const week = nm.week && typeof nm.week === 'object' ? nm.week : {};
                PAY_CONFIG.norms.month.punish = toInt(month.punish, 0);
                PAY_CONFIG.norms.month.tickets = toInt(month.tickets, 0);
                PAY_CONFIG.norms.week.punish = toInt(week.punish, 0);
                PAY_CONFIG.norms.week.tickets = toInt(week.tickets, 0);
            } catch (_) {}
        },
        computeStaffStatsRowsSecure,
        computeStaffStatsRowsOld,
        computePayoutRow,
        toCsv,
        downloadCsv
    };
})();

