// Приватный модуль для расчёта статистики/выплат стаффа.
// Должен раздаваться сервером только для пользователей level >= 3.
(function () {
    'use strict';

    function toInt(x, def = 0) {
        const n = parseInt(x, 10);
        return Number.isFinite(n) ? n : def;
    }

    function normalizeReason(r) {
        return String(r || '').trim().toLowerCase();
    }

    function isExcludedReason(reason) {
        const r = normalizeReason(reason);
        if (!r) return false;
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

    function inSelectedMonth(p, selectedMonth) {
        if (!selectedMonth) return true;
        const ts = getPunishmentCreatedTs(p);
        if (ts == null) return false;
        const d = new Date(ts * 1000);
        const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        return ym === selectedMonth;
    }

    function isCountedPunishment(p) {
        // "снятые не учитываются" -> status=2 не считаем
        // считаем только активные/истекшие (как у вас уже было: 1 и 4)
        const st = toInt(p && p.status, -1);
        if (!(st === 1 || st === 4)) return false;
        if (isExcludedReason(p && p.reason)) return false;
        return true;
    }

    function computeStaffStatsRowsSecure(staffList, statsDataBySid, selectedMonth) {
        const list = Array.isArray(staffList) ? staffList : [];
        return list.map((s) => {
            const sid = String(s && s.steamid || '');
            const arr = Array.isArray(statsDataBySid && statsDataBySid[sid]) ? statsDataBySid[sid] : [];
            const scoped = selectedMonth ? arr.filter(p => inSelectedMonth(p, selectedMonth)) : arr;
            const counted = scoped.filter(isCountedPunishment);
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

    // "Старая таблица": считаем ВСЕ наказания, включая снятые (status=2).
    // Здесь НЕТ фильтра по причине: учитываем и "напиши тикет в дс" и т.п.
    function computeStaffStatsRowsOld(staffList, statsDataBySid, selectedMonth) {
        const list = Array.isArray(staffList) ? staffList : [];
        return list.map((s) => {
            const sid = String(s && s.steamid || '');
            const arr = Array.isArray(statsDataBySid && statsDataBySid[sid]) ? statsDataBySid[sid] : [];
            const scoped = selectedMonth ? arr.filter(p => inSelectedMonth(p, selectedMonth)) : arr;
            const bans = scoped.filter(p => toInt(p && p.type, 0) === 1).length;
            const mutes = scoped.filter(p => toInt(p && p.type, 0) === 2).length;
            const removed = scoped.filter(p => toInt(p && p.status, -1) === 2).length;
            return {
                admin_steamid: sid,
                admin: (s && s.name) || '—',
                admin_avatar: (s && s.avatar_full) || '',
                group: (s && s.group_display_name) || '',
                bans,
                mutes,
                sum: bans + mutes,
                removed
            };
        }).sort((a, b) => (b.sum || 0) - (a.sum || 0));
    }

    function banRateByCount(bans) {
        const b = toInt(bans, 0);
        if (b >= 500) return 3;
        if (b >= 350) return 4;
        if (b >= 250) return 5;
        if (b >= 150) return 6;
        return 7;
    }

    function ticketRateByCount(tickets) {
        const t = toInt(tickets, 0);
        if (t >= 500) return 6;
        if (t >= 250) return 7;
        if (t >= 100) return 8;
        return 10;
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
        const banRate = banRateByCount(bans);
        const ticketRate = ticketRateByCount(tickets);
        const muteRate = 4;
        const payBans = bans * banRate;
        const payMutes = mutes * muteRate;
        const payTickets = tickets * ticketRate;
        const fixed = roleFixedPay(role);
        const norms = roleMonthlyNorms(role);
        const punishCount = bans + mutes;
        const meetsPunish = punishCount >= (norms.punish || 0);
        const meetsTickets = tickets >= (norms.tickets || 0);
        const fixedPaid = (fixed > 0 && meetsPunish && meetsTickets) ? fixed : 0;
        return {
            ...row,
            tickets,
            role,
            norms: { punish: norms.punish, tickets: norms.tickets },
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
        computeStaffStatsRowsSecure,
        computeStaffStatsRowsOld,
        computePayoutRow,
        toCsv,
        downloadCsv
    };
})();

