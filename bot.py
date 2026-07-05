from __future__ import annotations
import discord
from discord.ext import commands, tasks
from discord import app_commands
import os
import time
from dotenv import load_dotenv
import asyncio
import aiohttp
import json
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlsplit
import traceback
import signal
import hashlib
import io
import secrets
import db as _db
import gdrive_backup
import discord_backup

load_dotenv()

def _env_int(key: str, default: int) -> int:
    raw = os.getenv(key)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw.strip())
    except ValueError:
        return default

def _env_bool(key: str, default: bool) -> bool:
    raw = os.getenv(key)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}

def _env_int_list(key: str, default: list[int]) -> list[int]:
    raw = os.getenv(key)
    if raw is None or raw.strip() == "":
        return default
    out: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(int(part))
        except ValueError:
            continue
    return out or default

TOKEN = (os.getenv("DISCORD_TOKEN") or "").strip()
if not TOKEN:
    raise RuntimeError("DISCORD_TOKEN не задан. Добавь его в .env (DISCORD_TOKEN=...)")

FEAR_COOKIE = (os.getenv("FEAR_COOKIE") or "").strip()
STEAM_API_KEY = (os.getenv("STEAM_API_KEY") or "9EA60BC3158081747D77604EB9819F19").strip()
SITE_API_URL = (os.getenv("SITE_API_URL") or "").strip()
SITE_API_SECRET = (os.getenv("SITE_API_SECRET") or "default_secret").strip()
ADMINS_CACHE_FILE          = Path(__file__).parent / "admins_cache.json"
MODERATOR_ONLY_CHANNEL_ID  = _env_int("MODERATOR_ONLY_CHANNEL_ID", 1484290494812000330)
REPORTS_CHANNEL_ID         = _env_int("REPORTS_CHANNEL_ID", 1501738709744222268)   # reported users
REPORTS_DEV_ROLE_ID        = _env_int("REPORTS_DEV_ROLE_ID", 1463269872350920704)  # роль разработчика для пинга
BOT_OWNER_ID               = _env_int("BOT_OWNER_ID", 1500235583367417866)
BOT_OWNER_CHANNEL_ID       = _env_int("BOT_OWNER_CHANNEL_ID", 1500675878513020928)

# ─── Настройки ───────────────────────────────────────────────────────────────
WELCOME_CHANNEL_ID    = _env_int("WELCOME_CHANNEL_ID", 1497219161947115520)
UPDATES_CHANNEL_ID    = _env_int("UPDATES_CHANNEL_ID", 1463265360458416333)
TICKETS_CATEGORY_ID   = _env_int("TICKETS_CATEGORY_ID", 1497968709598449825)
SUPPORT_ROLE_ID       = _env_int("SUPPORT_ROLE_ID", 1463269872350920704)
LOG_CHANNEL_ID        = _env_int("LOG_CHANNEL_ID", 1501738176052592712)
NEWS_CHANNEL_ID       = _env_int("NEWS_CHANNEL_ID", 1463265774318915706)
CHAT_CHANNEL_ID       = _env_int("CHAT_CHANNEL_ID", 1461816242599104739)
GITHUB_URL            = "https://github.com/yamolochko/Fear-Search-Progmas/releases"

REPORTS_ALERT_ROLE_ID  = _env_int("REPORTS_ALERT_ROLE_ID", 1501738368026017912)   # роль для пинга при репортах
TOKEN_ALERT_CHANNEL_ID = _env_int("TOKEN_ALERT_CHANNEL_ID", 1501738905597251674)  # канал для уведомления об устаревшем токене
SUSPICIOUS_CHANNEL_ID  = _env_int("SUSPICIOUS_CHANNEL_ID", 1501738683747926159)   # tracked-admins
WATCH_CHANNEL_ID       = _env_int("WATCH_CHANNEL_ID", 1506424445852454983)        # 1000top-cheak (мониторинг топа)
BAN_NOTIFY_CHANNEL_ID  = _env_int("BAN_NOTIFY_CHANNEL_ID", 1503035873816744069)   # уведомления о банах на yooma/cs2red
STAFF_PUNISH_LOG_CHANNEL_ID = _env_int("STAFF_PUNISH_LOG_CHANNEL_ID", 1510955528787071077)
ALERT_ROLE_ID          = _env_int("ALERT_ROLE_ID", 1463269872350920704)
API_BASE               = os.getenv("API_BASE", "https://fearproject.ru/api").strip() or "https://fearproject.ru/api"
API_BASE_OLD           = os.getenv("API_BASE_OLD", "https://api.fearproject.ru").strip() or "https://api.fearproject.ru"

# Роли, которым запрещен Yooma (но разрешен /mystats)
YOOMA_RESTRICTED_ROLES = _env_int_list("YOOMA_RESTRICTED_ROLES", [1507939408223928465, 1507939502147113000])

# Основные ID ролей
ROLE_STADMIN_ID    = _env_int("ROLE_STADMIN_ID", 1503512384122257408)
ROLE_GLADMIN_ID    = _env_int("ROLE_GLADMIN_ID", 1503512406301872198)
ROLE_OWNER_ID      = _env_int("ROLE_OWNER_ID", 1507436855921082468)
ROLE_OWNER_ALT_ID  = _env_int("ROLE_OWNER_ALT_ID", 1501738368026017912)
ROLE_ADMIN_ID      = _env_int("ROLE_ADMIN_ID", 1507939408223928465)
ROLE_ADMIN_PLUS_ID = _env_int("ROLE_ADMIN_PLUS_ID", 1507939502147113000)
ROLE_UNDEFINED_ID  = _env_int("ROLE_UNDEFINED_ID", 1507941424488910981)
ROLE_CURATOR_ID    = _env_int("ROLE_CURATOR_ID", 1514077135588036698)

# Группы ролей
STAFF_ROLES = set(_env_int_list("STAFF_ROLES", [1503512286223138900, 1503512343202758666, 1503512364404703392, 1503512384122257408, 1503512406301872198]))
STATS_FULL_ACCESS_ROLES = set(_env_int_list("STATS_FULL_ACCESS_ROLES", [ROLE_STADMIN_ID, ROLE_GLADMIN_ID, ROLE_OWNER_ID, ROLE_OWNER_ALT_ID]))
CHECKER_ALLOWED_ROLES = set(_env_int_list(
    "CHECKER_ALLOWED_ROLES",
    [
        1503512286223138900,
        1503512343202758666,
        1503512364404703392,
        ROLE_ADMIN_ID,
        ROLE_ADMIN_PLUS_ID,
        ROLE_STADMIN_ID,
        ROLE_GLADMIN_ID,
        ROLE_OWNER_ID,
        ROLE_OWNER_ALT_ID,
        ROLE_CURATOR_ID,
        1363567559122751640,
        1438457934253396088,
        1416073628088401961,
        1358118683142127766,
        1358141957481955556,
        1358142006131687565,
        1416068024972087366,
        1474420026022039674,
    ],
))

SUSPICION_THRESHOLD   = _env_int("SUSPICION_THRESHOLD", 60)
MARKS_FILE            = Path(__file__).parent / "marks.json"
HISTORY_FILE          = Path(__file__).parent / "watch_history.json"
MSG_IDS_FILE          = Path(__file__).parent / "message_ids.json"
TRACKED_FILE          = Path(__file__).parent / "tracked_players.json"
WHITELIST_FILE        = Path(__file__).parent / "whitelist.json"

# --- Global All Punishments Log ---
ALL_PUNISHMENTS_FILE = Path(__file__).parent / "all_punishments_log.json"
ONLINE_STATS_FILE = Path(__file__).parent / "online_stats.json"
_last_online_record_ts: float = 0
PUNISHMENTS_SCAN_STATE_FILE = Path(__file__).parent / "punishments_scan_state.json"

def _load_all_punishments() -> dict:
    return _load_json_with_fallback(ALL_PUNISHMENTS_FILE, {"bans": {}, "mutes": {}})

def _save_all_punishments(data: dict):
    _save_json_atomic(ALL_PUNISHMENTS_FILE, data)

def _load_punishments_scan_state() -> dict:
    if PUNISHMENTS_SCAN_STATE_FILE.exists():
        try:
            return json.loads(PUNISHMENTS_SCAN_STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"last_ban_id": 0, "last_mute_id": 0, "last_full_refresh": ""}

def _save_punishments_scan_state(state: dict):
    _save_json_atomic(PUNISHMENTS_SCAN_STATE_FILE, state)

def _log_punishment_globally(item: dict, ptype: int):
    """Записывает одно наказание в глобальный лог."""
    _log_punishments_batch([(item, ptype)])

def _log_punishments_batch(items_with_type: list[tuple[dict, int]]):
    """Записывает список наказаний ВЫДАННЫХ СТАФФОМ в глобальный лог за один раз."""
    if not items_with_type:
        return
    try:
        # Фильтр по дате: 01.01.2026 00:00:00 UTC
        START_TS = 1735689600
        staff_db = _load_staff_db()
        staff_ids = {str(sid).strip() for sid in staff_db.keys() if str(sid).strip()}
        
        data = _load_all_punishments()
        changed = False
        
        pg_batch = []
        for item, ptype in items_with_type:
            created_ts = int(item.get("created") or 0)
            if created_ts < START_TS:
                continue
            
            admin_sid = str(item.get("admin_steamid") or "").strip()
            if admin_sid and admin_sid not in staff_ids:
                continue
            
            pid = str(item.get("id"))
            key = "bans" if ptype == 1 else "mutes"
            
            existing = data[key].get(pid)
            if existing != item:
                data[key][pid] = item
                changed = True
            
            pg_batch.append((item, ptype))
        
        if changed:
            _save_all_punishments(data)

        if pg_batch:
            try:
                bans = [item for item, pt in pg_batch if pt == 1]
                mutes = [item for item, pt in pg_batch if pt == 2]
                written = 0
                if bans:
                    written += _db.db_upsert_punishments_batch(bans, 1)
                if mutes:
                    written += _db.db_upsert_punishments_batch(mutes, 2)
                if written:
                    _log(f"📝 [PG] Batch upsert: {written} punishments", discord=False)
            except Exception as e:
                _log(f"⚠️ [PG] Ошибка batch upsert punishments: {e}", discord=False)
    except Exception as e:
        _log(f"⚠️ Ошибка глобального логирования наказаний (batch): {e}")

@tasks.loop(minutes=5)
async def staff_status_refresh_loop():
    """Раз в 5 минут делает глубокое обновление статистики для каждого админа.
    Это гарантирует, что мы не пропустим разбаны/размуты, даже если они не попали в ленту мониторинга."""
    if not FEAR_COOKIE: return
    
    staff_db = _load_staff_db()
    if not staff_db: return

    _log(f"🔄 [STATUS REFRESH] Начинаю плановое обновление статистики для {len(staff_db)} чел...")

    async with aiohttp.ClientSession() as session:
        for i, (sid, entry) in enumerate(staff_db.items(), 1):
            try:
                # Делаем глубокое обновление (листаем все страницы поиска по этому админу)
                # entry из staff_db НЕ содержит steamid, формируем правильный entry
                await _update_cache_for_staff(session, {
                    "steamid": sid,
                    "name": entry.get("name", sid)
                })
            except Exception as e:
                _log(f"⚠️ [STATUS REFRESH] Ошибка обновления {sid}: {e}")
            
            # Короткая пауза между админами, чтобы не вешать бота и не злить API
            await asyncio.sleep(0.2)

            # Каждые 10 человек пишем прогресс в консоль
            if i % 10 == 0:
                _log(f"  ⏳ Прогресс: {i}/{len(staff_db)}...")

    _log("✅ [STATUS REFRESH] Плановое обновление завершено.")

@tasks.loop(minutes=5)
async def role_sync_loop():
    """Раз в 5 минут синхронизирует роли всех участников сервера со списком стаффа/админов."""
    if not bot.is_ready():
        return
    try:
        staff_db = _load_staff_db()
        all_admins = _load_admins_cache()
        # Собираем всех кто есть в базе (staff + все админы)
        all_db = {}
        for sid, entry in staff_db.items():
            all_db[sid] = entry
        for admin in all_admins:
            sid = admin.get("steamid")
            if sid and sid not in all_db:
                all_db[sid] = {
                    "steamid": sid,
                    "name": admin.get("name", admin.get("nickname", "Админ")),
                    "group_name": admin.get("group_name", "ADMIN"),
                    "discord_id": admin.get("discord_id")
                }
        
        if all_db:
            await _sync_staff_roles(all_db)
    except Exception as e:
        _log(f"⚠️ [ROLE SYNC] Ошибка: {e}")

@role_sync_loop.before_loop
async def before_role_sync():
    await bot.wait_until_ready()

# В on_ready добавить запуск: staff_status_refresh_loop.start() и role_sync_loop.start()

SUSPICIOUS_PANEL_FILE = Path(__file__).parent / "suspicious_panel.json"
NEWBIES_PANEL_FILE    = Path(__file__).parent / "newbies_panel.json"
ADMIN_ONLINE_PANEL_FILE = Path(__file__).parent / "admin_online_panel.json"
STAFF_PUNISH_PANEL_FILE = Path(__file__).parent / "staff_punish_panel.json"
STAFF_PUNISH_STATE_FILE = Path(__file__).parent / "staff_punish_state.json"

def _load_admin_online_panel() -> dict:
    if ADMIN_ONLINE_PANEL_FILE.exists():
        try:
            return json.loads(ADMIN_ONLINE_PANEL_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}

def _save_admin_online_panel(data: dict):
    _save_json_atomic(ADMIN_ONLINE_PANEL_FILE, data)

def _load_newbies_panel() -> dict:
    if NEWBIES_PANEL_FILE.exists():
        try:
            return json.loads(NEWBIES_PANEL_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}

def _load_staff_punish_panel() -> dict:
    if STAFF_PUNISH_PANEL_FILE.exists():
        try:
            return json.loads(STAFF_PUNISH_PANEL_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}

def _save_staff_punish_panel(channel_id: int, message_id: int):
    _save_json_atomic(STAFF_PUNISH_PANEL_FILE, {"channel_id": channel_id, "message_id": message_id})

def _load_staff_punish_state() -> dict:
    if STAFF_PUNISH_STATE_FILE.exists():
        try:
            return json.loads(STAFF_PUNISH_STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"last_ban_id": 0, "last_mute_id": 0}

def _save_staff_punish_state(state: dict):
    _save_json_atomic(STAFF_PUNISH_STATE_FILE, state)

async def _find_panel_in_history(channel: discord.TextChannel, title_fragment: str, limit: int = 15) -> discord.Message | None:
    """Ищет последнее сообщение от бота с указанным фрагментом в заголовке эмбеда."""
    try:
        async for msg in channel.history(limit=limit):
            if msg.author == bot.user and msg.embeds and title_fragment in (msg.embeds[0].title or ""):
                return msg
    except Exception:
        pass
    return None

async def _purge_bot_messages(channel: discord.TextChannel, limit: int = 200):
    try:
        if hasattr(channel, "purge"):
            await channel.purge(limit=limit, check=lambda m: m.author == bot.user, bulk=True)
            return
    except Exception:
        pass

    try:
        deleted = 0
        async for msg in channel.history(limit=limit):
            if msg.author != bot.user:
                continue
            try:
                await msg.delete()
                deleted += 1
                if deleted % 10 == 0:
                    await asyncio.sleep(0.15)
            except Exception:
                pass
    except Exception:
        pass

def _save_json_atomic(path: Path, data: object):
    """Атомарное сохранение JSON чтобы избежать повреждения файлов."""
    import tempfile
    import shutil
    
    # Создаем временный файл в той же директории
    fd, temp_path = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".tmp")
    try:
        with os.fdopen(fd, 'w', encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        # Атомарно заменяем старый файл новым
        shutil.move(temp_path, path)
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        _log(f"❌ Ошибка атомарного сохранения {path.name}: {e}")

    # Дублируем в PostgreSQL если доступна
    if _db.db_is_available():
        try:
            _db.db_save(path.name, data)
        except Exception:
            pass

def _load_json_with_fallback(path: Path, default=None):
    """Загружает JSON из файла с fallback на PostgreSQL kv_store."""
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    # Fallback: читаем из PostgreSQL
    if _db.db_is_available():
        try:
            data = _db.db_load(path.name)
            if data is not None:
                return data
        except Exception:
            pass
    return default

def _save_suspicious_panel(channel_id: int, message_id: int):
    _save_json_atomic(SUSPICIOUS_PANEL_FILE, {"channel_id": channel_id, "message_id": message_id})

def _load_suspicious_panel() -> dict:
    if SUSPICIOUS_PANEL_FILE.exists():
        try:
            return json.loads(SUSPICIOUS_PANEL_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}

def _save_newbies_panel(channel_id: int, message_id: int):
    _save_json_atomic(NEWBIES_PANEL_FILE, {"channel_id": channel_id, "message_id": message_id})

# --- Whitelist Management ---
_whitelist: set[str] = set()

def _load_whitelist():
    global _whitelist
    if WHITELIST_FILE.exists():
        try:
            data = json.loads(WHITELIST_FILE.read_text(encoding="utf-8"))
            _whitelist = set(data)
        except Exception:
            _whitelist = set()
    else:
        _whitelist = set()

def _save_whitelist():
    _save_json_atomic(WHITELIST_FILE, list(_whitelist))

def _init_files():
    """Создаёт все необходимые JSON файлы и папки если они не существуют."""
    base = Path(__file__).parent

    # Создаём папки
    for d in [base / "stats_cache"]:
        if not d.exists():
            d.mkdir(parents=True, exist_ok=True)
            print(f"📁 Создана папка: {d.name}/")

    defaults: dict[Path, object] = {
        base / "marks.json":              {},
        base / "watch_history.json":      {},
        base / "message_ids.json":        {"sus": {}, "watch": {}},
        base / "tracked_players.json":    {},
        base / "whitelist.json":          [],
        base / "suspicious_panel.json":   {},
        base / "newbies_panel.json":      {},
        base / "admin_online_panel.json": {},
        base / "staff_punish_panel.json": {},
        base / "staff_punish_state.json": {"last_ban_id": 0, "last_mute_id": 0},
        base / "access_list.json":        [],
        base / "admins_cache.json":       [],
        base / "staff_db.json":           {},
        base / "staff_blacklist.json":    [],
        base / "autoclose_settings.json": {},
        base / "staffboard.json":         {},
        base / "leaderstaff_panel.json":  {},
        base / "leaderboard_panels.json": {},
        base / "leaderboard_cache.json":  [],
        base / "online_stats.json":       {},
        base / "all_punishments_log.json": {},
        base / "punishments_scan_state.json": {"last_ban_id": 0, "last_mute_id": 0},
        base / "drops_log.json":          {},
    }
    for path, default_obj in defaults.items():
        if not path.exists():
            try:
                path.write_text(json.dumps(default_obj, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"📄 Создан файл: {path.name}")
            except Exception as e:
                print(f"⚠️ Не удалось создать {path.name}: {e}")
            continue

        try:
            json.loads(path.read_text(encoding="utf-8") or "")
        except Exception:
            try:
                backup = path.with_suffix(path.suffix + ".corrupt")
                if backup.exists():
                    backup.unlink()
                path.rename(backup)
                path.write_text(json.dumps(default_obj, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"⚠️ Файл поврежден и пересоздан: {path.name}")
            except Exception:
                pass

_init_files()

def _msk_str(dt: datetime | None, fmt: str = "%d.%m.%Y %H:%M") -> str:
    """Конвертирует UTC datetime в строку MSK (UTC+3)."""
    if dt is None:
        return "—"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    msk = dt + timedelta(hours=3)
    return msk.strftime(fmt)


def _msk_from_timestamp(ts: int, fmt: str = "%d.%m.%Y %H:%M") -> str:
    """Конвертирует unix timestamp (UTC) в строку MSK."""
    if not ts:
        return "—"
    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    return _msk_str(dt, fmt)


def _reload_fear_cookie() -> str:
    """Перечитывает FEAR_COOKIE из .env файла."""
    global FEAR_COOKIE
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        try:
            env_path.write_text("DISCORD_TOKEN=\nFEAR_COOKIE=\n", encoding="utf-8")
        except Exception:
            pass
    if env_path.exists():
        try:
            for line in env_path.read_text(encoding="utf-8").splitlines():
                if line.startswith("FEAR_COOKIE="):
                    val = line[len("FEAR_COOKIE="):].strip()
                    if val:
                        FEAR_COOKIE = val
                        return val
        except Exception:
            pass
    return FEAR_COOKIE

intents = discord.Intents.default()
intents.members = True
intents.message_content = True
intents.dm_messages = True

bot = commands.Bot(command_prefix=".", intents=intents, help_command=None)
tree = bot.tree

async def global_bot_access_check(interaction: discord.Interaction):
    # Если это не в гильдии - блокируем
    if not interaction.guild:
        return True # Разрешаем в ЛС
        
    member = interaction.user
    if isinstance(member, discord.Member):
        # 1. Проверка на наличие ролей (если вообще нет ролей кроме @everyone)
        # len(member.roles) == 1 означает только @everyone
        if len(member.roles) <= 1:
            await interaction.response.send_message("❌ У вас нет ролей на этом сервере. Доступ к боту запрещен.", ephemeral=True)
            return False
            
        # 2. Проверка заблокированной роли (ROLE_UNDEFINED_ID)
        if any(r.id == ROLE_UNDEFINED_ID for r in member.roles):
            await interaction.response.send_message("❌ У вас ограничена роль для использования бота.", ephemeral=True)
            return False
            
    return True

tree.interaction_check = global_bot_access_check

# ── Состояние мониторинга ─────────────────────────────────────────────────────
_profile_cache: dict = {}
_marks: dict = {}
_sus_msg_ids: dict = {}
_watch_msg_ids: dict = {}
_history: dict = {}
_last_score: dict = {}

# ── Буфер офлайна (ждём 2 цикла перед пометкой) ──────────────────────────────
_offline_buffer: dict = {}  # steam_id -> кол-во циклов офлайна

# ── Система отслеживания игроков ──────────────────────────────────────────────
# { steamid: { "name": str, "added_by": str, "channel_id": int, "last_seen": {...} } }
_tracked_players: dict = {}

def _load_tracked() -> dict:
    if TRACKED_FILE.exists():
        try:
            return json.loads(TRACKED_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}

def _save_tracked():
    _save_json_atomic(TRACKED_FILE, _tracked_players)


# ── Персистентность ───────────────────────────────────────────────────────────

def _load_marks():
    global _marks
    _marks = _load_json_with_fallback(MARKS_FILE, {})

def _save_marks():
    _save_json_atomic(MARKS_FILE, _marks)

def _load_msg_ids():
    global _sus_msg_ids, _watch_msg_ids
    if MSG_IDS_FILE.exists():
        try:
            data = json.loads(MSG_IDS_FILE.read_text(encoding="utf-8"))
            _sus_msg_ids   = data.get("sus", {})
            _watch_msg_ids = data.get("watch", {})
        except Exception:
            pass

def _save_msg_ids():
    _save_json_atomic(MSG_IDS_FILE, {"sus": _sus_msg_ids, "watch": _watch_msg_ids})

def _load_history():
    global _history
    if HISTORY_FILE.exists():
        try:
            _history = json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
        except Exception:
            _history = {}

def _save_history():
    _save_json_atomic(HISTORY_FILE, _history)

def _add_history(steam_id: str, event: str):
    now = datetime.now(timezone.utc)
    if steam_id not in _history:
        _history[steam_id] = []
    _history[steam_id].append({"time": now.isoformat(), "event": event})
    cutoff = now.timestamp() - 7 * 86400
    _history[steam_id] = [
        e for e in _history[steam_id]
        if datetime.fromisoformat(e["time"]).timestamp() > cutoff
    ][:100]  # Лимит 100 записей на игрока
    _save_history()

# ── Скор подозрительности ─────────────────────────────────────────────────────

def _suspicion_score(player: dict, profile) -> int:
    score = 0
    if profile is None:
        return 10
    try:
        created = datetime.fromisoformat(profile.get("created_at","").replace("Z","+00:00"))
        age_days = (datetime.now(timezone.utc) - created).days
        if age_days < 30:    score += 20
        elif age_days < 90:  score += 10
        elif age_days < 180: score += 5
    except Exception:
        score += 10
    
    stats = profile.get("stats")
    if stats:
        # Пытаемся взять КД напрямую из профиля (как на сайте)
        kd = stats.get("kd")
        if kd is None:
            kills  = stats.get("kills", 0)
            deaths = stats.get("deaths", 0)
            kd = kills / deaths if deaths > 0 else 0
        
        if kd > 4.0:    score += 100
        elif kd > 3.0:  score += 70
        elif kd > 2.5:  score += 40
        elif kd > 1.6:  score += 15
        
        hs = stats.get("headshots", 0)
        kills = stats.get("kills", 0)
        # Учитываем HS% только если достаточно убийств (>=15)
        if kills >= 15:
            hs_pct = (hs / kills * 100) if kills > 0 else 0
            if hs_pct > 65:    score += 25
            elif hs_pct > 40:  score += 10
        
        playtime_h = (stats.get("playtime", 0) / 3600)
        if playtime_h < 5:     score += 25
        elif playtime_h < 10:  score += 10
    else:
        score += 20 # Если нет статы вообще - это подозрительно
    
    faceit = profile.get("faceitLevel")
    if not faceit or faceit.get("level") is None:
        score += 5
        
    return score

def _suspicion_label(score: int) -> str:
    if score >= 60: return "Подозрительный"
    if score >= 40: return "Под наблюдением"
    return "Чистый"

def _mark_label(mark: str) -> str:
    return {"clean": "Чистый", "suspicious": "Подозрительный", "watch": "Наблюдение"}.get(mark, "")

# ── Rate-limited logging (полностью асинхронный, не блокирует циклы) ──────────
_log_queue: list[str] = []
_log_lock = asyncio.Lock()
_staff_cache_lock = asyncio.Lock()
_log_sender_started = False
_LOG_MAX_QUEUE = 20       # максимум 20 сообщений в очереди
_LOG_SEND_INTERVAL = 5.0  # отправляем не чаще раз в 5 сек

async def _log_sender_task():
    """Фоновая задача: отправляет логи из очереди с задержкой."""
    global _log_sender_started, _log_queue
    _log_sender_started = True
    while True:
        await asyncio.sleep(_LOG_SEND_INTERVAL)
        msgs_to_send = []
        async with _log_lock:
            if _log_queue:
                # Берём до 3 сообщений за раз
                msgs_to_send = _log_queue[:3]
                _log_queue = _log_queue[3:]

        for msg in msgs_to_send:
            try:
                ch = bot.get_channel(LOG_CHANNEL_ID)
                if ch:
                    await ch.send(msg)
                    await asyncio.sleep(1.5)  # задержка между сообщениями
            except Exception:
                pass  # Игнорируем ошибки отправки логов

def _start_log_sender():
    """Запускает фоновую задачу отправки логов (один раз)."""
    global _log_sender_started
    if not _log_sender_started:
        _log_sender_started = True
        asyncio.create_task(_log_sender_task())

def _log(msg: str, discord: bool = True):
    """Логирует в консоль и опционально в Discord."""
    ts = _msk_str(datetime.now(timezone.utc), "%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}")
    
    # Пишем в PostgreSQL (errors + warnings + important events)
    if any(p in msg for p in ["❌", "⚠️", "🚨"]):
        try:
            _db.LogService("bot", "error" if "❌" in msg else "warning", msg[:2000])
        except Exception:
            pass
    elif any(p in msg for p in ["✅", "📝"]):
        try:
            _db.LogService("bot", "info", msg[:2000])
        except Exception:
            pass

    # В Discord отправляем ошибки (❌), предупреждения (⚠️), алерты (🚨), успехи (✅) и логи (📝)
    is_critical = any(p in msg for p in ["❌", "⚠️", "🚨", "✅", "📝"])
    
    if not discord or not is_critical:
        return

    # Добавляем в очередь для Discord
    try:
        if bot.is_ready():
            if msg.startswith("❌"):      prefix = "🔴"
            elif msg.startswith("⚠️"):  prefix = "🟡"
            elif msg.startswith("🚨"):  prefix = "🚨"
            else:                        prefix = "⚪"
            formatted = f"`{ts}` {prefix} {msg}"
            asyncio.create_task(_log_add_to_queue(formatted))
    except Exception:
        pass

async def _log_add_to_queue(formatted: str):
    """Асинхронно добавляет в очередь с лимитом."""
    global _log_queue
    async with _log_lock:
        if len(_log_queue) < _LOG_MAX_QUEUE:
            _log_queue.append(formatted)

# ── API helpers ───────────────────────────────────────────────────────────────

_http_warn_last: dict[str, float] = {}

def _safe_url(url: str) -> str:
    try:
        p = urlsplit(url)
        return f"{p.scheme}://{p.netloc}{p.path}"
    except Exception:
        return "<url>"

async def _fetch_json(session: aiohttp.ClientSession, url: str, params: dict = None, headers: dict = None, timeout_total: int = 8, max_retries: int = 2):
    # Fallback: если URL на новом домене не отвечает — пробуем старый
    result = await _fetch_json_one(session, url, params, headers, timeout_total, max_retries)
    if result is None and API_BASE in url and API_BASE != API_BASE_OLD:
        fallback_url = url.replace(API_BASE, API_BASE_OLD, 1)
        _log(f"🔀 [FALLBACK] {_safe_url(url)} -> {_safe_url(fallback_url)}", discord=False)
        result = await _fetch_json_one(session, fallback_url, params, headers, timeout_total, max_retries=1)
    return result


async def _fetch_json_one(session: aiohttp.ClientSession, url: str, params: dict = None, headers: dict = None, timeout_total: int = 8, max_retries: int = 2):
    safe = _safe_url(url)
    timeout = aiohttp.ClientTimeout(total=timeout_total)
    last_status = None
    last_err = None

    # Дефолтные заголовки для обхода базовых проверок
    actual_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    }
    if headers:
        actual_headers.update(headers)

    for attempt in range(max_retries):
        try:
            async with session.get(url, params=params, headers=actual_headers, timeout=timeout) as r:
                last_status = r.status
                if r.status == 200:
                    try:
                        return await r.json(content_type=None)
                    except Exception as je:
                        # Если не JSON, пробуем текст
                        text = await r.text()
                        if attempt == max_retries - 1:
                            _log(f"⚠️ [HTTP] Ошибка парсинга JSON с {safe}: {je}. Ответ: {text[:100]}...", discord=False)
                        continue

                if r.status == 429:
                    retry_after = r.headers.get("Retry-After")
                    try:
                        wait_s = float(retry_after) if retry_after else (1.5 ** attempt)
                    except Exception:
                        wait_s = 1.5 ** attempt

                    _log(f"⚠️ HTTP 429 {safe}. Waiting {wait_s:.1f}s...")
                    await asyncio.sleep(min(max(wait_s, 0.5), 10.0))
                    continue
                # Если 404 или 403 — не повторяем, скорее всего путь неверный или бан
                if r.status in (403, 404):
                    break

                if r.status >= 500 and attempt < max_retries - 1:
                    await asyncio.sleep(0.3 * (attempt + 1))
                    continue

                break

        except Exception as e:
            last_err = e
            if attempt < max_retries - 1:
                await asyncio.sleep(0.3 * (attempt + 1))
                continue
            break

    now = datetime.now(timezone.utc).timestamp()
    # Для троттлинга (ограничения спама) используем базовый URL без параметров
    # Чтобы не спамить на каждого отдельного игрока (разные steamid в URL)
    throttle_key = f"{safe}:{last_status or 'err'}"
    last = _http_warn_last.get(throttle_key, 0)

    if now - last >= 120: # Логируем одну и ту же ошибку для домена не чаще раз в 2 минуты
        _http_warn_last[throttle_key] = now
        if last_status is not None and last_status != 200:
            if last_status == 404:
                # 404 обычно означает отсутствие данных, пишем только в консоль
                _log(f"ℹ️ HTTP 404: {url}", discord=False)
            elif last_status == 403:
                # 403 часто бывает из-за защиты сайта, пишем только в консоль чтобы не спамить Discord
                _log(f"ℹ️ HTTP 403 Forbidden: {safe} (Проверь доступ к сайту)", discord=False)
            else:
                _log(f"ℹ️ HTTP Error {last_status}: {safe}", discord=False)
        elif last_err is not None:
            _log(f"ℹ️ Network Error {type(last_err).__name__}: {safe}", discord=False)

    return None

async def _get_profile(session: aiohttp.ClientSession, steam_id: str):
    if steam_id in _profile_cache:
        return _profile_cache[steam_id]

    # 1. Базовый профиль, лидерборд и скинчanger — параллельно
    profile_task = _fetch_json(session, f"{API_BASE}/profile/{steam_id}")

    lb_data = next((p for p in _cached_leaderboard_data if str(p.get("steamid", "")).strip() == steam_id), None)
    lb_task = None
    if not lb_data:
        lb_task = _fetch_json(session, f"{API_BASE}/leaderboard/search", params={"q": steam_id, "limit": 1})

    sc_task = _fetch_json(session, f"{API_BASE}/skinchanger/player", params={"steamid": steam_id, "mode": "public"})

    if lb_task:
        data, lb_search, sc = await asyncio.gather(profile_task, lb_task, sc_task)
        if lb_search and isinstance(lb_search, dict):
            players = lb_search.get("players") or lb_search.get("leaderboard") or []
            if players:
                lb_data = players[0]
    else:
        data, sc = await asyncio.gather(profile_task, sc_task)

    # 2. Дополняем данными из поиска по лидерборду (позиция, ранг, очки)
    if lb_data:
        if not data: data = {}
        data.update({
            "position": lb_data.get("position"),
            "value": lb_data.get("value"),
            "rank_name": lb_data.get("rank"),
            "playtime_lb": lb_data.get("playtime")
        })

    # 3. Баланс берём из skinchanger API (в profile API это Fear-очки, а не баланс скинов)
    if sc and isinstance(sc, dict):
        sc_profile = sc.get("profile") or {}
        if sc_profile.get("balance") is not None:
            if not data: data = {}
            data["balance"] = sc_profile["balance"]
            # Если имени нет в profile API, берём из skinchanger
            if not data.get("name") and sc_profile.get("name"):
                data["name"] = sc_profile["name"]
            if not data.get("avatar") and sc_profile.get("avatar_full"):
                data["avatar"] = sc_profile["avatar_full"]

    if data:
        _profile_cache[steam_id] = data
    return data

async def _fetch_online_servers() -> list[dict]:
    async with aiohttp.ClientSession() as session:
        servers = await _fetch_json(session, f"{API_BASE}/servers")
        return servers or []

async def _fetch_external_steam_info(session: aiohttp.ClientSession, steamid: str) -> dict:
    """Получает инфо о VAC и дате регистрации без API ключа через steamid.xyz"""
    results = {"vac": "—", "age_days": None, "created_at": None}
    url = f"https://steamid.xyz/{steamid}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        async with session.get(url, headers=headers, timeout=5) as r:
            if r.status == 200:
                html = await r.text()
                
                # Парсим дату регистрации
                match_date = re.search(r"Account Created:</i>\s*([^<]+)<", html)
                if match_date:
                    date_str = match_date.group(1).strip()
                    results["created_at"] = date_str
                    try:
                        # Формат: 10 Aug 2009
                        created_dt = datetime.strptime(date_str, "%d %b %Y").replace(tzinfo=timezone.utc)
                        results["age_days"] = (datetime.now(timezone.utc) - created_dt).days
                    except: pass
                
                # Парсим VAC статус
                if "User is VAC Clean" in html:
                    results["vac"] = "Clean"
                elif "VAC Banned" in html or "Total VAC bans:" in html:
                    # Пытаемся найти количество банов и дни
                    match_vac_count = re.search(r"Total VAC bans:\s*(\d+)", html)
                    match_vac_days = re.search(r"Last ban:\s*(\d+)\s*days ago", html)
                    
                    count = match_vac_count.group(1) if match_vac_count else "?"
                    days = match_vac_days.group(1) if match_vac_days else None
                    
                    if days:
                        results["vac"] = f"{days} дн."
                    else:
                        results["vac"] = f"Banned ({count})"
    except: pass
    return results

async def _upsert_player_msg(channel, steam_id: str, embed, view, msg_store: dict, ping_content=None):
    msg_id = msg_store.get(steam_id)
    if msg_id:
        try:
            # Таймаут на fetch_message и edit
            msg = await asyncio.wait_for(channel.fetch_message(int(msg_id)), timeout=5.0)
            await asyncio.wait_for(msg.edit(embed=embed, view=view), timeout=5.0)
            return
        except Exception:
            # Если не нашли или ошибка сети — пробуем отправить заново ниже
            pass
    try:
        msg = await asyncio.wait_for(
            channel.send(content=ping_content, embed=embed, view=view,
                         allowed_mentions=discord.AllowedMentions(roles=True)),
            timeout=5.0
        )
        msg_store[steam_id] = str(msg.id)
        _save_msg_ids()
    except Exception as e:
        # Не логируем в Discord чтобы избежать рекурсии rate limit
        print(f"[WARN] Не удалось отправить сообщение в канал #{getattr(channel, 'name', channel.id)}: {e}")

async def _delete_player_msg(channel, steam_id: str, msg_store: dict):
    msg_id = msg_store.pop(steam_id, None)
    if msg_id:
        try:
            msg = await asyncio.wait_for(channel.fetch_message(int(msg_id)), timeout=3.0)
            await asyncio.wait_for(msg.delete(), timeout=3.0)
        except Exception:
            pass
        _save_msg_ids()

async def _mark_offline_msg(channel, steam_id: str, msg_store: dict, remove_view: bool = False):
    """Редактирует сообщение — добавляет пометку офлайн, не удаляет."""
    msg_id = msg_store.pop(steam_id, None)  # убираем из словаря чтобы не спамить
    if not msg_id:
        return
    _save_msg_ids()
    try:
        # Добавляем таймауты чтобы не вешать цикл мониторинга
        msg = await asyncio.wait_for(channel.fetch_message(int(msg_id)), timeout=5.0)
        if msg.embeds:
            emb = msg.embeds[0]
            new_emb = emb.copy()
            new_emb.colour = discord.Colour(0x555555)
            title = emb.title or ""
            if "[ОФЛАЙН]" not in title:
                new_emb.title = f"[ОФЛАЙН] {title}"
            now_str = _msk_str(datetime.now(timezone.utc), "%d.%m.%Y %H:%M:%S")
            new_emb.set_footer(text=f"SteamID: {steam_id}  •  Вышел офлайн: {now_str}")
            if remove_view:
                await asyncio.wait_for(msg.edit(embed=new_emb, view=None), timeout=5.0)
            else:
                await asyncio.wait_for(msg.edit(embed=new_emb), timeout=5.0)
    except (discord.NotFound, discord.HTTPException, asyncio.TimeoutError):
        pass
    except Exception as e:
        _log(f"⚠️ _mark_offline_msg ({steam_id}): {e}")

# ── Embed игрока ──────────────────────────────────────────────────────────────

def _build_player_embed(player: dict, profile, server: dict, score: int, is_watch: bool = False) -> discord.Embed:
    steam_id = player["steam_id"]
    mark     = _marks.get(steam_id)
    now_str  = _msk_str(datetime.now(timezone.utc), "%d.%m.%Y %H:%M")
    color = 0xf06060 if score >= 60 else (0xf08848 if score >= 40 else 0x4ecb8a)
    if mark == "clean":        color = 0x4ecb8a
    elif mark == "suspicious": color = 0xf06060
    elif mark == "watch":      color = 0xf08848
    prefix = "👁 " if is_watch else ""
    title  = f"{prefix}{player['nickname']}"
    if mark:
        title += f"  —  {_mark_label(mark)}"
    embed = discord.Embed(title=title, color=color, timestamp=datetime.now(timezone.utc))
    if profile and profile.get("avatar_full"):
        embed.set_thumbnail(url=profile["avatar_full"])
    embed.add_field(name="Скор", value=f"**{score}** — {_suspicion_label(score)}", inline=True)
    embed.add_field(
        name="Сервер",
        value=f"{server.get('site_name','?')}\n`{server.get('ip','?')}:{server.get('port','?')}`",
        inline=True
    )
    embed.add_field(
        name="Текущая игра",
        value=(
            f"Сторона: **{player.get('team','?').upper()}**\n"
            f"K/D: **{player.get('kills',0)}/{player.get('deaths',0)}**\n"
            f"Пинг: **{player.get('ping',0)} ms**"
        ),
        inline=True
    )
    if profile:
        stats = profile.get("stats")
        if stats:
            kills  = stats.get("kills", 0)
            deaths = stats.get("deaths", 0)
            kd_val = kills / deaths if deaths > 0 else kills
            hs     = stats.get("headshots", 0)
            hs_pct = (hs / kills * 100) if kills > 0 else 0
            embed.add_field(
                name="Статистика сайта",
                value=f"K/D: **{kd_val:.2f}**\nЧасы: **{stats.get('playtime',0)//3600} ч.**\nХедшоты: **{hs_pct:.1f}%**",
                inline=True
            )
        roles_lines = []
        ag = profile.get("adminGroup")
        
        # Ищем текст группы, отсекаем ID
        group_display = None
        if isinstance(ag, dict):
            group_display = ag.get("group_name")
        
        if not group_display or str(group_display).isdigit():
            group_display = profile.get("rank_name")
            
        if not group_display or str(group_display).isdigit():
            group_display = profile.get("rank")
            
        if group_display and not str(group_display).isdigit():
            roles_lines.append(f"Группа: **{group_display}**")
        else:
            roles_lines.append(f"Группа: **Игрок**")
        
        vip = profile.get("vipInfo")
        if vip and vip.get("isVip"):
            roles_lines.append(f"VIP: **{vip.get('group','').upper()}**")
        faceit = profile.get("faceitLevel")
        if faceit and faceit.get("level") is not None:
            roles_lines.append(f"Faceit: **LVL {faceit['level']}**")
        if roles_lines:
            embed.add_field(name="Роли", value="\n".join(roles_lines), inline=True)
        acc_lines = []
        try:
            dt = datetime.fromisoformat(profile.get("created_at","").replace("Z","+00:00"))
            acc_lines.append(f"Создан: **{_msk_str(dt, '%d.%m.%Y')}**")
        except Exception:
            pass
        try:
            dt2 = datetime.fromisoformat(profile.get("last_activity","").replace("Z","+00:00"))
            acc_lines.append(f"Активность: **{_msk_str(dt2)}**")
        except Exception:
            pass
        if acc_lines:
            embed.add_field(name="Аккаунт", value="\n".join(acc_lines), inline=True)
    embed.add_field(
        name="Ссылки",
        value=f"[Steam](https://steamcommunity.com/profiles/{steam_id})  •  [Fear](https://fearproject.ru/profile/{steam_id})",
        inline=False
    )
    embed.set_footer(text=f"SteamID: {steam_id}  •  Обновлено: {now_str}")
    return embed


# ── View с кнопками для каждого игрока ───────────────────────────────────────

class PlayerMarkView(discord.ui.View):
    def __init__(self, steam_id: str, nickname: str, server_ip: str = "", server_port: str = "", is_watch: bool = False):
        super().__init__(timeout=None)
        self.steam_id   = steam_id
        self.nickname   = nickname
        self.server_ip  = server_ip
        self.server_port = server_port
        self.add_item(discord.ui.Button(label="Чистый",          style=discord.ButtonStyle.success,   custom_id=f"pm_clean_{steam_id}"))
        self.add_item(discord.ui.Button(label="Подозрительный",  style=discord.ButtonStyle.danger,    custom_id=f"pm_sus_{steam_id}"))
        self.add_item(discord.ui.Button(label="Наблюдение",       style=discord.ButtonStyle.secondary, custom_id=f"pm_watch_{steam_id}"))
        if not is_watch:
            self.add_item(discord.ui.Button(label="Сбросить",     style=discord.ButtonStyle.secondary, custom_id=f"pm_reset_{steam_id}"))
        self.add_item(discord.ui.Button(label="История (7 дней)", style=discord.ButtonStyle.primary,   custom_id=f"pm_hist_{steam_id}"))
        if server_ip and server_port:
            self.add_item(discord.ui.Button(label=f"🔗 Подключиться", style=discord.ButtonStyle.secondary, custom_id=f"pm_connect_{steam_id}"))

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if not _is_admin(interaction):
            try:
                await interaction.response.send_message("Нет прав.", ephemeral=True)
            except Exception:
                pass
            return False
        cid = interaction.data.get("custom_id", "")
        sid = self.steam_id
        if cid == f"pm_clean_{sid}":
            # Помечаем чистым и удаляем сообщение
            await _apply_mark(interaction, sid, self.nickname, "clean")
            # Удаляем из обоих каналов
            sus_channel   = bot.get_channel(SUSPICIOUS_CHANNEL_ID)
            watch_channel = bot.get_channel(WATCH_CHANNEL_ID)
            if sus_channel:
                await _delete_player_msg(sus_channel, sid, _sus_msg_ids)
            if watch_channel:
                await _delete_player_msg(watch_channel, sid, _watch_msg_ids)
        elif cid == f"pm_sus_{sid}":
            await _apply_mark(interaction, sid, self.nickname, "suspicious")
        elif cid == f"pm_watch_{sid}":
            await _apply_mark(interaction, sid, self.nickname, "watch")
        elif cid == f"pm_reset_{sid}":
            await _apply_mark(interaction, sid, self.nickname, None)
        elif cid == f"pm_connect_{sid}":
            await interaction.response.send_message(
                f"```connect {self.server_ip}:{self.server_port}```",
                ephemeral=True
            )
        elif cid == f"pm_hist_{sid}":
            events = _history.get(sid, [])
            if not events:
                await interaction.response.send_message("История пуста.", ephemeral=True)
            else:
                lines = []
                for e in reversed(events[-20:]):
                    try:
                        dt = datetime.fromisoformat(e["time"]).astimezone()
                        lines.append(f"`{dt.strftime('%d.%m %H:%M')}` {e['event']}")
                    except Exception:
                        lines.append(e["event"])
                emb = discord.Embed(title=f"История — {self.nickname}", description="\n".join(lines), color=0x6c9fff)
                await interaction.response.send_message(embed=emb, ephemeral=True)
        return False

async def _apply_mark(interaction: discord.Interaction, steam_id: str, nickname: str, mark):
    old_mark = _marks.get(steam_id)
    if mark is None:
        _marks.pop(steam_id, None)
        label = "сброшена"
        _add_history(steam_id, f"Пометка сброшена ({interaction.user})")
    else:
        _marks[steam_id] = mark
        label = _mark_label(mark)
        _add_history(steam_id, f"Пометка: {_mark_label(old_mark) if old_mark else 'нет'} -> {label} ({interaction.user})")
    _save_marks()
    await interaction.response.send_message(f"Пометка для **{nickname}**: **{label}**", ephemeral=True)

    # Если поставили "наблюдение" — сразу проверяем онлайн и шлём в канал
    if mark == "watch":
        watch_channel = bot.get_channel(WATCH_CHANNEL_ID)
        if watch_channel:
            async with aiohttp.ClientSession() as session:
                servers = await _fetch_json(session, f"{API_BASE}/servers")
                found = False
                if servers:
                    for srv in servers:
                        for player in srv.get("live_data", {}).get("players", []):
                            if player.get("steam_id") == steam_id:
                                profile = await _get_profile(session, steam_id)
                                score = _suspicion_score(player, profile)
                                view = PlayerMarkView(steam_id, player["nickname"], srv.get("ip",""), str(srv.get("port","")), is_watch=True)
                                embed = _build_player_embed(player, profile, srv, score, is_watch=True)
                                await _upsert_player_msg(watch_channel, steam_id, embed, view, _watch_msg_ids)
                                found = True
                                break
                        if found:
                            break
                if not found:
                    embed = discord.Embed(
                        title=f"👁 {nickname}",
                        description=f"Добавлен в наблюдение. Сейчас **офлайн**.\nКарточка появится когда зайдёт на сервер.",
                        color=0xf08848,
                        timestamp=datetime.now(timezone.utc)
                    )
                    embed.set_footer(text=f"SteamID: {steam_id}")
                    await watch_channel.send(embed=embed)

    monitor_loop.restart()

# ── Доступ к командам ────────────────────────────────────────────────────────

ACCESS_ROLE_ID   = 1497217047502000309
ACCESS_LIST_FILE = Path(__file__).parent / "access_list.json"

def _load_access_list() -> list[dict]:
    if ACCESS_LIST_FILE.exists():
        try:
            return json.loads(ACCESS_LIST_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return []

def _save_access_list(lst: list[dict]):
    ACCESS_LIST_FILE.write_text(json.dumps(lst, ensure_ascii=False, indent=2), encoding="utf-8")

def _is_admin(interaction: discord.Interaction) -> bool:
    """Проверяет наличие прав администратора бота (полный доступ)."""
    user = interaction.user
    
    # 1. Владелец бота (по ID)
    if user.id == BOT_OWNER_ID:
        return True
    
    # 2. Администратор сервера Discord (автоматический доступ)
    if interaction.guild and isinstance(user, discord.Member):
        if user.guild_permissions.administrator:
            return True
    
    # 3. Роли с полным доступом (из конфига)
    if isinstance(user, discord.Member):
        user_roles = {r.id for r in user.roles}
        if bool(user_roles & STATS_FULL_ACCESS_ROLES):
            return True
    else:
        # Если это User (в ЛС), ищем его на серверах бота
        for guild in bot.guilds:
            member = guild.get_member(user.id)
            if member:
                user_roles = {r.id for r in member.roles}
                if bool(user_roles & STATS_FULL_ACCESS_ROLES):
                    return True
            
    # 4. Проверяем access_list (ручной список)
    access = _load_access_list()
    if any(str(e.get("discord_id")) == str(user.id) for e in access):
        return True
        
    # Логируем отказ в консоль для отладки
    _log(f"🚫 Отказ в доступе: {user} (ID: {user.id}) пытался использовать админ-команду.", discord=False)
    return False

@tree.command(name="accessadd", description="Добавить пользователя в список доступа к командам бота")
@app_commands.describe(user="Пользователь Discord", steamid="SteamID игрока (необязательно)")
async def cmd_accessadd(interaction: discord.Interaction, user: discord.User, steamid: str = ""):
    is_owner = interaction.user.id == BOT_OWNER_ID
    is_guild_admin = interaction.guild and interaction.user.guild_permissions.administrator
    if not (is_owner or is_guild_admin):
        return await interaction.response.send_message("Только администраторы или владелец бота могут управлять доступом.", ephemeral=True)
    
    lst = _load_access_list()
    if any(str(e.get("discord_id")) == str(user.id) for e in lst):
        return await interaction.response.send_message(f"{user.mention} уже в списке доступа.", ephemeral=True)
    lst.append({
        "discord_id": str(user.id),
        "name":       user.display_name,
        "steamid":    steamid
    })
    _save_access_list(lst)
    steam_str = f" | SteamID: `{steamid}`" if steamid else ""
    await interaction.response.send_message(f"✅ {user.mention} добавлен в список доступа{steam_str}", ephemeral=True)
    _log(f"➕ Доступ добавлен: {user.display_name} ({user.id}){steam_str}")

@tree.command(name="accessremove", description="Удалить пользователя из списка доступа")
@app_commands.describe(user="Пользователь Discord")
async def cmd_accessremove(interaction: discord.Interaction, user: discord.User):
    is_owner = interaction.user.id == BOT_OWNER_ID
    is_guild_admin = interaction.guild and interaction.user.guild_permissions.administrator
    if not (is_owner or is_guild_admin):
        return await interaction.response.send_message("Только администраторы или владелец бота могут управлять доступом.", ephemeral=True)
    
    lst = _load_access_list()
    new_lst = [e for e in lst if str(e.get("discord_id")) != str(user.id)]
    if len(new_lst) == len(lst):
        return await interaction.response.send_message(f"{user.mention} не найден в списке доступа.", ephemeral=True)
    _save_access_list(new_lst)
    await interaction.response.send_message(f"✅ {user.mention} удалён из списка доступа", ephemeral=True)
    _log(f"➖ Доступ удалён: {user.display_name} ({user.id})")

@tree.command(name="accesslist", description="Показать список пользователей с доступом к боту")
async def cmd_accesslist(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("Нет прав.", ephemeral=True)
    
    lst = _load_access_list()
    embed = discord.Embed(title=f"🔑 Список доступа ({len(lst)} чел.)", color=0x5865f2)
    if not lst:
        embed.description = "Список пуст."
    else:
        lines = []
        for e in lst:
            steam_str = f" | `{e['steamid']}`" if e.get("steamid") else ""
            line = f"<@{e['discord_id']}> — **{e['name']}**{steam_str}"
            # Проверка лимита 4096 символов для description
            if len("\n".join(lines)) + len(line) + 10 > 4000:
                lines.append(f"... и ещё {len(lst) - len(lines)} чел.")
                break
            lines.append(line)
        embed.description = "\n".join(lines)
    embed.set_footer(text=f"Роль с доступом: <@&{ACCESS_ROLE_ID}>")
    await interaction.response.send_message(embed=embed, ephemeral=True)


# ── Белый список (Whitelist) ──────────────────────────────────────────────────

@tree.command(name="addwhite", description="Добавить игрока в белый список (не будет в мониторинге и репортах)")
@app_commands.describe(steamid="SteamID игрока")
async def cmd_addwhite(interaction: discord.Interaction, steamid: str):
    if not _is_admin(interaction):
        return await interaction.response.send_message("❌ Нет прав.", ephemeral=True)
    
    steamid = steamid.strip()
    _whitelist.add(steamid)
    _save_whitelist()
    await interaction.response.send_message(f"✅ Игрок `{steamid}` добавлен в белый список.", ephemeral=True)
    _log(f"⚪️ Добавлен в белый список: {steamid} ({interaction.user})")

@tree.command(name="removewhite", description="Убрать игрока из белого списка")
@app_commands.describe(steamid="SteamID игрока")
async def cmd_removewhite(interaction: discord.Interaction, steamid: str):
    if not _is_admin(interaction):
        return await interaction.response.send_message("❌ Нет прав.", ephemeral=True)
    
    steamid = steamid.strip()
    if steamid in _whitelist:
        _whitelist.remove(steamid)
        _save_whitelist()
        await interaction.response.send_message(f"✅ Игрок `{steamid}` убран из белого списка.", ephemeral=True)
        _log(f"⚪️ Убран из белого списка: {steamid} ({interaction.user})")
    else:
        await interaction.response.send_message(f"❌ Игрок `{steamid}` не найден в белом списке.", ephemeral=True)

@tree.command(name="listwhite", description="Показать белый список игроков")
async def cmd_listwhite(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("❌ Нет прав.", ephemeral=True)
    
    if not _whitelist:
        return await interaction.response.send_message("⚪️ Белый список пуст.", ephemeral=True)
    
    lines = []
    wl_list = list(_whitelist)
    for sid in wl_list:
        line = f"`{sid}`"
        if len("\n".join(lines)) + len(line) + 10 > 4000:
            lines.append(f"... и ещё {len(wl_list) - len(lines)} чел.")
            break
        lines.append(line)
        
    embed = discord.Embed(
        title=f"⚪️ Белый список игроков ({len(wl_list)})",
        description="\n".join(lines),
        color=0xffffff
    )
    await interaction.response.send_message(embed=embed, ephemeral=True)

@tree.command(name="help", description="Показать список доступных команд")
async def cmd_help(interaction: discord.Interaction):
    embed = discord.Embed(
        title="📋 Команды бота",
        color=0x5865f2,
        timestamp=datetime.now(timezone.utc)
    )

    embed.add_field(name="👤 Профили и проверки", value=(
        "**/profile** — Профиль игрока (баланс, статистика, роль)\n"
        "**/checkinfo** — Проверка по номеру #N или SteamID\n"
        "**/mystats** — Твоя статистика наказаний\n"
        "**/find** — Поиск админа нику/Discord ID\n"
        "**/yooma** — Проверка на баны yooma.su\n"
        "**/staff** — Статистика наказаний"
    ), inline=False)

    embed.add_field(name="🏆 Дропы и топы", value=(
        "**/drops** — Дропы за дату\n"
        "**/fulldrops** — Полная таблица дропов\n"
        "**/avg_online** — Средний онлайн за день\n"
        "**/leaderstaff** — Топ стаффа по наказаниям"
    ), inline=False)

    embed.add_field(name="🔔 Трекинг", value=(
        "**/trackadd** — Добавить игрока на слежку\n"
        "**/trackremove** — Убрать со слежки\n"
        "**/tracklist** — Твой список отслеживания"
    ), inline=False)

    is_punish = _has_punishment_access(interaction.user)
    is_owner = _has_owner_access(interaction.user)

    if is_punish:
        embed.add_field(name="🔨 Наказания", value=(
            "**/ban** — Забанить игрока\n"
            "**/unban** — Разбанить\n"
            "**/mute** — Замутить (войс/чат)\n"
            "**/unmute** — Размутить\n"
            "**/ban16** — Бан за 1.6\n"
            "**/muteso** — Мут навсегда (ЧСО)\n"
            "**/my_punishments** — Мои баны/муты"
        ), inline=False)

    if is_owner:
        embed.add_field(name="👑 Управление", value=(
            "**/addadmin** — Добавить админа\n"
            "**/list_admins** — Список админов\n"
            "**/edit_admin** — Редактировать админа\n"
            "**/delete_admin** — Удалить админа\n"
            "**/freeze_admin** — Заморозить\n"
            "**/unfreeze_admin** — Разморозить\n"
            "**/edit_punishment** — Изменить наказание\n"
            "**/delete_punishment** — Удалить наказание\n"
            "**/promocode** — Создать промокод"
        ), inline=False)

    if _is_admin(interaction):
        embed.add_field(name="⚙ Панели и синхронизация", value=(
            "**/admin_online_panel** — Панель онлайн-админов\n"
            "**/suspicious_panel** — Панель подозрительных\n"
            "**/staffboard** — Панель статистики стаффа\n"
            "**/leaderstaff_panel** — Панель топ-3 стаффа\n"
            "**/adminsync** — Синхронизация админов\n"
            "**/staffsync** — Синхронизация стаффа\n"
            "**/autoreports** — Настройка автозакрытия"
        ), inline=False)

    await interaction.response.send_message(embed=embed, ephemeral=True)


@tree.command(name="confirm", description="Подтвердить регистрацию на сайте FearSearch")
@app_commands.describe(code="Код подтверждения из личного сообщения")
async def cmd_confirm_registration(interaction: discord.Interaction, code: str):
    try:
        await interaction.response.defer(ephemeral=True)
        discord_id = str(interaction.user.id)
        discord_name = str(interaction.user.display_name or interaction.user.name or interaction.user.global_name or "")
        result = await _confirm_registration(discord_id, code.strip().upper(), interaction, discord_name)
        await interaction.followup.send(result, ephemeral=True)
    except Exception as e:
        _log(f"❌ [Panel] Ошибка команды /confirm: {e}", discord=False)
        await interaction.followup.send("❌ Произошла ошибка при подтверждении.", ephemeral=True)


@tree.command(name="say", description="Отправить сообщение от имени бота")
@app_commands.describe(text="Текст сообщения")
async def cmd_say(interaction: discord.Interaction, text: str):
    if not _is_admin(interaction):
        return await interaction.response.send_message("❌ У вас недостаточно прав.", ephemeral=True)
    await interaction.response.send_message("✅ Отправлено", ephemeral=True)
    await interaction.channel.send(text)

@tree.command(name="embed", description="Отправить красивый embed-блок")
@app_commands.describe(title="Заголовок", description="Описание")
async def cmd_embed(interaction: discord.Interaction, title: str, description: str):
    if not _is_admin(interaction):
        return await interaction.response.send_message("❌ У вас недостаточно прав.", ephemeral=True)
    embed = discord.Embed(title=title, description=description, color=0x5865f2, timestamp=datetime.now(timezone.utc))
    await interaction.response.send_message("✅ Отправлено", ephemeral=True)
    await interaction.channel.send(embed=embed)

@tree.command(name="edit", description="Изменить текстовое сообщение бота")
@app_commands.describe(message_id="ID сообщения", text="Новый текст")
async def cmd_edit(interaction: discord.Interaction, message_id: str, text: str):
    if not _is_admin(interaction):
        return await interaction.response.send_message("❌ У вас недостаточно прав.", ephemeral=True)
    try:
        msg = await interaction.channel.fetch_message(int(message_id))
        await msg.edit(content=text)
        await interaction.response.send_message("✅ Изменено", ephemeral=True)
    except Exception as e:
        await interaction.response.send_message(f"Ошибка: {e}", ephemeral=True)

@tree.command(name="editembed", description="Изменить embed-сообщение бота")
@app_commands.describe(message_id="ID сообщения", title="Новый заголовок", description="Новое описание")
async def cmd_editembed(interaction: discord.Interaction, message_id: str, title: str, description: str):
    if not _is_admin(interaction):
        return await interaction.response.send_message("❌ У вас недостаточно прав.", ephemeral=True)
    try:
        msg = await interaction.channel.fetch_message(int(message_id))
        embed = discord.Embed(title=title, description=description, color=0x5865f2, timestamp=datetime.now(timezone.utc))
        await msg.edit(embed=embed)
        await interaction.response.send_message("✅ Изменено", ephemeral=True)
    except Exception as e:
        await interaction.response.send_message(f"Ошибка: {e}", ephemeral=True)

@tree.command(name="update", description="Опубликовать пост об обновлении программы")
@app_commands.describe(version="Версия обновления")
async def cmd_update(interaction: discord.Interaction, version: str):
    if not _is_admin(interaction):
        return await interaction.response.send_message("❌ У вас недостаточно прав.", ephemeral=True)
    channel = bot.get_channel(UPDATES_CHANNEL_ID)
    if not channel:
        return await interaction.response.send_message("Канал обновлений не найден.", ephemeral=True)
    embed = discord.Embed(
        title=f"🔄 Обновление Fear Search {version}",
        description=f"Вышла новая версия **{version}**!\n\n[Скачать на GitHub]({GITHUB_URL})",
        color=0x57f287,
        timestamp=datetime.now(timezone.utc)
    )
    embed.set_footer(text=f"Fear Search • {version}")
    await channel.send(embed=embed)
    await interaction.response.send_message(f"✅ Пост об обновлении {version} опубликован", ephemeral=True)

@tree.command(name="announce", description="Отправить объявление в канал")
@app_commands.describe(channel="Канал для объявления", text="Текст объявления")
async def cmd_announce(interaction: discord.Interaction, channel: discord.TextChannel, text: str):
    if not _is_admin(interaction):
        return await interaction.response.send_message("Нет прав.", ephemeral=True)
    embed = discord.Embed(description=text, color=0xfee75c, timestamp=datetime.now(timezone.utc))
    embed.set_author(name=interaction.user.display_name, icon_url=interaction.user.display_avatar.url)
    await channel.send(embed=embed)
    await interaction.response.send_message(f"✅ Объявление отправлено в {channel.mention}", ephemeral=True)

TICKET_SUPPORT_ROLE_ID = 1463269872350920704  # роль которую пингуем при создании тикета


class TicketButton(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="🎫 Открыть тикет", style=discord.ButtonStyle.primary, custom_id="open_ticket")
    async def open_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild    = interaction.guild
        category = guild.get_channel(TICKETS_CATEGORY_ID)
        existing = discord.utils.get(guild.text_channels, name=f"ticket-{interaction.user.name.lower()}")
        if existing:
            return await interaction.response.send_message(
                f"У вас уже открыт тикет: {existing.mention}", ephemeral=True
            )
        overwrites = {
            guild.default_role: discord.PermissionOverwrite(read_messages=False),
            interaction.user:   discord.PermissionOverwrite(read_messages=True, send_messages=True),
        }
        support_role = guild.get_role(SUPPORT_ROLE_ID)
        if support_role:
            overwrites[support_role] = discord.PermissionOverwrite(read_messages=True, send_messages=True)
        ticket_role = guild.get_role(TICKET_SUPPORT_ROLE_ID)
        if ticket_role and ticket_role != support_role:
            overwrites[ticket_role] = discord.PermissionOverwrite(read_messages=True, send_messages=True)
        try:
            ch = await guild.create_text_channel(
                f"ticket-{interaction.user.name.lower()}",
                category=category,
                overwrites=overwrites
            )
            embed = discord.Embed(
                title="🎫 Тикет открыт",
                description=(
                    f"Привет, {interaction.user.mention}! Опиши свою проблему, и поддержка скоро ответит.\n\n"
                    f"**Кнопки управления:**\n"
                    f"• 🔔 Пингануть поддержку — если долго нет ответа\n"
                    f"• 🔒 Закрыть тикет — когда вопрос решён"
                ),
                color=0x5865f2
            )
            # Пингуем роль поддержки
            ping_text = f"<@&{TICKET_SUPPORT_ROLE_ID}> — новый тикет от {interaction.user.mention}"
            await ch.send(content=ping_text, embed=embed, view=TicketControlView(interaction.user.id))
            await interaction.response.send_message(f"✅ Тикет создан: {ch.mention}", ephemeral=True)
        except Exception as e:
            await interaction.response.send_message(f"❌ Ошибка создания тикета: {e}", ephemeral=True)


class TicketControlView(discord.ui.View):
    """Кнопки управления внутри тикета."""
    def __init__(self, owner_id: int = 0):
        super().__init__(timeout=None)
        self.owner_id = owner_id

    @discord.ui.button(label="🔔 Пингануть поддержку", style=discord.ButtonStyle.secondary, custom_id="ticket_ping")
    async def ping_support(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_message(
            f"<@&{TICKET_SUPPORT_ROLE_ID}> {interaction.user.mention} ждёт ответа!",
            allowed_mentions=discord.AllowedMentions(roles=True)
        )

    @discord.ui.button(label="🔒 Закрыть тикет", style=discord.ButtonStyle.danger, custom_id="ticket_close")
    async def close_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        # Закрыть может создатель тикета или администратор/роль поддержки
        is_owner = False
        # Ищем создателя по имени канала
        ch_name = interaction.channel.name  # ticket-username
        if ch_name.startswith("ticket-"):
            uname = ch_name[len("ticket-"):]
            if interaction.user.name.lower() == uname:
                is_owner = True
        has_perm = (
            is_owner
            or interaction.user.guild_permissions.administrator
            or any(r.id in (SUPPORT_ROLE_ID, TICKET_SUPPORT_ROLE_ID) for r in interaction.user.roles)
        )
        if not has_perm:
            return await interaction.response.send_message(
                "Закрыть тикет может только его создатель или поддержка.", ephemeral=True
            )
        embed = discord.Embed(
            title="🔒 Тикет закрыт",
            description=f"Закрыт пользователем {interaction.user.mention}",
            color=0xe74c3c,
            timestamp=datetime.now(timezone.utc)
        )
        await interaction.response.send_message(embed=embed)
        _log(f"🔒 [TICKET] Тикет #{interaction.channel.name} закрыт пользователем {interaction.user} ({interaction.user.id})", discord=False)
        await asyncio.sleep(5)
        try:
            await interaction.channel.delete(reason=f"Тикет закрыт: {interaction.user}")
        except Exception as e:
            _log(f"❌ Ошибка удаления тикета: {e}")

@tree.command(name="ticket", description="Разместить панель открытия тикетов")
async def cmd_ticket(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("Нет прав.", ephemeral=True)
    embed = discord.Embed(
        title="🎫 Поддержка Fear Search",
        description="Нажмите кнопку ниже, чтобы открыть тикет и получить помощь.",
        color=0x5865f2
    )
    await interaction.channel.send(embed=embed, view=TicketButton())
    await interaction.response.send_message("✅ Панель тикетов размещена", ephemeral=True)

@tree.command(name="mark", description="Поставить пометку на игрока по SteamID")
@app_commands.describe(
    steamid="SteamID игрока",
    action="Тип пометки"
)
@app_commands.choices(action=[
    app_commands.Choice(name="Чистый (скрыть из списка)", value="clean"),
    app_commands.Choice(name="Подозрительный",            value="suspicious"),
    app_commands.Choice(name="Наблюдение",                value="watch"),
    app_commands.Choice(name="Сбросить",                  value="reset"),
])
async def cmd_mark(interaction: discord.Interaction, steamid: str, action: str):
    if not _is_admin(interaction):
        return await interaction.response.send_message("Нет прав.", ephemeral=True)
    value = None if action == "reset" else action
    await _apply_mark(interaction, steamid, steamid, value)

@tree.command(name="newadmins", description="Показать онлайн-админов с менее чем 15 часами на сайте")
async def cmd_newadmins(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("❌ У вас недостаточно прав.", ephemeral=True)
    await interaction.response.defer(ephemeral=True)
    channel = bot.get_channel(SUSPICIOUS_CHANNEL_ID)
    if not channel:
        return await interaction.followup.send("Канал не найден.", ephemeral=True)
    try:
        async with aiohttp.ClientSession() as session:
            servers = await _fetch_json(session, f"{API_BASE}/servers")
            if not servers:
                return await interaction.followup.send("Не удалось получить данные серверов.", ephemeral=True)
            results = []
            for srv in servers:
                for player in srv.get("live_data", {}).get("players", []):
                    if not player.get("is_admin"):
                        continue
                    profile = await _get_profile(session, player["steam_id"])
                    stats = profile.get("stats") if profile else None
                    playtime_h = (stats.get("playtime", 0) / 3600) if stats else 0
                    if playtime_h < 15:
                        results.append((player, profile, srv, playtime_h))
            if not results:
                return await interaction.followup.send("Нет онлайн-админов с менее чем 15 часами.", ephemeral=True)
            for player, profile, srv, playtime_h in results:
                steam_id = player["steam_id"]
                score = _suspicion_score(player, profile)
                embed = _build_player_embed(player, profile, srv, score)
                embed.set_footer(text=f"SteamID: {steam_id}  •  Часов на сайте: {playtime_h:.1f}")
                await channel.send(embed=embed)
                _log(f"🆕 Новый админ с малым временем: {player['nickname']} ({playtime_h:.1f}ч)")
        await interaction.followup.send(f"✅ Отправлено {len(results)} карточек в <#{SUSPICIOUS_CHANNEL_ID}>", ephemeral=True)
    except Exception as e:
        _log(f"❌ /newadmins ошибка: {e}")
        await interaction.followup.send(f"Ошибка: {e}", ephemeral=True)

# ── Мониторинг подозрительных игроков ──────────────────────────────────────────

async def _calc_suspicion_score(player: dict, profile: dict | None) -> tuple[int, list[str]]:
    """Вычисляет 'балл подозрительности' и возвращает список причин."""
    score = 0
    reasons = []
    
    steam_id = player.get("steam_id", "")
    if not steam_id:
        return 0, []

    if profile:
        stats = profile.get("stats", {})
        # VAC бан
        if stats.get("vac_banned"):
            days = stats.get("days_since_last_ban", 0)
            if days < 60:
                score += 30
                reasons.append(f"🚫 Свежий VAC Бан (+30) ({days} дн. назад)")
            elif days >= 100:
                score += 10
                reasons.append(f"🚫 Старый VAC Бан (+10) ({days} дн. назад)")
            
        # Возраст аккаунта на сайте Fear
        created_at_raw = stats.get("created_at")
        if created_at_raw:
            try:
                created_at = datetime.fromisoformat(created_at_raw.replace("Z", "+00:00"))
                account_age_days = (datetime.now(timezone.utc) - created_at).days
                if account_age_days < 31:
                    score += 20
                    reasons.append(f"🐣 Новый аккаунт (+20) ({account_age_days} дн. на сайте)")
                elif account_age_days < 90:
                    score += 10
                    reasons.append(f"🐣 Свежий аккаунт (+10) ({account_age_days} дн. на сайте)")
            except: pass

        # КД (как на сайте)
        kd = stats.get("kd")
        if kd is None:
            kills = stats.get("kills", 0)
            deaths = stats.get("deaths", 1) or 1
            kd = kills / deaths
        
        if kd > 4.0:
            score += 100
            reasons.append(f"🎯 Критический КД (+100) ({kd:.2f})")
        elif kd > 2.5:
            score += 30
            reasons.append(f"🎯 Высокий КД (+30) ({kd:.2f})")
        elif kd > 1.6:
            score += 20
            reasons.append(f"🎯 Подозрительный КД (+20) ({kd:.2f})")

        # Playtime
        playtime_h = stats.get("playtime", 0) / 3600
        if playtime_h < 5:
            score += 25
            reasons.append(f"⏳ Очень мало часов (+25) ({playtime_h:.1f}ч)")
        elif playtime_h < 10:
            score += 10
            reasons.append(f"⏳ Мало часов (+10) ({playtime_h:.1f}ч)")
    else:
        # Профиль не найден - по ТЗ баллы не даем
        pass
    
    return score, reasons

def _suspicion_rules_legend() -> str:
    return (
        "🎯 КД > 4.0: +100\n"
        "🎯 КД > 2.5: +30\n"
        "🎯 КД > 1.6: +20\n"
        "⏳ Часы < 5: +25\n"
        "⏳ Часы < 10: +10\n"
        "🐣 Аккаунт < 31 дн.: +20\n"
        "🐣 Аккаунт < 90 дн.: +10\n"
        "🚫 VAC < 60 дн.: +30\n"
        "🚫 VAC ≥ 100 дн.: +10"
    )

async def _build_suspicious_embed() -> discord.Embed:
    """Собирает топ подозрительных игроков онлайн."""
    async with aiohttp.ClientSession() as session:
        servers = await _fetch_json(session, f"{API_BASE}/servers")
        if not servers:
            return discord.Embed(title="⚠️ Ошибка получения данных серверов", color=0x36393f)
            
        all_players = []
        for srv in servers:
            for p in srv.get("live_data", {}).get("players", []):
                sid = str(p.get("steam_id", "")).strip()
                # Пропускаем игроков из белого списка
                if sid in _whitelist:
                    continue
                all_players.append((p, srv))
        
        scored_players = []
        # Берем только топ по киллам или просто всех и скорим (ограничим для скорости)
        scan_targets = all_players[:250]
        sem = asyncio.Semaphore(35)

        async def _score_one(item):
            p, srv = item
            async with sem:
                profile = await _get_profile(session, p["steam_id"])
                score, reasons = await _calc_suspicion_score(p, profile)
                if score >= 40:
                    return {
                        "player": p,
                        "srv": srv,
                        "score": score,
                        "reasons": reasons,
                        "profile": profile
                    }
                return None

        scored = await asyncio.gather(*[_score_one(item) for item in scan_targets])
        scored_players = [s for s in scored if s]
        
        # Сортируем по убыванию подозрительности
        scored_players.sort(key=lambda x: x["score"], reverse=True)
        
        embed = discord.Embed(
            title="🕵️ Мониторинг подозрительных игроков онлайн",
            description=f"Всего подозрительных: **{len(scored_players)}**\nОбновлено: <t:{int(datetime.now().timestamp())}:R>",
            color=0xff4747
        )
        # embed.add_field(name="Шкала баллов", value=_suspicion_rules_legend(), inline=False)
        
        for i, item in enumerate(scored_players[:10], 1):
            p = item["player"]
            srv = item["srv"]
            reasons_str = " • ".join(item["reasons"]) if item["reasons"] else "—"
            
            # Берем КД из профиля если есть
            stats = item["profile"].get("stats", {}) if item["profile"] else {}
            kd = stats.get("kd")
            kills = p.get("kills", 0)
            deaths = p.get("deaths", 1) or 1
            if kd is None:
                kd = kills / deaths
            
            # Эмодзи статуса
            status_emoji = "🔴" if item["score"] >= 60 else "🟡"
            
            embed.add_field(
                name=f"{status_emoji} #{i} {p['nickname']} (Баллы: {item['score']})",
                value=(
                    f"SteamID: `{p['steam_id']}`\n"
                    f"🛡 **Причины:** {reasons_str}\n"
                    f"📊 **КД: `{kd:.2f}`** ({kills}/{deaths})\n"
                    f"🌐 Сервер: **{srv.get('site_name', srv.get('name', '—'))}**\n"
                    f"`connect {srv.get('ip')}:{srv.get('port')}`\n"
                    f"[Профиль Fear](https://fearproject.ru/profile/{p['steam_id']}) • [Steam](https://steamcommunity.com/profiles/{p['steam_id']})"
                ),
                inline=False
            )
            
        if not scored_players:
            embed.description = "✅ Чисто! Подозрительных игроков не найдено."
            
        return embed

@tasks.loop(minutes=1)
async def suspicious_monitor_loop():
    """Фоновое обновление панели подозрительных игроков."""
    # Загружаем сохраненный ID панели
    panel_info = _load_suspicious_panel()
    channel_id = panel_info.get("channel_id") or SUSPICIOUS_MONITOR_CHANNEL_ID
    message_id = panel_info.get("message_id")
    
    channel = bot.get_channel(channel_id)
    if not channel:
        try:
            channel = await bot.fetch_channel(channel_id)
        except:
            return
        
    try:
        embed = await _build_suspicious_embed()
        
        # Если есть сохраненный message_id, пробуем редактировать
        if message_id:
            try:
                msg = await channel.fetch_message(message_id)
                await msg.edit(embed=embed)
                return
            except discord.NotFound:
                # Если сообщение удалено, сбросим ID
                message_id = None
            except Exception as e:
                _log(f"⚠️ Ошибка обновления панели по ID: {e}")
        
        # Если ID нет или сообщение не найдено, ищем в истории (как запасной вариант)
        msg = await _find_panel_in_history(channel, "🕵️ Мониторинг подозрительных", limit=200)
        if msg:
            await msg.edit(embed=embed)
            _save_suspicious_panel(channel.id, msg.id)
            return

        await _purge_bot_messages(channel, limit=200)
        msg = await channel.send(embed=embed)
        _save_suspicious_panel(channel.id, msg.id)
    except Exception as e:
        _log(f"❌ suspicious_monitor_loop error: {e}")

@tree.command(name="suspicious_panel", description="Создать автообновляемую панель подозрительных игроков")
async def cmd_suspicious_panel(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("❌ Недостаточно прав.", ephemeral=True)
        
    await interaction.response.defer(ephemeral=True)
    embed = await _build_suspicious_embed()
    msg = await interaction.channel.send(embed=embed)
    _save_suspicious_panel(interaction.channel.id, msg.id)
    await interaction.followup.send("✅ Панель создана и будет обновляться каждые 5 минут.", ephemeral=True)

@tree.command(name="scan_players", description="Полное сканирование всех игроков онлайн на наличие VAC, новых аккаунтов и внешних банов")
async def cmd_scan_players(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("❌ Недостаточно прав.", ephemeral=True)
        
    await interaction.response.defer(ephemeral=True)
    
    try:
        async with aiohttp.ClientSession() as session:
            # 1. Получаем список серверов и игроков
            servers = await _fetch_json(session, f"{API_BASE}/servers")
            if not servers:
                return await interaction.followup.send("❌ Не удалось получить данные серверов.", ephemeral=True)
            
            all_players_srv = []
            for srv in servers:
                players = srv.get("live_data", {}).get("players", [])
                for p in players:
                    sid = str(p.get("steam_id", "")).strip()
                    if sid in _whitelist:
                        continue
                    all_players_srv.append((p, srv))
            
            if not all_players_srv:
                return await interaction.followup.send("ℹ️ На серверах сейчас нет игроков.", ephemeral=True)
            
            # Ограничиваем количество для стабильности (макс 100 за раз)
            scan_limit = 100
            targets = all_players_srv[:scan_limit]
            
            # 2. Параллельно собираем данные из всех источников
            # Используем семафор, чтобы не спамить в API
            sem = asyncio.Semaphore(20)
            
            async def scan_single_player(player, srv):
                async with sem:
                    sid = player["steam_id"]
                    flags = []
                    
                    # Запросы к внешним источникам параллельно
                    profile_task = _get_profile(session, sid)
                    steam_task   = _fetch_external_steam_info(session, sid)
                    yooma_task   = _check_yooma_ban(session, sid, player.get("nickname", ""))
                    cs2red_task  = _check_cs2red_ban(session, sid)
                    
                    profile, steam, yooma, cs2red = await asyncio.gather(
                        profile_task, steam_task, yooma_task, cs2red_task
                    )
                    
                    # 1. Проверка VAC (через внешний сайт или Fear API)
                    vac_info = None
                    if steam["vac"] != "Clean" and steam["vac"] != "—":
                        vac_info = steam["vac"]
                    elif profile and profile.get("stats", {}).get("vac_banned"):
                        days = profile.get("stats", {}).get("days_since_last_ban", 0)
                        vac_info = f"{days} дн."
                    
                    if vac_info:
                        flags.append(f"VAC ({vac_info})")
                    
                    # 2. Проверка возраста Steam (через внешний сайт)
                    if steam["age_days"] is not None:
                        if steam["age_days"] < 365: # Новорег в Steam (меньше года)
                            flags.append(f"NEW ({steam['age_days']} дн.)")
                    elif steam["created_at"]:
                        flags.append(f"NEW ({steam['created_at']})")

                    # 3. Проверка профиля Fear
                    if profile:
                        stats = profile.get("stats", {})
                        if stats:
                            # Возраст на сайте Fear
                            created_raw = stats.get("created_at")
                            playtime_h = stats.get("playtime", 0) / 3600
                            if created_raw:
                                try:
                                    created_at = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
                                    age_fear = (datetime.now(timezone.utc) - created_at).days
                                    if age_fear < 31:
                                        flags.append(f"🆕 Fear: {age_fear} дн. ({playtime_h:.1f} ч.)")
                                except: pass
                            
                            # Мало часов на Fear (если еще не добавили через новорега)
                            if not any("🆕 Fear:" in f for f in flags) and playtime_h < 30:
                                flags.append(f"⏳ Fear: {playtime_h:.1f}ч")

                    # 4. Проверка Yooma
                    if yooma.get("found"):
                        active = [p for p in yooma["punishments"] if p["status"] == "active"]
                        if active:
                            flags.append(f"🔴 Yooma: {active[0]['reason']}")

                    # 5. Проверка CS2Red
                    if cs2red.get("found"):
                        active = [b for b in cs2red["bans"] if b["status"] == "active"]
                        if active:
                            flags.append(f"🔴 CS2Red: {active[0]['reason']}")
                    
                    # 6. Проверка КД
                    kills = player.get("kills", 0)
                    deaths = player.get("deaths", 1) or 1
                    kd = kills / deaths
                    if kd > 3.0 and kills > 5:
                        flags.append(f"🎯 КД {kd:.2f}")

                    if flags:
                        return {
                            "nick": player["nickname"],
                            "sid": sid,
                            "flags": flags,
                            "srv": srv.get("site_name") or srv.get("name") or "—",
                            "stats": f"{kills}/{deaths}"
                        }
                    return None

            # Запускаем все проверки параллельно
            tasks = [scan_single_player(p, s) for p, s in targets]
            scan_results = await asyncio.gather(*tasks)
            results = [r for r in scan_results if r]

            if not results:
                return await interaction.followup.send("✅ Чисто! Игроков с подозрительными фильтрами не найдено.", ephemeral=True)

            # 3. Формируем ответ
            embed = discord.Embed(
                title="🔍 Результаты сканирования онлайна",
                description=f"Проверено игроков: **{len(targets)}**\nНайдено подозрительных: **{len(results)}**",
                color=0x3498db,
                timestamp=datetime.now(timezone.utc)
            )
            
            # Лимит на 15 полей, чтобы не перегружать Embed
            for i, item in enumerate(results[:15], 1):
                flags_str = " • ".join(item["flags"])
                embed.add_field(
                    name=f"{i}. {item['nick']} ({item['stats']})",
                    value=f"🚩 {flags_str}\n🌐 {item['srv']} | [Fear](https://fearproject.ru/profile/{item['sid']})",
                    inline=False
                )
            
            if len(results) > 15:
                embed.set_footer(text=f"Показано 15 из {len(results)} результатов")
            
            await interaction.followup.send(embed=embed)

    except Exception as e:
        _log(f"❌ /scan_players error: {e}")
        await interaction.followup.send(f"❌ Произошла ошибка: {e}", ephemeral=True)

# ── Статистика стаффа ────────────────────────────────────────────────────────

CACHE_DIR      = Path(__file__).parent / "stats_cache"

if not CACHE_DIR.exists():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

def _load_staff_list() -> list[dict]:
    db = _load_staff_db()
    lst = []
    for sid, data in db.items():
        lst.append({
            "steamid": sid,
            "name": data.get("name", ""),
            "role": data.get("role", ""),
            "group_name": data.get("group_name", "")
        })
    return lst

def _save_staff_list(lst: list[dict]):
    pass # No longer needed, as we read from staff_db.json

def _load_cache(steam_id: str) -> dict | None:
    path = CACHE_DIR / f"fearsearch_bans_{steam_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None

def _get_staff_cache_files() -> list[tuple[str, dict, dict]]:
    """Возвращает список (steamid, data, staff_entry) только для людей из staff_list."""
    staff = _load_staff_list()
    result = []
    for entry in staff:
        sid = entry.get("steamid", "")
        if not sid:
            continue
        data = _load_cache(sid)
        if data is None:
            data = {"bans": [], "mutes": [], "updatedAt": "", "method": "none"}
        result.append((sid, data, entry))
    return result

def _calc_stats(data: dict, date_from: datetime | None = None, date_to: datetime | None = None) -> dict:
    bans  = data.get("bans", [])
    mutes = data.get("mutes", [])

    def _is_ticket_reason(item):
        reason = str(item.get("reason", "")).strip().lower()
        return reason in ("тикет", "тикет в дс", "напиши тикет в дс") or "тикет" in reason

    def in_period(item):
        if date_from is None and date_to is None:
            return True
        ts = item.get("created", 0)
        dt_utc = datetime.fromtimestamp(ts, tz=timezone.utc)
        msk = timezone(timedelta(hours=3))
        dt_msk = dt_utc.astimezone(msk)
        
        if date_from and dt_msk < date_from: return False
        if date_to   and dt_msk > date_to:   return False
        return True

    bans_f  = [b for b in bans  if in_period(b) and not _is_ticket_reason(b)]
    mutes_f = [m for m in mutes if in_period(m) and not _is_ticket_reason(m)]

    # status: 1=активно, 2=снято, 4=истек срок
    active_bans   = [b for b in bans_f  if int(b.get("status", 0)) == 1]
    active_mutes  = [m for m in mutes_f if int(m.get("status", 0)) == 1]
    removed_bans  = [b for b in bans_f  if int(b.get("status", 0)) == 2]
    removed_mutes = [m for m in mutes_f if int(m.get("status", 0)) == 2]
    expired_bans  = [b for b in bans_f  if int(b.get("status", 0)) == 4]
    expired_mutes = [m for m in mutes_f if int(m.get("status", 0)) == 4]

    # Разбивка банов по длительности
    def dur_category(item):
        dur = item.get("duration", 0)
        if dur <= 0:  return "perm"    # навсегда (duration <= 0 или отрицательный)
        if dur >= 5184000: return "perm"  # 60 дней+ считаем перм
        if dur >= 604800:  return "week"  # 7+ дней
        if dur >= 86400:   return "day"   # 1+ день
        return "short"                    # меньше суток

    ban_perm  = sum(1 for b in active_bans if dur_category(b) == "perm")
    ban_week  = sum(1 for b in active_bans if dur_category(b) == "week")
    ban_day   = sum(1 for b in active_bans if dur_category(b) == "day")
    ban_short = sum(1 for b in active_bans if dur_category(b) == "short")

    # bans = активные + истекшие (без снятых)
    # mutes = активные + истекшие (без снятых)
    # total = bans + mutes
    # removed = снятые баны + снятые муты
    all_bans  = len(active_bans) + len(expired_bans)
    all_mutes = len(active_mutes) + len(expired_mutes)
    all_total = all_bans + all_mutes
    all_removed = len(removed_bans) + len(removed_mutes)
    all_items = bans or mutes or [{}]
    return {
        "bans":          all_bans,
        "mutes":         all_mutes,
        "total":         all_total,
        "removed":       all_removed,
        "active_bans":   len(active_bans),
        "active_mutes":  len(active_mutes),
        "active_total":  len(active_bans) + len(active_mutes),
        "removed_bans":  len(removed_bans),
        "removed_mutes": len(removed_mutes),
        "ban_perm":      ban_perm,
        "ban_week":      ban_week,
        "ban_day":       ban_day,
        "ban_short":     ban_short,
        "admin_name":    all_items[0].get("admin", "—") if all_items[0] else "—",
        "updated_at":    data.get("updatedAt", ""),
    }

async def _fetch_punishments(session: aiohttp.ClientSession, steam_id: str) -> dict | None:
    """Пробует получить наказания через API fearproject. Приоритет на выданные (by-admin)."""
    # 1. Сначала пробуем получить наказания, ВЫДАННЫЕ этим админом (by-admin)
    try:
        url = f"{API_BASE}/fear/punishments/by-admin?admin_steamid={steam_id}"
        data = await _fetch_json(session, url)
        # Если в ответе есть список наказаний, возвращаем его
        if data and (data.get("bans") or data.get("mutes")):
            return data
    except Exception:
        pass

    # 2. Если ничего не найдено, пробуем bulk (наказания, полученные игроком)
    try:
        url = f"{API_BASE}/fear/punishments/bulk?steamids={steam_id}"
        data = await _fetch_json(session, url)
        if data:
            return data
    except Exception:
        pass
    return None

async def _refresh_cache(steam_id: str, session: aiohttp.ClientSession = None) -> dict | None:
    """Полное обновление кэша админа через поиск."""
    db = _load_staff_db()
    entry = db.get(steam_id) or {"steamid": steam_id, "name": steam_id}
    
    # 1. Сначала делаем глубокий поиск по SteamID (как в /mystats)
    if session:
        await _update_cache_for_staff(session, entry)
    else:
        async with aiohttp.ClientSession() as s:
            await _update_cache_for_staff(s, entry)
            
    return _load_cache(steam_id)

def _period_label(date_from: datetime | None, date_to: datetime | None) -> str:
    if date_from is None and date_to is None:
        return "Всё время"
    fmt = "%d.%m.%Y"
    if date_from and date_to:
        return f"{date_from.strftime(fmt)} — {date_to.strftime(fmt)}"
    if date_from:
        return f"с {date_from.strftime(fmt)}"
    return f"до {date_to.strftime(fmt)}"

def _month_weeks(year: int, month: int) -> list[tuple[datetime, datetime]]:
    """Возвращает недели начиная с понедельника (weekday=0).
    Неделя: понедельник 00:00 — воскресенье 23:59:59 (MSK).
    Показываем только недели, пересекающиеся с указанным месяцем."""
    import calendar
    msk = timezone(timedelta(hours=3))
    _, days_in_month = calendar.monthrange(year, month)

    first_day = datetime(year, month, 1, tzinfo=msk)
    days_since_mon = first_day.weekday()
    first_mon = first_day - timedelta(days=days_since_mon)

    weeks = []
    current = first_mon
    month_end = datetime(year, month, days_in_month, 23, 59, 59, tzinfo=msk)
    while current <= month_end:
        wstart = current
        wend   = current + timedelta(days=6, hours=23, minutes=59, seconds=59)
        if wend >= first_day and wstart <= month_end:
            weeks.append((wstart, wend))
        current += timedelta(days=7)
    return weeks

def _build_staff_embed(date_from: datetime | None = None, date_to: datetime | None = None) -> list:
    entries = _get_staff_cache_files()
    if not entries:
        return [discord.Embed(title="📊 Статистика стаффа", description="Нет стаффа в списке. Используй /staffadd.", color=0x5865f2)]

    rows = []
    for sid, data, entry in entries:
        s = _calc_stats(data, date_from, date_to)
        # Имя берём из staff_list, если в кэше нет
        name = entry.get("name") or s["admin_name"] or sid
        role = entry.get("role", "")
        rows.append((sid, s, name, role))
    rows.sort(key=lambda x: x[1]["total"], reverse=True)

    period = _period_label(date_from, date_to)
    lines = []
    for i, (sid, s, name, role) in enumerate(rows, 1):
        updated = ""
        if s["updated_at"]:
            try:
                dt = datetime.fromisoformat(s["updated_at"].replace("Z", "+00:00"))
                updated = f"*(обновлено {_msk_str(dt, '%d.%m %H:%M')})*"
            except Exception:
                pass
        role_str = f"  `{role}`" if role else ""
        lines.append(
            f"### {i}. {name}{role_str}  {updated}\n"
            f"🔨 **{s['bans']}**  🔇 **{s['mutes']}**  📊 **{s['total']}**  ✂️ {s['removed']}"
        )

    embeds = []
    current = ""
    embed_num = 1
    for line in lines:
        if len(current) + len(line) + 2 > 4000:
            e = discord.Embed(
                title=f"📊 Статистика стаффа — {period}" if embed_num == 1 else "\u200b",
                description=current, color=0x5865f2,
                timestamp=datetime.now(timezone.utc) if embed_num == 1 else None
            )
            if embed_num == 1:
                e.set_footer(text=f"🔨 Баны  🔇 Муты  📊 Всего  ✂️ Снято  •  {len(rows)} человек")
            embeds.append(e)
            current = line + "\n"
            embed_num += 1
        else:
            current += line + "\n"
    if current:
        e = discord.Embed(
            title=f"📊 Статистика стаффа — {period}" if embed_num == 1 else "\u200b",
            description=current, color=0x5865f2,
            timestamp=datetime.now(timezone.utc) if embed_num == 1 else None
        )
        if embed_num == 1:
            e.set_footer(text=f"🔨 Баны  🔇 Муты  📊 Всего  ✂️ Снято  •  {len(rows)} человек")
        embeds.append(e)
    return embeds


_MODER_PLUS_GROUPS = {"MODER", "STMODER", "STADMIN", "GLADMIN"}

def _build_leaderstaff_embed() -> discord.Embed:
    """Топ-3 стаффа по наказаниям (модератор и выше) за текущий месяц."""
    import calendar
    now = datetime.now(tz=timezone.utc)
    _, days = calendar.monthrange(now.year, now.month)
    df = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    dt = datetime(now.year, now.month, days, 23, 59, 59, tzinfo=timezone.utc)

    entries = _get_staff_cache_files()
    rows = []
    for sid, data, entry in entries:
        group = (entry.get("group_name") or "").strip().upper()
        if group not in _MODER_PLUS_GROUPS:
            continue
        s = _calc_stats(data, df, dt)
        name = entry.get("name") or s["admin_name"] or sid
        role = entry.get("role", "")
        rows.append((sid, s, name, role))
    rows.sort(key=lambda x: x[1]["total"], reverse=True)

    medals = ["🥇", "🥈", "🥉"]
    period = f"{MONTH_RU.get(now.month, now.month)} {now.year}"
    embed = discord.Embed(
        title=f"🏆 Лидеры стаффа — {period}",
        color=0xf0b840,
        timestamp=datetime.now(timezone.utc)
    )
    top3 = rows[:3]
    if not top3:
        embed.description = "Нет данных за текущий месяц."
    else:
        desc = ""
        for i, (sid, s, name, role) in enumerate(top3):
            role_str = f"  `{role}`" if role else ""
            desc += (
                f"## {medals[i]} {name}{role_str}\n"
                f"🔨 **{s['bans']}** банов  🔇 **{s['mutes']}** мутов  "
                f"📊 **{s['total']}** всего  ✂️ {s['removed']} снято\n\n"
            )
        embed.description = desc
    embed.set_footer(text=f"🔨 Баны  🔇 Муты  📊 Всего  ✂️ Снято")
    return embed


def _build_punishments_embed(limit: int = 15) -> discord.Embed:
    """Панель последних наказаний стаффа из глобального лога."""
    data = _load_all_punishments()
    staff_db = _load_staff_db()
    staff_ids = {str(sid).strip() for sid in staff_db.keys() if str(sid).strip()}
    all_items = []
    for pid, item in data.get("bans", {}).items():
        admin_sid = str(item.get("admin_steamid") or "").strip()
        if admin_sid and admin_sid not in staff_ids:
            continue
        item["_ptype"] = 1
        item["_pid"] = pid
        all_items.append(item)
    for pid, item in data.get("mutes", {}).items():
        admin_sid = str(item.get("admin_steamid") or "").strip()
        if admin_sid and admin_sid not in staff_ids:
            continue
        item["_ptype"] = 2
        item["_pid"] = pid
        all_items.append(item)
    # Сортируем по created (новые сверху)
    all_items.sort(key=lambda x: int(x.get("created") or 0), reverse=True)
    recent = all_items[:limit]

    lines = []
    for it in recent:
        ptype = it.get("_ptype", 1)
        emoji = "🔨" if ptype == 1 else "🔇"
        admin = it.get("admin") or it.get("admin_name") or it.get("admin_steamid") or "?"
        name = it.get("name") or "?"
        reason = _short_reason(it.get("reason", "—"))
        dur = _dur_str(it.get("duration", 0))
        status = int(it.get("status", 0))
        status_emoji = "🟢" if status == 1 else "🔴" if status == 2 else "⚪"
        pid = it.get("id", "?")
        lines.append(
            f"{emoji} {status_emoji} **{admin}** → **{name}** `{dur}` {reason} (id {pid})"
        )

    total_bans = len([b for b in data.get("bans", {}).values() if str(b.get("admin_steamid","")).strip() in staff_ids])
    total_mutes = len([m for m in data.get("mutes", {}).values() if str(m.get("admin_steamid","")).strip() in staff_ids])
    desc = "\n".join(lines) if lines else "Нет записанных наказаний."
    embed = discord.Embed(
        title="📝 Лог наказаний стаффа",
        description=desc,
        color=0x5865f2,
        timestamp=datetime.now(timezone.utc)
    )
    embed.set_footer(text=f"🔨 Банов: {total_bans}  🔇 Мутов: {total_mutes}  •  Последние {len(recent)}")
    return embed


# ── View для /staff — только кнопки ──────────────────────────────────────────

MONTH_RU = {
    1:"Январь",2:"Февраль",3:"Март",4:"Апрель",5:"Май",6:"Июнь",
    7:"Июль",8:"Август",9:"Сентябрь",10:"Октябрь",11:"Ноябрь",12:"Декабрь"
}

class StaffView(discord.ui.View):
    def __init__(self, mode: str = "month", year: int = None, month: int = None,
                 week_idx: int = None, date_from: datetime = None, date_to: datetime = None,
                 persistent: bool = False):
        # persistent=True — timeout=None, кнопки работают вечно (для /staffboard)
        super().__init__(timeout=None if persistent else 600)
        now = datetime.now(tz=timezone.utc)
        self.mode       = mode
        self.year       = year  or now.year
        self.month      = month or now.month
        self.week_idx   = week_idx
        self.date_from  = date_from
        self.date_to    = date_to
        self.persistent = persistent
        self._update_lock = asyncio.Lock()
        self._sync_to_current()
        self._build_buttons()

    def _sync_to_current(self):
        """Автоматически синхронизирует дату/неделю к текущему моменту."""
        now = datetime.now(tz=timezone.utc)
        # Если режим месяц/неделя — всегда показываем текущий месяц
        if self.mode in ("month", "week"):
            self.year = now.year
            self.month = now.month
        # Если режим неделя — автоматически определяем текущую неделю
        if self.mode == "week":
            self.week_idx = self._current_week_idx()

    def _current_week_idx(self) -> int:
        """Возвращает индекс текущей недели в текущем месяце (0-based)."""
        msk = timezone(timedelta(hours=3))
        now = datetime.now(tz=msk)
        weeks = _month_weeks(self.year, self.month)
        for i, (wstart, wend) in enumerate(weeks):
            if wstart <= now <= wend:
                return i
        return len(weeks) - 1 if weeks else 0

    def _build_buttons(self):
        self.clear_items()
        # Ряд 0: навигация по месяцам
        self.add_item(discord.ui.Button(label="◀", style=discord.ButtonStyle.secondary,
                                        custom_id="sv_prev_month", row=0))
        self.add_item(discord.ui.Button(
            label=f"{MONTH_RU[self.month]} {self.year}",
            style=discord.ButtonStyle.primary, custom_id="sv_cur_label", row=0, disabled=True))
        self.add_item(discord.ui.Button(label="▶", style=discord.ButtonStyle.secondary,
                                        custom_id="sv_next_month", row=0))
        self.add_item(discord.ui.Button(label="Весь месяц",
                                        style=discord.ButtonStyle.success if self.mode == "month" else discord.ButtonStyle.secondary,
                                        custom_id="sv_whole_month", row=0))
        self.add_item(discord.ui.Button(label="Всё время",
                                        style=discord.ButtonStyle.success if self.mode == "all" else discord.ButtonStyle.secondary,
                                        custom_id="sv_all_time", row=0))
        # Ряд 1-2: кнопки недель
        weeks = _month_weeks(self.year, self.month)
        for i, (wstart, wend) in enumerate(weeks):
            label = f"{wstart.day:02d}.{wstart.month:02d}–{wend.day:02d}.{wend.month:02d}"
            active = (self.mode == "week" and self.week_idx == i)
            self.add_item(discord.ui.Button(
                label=label,
                style=discord.ButtonStyle.success if active else discord.ButtonStyle.secondary,
                custom_id=f"sv_week_{i}", row=1 if i < 3 else 2))
        # Ряд 3: кнопки управления
        self.add_item(discord.ui.Button(label="📅 Свой период",
                                        style=discord.ButtonStyle.secondary,
                                        custom_id="sv_custom_period", row=3))

    def _get_period(self) -> tuple[datetime | None, datetime | None]:
        if self.mode == "all":
            return None, None
        
        msk = timezone(timedelta(hours=3))
        if self.mode == "month":
            import calendar
            _, days = calendar.monthrange(self.year, self.month)
            return (datetime(self.year, self.month, 1, tzinfo=msk),
                    datetime(self.year, self.month, days, 23, 59, 59, tzinfo=msk))
        if self.mode == "week":
            weeks = _month_weeks(self.year, self.month)
            if self.week_idx is not None and self.week_idx < len(weeks):
                return weeks[self.week_idx]
        if self.mode == "custom":
            return self.date_from, self.date_to
        return None, None

    async def _show(self, interaction: discord.Interaction):
        """Показывает текущую статистику (без обновления кэша)."""
        self._build_buttons()
        df, dt = self._get_period()
        embeds = await asyncio.to_thread(_build_staff_embed, df, dt)
        # Показываем все эмбеды (до 10 шт. лимит Discord на одно сообщение)
        if not interaction.response.is_done():
            await interaction.response.edit_message(embeds=embeds[:10], view=self)
        else:
            await interaction.edit_original_response(embeds=embeds[:10], view=self)
        if self.persistent and interaction.channel and getattr(interaction, "message", None):
            _save_staffboard_state(interaction.channel.id, interaction.message.id, self)

    async def _refresh_and_show(self, interaction: discord.Interaction):
        """Обновляет кэш, потом показывает статистику. Меняет сообщение на 'Обновляется...'."""
        if self._update_lock.locked():
            if not interaction.response.is_done():
                await interaction.response.send_message("⏳ Обновление уже идёт, подожди...", ephemeral=True)
            else:
                await interaction.followup.send("⏳ Обновление уже идёт, подожди...", ephemeral=True)
            return
        async with self._update_lock:
            # Сразу меняем сообщение чтобы не было "Приложение не отвечает"
            self._build_buttons()
            updating_embed = discord.Embed(
                title="⏳ Обновляется статистика...",
                description="Загружаю актуальные данные для всего стаффа. Подожди немного.",
                color=0xf0b840,
                timestamp=datetime.now(timezone.utc)
            )
            if not interaction.response.is_done():
                await interaction.response.edit_message(embed=updating_embed, view=self)
            else:
                await interaction.edit_original_response(embed=updating_embed, view=self)

            # Обновляем кэш
            staff_list = _load_staff_list()
            start = datetime.now()
            async with aiohttp.ClientSession() as session:
                updated = 0
                for i in range(0, len(staff_list), 5):
                    batch = staff_list[i:i + 5]
                    results = await asyncio.gather(*[
                        _update_cache_for_staff(session, entry) for entry in batch
                    ])
                    updated += sum(results)
                    await asyncio.sleep(0.1)
            elapsed = (datetime.now() - start).seconds
            _log(f"🔄 StaffView обновил кэш: {updated}/{len(staff_list)} за {elapsed}с")

            # Показываем обновлённую статистику
            self._build_buttons()
            df, dt = self._get_period()
            embeds = await asyncio.to_thread(_build_staff_embed, df, dt)
            await interaction.edit_original_response(embeds=embeds[:10], view=self)
            if self.persistent and interaction.channel and getattr(interaction, "message", None):
                _save_staffboard_state(interaction.channel.id, interaction.message.id, self)

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        cid = interaction.data.get("custom_id", "")

        if cid == "sv_prev_month":
            await interaction.response.defer()
            if self.month == 1: self.month, self.year = 12, self.year - 1
            else: self.month -= 1
            if self.mode == "week": self.week_idx = 0
            await self._show(interaction)

        elif cid == "sv_next_month":
            await interaction.response.defer()
            now = datetime.now(tz=timezone.utc)
            if not (self.year == now.year and self.month == now.month):
                if self.month == 12: self.month, self.year = 1, self.year + 1
                else: self.month += 1
                if self.mode == "week": self.week_idx = 0
            await self._show(interaction)

        elif cid == "sv_whole_month":
            await interaction.response.defer()
            self.mode = "month"
            await self._show(interaction)

        elif cid == "sv_all_time":
            await interaction.response.defer()
            self.mode = "all"
            await self._show(interaction)

        elif cid.startswith("sv_week_"):
            await interaction.response.defer()
            self.mode = "week"
            self.week_idx = int(cid.split("_")[2])
            await self._show(interaction)

        elif cid == "sv_custom_period":
            await interaction.response.send_modal(StaffCustomPeriodModal(self))

        return False


class StaffCustomPeriodModal(discord.ui.Modal, title="Свой период"):
    date_from_input = discord.ui.TextInput(
        label="Дата начала (дд.мм.гггг)",
        placeholder="01.04.2026",
        max_length=10
    )
    date_to_input = discord.ui.TextInput(
        label="Дата конца (дд.мм.гггг)",
        placeholder="30.04.2026",
        max_length=10
    )

    def __init__(self, view: StaffView):
        super().__init__()
        self.staff_view = view

    async def on_submit(self, interaction: discord.Interaction):
        try:
            df = datetime.strptime(self.date_from_input.value.strip(), "%d.%m.%Y").replace(tzinfo=timezone.utc)
            dt = datetime.strptime(self.date_to_input.value.strip(), "%d.%m.%Y").replace(
                hour=23, minute=59, second=59, tzinfo=timezone.utc)
            self.staff_view.mode      = "custom"
            self.staff_view.date_from = df
            self.staff_view.date_to   = dt
            await interaction.response.defer()
            await self.staff_view._show(interaction)
        except ValueError:
            await interaction.response.send_message(
                "Неверный формат даты. Используй дд.мм.гггг", ephemeral=True)


@tree.command(name="staffadd", description="Добавить человека в список стаффа")
@app_commands.describe(steamid="SteamID игрока", name="Имя", role="Роль (Модератор, Ст. Модер, Стафф...)")
async def cmd_staffadd(interaction: discord.Interaction, steamid: str, name: str, role: str = "Модератор"):
    if not _is_admin(interaction):
        return await interaction.response.send_message("Нет прав.", ephemeral=True)
    db = _load_staff_db()
    if steamid in db:
        return await interaction.response.send_message(f"`{steamid}` уже в списке.", ephemeral=True)
    db[steamid] = {
        "name": name,
        "role": role,
        "group_name": "STAFF",
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    _save_staff_db(db)
    # Убираем из ручного блэклиста если был
    blacklist = _load_staff_blacklist()
    if steamid in blacklist:
        blacklist.discard(steamid)
        _save_staff_blacklist(blacklist)
    await interaction.response.send_message(f"✅ Добавлен **{name}** (`{steamid}`) — {role}", ephemeral=True)
    _log(f"➕ Стафф добавлен вручную: {name} ({steamid}) — {role}")

@tree.command(name="staffremove", description="Удалить человека из списка стаффа (и добавить в блэклист)")
@app_commands.describe(steamid="SteamID игрока")
async def cmd_staffremove(interaction: discord.Interaction, steamid: str):
    if not _is_admin(interaction):
        return await interaction.response.send_message("Нет прав.", ephemeral=True)
    db = _load_staff_db()
    if steamid not in db:
        return await interaction.response.send_message(f"`{steamid}` не найден в списке.", ephemeral=True)
    name = db[steamid].get("name", steamid)
    del db[steamid]
    _save_staff_db(db)
    # Добавляем в ручной блэклист чтобы не вернулся при синхронизации
    blacklist = _load_staff_blacklist()
    blacklist.add(steamid)
    _save_staff_blacklist(blacklist)
    await interaction.response.send_message(f"✅ Удалён **{name}** (`{steamid}`) и добавлен в блэклист.", ephemeral=True)
    _log(f"➖ Стафф удалён вручную: {name} ({steamid})")

@tree.command(name="stafflist", description="Показать текущий список стаффа")
async def cmd_stafflist(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("❌ У вас недостаточно прав.", ephemeral=True)
    lst = _load_staff_list()
    if not lst:
        return await interaction.response.send_message("Список стаффа пуст.", ephemeral=True)
    # Группируем по роли
    by_role: dict[str, list] = {}
    for e in lst:
        r = e.get("role", "—")
        by_role.setdefault(r, []).append(e)
    embed = discord.Embed(title=f"👥 Список стаффа ({len(lst)} чел.)", color=0x5865f2)
    role_order = ["Стафф", "Ст. Модер", "Модератор", "Мл. Модератор"]
    for role in role_order:
        if role not in by_role:
            continue
        lines = [f"`{e['steamid']}` — **{e['name']}**" for e in by_role[role]]
        embed.add_field(name=role, value="\n".join(lines), inline=False)
    # Остальные роли
    for role, members in by_role.items():
        if role not in role_order:
            lines = [f"`{e['steamid']}` — **{e['name']}**" for e in members]
            embed.add_field(name=role, value="\n".join(lines), inline=False)
    await interaction.response.send_message(embed=embed, ephemeral=True)


# SteamID которые никогда не должны попадать в список стаффа
_STAFF_BLACKLIST = {
    "76561199795013192", "76561199642664362", "76561198388989868",
    "76561199097711339", "76561198748005575", "76561199077499521",
    "76561198007541774", "76561198162988388", "76561199077199811",
    "76561199561947019",
}

# Группы которые считаются стаффом (Мл.Модератор и выше)
# ADMIN и ADMIN+ сюда НЕ входят — они не отображаются в статистике стаффа
_STAFF_GROUPS = {
    "GLADMIN": "Гл. Администратор",
    "STADMIN": "Ст. Администратор",
    "STMODER": "Ст. Модер",
    "MODER":   "Модератор",
    "MLMODER": "Мл.Модератор",
    "STAFF":   "Стафф",
}

@tree.command(name="staffsync", description="Синхронизировать список стаффа с базой админов Fear Project")
async def cmd_staffsync(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("Нет прав.", ephemeral=True)
    await interaction.response.defer(ephemeral=True)
    try:
        res = await _sync_staff_list()
        
        if res.get("error"):
            return await interaction.followup.send(f"❌ Ошибка синхронизации: {res['error']}", ephemeral=True)

        embed = discord.Embed(
            title="✅ Синхронизация стаффа завершена",
            color=0x2ecc71,
            timestamp=datetime.now(timezone.utc)
        )
        embed.add_field(name="📊 Итого в списке", value=f"**{res['total']}**", inline=True)
        embed.add_field(name="➕ Добавлено/Обновлено", value=f"**{res['new'] + res['updated']}**", inline=True)
        embed.add_field(name="➖ Удалено", value=f"**{res['removed']}**", inline=True)

        await interaction.followup.send(embed=embed, ephemeral=True)
    except Exception as e:
        _log(f"Ошибка в /staffsync: {e}")
        await interaction.followup.send(f"❌ Произошла ошибка: {e}", ephemeral=True)

@tree.command(name="staff", description="Статистика наказаний стаффа (только вам)")
async def cmd_staff(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("Нет прав.", ephemeral=True)
    await interaction.response.defer(ephemeral=True)
    try:
        staff_list = _load_staff_list()
        if staff_list:
            await interaction.followup.send(
                f"⏳ Обновляю данные для **{len(staff_list)}** человек, подожди...",
                ephemeral=True
            )
            start = datetime.now()
            async with aiohttp.ClientSession() as session:
                updated = 0
                batch_size = 8
                for i in range(0, len(staff_list), batch_size):
                    batch = staff_list[i:i + batch_size]
                    results = await asyncio.gather(*[
                        _update_cache_for_staff(session, entry) for entry in batch
                    ])
                    updated += sum(results)
                    await asyncio.sleep(0.05)
            elapsed = (datetime.now() - start).seconds
            _log(f"📊 /staff: обновлён кэш {updated}/{len(staff_list)} за {elapsed}с")

        now = datetime.now(tz=timezone.utc)
        view = StaffView(mode="month", year=now.year, month=now.month)
        df, dt = view._get_period()
        embeds = await asyncio.to_thread(_build_staff_embed, df, dt)
        await interaction.edit_original_response(content=None, embed=embeds[0], view=view)
        for e in embeds[1:]:
            await interaction.followup.send(embed=e, ephemeral=True)
    except Exception as e:
        _log(f"❌ /staff ошибка: {e}")
        try:
            await interaction.edit_original_response(content=f"❌ Ошибка: {e}")
        except Exception:
            await interaction.followup.send(f"❌ Ошибка: {e}", ephemeral=True)


STAFFBOARD_FILE = Path(__file__).parent / "staffboard.json"
LEADERSTAFF_PANEL_FILE = Path(__file__).parent / "leaderstaff_panel.json"

# ── База данных стаффа с Discord привязкой ────────────────────────────────────
STAFF_DB_FILE = Path(__file__).parent / "staff_db.json"
STAFF_BLACKLIST_FILE = Path(__file__).parent / "staff_blacklist.json"

def _load_staff_blacklist() -> set[str]:
    if STAFF_BLACKLIST_FILE.exists():
        try:
            data = json.loads(STAFF_BLACKLIST_FILE.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return set(data)
        except Exception:
            pass
    return set()

def _save_staff_blacklist(sids: set[str]):
    _save_json_atomic(STAFF_BLACKLIST_FILE, list(sids))

# Роли с полным доступом к /stats (могут смотреть всех стаффов)
# Redefined above in Группы ролей

ROLE_MLMODER_ID = 1503512286223138900
ROLE_MODER_ID   = 1503512343202758666
ROLE_STMODER_ID = 1503512364404703392
SUSPICIOUS_MONITOR_CHANNEL_ID = 1509537956266901554

# Списки Discord ID для специальных ролей
CURATOR_DISCORD_IDS = {
    "873266684868325457"
}
STADMIN_DISCORD_IDS = {
    "948819481734545469",
    "1065634975120117760",
    "407923316289175562",
    "1398324386624180386"
}
GLADMIN_DISCORD_IDS = {
    "873266684868325457"
}
OWNER_DISCORD_IDS = {
    "534711158373089291"
}

# ── Online Stats ─────────────────────────────────────────────────────────────

def _load_online_stats() -> dict:
    """Загружает статистику онлайна из файла. Мигрирует старый формат."""
    if ONLINE_STATS_FILE.exists():
        try:
            data = json.loads(ONLINE_STATS_FILE.read_text(encoding="utf-8"))
            # Миграция: старый формат {date: {hour: {count, samples}}} -> {date: [{ts, online}]}
            changed = False
            for date_key in list(data.keys()):
                if isinstance(data[date_key], dict):
                    # Старый формат — удаляем, не конвертируем (данные невалидны)
                    del data[date_key]
                    changed = True
            if changed:
                _save_online_stats(data)
            return data
        except Exception:
            pass
    return {}

def _save_online_stats(data: dict):
    """Сохраняет статистику онлайна в файл."""
    _save_json_atomic(ONLINE_STATS_FILE, data)

def _record_online_count(count: int):
    """Записывает текущий онлайн как отдельный замер каждые 5 минут."""
    now = datetime.now()
    date_key = now.strftime("%Y-%m-%d")

    stats = _load_online_stats()
    if date_key not in stats:
        stats[date_key] = []

    stats[date_key].append({
        "ts": int(now.timestamp()),
        "online": count,
    })

    # Удаляем данные старше 7 дней
    cutoff = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    stats = {k: v for k, v in stats.items() if k >= cutoff}

    _save_online_stats(stats)

def _parse_date(date_str: str) -> str:
    """Парсит дату из разных форматов в YYYY-MM-DD."""
    if not date_str:
        return datetime.now().strftime("%Y-%m-%d")
    date_str = date_str.strip()
    for fmt in ("%d.%m.%Y", "%d.%m.%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(date_str, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return datetime.now().strftime("%Y-%m-%d")


def _calc_avg_online(date_str: str = None) -> dict:
    """Считает средний онлайн за день по отдельным замерам."""
    if date_str is None:
        date_str = datetime.now().strftime("%Y-%m-%d")

    stats = _load_online_stats()
    samples = stats.get(date_str, [])
    if not samples:
        return {"avg": 0, "peak": 0, "peak_hour": "—", "hours_tracked": 0, "samples": 0}

    online_values = [s.get("online", 0) for s in samples]
    avg = int(sum(online_values) / len(online_values))
    peak = max(online_values)

    # Пиковый час
    peak_ts = 0
    for s in samples:
        if s.get("online", 0) == peak:
            peak_ts = s.get("ts", 0)
            break
    peak_hour = datetime.fromtimestamp(peak_ts).strftime("%H:%M") if peak_ts else "—"

    # Уникальные часы с замерами
    hours = set()
    for s in samples:
        hours.add(datetime.fromtimestamp(s.get("ts", 0)).hour)

    return {"avg": avg, "peak": peak, "peak_hour": peak_hour, "hours_tracked": len(hours), "samples": len(samples)}

# ── Staff DB helpers ────────────────────────────────────────────────────────

def _load_staff_db() -> dict[str, dict]:
    """{ steamid: { "name": str, "discord_id": str|None, "discord_name": str|None, 
                   "role": str, "group_name": str, "updated_at": str } }"""
    return _load_json_with_fallback(STAFF_DB_FILE, {})

def _save_staff_db(data: dict):
    _save_json_atomic(STAFF_DB_FILE, data)

def _can_view_any_stats(user: discord.Member | discord.User) -> bool:
    """Проверяет есть ли у пользователя роль для просмотра статов всех стаффов."""
    if isinstance(user, discord.Member):
        user_roles = {r.id for r in user.roles}
        if bool(user_roles & STATS_FULL_ACCESS_ROLES):
            return True
    else:
        # Если это User (в ЛС), ищем его на серверах бота
        for guild in bot.guilds:
            member = guild.get_member(user.id)
            if member:
                user_roles = {r.id for r in member.roles}
                if bool(user_roles & STATS_FULL_ACCESS_ROLES):
                    return True
    
    # Проверяем access_list
    access = _load_access_list()
    if any(str(e.get("discord_id")) == str(user.id) for e in access):
        return True
    return False

def _has_yooma_restriction(user: discord.Member | discord.User) -> bool:
    """Проверяет, есть ли у пользователя ограничение на использование Yooma."""
    if getattr(user, "id", None) == BOT_OWNER_ID:
        return False

    allowed_roles = set(STAFF_ROLES) | set(STATS_FULL_ACCESS_ROLES)

    if isinstance(user, discord.Member):
        user_roles = {r.id for r in user.roles}
        return not bool(user_roles & allowed_roles)

    for guild in bot.guilds:
        member = guild.get_member(user.id)
        if member:
            user_roles = {r.id for r in member.roles}
            return not bool(user_roles & allowed_roles)

    return True

def _has_checker_access(user: discord.Member | discord.User) -> bool:
    """Проверяет, есть ли у пользователя доступ к чекеру (ADMIN+ и выше)."""
    if getattr(user, "id", None) == BOT_OWNER_ID:
        return True

    if isinstance(user, discord.Member):
        user_roles = {r.id for r in user.roles}
        if bool(user_roles & CHECKER_ALLOWED_ROLES):
            return True
        if user.guild_permissions.administrator:
            return True

    for guild in bot.guilds:
        member = guild.get_member(user.id)
        if member:
            user_roles = {r.id for r in member.roles}
            if bool(user_roles & CHECKER_ALLOWED_ROLES):
                return True
            if member.guild_permissions.administrator:
                return True

    access = _load_access_list()
    if any(str(e.get("discord_id")) == str(user.id) for e in access):
        return True

    return False

def _is_staff_in_db(steamid: str) -> bool:
    db = _load_staff_db()
    return steamid in db

def _get_staff_by_discord(discord_id: str) -> dict | None:
    """Находит стаффа по Discord ID."""
    db = _load_staff_db()
    for sid, entry in db.items():
        if str(entry.get("discord_id")) == str(discord_id):
            return {**entry, "steamid": sid}
    return None

def _get_staff_by_discord_name(name: str) -> dict | None:
    """Находит стаффа по Discord нику (case-insensitive)."""
    db = _load_staff_db()
    name_lower = name.lower()
    for sid, entry in db.items():
        db_name = (entry.get("discord_name") or "").lower()
        if db_name == name_lower or name_lower in db_name:
            return {**entry, "steamid": sid}
    return None

def _load_staffboard() -> dict:
    if STAFFBOARD_FILE.exists():
        try:
            return json.loads(STAFFBOARD_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}

def _save_staffboard(channel_id: int, message_id: int):
    _save_json_atomic(STAFFBOARD_FILE, {"channel_id": channel_id, "message_id": message_id})

def _load_leaderstaff_panel() -> dict:
    if LEADERSTAFF_PANEL_FILE.exists():
        try:
            return json.loads(LEADERSTAFF_PANEL_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}

def _save_leaderstaff_panel(channel_id: int, message_id: int):
    _save_json_atomic(LEADERSTAFF_PANEL_FILE, {"channel_id": channel_id, "message_id": message_id})

def _save_staffboard_state(channel_id: int, message_id: int, view: "StaffView"):
    data = {
        "channel_id": channel_id,
        "message_id": message_id,
        "mode": view.mode,
        "year": view.year,
        "month": view.month,
        "week_idx": view.week_idx,
        "date_from": view.date_from.isoformat().replace("+00:00", "Z") if view.date_from else None,
        "date_to": view.date_to.isoformat().replace("+00:00", "Z") if view.date_to else None,
    }
    _save_json_atomic(STAFFBOARD_FILE, data)


@tree.command(name="staffboard", description="Разместить постоянную панель статистики стаффа в канале")
async def cmd_staffboard(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("Нет прав.", ephemeral=True)
    await interaction.response.defer(ephemeral=True)
    try:
        now  = datetime.now(tz=timezone.utc)
        view = StaffView(mode="month", year=now.year, month=now.month, persistent=True)
        df, dt = view._get_period()
        embeds = await asyncio.to_thread(_build_staff_embed, df, dt)
        msg = await interaction.channel.send(embed=embeds[0], view=view)
        # Сохраняем channel_id + message_id для восстановления после рестарта
        _save_staffboard_state(interaction.channel.id, msg.id, view)
        await interaction.followup.send("✅ Панель статистики размещена в канале.", ephemeral=True)
        _log(f"📊 /staffboard размещён в #{interaction.channel.name} msg={msg.id} ({interaction.user})")
    except Exception as e:
        _log(f"❌ /staffboard ошибка: {e}")
        await interaction.followup.send(f"❌ Ошибка: {e}", ephemeral=True)


class CheckerDMButton(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="💬 Написать боту", style=discord.ButtonStyle.primary, custom_id="checker_dm_btn")
    async def send_dm(self, interaction: discord.Interaction, button: discord.ui.Button):
        try:
            user = interaction.user
            dm = user.dm_channel or await user.create_dm()
            embed = discord.Embed(
                title="🔍 Чекер config.vdf",
                description=(
                    "Привет! Я готов проверить твои аккаунты.\n\n"
                    "**Просто отправь мне файл `config.vdf`** из папки Steam в этот чат.\n\n"
                    "Я проверю все аккаунты на:\n"
                    "• Регистрацию на Fear Project\n"
                    "• Баны на Fear\n"
                    "• VAC баны\n"
                    "• Community Bans\n"
                    "• Yooma.su баны"
                ),
                color=0x5865f2
            )
            await dm.send(embed=embed)
            await interaction.response.send_message("✅ Проверь личные сообщения — я написал тебе инструкцию!", ephemeral=True)
        except Exception as e:
            await interaction.response.send_message(
                "❌ Не удалось отправить ЛС. Возможно, у тебя закрыты личные сообщения. "
                f"Открой настройки приватности Discord или напиши мне сам: <@{bot.user.id}>",
                ephemeral=True
            )



async def _build_newbies_embeds() -> list[discord.Embed]:
    servers = await _fetch_online_servers()
    now = datetime.now(timezone.utc)
    if not servers:
        return [discord.Embed(
            title="🟡 Новички онлайн (≤ 2ч)",
            description="⚠️ Не удалось получить данные серверов.",
            color=0xf1c40f,
            timestamp=now
        )]

    players: list[tuple[str, str, str]] = []
    for srv in servers:
        srv_name = srv.get("site_name") or srv.get("name") or "Unknown"
        ip = str(srv.get("ip") or "").strip()
        port = str(srv.get("port") or "").strip()
        srv_connect = f"connect {ip}:{port}" if ip and port else "connect ?"

        for player in srv.get("live_data", {}).get("players", []):
            sid = str(player.get("steam_id") or player.get("steamid") or "").strip()
            if not sid:
                continue
            players.append((sid, srv_name, srv_connect))

    if not players:
        return [discord.Embed(
            title="🟢 Новички онлайн (≤ 2ч)",
            description="✅ Сейчас нет игроков онлайн.",
            color=0x2ecc71,
            timestamp=now
        )]

    unique_ids = list(dict.fromkeys([sid for sid, _, _ in players]))
    id_to_server = {sid: (srv_name, srv_connect) for sid, srv_name, srv_connect in players}

    sem = asyncio.Semaphore(15)
    newbies: list[tuple[str, str, str, str, float]] = []
    async with aiohttp.ClientSession() as session:
        async def fetch_one(sid: str):
            async with sem:
                return sid, await _get_profile(session, sid)

        profiles = await asyncio.gather(*[fetch_one(sid) for sid in unique_ids])

    for sid, profile in profiles:
        if not profile:
            continue
        stats = profile.get("stats", {}) if isinstance(profile, dict) else {}
        playtime_h = (stats.get("playtime", 0) or 0) / 3600
        if playtime_h <= 2:
            fear_name = (profile.get("name") or "").strip() if isinstance(profile, dict) else ""
            srv_name, srv_connect = id_to_server.get(sid, ("Unknown", "connect ?"))
            newbies.append((fear_name or sid, sid, srv_name, srv_connect, playtime_h))

    if not newbies:
        return [discord.Embed(
            title="🟢 Новички онлайн (≤ 2ч)",
            description="✅ Сейчас нет игроков с наигранными часами ≤ 2.",
            color=0x2ecc71,
            timestamp=now
        )]

    # Сортировка: от новых к старым (по часам)
    newbies.sort(key=lambda x: x[4])

    all_embeds = []
    current_lines = []
    current_len = 0
    page = 1

    # Группируем по 3 человека в строку
    for i in range(0, len(newbies), 3):
        chunk = newbies[i:i+3]
        row_parts = []
        for name, sid, srv_name, srv_connect, ph in chunk:
            url = f"https://fearproject.ru/profile/{sid}"
            row_parts.append(f"👤 [{name}]({url}) (**{ph:.1f}ч**)")
        
        new_line = " | ".join(row_parts)
        
        # Если добавление строки превысит лимит, создаем новый эмбед
        if current_len + len(new_line) + 10 > 3800:
            title = f"🟡 Новички онлайн (≤ 2ч) — стр. {page}"
            emb = discord.Embed(title=title, description="\n".join(current_lines), color=0xf1c40f)
            all_embeds.append(emb)
            current_lines = [new_line]
            current_len = len(new_line)
            page += 1
        else:
            current_lines.append(new_line)
            current_len += len(new_line) + 1

    if current_lines:
        title = "🟡 Новички онлайн (≤ 2ч)" if page == 1 else f"🟡 Новички онлайн (≤ 2ч) — стр. {page}"
        emb = discord.Embed(title=title, description="\n".join(current_lines), color=0xf1c40f)
        emb.set_footer(text=f"Всего новичков: {len(newbies)}")
        emb.timestamp = now
        all_embeds.append(emb)

    return all_embeds[:10]  # Discord лимит 10 эмбедов на сообщение

async def _build_admin_online_embeds() -> list[discord.Embed]:
    servers = await _fetch_online_servers()
    now = datetime.now(timezone.utc)
    if not servers:
        return [discord.Embed(
            title="👮 Онлайн админов",
            description="⚠️ Не удалось получить данные серверов.",
            color=0x3498db,
            timestamp=now
        )]

    admin_entries: list[dict] = []
    for srv in servers:
        srv_name = srv.get("site_name") or srv.get("name") or "Unknown"
        ip = str(srv.get("ip") or "").strip()
        port = str(srv.get("port") or "").strip()
        srv_connect = f"connect {ip}:{port}" if ip and port else "connect ?"

        for player in srv.get("live_data", {}).get("players", []):
            if not player.get("is_admin"):
                continue
            sid = str(player.get("steam_id") or "").strip()
            if not sid:
                continue
            admin_entries.append({
                "steam_id": sid,
                "nickname": player.get("nickname", sid),
                "team": player.get("team", "?"),
                "kills": player.get("kills", 0),
                "deaths": player.get("deaths", 0),
                "server": srv_name,
                "connect": srv_connect,
            })

    if not admin_entries:
        return [discord.Embed(
            title="👮 Онлайн админов",
            description="✅ Сейчас нет админов онлайн.",
            color=0x2ecc71,
            timestamp=now
        )]

    sem = asyncio.Semaphore(15)
    async with aiohttp.ClientSession() as session:
        async def fetch_one(entry: dict):
            async with sem:
                profile = await _get_profile(session, entry["steam_id"])
                points = 0
                if profile:
                    points = profile.get("value", 0) or 0
                if not points and profile:
                    points = (profile.get("stats") or {}).get("value", 0) or 0
                if not points:
                    lb_entry = next(
                        (p for p in _cached_leaderboard_data
                         if str(p.get("steamid", "")).strip() == entry["steam_id"]),
                        None
                    )
                    if lb_entry:
                        points = lb_entry.get("value", 0) or 0
                return entry, profile, points

        results = await asyncio.gather(*[fetch_one(e) for e in admin_entries])

    enriched: list[dict] = []
    for entry, profile, points in results:
        stats = profile.get("stats", {}) if isinstance(profile, dict) else {}
        playtime_h = (stats.get("playtime", 0) or 0) / 3600

        kd = stats.get("kd")
        if kd is None:
            kills_site = stats.get("kills", 0)
            deaths_site = stats.get("deaths", 0)
            kd = kills_site / deaths_site if deaths_site > 0 else 0

        fear_name = (profile.get("name") or entry["nickname"] or "").strip() if isinstance(profile, dict) else entry["nickname"]

        group_display = "Игрок"
        if isinstance(profile, dict):
            ag = profile.get("adminGroup")
            cand = None
            if isinstance(ag, dict):
                cand = ag.get("group_name")
            if not cand or str(cand).isdigit():
                cand = profile.get("rank_name")
            if not cand or str(cand).isdigit():
                cand = profile.get("rank")
            if cand and not str(cand).isdigit():
                group_display = cand

        enriched.append({
            "steam_id": entry["steam_id"],
            "nickname": fear_name or entry["nickname"],
            "group": group_display,
            "team": entry["team"],
            "kills": entry["kills"],
            "deaths": entry["deaths"],
            "kd": kd,
            "server": entry["server"],
            "connect": entry["connect"],
            "playtime_h": playtime_h,
            "points": points,
        })

    enriched.sort(key=lambda x: x["playtime_h"])

    all_embeds: list[discord.Embed] = []
    page = 1
    lines_per_page = 5
    total_pages = max(1, (len(enriched) + lines_per_page - 1) // lines_per_page)

    for page_idx in range(total_pages):
        chunk = enriched[page_idx * lines_per_page : (page_idx + 1) * lines_per_page]
        lines = []
        for i, e in enumerate(chunk, start=page_idx * lines_per_page + 1):
            url = f"https://fearproject.ru/profile/{e['steam_id']}"
            team_emoji = {"CT": "🔵", "T": "🟡", "SPEC": "⚪"}.get(e["team"].upper(), "❓")
            lines.append(
                f"**{i}.** [{e['nickname']}]({url}) `[{e['group']}]`\n"
                f"    Сервер: **{e['server']}** | Команда: {team_emoji} **{e['team'].upper()}**\n"
                f"    КД: **{e['kd']:.2f}** | Часы: **{e['playtime_h']:.1f}ч** | Очки: **{e['points']}**\n"
                f"    `{e['connect']}`"
            )

        title = "👮 Онлайн админов" if total_pages == 1 else f"👮 Онлайн админов — стр. {page_idx + 1}/{total_pages}"
        desc = "\n\n".join(lines)
        if len(desc) > 4000:
            desc = desc[:3997] + "..."
        emb = discord.Embed(
            title=title,
            description=desc,
            color=0x3498db,
            timestamp=now
        )
        emb.set_footer(text=f"Всего онлайн: {len(enriched)} • Обновлено")
        all_embeds.append(emb)

    return all_embeds[:10]


class AdminOnlineView(discord.ui.View):
    def __init__(self, current_page: int = 1, total_pages: int = 1):
        super().__init__(timeout=None)
        self.current_page = current_page
        self.total_pages = total_pages

    @discord.ui.button(label="⬅️", style=discord.ButtonStyle.gray, custom_id="ao_prev")
    async def prev_page(self, interaction: discord.Interaction, button: discord.ui.Button):
        panels = _load_admin_online_panel()
        msg_key = str(interaction.message.id)
        if msg_key in panels:
            self.current_page = panels[msg_key].get("page", 1)
            self.total_pages = panels[msg_key].get("total_pages", 1)
        if self.current_page <= 1:
            return await interaction.response.send_message("Это первая страница.", ephemeral=True)
        self.current_page -= 1
        panels[msg_key]["page"] = self.current_page
        _save_admin_online_panel(panels)
        await self._update(interaction)

    @discord.ui.button(label="➡️", style=discord.ButtonStyle.gray, custom_id="ao_next")
    async def next_page(self, interaction: discord.Interaction, button: discord.ui.Button):
        panels = _load_admin_online_panel()
        msg_key = str(interaction.message.id)
        if msg_key in panels:
            self.current_page = panels[msg_key].get("page", 1)
            self.total_pages = panels[msg_key].get("total_pages", 1)
        if self.current_page >= self.total_pages:
            return await interaction.response.send_message("Это последняя страница.", ephemeral=True)
        self.current_page += 1
        panels[msg_key]["page"] = self.current_page
        _save_admin_online_panel(panels)
        await self._update(interaction)

    async def _update(self, interaction: discord.Interaction):
        try:
            embed = _build_admin_online_embed_for_page(self.current_page, self.total_pages)
            await asyncio.wait_for(
                interaction.response.edit_message(embed=embed, view=self),
                timeout=5.0
            )
        except Exception as e:
            try:
                if not interaction.response.is_done():
                    await interaction.response.send_message("⚠️ Ошибка обновления. Попробуйте снова.", ephemeral=True)
            except Exception:
                pass


def _build_admin_online_embed_for_page(page: int, total_pages: int) -> discord.Embed:
    """Строит embed для конкретной страницы из кэша enriched данных."""
    now = datetime.now(timezone.utc)
    enriched = getattr(bot, "_admin_online_cache", [])
    if not enriched:
        return discord.Embed(
            title="👮 Онлайн админов",
            description="✅ Нет данных или нет админов онлайн.",
            color=0x2ecc71,
            timestamp=now
        )

    lines_per_page = 5
    total_pages = max(1, (len(enriched) + lines_per_page - 1) // lines_per_page)
    page = max(1, min(page, total_pages))

    start = (page - 1) * lines_per_page
    chunk = enriched[start:start + lines_per_page]
    lines = []
    for i, e in enumerate(chunk, start=start + 1):
        url = f"https://fearproject.ru/profile/{e['steam_id']}"
        team_emoji = {"CT": "🔵", "T": "🟡", "SPEC": "⚪"}.get(e["team"].upper(), "❓")
        lines.append(
            f"**{i}.** [{e['nickname']}]({url}) `[{e['group']}]`\n"
            f"    Сервер: **{e['server']}** | Команда: {team_emoji} **{e['team'].upper()}**\n"
            f"    КД: **{e['kd']:.2f}** | Часы: **{e['playtime_h']:.1f}ч** | Очки: **{e['points']}**\n"
            f"    `{e['connect']}`"
        )

    title = "👮 Онлайн админов" if total_pages == 1 else f"👮 Онлайн админов — стр. {page}/{total_pages}"
    desc = "\n\n".join(lines)
    if len(desc) > 4000:
        desc = desc[:3997] + "..."

    emb = discord.Embed(title=title, description=desc, color=0x3498db, timestamp=now)
    emb.set_footer(text=f"Всего онлайн: {len(enriched)} • Стр. {page}/{total_pages}")
    return emb


async def _refresh_admin_online_cache() -> list[dict]:
    """Обновляет кэш данных админов онлайн. Возвращает enriched список."""
    servers = await _fetch_online_servers()
    if not servers:
        bot._admin_online_cache = []
        return []

    admin_entries: list[dict] = []
    for srv in servers:
        srv_name = srv.get("site_name") or srv.get("name") or "Unknown"
        ip = str(srv.get("ip") or "").strip()
        port = str(srv.get("port") or "").strip()
        srv_connect = f"connect {ip}:{port}" if ip and port else "connect ?"
        for player in srv.get("live_data", {}).get("players", []):
            if not player.get("is_admin"):
                continue
            sid = str(player.get("steam_id") or "").strip()
            if not sid:
                continue
            admin_entries.append({
                "steam_id": sid,
                "nickname": player.get("nickname", sid),
                "team": player.get("team", "?"),
                "kills": player.get("kills", 0),
                "deaths": player.get("deaths", 0),
                "server": srv_name,
                "connect": srv_connect,
            })

    if not admin_entries:
        bot._admin_online_cache = []
        return []

    sem = asyncio.Semaphore(15)
    async with aiohttp.ClientSession() as session:
        async def fetch_one(entry: dict):
            async with sem:
                profile = await _get_profile(session, entry["steam_id"])
                points = 0
                if profile:
                    points = profile.get("value", 0) or 0
                if not points and profile:
                    points = (profile.get("stats") or {}).get("value", 0) or 0
                if not points:
                    lb_entry = next(
                        (p for p in _cached_leaderboard_data
                         if str(p.get("steamid", "")).strip() == entry["steam_id"]),
                        None
                    )
                    if lb_entry:
                        points = lb_entry.get("value", 0) or 0
                return entry, profile, points
        results = await asyncio.gather(*[fetch_one(e) for e in admin_entries])

    enriched: list[dict] = []
    for entry, profile, points in results:
        stats = profile.get("stats", {}) if isinstance(profile, dict) else {}
        playtime_h = (stats.get("playtime", 0) or 0) / 3600
        kd = stats.get("kd")
        if kd is None:
            kills_site = stats.get("kills", 0)
            deaths_site = stats.get("deaths", 0)
            kd = kills_site / deaths_site if deaths_site > 0 else 0
        fear_name = (profile.get("name") or entry["nickname"] or "").strip() if isinstance(profile, dict) else entry["nickname"]
        group_display = "Игрок"
        if isinstance(profile, dict):
            ag = profile.get("adminGroup")
            cand = None
            if isinstance(ag, dict):
                cand = ag.get("group_name")
            if not cand or str(cand).isdigit():
                cand = profile.get("rank_name")
            if not cand or str(cand).isdigit():
                cand = profile.get("rank")
            if cand and not str(cand).isdigit():
                group_display = cand
        enriched.append({
            "steam_id": entry["steam_id"],
            "nickname": fear_name or entry["nickname"],
            "group": group_display,
            "team": entry["team"],
            "kills": entry["kills"],
            "deaths": entry["deaths"],
            "kd": kd,
            "server": entry["server"],
            "connect": entry["connect"],
            "playtime_h": playtime_h,
            "points": points,
        })

    enriched.sort(key=lambda x: x["playtime_h"])
    bot._admin_online_cache = enriched
    return enriched

@tasks.loop(minutes=1)
async def newbies_panel_loop():
    panel_info = _load_newbies_panel()
    channel_id = panel_info.get("channel_id")
    message_id = panel_info.get("message_id")
    if not channel_id:
        return

    channel = bot.get_channel(channel_id)
    if not channel:
        try:
            channel = await bot.fetch_channel(channel_id)
        except Exception:
            return

    try:
        embeds = await _build_newbies_embeds()

        if message_id:
            try:
                msg = await channel.fetch_message(message_id)
                await msg.edit(embeds=embeds)
                return
            except discord.NotFound:
                message_id = None
            except Exception as e:
                _log(f"⚠️ Ошибка обновления newbies панели по ID: {e}")

        msg = await _find_panel_in_history(channel, "Новички онлайн", limit=200)
        if msg:
            await msg.edit(embeds=embeds)
            _save_newbies_panel(channel.id, msg.id)
            return
        
        await _purge_bot_messages(channel, limit=200)
        msg = await channel.send(embeds=embeds)
        _save_newbies_panel(channel.id, msg.id)
        return

    except Exception as e:
        _log(f"❌ newbies_panel_loop error: {e}")

@tree.command(name="newbies_panel", description="Создать автообновляемую панель новичков онлайн (≤ 2ч)")
async def cmd_newbies_panel(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("Нет прав.", ephemeral=True)

    await interaction.response.defer(ephemeral=True)
    try:
        embeds = await _build_newbies_embeds()
        msg = await interaction.channel.send(embeds=embeds)
        _save_newbies_panel(interaction.channel.id, msg.id)
        await interaction.followup.send("✅ Панель создана.", ephemeral=True)
    except Exception as e:
        _log(f"Ошибка в /newbies_panel: {e}")
        await interaction.followup.send(f"❌ Ошибка: {e}", ephemeral=True)

@tasks.loop(minutes=1)
async def admin_online_panel_loop():
    panels = _load_admin_online_panel()
    if not panels:
        return

    try:
        _log(f"👮 [ADMIN PANEL] Обновление панели...", discord=False)
        enriched = await _refresh_admin_online_cache()
        total = len(enriched)
        if total == 0:
            return
        total_pages = max(1, (total + 4) // 5)

        for msg_key, panel_info in list(panels.items()):
            channel_id = panel_info.get("channel_id")
            message_id = panel_info.get("message_id")
            page = panel_info.get("page", 1)
            if not channel_id or not message_id:
                continue

            channel = bot.get_channel(channel_id)
            if not channel:
                continue

            try:
                msg = await channel.fetch_message(message_id)
            except discord.NotFound:
                del panels[msg_key]
                _save_admin_online_panel(panels)
                continue
            except Exception:
                continue

            page = max(1, min(page, total_pages))
            embed = _build_admin_online_embed_for_page(page, total_pages)
            view = AdminOnlineView(page, total_pages)

            try:
                await msg.edit(embed=embed, view=view)
            except Exception as e:
                _log(f"⚠️ Ошибка обновления admin_online панели: {e}")

    except Exception as e:
        _log(f"❌ admin_online_panel_loop error: {e}")

@admin_online_panel_loop.before_loop
async def before_admin_online_panel():
    await bot.wait_until_ready()

@tree.command(name="admin_online_panel", description="Создать автообновляемую панель онлайн-админов (КД, часы, команда, сервер, очки)")
async def cmd_admin_online_panel(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("Нет прав.", ephemeral=True)

    await interaction.response.defer(ephemeral=True)
    try:
        enriched = await _refresh_admin_online_cache()
        total = len(enriched)
        total_pages = max(1, (total + 4) // 5)
        embed = _build_admin_online_embed_for_page(1, total_pages)
        view = AdminOnlineView(1, total_pages)
        msg = await interaction.channel.send(embed=embed, view=view)

        panels = _load_admin_online_panel()
        panels[str(msg.id)] = {
            "channel_id": interaction.channel_id,
            "message_id": msg.id,
            "page": 1,
            "total_pages": total_pages,
        }
        _save_admin_online_panel(panels)
        await interaction.followup.send("✅ Панель онлайн-админов создана. Обновляется каждую минуту.", ephemeral=True)
    except Exception as e:
        _log(f"Ошибка в /admin_online_panel: {e}")
        await interaction.followup.send(f"❌ Ошибка: {e}", ephemeral=True)


def _parse_iso_z(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None

def _staffboard_view_from_state(state: dict) -> StaffView:
    now = datetime.now(tz=timezone.utc)
    mode = (state.get("mode") or "month")
    year = int(state.get("year") or now.year)
    month = int(state.get("month") or now.month)
    week_idx = state.get("week_idx")
    if week_idx is not None:
        try:
            week_idx = int(week_idx)
        except Exception:
            week_idx = None
    df = _parse_iso_z(state.get("date_from"))
    dt = _parse_iso_z(state.get("date_to"))
    view = StaffView(
        mode=mode,
        year=year,
        month=month,
        week_idx=week_idx,
        date_from=df,
        date_to=dt,
        persistent=True
    )
    # Панель всегда показывает текущий месяц/неделю
    view._sync_to_current()
    view._build_buttons()
    return view

@tasks.loop(minutes=1)
async def staffboard_panel_loop():
    sb = _load_staffboard()
    channel_id = sb.get("channel_id")
    message_id = sb.get("message_id")
    if not channel_id or not message_id:
        return

    channel = bot.get_channel(channel_id)
    if not channel:
        try:
            channel = await bot.fetch_channel(channel_id)
        except Exception:
            return

    try:
        msg = await channel.fetch_message(message_id)
    except discord.NotFound:
        msg = await _find_panel_in_history(channel, "Статистика стаффа", limit=200)
        if not msg:
            await _purge_bot_messages(channel, limit=200)
            view = _staffboard_view_from_state(sb)
            df, dt = view._get_period()
            embeds = _build_staff_embed(df, dt)
            new_msg = await channel.send(embeds=embeds[:10], view=view)
            _save_staffboard_state(channel.id, new_msg.id, view)
            return
        _save_staffboard(channel.id, msg.id)
    except Exception:
        return

    view = _staffboard_view_from_state(sb)
    # Синхронизируем с текущей датой (автоопределение недели/месяца)
    view._sync_to_current()
    view._build_buttons()
    # Обновление кэша теперь происходит только в staff_punish_scan_loop
    # здесь мы просто перерисовываем панель
    df, dt = view._get_period()
    embeds = await asyncio.to_thread(_build_staff_embed, df, dt)
    try:
        await msg.edit(embeds=embeds[:10], view=view)
        _save_staffboard_state(channel.id, msg.id, view)
    except Exception:
        pass

@tasks.loop(minutes=1)
async def leaderstaff_panel_loop():
    panel = _load_leaderstaff_panel()
    channel_id = panel.get("channel_id")
    message_id = panel.get("message_id")
    if not channel_id or not message_id:
        return

    channel = bot.get_channel(channel_id)
    if not channel:
        try:
            channel = await bot.fetch_channel(channel_id)
        except Exception:
            return

    try:
        msg = await channel.fetch_message(message_id)
    except discord.NotFound:
        msg = await _find_panel_in_history(channel, "Лидеры стаффа", limit=200)
        if not msg:
            await _purge_bot_messages(channel, limit=200)
            embed = await asyncio.to_thread(_build_leaderstaff_embed)
            new_msg = await channel.send(embed=embed)
            _save_leaderstaff_panel(channel.id, new_msg.id)
            return
        _save_leaderstaff_panel(channel.id, msg.id)
    except Exception:
        return

    embed = await asyncio.to_thread(_build_leaderstaff_embed)
    try:
        await msg.edit(embed=embed)
        _save_leaderstaff_panel(channel.id, msg.id)
    except Exception:
        pass

@tasks.loop(hours=1)
async def punishments_hourly_scan_loop():
    """Раз в час сканирует новые наказания (инкрементально) и записывает в all_punishments_log."""
    if not FEAR_COOKIE:
        return
    staff_ids = {str(sid).strip() for sid in _load_staff_db().keys() if str(sid).strip()}
    if not staff_ids:
        return

    state = _load_punishments_scan_state()
    last_ban_id = int(state.get("last_ban_id") or 0)
    last_mute_id = int(state.get("last_mute_id") or 0)

    async with aiohttp.ClientSession() as session:
        new_bans, new_last_ban = await _fetch_new_staff_punishments(session, staff_ids, 1, last_ban_id)
        new_mutes, new_last_mute = await _fetch_new_staff_punishments(session, staff_ids, 2, last_mute_id)

    batch = []
    for b in new_bans:
        batch.append((b, 1))
    for m in new_mutes:
        batch.append((m, 2))

    if batch:
        _log_punishments_batch(batch)
        _log(f"📝 Punishments hourly scan: +{len(new_bans)} bans, +{len(new_mutes)} mutes", discord=False)

    changed = False
    if new_last_ban != last_ban_id:
        state["last_ban_id"] = new_last_ban
        changed = True
    if new_last_mute != last_mute_id:
        state["last_mute_id"] = new_last_mute
        changed = True
    if changed:
        _save_punishments_scan_state(state)


MUTE_REPEAT_CHANNEL_ID = 1515095433494663438
MUTE_REPEAT_OWNER_ID = 1500235583367417866
MUTE_REPEAT_THRESHOLD = 15
MUTE_REPEAT_DAYS = 90


async def _fetch_all_mutes_global(session: aiohttp.ClientSession) -> list:
    """Листает ВСЕ муты через /admin/punishments/my (type=2) пока не дойдём до даты 90 дней назад."""
    if not FEAR_COOKIE:
        return []
    headers = {
        "Cookie": FEAR_COOKIE,
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://fearproject.ru",
        "Referer": "https://fearproject.ru/",
    }
    seen_ids: set[int] = set()
    all_mutes = []
    cutoff_ts = int(time.time()) - (MUTE_REPEAT_DAYS * 86400)
    page = 1
    consecutive_empty = 0

    while page <= 500:
        params = {"type": 2, "page": page, "limit": 20}
        retries = 0
        while retries < 3:
            try:
                timeout = aiohttp.ClientTimeout(total=15)
                _log(f"🔄 [ЧСО] API: page={page}", discord=False)
                async with session.get(f"{API_BASE}/admin/punishments/my", params=params, headers=headers, timeout=timeout) as r:
                    if r.status == 429:
                        await asyncio.sleep(2 ** retries)
                        retries += 1
                        continue
                    if r.status != 200:
                        _log(f"⚠️ [ЧСО] API вернул {r.status}, завершаю.", discord=False)
                        return all_mutes
                    data = await r.json(content_type=None)
                    items = data if isinstance(data, list) else data.get("punishments", data.get("data", []))
                    break
            except (asyncio.TimeoutError, Exception) as e:
                retries += 1
                await asyncio.sleep(1.0)
        else:
            _log(f"⚠️ [ЧСО] Стр.{page}: 3 неудачи, завершаю.", discord=False)
            return all_mutes

        if not items:
            _log(f"ℹ️ [ЧСО] Стр.{page}: пусто, завершаю.", discord=False)
            return all_mutes

        added = 0
        oldest_on_page = 0
        for item in items:
            pid = int(item.get("id") or 0)
            ptype = int(item.get("punish_type") or item.get("type") or 0)
            created = int(item.get("created") or 0)
            if created and (oldest_on_page == 0 or created < oldest_on_page):
                oldest_on_page = created
            if pid and pid not in seen_ids and ptype == 2:
                seen_ids.add(pid)
                all_mutes.append(item)
                added += 1

        _log(f"🔄 [ЧСО] Стр.{page}: {len(items)} шт., +{added} новых, всего {len(all_mutes)}, самая старая: {_msk_from_timestamp(oldest_on_page) if oldest_on_page else '—'}", discord=False)

        if added == 0:
            consecutive_empty += 1
            if consecutive_empty >= 3:
                _log(f"ℹ️ [ЧСО] 3 страницы подряд без новых — завершаю.", discord=False)
                return all_mutes
        else:
            consecutive_empty = 0

        if oldest_on_page > 0 and oldest_on_page < cutoff_ts:
            _log(f"ℹ️ [ЧСО] Стр.{page}: достигнут cutoff 90 дн. — завершаю.", discord=False)
            return all_mutes

        page += 1

    _log(f"⚠️ [ЧСО] Лимит 500 страниц.", discord=False)
    return all_mutes


def _format_datetime_ru(ts: int) -> str:
    """ Unix timestamp → '29.05.2026, 01:31' """
    from datetime import datetime, timezone
    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    return dt.strftime("%d.%m.%Y, %H:%M")


@tasks.loop(hours=1)
async def mute_repeat_check_loop():
    """Раз в час ищет игроков с 15+ мутами за 90 дней и пингует владельца."""
    if not FEAR_COOKIE:
        return

    _log("🔄 [ЧСО] Начинаю проверку мутов на ЧСО...", discord=True)
    cutoff_ts = int(time.time()) - (MUTE_REPEAT_DAYS * 86400)
    _log(f"🔄 [ЧСО] Cutoff: {datetime.fromtimestamp(cutoff_ts, tz=timezone.utc).strftime('%d.%m.%Y %H:%M')} ({MUTE_REPEAT_DAYS} дн. назад)", discord=False)

    async with aiohttp.ClientSession() as session:
        _log(f"🔄 [ЧСО] Запрос всех мутов через /admin/punishments/my (type=2)...", discord=False)
        all_mutes = await _fetch_all_mutes_global(session)
        _log(f"🔄 [ЧСО] Получено мутов: {len(all_mutes)}", discord=False)

    if not all_mutes:
        _log("ℹ️ [ЧСО] Мутов не найдено, завершаю.", discord=True)
        return

    # Группируем по steamid, считаем муты за 90 дней, исключаем уже имеющих ЧСО
    from collections import defaultdict
    player_mutes: dict[str, list[dict]] = defaultdict(list)
    player_cso: set[str] = set()
    skipped_cso = 0
    skipped_old = 0
    skipped_wrong_status = 0

    for m in all_mutes:
        steamid = str(m.get("steamid", "")).strip()
        if not steamid:
            continue
        reason = str(m.get("reason", "")).strip().lower()
        created = int(m.get("created") or 0)
        status = int(m.get("status") or 0)

        if "чсо" in reason:
            player_cso.add(steamid)
            skipped_cso += 1
            continue

        if created < cutoff_ts:
            skipped_old += 1
            continue

        if status not in (1, 4):
            skipped_wrong_status += 1
            continue

        player_mutes[steamid].append(m)

    _log(f"🔄 [ЧСО] Уже в ЧСО: {skipped_cso} мутов | Старше 90 дн.: {skipped_old} | Не подходящий статус: {skipped_wrong_status}", discord=False)
    _log(f"🔄 [ЧСО] Уникальных игроков с мутами за 90 дн.: {len(player_mutes)}", discord=False)

    # Ищем тех у кого >= 15 активных мутов за 90 дней и нет ЧСО
    suspects = []
    for steamid, mutes in player_mutes.items():
        if len(mutes) < MUTE_REPEAT_THRESHOLD:
            continue
        if steamid in player_cso:
            continue
        last_ts = max(int(m.get("created") or 0) for m in mutes)
        name = mutes[0].get("name", "Неизвестно")
        suspects.append({
            "steamid": steamid,
            "name": name,
            "total": len(mutes),
            "last_ts": last_ts,
        })

    if not suspects:
        _log("✅ [ЧСО] Подозрительных не найдено (никто не набрал 15+ мутов).", discord=True)
        return

    suspects.sort(key=lambda x: -x["total"])

    _log(f"🚨 [ЧСО] Найдено {len(suspects)} серийных нарушителей:", discord=True)
    for s in suspects:
        _log(f"   {s['name']} ({s['steamid']}): {s['total']} мутов за 90 дн.", discord=False)

    channel = bot.get_channel(MUTE_REPEAT_CHANNEL_ID)
    if not channel:
        try:
            channel = await bot.fetch_channel(MUTE_REPEAT_CHANNEL_ID)
        except Exception:
            _log(f"❌ [ЧСО] Канал {MUTE_REPEAT_CHANNEL_ID} не найден!", discord=True)
            return

    for s in suspects:
        embed = discord.Embed(
            title="⚠️ Серийный нарушитель",
            color=discord.Color.red(),
        )
        embed.add_field(name="Игрок", value=f"**{s['name']}**\n`{s['steamid']}`", inline=True)
        embed.add_field(name="Активных мутов за 90 дн.", value=f"**{s['total']}**", inline=True)
        embed.add_field(name="Последний мут", value=_format_datetime_ru(s["last_ts"]), inline=True)
        embed.add_field(
            name="🔗 Ссылки",
            value=f"[Steam](https://steamcommunity.com/profiles/{s['steamid']}) • [Fear](https://fearproject.ru/profile/{s['steamid']})",
            inline=False
        )
        await channel.send(content=f"<@{MUTE_REPEAT_OWNER_ID}>", embed=embed)

    _log(f"✅ [ЧСО] Проверка завершена. Отправлено {len(suspects)} уведомлений в <#{MUTE_REPEAT_CHANNEL_ID}>", discord=True)


@mute_repeat_check_loop.before_loop
async def before_mute_repeat_check():
    await bot.wait_until_ready()


@tasks.loop(hours=24)
async def punishments_daily_refresh_loop():
    """Раз в день полностью обновляет статус всех наказаний в all_punishments_log."""
    if not FEAR_COOKIE:
        return
    staff_ids = {str(sid).strip() for sid in _load_staff_db().keys() if str(sid).strip()}
    if not staff_ids:
        return

    _log(f"🔄 Punishments daily refresh: обновляю {len(staff_ids)} стаффов...", discord=False)
    data = _load_all_punishments()
    updated_count = 0

    async with aiohttp.ClientSession() as session:
        for i, sid in enumerate(staff_ids, 1):
            try:
                fresh = await _fetch_punishments(session, sid)
                if not fresh:
                    continue
                for b in fresh.get("bans", []):
                    bid = str(b.get("id"))
                    if bid and bid in data.get("bans", {}):
                        if data["bans"][bid] != b:
                            data["bans"][bid] = b
                            updated_count += 1
                for m in fresh.get("mutes", []):
                    mid = str(m.get("id"))
                    if mid and mid in data.get("mutes", {}):
                        if data["mutes"][mid] != m:
                            data["mutes"][mid] = m
                            updated_count += 1
            except Exception as e:
                _log(f"⚠️ Daily refresh error for {sid}: {e}", discord=False)
            if i % 5 == 0:
                await asyncio.sleep(0.2)

    # Очистка мусора: удаляем записи от не-стафф (Harron Anti-Cheat и т.д.)
    removed_count = 0
    for key in ("bans", "mutes"):
        for pid in list(data.get(key, {}).keys()):
            item = data[key][pid]
            admin_sid = str(item.get("admin_steamid") or "").strip()
            if admin_sid and admin_sid not in staff_ids:
                del data[key][pid]
                removed_count += 1

    if updated_count or removed_count:
        _save_all_punishments(data)
    _log(f"✅ Punishments daily refresh: обновлено {updated_count}, удалено мусора {removed_count}", discord=False)


def _short_reason(s: str) -> str:
    s = (s or "—").replace("\n", " ").strip()
    if len(s) > 45:
        return s[:45] + "…"
    return s

def _dur_str(dur: int) -> str:
    if dur is None:
        return "—"
    try:
        dur = int(dur)
    except Exception:
        return "—"
    if dur <= 0:
        return "∞"
    if dur >= 2592000:  # 30 дней
        months = dur // 2592000
        return f"{months}мес"
    if dur >= 86400:    # 1 день
        days = dur // 86400
        return f"{days}д"
    if dur >= 3600:
        return f"{dur//3600}ч"
    if dur >= 60:
        return f"{dur//60}м"
    return f"{dur}с"

async def _fetch_new_staff_punishments(
    session: aiohttp.ClientSession,
    staff_ids: set[str],
    ptype: int,
    last_id: int
) -> tuple[list[dict], int]:
    """Сканирует новые наказания по статусам 1 (актив), 2 (снято) и 4 (истекло)."""
    headers = {
        "Cookie": FEAR_COOKIE,
        "Referer": "https://fearproject.ru/",
        "Origin": "https://fearproject.ru",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0"
    }

    found: list[dict] = []
    best_last = last_id
    limit = 10
    
    # 1 - активно (сканируем глубже), 2 - снято, 4 - истекло
    scan_configs = [
        {"status": 1, "pages": 15},
        {"status": 2, "pages": 10},
        {"status": 4, "pages": 5}
    ]

    for cfg in scan_configs:
        status = cfg["status"]
        max_pages = cfg["pages"]
        
        for page in range(1, max_pages + 1):
            params = {"page": page, "limit": limit, "type": ptype, "status": status}
            data = await _fetch_json(session, PUNISH_LIST_URL, params=params, headers=headers)
            raw = (data or {}).get("punishments") or []
            if not raw:
                break
            
            for it in raw:
                admin_sid = str(it.get("admin_steamid") or "").strip()
                it_id = it.get("id")
                
                if it_id is not None:
                    try:
                        it_id_int = int(it_id)
                    except Exception:
                        continue
                        
                    if it_id_int > best_last:
                        best_last = it_id_int
                    
                    if admin_sid in staff_ids and it_id_int > last_id:
                        found.append(it)

            # Если для текущего статуса мы уже дошли до старых ID, можно не листать дальше
            try:
                if raw and int(raw[-1].get("id", 0)) <= last_id and page >= 3:
                    break
            except Exception:
                pass
            
            await asyncio.sleep(0.1)

    # Дедупликация (одно и то же наказание могло попасть в разные списки при смене статуса)
    dedup = {}
    for f in found:
        dedup[str(f.get("id"))] = f
    
    final_found = list(dedup.values())
    final_found.sort(key=lambda x: int(x.get("id") or 0))
    return final_found, best_last

_staff_punish_scan_lock = asyncio.Lock()

async def _staff_punish_scan_update_cache(session: aiohttp.ClientSession, staff_ids: set[str]) -> tuple[list[dict], list[dict], dict]:
    # 1. Сначала ищем новые наказания (быстрое сканирование)
    state = _load_staff_punish_state()
    last_ban_id = int(state.get("last_ban_id") or 0)
    last_mute_id = int(state.get("last_mute_id") or 0)

    new_bans, new_last_ban = await _fetch_new_staff_punishments(session, staff_ids, 1, last_ban_id)
    new_mutes, new_last_mute = await _fetch_new_staff_punishments(session, staff_ids, 2, last_mute_id)

    # 2. Объединяем найденные наказания с кэшем
    by_admin_bans: dict[str, list[dict]] = {}
    for b in new_bans:
        sid = str(b.get("admin_steamid") or "").strip()
        if sid:
            by_admin_bans.setdefault(sid, []).append(b)

    by_admin_mutes: dict[str, list[dict]] = {}
    for m in new_mutes:
        sid = str(m.get("admin_steamid") or "").strip()
        if sid:
            by_admin_mutes.setdefault(sid, []).append(m)

    changed_admins = set(by_admin_bans.keys()) | set(by_admin_mutes.keys())
    for admin_sid in changed_admins:
        await _merge_punishments_into_cache(admin_sid, by_admin_bans.get(admin_sid, []), by_admin_mutes.get(admin_sid, []))

    # 3. Сохраняем состояние (last_id)
    if new_last_ban != last_ban_id or new_last_mute != last_mute_id:
        state["last_ban_id"] = new_last_ban
        state["last_mute_id"] = new_last_mute
        _save_staff_punish_state(state)

    return new_bans, new_mutes, state

async def _merge_punishments_into_cache(admin_sid: str, bans: list[dict], mutes: list[dict]):
    async with _staff_cache_lock:
        old = _load_cache(admin_sid) or {"bans": [], "mutes": []}
        old_bans = {str(b.get("id")): b for b in old.get("bans", []) if b.get("id") is not None}
        old_mutes = {str(m.get("id")): m for m in old.get("mutes", []) if m.get("id") is not None}

        for b in bans:
            bid = b.get("id")
            if bid is None:
                continue
            old_bans[str(bid)] = b
        for m in mutes:
            mid = m.get("id")
            if mid is None:
                continue
            old_mutes[str(mid)] = m

        # Пересчитываем тип (1=бан, 2=мут) из поля type
        all_bans = [p for p in list(old_bans.values()) if p.get("type", 0) in (0, 1)]
        all_mutes = [p for p in list(old_mutes.values()) if p.get("type", 0) == 2]

        cache = {
            "bans": all_bans,
            "mutes": all_mutes,
            "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "method": "staff_punish_scan"
        }
        path = CACHE_DIR / f"fearsearch_bans_{admin_sid}.json"
        _save_json_atomic(path, cache)

def _build_staff_punish_embed(state: dict, new_bans: int, new_mutes: int) -> discord.Embed:
    now = datetime.now(timezone.utc)
    last_ban = state.get("last_ban_id", 0)
    last_mute = state.get("last_mute_id", 0)
    embed = discord.Embed(
        title="🧾 Мониторинг наказаний стаффа",
        description=f"Новые: 🔨 **{new_bans}**  🔇 **{new_mutes}**\nПоследние ID: 🔨 `{last_ban}`  🔇 `{last_mute}`",
        color=0x5865f2,
        timestamp=now
    )
    return embed

@tasks.loop(minutes=1)
async def staff_punish_scan_loop():
    panel = _load_staff_punish_panel()
    channel_id = panel.get("channel_id")
    message_id = panel.get("message_id")
    if not channel_id or not message_id:
        return
    if not FEAR_COOKIE:
        return

    staff_ids = {str(sid).strip() for sid in _load_staff_db().keys() if str(sid).strip()}
    if not staff_ids:
        return

    channel = bot.get_channel(channel_id)
    if not channel:
        try:
            channel = await bot.fetch_channel(channel_id)
        except Exception:
            return

    msg = None
    try:
        msg = await channel.fetch_message(message_id)
    except discord.NotFound:
        msg = await _find_panel_in_history(channel, "Мониторинг наказаний стаффа", limit=200)
        if msg:
            _save_staff_punish_panel(channel.id, msg.id)
    except Exception:
        pass
    
    async with _staff_punish_scan_lock:
        async with aiohttp.ClientSession() as session:
            new_bans, new_mutes, state = await _staff_punish_scan_update_cache(session, staff_ids)

    # Сохраняем в глобальный лог для панели истории
    if new_bans or new_mutes:
        batch = [(b, 1) for b in new_bans] + [(m, 2) for m in new_mutes]
        _log_punishments_batch(batch)

    if new_bans or new_mutes:
        lines = []
        for b in (new_bans[-10:]):
            admin = b.get("admin") or b.get("admin_name") or b.get("admin_steamid") or "—"
            name = b.get("name") or "—"
            lines.append(f"🔨 **{admin}** → **{name}** `{_dur_str(b.get('duration', 0))}` { _short_reason(b.get('reason','')) } (id {b.get('id')})")
        for m in (new_mutes[-10:]):
            admin = m.get("admin") or m.get("admin_name") or m.get("admin_steamid") or "—"
            name = m.get("name") or "—"
            lines.append(f"🔇 **{admin}** → **{name}** `{_dur_str(m.get('duration', 0))}` { _short_reason(m.get('reason','')) } (id {m.get('id')})")
        if lines:
            out = "\n".join(lines[:20])
            # Отправляем лог в специальный канал логов наказаний
            log_ch = bot.get_channel(STAFF_PUNISH_LOG_CHANNEL_ID)
            if log_ch:
                await log_ch.send(out)
            else:
                # Если лог-канал не найден, отправляем в канал панели как раньше (fallback)
                await channel.send(out)

    if msg:
        embed = _build_staff_punish_embed(state, len(new_bans), len(new_mutes))
        try:
            await msg.edit(embed=embed)
        except Exception:
            pass

@tree.command(name="global_history_sync", description="Собрать ВСЮ историю банов/мутов проекта с 01.01.2026")
async def cmd_global_history_sync(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("❌ У вас недостаточно прав.", ephemeral=True)
    
    await interaction.response.defer(ephemeral=True)
    
    # 01.01.2026 00:00:00 UTC
    START_TS = 1735689600  
    
    _log(f"🌍 Запущена глобальная синхронизация истории с 01.01.2026 ({interaction.user})")
    await interaction.followup.send("⏳ Начинаю сбор всей истории проекта (баны и муты) с 01.01.2026.\nЭто может занять значительное время, я буду листать все страницы до нужной даты.", ephemeral=True)
    
    staff_ids = {str(sid).strip() for sid in _load_staff_db().keys() if str(sid).strip()}
    
    async with aiohttp.ClientSession() as session:
        for ptype in [1, 2]: # 1 - баны, 2 - муты
            ptype_name = "банов" if ptype == 1 else "мутов"
            
            for status in [1, 2, 4]: # 1 - активно, 2 - снято, 4 - истекло
                status_name = {1: "активных", 2: "снятых", 4: "истекших"}[status]
                _log(f"  📂 Синхронизация {ptype_name} ({status_name})...")
                
                page = 1
                limit = 10
                stop_sync = False
                
                while not stop_sync:
                    headers = {
                        "Cookie": FEAR_COOKIE,
                        "Referer": "https://fearproject.ru/",
                        "User-Agent": "Mozilla/5.0"
                    }
                    params = {"page": page, "limit": limit, "type": ptype, "status": status}
                    data = await _fetch_json(session, PUNISH_LIST_URL, params=params, headers=headers)
                    raw = (data or {}).get("punishments") or []
                    
                    if not raw:
                        break
                    
                    new_found_for_staff = []
                    
                    for it in raw:
                        created = int(it.get("created") or 0)
                        if created < START_TS:
                            stop_sync = True
                            break
                        
                        _log_punishment_globally(it, ptype)
                        
                        admin_sid = str(it.get("admin_steamid") or "").strip()
                        if admin_sid in staff_ids:
                            new_found_for_staff.append(it)
                    
                    if new_found_for_staff:
                        by_admin = {}
                        for it in new_found_for_staff:
                            sid = str(it.get("admin_steamid")).strip()
                            by_admin.setdefault(sid, []).append(it)
                        
                        for sid, items in by_admin.items():
                            if ptype == 1:
                                await _merge_punishments_into_cache(sid, items, [])
                            else:
                                await _merge_punishments_into_cache(sid, [], items)

                    if page % 20 == 0:
                        _log(f"    ⏳ {ptype_name} ({status_name}): {page} стр...")
                    
                    page += 1
                    await asyncio.sleep(0.2)

    # В конце обновляем саму панель
    await staffboard_panel_loop()
    
    _log("✅ Глобальная синхронизация истории завершена.")
    await interaction.followup.send("✅ Синхронизация истории с 01.01.2026 завершена! Глобальный лог наполнен, статистика стаффа обновлена.", ephemeral=True)

@tree.command(name="staff_force_update", description="Принудительно обновить всю статистику стаффа (глубокое сканирование)")
async def cmd_staff_force_update(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("❌ У вас недостаточно прав.", ephemeral=True)
    
    await interaction.response.defer(ephemeral=True)
    
    staff_db = _load_staff_db()
    if not staff_db:
        return await interaction.followup.send("❌ Список стаффа в `staff_db.json` пуст.", ephemeral=True)
    
    total = len(staff_db)
    _log(f"🔄 Запущено принудительное обновление статистики для {total} чел. ({interaction.user})")
    await interaction.followup.send(f"⏳ Начинаю глубокое обновление для **{total}** чел.\nБот пролистает все страницы наказаний для каждого админа. Это может занять 1-3 минуты.", ephemeral=True)
    
    async with aiohttp.ClientSession() as session:
        for i, (sid, entry) in enumerate(staff_db.items(), 1):
            name = entry.get("name") or sid
            if i % 5 == 0 or i == total:
                _log(f"  🔄 Прогресс обновления: {i}/{total} ({name})")
            
            # entry из staff_db НЕ содержит steamid, формируем правильный entry
            await _update_cache_for_staff(session, {
                "steamid": sid,
                "name": name
            })
            # Короткая пауза чтобы не перегружать API
            await asyncio.sleep(0.1)

    # После глубокого обновления — принудительно обновляем панель
    await staffboard_panel_loop()
    
    _log("✅ Глобальное обновление статистики стаффа успешно завершено.")
    await interaction.followup.send("✅ Глобальное обновление завершено! Все наказания (включая снятые/измененные) синхронизированы, панель обновлена.", ephemeral=True)

@tree.command(name="staff_punish_panel", description="Создать панель мониторинга новых наказаний от стаффа")
async def cmd_staff_punish_panel(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("Нет прав.", ephemeral=True)
    await interaction.response.defer(ephemeral=True)
    state = _load_staff_punish_state()
    embed = _build_staff_punish_embed(state, 0, 0)
    msg = await interaction.channel.send(embed=embed)
    _save_staff_punish_panel(interaction.channel.id, msg.id)
    await interaction.followup.send("✅ Панель создана.", ephemeral=True)


@tree.command(name="checker", description="Получить инструкцию для чекера config.vdf")
async def cmd_checker(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("❌ У вас нет прав для использования этой команды.", ephemeral=True)
    embed = discord.Embed(
        title="🔍 Чекер config.vdf",
        description=(
            "**Как пользоваться:**\n"
            "1. Нажми кнопку ниже — бот сам напишет тебе в ЛС\n"
            "2. Отправь боту файл `config.vdf` из папки Steam\n"
            "3. Бот проверит все аккаунты на Fear, Steam и Yooma.su\n"
            "4. Результаты придут в личные сообщения\n\n"
            "**Режимы работы (управляются через `/dmchecker`):**\n"
            "• `off` — выключен\n"
            "• `whitelist` — только пользователи из access list\n"
            "• `public` — все могут пользоваться (по умолчанию)"
        ),
        color=0x5865f2
    )
    await interaction.response.send_message(embed=embed, view=CheckerDMButton())


@tree.command(name="dmchecker", description="Управление режимом DM чекера config.vdf")
@app_commands.describe(mode="Режим работы")
@app_commands.choices(mode=[
    app_commands.Choice(name="off — выключить (никто не может)", value="off"),
    app_commands.Choice(name="whitelist — только доступные пользователи", value="whitelist"),
    app_commands.Choice(name="public — все могут пользоваться", value="public"),
])
async def cmd_dmchecker(interaction: discord.Interaction, mode: str):
    if not _is_admin(interaction):
        return await interaction.response.send_message("❌ У вас недостаточно прав.", ephemeral=True)
    global DM_CHECKER_ENABLED, DM_CHECKER_MODE
    DM_CHECKER_MODE = mode
    DM_CHECKER_ENABLED = (mode != "off")
    status_map = {
        "off":       "❌ выключен — никто не может",
        "whitelist": "🔒 только whitelist (admin/роль/access_list)",
        "public":    "🌐 публичный — все могут"
    }
    await interaction.response.send_message(f"DM чекер: {status_map[mode]}", ephemeral=True)
    _log(f"DM чекер режим: {mode} ({interaction.user})")


PUNISH_LIST_URL = f"{API_BASE}/punishments"

@tree.command(name="fear_search", description="Найти баны на Fear по причине (пролистывает ВСЕ страницы)")
@app_commands.describe(reason="Причина бана для поиска")
async def cmd_fear_search(interaction: discord.Interaction, reason: str):
    if not _is_admin(interaction):
        return await interaction.response.send_message("Нет прав.", ephemeral=True)
    
    await interaction.response.defer()
    
    found_bans = []
    reason_lower = reason.lower().strip()
    
    headers = {
        "Cookie": FEAR_COOKIE,
        "Referer": "https://fearproject.ru/",
        "Origin": "https://fearproject.ru",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    
    _log(f"🔍 Запуск /fear_search по причине: '{reason}'")

    async with aiohttp.ClientSession() as session:
        # Лимит строго 10, как указал пользователь
        limit = 10
        params = {"q": reason, "page": 1, "limit": limit, "type": 1}
        data = await _fetch_json(session, PUNISH_LIST_URL, params=params, headers=headers)
        
        if not data or not data.get("punishments"):
            _log(f"⚠️ /fear_search '{reason}': ничего не найдено на первой странице.")
            return await interaction.edit_original_response(content=f"❌ На Fear не найдено банов с упоминанием `{reason}`.")
        
        total_items = int(data.get("total", 0))
        total_pages = (total_items + (limit - 1)) // limit
        
        found_bans.extend(data["punishments"])
        _log(f"🔍 Найдено {total_items} потенциальных совпадений. Сканирую {total_pages} страниц...")
        
        if total_pages > 1:
            await interaction.edit_original_response(
                content=f"🔍 Найдено {total_items} записей ({total_pages} стр.). Сканирую всё, подожди..."
            )
            
            sem = asyncio.Semaphore(20)
            
            async def fetch_page(page_num):
                async with sem:
                    p = {"q": reason, "page": page_num, "limit": 10, "type": 1}
                    d = await _fetch_json(session, PUNISH_LIST_URL, params=p, headers=headers)
                    if d and d.get("punishments"):
                        return d["punishments"]
                    return []

            tasks = [fetch_page(p_idx) for p_idx in range(2, total_pages + 1)]
            
            if total_pages > 200:
                await interaction.edit_original_response(
                    content=f"⚠️ Очень много страниц ({total_pages}). Процесс может занять время..."
                )

            paged_results = await asyncio.gather(*tasks)
            for punishments in paged_results:
                found_bans.extend(punishments)

    # Фильтруем принудительно
    filtered_bans = [p for p in found_bans if reason_lower in str(p.get("reason", "")).lower()]
    _log(f"📊 Фильтрация завершена: {len(filtered_bans)}/{len(found_bans)} соответствуют причине.")
    
    if not filtered_bans:
        return await interaction.edit_original_response(
            content=f"❌ Просканировано {len(found_bans)} записей, но точных совпадений с причиной `{reason}` не найдено."
        )

    active = 0
    unbanned = 0
    expired = 0
    now = datetime.now(timezone.utc)

    for p in filtered_bans:
        if p.get("unpunish_admin_id"):
            unbanned += 1
        else:
            try:
                expires_str = p.get("expires")
                if not expires_str:
                    active += 1
                else:
                    expires_dt = datetime.fromisoformat(expires_str.replace("Z", "+00:00"))
                    if expires_dt > now:
                        active += 1
                    else:
                        expired += 1
            except Exception:
                active += 1

    embed = discord.Embed(
        title=f"🛡️ Fear Project: Глобальный анализ",
        description=f"Причина: **{reason}**\nВсего проверено записей: **{len(found_bans)}**",
        color=0x4ecb8a,
        timestamp=datetime.now(timezone.utc)
    )
    embed.add_field(name="Всего найдено банов", value=f"**{len(filtered_bans)}**", inline=True)
    embed.add_field(name="📊 Статистика", value=(
        f"🔴 Активных: **{active}**\n"
        f"⚪ Разбаненных: **{unbanned}**\n"
        f"🟡 Истёкших: **{expired}**"
    ), inline=True)
    
    if filtered_bans:
        try:
            filtered_bans.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        except Exception:
            pass
            
        lines = []
        for p in filtered_bans[:10]:
            name = p.get("name", "Неизвестный")
            status = "🔴" if not p.get("unpunish_admin_id") else "⚪"
            lines.append(f"{status} **{name}** — `{p.get('reason','')[:30]}`")
        embed.add_field(name="Последние 10 банов", value="\n".join(lines), inline=False)

    await interaction.edit_original_response(content=None, embed=embed)

@tree.command(name="yooma", description="Проверить игрока на баны yooma.su по SteamID")
@app_commands.describe(steamid="SteamID игрока (76561...)")
async def cmd_yooma(interaction: discord.Interaction, steamid: str):
    # Проверка ролей (Админ и Админ+)
    if _has_yooma_restriction(interaction.user):
        return await interaction.response.send_message("❌ У вас нет прав для использования Yooma чекера.", ephemeral=True)

    # defer ПЕРВЫМ — до любых проверок, чтобы Discord не получил таймаут
    await interaction.response.defer()
    try:
        steamid = steamid.strip()
        async with aiohttp.ClientSession() as session:
            summary_url = f"https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key={STEAM_API_KEY}&steamids={steamid}"
            steam_data, ydata = await asyncio.gather(
                _fetch_json(session, summary_url),
                _check_yooma_ban(session, steamid)
            )
            nickname = steamid
            if steam_data and steam_data.get("response", {}).get("players"):
                nickname = steam_data["response"]["players"][0].get("personaname", steamid)

        embed = _build_yooma_embed(steamid, ydata, nickname)
        await interaction.followup.send(embed=embed)
    except Exception as e:
        _log(f"❌ /yooma ошибка: {e}")
        try:
            await interaction.followup.send(f"❌ Ошибка при проверке: {e}")
        except Exception:
            pass


class AdminSyncCookieModal(discord.ui.Modal, title="Обновить куки Fear Project"):
    cookie_input = discord.ui.TextInput(
        label="Cookie строка с fearproject.ru",
        placeholder="Вставь сюда содержимое Cookie из DevTools → Network → /admins/",
        style=discord.TextStyle.paragraph,
        max_length=2000,
        required=True
    )

    async def on_submit(self, interaction: discord.Interaction):
        global FEAR_COOKIE
        new_cookie = self.cookie_input.value.strip()
        FEAR_COOKIE = new_cookie

        # Сохраняем в .env
        env_path = Path(__file__).parent / ".env"
        try:
            if not env_path.exists():
                env_path.write_text("", encoding="utf-8")
            lines = env_path.read_text(encoding="utf-8").splitlines()
            new_lines = []
            replaced = False
            for line in lines:
                if line.startswith("FEAR_COOKIE="):
                    new_lines.append(f"FEAR_COOKIE={new_cookie}")
                    replaced = True
                else:
                    new_lines.append(line)
            if not replaced:
                new_lines.append(f"FEAR_COOKIE={new_cookie}")
            env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
        except Exception as e:
            _log(f"⚠️ Не удалось сохранить куки в .env: {e}")

        await interaction.response.send_message("🔄 Куки сохранены, обновляю список админов...", ephemeral=True)
        await _refresh_admins_and_notify()
        admins = _load_admins_cache()
        await interaction.edit_original_response(content=f"✅ Список обновлён: **{len(admins)}** админов")
        _log(f"🔑 Куки обновлены пользователем {interaction.user}")


@tree.command(name="adminsync", description="Обновить список админов и их Discord данные")
async def cmd_adminsync(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("Нет прав.", ephemeral=True)
    
    await interaction.response.defer(ephemeral=True)
    _log(f"🔄 Полная синхронизация админов и Discord данных ({interaction.user})")

    fresh = _reload_fear_cookie()
    if not fresh:
        return await interaction.edit_original_response(
            content="❌ FEAR_COOKIE пуст. Используй `/settoken` или добавь его в .env"
        )

    # 1. Синхронизируем список админов и стаффа
    result = await _sync_staff_list()
    if result.get("error"):
        return await interaction.edit_original_response(content=f"❌ Ошибка API Fear: {result['error']}")

    # 2. Сразу синхронизируем Discord данные для ВСЕХ админов
    d_result = await _sync_discord_data(sync_all=True)
    
    await interaction.edit_original_response(
        content=(
            f"✅ Синхронизация завершена!\n"
            f"• Админов в кэше: **{result['admins_total']}**\n"
            f"• Стафф в базе: **{result['total']}** (+{result['new']} новых)\n"
            f"• Discord данные обновлены: **{d_result['updated']}** чел."
        )
    )


@tree.command(name="settoken", description="Обновить Fear куки/токен (перезапускает мониторинг репортов)")
@app_commands.describe(cookie="Cookie строка с fearproject.ru")
async def cmd_settoken(interaction: discord.Interaction, cookie: str):
    if not _is_admin(interaction):
        return await interaction.response.send_message("❌ У вас недостаточно прав.", ephemeral=True)
    global FEAR_COOKIE
    FEAR_COOKIE = cookie.strip()

    # Сохраняем в .env
    env_path = Path(__file__).parent / ".env"
    try:
        if not env_path.exists():
            env_path.write_text("", encoding="utf-8")
        lines = env_path.read_text(encoding="utf-8").splitlines()
        new_lines = []
        replaced = False
        for line in lines:
            if line.startswith("FEAR_COOKIE="):
                new_lines.append(f"FEAR_COOKIE={FEAR_COOKIE}")
                replaced = True
            else:
                new_lines.append(line)
        if not replaced:
            new_lines.append(f"FEAR_COOKIE={FEAR_COOKIE}")
        env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    except Exception as e:
        _log(f"⚠️ Не удалось сохранить куки в .env: {e}")

    # Перезапускаем мониторинг репортов и лидерборд
    if reports_loop.is_running():
        reports_loop.restart()
    else:
        reports_loop.start()

    if leaderboard_sync_loop.is_running():
        leaderboard_sync_loop.restart()
    else:
        leaderboard_sync_loop.start()

    await interaction.response.send_message(
        "✅ Токен обновлён. Мониторинг репортов и синхронизация топа перезапущены.", ephemeral=True
    )
    _log(f"🔑 Fear куки обновлены через /settoken ({interaction.user})")

@tree.command(name="find", description="Найти админа по Discord нику, Discord ID, Steam нику или ингейм нику")
@app_commands.describe(query="Discord никнейм, Discord ID, Steam никнейм или ингейм ник из игры")
async def cmd_findstaff(interaction: discord.Interaction, query: str):
    # Ограничение доступа для Админ и Админ+
    restricted_roles = {ROLE_ADMIN_ID, ROLE_ADMIN_PLUS_ID}
    if hasattr(interaction.user, "roles") and any(r.id in restricted_roles for r in interaction.user.roles):
        return await interaction.response.send_message("❌ У вас недостаточно прав для использования этой команды.", ephemeral=True)

    await interaction.response.defer(ephemeral=True)

    query_lower = query.lower().strip()
    query_is_id = query_lower.isdigit()
    
    async def _search_in_data():
        results = []
        db = _load_staff_db()
        # ── Поиск по локальной базе стаффа ──
        for sid, entry in db.items():
            sid_str = str(sid).strip()
            match = False
            if query_is_id:
                if str(entry.get("discord_id") or "") == query_lower or sid_str == query_lower:
                    match = True
            else:
                discord_name = (entry.get("discord_name") or "").lower()
                steam_name = (entry.get("name") or "").lower()
                if query_lower in discord_name or query_lower in steam_name or query_lower == sid_str:
                    match = True

            if match:
                results.append({
                    "steamid": sid,
                    "name": entry.get("name", sid),
                    "discord_name": entry.get("discord_name") or "—",
                    "discord_id": entry.get("discord_id") or "—",
                    "role": entry.get("role", "—"),
                    "source": "db",
                })

        # ── Поиск по кэшу ВСЕХ админов ──
        admins = _load_admins_cache()
        seen_sids = {r["steamid"] for r in results}
        for admin in admins:
            sid = (admin.get("steamid") or "").strip()
            if not sid or sid in seen_sids:
                continue

            name = (admin.get("name") or "").lower()
            discord_name = (admin.get("discord_nickname") or "").lower()
            discord_id = str(admin.get("discord_id") or "").lower()

            match = False
            if query_is_id:
                if query_lower == sid or query_lower == discord_id or query_lower in name or query_lower in discord_name:
                    match = True
            else:
                if query_lower in name or query_lower in discord_name or query_lower == sid:
                    match = True

            if match:
                results.append({
                    "steamid": sid,
                    "name": admin.get("name", sid),
                    "discord_name": admin.get("discord_nickname") or "—",
                    "discord_id": admin.get("discord_id") or "—",
                    "role": admin.get("group_display_name", "—"),
                    "source": "admin_cache",
                })
        return results

    results = await _search_in_data()

    # ── Шаг 2: Если не нашли — обновляем кэш админов и ищем снова ──
    if not results:
        await interaction.edit_original_response(
            content=f"🔍 `{query}` не найден в локальной базе. Обновляю список админов..."
        )

        try:
            sync_result = await _sync_staff_list()
            if sync_result and not sync_result.get("error"):
                _log(
                    f"✅ /find обновил базу: стаффов {sync_result.get('total', 0)}, "
                    f"админов {sync_result.get('admins_total', 0)}, новых {sync_result.get('new', 0)}, "
                    f"обновлено {sync_result.get('updated', 0)}",
                    discord=False
                )
                results = await _search_in_data()
            else:
                _log(
                    f"⚠️ /find не удалось обновить базу: {sync_result.get('error') if sync_result else 'unknown'}",
                    discord=False
                )
        except Exception as e:
            _log(f"❌ /find ошибка обновления базы: {e}", discord=False)

    # ── Шаг 3: Если всё ещё не нашли — ищем по ингейм нику через Fear API ──
    if not results:
        await interaction.edit_original_response(
            content=f"🔍 `{query}` не найден в локальной базе. Проверяю ингейм ники через Fear API..."
        )

        admins = _load_admins_cache()
        all_sids = list({(admin.get("steamid") or "").strip() for admin in admins if admin.get("steamid")})

        async with aiohttp.ClientSession() as session:
            sem = asyncio.Semaphore(20)
            async def fetch_one(sid):
                async with sem:
                    return sid, await _get_profile(session, sid)
            profiles = await asyncio.gather(*[fetch_one(sid) for sid in all_sids])

        for sid, profile in profiles:
            if not profile or not isinstance(profile, dict):
                continue
            stats = profile.get("stats") or {}
            ingame_name = (stats.get("name") or "").lower()
            if not ingame_name or query_lower not in ingame_name:
                continue

            ag = profile.get("adminGroup")
            admin_group = ""
            if isinstance(ag, dict):
                admin_group = ag.get("group_name", "")
            if not admin_group or str(admin_group).isdigit():
                admin_group = profile.get("rank_name", "")
            if not admin_group or str(admin_group).isdigit():
                admin_group = profile.get("rank", "")

            results.append({
                "steamid": sid,
                "name": profile.get("name", ingame_name),
                "ingame_name": ingame_name,
                "discord_name": "—",
                "discord_id": "—",
                "role": admin_group or "—",
                "source": "fear_api",
            })

    if not results:
        return await interaction.edit_original_response(
            content=f"❌ `{query}` не найден даже после обновления базы. "
                    f"Возможно, админ не привязал Discord к Fear или введён неверный ник/ID."
        )

    embed = discord.Embed(
        title=f"🔍 Результаты поиска: {query}",
        description=f"Найдено: **{len(results)}**",
        color=0x5865f2,
        timestamp=datetime.now(timezone.utc)
    )

    for r in results[:10]:
        source_icon = "🗄️" if r["source"] == "db" else "📋" if r["source"] == "admin_cache" else "🎮"
        ingame = f"\nИгровой ник: **{r['ingame_name']}**" if r.get("ingame_name") else ""
        embed.add_field(
            name=f"{source_icon} {r['name']}  •  {r['role']}",
            value=(
                f"SteamID: `{r['steamid']}`\n"
                f"Discord: **{r['discord_name']}** (`{r['discord_id']}`){ingame}\n"
                f"[Fear](https://fearproject.ru/profile/{r['steamid']}) • [Steam](https://steamcommunity.com/profiles/{r['steamid']})"
            ),
            inline=False
        )

    if len(results) > 10:
        embed.set_footer(text=f"Показано 10 из {len(results)} результатов")

    await interaction.edit_original_response(content=None, embed=embed)


# ── Хранилище результатов проверок VDF ──
VDF_CHECKS_FILE = Path(__file__).parent / "vdf_checks.json"
_vdf_checks: dict[int, dict] = {}
_vdf_check_counter = 0


def _load_vdf_checks():
    global _vdf_check_counter, _vdf_checks

    file_data = None
    if VDF_CHECKS_FILE.exists():
        try:
            file_data = json.loads(VDF_CHECKS_FILE.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"⚠️ Ошибка загрузки vdf_checks.json из файла: {e}")

    db_data = None
    if _db.db_is_available():
        try:
            db_data = _db.db_load("vdf_checks.json")
        except Exception as e:
            print(f"⚠️ Ошибка загрузки vdf_checks.json из БД: {e}")

    data = None
    if file_data and db_data:
        file_counter = file_data.get("counter", 0)
        db_counter = db_data.get("counter", 0)
        data = file_data if file_counter >= db_counter else db_data
    elif file_data:
        data = file_data
    elif db_data:
        data = db_data

    if data:
        try:
            _vdf_check_counter = data.get("counter", 0)
            raw = data.get("checks", {})
            _vdf_checks = {int(k): v for k, v in raw.items()}
            source = "БД" if data is db_data else "файла"
            print(f"📂 Загружено VDF проверок: {len(_vdf_checks)}, счётчик: #{_vdf_check_counter} ({source})")
        except Exception as e:
            print(f"⚠️ Ошибка разбора vdf_checks.json: {e}")
            _vdf_check_counter = 0
            _vdf_checks = {}
    else:
        _vdf_check_counter = 0
        _vdf_checks = {}

    # Синхронизация с БД: берём максимальный check_id из vdf_history
    if _db.db_is_available():
        try:
            db_max = _db.db_get_max_vdf_check_id()
            print(f"📂 [VDF] max check_id в БД: {db_max}, текущий счётчик: {_vdf_check_counter}")
            if db_max > _vdf_check_counter:
                _vdf_check_counter = db_max
                print(f"📂 Счётчик VDF синхронизирован с БД: #{_vdf_check_counter}")
        except Exception as e:
            print(f"⚠️ Ошибка синхронизации счётчика VDF из БД: {e}")


def _save_vdf_checks_to_file():
    try:
        payload = {
            "counter": _vdf_check_counter,
            "checks": _vdf_checks,
        }
        _save_json_atomic(VDF_CHECKS_FILE, payload)
        if _db.db_is_available():
            try:
                _db.db_save("vdf_checks.json", payload)
            except Exception as e:
                print(f"⚠️ Ошибка сохранения vdf_checks.json в БД: {e}")
    except Exception as e:
        print(f"⚠️ Ошибка сохранения vdf_checks.json: {e}")


def _save_vdf_check(results: list[dict], filename: str, attachment_url: str = "", message_url: str = "", vdf_text: str = "") -> int:
    global _vdf_check_counter

    # Используем общую последовательность БД, чтобы сайт и бот не пересекались по check_id
    db_next = 0
    try:
        db_next = _db.db_get_next_vdf_check_id()
        print(f"🔢 [VDF] next check_id из БД: {db_next}")
    except Exception as e:
        print(f"⚠️ Ошибка получения next check_id из БД: {e}")

    if db_next > 0:
        _vdf_check_counter = db_next
    else:
        # Fallback: пытаемся создать последовательность и использовать её
        try:
            _db.db_ensure_vdf_sequence()
            db_next = _db.db_get_next_vdf_check_id()
            if db_next > 0:
                _vdf_check_counter = db_next
                print(f"🔢 [VDF] fallback через последовательность: {_vdf_check_counter}")
            else:
                # Крайний fallback — MAX+1
                db_max = _db.db_get_max_vdf_check_id()
                print(f"🔢 [VDF] fallback max check_id из БД: {db_max}, текущий счётчик: {_vdf_check_counter}")
                if db_max >= _vdf_check_counter:
                    _vdf_check_counter = db_max
                _vdf_check_counter += 1
                print(f"🔢 [VDF] fallback next check_id: {_vdf_check_counter}")
        except Exception as e:
            print(f"⚠️ [VDF] fallback ошибка: {e}")
            db_max = _db.db_get_max_vdf_check_id()
            if db_max >= _vdf_check_counter:
                _vdf_check_counter = db_max
            _vdf_check_counter += 1

    check_id = _vdf_check_counter

    # ── Защита от дубликатов: убедимся что check_id больше MAX в БД ──
    try:
        db_max = _db.db_get_max_vdf_check_id()
        if check_id <= db_max:
            check_id = db_max + 1
            _vdf_check_counter = check_id
            print(f"🔢 [VDF] check_id подтянут выше MAX: {check_id}")
    except Exception:
        pass

    _vdf_checks[check_id] = {
        "results": results,
        "filename": filename,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "attachment_url": attachment_url,
        "message_url": message_url,
        "steamids": [r.get("steamid") for r in results if r.get("steamid")],
    }

    # ── Ограничиваем память: храним только последние 50 VDF-проверок ──
    VDF_MAX_IN_MEMORY = 50
    if len(_vdf_checks) > VDF_MAX_IN_MEMORY:
        oldest_keys = sorted(_vdf_checks.keys())[:len(_vdf_checks) - VDF_MAX_IN_MEMORY]
        for k in oldest_keys:
            _vdf_checks.pop(k, None)

    _save_vdf_checks_to_file()

    # ── Сохраняем в PostgreSQL ──
    try:
        steamids = [r.get("steamid") for r in results if r.get("steamid")]
        if steamids and vdf_text:
            config_hash = hashlib.sha256(vdf_text.encode("utf-8", errors="ignore")).hexdigest()[:64]
            _db.db_save_config_accounts(config_hash, steamids, filename, vdf_text)
            saved_check_id = _db.db_save_vdf_history(results, config_hash=config_hash, filename=filename, check_id=check_id,
                                    attachment_url=attachment_url, message_url=message_url, source="bot")
            print(f"✅ [VDF] Проверка #{check_id} сохранена в PostgreSQL (db_check_id={saved_check_id})")
        else:
            print(f"⚠️ [VDF] Проверка #{check_id} не сохранена в PostgreSQL: нет steamids или vdf_text")
    except Exception as e:
        print(f"⚠️ Ошибка сохранения VDF #{check_id} в PostgreSQL: {e}")

    return check_id


_db.db_ensure_vdf_sequence()
_load_vdf_checks()
_save_vdf_checks_to_file()


# ── Повторная проверка VDF-файлов при появлении игроков на серверах ──
_vdf_recheck_lock = asyncio.Lock()
_vdf_recheck_last: dict[int, float] = {}


async def _recheck_vdf_check(check_id: int, steamids: list[str]):
    try:
        new_results = await _check_vdf_accounts(steamids)
        if not new_results:
            return
        result_map = {r.get("steamid"): r for r in new_results if r.get("steamid")}
        existing = _vdf_checks[check_id].get("results", [])
        updated = 0
        for r in existing:
            sid = r.get("steamid")
            if sid and sid in result_map:
                r.update(result_map[sid])
                updated += 1
        _vdf_checks[check_id]["last_recheck"] = datetime.now(timezone.utc).isoformat()
        _save_vdf_checks_to_file()

        # ── Обновляем общую БД (PostgreSQL) ──
        try:
            if _db.db_is_available() and existing:
                steamids_for_db = [r.get("steamid") for r in existing if r.get("steamid")]
                if steamids_for_db:
                    vdf_text = _vdf_checks[check_id].get("vdf_text", "")
                    config_hash = ""
                    if vdf_text:
                        config_hash = hashlib.sha256(vdf_text.encode("utf-8", errors="ignore")).hexdigest()[:64]
                    _db.db_save_vdf_history(
                        existing,
                        config_hash=config_hash,
                        filename=_vdf_checks[check_id].get("filename", ""),
                        check_id=check_id,
                        attachment_url=_vdf_checks[check_id].get("attachment_url", ""),
                        message_url=_vdf_checks[check_id].get("message_url", ""),
                        source="bot"
                    )
                    _log(f"🔄 [DB] VDF #{check_id} перезаписана в PostgreSQL", discord=False)
        except Exception as e:
            _log(f"⚠️ [DB] VDF recheck #{check_id} save error: {e}", discord=False)

        _log(f"🔄 VDF #{check_id}: обновлено {updated}/{len(steamids)} аккаунтов", discord=False)
    except Exception as e:
        _log(f"⚠️ VDF recheck #{check_id} ошибка: {e}", discord=False)


@tasks.loop(minutes=5)
async def vdf_recheck_loop():
    if not _vdf_checks:
        return
    async with _vdf_recheck_lock:
        try:
            async with aiohttp.ClientSession() as session:
                servers = await _fetch_json(session, f"{API_BASE}/servers")
            if not servers:
                return
            online_sids = set()
            for srv in servers:
                for player in srv.get("live_data", {}).get("players", []):
                    sid = str(player.get("steam_id") or "").strip()
                    if sid:
                        online_sids.add(sid)
            if not online_sids:
                return
            now = time.time()
            recheck_queue = []
            for check_id, check in _vdf_checks.items():
                if now - _vdf_recheck_last.get(check_id, 0) < 600:
                    continue
                check_sids = {r.get("steamid") for r in check.get("results", []) if r.get("steamid")}
                if not (check_sids & online_sids):
                    continue
                recheck_queue.append((check_id, list(check_sids)))
                _vdf_recheck_last[check_id] = now
            if not recheck_queue:
                return
            recheck_queue = recheck_queue[:10]
            _log(f"🔄 VDF recheck: {len(recheck_queue)} файлов с онлайн-игроками", discord=False)
            for check_id, steamids in recheck_queue:
                await _recheck_vdf_check(check_id, steamids)
                await asyncio.sleep(2)
        except Exception as e:
            _log(f"⚠️ VDF recheck loop ошибка: {e}", discord=False)


@tree.command(name="profile", description="Показать профиль игрока: баланс, статистика, роль, место в топе")
@app_commands.describe(steamid="SteamID64 игрока")
async def cmd_profile(interaction: discord.Interaction, steamid: str):
    await interaction.response.defer(ephemeral=True)
    steamid = steamid.strip()

    async with aiohttp.ClientSession() as session:
        profile = await _get_profile(session, steamid)

    if not profile:
        return await interaction.edit_original_response(content=f"❌ Профиль `{steamid}` не найден на Fear Project.")

    stats = profile.get("stats") or {}
    name = profile.get("name", "—")
    balance = profile.get("balance", 0)
    rank = stats.get("rank", "—")
    position = stats.get("position", "—")
    kills = stats.get("kills", 0)
    deaths = stats.get("deaths", 0)
    playtime = stats.get("playtime", 0)
    playtime_h = round(playtime / 3600, 1) if playtime else 0
    kd = round(kills / deaths, 2) if deaths else 0

    ag = profile.get("adminGroup")
    admin_group = ""
    if isinstance(ag, dict):
        admin_group = ag.get("group_name", "")
    if not admin_group or str(admin_group).isdigit():
        admin_group = profile.get("rank_name", "")
    if not admin_group or str(admin_group).isdigit():
        admin_group = profile.get("rank", "")

    ban_info = profile.get("banInfo") or {}
    is_banned = ban_info.get("isBanned", False)

    vip_info = profile.get("vipInfo") or {}
    is_vip = vip_info.get("isVip", False)

    likes = profile.get("likes") or {}
    likes_count = likes.get("likes", 0)
    dislikes_count = likes.get("dislikes", 0)

    avatar = profile.get("avatar_full") or profile.get("avatar") or ""

    embed = discord.Embed(
        title=f"👤 {name}",
        color=0xe74c3c if is_banned else 0x2ecc71,
        url=f"https://fearproject.ru/profile/{steamid}",
        timestamp=datetime.now(timezone.utc)
    )
    if avatar:
        embed.set_thumbnail(url=avatar)

    embed.add_field(name="💰 Баланс", value=f"**{balance}**", inline=True)
    embed.add_field(name="🏆 Место", value=f"**#{position}**" if position else "—", inline=True)
    embed.add_field(name="📊 Ранг", value=f"**{rank}**" if rank else "—", inline=True)

    embed.add_field(name="🔫 Kills", value=f"**{kills}**", inline=True)
    embed.add_field(name="💀 Deaths", value=f"**{deaths}**", inline=True)
    embed.add_field(name="📈 K/D", value=f"**{kd}**", inline=True)

    embed.add_field(name="⏱️ Часы в игре", value=f"**{playtime_h}ч**", inline=True)
    embed.add_field(name="👍 Лайки", value=f"👍 {likes_count} / 👎 {dislikes_count}", inline=True)
    embed.add_field(name="🚫 Бан", value="Забанен" if is_banned else "Свободен", inline=True)

    role_str = f"**{admin_group}**" if admin_group else "—"
    vip_str = f"✅ {vip_info.get('group', '')}" if is_vip else "—"
    embed.add_field(name="👮 Роль", value=role_str, inline=True)
    embed.add_field(name="⭐ VIP", value=vip_str, inline=True)
    embed.add_field(name="🆔 SteamID", value=f"`{steamid}`", inline=True)

    embed.add_field(
        name="🔗 Ссылки",
        value=f"[Fear](https://fearproject.ru/profile/{steamid}) • [Steam](https://steamcommunity.com/profiles/{steamid}) • [Yooma](https://yooma.su/ru/profile/{steamid})",
        inline=False
    )

    await interaction.edit_original_response(content=None, embed=embed)


@tree.command(name="checkinfo", description="Подробная информация о проверке VDF по номеру (#1, #2...) или SteamID")
@app_commands.describe(query="Номер проверки (#1, #2...) или SteamID")
async def cmd_checkinfo(interaction: discord.Interaction, query: str):
    await interaction.response.defer(ephemeral=True)
    query = query.strip()

    # Поиск по номеру проверки
    check_num = None
    if query.startswith("#"):
        try:
            check_num = int(query[1:])
        except ValueError:
            pass

    if check_num and check_num in _vdf_checks:
        check = _vdf_checks[check_num]
        results = check["results"]
        filename = check["filename"]
        ts = check["timestamp"]

        banned = [r for r in results if r.get("fear_banned") or r.get("vac_banned") or (r.get("game_bans", 0) > 0) or ((r.get("yooma_data") or {}).get("found"))]
        not_fear = [r for r in results if not r.get("on_fear")]
        registered = [r for r in results if r.get("on_fear")]

        embed = discord.Embed(
            title=f"📋 Проверка #{check_num} — {filename}",
            description=(
                f"Дата: {ts[:19].replace('T', ' ')} UTC\n"
                f"Всего: **{len(results)}** | На Fear: **{len(registered)}** | "
                f"С банами: **{len(banned)}** | Нет на Fear: **{len(not_fear)}**"
            ),
            color=0x5865f2,
            timestamp=datetime.now(timezone.utc)
        )

        lines = []
        for r in results:
            sid = r["steamid"]
            name = r.get("name", sid)
            parts = ["✅ Fear" if r.get("on_fear") else "❌ Нет на Fear"]
            if r.get("fear_banned"):
                parts.append(f"Fear бан: {r.get('fear_reason', '')}" + (f" до {r['fear_unban']}" if r.get("fear_unban") else ""))
            if r.get("vac_banned"):
                parts.append(f"VAC: {r.get('vac_days', 0)} дн.")
            if r.get("community_ban"):
                parts.append("Comm: бан")
            if r.get("game_bans", 0) > 0:
                parts.append(f"Game банов: {r['game_bans']}")
            ydata = r.get("yooma_data") or {}
            if ydata.get("found"):
                active = [p for p in ydata.get("punishments", []) if p.get("status") == "active"]
                if active:
                    parts.append(f"Yooma: {active[0].get('reason', '')}")
            lines.append(f"{name} ({sid}) — {' | '.join(parts)}")

        file_text = f"Проверка #{check_num} — {filename}\nДата: {ts}\nВсего: {len(results)}\n\n" + "\n".join(lines)
        file_obj = io.BytesIO(file_text.encode("utf-8"))
        file_obj.seek(0)
        discord_file = discord.File(fp=file_obj, filename=f"check_{check_num}.txt")

        return await interaction.edit_original_response(content=None, embed=embed, attachments=[discord_file])

    # Поиск по SteamID
    target_sid = query
    found_checks = []
    for num, check in sorted(_vdf_checks.items()):
        for r in check["results"]:
            if r["steamid"] == target_sid:
                found_checks.append((num, r, check))
                break

    if not found_checks:
        return await interaction.edit_original_response(
            content=f"❌ `{query}` не найден в сохранённых проверках. Используй номер (#1) или SteamID."
        )

    # Подтягиваем профиль для статистики
    profile = None
    async with aiohttp.ClientSession() as session:
        profile = await _get_profile(session, target_sid)
    stats = profile.get("stats", {}) if profile else {}
    playtime_h = round((stats.get("playtime", 0) or 0) / 3600, 1)
    position = stats.get("position", "—")
    balance = profile.get("balance", 0) if profile else 0
    kills = stats.get("kills", 0)
    deaths = stats.get("deaths", 0)
    kd = round(kills / deaths, 2) if deaths else 0
    ingame_name = (stats.get("name") or "").strip()

    fear_url = f"https://fearproject.ru/profile/{target_sid}"
    steam_url = f"https://steamcommunity.com/profiles/{target_sid}"

    ag = profile.get("adminGroup") if profile else None
    admin_group = ""
    if isinstance(ag, dict):
        admin_group = ag.get("group_name", "")
    if not admin_group or str(admin_group).isdigit():
        admin_group = (profile or {}).get("rank_name", "")

    profile_name = (profile or {}).get("name", target_sid)
    name_display = ingame_name if ingame_name else profile_name
    role_tag = f" [{admin_group}]" if admin_group else ""

    embed = discord.Embed(
        title=f"🔍 {name_display}{role_tag} — {profile_name}",
        url=fear_url,
        color=0x5865f2,
        timestamp=datetime.now(timezone.utc)
    )

    embed.add_field(name="💰 Баланс", value=f"**{balance}**", inline=True)
    embed.add_field(name="🏆 Место", value=f"**#{position}**" if position else "—", inline=True)
    embed.add_field(name="📈 K/D", value=f"**{kd}**", inline=True)
    embed.add_field(name="⏱️ Часы", value=f"**{playtime_h}ч**", inline=True)
    embed.add_field(name="🔫 Kills", value=f"**{kills}**", inline=True)
    embed.add_field(name="💀 Deaths", value=f"**{deaths}**", inline=True)
    embed.add_field(name="🆔 SteamID", value=f"`{target_sid}`", inline=True)

    for num, r, check in found_checks[:3]:
        fear_banned = r.get("fear_banned", False)
        ban_str = f"🔨 Бан: {r.get('fear_reason', '')}" if fear_banned else "✅ Без бана"

        ydata = r.get("yooma_data") or {}
        yooma_str = ""
        if ydata.get("found") and ydata.get("punishments"):
            p = ydata["punishments"][0]
            if p.get("status") == "active":
                yooma_str = f"🔴 Yooma: {p.get('reason', '')}"
            else:
                yooma_str = f"⚪ Yooma: {p.get('reason', '')}"
        else:
            yooma_str = "🟢 Yooma: чисто"

        vac_str = f"🚫 VAC: {r.get('vac_days', '')} дн." if r.get("vac_banned") else ""

        embed.add_field(
            name=f"📋 Проверка #{num}",
            value=f"{ban_str}\n{yooma_str}\n{vac_str}" if vac_str else f"{ban_str}\n{yooma_str}",
            inline=False
        )

    embed.add_field(
        name="🔗 Ссылки",
        value=f"[Fear]({fear_url}) • [Steam]({steam_url}) • [Yooma](https://yooma.su/ru/profile/{target_sid})",
        inline=False
    )

    await interaction.edit_original_response(content=None, embed=embed)


@tree.command(name="vdfdownload", description="Скачать оригинальный .vdf файл из истории проверки")
@app_commands.describe(check_id="Номер проверки (#1, #2...)")
async def cmd_vdfdownload(interaction: discord.Interaction, check_id: str):
    if not _is_admin(interaction):
        return await interaction.response.send_message("❌ Нет прав.", ephemeral=True)
    await interaction.response.defer(ephemeral=True)

    num = None
    if check_id.startswith("#"):
        try:
            num = int(check_id[1:])
        except ValueError:
            pass
    else:
        try:
            num = int(check_id)
        except ValueError:
            pass

    if not num:
        return await interaction.edit_original_response(content="❌ Нужен номер проверки, например `#1`.")

    res = _db.db_get_vdf_content_by_check_id(num)
    if not res or not res[0]:
        return await interaction.edit_original_response(
            content=f"❌ VDF-файл для проверки #{num} не найден в БД. Возможно, он был загружен до добавления сохранения содержимого."
        )

    content, filename = res
    file_obj = io.BytesIO(content.encode("utf-8"))
    file_obj.seek(0)
    discord_file = discord.File(fp=file_obj, filename=filename or f"check_{num}.vdf")
    await interaction.edit_original_response(content=f"📁 Проверка #{num}", attachments=[discord_file])


@tree.command(name="fulldrops", description="Полная таблица дропов: все страницы leaderboard, кто сколько получил")
async def cmd_fulldrops(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True)

    all_players = []
    total_count = 0
    page = 1

    async with aiohttp.ClientSession() as session:
        headers = await _fear_headers()
        while True:
            url = f"{API_BASE}/leaderboard/drops"
            try:
                async with session.get(url, params={"page": page, "limit": 50}, headers=headers,
                                       timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status != 200:
                        break
                    data = await resp.json(content_type=None)
                    if not data:
                        break
                    if page == 1:
                        total_count = data.get("total", 0)
                    players = data.get("players", [])
                    if not players:
                        break
                    all_players.extend(players)
                    if len(all_players) >= total_count:
                        break
                    page += 1
                    await asyncio.sleep(0.3)
            except Exception:
                break

    if not all_players:
        return await interaction.edit_original_response(content="📭 Данные leaderboard пусты.")

    total_value = sum(p.get("total", 0) for p in all_players)
    total_skins = sum(p.get("count", 0) for p in all_players)

    embed = discord.Embed(
        title="🎮 Таблица дропов — Топ игроков",
        color=0xf1c40f,
        timestamp=datetime.now(timezone.utc)
    )
    embed.add_field(name="💰 Общая стоимость", value=f"**{total_value:.2f} ₽**", inline=True)
    embed.add_field(name="📦 Всего скинов", value=f"**{total_skins}**", inline=True)
    embed.add_field(name="👥 Игроков", value=f"**{len(all_players)}**", inline=True)

    lines = []
    for p in all_players[:15]:
        pos = p.get("position", "?")
        name = p.get("name", "—")
        sid = p.get("steamid", "")
        total = p.get("total", 0)
        count = p.get("count", 0)
        fear_url = f"https://fearproject.ru/profile/{sid}"

        skins = p.get("skins", [])
        skin_names = ", ".join(s.get("name", "") for s in skins[:3])
        if len(skins) > 3:
            skin_names += f" +{len(skins) - 3}"

        lines.append(
            f"**#{pos}** [{name}]({fear_url}) — **{total}₽** ({count} шт.)\n"
            f"└ {skin_names}"
        )

    embed.description = "\n\n".join(lines)

    if len(all_players) > 15:
        embed.set_footer(text=f"Показано 15 из {len(all_players)} игроков")

    await interaction.edit_original_response(content=None, embed=embed)



@tree.command(name="syncdiscord", description="Обновить Discord данные всех стаффов вручную")
async def cmd_syncdiscord(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("Нет прав.", ephemeral=True)
    await interaction.response.defer(ephemeral=True)

    _log(f"🔄 Ручное обновление Discord данных ({interaction.user})")
    result = await _sync_discord_data()

    if result.get("error"):
        await interaction.followup.send(f"❌ Ошибка: {result['error']}", ephemeral=True)
    else:
        await interaction.followup.send(
            f"✅ Discord данные обновлены: **{result['updated']}**/{result['total']} стаффов",
            ephemeral=True
        )

@tree.command(name="leaderstaff", description="Топ стаффа по активности за текущий месяц")
async def cmd_leaderstaff(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("❌ У вас недостаточно прав.", ephemeral=True)
    await interaction.response.defer()
    try:
        now = datetime.now(tz=timezone.utc)
        # Текущий месяц
        import calendar
        _, days = calendar.monthrange(now.year, now.month)
        df = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        dt = datetime(now.year, now.month, days, 23, 59, 59, tzinfo=timezone.utc)

        entries = _get_staff_cache_files()
        rows = []
        for sid, data, entry in entries:
            s = _calc_stats(data, df, dt)
            name = entry.get("name") or s["admin_name"] or sid
            role = entry.get("role", "")
            rows.append((sid, s, name, role))
        rows.sort(key=lambda x: x[1]["total"], reverse=True)

        medals = ["🥇", "🥈", "🥉"]
        period = f"{MONTH_RU[now.month]} {now.year}"

        embed = discord.Embed(
            title=f"🏆 Лидеры стаффа — {period}",
            color=0xf0b840,
            timestamp=datetime.now(timezone.utc)
        )

        top3 = rows[:3]
        if not top3:
            embed.description = "Нет данных за текущий месяц."
        else:
            desc = ""
            for i, (sid, s, name, role) in enumerate(top3):
                role_str = f"  `{role}`" if role else ""
                desc += (
                    f"## {medals[i]} {name}{role_str}\n"
                    f"🔨 **{s['bans']}** банов  🔇 **{s['mutes']}** мутов  "
                    f"📊 **{s['total']}** всего  ✂️ {s['removed']} снято\n\n"
                )
            embed.description = desc
        embed.set_footer(text=f"🔨 Баны  🔇 Муты  📊 Всего  ✂️ Снято")
        await interaction.followup.send(embed=embed)
    except Exception as e:
        await interaction.followup.send(f"Ошибка: {e}")


@tree.command(name="leaderstaff_panel", description="Разместить панель топ-3 стаффа по наказаниям (модератор+)")
async def cmd_leaderstaff_panel(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("❌ Недостаточно прав.", ephemeral=True)
    await interaction.response.defer(ephemeral=True)
    try:
        embed = await asyncio.to_thread(_build_leaderstaff_embed)
        msg = await interaction.channel.send(embed=embed)
        _save_leaderstaff_panel(interaction.channel.id, msg.id)
        await interaction.followup.send("✅ Панель лидеров размещена. Будет обновляться автоматически.", ephemeral=True)
        _log(f"🏆 /leaderstaff_panel размещён в #{interaction.channel.name} msg={msg.id} ({interaction.user})")
    except Exception as e:
        _log(f"❌ /leaderstaff_panel ошибка: {e}")
        await interaction.followup.send(f"❌ Ошибка: {e}", ephemeral=True)


@tree.command(name="punishments_sync", description="Обновить статус всех наказаний в all_punishments_log.json")
async def cmd_punishments_sync(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("❌ Недостаточно прав.", ephemeral=True)
    await interaction.response.defer(ephemeral=True)
    await interaction.followup.send("⏳ Запущено обновление всех наказаний в all_punishments_log... Это может занять несколько минут.", ephemeral=True)
    try:
        staff_ids = {str(sid).strip() for sid in _load_staff_db().keys() if str(sid).strip()}
        if not staff_ids:
            return await interaction.followup.send("❌ Нет стаффа в базе.", ephemeral=True)
        
        data = _load_all_punishments()
        updated_count = 0
        removed_count = 0

        async with aiohttp.ClientSession() as session:
            for i, sid in enumerate(staff_ids, 1):
                try:
                    fresh = await _fetch_punishments(session, sid)
                    if not fresh:
                        continue
                    for b in fresh.get("bans", []):
                        bid = str(b.get("id"))
                        if bid and bid in data.get("bans", {}):
                            if data["bans"][bid] != b:
                                data["bans"][bid] = b
                                updated_count += 1
                    for m in fresh.get("mutes", []):
                        mid = str(m.get("id"))
                        if mid and mid in data.get("mutes", {}):
                            if data["mutes"][mid] != m:
                                data["mutes"][mid] = m
                                updated_count += 1
                except Exception as e:
                    _log(f"⚠️ Punishments sync error for {sid}: {e}", discord=False)
                if i % 5 == 0:
                    await asyncio.sleep(1)

        # Очистка мусора
        for key in ("bans", "mutes"):
            for pid in list(data.get(key, {}).keys()):
                item = data[key][pid]
                admin_sid = str(item.get("admin_steamid") or "").strip()
                if admin_sid and admin_sid not in staff_ids:
                    del data[key][pid]
                    removed_count += 1

        if updated_count or removed_count:
            _save_all_punishments(data)
        
        await interaction.followup.send(
            f"✅ Обновление завершено: **{updated_count}** записей обновлено, **{removed_count}** удалено.",
            ephemeral=True
        )
        _log(f"📝 /punishments_sync: обновлено {updated_count}, удалено {removed_count} ({interaction.user})")
    except Exception as e:
        _log(f"❌ /punishments_sync ошибка: {e}")
        await interaction.followup.send(f"❌ Ошибка: {e}", ephemeral=True)


class PunishmentSelector(discord.ui.View):
    """Пагинация для выбора наказания при снятии по steamid."""
    def __init__(self, punishments: list, owner_id: int, punish_type: int):
        super().__init__(timeout=120)
        self.punishments = punishments
        self.owner_id = owner_id
        self.punish_type = punish_type
        self.page = 0

    def _build_embed(self) -> discord.Embed:
        p = self.punishments[self.page]
        total = len(self.punishments)
        type_name = "бан" if self.punish_type == 1 else "мут"

        created_ts = p.get("created", 0)
        expires_ts = p.get("expires", 0)
        duration_sec = p.get("duration", 0)
        now_ts = datetime.now(timezone.utc).timestamp()

        created_str = _msk_from_timestamp(created_ts) if created_ts else "—"

        if expires_ts and expires_ts > 0:
            remaining = int(expires_ts - now_ts)
            if remaining <= 0:
                expires_str = "Истёк"
            else:
                expires_str = f"{_format_duration(remaining)} осталось"
        elif duration_sec and duration_sec > 0:
            expires_str = f"{_format_duration(duration_sec)} (от выдачи)"
        else:
            expires_str = "Навсегда"

        reason = p.get("reason", "—")
        server_id = p.get("server_id", "—")

        embed = discord.Embed(
            title=f"📋 Снятие {type_name}а — {self.page + 1}/{total}",
            color=0xe74c3c if self.punish_type == 1 else 0xf39c12
        )
        embed.add_field(name="🆔 ID", value=f"`{p.get('id')}`", inline=True)
        embed.add_field(name="👤 Ник", value=p.get("name", "—"), inline=True)
        embed.add_field(name="🆔 SteamID", value=f"`{p.get('steamid')}`", inline=True)
        embed.add_field(name="📋 Причина", value=reason, inline=True)
        embed.add_field(name="📅 Выдан", value=created_str, inline=True)
        embed.add_field(name="⏳ Срок", value=expires_str, inline=True)
        embed.add_field(name="🖥 Сервер", value=f"`{server_id}`", inline=True)
        if self.punish_type == 2:
            mute_type_name = "🔊 Войс" if p.get("type") == 1 else "💬 Чат"
            embed.add_field(name="🔇 Тип", value=mute_type_name, inline=True)
        return embed

    @discord.ui.button(label="◀️", style=discord.ButtonStyle.secondary)
    async def prev_page(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user.id != self.owner_id:
            return await interaction.response.send_message("❌ Только для владельца.", ephemeral=True)
        self.page = (self.page - 1) % len(self.punishments)
        await interaction.response.edit_message(embed=self._build_embed(), view=self)

    @discord.ui.button(label="🗑 Снять", style=discord.ButtonStyle.danger)
    async def remove_punishment(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user.id != self.owner_id:
            return await interaction.response.send_message("❌ Только для владельца.", ephemeral=True)
        p = self.punishments[self.page]
        pid = p.get("id")
        type_name = "бан" if self.punish_type == 1 else "мут"

        await interaction.response.defer(ephemeral=True)
        async with aiohttp.ClientSession() as session:
            ok = await _fear_delete_punishment(session, pid)

        if ok:
            await interaction.edit_original_response(
                content=f"✅ Наказание **#{pid}** ({type_name}) снято с **{p.get('steamid')}**.",
                embed=None, view=None
            )
        else:
            await interaction.edit_original_response(
                content=f"❌ Не удалось снять наказание **#{pid}**.", embed=None, view=None
            )
        self.stop()

    @discord.ui.button(label="▶️", style=discord.ButtonStyle.secondary)
    async def next_page(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user.id != self.owner_id:
            return await interaction.response.send_message("❌ Только для владельца.", ephemeral=True)
        self.page = (self.page + 1) % len(self.punishments)
        await interaction.response.edit_message(embed=self._build_embed(), view=self)

    async def on_timeout(self):
        for item in self.children:
            item.disabled = True


@tree.command(name="ban", description="Забанить игрока на Fear Project")
@app_commands.describe(steamid="SteamID64, ссылка на Steam/Fear профиль", reason="Причина бана", duration="Срок: 24h, 7d, 30m, 60s")
@app_commands.default_permissions()
async def cmd_ban(interaction: discord.Interaction, steamid: str, reason: str, duration: str):
    if not _has_punishment_access(interaction.user):
        return await interaction.response.send_message("❌ Нет доступа к этой команде.", ephemeral=True)

    await interaction.response.defer(ephemeral=False)
    resolved = await _resolve_steamid(steamid)
    if not resolved:
        return await interaction.followup.send(f"❌ Не удалось распознать SteamID из **{steamid}**.", ephemeral=True)
    steamid = resolved
    duration_sec = _parse_duration(duration)

    async with aiohttp.ClientSession() as session:
        ok = await _fear_autoban(session, steamid, reason, duration_sec)

    _log(f"🔨 [BAN] {interaction.user} ({interaction.user.id}) -> бан {steamid} на {_format_duration(duration_sec)}. Причина: {reason}. Результат: {'OK' if ok else 'FAIL'}", discord=False)
    if ok:
        await interaction.followup.send(f"✅ **{steamid}** забанен на **{_format_duration(duration_sec)}**.\nПричина: {reason}")
    else:
        await interaction.followup.send(f"❌ Не удалось забанить **{steamid}**. Проверь FEAR_COOKIE.", ephemeral=True)


@tree.command(name="unban", description="Разбанить игрока на Fear Project")
@app_commands.describe(steamid="SteamID64, ссылка на Steam/Fear профиль")
@app_commands.default_permissions()
async def cmd_unban(interaction: discord.Interaction, steamid: str):
    if not _has_punishment_access(interaction.user):
        return await interaction.response.send_message("❌ Нет доступа к этой команде.", ephemeral=True)

    await interaction.response.defer(ephemeral=False)
    resolved = await _resolve_steamid(steamid)
    if not resolved:
        return await interaction.followup.send(f"❌ Не удалось распознать SteamID из **{steamid}**.", ephemeral=True)
    steamid = resolved

    async with aiohttp.ClientSession() as session:
        active = await _get_active_by_steamid(session, steamid, 1)

    if not active:
        return await interaction.followup.send(f"📭 Нет активных банов для **{steamid}**.", ephemeral=True)

    if len(active) == 1:
        pid = active[0].get("id")
        async with aiohttp.ClientSession() as session:
            ok = await _fear_delete_punishment(session, pid)
        _log(f"🔓 [UNBAN] {interaction.user} ({interaction.user.id}) -> разбан #{pid} для {steamid}. Результат: {'OK' if ok else 'FAIL'}", discord=False)
        if ok:
            return await interaction.followup.send(f"✅ Бан **#{pid}** для **{steamid}** снят.")
        else:
            return await interaction.followup.send(f"❌ Не удалось снять бан **#{pid}**.", ephemeral=True)

    view = PunishmentSelector(active, interaction.user.id, 1)
    await interaction.followup.send(
        content=f"🔍 Найдено **{len(active)}** активных банов для **{steamid}**. Выбери какой снять:",
        embed=view._build_embed(),
        view=view,
        ephemeral=True
    )


@tree.command(name="mute", description="Замутить игрока на Fear Project (только владелец)")
@app_commands.describe(steamid="SteamID64, ссылка на Steam/Fear профиль", reason="Причина мута", duration="Срок: 24h, 7d, 30m, 60s", mute_type="Тип мута")
@app_commands.choices(mute_type=[
    app_commands.Choice(name="🔊 Войс", value="voice"),
    app_commands.Choice(name="💬 Чат", value="chat"),
])
@app_commands.default_permissions()
async def cmd_mute(interaction: discord.Interaction, steamid: str, reason: str, duration: str, mute_type: str):
    if not _has_punishment_access(interaction.user):
        return await interaction.response.send_message("❌ Нет доступа к этой команде.", ephemeral=True)

    await interaction.response.defer(ephemeral=False)
    resolved = await _resolve_steamid(steamid)
    if not resolved:
        return await interaction.followup.send(f"❌ Не удалось распознать SteamID из **{steamid}**.", ephemeral=True)
    steamid = resolved
    duration_sec = _parse_duration(duration)
    ptype = 1 if mute_type == "voice" else 2

    async with aiohttp.ClientSession() as session:
        ok = await _fear_mute(session, steamid, reason, duration_sec, punish_type=ptype)

    type_name = "войс" if ptype == 1 else "чат"
    _log(f"🔇 [MUTE] {interaction.user} ({interaction.user.id}) -> мут {steamid} ({type_name}) на {_format_duration(duration_sec)}. Причина: {reason}. Результат: {'OK' if ok else 'FAIL'}", discord=False)
    if ok:
        await interaction.followup.send(f"✅ **{steamid}** замьючен ({type_name}) на **{_format_duration(duration_sec)}**.\nПричина: {reason}")
    else:
        await interaction.followup.send(f"❌ Не удалось замутить **{steamid}**. Проверь FEAR_COOKIE.", ephemeral=True)


@tree.command(name="unmute", description="Размутить игрока на Fear Project (только владелец)")
@app_commands.describe(steamid="SteamID64, ссылка на Steam/Fear профиль")
@app_commands.default_permissions()
async def cmd_unmute(interaction: discord.Interaction, steamid: str):
    if not _has_punishment_access(interaction.user):
        return await interaction.response.send_message("❌ Нет доступа к этой команде.", ephemeral=True)

    await interaction.response.defer(ephemeral=False)
    resolved = await _resolve_steamid(steamid)
    if not resolved:
        return await interaction.followup.send(f"❌ Не удалось распознать SteamID из **{steamid}**.", ephemeral=True)
    steamid = resolved

    async with aiohttp.ClientSession() as session:
        active = await _get_active_by_steamid(session, steamid, 2)

    if not active:
        return await interaction.followup.send(f"📭 Нет активных мутов для **{steamid}**.", ephemeral=True)

    if len(active) == 1:
        pid = active[0].get("id")
        async with aiohttp.ClientSession() as session:
            ok = await _fear_delete_punishment(session, pid)
        _log(f"🔊 [UNMUTE] {interaction.user} ({interaction.user.id}) -> размут #{pid} для {steamid}. Результат: {'OK' if ok else 'FAIL'}", discord=False)
        if ok:
            return await interaction.followup.send(f"✅ Мут **#{pid}** для **{steamid}** снят.")
        else:
            return await interaction.followup.send(f"❌ Не удалось снять мут **#{pid}**.", ephemeral=True)

    view = PunishmentSelector(active, interaction.user.id, 2)
    await interaction.followup.send(
        content=f"🔍 Найдено **{len(active)}** активных мутов для **{steamid}**. Выбери какой снять:",
        embed=view._build_embed(),
        view=view,
        ephemeral=True
    )


def _parse_months(text: str) -> int:
    """Парсит длительность для /ban16: 8m=8мес, 0=навсегда (duration=0)."""
    text = text.strip().lower()
    if text == "0":
        return 0
    if text.endswith("m"):
        months = int(text[:-1])
        return months * 30 * 86400
    if text.endswith("d"):
        return int(text[:-1]) * 86400
    if text.endswith("h"):
        return int(text[:-1]) * 3600
    return 0


@tree.command(name="ban16", description="Забанить за 1.6 (несколько SteamID через пробел)")
@app_commands.describe(steamid="SteamID64 через пробел, ссылки", duration="Срок: 8m=8мес, 4m, 2m, 0=навсегда")
@app_commands.default_permissions()
async def cmd_ban16(interaction: discord.Interaction, steamid: str, duration: str):
    if not _has_punishment_access(interaction.user):
        return await interaction.response.send_message("❌ Нет доступа к этой команде.", ephemeral=True)

    await interaction.response.defer(ephemeral=False)
    steamids = await _resolve_steamids(steamid)
    if not steamids:
        return await interaction.followup.send(f"❌ Не удалось распознать ни одного SteamID из **{steamid}**.", ephemeral=True)

    duration_sec = _parse_months(duration)
    time_str = "навсегда" if duration.strip() == "0" else f"на {_format_duration(duration_sec)}"

    ok_list = []
    fail_list = []
    async with aiohttp.ClientSession() as session:
        for sid in steamids:
            ok = await _fear_autoban(session, sid, "1.6", duration_sec)
            if ok:
                ok_list.append(sid)
            else:
                fail_list.append(sid)

    lines = []
    if ok_list:
        lines.append(f"✅ Забанены {time_str} (**{len(ok_list)}**):\n" + "\n".join(f"• `{s}`" for s in ok_list))
    if fail_list:
        lines.append(f"❌ Не удалось (**{len(fail_list)}**):\n" + "\n".join(f"• `{s}`" for s in fail_list))
    await interaction.followup.send("\n\n".join(lines) + "\nПричина: **1.6**")


@tree.command(name="muteso", description="Замутить навсегда (Войс + Чат) с причиной ЧСО")
@app_commands.describe(steamid="SteamID64 через пробел, ссылки")
@app_commands.default_permissions()
async def cmd_muteso(interaction: discord.Interaction, steamid: str):
    if not _has_punishment_access(interaction.user):
        return await interaction.response.send_message("❌ Нет доступа к этой команде.", ephemeral=True)

    await interaction.response.defer(ephemeral=False)
    steamids = await _resolve_steamids(steamid)
    if not steamids:
        return await interaction.followup.send(f"❌ Не удалось распознать ни одного SteamID из **{steamid}**.", ephemeral=True)

    ok_list = []
    partial_list = []
    fail_list = []

    async with aiohttp.ClientSession() as session:
        for sid in steamids:
            ok_v = await _fear_mute(session, sid, "ЧСО", 0, punish_type=1)
            ok_c = await _fear_mute(session, sid, "ЧСО", 0, punish_type=2)
            if ok_v and ok_c:
                ok_list.append(sid)
            elif ok_v or ok_c:
                partial_list.append(sid)
            else:
                fail_list.append(sid)

    lines = []
    if ok_list:
        lines.append(f"✅ Замьючены навсегда (Войс + Чат) (**{len(ok_list)}**):\n" + "\n".join(f"• `{s}`" for s in ok_list))
    if partial_list:
        lines.append(f"⚠️ Замьючены частично (**{len(partial_list)}**):\n" + "\n".join(f"• `{s}`" for s in partial_list))
    if fail_list:
        lines.append(f"❌ Не удалось (**{len(fail_list)}**):\n" + "\n".join(f"• `{s}`" for s in fail_list))
    await interaction.followup.send("\n\n".join(lines) + "\nПричина: **ЧСО**")


class MyPunishmentsView(discord.ui.View):
    """Просмотр своих наказаний с пагинацией и выбором типа."""
    def __init__(self, owner_id: int, initial_type: int = 1):
        super().__init__(timeout=180)
        self.owner_id = owner_id
        self.punish_type = initial_type
        self.punishments: list = []
        self.page = 0
        self.per_page = 5

        options = [
            discord.SelectOption(label="🔴 Баны", value="1", default=(initial_type == 1)),
            discord.SelectOption(label="🟡 Муты", value="2", default=(initial_type == 2)),
        ]
        select = discord.ui.Select(placeholder="Тип наказания...", options=options, row=0)
        select.callback = self.select_callback
        self.add_item(select)

    async def select_callback(self, interaction: discord.Interaction):
        if interaction.user.id != self.owner_id:
            return await interaction.response.send_message("❌ Только для владельца.", ephemeral=True)
        self.punish_type = int(interaction.data["values"][0])
        self.page = 0
        async with aiohttp.ClientSession() as session:
            self.punishments = await _fear_get_my_punishments(session, self.punish_type)
        await interaction.response.edit_message(embed=self._build_embed(), view=self)

    async def load(self):
        async with aiohttp.ClientSession() as session:
            self.punishments = await _fear_get_my_punishments(session, self.punish_type)

    def _build_embed(self) -> discord.Embed:
        type_name = "баны" if self.punish_type == 1 else "муты"
        color = 0xe74c3c if self.punish_type == 1 else 0xf39c12

        if not self.punishments:
            embed = discord.Embed(title=f"📋 Мои {type_name}", description="📭 Нет наказаний.", color=color)
            return embed

        total_pages = max(1, (len(self.punishments) + self.per_page - 1) // self.per_page)
        start = self.page * self.per_page
        end = start + self.per_page
        page_items = self.punishments[start:end]

        embed = discord.Embed(
            title=f"📋 Мои {type_name} ({len(self.punishments)})",
            color=color,
            timestamp=datetime.now(timezone.utc)
        )

        for p in page_items:
            pid = p.get("id", "?")
            steamid = p.get("steamid", "?")
            name = p.get("name", "—")
            reason = p.get("reason", "—")
            status = "🔴" if p.get("status") == 1 else "✅"

            created_ts = p.get("created", 0)
            created_str = _msk_from_timestamp(created_ts) if created_ts else "—"

            duration_sec = p.get("duration", 0)
            dur_str = _format_duration(duration_sec) if duration_sec else "—"

            extra = ""
            if self.punish_type == 2:
                mute_t = p.get("type", 0)
                extra = " | 🔊 Войс" if mute_t == 1 else " | 💬 Чат"

            embed.add_field(
                name=f"{status} #{pid} — {name}",
                value=f"`{steamid}` | {reason}\n📅 {created_str} | ⏳ {dur_str}{extra}",
                inline=False
            )

        embed.set_footer(text=f"Страница {self.page + 1}/{total_pages} • Всего: {len(self.punishments)}")
        return embed

    @discord.ui.button(label="◀️", style=discord.ButtonStyle.secondary, row=1)
    async def prev_page(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user.id != self.owner_id:
            return await interaction.response.send_message("❌ Только для владельца.", ephemeral=True)
        total_pages = max(1, (len(self.punishments) + self.per_page - 1) // self.per_page)
        self.page = (self.page - 1) % total_pages
        await interaction.response.edit_message(embed=self._build_embed(), view=self)

    @discord.ui.button(label="▶️", style=discord.ButtonStyle.secondary, row=1)
    async def next_page(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user.id != self.owner_id:
            return await interaction.response.send_message("❌ Только для владельца.", ephemeral=True)
        total_pages = max(1, (len(self.punishments) + self.per_page - 1) // self.per_page)
        self.page = (self.page + 1) % total_pages
        await interaction.response.edit_message(embed=self._build_embed(), view=self)

    async def on_timeout(self):
        for item in self.children:
            item.disabled = True


@tree.command(name="my_punishments", description="Мои выданные баны и муты")
@app_commands.describe(type="Тип: 1=баны, 2=муты")
@app_commands.default_permissions()
async def cmd_my_punishments(interaction: discord.Interaction, type: int = 1):
    if not _has_punishment_access(interaction.user):
        return await interaction.response.send_message("❌ Нет доступа к этой команде.", ephemeral=True)

    await interaction.response.defer(ephemeral=True)

    view = MyPunishmentsView(interaction.user.id, type)
    await view.load()

    if not view.punishments:
        type_name = "баны" if type == 1 else "муты"
        return await interaction.followup.send(f"📭 Нет {type_name}.", ephemeral=True)

    await interaction.followup.send(embed=view._build_embed(), view=view, ephemeral=True)


# ── API helpers для управления админами, промокодами, наказаниями ─────────────

def _fear_api_headers() -> dict:
    return {
        "Cookie": FEAR_COOKIE,
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://fearproject.ru",
        "Referer": "https://fearproject.ru/",
    }


async def _fear_api_get(session: aiohttp.ClientSession, path: str, params: dict = None) -> dict | list | None:
    url = f"{API_BASE}{path}"
    try:
        timeout = aiohttp.ClientTimeout(total=15)
        async with session.get(url, params=params, headers=_fear_api_headers(), timeout=timeout) as r:
            if r.status == 200:
                return await r.json(content_type=None)
            body = await r.text()
            _log(f"⚠️ [FEAR API GET] {path} -> HTTP {r.status}: {body[:200]}", discord=False)
            return None
    except Exception as e:
        _log(f"❌ [FEAR API GET] {path}: {e}", discord=False)
        return None


async def _fear_api_post(session: aiohttp.ClientSession, path: str, payload: dict = None) -> dict | None:
    url = f"{API_BASE}{path}"
    try:
        timeout = aiohttp.ClientTimeout(total=15)
        async with session.post(url, json=payload, headers=_fear_api_headers(), timeout=timeout) as r:
            body = await r.text()
            if r.status in (200, 201):
                try:
                    return await r.json(content_type=None)
                except Exception:
                    return {"ok": True, "raw": body[:500]}
            _log(f"⚠️ [FEAR API POST] {path} -> HTTP {r.status}: {body[:200]}", discord=False)
            return None
    except Exception as e:
        _log(f"❌ [FEAR API POST] {path}: {e}", discord=False)
        return None


async def _fear_api_put(session: aiohttp.ClientSession, path: str, payload: dict = None) -> dict | None:
    url = f"{API_BASE}{path}"
    try:
        timeout = aiohttp.ClientTimeout(total=15)
        async with session.put(url, json=payload, headers=_fear_api_headers(), timeout=timeout) as r:
            body = await r.text()
            if r.status in (200, 201, 204):
                try:
                    return await r.json(content_type=None)
                except Exception:
                    return {"ok": True, "raw": body[:500]}
            _log(f"⚠️ [FEAR API PUT] {path} -> HTTP {r.status}: {body[:200]}", discord=False)
            return None
    except Exception as e:
        _log(f"❌ [FEAR API PUT] {path}: {e}", discord=False)
        return None


async def _fear_api_delete(session: aiohttp.ClientSession, path: str) -> bool:
    url = f"{API_BASE}{path}"
    try:
        timeout = aiohttp.ClientTimeout(total=15)
        async with session.delete(url, headers=_fear_api_headers(), timeout=timeout) as r:
            if r.status in (200, 204):
                return True
            body = await r.text()
            _log(f"⚠️ [FEAR API DELETE] {path} -> HTTP {r.status}: {body[:200]}", discord=False)
            return False
    except Exception as e:
        _log(f"❌ [FEAR API DELETE] {path}: {e}", discord=False)
        return False


# ── /addadmin ────────────────────────────────────────────────────────────────

_ADMIN_GROUP_CHOICES = [
    app_commands.Choice(name="ADMIN (4)", value="ADMIN"),
    app_commands.Choice(name="ADMIN+ (9)", value="ADMIN+"),
    app_commands.Choice(name="MODER (1)", value="MODER"),
    app_commands.Choice(name="STMODER (5)", value="STMODER"),
    app_commands.Choice(name="MLMODER (6)", value="MLMODER"),
    app_commands.Choice(name="STAFF (3)", value="STAFF"),
    app_commands.Choice(name="STADMIN (7)", value="STADMIN"),
    app_commands.Choice(name="GLADMIN (8)", value="GLADMIN"),
    app_commands.Choice(name="MEDIA (10)", value="MEDIA"),
]

_ADMIN_GROUP_NAME_TO_ID = {
    "MODER": 1,
    "STAFF": 3,
    "ADMIN": 4,
    "STMODER": 5,
    "MLMODER": 6,
    "STADMIN": 7,
    "GLADMIN": 8,
    "ADMIN+": 9,
    "MEDIA": 10,
}


@tree.command(name="addadmin", description="Добавить админа на Fear Project")
@app_commands.describe(name="Игровое имя", steamid="SteamID64", group="Группа")
@app_commands.choices(group=_ADMIN_GROUP_CHOICES)
@app_commands.default_permissions()
async def cmd_addadmin(interaction: discord.Interaction, name: str, steamid: str, group: str):
    if not _has_owner_access(interaction.user):
        return await interaction.response.send_message("❌ Только для владельца / главного админа / куратора.", ephemeral=True)

    await interaction.response.defer(ephemeral=True)
    resolved = await _resolve_steamid(steamid)
    if not resolved:
        return await interaction.followup.send(f"❌ Не удалось распознать SteamID из **{steamid}**.", ephemeral=True)

    group_id = _ADMIN_GROUP_NAME_TO_ID.get(group, 0)
    if not group_id:
        return await interaction.followup.send(f"❌ Неизвестная группа: **{group}**.", ephemeral=True)

    async with aiohttp.ClientSession() as session:
        result = await _fear_api_post(session, "/admins/add", {
            "name": name,
            "steamid": resolved,
            "groupId": group_id,
        })

    if result:
        _log(f"👑 [ADDADMIN] {interaction.user} добавил админа **{name}** (`{resolved}`) в группу **{group}**", discord=False)
        await interaction.followup.send(
            f"✅ Админ **{name}** (`{resolved}`) добавлен в группу **{group}** (ID: {group_id}).",
            ephemeral=True
        )
    else:
        await interaction.followup.send(f"❌ Не удалось добавить админа. Проверь FEAR_COOKIE.", ephemeral=True)


# ── /promocode ───────────────────────────────────────────────────────────────

@tree.command(name="promocode", description="Создать промокод на Fear Project")
@app_commands.describe(code="Код промокода", reward_per_use="Награда за использование", max_uses="Макс. количество активаций")
@app_commands.default_permissions()
async def cmd_promocode(interaction: discord.Interaction, code: str, reward_per_use: int, max_uses: int):
    if not _has_owner_access(interaction.user):
        return await interaction.response.send_message("❌ Только для владельца / главного админа / куратора.", ephemeral=True)

    await interaction.response.defer(ephemeral=True)

    async with aiohttp.ClientSession() as session:
        result = await _fear_api_post(session, "/promocodes/create", {
            "code": code,
            "rewardPerUse": reward_per_use,
            "maxUses": max_uses,
        })

    if result:
        _log(f"🎟️ [PROMOCODE] {interaction.user} создал промокод **{code}** (награда: {reward_per_use}, макс: {max_uses})", discord=False)
        await interaction.followup.send(
            f"✅ Промокод **{code}** создан!\n"
            f"🎁 Награда за использование: **{reward_per_use}**\n"
            f"🔢 Макс. активаций: **{max_uses}**",
            ephemeral=True
        )
    else:
        await interaction.followup.send(f"❌ Не удалось создать промокод. Проверь FEAR_COOKIE.", ephemeral=True)


# ── /edit_punishment ─────────────────────────────────────────────────────────

@tree.command(name="edit_punishment", description="Изменить наказание на Fear Project")
@app_commands.describe(
    punishment_id="ID наказания",
    reason="Новая причина (оставь пустым если не менять)",
    duration="Новый срок: 24h, 7d, 30m, 60s (оставь пустым если не менять)",
)
@app_commands.default_permissions()
async def cmd_edit_punishment(interaction: discord.Interaction, punishment_id: int, reason: str = "", duration: str = ""):
    if not _has_owner_access(interaction.user):
        return await interaction.response.send_message("❌ Только для владельца / главного админа / куратора.", ephemeral=True)

    await interaction.response.defer(ephemeral=True)

    async with aiohttp.ClientSession() as session:
        existing = await _fetch_punishment_by_id_global(session, punishment_id)

    if not existing:
        return await interaction.followup.send(f"❌ Наказание **#{punishment_id}** не найдено.", ephemeral=True)

    payload = {
        "name": existing.get("name", ""),
        "steamid": existing.get("steamid", ""),
        "reason": reason.strip() if reason.strip() else existing.get("reason", ""),
        "duration": _parse_duration(duration) if duration.strip() else existing.get("duration", 0),
        "punish_type": existing.get("type", existing.get("punish_type", 0)),
    }

    changes = []
    if reason.strip() and reason.strip() != existing.get("reason", ""):
        changes.append(f"причина → **{payload['reason']}**")
    if duration.strip():
        changes.append(f"срок → **{_format_duration(payload['duration'])}**")

    if not changes:
        return await interaction.followup.send("❌ Укажи причину или срок для изменения.", ephemeral=True)

    async with aiohttp.ClientSession() as session:
        result = await _fear_api_put(session, f"/admin/punishments/update/{punishment_id}", payload)

    if result is not None:
        _log(f"✏️ [EDIT_PUNISHMENT] {interaction.user} изменил наказание #{punishment_id}: {', '.join(changes)}", discord=False)
        await interaction.followup.send(
            f"✅ Наказание **#{punishment_id}** изменено:\n" + "\n".join(changes),
            ephemeral=True
        )
    else:
        await interaction.followup.send(f"❌ Не удалось изменить наказание **#{punishment_id}**. Проверь ID.", ephemeral=True)


# ── /delete_punishment ───────────────────────────────────────────────────────

@tree.command(name="delete_punishment", description="Удалить наказание на Fear Project по ID")
@app_commands.describe(punishment_id="ID наказания")
@app_commands.default_permissions()
async def cmd_delete_punishment(interaction: discord.Interaction, punishment_id: int):
    if not _has_owner_access(interaction.user):
        return await interaction.response.send_message("❌ Только для владельца / главного админа / куратора.", ephemeral=True)

    await interaction.response.defer(ephemeral=True)

    async with aiohttp.ClientSession() as session:
        ok = await _fear_api_delete(session, f"/admin/punishments/{punishment_id}")

    if ok:
        _log(f"🗑️ [DELETE_PUNISHMENT] {interaction.user} удалил наказание #{punishment_id}", discord=False)
        await interaction.followup.send(f"✅ Наказание **#{punishment_id}** удалено.", ephemeral=True)
    else:
        await interaction.followup.send(f"❌ Не удалось удалить наказание **#{punishment_id}**. Проверь ID.", ephemeral=True)


# ── /list_admins ─────────────────────────────────────────────────────────────

@tree.command(name="list_admins", description="Список всех админов на Fear Project")
@app_commands.default_permissions()
async def cmd_list_admins(interaction: discord.Interaction):
    if not _has_owner_access(interaction.user):
        return await interaction.response.send_message("❌ Только для владельца / главного админа / куратора.", ephemeral=True)

    await interaction.response.defer(ephemeral=True)

    async with aiohttp.ClientSession() as session:
        data = await _fear_api_get(session, "/admins/")

    if not data:
        return await interaction.followup.send("❌ Не удалось получить список админов. Проверь FEAR_COOKIE.", ephemeral=True)

    admins = data if isinstance(data, list) else data.get("admins", data.get("data", []))
    if not admins:
        return await interaction.followup.send("📭 Список админов пуст.", ephemeral=True)

    embed = discord.Embed(
        title=f"👑 Админы Fear Project ({len(admins)})",
        color=0xe74c3c,
        timestamp=datetime.now(timezone.utc)
    )

    lines = []
    for a in admins[:30]:
        aid = a.get("id", "?")
        name = a.get("name", "?")
        steamid = a.get("steamid", "?")
        group = a.get("group_name") or a.get("group", {}).get("name", "?")
        frozen = "🔒" if a.get("is_frozen") else ""
        lines.append(f"**#{aid}** {name} (`{steamid}`) — {group} {frozen}")

    embed.description = "\n".join(lines)
    if len(admins) > 30:
        embed.set_footer(text=f"Показано 30 из {len(admins)}")

    await interaction.followup.send(embed=embed, ephemeral=True)


# ── /edit_admin ──────────────────────────────────────────────────────────────

@tree.command(name="edit_admin", description="Редактировать админа на Fear Project")
@app_commands.describe(admin_id="ID админа (из /list_admins)", name="Новое имя", steamid="Новый SteamID64", group="Новая группа")
@app_commands.choices(group=_ADMIN_GROUP_CHOICES)
@app_commands.default_permissions()
async def cmd_edit_admin(interaction: discord.Interaction, admin_id: int, name: str = "", steamid: str = "", group: str = ""):
    if not _has_owner_access(interaction.user):
        return await interaction.response.send_message("❌ Только для владельца / главного админа / куратора.", ephemeral=True)

    await interaction.response.defer(ephemeral=True)

    payload = {"id": admin_id}
    if name.strip():
        payload["name"] = name.strip()
    if steamid.strip():
        resolved = await _resolve_steamid(steamid)
        if not resolved:
            return await interaction.followup.send(f"❌ Не удалось распознать SteamID из **{steamid}**.", ephemeral=True)
        payload["steamid"] = resolved
    if group.strip():
        group_id = _ADMIN_GROUP_NAME_TO_ID.get(group, 0)
        if not group_id:
            return await interaction.followup.send(f"❌ Неизвестная группа: **{group}**.", ephemeral=True)
        payload["groupId"] = group_id

    if len(payload) == 1:
        return await interaction.followup.send("❌ Укажи хотя бы одно поле для изменения.", ephemeral=True)

    async with aiohttp.ClientSession() as session:
        result = await _fear_api_post(session, "/admins/edit", payload)

    if result is not None:
        changes = []
        if "name" in payload:
            changes.append(f"имя → **{payload['name']}**")
        if "steamid" in payload:
            changes.append(f"steamid → `{payload['steamid']}`")
        if "groupId" in payload:
            changes.append(f"группа → **{group}** (ID: {group_id})")
        _log(f"✏️ [EDIT_ADMIN] {interaction.user} изменил админа #{admin_id}: {', '.join(changes)}", discord=False)
        await interaction.followup.send(
            f"✅ Админ **#{admin_id}** изменён:\n" + "\n".join(changes),
            ephemeral=True
        )
    else:
        await interaction.followup.send(f"❌ Не удалось изменить админа **#{admin_id}**. Проверь ID.", ephemeral=True)


# ── /delete_admin ────────────────────────────────────────────────────────────

@tree.command(name="delete_admin", description="Удалить админа с Fear Project")
@app_commands.describe(admin_id="ID админа (из /list_admins)")
@app_commands.default_permissions()
async def cmd_delete_admin(interaction: discord.Interaction, admin_id: int):
    if not _has_owner_access(interaction.user):
        return await interaction.response.send_message("❌ Только для владельца / главного админа / куратора.", ephemeral=True)

    await interaction.response.defer(ephemeral=True)

    async with aiohttp.ClientSession() as session:
        result = await _fear_api_post(session, "/admins/delete", {"id": admin_id})

    if result is not None:
        _log(f"🗑️ [DELETE_ADMIN] {interaction.user} удалил админа #{admin_id}", discord=False)
        await interaction.followup.send(f"✅ Админ **#{admin_id}** удалён.", ephemeral=True)
    else:
        await interaction.followup.send(f"❌ Не удалось удалить админа **#{admin_id}**. Проверь ID.", ephemeral=True)


# ── /freeze_admin ────────────────────────────────────────────────────────────

@tree.command(name="freeze_admin", description="Заморозить права админа на Fear Project")
@app_commands.describe(admin_id="ID админа (из /list_admins)")
@app_commands.default_permissions()
async def cmd_freeze_admin(interaction: discord.Interaction, admin_id: int):
    if not _has_owner_access(interaction.user):
        return await interaction.response.send_message("❌ Только для владельца / главного админа / куратора.", ephemeral=True)

    await interaction.response.defer(ephemeral=True)

    async with aiohttp.ClientSession() as session:
        result = await _fear_api_post(session, "/admins/freeze", {"id": admin_id})

    if result is not None:
        _log(f"🔒 [FREEZE_ADMIN] {interaction.user} заморозил админа #{admin_id}", discord=False)
        await interaction.followup.send(f"✅ Админ **#{admin_id}** заморожен.", ephemeral=True)
    else:
        await interaction.followup.send(f"❌ Не удалось заморозить админа **#{admin_id}**. Проверь ID.", ephemeral=True)


# ── /unfreeze_admin ──────────────────────────────────────────────────────────

@tree.command(name="unfreeze_admin", description="Разморозить права админа на Fear Project")
@app_commands.describe(admin_id="ID админа (из /list_admins)")
@app_commands.default_permissions()
async def cmd_unfreeze_admin(interaction: discord.Interaction, admin_id: int):
    if not _has_owner_access(interaction.user):
        return await interaction.response.send_message("❌ Только для владельца / главного админа / куратора.", ephemeral=True)

    await interaction.response.defer(ephemeral=True)

    async with aiohttp.ClientSession() as session:
        result = await _fear_api_post(session, "/admins/unfreeze", {"id": admin_id})

    if result is not None:
        _log(f"🔓 [UNFREEZE_ADMIN] {interaction.user} разморозил админа #{admin_id}", discord=False)
        await interaction.followup.send(f"✅ Админ **#{admin_id}** разморожен.", ephemeral=True)
    else:
        await interaction.followup.send(f"❌ Не удалось разморозить админа **#{admin_id}**. Проверь ID.", ephemeral=True)


def _build_stats_embed(steamid: str, date_from: datetime | None = None, date_to: datetime | None = None) -> discord.Embed | None:
    data = _load_cache(steamid)
    if not data:
        return None
    s     = _calc_stats(data, date_from, date_to)
    bans  = data.get("bans", [])
    mutes = data.get("mutes", [])
    period = _period_label(date_from, date_to)

    updated = ""
    if s["updated_at"]:
        try:
            dt = datetime.fromisoformat(s["updated_at"].replace("Z", "+00:00"))
            updated = _msk_str(dt)
        except Exception:
            updated = s["updated_at"]

    embed = discord.Embed(
        title=f"📋 Статистика: {s['admin_name']}  —  {period}",
        color=0x5865f2,
        timestamp=datetime.now(timezone.utc)
    )
    embed.add_field(name="🔨 Баны",    value=f"**{s['bans']}**",         inline=True)
    embed.add_field(name="🔇 Муты",    value=f"**{s['mutes']}**",        inline=True)
    embed.add_field(name="📊 Всего", value=f"**{s['total']}**",        inline=True)
    embed.add_field(name="✂️ Снято", value=f"**{s['removed']}**",     inline=True)
    embed.add_field(name="\u200b",            value="\u200b",                   inline=True)
    embed.add_field(name="\u200b",            value="\u200b",                   inline=True)
    # Разбивка банов по длительности (только активные)
    if s["active_bans"]:
        embed.add_field(
            name="🔨 Разбивка банов",
            value=(
                f"♾️ Перм: **{s['ban_perm']}**\n"
                f"📅 Неделя+: **{s['ban_week']}**\n"
                f"🕐 День+: **{s['ban_day']}**\n"
                f"⚡ Короткие: **{s['ban_short']}**"
            ),
            inline=True
        )

    def _is_ticket_reason(item):
        reason = str(item.get("reason", "")).strip().lower()
        return reason in ("тикет", "тикет в дс", "напиши тикет в дс") or "тикет" in reason

    def in_period(item):
        if date_from is None and date_to is None:
            return True
        ts = item.get("created", 0)
        dt2 = datetime.fromtimestamp(ts, tz=timezone.utc)
        msk = timezone(timedelta(hours=3))
        dt_msk = dt2.astimezone(msk)
        if date_from and dt_msk < date_from: return False
        if date_to   and dt_msk > date_to:   return False
        return True

    recent_bans = sorted(
        [b for b in bans if b.get("status") != 2 and in_period(b) and not _is_ticket_reason(b)],
        key=lambda x: x.get("created", 0), reverse=True)[:5]
    if recent_bans:
        lines = []
        for b in recent_bans:
            dt2 = datetime.fromtimestamp(b["created"]).strftime("%d.%m %H:%M")
            dur = b.get("duration", 0)
            dur_str = _dur_str(dur)
            lines.append(f"`{dt2}` **{b.get('name','?')}** — {b.get('reason','?')} ({dur_str})")
        embed.add_field(name="Последние баны", value="\n".join(lines), inline=False)

    recent_mutes = sorted(
        [m for m in mutes if m.get("status") != 2 and in_period(m) and not _is_ticket_reason(m)],
        key=lambda x: x.get("created", 0), reverse=True)[:5]
    if recent_mutes:
        lines = []
        for m in recent_mutes:
            dt2 = datetime.fromtimestamp(m["created"]).strftime("%d.%m %H:%M")
            dur = m.get("duration", 0)
            dur_str = _dur_str(dur)
            lines.append(f"`{dt2}` **{m.get('name','?')}** — {m.get('reason','?')} ({dur_str})")
        embed.add_field(name="Последние муты", value="\n".join(lines), inline=False)

    embed.add_field(
        name="Ссылки",
        value=f"[Steam](https://steamcommunity.com/profiles/{steamid})  •  [Fear](https://fearproject.ru/profile/{steamid})",
        inline=False
    )
    embed.set_footer(text=f"SteamID: {steamid}  •  Кэш от: {updated}")
    return embed


class StatsView(discord.ui.View):
    def __init__(self, steamid: str, mode: str = "month", year: int = None,
                 month: int = None, week_idx: int = None,
                 date_from: datetime = None, date_to: datetime = None):
        super().__init__(timeout=600)
        now = datetime.now(tz=timezone.utc)
        self.steamid   = steamid
        self.mode      = mode
        self.year      = year  or now.year
        self.month     = month or now.month
        self.week_idx  = week_idx
        self.date_from = date_from
        self.date_to   = date_to
        self._build_buttons()

    def _build_buttons(self):
        self.clear_items()
        self.add_item(discord.ui.Button(label="◀", style=discord.ButtonStyle.secondary,
                                        custom_id="s_prev_month", row=0))
        self.add_item(discord.ui.Button(
            label=f"{MONTH_RU[self.month]} {self.year}",
            style=discord.ButtonStyle.primary, custom_id="s_cur_label", row=0, disabled=True))
        self.add_item(discord.ui.Button(label="▶", style=discord.ButtonStyle.secondary,
                                        custom_id="s_next_month", row=0))
        self.add_item(discord.ui.Button(label="Весь месяц",
                                        style=discord.ButtonStyle.success if self.mode == "month" else discord.ButtonStyle.secondary,
                                        custom_id="s_whole_month", row=0))
        self.add_item(discord.ui.Button(label="Всё время",
                                        style=discord.ButtonStyle.success if self.mode == "all" else discord.ButtonStyle.secondary,
                                        custom_id="s_all_time", row=0))
        weeks = _month_weeks(self.year, self.month)
        for i, (wstart, wend) in enumerate(weeks):
            label = f"{wstart.day:02d}.{wstart.month:02d}–{wend.day:02d}.{wend.month:02d}"
            active = (self.mode == "week" and self.week_idx == i)
            self.add_item(discord.ui.Button(
                label=label,
                style=discord.ButtonStyle.success if active else discord.ButtonStyle.secondary,
                custom_id=f"s_week_{i}", row=1 if i < 3 else 2))
        self.add_item(discord.ui.Button(label="🔄 Обновить",
                                        style=discord.ButtonStyle.secondary,
                                        custom_id="s_refresh", row=3))
        self.add_item(discord.ui.Button(label="📅 Свой период",
                                        style=discord.ButtonStyle.secondary,
                                        custom_id="s_custom", row=3))

    def _get_period(self):
        import calendar
        msk = timezone(timedelta(hours=3))
        if self.mode == "all":
            return None, None
        if self.mode == "month":
            _, days = calendar.monthrange(self.year, self.month)
            return (datetime(self.year, self.month, 1, tzinfo=msk),
                    datetime(self.year, self.month, days, 23, 59, 59, tzinfo=msk))
        if self.mode == "week":
            weeks = _month_weeks(self.year, self.month)
            if self.week_idx is not None and self.week_idx < len(weeks):
                return weeks[self.week_idx]
        if self.mode == "custom":
            return self.date_from, self.date_to
        return None, None

    async def _update(self, interaction: discord.Interaction):
        self._build_buttons()
        df, dt = self._get_period()
        embed = _build_stats_embed(self.steamid, df, dt)
        if embed:
            if not interaction.response.is_done():
                await interaction.response.edit_message(embed=embed, view=self)
            else:
                await interaction.edit_original_response(embed=embed, view=self)
        else:
            await interaction.response.send_message("Нет данных.", ephemeral=True)

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        cid = interaction.data.get("custom_id", "")
        if cid == "s_prev_month":
            await interaction.response.defer()
            if self.month == 1: self.month, self.year = 12, self.year - 1
            else: self.month -= 1
            if self.mode == "week": self.week_idx = 0
            await self._update(interaction)
        elif cid == "s_next_month":
            await interaction.response.defer()
            now = datetime.now(tz=timezone.utc)
            if not (self.year == now.year and self.month == now.month):
                if self.month == 12: self.month, self.year = 1, self.year + 1
                else: self.month += 1
                if self.mode == "week": self.week_idx = 0
            await self._update(interaction)
        elif cid == "s_whole_month":
            await interaction.response.defer()
            self.mode = "month"; await self._update(interaction)
        elif cid == "s_all_time":
            await interaction.response.defer()
            self.mode = "all"; await self._update(interaction)
        elif cid.startswith("s_week_"):
            await interaction.response.defer()
            self.mode = "week"; self.week_idx = int(cid.split("_")[2])
            await self._update(interaction)
        elif cid == "s_refresh":
            await interaction.response.defer()
            await self._update(interaction)
        elif cid == "s_custom":
            await interaction.response.send_modal(StatsCustomPeriodModal(self))
        return False


class StatsCustomPeriodModal(discord.ui.Modal, title="Свой период"):
    date_from_input = discord.ui.TextInput(label="Дата начала (дд.мм.гггг)", placeholder="01.04.2026", max_length=10)
    date_to_input   = discord.ui.TextInput(label="Дата конца (дд.мм.гггг)",  placeholder="30.04.2026", max_length=10)

    def __init__(self, view: "StatsView"):
        super().__init__()
        self.stats_view = view

    async def on_submit(self, interaction: discord.Interaction):
        try:
            df = datetime.strptime(self.date_from_input.value.strip(), "%d.%m.%Y").replace(tzinfo=timezone.utc)
            dt = datetime.strptime(self.date_to_input.value.strip(), "%d.%m.%Y").replace(
                hour=23, minute=59, second=59, tzinfo=timezone.utc)
            self.stats_view.mode = "custom"
            self.stats_view.date_from = df
            self.stats_view.date_to   = dt
            await self.stats_view._update(interaction)
        except ValueError:
            await interaction.response.send_message("Неверный формат. Используй дд.мм.гггг", ephemeral=True)


@tree.command(name="stats", description="Статистика наказаний конкретного стаффа по SteamID")
@app_commands.describe(steamid="SteamID игрока")
async def cmd_stats(interaction: discord.Interaction, steamid: str):
    # Ограничение доступа для Админ и Админ+
    restricted_roles = {ROLE_ADMIN_ID, ROLE_ADMIN_PLUS_ID}
    if hasattr(interaction.user, "roles") and any(r.id in restricted_roles for r in interaction.user.roles):
        return await interaction.response.send_message("❌ У вас недостаточно прав для использования этой команды.", ephemeral=True)

    await interaction.response.defer(ephemeral=True)

    # Проверяем: если цель — стафф (MODER+), то смотреть может только сам себя или роль с доступом
    target_steamid = steamid.strip()
    db = _load_staff_db()
    target_entry = db.get(target_steamid)
    
    # Считаем целью "стафф", если он в базе и его группа - одна из рабочих (не NONE/огр.)
    working_groups = {"STAFF", "STMODER", "MODER", "MLMODER"}
    is_target_working_staff = target_entry and target_entry.get("group_name") in working_groups

    if is_target_working_staff:
        # Проверяем, есть ли у вызывающего FULL ACCESS роли
        caller_can_view_all = _can_view_any_stats(interaction.user)
        
        # Проверяем, не смотрит ли он сам себя
        caller_entry = _get_staff_by_discord(str(interaction.user.id))
        is_self = caller_entry and caller_entry["steamid"] == target_steamid
        
        # Если цель - рабочий стафф, и это не он сам, и у него нет прав просмотра всех - блокируем
        if not is_self and not caller_can_view_all:
            return await interaction.followup.send(
                "❌ У вас нет прав для просмотра статистики других членов стаффа.",
                ephemeral=True
            )

    try:
        await interaction.followup.send(
            f"⏳ Обновляю данные для `{steamid}`...", ephemeral=True
        )
        # Ищем в staff_list чтобы получить имя
        staff_list = _load_staff_list()
        entry = next((e for e in staff_list if e.get("steamid") == steamid), {"steamid": steamid, "name": steamid})

        async with aiohttp.ClientSession() as session:
            ok = await _update_cache_for_staff(session, entry)

        if not ok:
            # Если не получилось — пробуем старый кэш
            data = _load_cache(steamid)
            if not data:
                return await interaction.edit_original_response(
                    content=f"❌ Не удалось получить данные для `{steamid}`. Проверь SteamID."
                )

        now = datetime.now(tz=timezone.utc)
        view = StatsView(steamid, mode="month", year=now.year, month=now.month)
        df, dt = view._get_period()
        embed = _build_stats_embed(steamid, df, dt)
        if not embed:
            return await interaction.edit_original_response(content="❌ Не удалось построить статистику.")
        await interaction.edit_original_response(content=None, embed=embed, view=view)
    except Exception as e:
        _log(f"❌ /stats ошибка: {e}")
        await interaction.edit_original_response(content=f"❌ Ошибка: {e}")

# ── Команда обновления токена ─────────────────────────────────────────────────

# ── Система репортов ──────────────────────────────────────────────────────────

async def _fear_headers() -> dict:
    """Возвращает заголовки для запросов к Fear API с актуальным токеном."""
    return {
        "Cookie": FEAR_COOKIE,
        "Referer": "https://fearproject.ru/",
        "Origin": "https://fearproject.ru",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "sec-fetch-site": "same-site",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
    }


async def _fetch_reports() -> list | None:
    """Получает список последних репортов с fearproject API."""
    if not FEAR_COOKIE:
        return None
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(
                f"{API_BASE}/reports/recent",
                headers=await _fear_headers(),
                timeout=aiohttp.ClientTimeout(total=5)
            ) as r:
                if r.status in (401, 403):
                    return "token_expired"
                if r.status == 200:
                    return await r.json(content_type=None)
                _log(f"⚠️ /reports/recent вернул {r.status}")
                return None
        except Exception as e:
            _log(f"❌ _fetch_reports: {type(e).__name__}: {e}")
            return None


async def _get_player_kd(steamid: str) -> float | None:
    """Получает KD игрока с серверов Fear."""
    async with aiohttp.ClientSession() as session:
        try:
            servers = await _fetch_json(session, f"{API_BASE}/servers")
            if not servers:
                return None
            for srv in servers:
                for player in srv.get("live_data", {}).get("players", []):
                    if str(player.get("steam_id", "")) == str(steamid):
                        kills  = player.get("kills", 0) or 0
                        deaths = player.get("deaths", 1) or 1
                        return round(kills / deaths, 2)
        except Exception as e:
            _log(f"⚠️ _get_player_kd {steamid}: {e}")
    return None


async def _get_player_server(steamid: str) -> dict | None:
    """Находит сервер где сейчас играет игрок."""
    async with aiohttp.ClientSession() as session:
        try:
            servers = await _fetch_json(session, f"{API_BASE}/servers")
            if not servers:
                return None
            for srv in servers:
                for player in srv.get("live_data", {}).get("players", []):
                    if str(player.get("steam_id", "")) == str(steamid):
                        return {"server": srv, "player": player}
        except Exception as e:
            _log(f"⚠️ _get_player_server {steamid}: {e}")
    return None


def _build_report_embed(steamid: str, reports: list, kd: float | None, server_info: dict | None) -> discord.Embed:
    """Строит embed для уведомления о репортах."""
    intruder_name = reports[0].get("intruder", steamid)
    intruder_avatar = reports[0].get("intruder_avatar", "")
    report_count = len(reports)

    # Уникальные отправители
    senders = list({r.get("sender_steamid"): r.get("sender", "?") for r in reports}.values())

    embed = discord.Embed(
        title=f"🚨 {report_count} репортов на игрока",
        color=0xe74c3c,
        timestamp=datetime.now(timezone.utc)
    )
    embed.set_thumbnail(url=intruder_avatar)

    kd_str = f"**{kd}**" if kd is not None else "неизвестно"
    embed.add_field(
        name="👤 Нарушитель",
        value=(
            f"**{intruder_name}**\n"
            f"SteamID: `{steamid}`\n"
            f"KD: {kd_str}\n"
            f"[Fear](https://fearproject.ru/profile/{steamid}) • [Steam](https://steamcommunity.com/profiles/{steamid})"
        ),
        inline=True
    )

    if server_info:
        srv    = server_info["server"]
        player = server_info["player"]
        kills  = player.get("kills", 0)
        deaths = player.get("deaths", 0)
        embed.add_field(
            name="🖥 Сейчас на сервере",
            value=(
                f"**{srv.get('site_name', srv.get('name', '?'))}**\n"
                f"`{srv.get('ip')}:{srv.get('port')}`\n"
                f"K/D: {kills}/{deaths}"
            ),
            inline=True
        )
    else:
        embed.add_field(name="🖥 Сервер", value="Офлайн / не найден", inline=True)

    # Список репортов
    reasons = {}
    for r in reports:
        reason = r.get("reason", "?")
        reasons[reason] = reasons.get(reason, 0) + 1
    reasons_str = "\n".join(f"• {reason} ×{cnt}" for reason, cnt in reasons.items())

    embed.add_field(
        name=f"📋 Репорты ({report_count})",
        value=reasons_str or "—",
        inline=False
    )

    # Последние репорты
    recent = sorted(reports, key=lambda x: x.get("created_at", ""), reverse=True)[:5]
    lines = []
    for r in recent:
        raw_ts = r.get("created_at", "")
        try:
            dt_utc = datetime.fromisoformat(raw_ts.replace("Z", "+00:00"))
            ts = _msk_str(dt_utc, "%Y-%m-%d %H:%M")
        except Exception:
            ts = raw_ts[:16].replace("T", " ")
        lines.append(f"`{ts}` **{r.get('sender', '?')}** — {r.get('reason', '?')} ({r.get('server_name', '?')})")
    embed.add_field(name="🕐 Последние жалобы", value="\n".join(lines), inline=False)

    embed.set_footer(text=f"SteamID: {steamid}")
    return embed


async def _close_reports(report_ids: list[int], result_text: str) -> bool:
    """Закрывает репорты через Fear API методом PATCH."""
    if not FEAR_COOKIE or not report_ids:
        return False
    async with aiohttp.ClientSession() as session:
        try:
            headers = await _fear_headers()
            all_ok = True
            for rid in report_ids:
                payload = {"result": result_text}
                async with session.patch(
                    f"{API_BASE}/reports/{rid}/close",
                    json=payload,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as r:
                    if r.status == 404:
                        _log(f"ℹ️ Тикет #{rid} уже закрыт, пропускаем")
                        continue
                    if r.status in (200, 201, 204):
                        _log(f"✅ Тикет #{rid} закрыт: `{result_text[:50]}`")
                    else:
                        _log(f"⚠️ [AUTO-CLOSE] Ошибка закрытия тикета #{rid}: статус {r.status}")
                        all_ok = False
                    await asyncio.sleep(0.2)
            return all_ok
        except Exception as e:
            _log(f"❌ [AUTO-CLOSE] Критическая ошибка при закрытии тикетов: {e}")
            return False


def _build_autoclose_embed() -> discord.Embed:
    s = _autoclose_settings
    status = "🟢 Включено" if s["enabled"] else "🔴 Выключено"

    def rule_line(enabled, text):
        return f"{'✅' if enabled else '☐'} {text}"

    embed = discord.Embed(
        title="⚙️ Автозакрытие репортов",
        color=0x2ecc71 if s["enabled"] else 0xe74c3c,
        timestamp=datetime.now(timezone.utc)
    )
    embed.add_field(name="Статус", value=status, inline=False)
    kd_thr  = s['kd_threshold']
    age_thr = s['age_min']
    embed.add_field(
        name="📋 Правила",
        value=(
            f"{rule_line(s['rule_offline'], 'Игрок вышел офлайн')}\n"
            f"{rule_line(s.get('skip_banned', False), 'Пропускать забаненных')}\n"
            f"{rule_line(s['rule_kd'],      f'KD < **{kd_thr}** (онлайн)')}\n"
            f"{rule_line(s['rule_age'],     f'Тикет висит ≥ **{age_thr}** мин (онлайн)')}"
        ),
        inline=False
    )
    embed.add_field(name="Текст закрытия", value=f"`{s['result_text']}`", inline=False)
    embed.set_footer(text="Автозакрытие работает каждые 60 сек")
    return embed


class AutoCloseView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=300)

    # Ряд 0: главный переключатель
    @discord.ui.button(label="🟢 Вкл / 🔴 Выкл", style=discord.ButtonStyle.primary, row=0)
    async def toggle(self, interaction: discord.Interaction, button: discord.ui.Button):
        _autoclose_settings["enabled"] = not _autoclose_settings["enabled"]
        _save_autoclose_settings()
        await interaction.response.edit_message(embed=_build_autoclose_embed(), view=self)

    # Ряд 1: переключатели правил
    @discord.ui.button(label="📴 Офлайн", style=discord.ButtonStyle.secondary, row=1)
    async def toggle_offline(self, interaction: discord.Interaction, button: discord.ui.Button):
        _autoclose_settings["rule_offline"] = not _autoclose_settings["rule_offline"]
        _save_autoclose_settings()
        await interaction.response.edit_message(embed=_build_autoclose_embed(), view=self)

    @discord.ui.button(label="🚫 Пропускать забаненных", style=discord.ButtonStyle.secondary, row=1)
    async def toggle_skip_banned(self, interaction: discord.Interaction, button: discord.ui.Button):
        _autoclose_settings["skip_banned"] = not _autoclose_settings.get("skip_banned", False)
        _save_autoclose_settings()
        await interaction.response.edit_message(embed=_build_autoclose_embed(), view=self)

    @discord.ui.button(label="📊 KD порог", style=discord.ButtonStyle.secondary, row=1)
    async def toggle_kd(self, interaction: discord.Interaction, button: discord.ui.Button):
        # Если уже включено — открываем модалку для изменения порога
        # Если выключено — включаем
        if _autoclose_settings["rule_kd"]:
            await interaction.response.send_modal(AutoCloseKdModal())
        else:
            _autoclose_settings["rule_kd"] = True
            _save_autoclose_settings()
            await interaction.response.edit_message(embed=_build_autoclose_embed(), view=self)

    @discord.ui.button(label="⏱ Время тикета", style=discord.ButtonStyle.secondary, row=1)
    async def toggle_age(self, interaction: discord.Interaction, button: discord.ui.Button):
        if _autoclose_settings["rule_age"]:
            await interaction.response.send_modal(AutoCloseAgeModal())
        else:
            _autoclose_settings["rule_age"] = True
            _save_autoclose_settings()
            await interaction.response.edit_message(embed=_build_autoclose_embed(), view=self)

    # Ряд 2: выключить отдельные правила + текст
    @discord.ui.button(label="❌ Выкл KD", style=discord.ButtonStyle.danger, row=2)
    async def disable_kd(self, interaction: discord.Interaction, button: discord.ui.Button):
        _autoclose_settings["rule_kd"] = False
        _save_autoclose_settings()
        await interaction.response.edit_message(embed=_build_autoclose_embed(), view=self)

    @discord.ui.button(label="❌ Выкл время", style=discord.ButtonStyle.danger, row=2)
    async def disable_age(self, interaction: discord.Interaction, button: discord.ui.Button):
        _autoclose_settings["rule_age"] = False
        _save_autoclose_settings()
        await interaction.response.edit_message(embed=_build_autoclose_embed(), view=self)

    # Ряд 3: текст закрытия
    @discord.ui.button(label="✅ Наказан", style=discord.ButtonStyle.secondary, row=3)
    async def preset_punished(self, interaction: discord.Interaction, button: discord.ui.Button):
        _autoclose_settings["result_text"] = "Игрок был наказан"
        _save_autoclose_settings()
        await interaction.response.edit_message(embed=_build_autoclose_embed(), view=self)

    @discord.ui.button(label="🔍 Доп. проверка", style=discord.ButtonStyle.secondary, row=3)
    async def preset_check(self, interaction: discord.Interaction, button: discord.ui.Button):
        _autoclose_settings["result_text"] = "Требуется дополнительная проверка"
        _save_autoclose_settings()
        await interaction.response.edit_message(embed=_build_autoclose_embed(), view=self)

    @discord.ui.button(label="❌ Не подтверждено", style=discord.ButtonStyle.secondary, row=3)
    async def preset_denied(self, interaction: discord.Interaction, button: discord.ui.Button):
        _autoclose_settings["result_text"] = "Нарушение не подтверждено"
        _save_autoclose_settings()
        await interaction.response.edit_message(embed=_build_autoclose_embed(), view=self)

    @discord.ui.button(label="✏️ Свой вариант", style=discord.ButtonStyle.secondary, row=3)
    async def set_result(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_modal(AutoCloseResultModal())


class AutoCloseKdModal(discord.ui.Modal, title="Порог KD для закрытия"):
    value = discord.ui.TextInput(
        label="Закрыть если KD меньше (например: 0.5)",
        placeholder="0.5",
        max_length=6
    )
    async def on_submit(self, interaction: discord.Interaction):
        try:
            _autoclose_settings["kd_threshold"] = float(self.value.value.strip())
            _autoclose_settings["rule_kd"] = True
            _save_autoclose_settings()
            await interaction.response.edit_message(embed=_build_autoclose_embed(), view=AutoCloseView())
        except ValueError:
            await interaction.response.send_message("Введи число, например 0.5", ephemeral=True)


class AutoCloseAgeModal(discord.ui.Modal, title="Время тикета для закрытия"):
    value = discord.ui.TextInput(
        label="Закрыть если тикет висит >= N минут",
        placeholder="15",
        max_length=4
    )
    async def on_submit(self, interaction: discord.Interaction):
        try:
            _autoclose_settings["age_min"] = max(1, int(self.value.value.strip()))
            _autoclose_settings["rule_age"] = True
            _save_autoclose_settings()
            await interaction.response.edit_message(embed=_build_autoclose_embed(), view=AutoCloseView())
        except ValueError:
            await interaction.response.send_message("Введи число минут, например 15", ephemeral=True)


class AutoCloseResultModal(discord.ui.Modal, title="Свой текст закрытия"):
    value = discord.ui.TextInput(
        label="Текст результата",
        placeholder="Нарушение не подтверждено",
        max_length=200
    )
    async def on_submit(self, interaction: discord.Interaction):
        _autoclose_settings["result_text"] = self.value.value.strip()
        _save_autoclose_settings()
        await interaction.response.edit_message(embed=_build_autoclose_embed(), view=AutoCloseView())


@tree.command(name="autoreports", description="Настройки автозакрытия репортов")
async def cmd_autoreports(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("Нет прав.", ephemeral=True)
    await interaction.response.send_message(
        embed=_build_autoclose_embed(), view=AutoCloseView(), ephemeral=True
    )


@tasks.loop(seconds=10)
async def reports_loop():
    """Мониторинг репортов — каждые 10 секунд."""
    global _reported_notified

    reports_channel = bot.get_channel(REPORTS_CHANNEL_ID)
    if not reports_channel:
        try:
            reports_channel = await bot.fetch_channel(REPORTS_CHANNEL_ID)
        except Exception as e:
            if REPORTS_CHANNEL_ID not in _channel_warned:
                _log(f"⚠️ reports_loop: канал {REPORTS_CHANNEL_ID} не найден. {e}", discord=False)
                _channel_warned.add(REPORTS_CHANNEL_ID)
            return
    
    if not reports_channel:
        return

    result = await _fetch_reports()

    # Сохраняем в БД для панели (обогащение игроков)
    if result and isinstance(result, list):
        try:
            _db.db_upsert_reports(result)
        except Exception as e:
            _log(f"⚠️ Ошибка сохранения репортов в БД: {e}", discord=False)

    # Токен устарел — уведомляем в специальный канал с пингом роли
    if result == "token_expired":
        _log("⚠️ Fear куки устарели!")
        try:
            token_channel = bot.get_channel(TOKEN_ALERT_CHANNEL_ID)
            if token_channel:
                try:
                    await asyncio.wait_for(token_channel.send(
                        content=f"<@{BOT_OWNER_ID}> ⚠️ **Надо обновить токен от фира**\n"
                        f"Используй `/adminsync` чтобы вставить новые куки с fearproject.ru",
                        allowed_mentions=discord.AllowedMentions(users=True)
                    ), timeout=5.0)
                except Exception:
                    pass
            # Останавливаем петлю чтобы не спамить
            reports_loop.stop()
        except Exception as e:
            _log(f"❌ Не удалось уведомить об устаревшем токене: {e}")
        return

    if not result or not isinstance(result, list):
        return

    # Группируем по нарушителю (intruder_steamid)
    by_intruder: dict[str, list] = {}
    for report in result:
        sid = report.get("intruder_steamid", "")
        if not sid:
            continue
        
        # Пропускаем игроков из белого списка
        if str(sid) in _whitelist:
            continue

        # Только открытые репорты (result == null)
        if report.get("result") is not None:
            continue
        # Пропускаем тикеты которые мы уже закрывали
        if report.get("id") in _closed_report_ids:
            continue
        by_intruder.setdefault(sid, []).append(report)

    now_utc = datetime.now(timezone.utc)

    # Получаем список онлайн игроков один раз для всего цикла
    online_players: dict[str, dict] = {}
    try:
        async with aiohttp.ClientSession() as session:
            servers = await _fetch_json(session, f"{API_BASE}/servers")
            if servers:
                for srv in servers:
                    for player in srv.get("live_data", {}).get("players", []):
                        sid = str(player.get("steam_id", ""))
                        if sid:
                            kills  = player.get("kills", 0) or 0
                            deaths = player.get("deaths", 1) or 1
                            online_players[sid] = {
                                "player": player,
                                "server": srv,
                                "kd": round(kills / deaths, 2)
                            }
    except Exception as e:
        _log(f"⚠️ reports_loop servers: {e}")

    for steamid, reports in by_intruder.items():
        if not reports:
            continue

        player_info = online_players.get(steamid)
        is_online   = player_info is not None
        kd          = player_info["kd"] if player_info else None

        # ── Уведомление (3+ репортов и KD 2+) ────────────────────────────
        if len(reports) >= 3 and kd is not None and kd >= 2.0:
            report_ids_frozen = frozenset(r.get("id") for r in reports)
            already_notified  = _reported_notified.get(steamid)
            if already_notified != report_ids_frozen:
                server_info = {"server": player_info["server"], "player": player_info["player"]} if player_info else None
                embed = _build_report_embed(steamid, reports, kd, server_info)
                try:
                    await asyncio.wait_for(reports_channel.send(
                        content="Найден подозрительный игрок",
                        embed=embed,
                        allowed_mentions=discord.AllowedMentions.none()
                    ), timeout=5.0)
                    _reported_notified[steamid] = report_ids_frozen
                    _log(f"🚨 Репорт отправлен: {steamid} ({len(reports)} жалоб, KD={kd})")
                except Exception as e:
                    _log(f"❌ Ошибка отправки репорта: {e}")

        # ── Автозакрытие — работает независимо от количества репортов ─────
        if not _autoclose_settings["enabled"]:
            continue

        s = _autoclose_settings

        # Проверяем забанен ли игрок на Fear
        is_banned = False
        fear_profile = await _fetch_json_cached(steamid)
        if fear_profile and fear_profile.get("banInfo", {}).get("isBanned"):
            is_banned = True

        # Если включено "пропускать забаненных" — не трогаем тикеты на них
        if s.get("skip_banned") and is_banned:
            continue

        ids_to_close = []
        reason = ""

        for report in reports:
            if report.get("reason", "").strip() != "Читы":
                continue

            try:
                created = datetime.fromisoformat(report["created_at"].replace("Z", "+00:00"))
                age_min = (now_utc - created).total_seconds() / 60
            except Exception:
                age_min = 0

            should_close = False

            if s["rule_offline"] and not is_online:
                should_close = True
                reason = "офлайн"
            elif s["rule_kd"] and is_online and kd is not None and kd < s["kd_threshold"]:
                should_close = True
                reason = f"KD={kd} < {s['kd_threshold']}"
            elif s["rule_age"] and age_min >= s["age_min"]:
                should_close = True
                reason = f"возраст {int(age_min)}мин >= {s['age_min']}мин"

            if should_close:
                ids_to_close.append(report["id"])

        if ids_to_close:
            ok = await _close_reports(ids_to_close, s["result_text"])
            if ok:
                intruder_name = reports[0].get("intruder", steamid)
                ids_str = ", ".join(f"#{i}" for i in ids_to_close)
                _log(f"✅ Закрыт(ы) тикет(ы) {ids_str} на [{intruder_name}] ({steamid}) — {reason}")
                for rid in ids_to_close:
                    _closed_report_ids.add(rid)
            else:
                intruder_name = reports[0].get("intruder", steamid)
                ids_str = ", ".join(f"#{i}" for i in ids_to_close)
                _log(f"❌ [AUTO-CLOSE FAIL] Не удалось закрыть тикеты {ids_str} на [{intruder_name}] ({steamid}) — причина: {reason}. Проверь API токен.")


@reports_loop.before_loop
async def before_reports():
    await bot.wait_until_ready()


# ── Мониторинг банов на yooma.su и cs2red.ru ─────────────────────────────────

# Кэш уже проверенных банов чтобы не спамить повторно
# { steamid: {"yooma": set(ban_ids), "cs2red": set(ban_ids)} }
_ban_notify_cache: dict = {}


PUNISHMENT_ROLE_ID = 1510672400415457432

_OWNER_ACCESS_ROLES = {ROLE_OWNER_ID, ROLE_OWNER_ALT_ID, ROLE_GLADMIN_ID, ROLE_CURATOR_ID}

def _has_punishment_access(user: discord.Member | discord.User) -> bool:
    """Только владелец бота, OWNER, OWNER_ALT, GLADMIN, CURATOR."""
    if user.id == BOT_OWNER_ID:
        return True
    if isinstance(user, discord.Member):
        user_roles = {r.id for r in user.roles}
        return bool(user_roles & _OWNER_ACCESS_ROLES)
    for guild in bot.guilds:
        member = guild.get_member(user.id)
        if member:
            user_roles = {r.id for r in member.roles}
            if user_roles & _OWNER_ACCESS_ROLES:
                return True
    return False

def _has_owner_access(user: discord.Member | discord.User) -> bool:
    """Доступ только для владельца, главного админа, владельца альт, куратора."""
    if user.id == BOT_OWNER_ID:
        return True
    if isinstance(user, discord.Member):
        user_roles = {r.id for r in user.roles}
        if user_roles & _OWNER_ACCESS_ROLES:
            return True
        if user.guild_permissions.administrator:
            return True
    for guild in bot.guilds:
        member = guild.get_member(user.id)
        if member:
            user_roles = {r.id for r in member.roles}
            if user_roles & _OWNER_ACCESS_ROLES:
                return True
            if member.guild_permissions.administrator:
                return True
    return False

def _parse_duration(text: str) -> int:
    """Парсит строку времени в секунды. 60s, 30m, 24h, 7d, 120 (число = дни)."""
    text = text.strip().lower()
    if text.endswith("s"):
        return int(text[:-1])
    if text.endswith("m"):
        return int(text[:-1]) * 60
    if text.endswith("h"):
        return int(text[:-1]) * 3600
    if text.endswith("d"):
        return int(text[:-1]) * 86400
    return int(text) * 86400

def _format_duration(total_sec: int) -> str:
    """Форматирует секунды в читаемую строку."""
    if total_sec < 60:
        return f"{total_sec}с"
    if total_sec < 3600:
        return f"{total_sec // 60}м"
    if total_sec < 86400:
        return f"{total_sec // 3600}ч"
    return f"{total_sec // 86400}дн"


async def _resolve_steamid(text: str) -> str | None:
    """Резолвит SteamID из ссылки или текста. Принимает:
    - SteamID64 (число)
    - https://steamcommunity.com/profiles/76561198...
    - https://steamcommunity.com/id/username
    - https://fearproject.ru/profile/76561198...
    Возвращает SteamID64 или None."""
    text = text.strip()

    # Чистый SteamID64
    if text.isdigit() and len(text) >= 17:
        return text

    # Steam profile URL: steamcommunity.com/profiles/76561198...
    m = re.search(r"steamcommunity\.com/profiles/(\d{17,})", text)
    if m:
        return m.group(1)

    # Fear profile URL: fearproject.ru/profile/76561198...
    m = re.search(r"fearproject\.ru/profile/(\d{17,})", text)
    if m:
        return m.group(1)

    # Steam vanity URL: steamcommunity.com/id/username
    m = re.search(r"steamcommunity\.com/id/([a-zA-Z0-9_-]+)", text)
    if m:
        vanity = m.group(1)
        async with aiohttp.ClientSession() as session:
            url = f"https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key={STEAM_API_KEY}&vanityurl={vanity}"
            data = await _fetch_json(session, url)
            if data and data.get("response", {}).get("success") == 1:
                return data["response"]["steamid"]
        return None

    return None

async def _resolve_steamids(text: str) -> list[str]:
    """Резолвит несколько SteamID из текста через пробел/запятую."""
    parts = re.split(r"[\s,]+", text.strip())
    result = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        sid = await _resolve_steamid(part)
        if sid:
            result.append(sid)
    return result

async def _remove_active_by_steamid(session: aiohttp.ClientSession, steamid: str, punish_type: int) -> int:
    """Снимает все активные наказания для steamid. Возвращает кол-во снятых."""
    punishments = await _fear_get_my_punishments(session, punish_type)
    removed = 0
    for p in punishments:
        if str(p.get("steamid")) != str(steamid):
            continue
        if p.get("status") != 1:
            continue
        pid = p.get("id")
        if pid and await _fear_delete_punishment(session, pid):
            removed += 1
    return removed

async def _get_active_by_steamid(session: aiohttp.ClientSession, steamid: str, punish_type: int) -> list:
    """Получает список активных наказаний для steamid."""
    punishments = await _fear_get_my_punishments(session, punish_type)
    return [p for p in punishments if str(p.get("steamid")) == str(steamid) and p.get("status") == 1]

async def _fear_autoban(session: aiohttp.ClientSession, steamid: str, reason: str, duration_sec: int) -> bool:
    """Выдаёт бан на Fear Project через API. Возвращает True при успехе."""
    if not FEAR_COOKIE:
        _log(f"⚠️ [AUTOBAN] FEAR_COOKIE пуст, пропускаю бан {steamid}")
        return False

    url = f"{API_BASE}/admin/punishments/ban"
    payload = {
        "steamid": steamid,
        "reason": reason,
        "duration": duration_sec,
        "punish_type": 0,
    }
    headers = {
        "Cookie": FEAR_COOKIE,
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://fearproject.ru",
        "Referer": "https://fearproject.ru/",
    }
    try:
        timeout = aiohttp.ClientTimeout(total=15)
        async with session.post(url, json=payload, headers=headers, timeout=timeout) as r:
            body = await r.text()
            if r.status in (200, 201):
                _log(f"✅ [AUTOBAN] Забанен {steamid} на {_format_duration(duration_sec)}. Причина: {reason}")
                return True
            else:
                _log(f"⚠️ [AUTOBAN] Ошибка бана {steamid}: HTTP {r.status} — {body[:300]}")
                return False
    except Exception as e:
        _log(f"❌ [AUTOBAN] Исключение при бане {steamid}: {e}\n{traceback.format_exc()}")
        return False

async def _fear_mute(session: aiohttp.ClientSession, steamid: str, reason: str, duration_sec: int, punish_type: int = 1) -> bool:
    """Выдаёт мут на Fear Project через API. punish_type: 1=войс, 2=чат."""
    if not FEAR_COOKIE:
        _log(f"⚠️ [MUTE] FEAR_COOKIE пуст, пропускаю мут {steamid}")
        return False

    url = f"{API_BASE}/admin/punishments/ban"
    payload = {
        "steamid": steamid,
        "reason": reason,
        "duration": duration_sec,
        "punish_type": punish_type,
    }
    headers = {
        "Cookie": FEAR_COOKIE,
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://fearproject.ru",
        "Referer": "https://fearproject.ru/",
    }
    try:
        timeout = aiohttp.ClientTimeout(total=15)
        async with session.post(url, json=payload, headers=headers, timeout=timeout) as r:
            body = await r.text()
            if r.status in (200, 201):
                mute_type = "войс" if punish_type == 1 else "чат"
                _log(f"✅ [MUTE] Замьючен {steamid} ({mute_type}) на {_format_duration(duration_sec)}. Причина: {reason}")
                return True
            else:
                _log(f"⚠️ [MUTE] Ошибка мута {steamid}: HTTP {r.status} — {body[:300]}")
                return False
    except Exception as e:
        _log(f"❌ [MUTE] Исключение при муте {steamid}: {e}")
        return False

async def _fear_delete_punishment(session: aiohttp.ClientSession, punishment_id: int) -> bool:
    """Удаляет наказание (бан/мут) на Fear Project через API."""
    if not FEAR_COOKIE:
        _log(f"⚠️ [UNBAN] FEAR_COOKIE пуст, пропускаю снятие #{punishment_id}")
        return False

    url = f"{API_BASE}/admin/punishments/{punishment_id}"
    headers = {
        "Cookie": FEAR_COOKIE,
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://fearproject.ru",
        "Referer": "https://fearproject.ru/",
    }
    try:
        timeout = aiohttp.ClientTimeout(total=15)
        async with session.delete(url, headers=headers, timeout=timeout) as r:
            body = await r.text()
            if r.status in (200, 204):
                _log(f"✅ [UNBAN] Наказание #{punishment_id} снято")
                return True
            else:
                _log(f"⚠️ [UNBAN] Ошибка снятия #{punishment_id}: HTTP {r.status} — {body[:300]}")
                return False
    except Exception as e:
        _log(f"❌ [UNBAN] Исключение при снятии #{punishment_id}: {e}")
        return False

async def _fear_get_my_punishments(session: aiohttp.ClientSession, punishment_type: int) -> list:
    """Получает список своих наказаний. type: 1=баны, 2=муты."""
    if not FEAR_COOKIE:
        return []

    url = f"{API_BASE}/admin/punishments/my"
    params = {"type": punishment_type}
    headers = {
        "Cookie": FEAR_COOKIE,
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://fearproject.ru",
        "Referer": "https://fearproject.ru/",
    }
    try:
        timeout = aiohttp.ClientTimeout(total=15)
        async with session.get(url, params=params, headers=headers, timeout=timeout) as r:
            if r.status == 200:
                data = await r.json(content_type=None)
                return data if isinstance(data, list) else data.get("punishments", data.get("data", []))
            return []
    except Exception:
        return []

async def _check_cs2red_ban(session: aiohttp.ClientSession, steamid: str) -> dict:
    """
    Проверяет баны на cs2red.ru.
    """
    url = f"https://cs2red.ru/api/data/bans?begin=0&count=8&search={steamid}"
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://cs2red.ru/bans",
            "Origin": "https://cs2red.ru",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
            "Connection": "keep-alive"
        }
        data = await _fetch_json(session, url, headers=headers, timeout_total=6, max_retries=2)
        if not data or not data.get("success"):
            return {"found": False, "bans": []}
        bans_raw = data.get("bans", [])
        if not bans_raw:
            return {"found": False, "bans": []}

        now_ts = datetime.now(timezone.utc).timestamp()
        processed = []
        for b in bans_raw:
            action = b.get("action", {})
            # action.steamid64 — это забаненный игрок
            player_sid = action.get("steamid64", "")
            if player_sid != steamid:
                continue  # не наш игрок

            unban_id = b.get("unbanId")
            end_ts   = b.get("endTimeStamp", 0)
            start_ts = b.get("timestamp", 0)

            # Активный: unbanId == null И срок не истёк
            if unban_id is None and (end_ts == 0 or end_ts > now_ts):
                status = "active"
            else:
                status = "inactive"  # разбан или истёк — не нужен

            try:
                created_str = _msk_from_timestamp(start_ts)
            except Exception:
                created_str = "—"

            if end_ts and end_ts > 0:
                try:
                    dur_sec = end_ts - start_ts
                    dur_str = f"{dur_sec // 86400} дн." if dur_sec >= 86400 else f"{dur_sec // 3600} ч."
                except Exception:
                    dur_str = "—"
            else:
                dur_str = "Навсегда"

            processed.append({
                "id":      b.get("id"),
                "reason":  b.get("reason", "—"),
                "created": created_str,
                "duration": dur_str,
                "status":  status,
                "nick":    action.get("nick", steamid),
            })

        return {"found": bool(processed), "bans": processed}
    except Exception as e:
        _log(f"ℹ️ cs2red check {steamid}: {e}", discord=False)
        return {"found": False, "bans": []}


async def _notify_bans_for_player(steamid: str, nickname: str, channel, session: aiohttp.ClientSession = None):
    """Проверяет игрока на yooma+cs2red и отправляет уведомление если есть новые баны."""
    if not channel:
        return False
    if steamid not in _ban_notify_cache:
        _ban_notify_cache[steamid] = {"yooma": set(), "cs2red": set()}

    async def _do_check(s):
        yooma_data, cs2red_data = await asyncio.gather(
            _check_yooma_ban(s, steamid, nickname),
            _check_cs2red_ban(s, steamid)
        )
        return yooma_data, cs2red_data

    if session:
        yooma_data, cs2red_data = await _do_check(session)
    else:
        async with aiohttp.ClientSession() as s:
            yooma_data, cs2red_data = await _do_check(s)

    steam_url   = f"https://steamcommunity.com/profiles/{steamid}"
    new_found   = False

    # ── Yooma баны ──
    if yooma_data.get("found"):
        for p in yooma_data["punishments"]:
            if p["status"] != "active":
                continue
            bid = p["id"]
            real_sid = p.get("steamid", steamid)
            if real_sid not in _ban_notify_cache:
                _ban_notify_cache[real_sid] = {"yooma": set(), "cs2red": set()}
            if bid in _ban_notify_cache[real_sid]["yooma"]:
                continue
            _ban_notify_cache[real_sid]["yooma"].add(bid)
            new_found = True

            embed = discord.Embed(
                title="🔴 Yooma.su — АКТИВНЫЙ БАН",
                color=0xe74c3c,
                timestamp=datetime.now(timezone.utc)
            )
            embed.add_field(name="👤 Ник",      value=f"**{nickname}**",             inline=True)
            embed.add_field(name="🆔 SteamID",  value=f"`{real_sid}`",              inline=True)
            embed.add_field(name="📋 Причина",  value=p["reason"],                   inline=True)
            embed.add_field(name="📅 Выдан",    value=p["created"],                  inline=True)
            embed.add_field(name="⏳ На сколько", value=p["duration"],               inline=True)
            embed.add_field(name="🔗 Профиль",  value=f"[Yooma](https://yooma.su/ru/profile/{real_sid})  •  [Steam](https://steamcommunity.com/profiles/{real_sid})  •  [Fear](https://fearproject.ru/profile/{real_sid})", inline=True)
            try:
                await asyncio.wait_for(channel.send(embed=embed), timeout=5.0)
            except Exception as e:
                _log(f"ℹ️ Не удалось отправить бан-уведомление (yooma) в канал {getattr(channel, 'id', '?')}: {type(e).__name__}: {e}", discord=False)

            # Автовыдача банов за yooma.su отключена.


    # ── CS2Red баны ──
    if cs2red_data.get("found"):
        for b in cs2red_data["bans"]:
            if b["status"] != "active":
                continue
            bid = b["id"]
            if bid in _ban_notify_cache[steamid]["cs2red"]:
                continue
            _ban_notify_cache[steamid]["cs2red"].add(bid)
            new_found = True

            embed = discord.Embed(
                title="🔴 CS2Red.ru — АКТИВНЫЙ БАН",
                color=0xe74c3c,
                timestamp=datetime.now(timezone.utc)
            )
            embed.add_field(name="👤 Ник",       value=f"**{nickname}**",            inline=True)
            embed.add_field(name="🆔 SteamID",   value=f"`{steamid}`",               inline=True)
            embed.add_field(name="📋 Причина",   value=b["reason"],                  inline=True)
            embed.add_field(name="📅 Выдан",     value=b["created"],                 inline=True)
            embed.add_field(name="⏳ На сколько", value=b["duration"],               inline=True)
            embed.add_field(name="🔗 Профиль",   value=f"[Steam]({steam_url})  •  [Fear](https://fearproject.ru/profile/{steamid})",      inline=True)
            try:
                await asyncio.wait_for(channel.send(embed=embed), timeout=5.0)
            except Exception as e:
                _log(f"ℹ️ Не удалось отправить бан-уведомление (cs2red) в канал {getattr(channel, 'id', '?')}: {type(e).__name__}: {e}", discord=False)

    return new_found

_ban_last_check_ts: dict[str, float] = {}
BAN_RECHECK_INTERVAL = 10

@tasks.loop(seconds=5)
async def ban_check_loop():
    """Проверяет баны ВСЕХ онлайн-игроков каждые 10 сек. Кулдаун на игрока: 10 сек."""
    channel = bot.get_channel(BAN_NOTIFY_CHANNEL_ID)
    if not channel:
        return
    
    try:
        async with aiohttp.ClientSession(
            connector=aiohttp.TCPConnector(limit=50)
        ) as session:
            servers = await _fetch_json(session, f"{API_BASE}/servers")
            if not servers:
                return

            online: dict[str, str] = {}
            for srv in servers:
                for player in srv.get("live_data", {}).get("players", []):
                    sid = str(player.get("steam_id", "")).strip()
                    if not sid:
                        continue
                    online[sid] = player.get("nickname", sid) or sid

            now_time = datetime.now(timezone.utc).timestamp()

            # Проверяем ВСЕХ онлайн, кого не проверяли последние BAN_RECHECK_INTERVAL сек
            to_check_ids = [
                sid for sid in online
                if (now_time - _ban_last_check_ts.get(sid, 0)) >= BAN_RECHECK_INTERVAL
            ]

            # Очистка старых записей (>1 час)
            stale_cutoff = now_time - 3600
            stale_keys = [k for k, v in _ban_last_check_ts.items() if v < stale_cutoff]
            for k in stale_keys:
                _ban_last_check_ts.pop(k, None)

            if not to_check_ids:
                return

            _log(f"🔍 [BAN CHECK] Проверяю {len(to_check_ids)} из {len(online)} онлайн", discord=False)

            ban_sem = asyncio.Semaphore(35)
            async def _check_one(sid):
                async with ban_sem:
                    await _notify_bans_for_player(sid, online[sid], channel, session)
                    _ban_last_check_ts[sid] = now_time

            await asyncio.gather(*[_check_one(sid) for sid in to_check_ids])

    except Exception as e:
        _log(f"❌ ban_check_loop: {e}")


@ban_check_loop.before_loop
async def before_ban_check():
    await bot.wait_until_ready()


# ── Основной цикл мониторинга ─────────────────────────────────────────────────

_channel_warned: set[int] = set()

@tasks.loop(seconds=15)
async def monitor_loop():
    global _last_online_record_ts
    _log("🔄 [MONITOR] Начало цикла мониторинга", discord=False)
    sus_channel   = bot.get_channel(SUSPICIOUS_CHANNEL_ID)
    watch_channel = bot.get_channel(WATCH_CHANNEL_ID)
    
    if not sus_channel:
        _log(f"⚠️ [MONITOR] Канал tracked-admins ({SUSPICIOUS_CHANNEL_ID}) не найден в кэше, пробуем fetch...", discord=False)
        try: sus_channel = await bot.fetch_channel(SUSPICIOUS_CHANNEL_ID)
        except Exception as e: _log(f"❌ [MONITOR] Ошибка fetch tracked-admins: {e}", discord=False)

    if not watch_channel:
        _log(f"⚠️ [MONITOR] Канал наблюдения ({WATCH_CHANNEL_ID}) не найден в кэше, пробуем fetch...", discord=False)
        try: watch_channel = await bot.fetch_channel(WATCH_CHANNEL_ID)
        except Exception as e: _log(f"❌ [MONITOR] Ошибка fetch канала наблюдения: {e}", discord=False)

    # _profile_cache.clear() - Убираем очистку, чтобы данные были доступны лидерборду
    async with aiohttp.ClientSession() as session:
        _log(f"🌐 [MONITOR] Запрос серверов...", discord=False)
        servers = await _fetch_json(session, f"{API_BASE}/servers")
        if not servers:
            _log("⚠️ [MONITOR] Серверы не получены", discord=False)
            return
        
        # Обновляем глобальный кэш онлайна для лидерборда
        global _cached_online_players
        new_online = {}
        tracked_entries = []
        new_player_nicks: dict[str, str] = {}
        for srv in servers:
            srv_name = srv.get("name") or srv.get("site_name") or "Unknown"
            ip = srv.get("ip", "")
            port = srv.get("port", "")
            conn = f"connect {ip}:{port}" if ip and port else "—"

            for player in srv.get("live_data", {}).get("players", []):
                sid = str(player.get("steam_id") or "").strip()
                if not sid: continue
                
                # Пропускаем игроков из белого списка
                if sid in _whitelist:
                    continue

                nickname = player.get("nickname", sid) or sid
                new_online[sid] = {"server": srv_name, "connect": conn}
                new_player_nicks[sid] = nickname

                is_admin = player.get("is_admin")
                is_top1000 = sid in _cached_top1000_ids
                is_marked = sid in _marks and _marks[sid] != "clean"
                
                if is_admin or is_top1000 or is_marked:
                    tracked_entries.append({"player": player, "server": srv, "is_top1000": is_top1000})
        
        _cached_online_players = new_online

        # Сохраняем снапшот активности в PostgreSQL (только число)
        try:
            total_admins = sum(1 for sid, info in new_online.items()
                               if sid in {str(a.get("steamid") or "").strip() for a in _load_admins_cache()})
            _db.db_save_server_activity(len(new_online), total_admins)
        except Exception as e:
            _log(f"⚠️ [MONITOR] Ошибка save_server_activity: {e}", discord=False)

        _log(f"👮 [MONITOR] Отслеживаемых: {len(tracked_entries)} | Всего онлайн: {len(new_online)}", discord=False)

        # ── POST snapshot в сайт (WebSocket real-time) ──
        if SITE_API_URL and new_online:
            try:
                import urllib.request
                snapshot = {
                    "secret": SITE_API_SECRET,
                    "players": new_online,
                    "total": len(new_online),
                    "servers": servers,
                    "timestamp": int(time.time()),
                }
                req = urllib.request.Request(
                    f"{SITE_API_URL}/api/bot/snapshot",
                    data=json.dumps(snapshot).encode(),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                urllib.request.urlopen(req, timeout=5)
            except Exception as e:
                _log(f"⚠️ [MONITOR] Snapshot POST error: {e}", discord=False)

        # ── Мгновенная проверка банов для новых игроков ──
        new_sids = set(new_online.keys()) - set(_ban_last_check_ts.keys())
        if new_sids:
            _log(f"⚡ [BAN] Новых игроков: {len(new_sids)}, проверяю сразу...", discord=False)
            channel = bot.get_channel(BAN_NOTIFY_CHANNEL_ID)
            if channel:
                ban_sem = asyncio.Semaphore(25)
                async def _check_new_one(sid: str):
                    async with ban_sem:
                        try:
                            await _notify_bans_for_player(sid, new_player_nicks.get(sid, sid), channel, session)
                            _ban_last_check_ts[sid] = datetime.now(timezone.utc).timestamp()
                        except Exception as e:
                            _log(f"⚠️ [BAN] Ошибка быстрой проверки {sid}: {e}")
                await asyncio.gather(*[_check_new_one(sid) for sid in new_sids])

        now_ts = datetime.now(timezone.utc).timestamp()
        if now_ts - _last_online_record_ts >= 300:
            _record_online_count(len(new_online))
            _last_online_record_ts = now_ts
        
        if not tracked_entries:
            return

        _log(f"🔍 [MONITOR] Запрос профилей для {len(tracked_entries)} игроков...", discord=False)
        profiles = await asyncio.gather(*[
            _get_profile(session, e["player"]["steam_id"]) for e in tracked_entries
        ])
        
        online_ids = set()
        for entry, profile in zip(tracked_entries, profiles):
            player   = entry["player"]
            server   = entry["server"]
            steam_id = player["steam_id"]
            mark     = _marks.get(steam_id)
            
            if mark == "clean":
                continue
                
            score = _suspicion_score(player, profile)
            online_ids.add(steam_id)
            
            prev_score = _last_score.get(steam_id)
            if prev_score is None:
                _add_history(steam_id, f"Появился онлайн на {server.get('site_name','?')} (скор {score})")
            else:
                if abs(score - prev_score) >= 10:
                    _add_history(steam_id, f"Скор изменился: {prev_score} -> {score}")
                old_srv = _last_score.get(f"{steam_id}_srv")
                new_srv = f"{server.get('ip')}:{server.get('port')}"
                if old_srv and old_srv != new_srv:
                    _add_history(steam_id, f"Сменил сервер: {old_srv} -> {new_srv}")
                old_team = _last_score.get(f"{steam_id}_team")
                new_team = player.get("team", "")
                if old_team and old_team != new_team:
                    _add_history(steam_id, f"Сменил сторону: {old_team.upper()} -> {new_team.upper()}")
            
            _last_score[steam_id]           = score
            _last_score[f"{steam_id}_srv"]  = f"{server.get('ip')}:{server.get('port')}"
            _last_score[f"{steam_id}_team"] = player.get("team", "")
            
            embed = _build_player_embed(player, profile, server, score)
            
            # Отправка в tracked-admins (если подозрительный или есть метка)
            if (score >= SUSPICION_THRESHOLD or mark == "suspicious") and sus_channel:
                ping = None
                if prev_score is None and score >= 60:
                    ping = f"<@&{ALERT_ROLE_ID}> Подозрительный админ онлайн!"
                elif prev_score is not None and prev_score < 60 and score >= 60:
                    ping = f"<@&{ALERT_ROLE_ID}> Скор вырос до {score}!"
                
                _log(f"📝 [MONITOR] Обновление сообщения в tracked-admins для {player['nickname']} ({steam_id})", discord=False)
                await _upsert_player_msg(sus_channel, steam_id, embed, None, _sus_msg_ids, ping)
            
            # Отправка в канал наблюдения (только если есть метка "watch")
            # Для ТОП-1000 игроков отдельные сообщения больше не создаем, они видны в панели /leaderboard_panel
            if mark == "watch" and watch_channel:
                watch_embed = _build_player_embed(player, profile, server, score, is_watch=True)
                
                if score >= 60:
                    watch_view = None
                else:
                    watch_view = PlayerMarkView(steam_id, player["nickname"], server.get("ip",""), str(server.get("port","")), is_watch=True)
                
                _log(f"📝 [MONITOR] Обновление сообщения в канале наблюдения для {player['nickname']} ({steam_id})", discord=False)
                await _upsert_player_msg(watch_channel, steam_id, watch_embed, watch_view, _watch_msg_ids)

        # Обработка вышедших офлайн
        gone_sus   = [sid for sid in list(_sus_msg_ids.keys())   if sid not in online_ids]
        gone_watch = [sid for sid in list(_watch_msg_ids.keys()) if sid not in online_ids]
        
        for sid in gone_sus:
            _offline_buffer[sid] = _offline_buffer.get(sid, 0) + 1
            if _offline_buffer[sid] >= 2:
                _offline_buffer.pop(sid, None)
                _add_history(sid, "Вышел офлайн")
                _log(f"📴 [MONITOR] {sid} вышел офлайн (tracked-admins)", discord=False)
                if sus_channel:
                    await _mark_offline_msg(sus_channel, sid, _sus_msg_ids, remove_view=True)
        
        for sid in gone_watch:
            _offline_buffer[sid] = _offline_buffer.get(sid, 0) + 1
            if _offline_buffer[sid] >= 2:
                _offline_buffer.pop(sid, None)
                _log(f"📴 [MONITOR] {sid} вышел офлайн (наблюдение)", discord=False)
                if watch_channel:
                    await _mark_offline_msg(watch_channel, sid, _watch_msg_ids)
        
        for sid in list(_offline_buffer.keys()):
            if sid in online_ids:
                _offline_buffer.pop(sid, None)
    
    _log("🏁 [MONITOR] Цикл мониторинга завершен", discord=False)

@monitor_loop.before_loop
async def before_monitor():
    await bot.wait_until_ready()
    _load_marks()
    _load_msg_ids()
    _load_history()
    _load_whitelist()

FEARSEARCH_LOCAL = "http://127.0.0.1:8080"
PUNISH_SEARCH_URL = f"{API_BASE}/punishments/search"

async def _fetch_all_punishments(session: aiohttp.ClientSession, steamid: str, ptype: int) -> list:
    """Листает все страницы наказаний для админа по типу (1=баны, 2=муты).
    Без фильтра по status — API возвращает все статусы."""
    headers = {
        "Cookie": FEAR_COOKIE,
        "Referer": "https://fearproject.ru/",
        "Origin": "https://fearproject.ru",
        "Accept": "application/json"
    }
    limit = 20
    result = []
    page = 1
    max_pages = 50
    
    while page <= max_pages:
        params = {"q": steamid, "page": page, "limit": limit, "type": ptype}
        data = await _fetch_json(session, PUNISH_SEARCH_URL, params=params, headers=headers)
        
        if not data or "punishments" not in data:
            break
        
        raw = data.get("punishments") or []
        if not raw:
            break
        if not isinstance(raw, list):
            break
        
        result.extend([p for p in raw if str(p.get("admin_steamid") or "").strip() == str(steamid)])
        
        # Если страница неполная — следующих нет
        if len(raw) < limit:
            break
        
        page += 1
    
    return result

async def _fetch_punishment_by_id_global(session: aiohttp.ClientSession, pid: int | str) -> dict | None:
    """Ищет наказание по ID в общем списке (без фильтра админа)."""
    headers = {
        "Cookie": FEAR_COOKIE,
        "Referer": "https://fearproject.ru/",
        "Origin": "https://fearproject.ru",
        "Accept": "application/json"
    }
    pid_str = str(pid)

    # Поиск по ID: пробуем type=1 и type=2 (API без status возвращает все статусы)
    for ptype in [1, 2]:
        data = await _fetch_json(session, PUNISH_SEARCH_URL,
            params={"q": pid_str, "page": 1, "limit": 20, "type": ptype},
            headers=headers)
        if data and "punishments" in data:
            raw = data.get("punishments") or []
            if isinstance(raw, list):
                for p in raw:
                    if str(p.get("id")) == pid_str:
                        return p

    # Если не нашли — листаем общие страницы без фильтра q (limit=20, до 50 страниц = 1000 записей)
    for ptype in [1, 2]:
        page = 1
        limit = 20
        while page <= 50:
            params = {"page": page, "limit": limit, "type": ptype}
            data = await _fetch_json(session, PUNISH_SEARCH_URL, params=params, headers=headers)
            if not data or "punishments" not in data:
                break
            raw = data.get("punishments") or []
            if not isinstance(raw, list):
                break
            for p in raw:
                if str(p.get("id")) == pid_str:
                    return p
            # Если страница неполная — больше нет
            if len(raw) < limit:
                break
            page += 1
            await asyncio.sleep(0.2)

    return None


async def _update_cache_for_staff(session: aiohttp.ClientSession, entry: dict) -> bool:
    """Просто загружает ВСЕ наказания админа с сайта и перезаписывает кэш."""
    sid = str(entry.get("steamid", "")).strip()
    name = entry.get("name", sid)
    if not sid:
        return False

    try:
        # 1. Запрашиваем баны (type=1) и муты (type=2) — API без status возвращает все статусы
        bans = await _fetch_all_punishments(session, sid, 1)
        mutes = await _fetch_all_punishments(session, sid, 2)

        # 2. Сохраняем атомарно под lock
        async with _staff_cache_lock:
            cache = {
                "bans": bans,
                "mutes": mutes,
                "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "method": "search_api"
            }
            path = CACHE_DIR / f"fearsearch_bans_{sid}.json"
            _save_json_atomic(path, cache)

        # 3. Сохраняем профиль в PostgreSQL
        try:
            pg_headers = {
                "Cookie": FEAR_COOKIE,
                "Referer": "https://fearproject.ru/",
                "Accept": "application/json"
            }
            profile = await _fetch_json(session, f"{API_BASE}/profile/{sid}", headers=pg_headers)
            if profile:
                _db.db_upsert_profile(profile)
        except Exception as e:
            _log(f"⚠️ [PG] Ошибка upsert profile {sid}: {e}", discord=False)

        return True
    except Exception as e:
        _log(f"  ❌ Ошибка загрузки для {name} ({sid}): {e}")
        return False



# ── Автообновление списка стаффа с Discord данными ───────────────────────────

async def _sync_staff_list() -> dict:
    """Обновляет admins_cache.json (все админы) и staff_db.json (только стафф)."""
    db = _load_staff_db()
    old_admins = {a.get("steamid"): a for a in _load_admins_cache()}
    old_staff_count = len(db)

    admins = await _fetch_admins_list()
    if not admins:
        return {
            "updated": 0, "total": old_staff_count, "new": 0, "removed": 0,
            "admins_total": 0, "error": "API недоступен"
        }

    # === 1. Сохраняем ВСЕХ админов, перенося старые Discord данные ===
    for admin in admins:
        sid = admin.get("steamid")
        if sid in old_admins:
            old = old_admins[sid]
            # Сохраняем дискорды если они были найдены ранее
            if not admin.get("discord_id") and old.get("discord_id"):
                admin["discord_id"] = old["discord_id"]
            if not admin.get("discord_nickname") and old.get("discord_nickname"):
                admin["discord_nickname"] = old["discord_nickname"]

    _save_admins_cache(admins)

    # === 1.1. Синхронизация админов в PostgreSQL ===
    try:
        pg_written = 0
        for admin in admins:
            if _db.db_upsert_admin(admin):
                pg_written += 1
        if pg_written:
            _log(f"📝 [PG] Upserted {pg_written} admins to PostgreSQL", discord=False)
    except Exception as e:
        _log(f"⚠️ [PG] Ошибка синхронизации админов в PostgreSQL: {e}", discord=False)

    # === 2. Обновляем staff_db.json — только стафф (MODER+) ===
    updated = 0
    new_count = 0
    current_staff_sids = set()

    # Очищаем staff_db от лишних групп перед синхронизацией
    for sid in list(db.keys()):
        group = db[sid].get("group_name", "").upper()
        if group not in _STAFF_GROUPS:
            del db[sid]

    manual_blacklist = _load_staff_blacklist()
    for admin in admins:
        sid = (admin.get("steamid") or "").strip()
        if not sid or sid in _STAFF_BLACKLIST or sid in manual_blacklist:
            continue

        group = (admin.get("group_name") or "").strip().upper()

        if group not in _STAFF_GROUPS:
            continue

        current_staff_sids.add(sid)
        role = _STAFF_GROUPS[group]
        name = admin.get("name") or sid

        if sid in db:
            old_entry = db[sid]
            changed = False
            if old_entry.get("name") != name:
                old_entry["name"] = name
                changed = True
            if old_entry.get("role") != role:
                old_entry["role"] = role
                changed = True
            if old_entry.get("group_name") != group:
                old_entry["group_name"] = group
                changed = True
            
            # Также синхронизируем дискорд из админ-кэша если он там появился
            if admin.get("discord_id") and old_entry.get("discord_id") != admin["discord_id"]:
                old_entry["discord_id"] = admin["discord_id"]
                changed = True
            if admin.get("discord_nickname") and old_entry.get("discord_name") != admin["discord_nickname"]:
                old_entry["discord_name"] = admin["discord_nickname"]
                changed = True

            if changed:
                old_entry["updated_at"] = datetime.now(timezone.utc).isoformat()
                updated += 1
        else:
            db[sid] = {
                "name": name,
                "discord_id": admin.get("discord_id"),
                "discord_name": admin.get("discord_nickname"),
                "role": role,
                "group_name": group,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            new_count += 1

    # Удаляем тех кто больше не стафф
    removed = 0
    for sid in list(db.keys()):
        if sid not in current_staff_sids:
            del db[sid]
            removed += 1

    _save_staff_db(db)
    return {
        "updated": updated,
        "total": len(db),
        "new": new_count,
        "removed": removed,
        "admins_total": len(admins),
        "error": None,
    }


async def _sync_staff_roles(staff_db: dict):
    """Синхронизирует Discord роли для стаффа на основе их группы на сайте."""
    for sid, entry in staff_db.items():
        d_id = entry.get("discord_id")
        if not d_id:
            continue
            
        group = entry.get("group_name", "").upper()
        # Определяем целевую роль
        target_role_id = None
        
        # 1. Проверка на Куратора (по Discord ID)
        if d_id in CURATOR_DISCORD_IDS:
            target_role_id = ROLE_CURATOR_ID
        # 2. Проверка на Владельца (по Discord ID или SteamID)
        elif d_id in OWNER_DISCORD_IDS:
            target_role_id = ROLE_OWNER_ID
        # 3. Роли по группе на сайте (новая иерархия)
        elif group == "GLADMIN":
            target_role_id = ROLE_GLADMIN_ID
        elif group == "STADMIN":
            target_role_id = ROLE_STADMIN_ID
        elif group == "STAFF":
            # Старый формат группы STAFF — маппим по спискам
            if d_id in GLADMIN_DISCORD_IDS:
                target_role_id = ROLE_GLADMIN_ID
            elif d_id in STADMIN_DISCORD_IDS:
                target_role_id = ROLE_STADMIN_ID
            else:
                target_role_id = ROLE_STMODER_ID
        elif group == "STMODER":
            target_role_id = ROLE_STMODER_ID
        elif group == "MODER":
            target_role_id = ROLE_MODER_ID
        elif group == "MLMODER":
            target_role_id = ROLE_MLMODER_ID
        elif group == "ADMIN":
            target_role_id = ROLE_ADMIN_ID
        elif group == "ADMIN+":
            target_role_id = ROLE_ADMIN_PLUS_ID
        else:
            # Если не смогли определить роль - выдаем "Права не определенны"
            target_role_id = ROLE_UNDEFINED_ID
            
        for guild in bot.guilds:
            try:
                member = guild.get_member(int(d_id))
                if not member:
                    try:
                        member = await guild.fetch_member(int(d_id))
                    except:
                        continue
                
                if not member:
                    continue
                    
                # Список всех ролей стаффа для очистки
                all_staff_roles = {
                    ROLE_MLMODER_ID: "Мл.Модератор",
                    ROLE_MODER_ID: "Модератор",
                    ROLE_STMODER_ID: "Ст. Модератор",
                    ROLE_STADMIN_ID: "Ст. Администратор",
                    ROLE_GLADMIN_ID: "Гл. Администратор",
                    ROLE_OWNER_ID: "Владелец",
                    ROLE_ADMIN_ID: "Админ",
                    ROLE_ADMIN_PLUS_ID: "Админ+",
                    ROLE_CURATOR_ID: "Куратор",
                    ROLE_UNDEFINED_ID: "Права не определенны"
                }
                
                # Если есть целевая роль
                if target_role_id:
                    role_to_add = guild.get_role(target_role_id)
                    if role_to_add:
                        if role_to_add not in member.roles:
                            await member.add_roles(role_to_add, reason=f"Синхронизация стаффа ({group})")
                            _log(f"🎭 [ROLES] {member.name} ({sid}): выдана роль {all_staff_roles[target_role_id]}")
                            
                            # Повторная проверка через 0.3 сек
                            await asyncio.sleep(0.3)
                            member = await guild.fetch_member(int(d_id))
                            if role_to_add in member.roles:
                                _log(f"✅ [ROLES] {member.name} ({sid}): роль подтверждена")
                            else:
                                _log(f"❌ [ROLES] {member.name} ({sid}): роль НЕ подтверждена после выдачи!")
                        
                        # Снимаем все остальные роли стаффа
                        roles_to_remove = []
                        for rid in all_staff_roles:
                            if rid != target_role_id:
                                r = guild.get_role(rid)
                                if r and r in member.roles:
                                    roles_to_remove.append(r)
                        
                        if roles_to_remove:
                            await member.remove_roles(*roles_to_remove, reason="Синхронизация стаффа (снятие лишних)")
                else:
                    # Снимаем вообще все роли стаффа если группы нет в списке
                    roles_to_remove = []
                    for rid in all_staff_roles:
                        r = guild.get_role(rid)
                        if r and r in member.roles:
                            roles_to_remove.append(r)
                    
                    if roles_to_remove:
                        await member.remove_roles(*roles_to_remove, reason="Синхронизация стаффа (снятие)")
                        _log(f"🎭 [ROLES] {member.name} ({sid}): роли стаффа сняты (группа {group})")
            except Exception as e:
                pass

async def _sync_discord_data(sync_all: bool = False) -> dict:
    """Обновляет Discord данные для всего стаффа или для ВООБЩЕ ВСЕХ админов."""
    staff_db = _load_staff_db()
    all_admins = _load_admins_cache()
    
    if sync_all:
        to_sync = all_admins
        total = len(all_admins)
        _log(f"🔄 Проверка Discord данных для {total} админов (полная)...", discord=False)
    else:
        # Только те, кто в staff_db
        staff_sids = set(staff_db.keys())
        to_sync = [a for a in all_admins if a.get("steamid") in staff_sids]
        total = len(to_sync)
        _log(f"🔄 Обновление Discord данных для {total} стаффов...")

    if not to_sync:
        return {"updated": 0, "total": 0, "error": None}

    updated = 0
    checked = 0
    
    # Используем семафор чтобы не спамить API слишком сильно
    sem = asyncio.Semaphore(15)

    async def _update_one(admin_entry: dict):
        nonlocal updated, checked
        sid = admin_entry.get("steamid", "").strip()
        if not sid: return

        async with sem:
            profile = await _fetch_fear_profile(session, sid)
            checked += 1
            if checked % 50 == 0:
                _log(f"  📊 Discord sync: {checked}/{total}...", discord=False)
            
            if profile:
                d_id = str(profile.get("providerUserId") or "")
                d_name = profile.get("discordNickname") or ""
                
                changed = False
                # 1. В admins_cache
                if d_id and admin_entry.get("discord_id") != d_id:
                    admin_entry["discord_id"] = d_id
                    changed = True
                if d_name and admin_entry.get("discord_nickname") != d_name:
                    admin_entry["discord_nickname"] = d_name
                    changed = True
                
                # 2. В staff_db
                if sid in staff_db:
                    s_entry = staff_db[sid]
                    if d_id and s_entry.get("discord_id") != d_id:
                        s_entry["discord_id"] = d_id
                        changed = True
                    if d_name and s_entry.get("discord_name") != d_name:
                        s_entry["discord_name"] = d_name
                        changed = True
                    if changed:
                        s_entry["updated_at"] = datetime.now(timezone.utc).isoformat()

                if changed:
                    updated += 1
            
            # Небольшая пауза между запросами внутри семафора
            await asyncio.sleep(0.05)

    async with aiohttp.ClientSession() as session:
        await asyncio.gather(*[_update_one(a) for a in to_sync])

    _save_admins_cache(all_admins)
    _save_staff_db(staff_db)
    
    # Синхронизируем роли в Discord
    await _sync_staff_roles(staff_db)
    
    _log(f"✅ Discord данные: {total} проверено, {updated} обновлено")
    return {
        "updated": updated,
        "total": total,
        "error": None,
    }

@tasks.loop(hours=168)  # 168 часов = 7 дней
async def discord_sync_loop():
    """Раз в неделю обновляет Discord данные стаффа."""
    fresh = _reload_fear_cookie()
    if not fresh:
        _log("⚠️ discord_sync_loop: FEAR_COOKIE пуст, пропускаю")
        return
    await _sync_discord_data()

@discord_sync_loop.before_loop
async def before_discord_sync():
    await bot.wait_until_ready()

@tasks.loop(hours=1)
async def staff_db_sync_loop():
    """Каждый час обновляет список стаффа (роли, добавление/удаление). Без Discord API."""
    fresh = _reload_fear_cookie()
    if not fresh:
        _log("⚠️ staff_db_sync_loop: FEAR_COOKIE пуст, пропускаю обновление")
        return
    _log("🔄 Автообновление списков...")
    result = await _sync_staff_list()
    _log(f"✅ Админов всего: {result['admins_total']} | Стафф: {result['total']} чел. "
         f"(+{result['new']} новых, обновлено {result['updated']}, удалено {result['removed']})")
    
    # Синхронизируем роли в Discord после обновления списка
    db = _load_staff_db()
    await _sync_staff_roles(db)

@staff_db_sync_loop.before_loop
async def before_staff_db_sync():
    await bot.wait_until_ready()

@tasks.loop(minutes=9999)  # не запускается автоматически — только вручную
async def staff_cache_loop():
    """Обновляет кэш наказаний для всего стаффа через fearproject search API."""
    staff = _load_staff_list()
    if not staff:
        return
    _log(f"🔄 Обновление кэша стаффа ({len(staff)} чел.) параллельно...")
    start = datetime.now()
    async with aiohttp.ClientSession() as session:
        updated = 0
        batch_size = 5
        for i in range(0, len(staff), batch_size):
            batch = staff[i:i + batch_size]
            names = ", ".join(e.get("name", e.get("steamid","?")) for e in batch)
            _log(f"  📦 Батч {i//batch_size + 1}: {names}")
            results = await asyncio.gather(*[
                _update_cache_for_staff(session, entry) for entry in batch
            ])
            updated += sum(results)
            await asyncio.sleep(0.5)
    elapsed = (datetime.now() - start).seconds
    _log(f"✅ Кэш обновлён: {updated}/{len(staff)} за {elapsed}с")

    # Уведомляем всех кто ждёт завершения
    for cb in list(_staff_cache_done_callbacks):
        try:
            await cb(updated, len(staff), elapsed)
        except Exception as e:
            _log(f"⚠️ callback ошибка: {e}")
    _staff_cache_done_callbacks.clear()
    _log(f"✅ Кэш обновлён: {updated}/{len(staff)} за {elapsed}с")

@staff_cache_loop.before_loop
async def before_staff_cache():
    await bot.wait_until_ready()

async def _initial_sync():
    """Первичная синхронизация при старте."""
    fresh_cookie = _reload_fear_cookie()
    if not fresh_cookie:
        _log("⚠️ FEAR_COOKIE пуст, первичная синхронизация пропущена.", discord=False)
        return

    try:
        _log("🔄 Первичная синхронизация списка стаффа...")
        result = await _sync_staff_list()
        _log(f"✅ Админов: {result['admins_total']} | Стафф: {result['total']} чел. (+{result['new']} новых, удалено {result['removed']})")

        # Discord данные: проверяем всех 1670 админов при первом запуске
        db = _load_staff_db()
        all_admins = _load_admins_cache()
        has_discord = any(e.get("discord_id") for e in db.values())
        
        if not has_discord:
            _log(f"🔄 Первичное обновление Discord данных для всех {len(all_admins)} админов...")
            d_result = await _sync_discord_data(sync_all=True)
        else:
            # Если данные уже есть, просто синхронизируем роли для текущего стаффа (26 чел)
            _log(f"🔄 Синхронизация ролей для {len(db)} стаффов...")
            await _sync_staff_roles(db)
            
        # Запускаем мониторинг подозрительных игроков
        if not suspicious_monitor_loop.is_running():
            suspicious_monitor_loop.start()
            _log("🕵️ Мониторинг подозрительных игроков запущен.")
    except Exception as e:
        _log(f"⚠️ Первичная синхронизация не удалась: {e}")

async def _confirm_registration(discord_id: str, confirmation_code: str, interaction_or_ctx=None, discord_name: str | None = None) -> str:
    """Подтверждает регистрацию по коду. Возвращает текст ответа."""
    confirm = _db.panel_get_registration_confirmation(confirmation_code)
    if not confirm:
        return "❌ Код не найден или истёк."

    expected_user_id = int(confirm["user_id"])
    stored_discord_id = str(confirm["discord_id"] or "").strip()

    # Если discord_id не задан или содержит служебное значение — привязываем текущего пользователя
    if not stored_discord_id or stored_discord_id.lower() in ("pending", "null"):
        _db.panel_update_registration_confirmation_by_code(confirmation_code, discord_id=discord_id)
        stored_discord_id = discord_id
    # Если discord_id уже записан и не совпадает — отказ
    elif stored_discord_id != discord_id:
        _log(f"❌ [Panel] /confirm mismatch: stored={stored_discord_id}, current={discord_id}, code={confirmation_code}", discord=False)
        return "❌ Этот код не для вашего аккаунта."

    # Определяем уровень по ролям на серверах
    level = await _resolve_level_from_discord_roles(discord_id)

    # Активируем пользователя, сохраняем Discord ID и имя
    _db.panel_update_registration_confirmation(confirm["id"], "confirmed", level)
    _db.panel_update_user_discord_id(expected_user_id, discord_id, discord_name)
    _db.panel_update_user_status_and_level(expected_user_id, "active", level)
    _db.panel_log_login_event(expected_user_id, "registration_confirmed", {"level": level, "discord_id": discord_id, "discord_name": discord_name})

    _log(f"✅ [Panel] Пользователь {expected_user_id} подтвердил регистрацию. Discord={discord_id}, level={level}", discord=False)
    return (
        f"✅ Регистрация подтверждена.\n"
        f"Уровень доступа: **{level}**.\n"
        f"Теперь можно войти на сайт: https://fearsearch.pl/"
    )


def _group_name_to_panel_level(group_name: str | None) -> int:
    """Маппинг Fear-группы в уровень панели (fallback без Discord intents)."""
    if not group_name:
        return 0
    g = str(group_name).strip().upper()
    mapping = {
        "MLMODER": 1,
        "МЛ. МОДЕР": 1,
        "MODER": 2,
        "МОДЕР": 2,
        "STAFF": 3,
        "СТАФФ": 3,
        "STMODER": 3,
        "СТ. МОДЕР": 3,
        "STADMIN": 4,
        "СТ. АДМИНИСТРАТОР": 4,
        "GLADMIN": 5,
        "ГЛ. АДМИНИСТРАТОР": 5,
        "ГЛАВНЫЙ АДМИНИСТРАТОР": 5,
    }
    return mapping.get(g, 0)


async def _resolve_level_from_discord_roles(discord_id: str) -> int:
    """Определяет уровень по ролям Discord либо по кэшу стаффа (fallback без intents)."""
    # Сначала проверяем force level 5
    force_ids = set(str(x).strip() for x in (os.getenv("DISCORD_FORCE_LEVEL_5_IDS") or "").split(",") if x.strip())
    if discord_id in force_ids:
        return 5

    # Fallback по staff_db.json — не требует privileged intents.
    staff_entry = _get_staff_by_discord(discord_id)
    if staff_entry:
        fallback_level = _group_name_to_panel_level(staff_entry.get("group_name") or staff_entry.get("role"))
        if fallback_level > 0:
            _log(f"[Panel] Уровень по staff_db: {discord_id} -> {fallback_level} (group={staff_entry.get('group_name')})", discord=False)
            return fallback_level

    # Проверяем блокирующие роли
    blocked_ids = set(str(x).strip() for x in (os.getenv("DISCORD_BLOCKED_ROLE_IDS") or "").split(",") if x.strip())

    # Собираем роли со всех серверов, где есть бот
    user_roles = set()
    member_found = False
    intents_error = False
    for guild in bot.guilds:
        try:
            member = guild.get_member(int(discord_id))
            if not member:
                try:
                    member = await guild.fetch_member(int(discord_id))
                except discord.errors.PrivilegedIntentsRequired as e:
                    intents_error = True
                    _log(f"⚠️ [Panel] Discord intents не включены: нельзя получить роли. {e}", discord=False)
                    continue
                except Exception:
                    continue
            if member:
                member_found = True
                for role in member.roles:
                    user_roles.add(str(role.id))
        except Exception:
            continue

    if not member_found:
        if intents_error:
            _log(f"⚠️ [Panel] Участник {discord_id} не получен через Discord intents. Используем staff_db fallback.", discord=False)
        else:
            _log(f"⚠️ [Panel] Участник {discord_id} не найден на серверах.", discord=False)

    if user_roles & blocked_ids:
        return 0

    # Маппинг ролей -> уровень
    role_levels = {}
    for key, value in os.environ.items():
        if key.startswith("DISCORD_ROLE_LEVEL_"):
            try:
                lvl = int(key.split("_")[-1])
                for rid in str(value).split(","):
                    rid = rid.strip()
                    if rid:
                        role_levels[rid] = lvl
            except Exception:
                continue
        elif key == "DISCORD_ROLE_LEVELS":
            raw = str(value).strip()
            if not raw:
                continue
            # Поддерживаем JSON {"role_id": level, ...}
            try:
                if raw.startswith("{") or raw.startswith("["):
                    data = json.loads(raw)
                    if isinstance(data, dict):
                        for rid, lvl in data.items():
                            role_levels[str(rid)] = int(lvl)
                    continue
            except Exception:
                pass
            # Поддерживаем формат сайта: role_id:level,role_id:level
            try:
                for part in raw.split(","):
                    if not part.strip():
                        continue
                    rid, lvl_str = part.split(":")
                    if rid.strip() and lvl_str.strip():
                        role_levels[rid.strip()] = int(lvl_str.strip())
            except Exception:
                _log(f"⚠️ [Panel] Не удалось разобрать DISCORD_ROLE_LEVELS: {raw}", discord=False)
                continue

    max_level = int(os.getenv("DISCORD_DEFAULT_LEVEL") or "0")
    for rid in user_roles:
        if rid in role_levels and role_levels[rid] > max_level:
            max_level = role_levels[rid]
    return max_level


async def _resolve_discord_id_by_steam(steam_id: str) -> str | None:
    """Ищет Discord ID по Steam ID через локальные базы админов."""
    # 1. Сначала в staff_db
    staff_db = _load_staff_db()
    for sid, entry in staff_db.items():
        if str(sid).strip() == str(steam_id).strip():
            did = str(entry.get("discord_id") or "").strip()
            if did and did != "—":
                return did

    # 2. В кэше админов
    admins = _load_admins_cache()
    for admin in admins:
        if str(admin.get("steamid") or "").strip() == str(steam_id).strip():
            did = str(admin.get("discord_id") or "").strip()
            if did:
                return did

    # 3. Если не нашли — обновляем кэш и ищем снова
    try:
        sync_result = await _sync_staff_list()
        if sync_result and not sync_result.get("error"):
            admins = _load_admins_cache()
            for admin in admins:
                if str(admin.get("steamid") or "").strip() == str(steam_id).strip():
                    did = str(admin.get("discord_id") or "").strip()
                    if did:
                        return did
    except Exception as e:
        _log(f"⚠️ [Panel] Ошибка обновления админов для поиска Discord ID: {e}", discord=False)

    return None


@tasks.loop(seconds=30)
async def panel_registration_loop():
    """Обрабатывает заявки на отправку DM-подтверждения регистрации."""
    try:
        tasks = _db.panel_get_pending_bot_tasks("send_registration_dm", limit=10)
        for task in tasks:
            try:
                task_id = int(task["id"])
                payload = task.get("payload") or {}
                if isinstance(payload, str):
                    payload = json.loads(payload)
                user_id = int(payload.get("user_id", 0))
                steam_id = str(payload.get("steam_id", "")).strip()
                username = str(payload.get("username", "")).strip()
                confirmation_code = str(payload.get("confirmation_code", "")).strip()
                if not user_id or not steam_id or not confirmation_code:
                    _db.panel_update_bot_task(task_id, "failed", {"error": "missing user_id, steam_id or confirmation_code"})
                    continue

                discord_id = await _resolve_discord_id_by_steam(steam_id)
                if not discord_id:
                    _db.panel_update_bot_task(task_id, "failed", {"error": "discord_id not found for steam_id"})
                    _db.panel_log_login_event(user_id, "registration_failed", {"steam_id": steam_id, "reason": "discord_id_not_found"})
                    continue

                # Сохраняем discord_id в подтверждении
                _db.panel_update_registration_confirmation_by_code(confirmation_code, discord_id=discord_id)

                # Отправляем личное сообщение с кодом
                try:
                    user = await bot.fetch_user(int(discord_id))
                    if not user:
                        raise Exception("User not found")
                    embed = discord.Embed(
                        title="Подтверждение регистрации FearSearch",
                        description=(
                            f"На сайте **fearsearch.pl** была создана учётная запись с логином `{username}` и Steam ID `{steam_id}`.\n\n"
                            f"**Ваш код подтверждения: `{confirmation_code}`**\n\n"
                            f"Отправьте боту команду: `/confirm {confirmation_code}`"
                        ),
                        color=discord.Color.blue()
                    )
                    await user.send(embed=embed)
                    _db.panel_update_bot_task(task_id, "completed", {"discord_id": discord_id})
                    _db.panel_log_login_event(user_id, "confirmation_sent", {"discord_id": discord_id, "steam_id": steam_id, "code": confirmation_code})
                    _log(f"✉️ [Panel] Отправлено DM-подтверждение пользователю {user_id} (Discord={discord_id})", discord=False)
                except Exception as e:
                    _db.panel_update_bot_task(task_id, "failed", {"error": f"dm_failed: {e}"})
                    _db.panel_log_login_event(user_id, "confirmation_dm_failed", {"discord_id": discord_id, "error": str(e)})
                    _log(f"⚠️ [Panel] Не удалось отправить DM пользователю {user_id}: {e}", discord=False)
            except Exception as e:
                _log(f"❌ [Panel] Ошибка обработки задачи регистрации {task.get('id')}: {e}", discord=False)
    except Exception as e:
        _log(f"❌ [Panel] Ошибка panel_registration_loop: {e}", discord=False)


@panel_registration_loop.before_loop
async def before_panel_registration_loop():
    await bot.wait_until_ready()


@bot.event
async def on_member_join(member: discord.Member):
    """При входе нового участника проверяем его статус на сайте и выдаем роли."""
    d_id = str(member.id)
    _log(f"👋 [JOIN] Участник {member.name} ({d_id}) зашел на сервер. Проверяю статус...")
    
    db = _load_staff_db()
    # 1. Сначала ищем в локальной базе стаффа
    staff_entry = next((e for sid, e in db.items() if e.get("discord_id") == d_id), None)
    
    if staff_entry:
        sid = next(sid for sid, e in db.items() if e.get("discord_id") == d_id)
        _log(f"✅ [JOIN] Нашел в базе стаффа: {member.name} ({sid}). Синхронизирую роли...")
        await _sync_staff_roles({sid: staff_entry})
    else:
        # 2. Если в базе нет, пробуем найти через поиск админов (по Discord ID)
        _log(f"🔍 [JOIN] {member.name} нет в локальной базе стаффа. Ищу через API Fear...")
        
        async with aiohttp.ClientSession() as session:
            # Используем поиск по админам, так как обычный профиль по d_id найти сложно
            # Но у нас есть список всех админов в кэше, проверим его
            all_admins = _load_admins_cache()
            admin_entry = next((a for a in all_admins if str(a.get("discord_id")) == d_id), None)
            
            if admin_entry:
                sid = admin_entry.get("steamid")
                group = admin_entry.get("group_name", "UNDEFINED")
                _log(f"✅ [JOIN] Нашел в кэше админов: {member.name} ({sid}), группа: {group}")
                
                # Создаем временную запись для синхронизации ролей
                temp_db = {
                    sid: {
                        "discord_id": d_id,
                        "group_name": group,
                        "name": admin_entry.get("name", member.name)
                    }
                }
                await _sync_staff_roles(temp_db)
            else:
                # 3. Если и там нет - значит прав нет, выдаем роль "Не определен"
                _log(f"❓ [JOIN] {member.name} не найден как стафф. Выдаю роль 'Не определен'...")
                # Создаем фейковую запись для _sync_staff_roles, чтобы она выдала UNDEFINED
                temp_db = {
                    "unknown": {
                        "discord_id": d_id,
                        "group_name": "NONE",
                        "name": member.name
                    }
                }
                await _sync_staff_roles(temp_db)

@bot.event
async def on_ready():
    global _tracked_players
    _log("📢 Событие on_ready вызвано", discord=False)

    # ── Восстановление данных из PostgreSQL (если локальные файлы пусты/отсутствуют) ──
    _db.db_init()
    _db_files = [
        ADMIN_ONLINE_PANEL_FILE, LEADERBOARD_PANELS_FILE, SUSPICIOUS_PANEL_FILE,
        NEWBIES_PANEL_FILE, DROPS_FILE, TRACKED_FILE, MARKS_FILE,
        HISTORY_FILE, MSG_IDS_FILE, WHITELIST_FILE, ACCESS_LIST_FILE,
        ALL_PUNISHMENTS_FILE, ONLINE_STATS_FILE, PUNISHMENTS_SCAN_STATE_FILE,
        STAFF_DB_FILE, STAFF_BLACKLIST_FILE, STAFFBOARD_FILE, LEADERSTAFF_PANEL_FILE,
        STAFF_PUNISH_PANEL_FILE, STAFF_PUNISH_STATE_FILE, ADMINS_CACHE_FILE,
        VDF_CHECKS_FILE, AUTOCLOSE_SETTINGS_FILE, LEADERBOARD_CACHE_FILE,
    ]
    restored = 0
    for fpath in _db_files:
        try:
            needs_restore = not fpath.exists() or fpath.stat().st_size < 5
            if needs_restore:
                key = fpath.name
                data = _db.db_load(key)
                if data is not None:
                    fpath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                    restored += 1
        except Exception:
            pass
    if restored:
        _log(f"🔄 [DB] Восстановлено {restored} файлов из PostgreSQL", discord=False)
    
    # Логируем доступные каналы для отладки 404 ошибок
    for guild in bot.guilds:
        _log(f"🏰 Сервер: {guild.name} ({guild.id})", discord=False)
        # Только текстовые каналы
        for channel in guild.text_channels:
            _log(f"  # {channel.name} — ID: {channel.id}", discord=False)

    _tracked_players = _load_tracked()
    # Регистрируем persistent views чтобы кнопки работали после перезапуска
    bot.add_view(TicketButton())
    bot.add_view(TicketControlView())
    bot.add_view(CheckerDMButton())
    bot.add_view(LeaderboardView())
    # RegistrationConfirmView не регистрируем как persistent — у него динамические custom_id и timeout.
    # Обработка идёт через on_interaction по префиксу reg_confirm:

    # Запускаем rate-limited отправщик логов
    _start_log_sender()

    # Восстанавливаем StaffBoard — привязываем View к сохранённому сообщению
    sb = _load_staffboard()
    sb_channel_id = sb.get("channel_id")
    sb_message_id = sb.get("message_id")
    
    # Регистрируем persistent view для стаффборда (чтобы кнопки работали везде)
    bot.add_view(_staffboard_view_from_state(sb))
    
    if sb_channel_id:
        try:
            ch = bot.get_channel(sb_channel_id) or await bot.fetch_channel(sb_channel_id)
            if ch:
                msg = None
                if sb_message_id:
                    try: msg = await ch.fetch_message(sb_message_id)
                    except discord.NotFound: pass
                
                if not msg:
                    # Попробуем найти в истории если ID потерялся или сообщение удалено
                    msg = await _find_panel_in_history(ch, "Статистика стаффа", limit=200)
                    if msg:
                        _save_staffboard(ch.id, msg.id)
                
                if msg:
                    _log(f"✅ StaffBoard привязан к сообщению {msg.id} в #{ch.name}", discord=False)
                else:
                    await _purge_bot_messages(ch, limit=200)
                    view = _staffboard_view_from_state(sb)
                    df, dt = view._get_period()
                    embeds = await asyncio.to_thread(_build_staff_embed, df, dt)
                    new_msg = await ch.send(embed=embeds[0], view=view)
                    _save_staffboard_state(ch.id, new_msg.id, view)
        except Exception as e:
            _log(f"⚠️ Не удалось восстановить StaffBoard: {e}", discord=False)

    # Восстанавливаем панель топ-3 лидеров стаффа
    lp = _load_leaderstaff_panel()
    lp_channel_id = lp.get("channel_id")
    lp_message_id = lp.get("message_id")
    if lp_channel_id:
        try:
            ch = bot.get_channel(lp_channel_id) or await bot.fetch_channel(lp_channel_id)
            if ch:
                msg = None
                if lp_message_id:
                    try: msg = await ch.fetch_message(lp_message_id)
                    except discord.NotFound: pass
                if not msg:
                    msg = await _find_panel_in_history(ch, "Лидеры стаффа", limit=200)
                    if msg:
                        _save_leaderstaff_panel(ch.id, msg.id)
                if msg:
                    _log(f"✅ LeaderStaff панель привязана к сообщению {msg.id} в #{ch.name}", discord=False)
                else:
                    await _purge_bot_messages(ch, limit=200)
                    embed = await asyncio.to_thread(_build_leaderstaff_embed)
                    new_msg = await ch.send(embed=embed)
                    _save_leaderstaff_panel(ch.id, new_msg.id)
        except Exception as e:
            _log(f"⚠️ Не удалось восстановить LeaderStaff панель: {e}", discord=False)

    # ── Автопересоздание панелей (admin_online, leaderboard, suspicious) если сообщения удалены ──
    # Admin Online Panel
    try:
        panels = _load_admin_online_panel()
        if isinstance(panels, dict):
            for msg_key, info in list(panels.items()):
                if not isinstance(info, dict):
                    continue
                ch_id = info.get("channel_id")
                msg_id = info.get("message_id")
                if not ch_id or not msg_id:
                    continue
                ch = bot.get_channel(ch_id)
                if not ch:
                    try: ch = await bot.fetch_channel(ch_id)
                    except: continue
                msg = None
                if msg_id:
                    try: msg = await ch.fetch_message(msg_id)
                    except discord.NotFound: pass
                if not msg:
                    try:
                        msg = await _find_panel_in_history(ch, "Онлайн админов", limit=200)
                    except: pass
                if not msg:
                    await _purge_bot_messages(ch, limit=50)
                    enriched = await _refresh_admin_online_cache()
                    total = len(enriched)
                    total_pages = max(1, (total + 4) // 5)
                    embed = _build_admin_online_embed_for_page(1, total_pages)
                    view = AdminOnlineView(1, total_pages)
                    msg = await ch.send(embed=embed, view=view)
                    panels[str(msg.id)] = {"channel_id": ch.id, "message_id": msg.id, "page": 1, "total_pages": total_pages}
                    if str(msg.id) != msg_key:
                        panels.pop(msg_key, None)
                    _log(f"✅ AdminOnline панель пересоздана в #{ch.name}", discord=False)
                else:
                    panels[str(msg.id)] = {"channel_id": ch.id, "message_id": msg.id, "page": info.get("page", 1), "total_pages": info.get("total_pages", 1)}
                    if str(msg.id) != msg_key:
                        panels.pop(msg_key, None)
            _save_admin_online_panel(panels)
    except Exception as e:
        _log(f"⚠️ Ошибка восстановления AdminOnline панели: {e}", discord=False)

    # Leaderboard Panels (1000top-cheak)
    try:
        lb_panels = _load_leaderboard_panels()
        if isinstance(lb_panels, dict):
            for msg_key, info in list(lb_panels.items()):
                ch_id = info.get("channel_id")
                msg_id = info.get("message_id")
                if not ch_id or not msg_id:
                    continue
                ch = bot.get_channel(ch_id)
                if not ch:
                    try: ch = await bot.fetch_channel(ch_id)
                    except: continue
                msg = None
                if msg_id:
                    try: msg = await ch.fetch_message(msg_id)
                    except discord.NotFound: pass
                if not msg:
                    try:
                        msg = await _find_panel_in_history(ch, "Топ-1000 игроков онлайн", limit=200)
                    except: pass
                if not msg:
                    await _purge_bot_messages(ch, limit=50)
                    embed = _build_leaderboard_embed(info.get("page", 1))
                    view = LeaderboardView(info.get("page", 1))
                    msg = await ch.send(embed=embed, view=view)
                    lb_panels[str(msg.id)] = {"channel_id": ch.id, "message_id": msg.id, "page": info.get("page", 1)}
                    if str(msg.id) != msg_key:
                        lb_panels.pop(msg_key, None)
                    _log(f"✅ Leaderboard панель пересоздана в #{ch.name}", discord=False)
                else:
                    lb_panels[str(msg.id)] = {"channel_id": ch.id, "message_id": msg.id, "page": info.get("page", 1)}
                    if str(msg.id) != msg_key:
                        lb_panels.pop(msg_key, None)
            _save_leaderboard_panels(lb_panels)
    except Exception as e:
        _log(f"⚠️ Ошибка восстановления Leaderboard панели: {e}", discord=False)

    # Suspicious Panel (player)
    try:
        sp = _load_suspicious_panel()
        sp_ch_id = sp.get("channel_id") or SUSPICIOUS_MONITOR_CHANNEL_ID
        sp_msg_id = sp.get("message_id")
        if sp_ch_id:
            ch = bot.get_channel(sp_ch_id)
            if not ch:
                try: ch = await bot.fetch_channel(sp_ch_id)
                except: pass
            if ch:
                msg = None
                if sp_msg_id:
                    try: msg = await ch.fetch_message(sp_msg_id)
                    except discord.NotFound: pass
                if not msg:
                    try:
                        msg = await _find_panel_in_history(ch, "Мониторинг подозрительных", limit=200)
                    except: pass
                if not msg:
                    await _purge_bot_messages(ch, limit=50)
                    embed = await _build_suspicious_embed()
                    msg = await ch.send(embed=embed)
                    _save_suspicious_panel(ch.id, msg.id)
                    _log(f"✅ Suspicious панель пересоздана в #{ch.name}", discord=False)
                else:
                    _save_suspicious_panel(ch.id, msg.id)
    except Exception as e:
        _log(f"⚠️ Ошибка восстановления Suspicious панели: {e}", discord=False)

    # Очистка мусора из all_punishments_log.json при старте
    try:
        data = _load_all_punishments()
        staff_db = _load_staff_db()
        staff_ids = {str(sid).strip() for sid in staff_db.keys() if str(sid).strip()}
        removed = 0
        for key in ("bans", "mutes"):
            for pid in list(data.get(key, {}).keys()):
                item = data[key][pid]
                admin_sid = str(item.get("admin_steamid") or "").strip()
                if admin_sid and admin_sid not in staff_ids:
                    del data[key][pid]
                    removed += 1
        if removed:
            _save_all_punishments(data)
            _log(f"🧹 Очищено {removed} не-стафф записей из all_punishments_log", discord=False)
    except Exception as e:
        _log(f"⚠️ Ошибка очистки all_punishments_log: {e}", discord=False)

    try:
        synced = await tree.sync()
        _log(f"✅ Бот запущен как {bot.user} | Серверов: {len(bot.guilds)} | Slash-команд синхронизировано: {len(synced)}", discord=False)
        _log(f"Команды: {[c.name for c in synced]}", discord=False)
        _log(f"🔗 Ссылка на бота: https://discord.com/users/{bot.user.id}", discord=False)
    except Exception as e:
        _log(f"❌ Ошибка синхронизации: {e}", discord=False)
    if not monitor_loop.is_running():
        monitor_loop.start()
    if not reports_loop.is_running():
        reports_loop.start()
    # Первичная синхронизация при старте — запускаем в фоне чтобы не блокировать войс и лупы
    asyncio.create_task(_initial_sync())

    if not track_loop.is_running():
        track_loop.start()
    if not ban_check_loop.is_running():
        ban_check_loop.start()
    if not staff_db_sync_loop.is_running():
        staff_db_sync_loop.start()
    if not discord_sync_loop.is_running():
        discord_sync_loop.start()
    if not leaderboard_sync_loop.is_running():
        leaderboard_sync_loop.start()
    if not leaderboard_online_update_loop.is_running():
        leaderboard_online_update_loop.start()
    if not suspicious_monitor_loop.is_running():
        suspicious_monitor_loop.start()
    if not newbies_panel_loop.is_running():
        newbies_panel_loop.start()
    if not admin_online_panel_loop.is_running():
        admin_online_panel_loop.start()
    if not staffboard_panel_loop.is_running():
        staffboard_panel_loop.start()
    if not leaderstaff_panel_loop.is_running():
        leaderstaff_panel_loop.start()
    if not punishments_hourly_scan_loop.is_running():
        punishments_hourly_scan_loop.start()
    if not punishments_daily_refresh_loop.is_running():
        punishments_daily_refresh_loop.start()
    if not staff_punish_scan_loop.is_running():
        staff_punish_scan_loop.start()
    if not mute_repeat_check_loop.is_running():
        mute_repeat_check_loop.start()
    if not staff_status_refresh_loop.is_running():
        staff_status_refresh_loop.start()
    if not role_sync_loop.is_running():
        role_sync_loop.start()
    if not drops_loop.is_running():
        drops_loop.start()
    if not online_record_loop.is_running():
        online_record_loop.start()
    if not vdf_recheck_loop.is_running():
        vdf_recheck_loop.start()

    # ── Автоподключение в войс-канал (микрофон и наушники выключены) ──
    if VOICE_CHANNEL_ID:
        try:
            vc = bot.get_channel(VOICE_CHANNEL_ID)
            if vc and isinstance(vc, discord.VoiceChannel):
                if not vc.guild.voice_client or vc.guild.voice_client.channel != vc:
                    await vc.connect(self_deaf=True, self_mute=True)
                    _log(f"🔊 Бот вошёл в войс-канал #{vc.name} (self_deaf + self_mute)", discord=False)
                else:
                    _log(f"🔊 Бот уже в войс-канале #{vc.name}", discord=False)
        except Exception as e:
            _log(f"⚠️ Не удалось войти в войс-канал: {e}", discord=False)

    # Запускаем loop reconnect для войса
    if not voice_reconnect_loop.is_running():
        voice_reconnect_loop.start()

    # Запускаем обработку заявок на регистрацию в панели
    if not panel_registration_loop.is_running():
        panel_registration_loop.start()

@tree.error
async def on_tree_error(interaction: discord.Interaction, error):
    if isinstance(error, app_commands.CommandNotFound):
        return  # игнорируем устаревшие slash-команды

@bot.event
async def on_command_error(ctx, error):
    if isinstance(error, commands.CommandNotFound):
        return  # игнорируем неизвестные префикс-команды

# ── Обработка config.vdf ─────────────────────────────────────────────────────
VDF_CHANNEL_ID = _env_int("VDF_CHANNEL_ID", 1501060380422701056)
VOICE_CHANNEL_ID = _env_int("VOICE_CHANNEL_ID", 0)
DM_CHECKER_ENABLED = _env_bool("DM_CHECKER_ENABLED", True)
DM_CHECKER_MODE = (os.getenv("DM_CHECKER_MODE") or "public").strip().lower()
if DM_CHECKER_MODE not in {"off", "whitelist", "public"}:
    DM_CHECKER_MODE = "public"

def _parse_vdf_steamids(text: str) -> list[str]:
    """Вытаскивает SteamID64 из любого .vdf файла (config.vdf, loginusers.vdf и т.д.)."""
    # 1. config.vdf: "SteamID"  "76561..."
    found = re.findall(r'"SteamID"\s+"(7656\d{13})"', text)
    # 2. loginusers.vdf: "76561198000000000" (SteamID как ключ секции)
    if not found:
        found = re.findall(r'"(7656119\d{10})"', text)
    # 3. Фоллбек: любой 7656119 + 10 цифр
    if not found:
        found = re.findall(r'(7656119\d{10})', text)
    return list(dict.fromkeys(found))  # уникальные, сохраняя порядок

_fear_profile_cache: dict = {}
FEAR_PROFILE_CACHE_MAX = 500  # Лимит кэша профилей

# Кэш для быстрых VDF-проверок (SteamID -> (data, timestamp))
_yooma_cache: dict[str, tuple[dict, float]] = {}
YOOMA_CACHE_TTL = 300

_fear_fast_cache: dict[str, tuple[dict | None, float]] = {}
FEAR_FAST_CACHE_TTL = 300

# Семафор: не более 100 VDF проверок одновременно
_vdf_semaphore = asyncio.Semaphore(100)
# Кэш Fear профилей для VDF (чтобы не дёргать API повторно для одних и тех же SteamID)
_vdf_fear_cache: dict = {}
VDF_FEAR_CACHE_MAX = 300  # Лимит VDF кэша
# Callback для уведомления об окончании обновления кэша стаффа
_staff_cache_done_callbacks: list = []
# Уже отправленные уведомления о репортах: intruder_steamid -> frozenset(report_ids)
_reported_notified: dict = {}
# Закрытые тикеты — не уведомлять повторно: set(report_id)
_closed_report_ids: set = set()
# Настройки автозакрытия репортов
AUTOCLOSE_SETTINGS_FILE = Path(__file__).parent / "autoclose_settings.json"
_AUTOCLOSE_DEFAULTS: dict = {
    "enabled":          False,
    "rule_offline":     True,   # закрыть если офлайн
    "skip_banned":      False,  # НЕ закрывать тикеты на уже забаненных
    "rule_kd":          True,   # закрыть если KD < порога
    "kd_threshold":     0.5,    # порог KD
    "rule_age":         True,   # закрыть если тикет висит >= N мин
    "age_min":          15,     # порог времени в минутах
    "result_text":      "Нарушение не подтверждено",
}

def _load_autoclose_settings() -> dict:
    if AUTOCLOSE_SETTINGS_FILE.exists():
        try:
            data = json.loads(AUTOCLOSE_SETTINGS_FILE.read_text(encoding="utf-8"))
            # Миграция: старый rule_banned -> новый skip_banned (инвертированная логика)
            if "rule_banned" in data and "skip_banned" not in data:
                data["skip_banned"] = not data.pop("rule_banned")
            # Мержим с дефолтами на случай если добавились новые ключи
            return {**_AUTOCLOSE_DEFAULTS, **data}
        except Exception:
            pass
    return dict(_AUTOCLOSE_DEFAULTS)

def _save_autoclose_settings():
    _save_json_atomic(AUTOCLOSE_SETTINGS_FILE, _autoclose_settings)

_autoclose_settings: dict = _load_autoclose_settings()

# Настройки автобанов
AUTOBAN_SETTINGS_FILE = Path(__file__).parent / "autoban_settings.json"
_AUTOBAN_DEFAULTS: dict = {
    "yooma_cheat_autoban_enabled": False,  # автобан на Fear за читы на yooma.su (отключён)
}

def _load_autoban_settings() -> dict:
    if AUTOBAN_SETTINGS_FILE.exists():
        try:
            data = json.loads(AUTOBAN_SETTINGS_FILE.read_text(encoding="utf-8"))
            return {**_AUTOBAN_DEFAULTS, **data}
        except Exception:
            pass
    return dict(_AUTOBAN_DEFAULTS)

def _save_autoban_settings():
    _save_json_atomic(AUTOBAN_SETTINGS_FILE, _autoban_settings)

_autoban_settings: dict = _load_autoban_settings()

@tree.command(name="yooma_autoban", description="[УСТАРЕВШАЯ] Автовыдача банов за yooma.su отключена")
@app_commands.describe(mode="Действие")
@app_commands.choices(mode=[
    app_commands.Choice(name="Статус", value="status"),
])
async def cmd_yooma_autoban(interaction: discord.Interaction, mode: str):
    if not _has_owner_access(interaction.user):
        await interaction.response.send_message("❌ Нет доступа к этой команде.", ephemeral=True)
        return

    await interaction.response.send_message(
        "🔴 Автовыдача банов за yooma.su полностью отключена и удалена.",
        ephemeral=True,
    )

def _load_admins_cache() -> list[dict]:
    if ADMINS_CACHE_FILE.exists():
        try:
            return json.loads(ADMINS_CACHE_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return []

def _save_admins_cache(data: list[dict]):
    _save_json_atomic(ADMINS_CACHE_FILE, data)

async def _fetch_admins_list() -> list[dict] | None:
    """Получает список всех админов через fearproject API с cookie."""
    if not FEAR_COOKIE:
        return None
    async with aiohttp.ClientSession() as session:
        try:
            headers = {
                "Cookie": FEAR_COOKIE,
                "Referer": "https://fearproject.ru/",
                "Origin": "https://fearproject.ru",
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "sec-fetch-site": "same-site",
                "sec-fetch-mode": "cors",
                "sec-fetch-dest": "empty"
            }
            async with session.get(f"{API_BASE}/admins/", headers=headers,
                                   timeout=aiohttp.ClientTimeout(total=15)) as r:
                if r.status == 200:
                    return await r.json(content_type=None)
                else:
                    _log(f"⚠️ /admins/ вернул {r.status}")
                    return None
        except Exception as e:
            _log(f"❌ _fetch_admins_list: {e}")
            return None

async def _refresh_admins_and_notify():
    """Обновляет кэш админов и уведомляет о тех у кого нет Discord."""
    admins = await _fetch_admins_list()
    if not admins:
        _log("⚠️ Не удалось получить список админов")
        return

    old_cache = {a["steamid"]: a for a in _load_admins_cache()}
    _save_admins_cache(admins)
    _log(f"✅ Список админов обновлён: {len(admins)} записей")

    # Проверяем Discord у каждого — всех не замороженных, батчами по 10
    active_admins = [a for a in admins if not a.get("is_frozen") and a.get("steamid", "").strip()]
    no_discord = []
    _log(f"🔍 Проверяю Discord у {len(active_admins)} админов...")
    async with aiohttp.ClientSession() as session:
        for i in range(0, len(active_admins), 10):
            batch = active_admins[i:i+10]
            tasks = [_fetch_json(session, f"{API_BASE}/profile/{a['steamid'].strip()}") for a in batch]
            profiles = await asyncio.gather(*tasks)
            for admin, profile in zip(batch, profiles):
                if not profile:
                    continue
                # Сохраняем профиль в PostgreSQL
                try:
                    _db.db_upsert_profile(profile)
                except Exception as e:
                    _log(f"⚠️ [PG] Ошибка upsert profile {admin.get('steamid')}: {e}", discord=False)
                has_discord = bool(profile.get("discordNickname") or profile.get("providerUserId"))
                if not has_discord:
                    no_discord.append(admin)
            await asyncio.sleep(0.1)
            if i % 50 == 0 and i > 0:
                _log(f"  📊 Проверено {i}/{len(active_admins)}...")

    if no_discord:
        channel = bot.get_channel(MODERATOR_ONLY_CHANNEL_ID)
        if channel:
            _log(f"📢 Без Discord: {len(no_discord)} чел.")
            # Разбиваем на embed-ы по 20 человек
            chunk_size = 20
            for chunk_i in range(0, len(no_discord), chunk_size):
                chunk = no_discord[chunk_i:chunk_i + chunk_size]
                lines = []
                for a in chunk:
                    sid = a.get("steamid", "")
                    name = a.get("name", sid)
                    role = a.get("group_display_name", "")
                    lines.append(f"• **{name}** `{role}` — [Fear](https://fearproject.ru/profile/{sid})")
                title = f"⚠️ Без Discord ({len(no_discord)} чел.)"
                if chunk_i > 0:
                    title = f"⚠️ Без Discord (продолжение {chunk_i+1}-{min(chunk_i+chunk_size, len(no_discord))})"
                embed = discord.Embed(
                    title=title,
                    description="\n".join(lines),
                    color=0xf08848,
                    timestamp=datetime.now(timezone.utc)
                )
                await channel.send(embed=embed)



async def _fetch_json_cached(steamid: str) -> dict | None:
    """Читает Fear профиль из кэша или запрашивает API."""
    if steamid in _fear_profile_cache:
        return _fear_profile_cache[steamid]
    async with aiohttp.ClientSession() as session:
        data = await _fetch_json(session, f"{API_BASE}/profile/{steamid}")
        if data:
            _fear_profile_cache[steamid] = data
            # Ограничение памяти: оставляем последние 500
            if len(_fear_profile_cache) > FEAR_PROFILE_CACHE_MAX:
                keys = list(_fear_profile_cache.keys())[:len(_fear_profile_cache) - FEAR_PROFILE_CACHE_MAX]
                for k in keys:
                    _fear_profile_cache.pop(k, None)
        return data

async def _fetch_fear_profile(session: aiohttp.ClientSession, steamid: str, retries: int = 2) -> dict | None:
    """Получает профиль Fear с повторными попытками."""
    for attempt in range(retries):
        try:
            data = await _fetch_json(session, f"{API_BASE}/profile/{steamid}")
            if data:
                return data
        except Exception:
            pass
        if attempt < retries - 1:
            await asyncio.sleep(0.3)
    return None


async def _fetch_fear_fast(session: aiohttp.ClientSession, steamid: str) -> dict | None:
    """Быстрый запрос Fear API для VDF-проверок: таймаут 5с, 1 попытка, кэш 5 минут."""
    now = datetime.now(timezone.utc).timestamp()
    cached = _fear_fast_cache.get(steamid)
    if cached and now - cached[1] < FEAR_FAST_CACHE_TTL:
        return cached[0]

    url = f"{API_BASE}/profile/{steamid}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
    }
    if FEAR_COOKIE:
        headers["Cookie"] = FEAR_COOKIE
    try:
        timeout = aiohttp.ClientTimeout(total=5)
        async with session.get(url, headers=headers, timeout=timeout) as r:
            if r.status == 200:
                data = await r.json(content_type=None)
                _fear_fast_cache[steamid] = (data, now)
                return data
    except Exception:
        pass
    return None

async def _fetch_fear_ban_check(session: aiohttp.ClientSession, steamid: str, retries: int = 2) -> dict | None:
    """Проверяет бан Fear через /bans/check/{steamid} (более надёжно чем banInfo в profile)."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
    }
    if FEAR_COOKIE:
        headers["Cookie"] = FEAR_COOKIE
    for attempt in range(retries):
        try:
            data = await _fetch_json(session, f"{API_BASE}/bans/check/{steamid}", headers=headers, timeout_total=5, max_retries=2)
            if data:
                return data
        except Exception:
            pass
        if attempt < retries - 1:
            await asyncio.sleep(0.3)
    return None

async def _fetch_fear_punishments_by_player(session: aiohttp.ClientSession, steamid: str, retries: int = 2) -> list[dict]:
    """Ищет наказания игрока через /punishments/search?q={steamid}&type=1.
    Это самый надёжный способ узнать, есть ли бан на Fear, т.к. ищет в базе наказаний."""
    if not FEAR_COOKIE:
        return []
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Cookie": FEAR_COOKIE,
        "Referer": "https://fearproject.ru/",
        "Origin": "https://fearproject.ru",
    }
    result = []
    limit = 20
    page = 1
    max_pages = 5
    while page <= max_pages:
        try:
            data = await _fetch_json(session, PUNISH_SEARCH_URL,
                params={"q": steamid, "page": page, "limit": limit, "type": 1},
                headers=headers, timeout_total=5, max_retries=2)
        except Exception:
            break
        if not data or not isinstance(data, dict):
            break
        raw = data.get("punishments") or []
        if not isinstance(raw, list):
            break
        for p in raw:
            if str(p.get("steamid") or "").strip() == str(steamid):
                result.append(p)
        if len(raw) < limit:
            break
        page += 1
    return result

async def _check_vdf_accounts(steamids: list[str]) -> list[dict]:
    """Проверяет аккаунты через Fear, Steam и Yooma API параллельно с ограничением параллелизма."""
    results = []
    async with aiohttp.ClientSession() as session:
        # Steam API — батчами по 100
        bans_tasks = []
        summary_tasks = []
        for i in range(0, len(steamids), 100):
            batch = steamids[i:i+100]
            ids = ','.join(batch)
            bans_tasks.append(_fetch_json(session,
                f"https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key={STEAM_API_KEY}&steamids={ids}"))
            summary_tasks.append(_fetch_json(session,
                f"https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key={STEAM_API_KEY}&steamids={ids}"))

        steam_future = asyncio.gather(
            asyncio.gather(*bans_tasks),
            asyncio.gather(*summary_tasks)
        )

        # Yooma — с семафором 50 и кэшем 5 минут
        yooma_sem = asyncio.Semaphore(50)
        async def yooma_with_sem(sid: str):
            async with yooma_sem:
                return await _check_yooma_ban(session, sid)
        yooma_future = asyncio.gather(*[yooma_with_sem(sid) for sid in steamids])

        # Fear — профиль, /bans/check и поиск наказаний /punishments/search (самый надёжный)
        fear_sem = asyncio.Semaphore(50)
        async def fear_with_sem(sid: str):
            async with fear_sem:
                return await _fetch_fear_fast(session, sid)
        async def fear_ban_with_sem(sid: str):
            async with fear_sem:
                return await _fetch_fear_ban_check(session, sid)
        async def fear_punish_with_sem(sid: str):
            async with fear_sem:
                return await _fetch_fear_punishments_by_player(session, sid)
        fear_future = asyncio.gather(*[fear_with_sem(sid) for sid in steamids])
        fear_ban_future = asyncio.gather(*[fear_ban_with_sem(sid) for sid in steamids])
        fear_punish_future = asyncio.gather(*[fear_punish_with_sem(sid) for sid in steamids])

        # Все источники — параллельно
        (bans_results, summary_results), yooma_results_raw, fear_profiles, fear_ban_checks, fear_punish_checks = await asyncio.gather(
            steam_future, yooma_future, fear_future, fear_ban_future, fear_punish_future
        )

        bans_map = {}
        for data in bans_results:
            if data and "players" in data:
                for p in data["players"]:
                    sid_key = p.get("SteamId") or p.get("SteamID") or p.get("steamid") or p.get("steamID", "")
                    if sid_key:
                        bans_map[str(sid_key)] = p

        summary_map = {}
        for data in summary_results:
            if data and data.get("response", {}).get("players"):
                for p in data["response"]["players"]:
                    summary_map[p["steamid"]] = p

        yooma_map = {sid: ydata for sid, ydata in zip(steamids, yooma_results_raw)}
        fear_map = {sid: profile for sid, profile in zip(steamids, fear_profiles)}
        fear_ban_map = {sid: ban_data for sid, ban_data in zip(steamids, fear_ban_checks)}
        fear_punish_map = {sid: punish_list for sid, punish_list in zip(steamids, fear_punish_checks)}

        def _is_active_ban(p):
            """Считаем бан валидным только если статус активный (1).
            Снятые (2), истёкшие (4) и другие не считаем."""
            st = p.get("status")
            if isinstance(st, int):
                return st == 1
            try:
                return int(st) == 1
            except Exception:
                return False

        def _punishment_reason(p):
            return p.get("reason") or p.get("ban_reason") or p.get("message") or p.get("comment") or p.get("desc") or p.get("punish_reason") or p.get("text") or ""

        def _is_ticket_reason(reason):
            r = str(reason or "").lower()
            compact = re.sub(r"\s+", " ", r).strip()
            no_space = compact.replace(" ", "")
            if "напиши тикет в дс" in compact or "напишитикетвдс" in no_space:
                return True
            if "тикет" in r and "дс" in r:
                return True
            if "ticket" in r and ("дс" in r or "ds" in r or "discord" in r):
                return True
            if "напиши" in r and "дс" in r:
                return True
            return False

        for sid in steamids:
            steam_ban  = bans_map.get(sid, {})
            summary    = summary_map.get(sid, {})
            fear       = fear_map.get(sid)
            fear_ban   = fear_ban_map.get(sid)
            fear_punishments = fear_punish_map.get(sid, [])

            vac_banned    = steam_ban.get("VACBanned", False)
            vac_days      = steam_ban.get("DaysSinceLastBan", 0)
            game_bans     = steam_ban.get("NumberOfGameBans", 0)
            community_ban = steam_ban.get("CommunityBanned", False)
            nickname      = summary.get("personaname", sid)
            yooma_data    = yooma_map.get(sid, {})

            on_fear       = fear is not None
            fear_name     = fear.get("name", "") if fear else ""

            # Самый надёжный источник — /punishments/search?q=steamid&type=1.
            # Если найден активный бан (status=1), доверяем ему.
            valid_bans = [p for p in fear_punishments if _is_active_ban(p)]
            if valid_bans:
                primary = valid_bans[0]
                ban_info = {
                    "isBanned": True,
                    "is_banned": True,
                    "banned": True,
                    "reason": _punishment_reason(primary),
                    "unbanTimestamp": primary.get("expires") or primary.get("expires_at") or primary.get("unban_time") or None,
                    "punishments": valid_bans,
                }
            else:
                # Fallback: /bans/check, затем banInfo из профиля.
                profile_ban_info = fear.get("banInfo", {}) if fear else {}
                check_ban_info   = fear_ban if isinstance(fear_ban, dict) else {}

                if check_ban_info.get("isBanned") or check_ban_info.get("is_banned") or check_ban_info.get("banned"):
                    ban_info = check_ban_info
                elif profile_ban_info.get("isBanned"):
                    ban_info = profile_ban_info
                else:
                    ban_info = {}

            fear_banned   = bool(ban_info.get("isBanned") or ban_info.get("is_banned") or ban_info.get("banned"))
            fear_reason   = ban_info.get("reason", "") if fear_banned else ""
            fear_unban_ts = ban_info.get("unbanTimestamp") if fear_banned else None
            fear_unban    = ""
            if fear_unban_ts:
                try:
                    dt = datetime.fromtimestamp(fear_unban_ts)
                    fear_unban = dt.strftime("%d.%m.%Y %H:%M")
                except Exception:
                    pass

            ag = fear.get("adminGroup") if fear else None
            admin_group = ""
            if isinstance(ag, dict):
                admin_group = ag.get("group_name", "")
            if not admin_group or str(admin_group).isdigit():
                admin_group = (fear or {}).get("rank_name", "") if fear else ""
            if not admin_group or str(admin_group).isdigit():
                admin_group = (fear or {}).get("rank", "") if fear else ""

            results.append({
                "steamid":      sid,
                "nickname":     fear_name or nickname or sid,
                "on_fear":      on_fear,
                "fear_banned":  fear_banned,
                "fear_reason":  fear_reason,
                "fear_unban":   fear_unban,
                "vac_banned":   vac_banned,
                "vac_days":     vac_days,
                "game_bans":    game_bans,
                "community_ban":community_ban,
                "yooma_data":   yooma_data,
                "admin_group":  admin_group,
            })
    return results

async def _check_yooma_ban(session: aiohttp.ClientSession, steamid: str, nickname: str = "") -> dict:
    """
    Проверяет наличие банов на yooma.su для указанного SteamID.
    Использует кэш 5 минут и короткий таймаут, чтобы не тормозить VDF-проверки.
    """
    now = datetime.now(timezone.utc).timestamp()
    cached = _yooma_cache.get(steamid)
    if cached and now - cached[1] < YOOMA_CACHE_TTL:
        return cached[0]

    url = f"https://yooma.su/api/public/read/punishments?punish_type=0&search={steamid}&page=1&mobile=1"
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://yooma.su/ru/punishments",
            "Origin": "https://yooma.su"
        }
        # yooma.su часто висит — используем 5 сек и 1 повтор вместо 15/3
        data = await _fetch_json(session, url, headers=headers, timeout_total=5, max_retries=2)
        if not data or not data.get("ok"):
            result = {"found": False, "punishments": []}
            _yooma_cache[steamid] = (result, now)
            return result

        punishments = data.get("punishments", [])
        if not punishments:
            result = {"found": False, "punishments": []}
            _yooma_cache[steamid] = (result, now)
            return result

        now_ts = datetime.now(timezone.utc).timestamp()
        processed = []
        for p in punishments:
            if str(p.get("steamid", "")).strip() != str(steamid):
                continue

            created_ts  = p.get("created", 0)
            expires_ts  = p.get("expires", 0)
            unpunish_id = p.get("unpunish_admin_id")

            if unpunish_id is not None and unpunish_id != 0:
                status = "unbanned"
            elif expires_ts > 0 and expires_ts < now_ts:
                status = "expired"
            else:
                status = "active"

            created_str = _msk_from_timestamp(created_ts)
            expires_str = _msk_from_timestamp(expires_ts) if expires_ts > 0 else "Навсегда"

            if expires_ts <= 0:
                dur_str = "Навсегда"
            else:
                diff = expires_ts - created_ts
                days = diff // 86400
                if days >= 1:
                    dur_str = f"{int(days)} дн."
                else:
                    hours = diff // 3600
                    dur_str = f"{int(hours)} ч."

            processed.append({
                "id":         p.get("id"),
                "name":       p.get("name", "—"),
                "steamid":    steamid,
                "reason":     p.get("reason", "—"),
                "admin_name": p.get("admin_name", "—"),
                "created":    created_str,
                "expires":    expires_str,
                "duration":   dur_str,
                "status":     status,
                "created_ts": created_ts,
                "expires_ts": expires_ts,
                "profile_url": f"https://yooma.su/ru/profile/{steamid}",
            })

        result = {"found": len(processed) > 0, "punishments": processed}
        _yooma_cache[steamid] = (result, now)
        return result
    except Exception as e:
        _log(f"ℹ️ yooma check {steamid}: {e}", discord=False)
        return {"found": False, "punishments": []}

def _build_yooma_embed(steamid: str, yooma_data: dict, nickname: str = "") -> discord.Embed:
    """Строит embed с результатами проверки yooma.su по скриншоту."""
    profile_url = f"https://yooma.su/ru/profile/{steamid}"
    steam_url   = f"https://steamcommunity.com/profiles/{steamid}"
    fear_url    = f"https://fearproject.ru/profile/{steamid}"
    
    if not yooma_data.get("found"):
        embed = discord.Embed(
            title=f"🟢 {nickname or steamid} — Yooma.su",
            description=f"**Банов не найдено**\n\nSteamID: `{steamid}`\n[Yooma]({profile_url}) • [Steam]({steam_url}) • [Fear]({fear_url})",
            color=0x2ecc71,
            timestamp=datetime.now(timezone.utc)
        )
        return embed

    # Берем самый свежий бан (первый в списке)
    p = yooma_data["punishments"][0]
    is_active = p["status"] == "active"
    
    color = 0xff4747 if is_active else 0x555555
    title = "🔴 Yooma.su — АКТИВНЫЙ БАН" if is_active else "⚪ Yooma.su — Истёкший бан"
    
    embed = discord.Embed(title=title, color=color, timestamp=datetime.now(timezone.utc))
    
    # Формируем поля как на скриншоте
    embed.add_field(name="👤 Ник", value=f"**{p['name']}**", inline=True)
    embed.add_field(name="🆔 SteamID", value=f"`{steamid}`", inline=True)
    embed.add_field(name="📋 Причина", value=p["reason"], inline=True)
    
    embed.add_field(name="📅 Выдан", value=p["created"], inline=True)
    embed.add_field(name="⏳ На сколько", value=p["duration"], inline=True)
    
    links = f"[Yooma]({profile_url}) • [Steam]({steam_url}) • [Fear]({fear_url})"
    embed.add_field(name="🔗 Профиль", value=links, inline=True)
    
    return embed


def _build_vdf_embeds(results: list[dict], filename: str) -> list[discord.Embed]:
    total        = len(results)
    on_fear      = sum(1 for r in results if r["on_fear"])
    not_on_fear  = sum(1 for r in results if not r["on_fear"])
    fear_banned  = sum(1 for r in results if r["fear_banned"])
    vac_count    = sum(1 for r in results if r["vac_banned"])
    yooma_active = sum(
        1 for r in results
        if (r.get("yooma_data") or {}).get("found")
        and (r.get("yooma_data") or {}).get("punishments")
        and (r.get("yooma_data") or {}).get("punishments")[0].get("status") == "active"
    )

    # Сводный embed
    summary = discord.Embed(
        title=f"🔍 Анализ {filename}",
        color=0x5865f2,
        timestamp=datetime.now(timezone.utc)
    )
    summary.add_field(name="📊 Всего аккаунтов",  value=f"**{total}**",       inline=True)
    summary.add_field(name="✅ На Fear",            value=f"**{on_fear}**",     inline=True)
    summary.add_field(name="❌ Не на Fear",         value=f"**{not_on_fear}**", inline=True)
    summary.add_field(name="🔨 Бан на Fear",       value=f"**{fear_banned}**", inline=True)
    summary.add_field(name="🚫 VAC бан",           value=f"**{vac_count}**",   inline=True)
    summary.add_field(name="🔴 Yooma",             value=f"**{yooma_active}**", inline=True)

    embeds = [summary]

    # Сортировка:
    # 1. Забаненные на Fear
    # 2. Зарегистрированные на Fear
    # 3. Не зарегистрированные
    def sort_key(r):
        if r["fear_banned"]: return 0
        if r["on_fear"]: return 1
        return 2

    sorted_results = sorted(results, key=sort_key)

    # Детальный список — компактный вид
    lines = []
    for r in sorted_results:
        sid   = r["steamid"]
        name  = r["nickname"]
        
        status_parts = []
        
        # ── Статус Fear ──
        if not r["on_fear"]:
            status_parts.append("❌ Fear: не зарег.")
        elif r["fear_banned"]:
            ban_info = f"🔨 Fear: бан — {r['fear_reason'] or 'без причины'}"
            if r["fear_unban"]:
                ban_info += f" до {r['fear_unban']}"
            status_parts.append(ban_info)
        else:
            status_parts.append("✅ Fear: зарег.")

        # ── Steam VAC / Game ──
        if r["vac_banned"]:
            status_parts.append(f"🚫 VAC: {r['vac_days']} дн. назад")
        if r["community_ban"]:
            status_parts.append("⛔ Comm: бан")

        ydata = r.get("yooma_data") or {}
        if ydata.get("found") and ydata.get("punishments"):
            p = ydata["punishments"][0]
            reason = (p.get("reason") or "—").replace("\n", " ").strip()
            if len(reason) > 45:
                reason = reason[:45] + "…"
            if p.get("status") == "active":
                status_parts.append(f"🔴 Yooma: {reason}")
            else:
                status_parts.append(f"⚪ Yooma: {reason}")
        else:
            status_parts.append("🟢 Yooma")

        fear_url  = f"https://fearproject.ru/profile/{sid}"
        steam_url = f"https://steamcommunity.com/profiles/{sid}"

        role_tag = f" [{r['admin_group']}]" if r.get("admin_group") else ""
        line = (
            f"**[{name}]({fear_url})**{role_tag} `{sid}`\n"
            f"{' • '.join(status_parts)} • [Steam]({steam_url})"
        )
        lines.append(line)

    # Разбиваем на embed-ы (лимит 4096 символов, но берем с запасом)
    current = ""
    num = 1
    for line in lines:
        if len(current) + len(line) + 2 > 3500:
            e = discord.Embed(
                title=f"📋 Аккаунты (часть {num})" if num > 1 else "📋 Аккаунты",
                description=current.strip(),
                color=0x2b2d31
            )
            embeds.append(e)
            current = line + "\n\n"
            num += 1
        else:
            current += line + "\n\n"
    
    if current:
        e = discord.Embed(
            title=f"📋 Аккаунты (часть {num})" if num > 1 else "📋 Аккаунты",
            description=current.strip(),
            color=0x2b2d31
        )
        embeds.append(e)

    # View с кнопкой yooma
    return embeds

@bot.event
async def on_message(message: discord.Message):
    if message.author.bot:
        return

    # Глобальная блокировка доступа
    if hasattr(message.author, "roles"):
        # Если нет ролей (кроме @everyone) или есть роль ROLE_UNDEFINED_ID
        if len(message.author.roles) <= 1 or any(r.id == ROLE_UNDEFINED_ID for r in message.author.roles):
            return

    await bot.process_commands(message)

    is_dm = isinstance(message.channel, discord.DMChannel)
    is_vdf_channel = (not is_dm) and message.channel.id == VDF_CHANNEL_ID

    if not is_dm and not is_vdf_channel:
        return

    # Если DM чекер выключен — игнорируем DM
    if is_dm and not DM_CHECKER_ENABLED:
        return
    # Собираем вложения
    attachments = list(message.attachments)
    if not attachments and message.reference and not is_dm:
        try:
            ref_msg = message.reference.resolved
            if ref_msg is None:
                ref_msg = await message.channel.fetch_message(message.reference.message_id)
            if hasattr(ref_msg, "attachments"):
                attachments.extend(ref_msg.attachments)
        except discord.NotFound:
            await message.reply(
                "⚠️ Не могу прочитать пересланный файл из личных сообщений.\n"
                "Скинь файл **напрямую** в этот канал.",
                mention_author=False
            )
            return
        except Exception as ex:
            _log(f"⚠️ reference fetch error: {ex}")

    for attachment in attachments:
        if not attachment.filename.lower().endswith(".vdf"):
            continue

        if not _has_checker_access(message.author):
            await message.reply(
                "❌ У тебя нет доступа к чекеру. Требуется роль Администратора или выше.",
                mention_author=False
            )
            return

        # Если все слоты заняты — предупреждаем пользователя
        try:
            slot_check = _vdf_semaphore._value
        except (AttributeError, TypeError):
            slot_check = 1
        if slot_check == 0:
            msg = await message.reply(
                "⏳ Сейчас идут другие проверки, твой запрос в очереди...",
                mention_author=False
            )
        else:
            msg = await message.reply("🔍 Читаю файл...", mention_author=False)

        async with _vdf_semaphore:
            try:
                await msg.edit(content="🔍 Читаю файл...")
                # Retry скачивания с CDN Discord (иногда бывают таймауты)
                content = None
                for attempt in range(1, 4):
                    try:
                        content = await asyncio.wait_for(attachment.read(), timeout=30.0)
                        break
                    except asyncio.TimeoutError:
                        if attempt == 3:
                            raise
                        await asyncio.sleep(2.0)
                if content is None:
                    raise asyncio.TimeoutError("Не удалось скачать файл после 3 попыток")
                text     = content.decode("utf-8", errors="ignore")
                steamids = _parse_vdf_steamids(text)

                if not steamids:
                    await msg.edit(content="❌ SteamID не найдены в файле.")
                    return

                await msg.edit(content=f"🔍 Найдено **{len(steamids)}** аккаунтов, начинаю проверку...")

                results = await _check_vdf_accounts(steamids)

                check_num = _save_vdf_check(results, attachment.filename, attachment.url, message.jump_url, vdf_text=text)
                embeds = _build_vdf_embeds(results, attachment.filename)
                await msg.edit(content=f"✅ Проверено **{len(steamids)}** аккаунтов • Проверка **#{check_num}**\nℹ️ Используй `/checkinfo #{check_num}` или `/checkinfo <steamid>` для подробной информации", embed=embeds[0])
                for e in embeds[1:]:
                    await message.channel.send(embed=e)
                _log(f"🔍 #{check_num} {attachment.filename} от {message.author}: {len(steamids)} аккаунтов")
            except Exception as ex:
                _log(f"❌ vdf ошибка: {ex}\n{traceback.format_exc()}")
                err_text = str(ex)
                if "Timeout" in err_text or "таймаут" in err_text.lower() or " semaphore" in err_text:
                    err_text = "Не удалось скачать файл (Discord CDN недоступен). Попробуйте ещё раз через минуту."
                await msg.edit(content=f"❌ Ошибка: {err_text}")


# ── Система отслеживания игроков ──────────────────────────────────────────────

@tree.command(name="trackadd", description="Добавить игрока в отслеживание (уведомления придут в ЛС)")
@app_commands.describe(
    steamid="SteamID игрока",
    name="Имя для удобства (необязательно)"
)
async def cmd_trackadd(interaction: discord.Interaction, steamid: str, name: str = ""):
    await interaction.response.defer(ephemeral=True)

    steamid = steamid.strip()
    
    # Инициализируем структуру если нужно
    if steamid not in _tracked_players:
        _tracked_players[steamid] = {
            "name": name or steamid,
            "watchers": {} # discord_id -> name
        }
    
    # Добавляем текущего пользователя в список наблюдателей
    user_id_str = str(interaction.user.id)
    _tracked_players[steamid]["watchers"][user_id_str] = str(interaction.user)
    
    # Если имя не было задано, пробуем обновить
    if not name and _tracked_players[steamid]["name"] == steamid:
        profile = await _fetch_json_cached(steamid)
        if profile and profile.get("name"):
            _tracked_players[steamid]["name"] = profile["name"]

    _save_tracked()

    embed = discord.Embed(
        title="👁 Игрок добавлен в ВАШ список отслеживания",
        description=f"Бот будет присылать уведомления о входе игрока **вам в личные сообщения**.",
        color=0x5865f2,
        timestamp=datetime.now(timezone.utc)
    )
    embed.add_field(name="Игрок", value=f"**{_tracked_players[steamid]['name']}**\n`{steamid}`", inline=True)
    await interaction.followup.send(embed=embed, ephemeral=True)
    _log(f"👁 {interaction.user} добавил в отслеживание: {steamid}")

@tree.command(name="trackremove", description="Убрать игрока из ВАШЕГО списка отслеживания")
@app_commands.describe(steamid="SteamID игрока")
async def cmd_trackremove(interaction: discord.Interaction, steamid: str):
    steamid = steamid.strip()
    user_id_str = str(interaction.user.id)
    
    if steamid not in _tracked_players or user_id_str not in _tracked_players[steamid].get("watchers", {}):
        return await interaction.response.send_message(
            f"❌ Игрок `{steamid}` не найден в вашем списке отслеживания.", ephemeral=True
        )

    # Убираем только этого пользователя
    _tracked_players[steamid]["watchers"].pop(user_id_str)
    
    # Если наблюдателей больше нет, удаляем игрока совсем
    if not _tracked_players[steamid]["watchers"]:
        _tracked_players.pop(steamid)
        
    _save_tracked()
    await interaction.response.send_message(
        f"✅ Игрок `{steamid}` убран из вашего списка отслеживания.", ephemeral=True
    )

@tree.command(name="tracklist", description="Показать список игроков, которых отслеживаете ВЫ")
async def cmd_tracklist(interaction: discord.Interaction):
    user_id_str = str(interaction.user.id)
    my_list = []
    
    for sid, data in _tracked_players.items():
        if user_id_str in data.get("watchers", {}):
            my_list.append(f"• **{data['name']}** (`{sid}`)")
            
    if not my_list:
        return await interaction.response.send_message("ℹ️ Ваш список отслеживания пуст.", ephemeral=True)

    embed = discord.Embed(
        title="👁 Ваши отслеживаемые игроки",
        description="\n".join(my_list),
        color=0x5865f2
    )
    await interaction.response.send_message(embed=embed, ephemeral=True)
    for steamid, entry in _tracked_players.items():
        last = entry.get("last_seen", {})
        status = "🟢 Онлайн" if last.get("online") else "⚫ Офлайн"
        server = last.get("server_name", "—")
        nick   = last.get("nickname", entry["name"])
        if entry.get("dm"):
            ch = f"💬 ЛС → {entry.get('added_by', '?')}"
        else:
            ch = f"<#{entry['channel_id']}>"
        embed.add_field(
            name=f"{nick}",
            value=(
                f"SteamID: `{steamid}`\n"
                f"Статус: {status}  |  Сервер: {server}\n"
                f"Уведомления: {ch}\n"
                f"[Fear](https://fearproject.ru/profile/{steamid}) • [Steam](https://steamcommunity.com/profiles/{steamid})"
            ),
            inline=False
        )
    await interaction.response.send_message(embed=embed, ephemeral=True)


@tasks.loop(seconds=15)
async def track_loop():
    """Мониторинг отслеживаемых игроков каждые 30 секунд."""
    if not _tracked_players:
        return

    async with aiohttp.ClientSession() as session:
        servers = await _fetch_json(session, f"{API_BASE}/servers")
        if not servers:
            return

        # Строим карту: steamid -> {player, server}
        online_map: dict[str, dict] = {}
        for srv in servers:
            for player in srv.get("live_data", {}).get("players", []):
                sid = str(player.get("steam_id", ""))
                if sid:
                    online_map[sid] = {"player": player, "server": srv}

        now_str = _msk_str(datetime.now(timezone.utc), "%d.%m.%Y %H:%M:%S")

        for steamid, entry in list(_tracked_players.items()):
            watchers = entry.get("watchers", {})
            if not watchers:
                continue

            last      = entry.get("last_seen", {})
            was_online = last.get("online", False)
            info       = online_map.get(steamid)
            is_online  = info is not None

            events = []
            if is_online:
                player     = info["player"]
                srv        = info["server"]
                cur_nick   = player.get("nickname", steamid)
                cur_server = srv.get("site_name") or srv.get("name") or f"{srv.get('ip')}:{srv.get('port')}"
                cur_ip_port = f"{srv.get('ip')}:{srv.get('port')}"

                # Зашёл онлайн
                if not was_online:
                    events.append(("🟢 Зашёл на сервер", f"**{cur_server}**\n`connect {cur_ip_port}`", 0x2ecc71))
                    _log(f"👁 [{entry['name']}] зашёл → {cur_server}")

                # Сменил ник
                prev_nick = last.get("nickname")
                if prev_nick and prev_nick != cur_nick:
                    events.append(("✏️ Сменил ник", f"`{prev_nick}` → `{cur_nick}`", 0xf39c12))

                # Сменил сервер
                prev_server = last.get("server_name")
                if was_online and prev_server and prev_server != cur_server:
                    events.append(("🔄 Перешёл на сервер", f"`{prev_server}` → **{cur_server}**\n`connect {cur_ip_port}`", 0x3498db))

                # Обновляем last_seen
                entry["last_seen"] = {
                    "online":      True,
                    "nickname":    cur_nick,
                    "server_name": cur_server,
                    "ip_port":     cur_ip_port,
                    "updated":     now_str
                }
            else:
                # Вышел офлайн
                if was_online:
                    prev_server = last.get("server_name", "—")
                    events.append(("⚫ Вышел офлайн", f"Был на сервере: **{prev_server}**", 0x95a5a6))
                    _log(f"👁 [{entry['name']}] вышел офлайн")

                entry["last_seen"] = {
                    "online":      False,
                    "nickname":    last.get("nickname", entry["name"]),
                    "server_name": last.get("server_name", "—"),
                    "updated":     now_str
                }

            # Отправляем события ВСЕМ наблюдателям в ЛС
            if events:
                for title, desc, color in events:
                    embed = discord.Embed(
                        title=f"👁 {entry['name']} — {title}",
                        description=desc,
                        color=color,
                        timestamp=datetime.now(timezone.utc)
                    )
                    embed.add_field(name="SteamID", value=f"`{steamid}`", inline=True)
                    embed.add_field(
                        name="Ссылки",
                        value=f"[Профиль Fear](https://fearproject.ru/profile/{steamid}) • [Steam](https://steamcommunity.com/profiles/{steamid})",
                        inline=False
                    )
                    
                    for uid_str in list(watchers.keys()):
                        try:
                            user = bot.get_user(int(uid_str)) or await bot.fetch_user(int(uid_str))
                            if user:
                                await user.send(embed=embed)
                        except: pass
        
        _save_tracked()


@track_loop.before_loop
async def before_track():
    await bot.wait_until_ready()



@tree.command(name="avg_online", description="Средний онлайн на сервере за день")
@app_commands.describe(date="Дата: 17.06.2026, 2026-06-17 или без параметра (сегодня)")
async def cmd_avg_online(interaction: discord.Interaction, date: str = None):
    """Показывает средний, пиковый онлайн и кол-во записей за день."""
    await interaction.response.defer(ephemeral=True)

    date_normalized = _parse_date(date)

    data = _calc_avg_online(date_normalized)

    if data["samples"] == 0:
        return await interaction.edit_original_response(
            content=f"📊 Нет данных за **{date_normalized}**. Данные записываются каждые 5 минут."
        )

    embed = discord.Embed(
        title=f"📊 Средний онлайн — {date_normalized}",
        color=0x3498db,
        timestamp=datetime.now(timezone.utc)
    )
    embed.add_field(name="📈 Средний", value=f"**{data['avg']}** игроков", inline=True)
    embed.add_field(name="🔝 Пик", value=f"**{data['peak']}** игроков", inline=True)
    embed.add_field(name="⏰ Пиковый час", value=data["peak_hour"], inline=True)
    embed.add_field(name="📝 Замеров", value=f"**{data['samples']}**", inline=True)
    embed.add_field(name="🕐 Часов", value=f"**{data['hours_tracked']}**", inline=True)

    await interaction.edit_original_response(embed=embed)


@tree.command(name="mystats", description="Посмотреть свою статистику наказаний")
async def cmd_mystats(interaction: discord.Interaction):
    """Показывает статистику текущего пользователя (по Discord ID)."""
    await interaction.response.defer(ephemeral=True)

    # Ищем себя в базе стаффа
    db_entry = _get_staff_by_discord(str(interaction.user.id))

    if not db_entry:
        # Ищем в полном списке админов (не только стафф)
        all_admins = _load_admins_cache()
        admin_entry = next((a for a in all_admins if str(a.get("discord_id")) == str(interaction.user.id)), None)
        if admin_entry:
            db_entry = {
                "steamid": admin_entry.get("steamid"),
                "name": admin_entry.get("name", admin_entry.get("nickname", "Админ")),
                "group_name": admin_entry.get("group_name", "ADMIN")
            }

    if not db_entry:
        # Пробуем обновить базу
        await interaction.edit_original_response(
            content="🔍 Тебя нет в базе стаффа. Обновляю списки..."
        )
        result = await _sync_staff_list()
        await _sync_discord_data()
        db_entry = _get_staff_by_discord(str(interaction.user.id))

        # Снова проверяем в полном списке админов после синхронизации
        if not db_entry:
            all_admins = _load_admins_cache()
            admin_entry = next((a for a in all_admins if str(a.get("discord_id")) == str(interaction.user.id)), None)
            if admin_entry:
                db_entry = {
                    "steamid": admin_entry.get("steamid"),
                    "name": admin_entry.get("name", admin_entry.get("nickname", "Админ")),
                    "group_name": admin_entry.get("group_name", "ADMIN")
                }

        if not db_entry:
            return await interaction.edit_original_response(
                content="❌ Ты не найден в списке стаффа Fear Project. "
                        "Убедись что твой Discord привязан к аккаунту на сайте."
            )

    steamid = db_entry["steamid"]
    name = db_entry.get("name", steamid)

    # Обновляем кэш
    await interaction.edit_original_response(content=f"⏳ Загружаю данные для **{name}**...")

    entry = {"steamid": steamid, "name": name}
    async with aiohttp.ClientSession() as session:
        ok = await _update_cache_for_staff(session, entry)

    if not ok:
        data = _load_cache(steamid)
        if not data:
            return await interaction.edit_original_response(
                content=f"❌ Не удалось получить данные. Проверь SteamID: `{steamid}`"
            )

    # Показываем стату
    now = datetime.now(tz=timezone.utc)
    view = StatsView(steamid, mode="month", year=now.year, month=now.month)
    df, dt = view._get_period()
    embed = _build_stats_embed(steamid, df, dt)

    if not embed:
        return await interaction.edit_original_response(content="❌ Не удалось построить статистику.")

    await interaction.edit_original_response(content=None, embed=embed, view=view)


# ── Лидерборд Топ-1000 ────────────────────────────────────────────────────────

LEADERBOARD_PANELS_FILE = Path(__file__).parent / "leaderboard_panels.json"
LEADERBOARD_CACHE_FILE  = Path(__file__).parent / "leaderboard_cache.json"

def _load_leaderboard_panels():
    if not LEADERBOARD_PANELS_FILE.exists(): return {}
    try: return json.loads(LEADERBOARD_PANELS_FILE.read_text(encoding="utf-8"))
    except: return {}

def _save_leaderboard_panels(data):
    _save_json_atomic(LEADERBOARD_PANELS_FILE, data)

def _load_leaderboard_cache():
    global _cached_leaderboard_data, _cached_top1000_ids
    if LEADERBOARD_CACHE_FILE.exists():
        try:
            _cached_leaderboard_data = json.loads(LEADERBOARD_CACHE_FILE.read_text(encoding="utf-8"))
            _cached_top1000_ids = {str(p.get("steamid", "")).strip() for p in _cached_leaderboard_data if p.get("steamid")}
            _log(f"✅ [LB] Кэш топ-1000 загружен: {len(_cached_leaderboard_data)} игроков", discord=False)
        except Exception as e:
            _log(f"⚠️ [LB] Ошибка загрузки кэша топ-1000: {e}", discord=False)

def _save_leaderboard_cache():
    _save_json_atomic(LEADERBOARD_CACHE_FILE, _cached_leaderboard_data)

_cached_leaderboard_data = [] # Список всех 1000 игроков
_cached_top1000_ids = set()   # set для быстрого поиска в мониторинге
_cached_online_players = {}   # steamid -> {server_name, connect_url}

@tasks.loop(minutes=5)
async def leaderboard_sync_loop():
    """Фоновое обновление данных о топ-1000 игроках раз в 5 минут."""
    global _cached_leaderboard_data
    _log("🔄 [LB] Начало полной синхронизации топ-1000...", discord=False)
    
    try:
        headers = await _fear_headers()
        async with aiohttp.ClientSession() as session:
            new_top = []
            sem = asyncio.Semaphore(20)
            
            async def fetch_lb_page(p):
                async with sem:
                    url = f"{API_BASE}/leaderboard"
                    params = {"page": p, "limit": 10}
                    res = await _fetch_json(session, url, params=params, headers=headers)
                    if res and isinstance(res, dict):
                        data = res.get("players") or res.get("leaderboard") or []
                        if data:
                            _log(f"✅ [LB] Страница {p} загружена ({len(data)} чел.)", discord=False)
                        return data
                    return []

            tasks_lb = [fetch_lb_page(p) for p in range(1, 101)]
            results = await asyncio.gather(*tasks_lb)
            for r in results: 
                new_top.extend(r)
            
            if len(new_top) > 0:
                try:
                    new_top.sort(key=lambda x: int(x.get("position", 9999)))
                except:
                    pass
                _cached_leaderboard_data = new_top
                _cached_top1000_ids = {str(p.get("steamid", "")).strip() for p in new_top if p.get("steamid")}
                _save_leaderboard_cache()
                _log(f"🏆 [LB] Топ-1000 успешно обновлен: {len(_cached_leaderboard_data)} игроков", discord=False)
            else:
                _log("⚠️ [LB] Не удалось получить данные от API, используем кэш", discord=False)
                if not _cached_leaderboard_data:
                    _load_leaderboard_cache()

    except Exception as e:
        _log(f"❌ [LB] Ошибка синхронизации: {e}", discord=False)

@tasks.loop(seconds=30)
async def leaderboard_online_update_loop():
    """Обновление онлайна и панелей в Discord каждые 30 секунд."""
    global _cached_online_players
    _log("🔄 [LB] Обновление статусов онлайна...", discord=False)
    
    try:
        headers = await _fear_headers()
        async with aiohttp.ClientSession() as session:
            # 1. Получаем свежий онлайн со всех серверов
            new_online = {}
            servers = await _fetch_json(session, f"{API_BASE}/servers", headers=headers)
            if servers:
                for srv in servers:
                    srv_name = srv.get("name") or srv.get("site_name") or "Unknown"
                    ip = srv.get("ip", "")
                    port = srv.get("port", "")
                    conn = f"connect {ip}:{port}" if ip and port else "—"
                    
                    players = srv.get("live_data", {}).get("players", [])
                    for p in players:
                        sid = str(p.get("steam_id") or p.get("steamid") or "").strip()
                        if sid:
                            new_online[sid] = {"server": srv_name, "connect": conn}
            
            _cached_online_players = new_online
            # _log(f"📊 [LB] Игроков онлайн всего: {len(_cached_online_players)}", discord=False)

            # Проверяем, кто из ТОП-1000 сейчас онлайн (для отладки в консоль)
            online_top_ids = [sid for sid in new_online if sid in _cached_top1000_ids]
            online_top_count = len(online_top_ids)
            
            if online_top_count > 0:
                # Ограничиваем параллельные запросы чтобы не тормозить
                sem_lb = asyncio.Semaphore(15)
                async def _fetch_with_sem(sid):
                    async with sem_lb:
                        return await _get_profile(session, sid)
                
                await asyncio.gather(*[_fetch_with_sem(sid) for sid in online_top_ids])

                for sid in online_top_ids:
                    # Находим ник для лога
                    p_name = next((p.get("name") for p in _cached_leaderboard_data if str(p.get("steamid")).strip() == sid), "Unknown")
                    _log(f"🎯 [LB] Игрок из ТОП-1000 онлайн: {p_name} ({sid}) на {new_online[sid]['server']}", discord=False)
                
                _log(f"📈 [LB] Игроков из ТОП-1000 онлайн: {online_top_count}", discord=False)

            # 2. Обновляем существующие панели в Discord
            panels = _load_leaderboard_panels()
            if not panels: return

            for msg_key, info in list(panels.items()):
                channel = bot.get_channel(info["channel_id"])
                if not channel:
                    try: 
                        channel = await asyncio.wait_for(bot.fetch_channel(info["channel_id"]), timeout=5.0)
                    except: continue
                
                try:
                    msg = await asyncio.wait_for(channel.fetch_message(info["message_id"]), timeout=5.0)
                    view = LeaderboardView(info["page"])
                    embed = _build_leaderboard_embed(info["page"])
                    await asyncio.wait_for(msg.edit(embed=embed, view=view), timeout=5.0)
                except discord.NotFound:
                    # Попробуем найти в истории если ID потерялся
                    msg = await _find_panel_in_history(channel, "🏆 Топ-1000 игроков онлайн", limit=200)
                    if msg:
                        info["message_id"] = msg.id
                        new_key = str(msg.id)
                        if new_key != msg_key:
                            del panels[msg_key]
                        panels[new_key] = info
                        # Сразу обновим его
                        view = LeaderboardView(info["page"])
                        embed = _build_leaderboard_embed(info["page"])
                        await asyncio.wait_for(msg.edit(embed=embed, view=view), timeout=5.0)
                    else:
                        await _purge_bot_messages(channel, limit=200)
                        view = LeaderboardView(info["page"])
                        embed = _build_leaderboard_embed(info["page"])
                        new_msg = await channel.send(embed=embed, view=view)
                        new_info = dict(info)
                        new_info["message_id"] = new_msg.id
                        del panels[msg_key]
                        panels[str(new_msg.id)] = new_info
                except Exception as e:
                    # Ошибка сети или таймаут — пропускаем это сообщение в текущем цикле
                    print(f"[WARN] Ошибка обновления панели {msg_key}: {e}")
                    pass
            
            _save_leaderboard_panels(panels)

    except Exception as e:
        _log(f"❌ [LB] Ошибка обновления онлайна: {e}", discord=False)

@leaderboard_sync_loop.before_loop
@leaderboard_online_update_loop.before_loop
async def before_leaderboard_loops():
    await bot.wait_until_ready()
    if not _cached_leaderboard_data:
        _load_leaderboard_cache()

@tree.command(name="lbsync", description="Принудительно синхронизировать топ-1000 лидеров")
async def cmd_lbsync(interaction: discord.Interaction):
    if getattr(interaction.user, "id", None) != BOT_OWNER_ID:
        return await interaction.response.send_message("Только владелец бота.", ephemeral=True)
    
    await interaction.response.defer(ephemeral=True)
    _log(f"🔄 Ручной запуск синхронизации топа (/lbsync) от {interaction.user}")
    
    if leaderboard_sync_loop.is_running():
        leaderboard_sync_loop.restart()
    else:
        leaderboard_sync_loop.start()
        
    await interaction.edit_original_response(content="🔄 Синхронизация топа запущена. Следите за консолью.")

def _build_leaderboard_embed(page: int) -> discord.Embed:
    # Фильтруем только тех, кто онлайн (обязательно strip() для сопоставления)
    online_players = [
        p for p in _cached_leaderboard_data 
        if str(p.get("steamid", "")).strip() in _cached_online_players
    ]
    
    _log(f"DEBUG [LB] Найдено {len(online_players)} игроков онлайн для эмбеда (всего в кэше: {len(_cached_leaderboard_data)})", discord=False)

    total_pages = max(1, (len(online_players) + 9) // 10)
    if page < 1:
        page = 1
    elif page > total_pages:
        page = total_pages
    
    start = (page - 1) * 10
    end = start + 10
    players = online_players[start:end]
    
    embed = discord.Embed(
        title=f"🏆 Топ-1000 игроков онлайн (Стр. {page})",
        color=0x2ecc71, # Зеленый цвет для онлайна
        timestamp=datetime.now(timezone.utc)
    )
    
    if not _cached_leaderboard_data:
        embed.description = "⌛ Данные загружаются, пожалуйста подождите..."
        embed.color = 0xf1c40f
        return embed

    if not online_players:
        embed.description = "🔴 Сейчас никто из Топ-1000 не играет на серверах."
        embed.color = 0xe74c3c
        return embed

    for p in players:
        sid = str(p.get("steamid", "")).strip()
        # Пытаемся взять полные данные из кэша профилей (там всегда есть группа и фейсит)
        full_data = _profile_cache.get(sid) or p
        
        pos = full_data.get("position", p.get("position", "—"))
        # Приоритет имени из профиля, так как в списке 1000 оно может быть старым
        name = full_data.get("name") or p.get("name", "Unknown")
        val = full_data.get("value", p.get("value", 0))
        
        # Faceit Level
        fl = full_data.get("faceitLevel")
        f_lvl = fl.get("level") if isinstance(fl, dict) else None
        f_str = f"**{f_lvl} LVL**" if f_lvl is not None else "—"
        
        # Группа
        ag = full_data.get("adminGroup")
        group = "Игрок"
        
        # Ищем текстовое название группы, игнорируя цифры (ID)
        cand = None
        if isinstance(ag, dict):
            cand = ag.get("group_name")
        
        if not cand or str(cand).isdigit():
            cand = full_data.get("rank_name")
        
        if not cand or str(cand).isdigit():
            cand = full_data.get("rank")
            
        # Если нашли текст - пишем его, если только цифры или ничего - "Игрок"
        if cand and not str(cand).isdigit():
            group = cand
        else:
            group = "Игрок"
        
        status_info = _cached_online_players.get(sid)
        # Здесь status_info точно есть, так как мы отфильтровали список
        status_str = f"🟢 **Онлайн**: {status_info['server']}\n`{status_info['connect']}`"
            
        embed.add_field(
            name=f"#{pos} {name}",
            value=(
                f"**[{name}](https://fearproject.ru/profile/{sid})**\n"
                f"SteamID: `{sid}`\n"
                f"Faceit: {f_str} | Группа: **{group}**\n"
                f"Очки: **{val}**\n"
                f"{status_str}"
            ),
            inline=False
        )
    
    embed.set_footer(text=f"Показано: {len(online_players)} из 1000 • Страница {page}/{max(1, total_pages)}")
    return embed

class LeaderboardView(discord.ui.View):
    def __init__(self, current_page: int = 1):
        super().__init__(timeout=None)
        self.current_page = current_page

    @discord.ui.button(label="⬅️", style=discord.ButtonStyle.gray, custom_id="lb_prev")
    async def prev_page(self, interaction: discord.Interaction, button: discord.ui.Button):
        # Получаем актуальную страницу из конфига для этого сообщения
        panels = _load_leaderboard_panels()
        msg_key = str(interaction.message.id)
        if msg_key in panels:
            self.current_page = panels[msg_key]["page"]

        total_pages = max(1, (len([p for p in _cached_leaderboard_data if str(p.get("steamid", "")).strip() in _cached_online_players]) + 9) // 10)
        if self.current_page < 1:
            self.current_page = 1
        elif self.current_page > total_pages:
            self.current_page = total_pages
        if self.current_page <= 1:
            return await interaction.response.send_message("Это первая страница.", ephemeral=True)
        self.current_page -= 1
        await self._update(interaction)

    @discord.ui.button(label="➡️", style=discord.ButtonStyle.gray, custom_id="lb_next")
    async def next_page(self, interaction: discord.Interaction, button: discord.ui.Button):
        # Получаем актуальную страницу из конфига для этого сообщения
        panels = _load_leaderboard_panels()
        msg_key = str(interaction.message.id)
        if msg_key in panels:
            self.current_page = panels[msg_key]["page"]

        total_pages = max(1, (len([p for p in _cached_leaderboard_data if str(p.get("steamid", "")).strip() in _cached_online_players]) + 9) // 10)
        if self.current_page < 1:
            self.current_page = 1
        elif self.current_page > total_pages:
            self.current_page = total_pages
        if self.current_page >= total_pages:
            return await interaction.response.send_message("Это последняя страница.", ephemeral=True)
        self.current_page += 1
        await self._update(interaction)

    async def _update(self, interaction: discord.Interaction):
        try:
            panels = _load_leaderboard_panels()
            msg_key = str(interaction.message.id)
            total_pages = max(1, (len([p for p in _cached_leaderboard_data if str(p.get("steamid", "")).strip() in _cached_online_players]) + 9) // 10)
            if self.current_page < 1:
                self.current_page = 1
            elif self.current_page > total_pages:
                self.current_page = total_pages
            if msg_key in panels:
                panels[msg_key]["page"] = self.current_page
                _save_leaderboard_panels(panels)
                
            embed = _build_leaderboard_embed(self.current_page)
            # Добавляем таймаут на редактирование сообщения
            await asyncio.wait_for(interaction.response.edit_message(embed=embed, view=self), timeout=5.0)
        except Exception as e:
            print(f"[WARN] Ошибка обновления панели лидерборда: {e}")
            # Пытаемся отправить сообщение об ошибке пользователю, если это возможно
            try:
                if not interaction.response.is_done():
                    await interaction.response.send_message("⚠️ Произошла ошибка при обновлении страницы. Попробуйте еще раз через несколько секунд.", ephemeral=True)
            except:
                pass

@tree.command(name="leaderboard_panel", description="Создать панель топ-1000 игроков (обновляемую)")
async def cmd_leaderboard_panel(interaction: discord.Interaction):
    if not _is_admin(interaction):
        return await interaction.response.send_message("Нет прав.", ephemeral=True)
    
    await interaction.response.send_message("⏳ Создаю панель топа...", ephemeral=True)
    
    embed = _build_leaderboard_embed(1)
    view = LeaderboardView(1)
    msg = await interaction.channel.send(embed=embed, view=view)
    
    panels = _load_leaderboard_panels()
    panels[str(msg.id)] = {
        "message_id": msg.id,
        "channel_id": interaction.channel_id,
        "page": 1
    }
    _save_leaderboard_panels(panels)


# ── Система дропов Fear Project ──────────────────────────────────────────────

DROPS_FILE = Path(__file__).parent / "drops_log.json"
DROPS_API = f"{API_BASE}/drops/feed"
_drops_log: dict = {}  # {drop_id: {...}}
_drops_known_ids: set = set()
DROPS_MAX_IN_MEMORY = 5000  # Лимит памяти для дропов

def _load_drops():
    global _drops_log, _drops_known_ids
    if DROPS_FILE.exists():
        try:
            _drops_log = json.loads(DROPS_FILE.read_text(encoding="utf-8"))
            _drops_known_ids = set(_drops_log.keys())
        except Exception:
            _drops_log = {}
            _drops_known_ids = set()
    # Также загружаем из БД, чтобы не терять записи после рестарта (только последние 5000)
    try:
        db_rows = db.db_get_drops(since_ts=0, limit=DROPS_MAX_IN_MEMORY)
        for row in db_rows:
            did = str(row.get("id", ""))
            if did:
                _drops_log[did] = row
                _drops_known_ids.add(did)
        # Обрезаем до лимита
        if len(_drops_log) > DROPS_MAX_IN_MEMORY:
            sorted_keys = sorted(_drops_log.keys(), key=lambda k: _drops_log[k].get("created_at", ""))[-DROPS_MAX_IN_MEMORY:]
            _drops_log = {k: _drops_log[k] for k in sorted_keys}
            _drops_known_ids = set(_drops_log.keys())
    except Exception as e:
        _log(f"⚠️ drops DB load error: {e}", discord=False)


def _save_drops():
    _save_json_atomic(DROPS_FILE, _drops_log)

_load_drops()

@tasks.loop(seconds=30)
async def drops_loop():
    """Каждые 30 секунд проверяет новые дропы на Fear и логирует их."""
    global _drops_log, _drops_known_ids
    try:
        async with aiohttp.ClientSession() as session:
            headers = await _fear_headers()
            async with session.get(DROPS_API, params={"limit": 50}, headers=headers,
                                   timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200:
                    return
                data = await resp.json(content_type=None)
                if isinstance(data, dict):
                    data = data.get("feed", [])
                if not isinstance(data, list):
                    return

        new_count = 0
        for drop in data:
            did = str(drop.get("id", ""))
            if not did or did in _drops_known_ids:
                continue

            steamid = str(drop.get("steamid", ""))
            name = drop.get("name", "—")
            price = drop.get("price", 0)
            created = drop.get("created_at", "")
            image = drop.get("image", "")
            rarity = drop.get("rarity_color", "")
            server_id = drop.get("server_id", "")
            server_name = drop.get("server_name", "")

            entry = {
                "id": did,
                "name": name,
                "price": price,
                "steamid": steamid,
                "created_at": created,
                "image": image,
                "rarity_color": rarity,
                "server_id": server_id,
                "server_name": server_name,
            }
            _drops_log[did] = entry
            _drops_known_ids.add(did)
            if _db.db_is_available():
                _db.db_save_drop(entry)
            new_count += 1

        if new_count:
            # Ограничиваем память: оставляем только последние DROPS_MAX_IN_MEMORY
            if len(_drops_log) > DROPS_MAX_IN_MEMORY:
                sorted_keys = sorted(_drops_log.keys(), key=lambda k: _drops_log[k].get("created_at", ""))[-DROPS_MAX_IN_MEMORY:]
                _drops_log = {k: _drops_log[k] for k in sorted_keys}
                _drops_known_ids = set(_drops_log.keys())
            _save_drops()
            _log(f"🎮 [DROPS] Новых дропов: {new_count}", discord=False)

    except Exception as e:
        _log(f"❌ drops_loop: {e}")


@drops_loop.before_loop
async def before_drops():
    await bot.wait_until_ready()


@tasks.loop(minutes=5)
async def online_record_loop():
    """Каждые 5 минут записывает текущий онлайн на серверах."""
    if not FEAR_COOKIE:
        return
    try:
        async with aiohttp.ClientSession() as session:
            servers = await _fetch_json(session, f"{API_BASE}/servers")
            if not servers:
                return
            total = 0
            for srv in servers:
                total += len(srv.get("live_data", {}).get("players", []))
            if total > 0:
                _record_online_count(total)
                _log(f"📊 [ONLINE] Записан онлайн: {total}", discord=False)
    except Exception as e:
        _log(f"❌ online_record_loop: {e}")


@online_record_loop.before_loop
async def before_online_record():
    await bot.wait_until_ready()


def _get_drops_for_date(date_str: str) -> list[dict]:
    """Возвращает дропы за конкретную дату (YYYY-MM-DD)."""
    result = []
    for drop in _drops_log.values():
        created = drop.get("created_at", "")
        if created.startswith(date_str):
            result.append(drop)
    return sorted(result, key=lambda d: d.get("created_at", ""), reverse=True)


@tree.command(name="drops", description="Показать дропы Fear: за сегодня, вчера или конкретную дату")
@app_commands.describe(date="Дата: 17.06.2026, 2026-06-17 или без параметра (сегодня)")
async def cmd_drops(interaction: discord.Interaction, date: str = ""):
    await interaction.response.defer(ephemeral=True)

    date = _parse_date(date)

    drops = _get_drops_for_date(date)

    if not drops:
        return await interaction.edit_original_response(
            content=f"📭 Дропов за **{date}** не найдено."
        )

    total_value = sum(d.get("price", 0) for d in drops)
    unique_players = len({d.get("steamid") for d in drops if d.get("steamid")})

    embed = discord.Embed(
        title=f"🎮 Дропы за {date}",
        color=0x2ecc71,
        timestamp=datetime.now(timezone.utc)
    )
    embed.add_field(name="📦 Всего дропов", value=f"**{len(drops)}**", inline=True)
    embed.add_field(name="💰 Общая стоимость", value=f"**{total_value:.1f} ₽**", inline=True)
    embed.add_field(name="👥 Уникальных игроков", value=f"**{unique_players}**", inline=True)

    lines = []
    for d in drops[:15]:
        created = d.get("created_at", "")
        try:
            dt = datetime.fromisoformat(created.replace("Z", "+00:00")) + timedelta(hours=3)
            ts = dt.strftime("%H:%M")
        except Exception:
            ts = created[11:16] if len(created) > 16 else "?"

        name = d.get("name", "—")
        price = d.get("price", 0)
        sid = d.get("steamid", "")
        fear_url = f"https://fearproject.ru/profile/{sid}"

        lines.append(f"`{ts}` **{price}₽** — [{name}]({fear_url})")

    embed.description = "\n".join(lines)

    if len(drops) > 15:
        embed.set_footer(text=f"Показано 15 из {len(drops)} • Ещё {len(drops) - 15} дропов")

    # Быстрые кнопки на другие даты
    view = discord.ui.View()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
    if date != today:
        view.add_item(discord.ui.Button(label="Сегодня", style=discord.ButtonStyle.secondary, custom_id=f"drops_{today}"))
    if date != yesterday:
        view.add_item(discord.ui.Button(label="Вчера", style=discord.ButtonStyle.secondary, custom_id=f"drops_{yesterday}"))

    await interaction.edit_original_response(content=None, embed=embed)


# ═══════════════════════════════════════════════════════════════════════════
# Приватная команда расчёта выплат — только для владельца (1500235583367417866)
# ═══════════════════════════════════════════════════════════════════════════

_PAY_RANK_BONUS = {
    "BETA": 0,       # бета-ранг без бонуса
    "GAMMA": 500,
    "ALPHA": 750,
    "METHOD": 1000,
    "TOP": 0,        # топ — это отдельные топ-призы, не бонус ранга
}

_PAY_ROLE_FIXED = {
    "ML": 0,
    "M": 0,
    "STM": 1000,
    "STA": 3000,
    "GA": 9000,
    "CURATOR": 4000,
}

_PAY_ROLE_NORMS = {
    "ML": {"punish": 0, "tickets": 0},    # младший — без норм и без выплаты
    "M": {"punish": 100, "tickets": 150},
    "STM": {"punish": 60, "tickets": 150},
    "STA": {"punish": 40, "tickets": 150},
    "GA": {"punish": 0, "tickets": 150},
    "CURATOR": {"punish": 0, "tickets": 150},
}

_PAY_BAN_TIERS = [
    {"from": 0, "to": 150, "rate": 7},
    {"from": 150, "to": 250, "rate": 6},
    {"from": 250, "to": 350, "rate": 5},
    {"from": 350, "to": 500, "rate": 4},
    {"from": 500, "to": None, "rate": 3},
]

_PAY_TICKET_TIERS = [
    {"from": 0, "to": 100, "rate": 10},
    {"from": 100, "to": 250, "rate": 8},
    {"from": 250, "to": 500, "rate": 7},
    {"from": 500, "to": None, "rate": 6},
]

_PAY_TOP_PUNISH_PRIZES = [1500, 1250, 1000]
_PAY_TOP_TICKET_PRIZES = [1500, 1250, 1000]


def _group_to_pay_role(group_name: str) -> str:
    g = str(group_name or "").strip().upper()
    mapping = {
        "MLMODER": "ML",
        "MODER": "M",
        "STMODER": "STM",
        "STADMIN": "STA",
        "GLADMIN": "GA",
        "CURATOR": "CURATOR",
        "STAFF": "M",
        "ADMIN": "STA",
        "ADMIN+": "GA",
    }
    return mapping.get(g, "GA")


def _progressive_pay(count: int, tiers: list) -> int:
    c = max(0, int(count or 0))
    pay = 0
    for t in tiers:
        f = max(0, int(t.get("from", 0)))
        to = t.get("to")
        to = float("inf") if to is None else max(f, int(to))
        rate = float(t.get("rate", 0))
        if c <= f:
            continue
        units = min(c, to) - f
        if units > 0:
            pay += units * rate
    return pay


def _pay_bans_by_count(bans: int) -> int:
    return _progressive_pay(bans, _PAY_BAN_TIERS)


def _pay_tickets_by_count(tickets: int) -> int:
    return _progressive_pay(tickets, _PAY_TICKET_TIERS)


def _period_bounds(period: str) -> tuple[int, int]:
    now = datetime.now(timezone.utc)
    if period == "week":
        start = now - timedelta(days=7)
        end = now
    elif period == "prev_month":
        first_day_current = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        last_day_prev = first_day_current - timedelta(days=1)
        start = last_day_prev.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = first_day_current
    else:
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = now
    return int(start.timestamp()), int(end.timestamp())


def _ts_to_ym(ts: int) -> str:
    d = datetime.fromtimestamp(ts, tz=timezone.utc)
    return f"{d.year}-{str(d.month).zfill(2)}"


@tree.command(name="calc_pay", description="[OWNER ONLY] Расчёт выплаты по наказаниям стаффа")
@app_commands.describe(
    steamid="SteamID админа",
    rank="Ранг проверки",
    period="Период расчёта",
    tickets="Количество тикетов (если не указано — из БД за месяц/прошлый месяц, для week=0)",
    ticket_top_place="Ручное место в топе по тикетам (1–3). Если не указано — из БД"
)
@app_commands.choices(
    rank=[
        app_commands.Choice(name="BETA", value="BETA"),
        app_commands.Choice(name="GAMMA", value="GAMMA"),
        app_commands.Choice(name="ALPHA", value="ALPHA"),
        app_commands.Choice(name="METHOD", value="METHOD"),
        app_commands.Choice(name="TOP", value="TOP"),
    ],
    period=[
        app_commands.Choice(name="Текущий месяц", value="month"),
        app_commands.Choice(name="Прошлый месяц", value="prev_month"),
        app_commands.Choice(name="Последние 7 дней", value="week"),
    ],
    ticket_top_place=[
        app_commands.Choice(name="1 место", value=1),
        app_commands.Choice(name="2 место", value=2),
        app_commands.Choice(name="3 место", value=3),
    ]
)
async def cmd_calc_pay(
    interaction: discord.Interaction,
    steamid: str,
    rank: app_commands.Choice[str],
    period: app_commands.Choice[str] = None,
    tickets: int = None,
    ticket_top_place: app_commands.Choice[int] = None,
):
    await interaction.response.defer(ephemeral=True)

    if interaction.user.id != 1500235583367417866:
        return await interaction.edit_original_response(
            content="❌ Эта команда только для владельца."
        )

    period_value = period.value if period else "month"
    since_ts, until_ts = _period_bounds(period_value)
    ym = _ts_to_ym(since_ts)

    # Определяем роль админа
    group = ""
    if _db.db_is_available():
        try:
            group = _db.db_get_admin_group(steamid)
        except Exception as e:
            _log(f"⚠️ [calc_pay] Ошибка получения группы: {e}", discord=False)
    role = _group_to_pay_role(group)

    # Получаем количество наказаний (без снятых и тикет-причин)
    # Сначала пробуем таблицу сайта panel_fear_punishments (там актуальные данные),
    # если не получилось — fallback на локальную таблицу punishments бота.
    counts = {"bans": 0, "mutes": 0}
    table_used = "—"
    if _db.db_is_available():
        try:
            counts = _db.db_get_admin_punishment_counts_panel(steamid, since_ts, until_ts)
            if counts.get("bans", 0) or counts.get("mutes", 0):
                table_used = "panel_fear_punishments"
            else:
                counts = _db.db_get_admin_punishment_counts(steamid, since_ts, until_ts)
                table_used = "punishments"
        except Exception as e:
            _log(f"⚠️ [calc_pay] Ошибка получения наказаний: {e}", discord=False)
            try:
                counts = _db.db_get_admin_punishment_counts(steamid, since_ts, until_ts)
                table_used = "punishments"
            except Exception as e2:
                _log(f"⚠️ [calc_pay] Ошибка fallback наказаний: {e2}", discord=False)

    bans = int(counts.get("bans", 0))
    mutes = int(counts.get("mutes", 0))
    punish_count = bans + mutes

    # Тикеты: для week = 0, для month/prev_month — из БД или параметра
    ticket_count = 0
    if period_value in ("month", "prev_month"):
        if tickets is not None:
            ticket_count = max(0, int(tickets))
        elif _db.db_is_available():
            try:
                ticket_count = _db.db_get_admin_tickets_month(steamid, ym)
            except Exception as e:
                _log(f"⚠️ [calc_pay] Ошибка получения тикетов: {e}", discord=False)

    # Топ-призы
    top_punish_prize = 0
    top_ticket_prize = 0
    top_punish_place = 0
    top_ticket_place = 0
    if _db.db_is_available():
        try:
            top_punish = _db.db_get_top_punish_admins_panel(since_ts, until_ts, limit=3)
            if not top_punish:
                top_punish = _db.db_get_top_punish_admins(since_ts, until_ts, limit=3)
            for i, row in enumerate(top_punish, 1):
                if str(row.get("admin_steamid") or "").strip() == str(steamid).strip():
                    top_punish_place = i
                    top_punish_prize = _PAY_TOP_PUNISH_PRIZES[i - 1] or 0
                    break
        except Exception as e:
            _log(f"⚠️ [calc_pay] Ошибка топа наказаний: {e}", discord=False)

        if period_value in ("month", "prev_month"):
            if ticket_top_place is not None:
                place = ticket_top_place.value
                top_ticket_place = place
                top_ticket_prize = _PAY_TOP_TICKET_PRIZES[place - 1] or 0
            elif _db.db_is_available():
                try:
                    top_ticket = _db.db_get_top_ticket_admins(ym, limit=3)
                    for i, row in enumerate(top_ticket, 1):
                        if str(row.get("steam_id") or "").strip() == str(steamid).strip():
                            top_ticket_place = i
                            top_ticket_prize = _PAY_TOP_TICKET_PRIZES[i - 1] or 0
                            break
                except Exception as e:
                    _log(f"⚠️ [calc_pay] Ошибка топа тикетов: {e}", discord=False)

    # Расчёт
    pay_bans = _pay_bans_by_count(bans)
    pay_mutes = mutes * 4
    pay_tickets = _pay_tickets_by_count(ticket_count)
    rank_bonus = _PAY_RANK_BONUS.get(rank.value, 0)
    fixed = _PAY_ROLE_FIXED.get(role, 0)
    norms = _PAY_ROLE_NORMS.get(role, {"punish": 0, "tickets": 0})
    meets_punish = punish_count >= norms["punish"]
    meets_tickets = ticket_count >= norms["tickets"]
    fixed_paid = fixed if (fixed > 0 and meets_punish and meets_tickets) else 0
    total = pay_bans + pay_mutes + pay_tickets + fixed_paid + rank_bonus + top_punish_prize + top_ticket_prize

    # Имя админа
    admin_name = steamid
    try:
        if _db.db_is_available():
            name_from_db = _db.db_get_admin_name(steamid)
            if name_from_db:
                admin_name = name_from_db
            else:
                # Fallback: последнее имя из таблицы сайта
                rows = _db.db_get_punishments_by_admin(steamid, ptype=0, limit=1)
                if rows:
                    admin_name = rows[0].get("admin") or steamid
    except Exception:
        pass

    embed = discord.Embed(
        title="💰 Расчёт выплаты",
        description=f"Админ: **{admin_name}**\nSteamID: `{steamid}`",
        color=0x2ecc71,
        timestamp=datetime.now(timezone.utc)
    )
    embed.add_field(name="🎖 Роль", value=f"{group or '—'} → `{role}`", inline=True)
    embed.add_field(name="⭐ Ранг проверки", value=f"`{rank.value}` (+{rank_bonus} ₽)", inline=True)
    period_label = {"month": "Текущий месяц", "prev_month": "Прошлый месяц", "week": "Последние 7 дней"}.get(period_value, period_value)
    embed.add_field(name="📅 Период", value=period_label, inline=True)
    embed.add_field(name="🔨 Баны", value=f"{bans} (+{pay_bans} ₽)", inline=True)
    embed.add_field(name="🔇 Муты", value=f"{mutes} (+{pay_mutes} ₽)", inline=True)
    embed.add_field(name="🎫 Тикеты", value=f"{ticket_count} (+{pay_tickets} ₽)", inline=True)
    embed.add_field(name="📊 Норма", value=f"{norms['punish']} наказ / {norms['tickets']} тикетов", inline=True)
    embed.add_field(name="💵 Фикс", value=f"{fixed_paid} ₽ (база {fixed} ₽)", inline=True)
    embed.add_field(name="🏆 Топ наказания", value=f"{top_punish_place or '—'} место (+{top_punish_prize} ₽)", inline=True)
    embed.add_field(name="🏆 Топ тикеты", value=f"{top_ticket_place or '—'} место (+{top_ticket_prize} ₽)", inline=True)
    embed.add_field(name="💵 Итого", value=f"**{total} ₽**", inline=True)
    embed.set_footer(text=f"Источник: {table_used} • Снятые и 'тикет в дс' исключены • Топ-призы за текущий период")

    await interaction.edit_original_response(content=None, embed=embed)


@tasks.loop(hours=6)
async def db_cleanup_loop():
    """Каждые 6 часов чистит старые данные из БД, чтобы не раздувалась."""
    if not _db.db_is_available():
        return
    try:
        stats = await asyncio.get_event_loop().run_in_executor(None, _db.db_cleanup_old_data)
        if stats:
            parts = [f"{k}: {v}" for k, v in stats.items() if v]
            if parts:
                _log(f"🧹 [DB Cleanup] Удалено: {', '.join(parts)}", discord=False)
    except Exception as e:
        _log(f"⚠️ [DB Cleanup] Ошибка: {e}", discord=False)
    # Один раз обнулить тяжёлые server_data (первый запуск после деплоя)
    if not getattr(db_cleanup_loop, '_wiped', False):
        try:
            wiped = await asyncio.get_event_loop().run_in_executor(None, _db.db_wipe_heavy_columns)
            if wiped:
                _log(f"🧹 [DB Cleanup] Обнулено server_data в {wiped} строках", discord=False)
            db_cleanup_loop._wiped = True
        except Exception as e:
            _log(f"⚠️ [DB Cleanup] Ошибка wipe: {e}", discord=False)


@db_cleanup_loop.before_loop
async def before_db_cleanup():
    await bot.wait_until_ready()


@tasks.loop(minutes=2)
async def voice_reconnect_loop():
    """Каждые 2 минуты проверяет, что бот в войс-канале, и переподключается при необходимости."""
    if not VOICE_CHANNEL_ID:
        return
    try:
        vc = bot.get_channel(VOICE_CHANNEL_ID)
        if not vc or not isinstance(vc, discord.VoiceChannel):
            return
        guild = vc.guild
        if guild.voice_client is None or guild.voice_client.channel != vc:
            if guild.voice_client:
                try:
                    await guild.voice_client.disconnect(force=True)
                except Exception:
                    pass
            await vc.connect(self_deaf=True, self_mute=True)
            _log(f"🔊 [VOICE] Переподключился в #{vc.name}", discord=False)
    except Exception as e:
        _log(f"⚠️ [VOICE] Ошибка: {e}", discord=False)


@voice_reconnect_loop.before_loop
async def before_voice_reconnect():
    await bot.wait_until_ready()


# ── Backup (Discord + Google Drive) ──
BACKUP_CHANNEL_ID = int(os.getenv("BACKUP_CHANNEL_ID", "1522813725206118460") or "1522813725206118460")


@tree.command(name="backup", description="Создать бэкап базы данных и загрузить в Discord")
async def cmd_backup(interaction: discord.Interaction):
    await interaction.response.send_message("⏳ Создаю бэкап базы данных...", ephemeral=True)
    ch = interaction.guild.get_channel(BACKUP_CHANNEL_ID) if interaction.guild else None
    if not ch:
        ch = interaction.channel
    import concurrent.futures
    loop = asyncio.get_event_loop()
    with concurrent.futures.ThreadPoolExecutor() as pool:
        dump_data = await loop.run_in_executor(pool, discord_backup.create_dump_bytes)
    if not dump_data:
        return await interaction.edit_original_response(content="❌ Не удалось создать дамп базы")
    data, filename = dump_data
    size_mb = len(data) / (1024 * 1024)
    if len(data) > 25 * 1024 * 1024:
        return await interaction.edit_original_response(content=f"❌ Дамп слишком большой ({size_mb:.1f}MB > 25MB)")
    try:
        file = discord.File(io.BytesIO(data), filename=filename)
        msg = await ch.send(
            f"☁️ **Бэкап** — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n"
            f"Запросил: {interaction.user.mention}\n"
            f"Размер: {size_mb:.1f}MB",
            file=file
        )
        await interaction.edit_original_response(content=f"✅ Бэкап создан: `{filename}` ({size_mb:.1f}MB)\nСообщение: {msg.jump_url}")
    except Exception as e:
        await interaction.edit_original_response(content=f"❌ Ошибка загрузки: {e}")


@tree.command(name="backup_debug", description="Показать информацию о таблицах в базе данных")
async def cmd_backup_debug(interaction: discord.Interaction):
    await interaction.response.send_message("⏳ Проверяю базу...", ephemeral=True)
    import psycopg2 as _pg2
    import psycopg2.extras as _pg2e
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        return await interaction.edit_original_response(content="❌ DATABASE_URL не задана")
    try:
        if "sslmode" not in url:
            sep = "&" if "?" in url else "?"
            url += f"{sep}sslmode=require"
        conn = _pg2.connect(url, connect_timeout=10)
        cur = conn.cursor(cursor_factory=_pg2e.RealDictCursor)
        cur.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")
        tables = [r['tablename'] for r in cur.fetchall()]
        lines = [f"**Таблиц: {len(tables)}**\n"]
        for t in tables:
            cur.execute(f'SELECT COUNT(*) AS cnt FROM "{t}"')
            cnt = cur.fetchone()['cnt']
            lines.append(f"• `{t}`: {cnt} строк")
        cur.close()
        conn.close()
        await interaction.edit_original_response(content="\n".join(lines))
    except Exception as e:
        await interaction.edit_original_response(content=f"❌ Ошибка: {e}")


@tree.command(name="restore", description="Восстановить базу данных из последнего бэкапа в Discord")
async def cmd_restore(interaction: discord.Interaction):
    ch = interaction.guild.get_channel(BACKUP_CHANNEL_ID) if interaction.guild else None
    if not ch:
        return await interaction.response.send_message("❌ Канал бэкапов не найден", ephemeral=True)
    await interaction.response.send_message("⏳ Скачиваю последний бэкап...", ephemeral=True)
    try:
        backup_data = None
        backup_name = None
        async for msg in ch.history(limit=50):
            if msg.attachments:
                att = msg.attachments[0]
                if att.filename.startswith("fearsearch_backup_") and att.filename.endswith(".json.gz"):
                    await interaction.edit_original_response(
                        content=f"⏳ Скачиваю `{att.filename}` ({att.size / 1024 / 1024:.1f}MB)..."
                    )
                    backup_data = await att.read()
                    backup_name = att.filename
                    break
        if not backup_data:
            return await interaction.edit_original_response(content="❌ Бэкапы не найдены в канале")

        await interaction.edit_original_response(content=f"⏳ Восстанавливаю базу из `{backup_name}`...")
        import concurrent.futures
        loop = asyncio.get_event_loop()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            result = await loop.run_in_executor(pool, discord_backup.restore_from_bytes, backup_data)

        if result["success"]:
            await interaction.edit_original_response(
                content=f"✅ База восстановлена из `{backup_name}`\n"
                        f"Таблиц: {result['tables_restored']}"
            )
        else:
            await interaction.edit_original_response(
                content=f"❌ Ошибка восстановления: {result['message']}"
            )
    except Exception as e:
        await interaction.edit_original_response(content=f"❌ Ошибка: {e}")


@tasks.loop(hours=24)
async def backup_loop():
    if not BACKUP_CHANNEL_ID:
        return
    ch = bot.get_channel(BACKUP_CHANNEL_ID)
    if not ch:
        return
    import concurrent.futures
    loop = asyncio.get_event_loop()
    with concurrent.futures.ThreadPoolExecutor() as pool:
        dump_data = await loop.run_in_executor(pool, discord_backup.create_dump_bytes)
    if not dump_data:
        _log("⚠️ [Backup] Автобэкап: не удалось создать дамп", discord=False)
        return
    data, filename = dump_data
    size_mb = len(data) / (1024 * 1024)
    if len(data) > 25 * 1024 * 1024:
        _log(f"⚠️ [Backup] Автобэкап: дамп слишком большой ({size_mb:.1f}MB)", discord=False)
        return
    try:
        file = discord.File(io.BytesIO(data), filename=filename)
        await ch.send(
            f"☁️ **Автобэкап** — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n"
            f"Размер: {size_mb:.1f}MB",
            file=file
        )
        _log(f"☁️ [Backup] Автобэкап: {filename} ({size_mb:.1f}MB)", discord=False)
    except Exception as e:
        _log(f"⚠️ [Backup] Автобэкап ошибка: {e}", discord=False)


@backup_loop.before_loop
async def before_backup():
    await bot.wait_until_ready()


# ── Google Drive Backup (опционально) ──
@tree.command(name="gdrive_backup", description="Создать бэкап на Google Drive (если настроен)")
async def cmd_gdrive_backup(interaction: discord.Interaction, keep: int = 7):
    if not gdrive_backup._get_service():
        return await interaction.response.send_message(
            "❌ Google Drive не настроен. Смотри `.env.example`",
            ephemeral=True
        )
    await interaction.response.send_message("⏳ Создаю бэкап на Google Drive...", ephemeral=True)
    import concurrent.futures
    loop = asyncio.get_event_loop()
    with concurrent.futures.ThreadPoolExecutor() as pool:
        result = await loop.run_in_executor(pool, gdrive_backup.create_backup, keep)
    if result["success"]:
        await interaction.edit_original_response(content=f"✅ Бэкап создан: `{result['filename']}`\nGoogle Drive ID: `{result.get('file_id', 'N/A')}`")
    else:
        await interaction.edit_original_response(content=f"❌ Ошибка бэкапа: {result['message']}")


def _cancel_pending_tasks():
    """Отменяет все pending задачи asyncio чтобы не спамить варнингами при выходе."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            return
        pending = [t for t in asyncio.all_tasks(loop) if not t.done()]
        if pending:
            for task in pending:
                task.cancel()
            # Даем задачам время отмениться (без варнингов)
            loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
    except Exception:
        pass

if __name__ == "__main__":
    # На Railway перезапуск делает сам хостинг.
    # Локально — цикл с повторными попытками при обрыве сети.
    is_railway = os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("RAILWAY_PROJECT_ID")

    import signal
    import sys

    def _graceful_exit(signum, frame):
        _log("🛑 Получен сигнал завершения, закрываю бота...", discord=False)
        try:
            loop = asyncio.get_event_loop()
            if not loop.is_closed():
                loop.create_task(bot.close())
                loop.run_until_complete(asyncio.sleep(0.5))
                _cancel_pending_tasks()
        except Exception:
            pass
        finally:
            sys.exit(0)

    signal.signal(signal.SIGINT, _graceful_exit)
    signal.signal(signal.SIGTERM, _graceful_exit)

    if is_railway:
        # Railway: цикл с retry при rate limit и ошибках соединения
        retry_delay = 10
        while True:
            try:
                _log("🚀 Запуск бота...", discord=False)
                bot.run(TOKEN)
            except KeyboardInterrupt:
                _cancel_pending_tasks()
                break
            except Exception as e:
                err_str = str(e)
                if "429" in err_str or "Too Many" in err_str or "rate" in err_str.lower():
                    _log(f"⚠️ Discord rate limit (429). Повтор через {retry_delay} сек...", discord=False)
                elif "Cloudflare" in err_str or "1015" in err_str:
                    _log(f"⚠️ Cloudflare заблокировал. Повтор через {retry_delay} сек...", discord=False)
                else:
                    _log(f"⚠️ Ошибка запуска: {e}", discord=False)
                    retry_delay = min(retry_delay * 2, 120)
                time.sleep(retry_delay)
                retry_delay = min(retry_delay * 2, 120)
    else:
        # Локально: цикл с реконнектом
        retry_delay = 5
        while True:
            try:
                _log("🚀 Запуск бота...", discord=False)
                bot.run(TOKEN)
            except KeyboardInterrupt:
                _cancel_pending_tasks()
                _log("🛑 Бот остановлен.", discord=False)
                break
            except (OSError, ConnectionError) as e:
                _log(f"⚠️ Ошибка соединения: {e}", discord=False)
                _log(f"🔄 Переподключение через {retry_delay} сек...", discord=False)
                time.sleep(retry_delay)
                retry_delay = min(retry_delay * 2, 60)
            except Exception as e:
                _log(f"❌ Критическая ошибка: {e}", discord=False)
                _log(f"🔄 Перезапуск через {retry_delay} сек...", discord=False)
                time.sleep(retry_delay)
                retry_delay = min(retry_delay * 2, 60)
            else:
                _log("🛑 Бот остановлен.", discord=False)
                break
