"""
Discord-based backup for PostgreSQL database.
Streams dump to disk to avoid memory spikes.
No external tools needed.

Requires:
  - DATABASE_URL: PostgreSQL connection string
  - BACKUP_CHANNEL_ID: Discord channel ID for backups
"""
import os
import io
import gzip
import json
import logging
import tempfile
import psycopg2
import psycopg2.extras
from datetime import datetime, timezone, date
from decimal import Decimal

logger = logging.getLogger("discord_backup")

SKIP_TABLES = {"kv_store", "leaderboard_cache"}


def _get_conn():
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        logger.error("[Backup] DATABASE_URL не задана")
        return None
    try:
        if "sslmode" not in url:
            sep = "&" if "?" in url else "?"
            url += f"{sep}sslmode=require"
        conn = psycopg2.connect(url, connect_timeout=30)
        logger.info("[Backup] PostgreSQL подключена")
        return conn
    except Exception as e:
        logger.error(f"[Backup] Ошибка подключения: {e}")
        return None


def _default(obj):
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, bytes):
        return obj.hex()
    return str(obj)


def _create_streaming_dump() -> tuple[bytes, str] | None:
    """Потоковый дамп: пишем в файл построчно, сжимаем gzip."""
    conn = _get_conn()
    if not conn:
        return None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        cur.execute("""
            SELECT tablename FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY tablename
        """)
        tables = [r['tablename'] for r in cur.fetchall()]
        if not tables:
            logger.error("[Backup] Таблицы не найдены")
            return None

        logger.info(f"[Backup] Таблиц: {len(tables)}, пропуск: {SKIP_TABLES}")

        now = datetime.now(timezone.utc)
        filename = f"fearsearch_backup_{now.strftime('%Y-%m-%d_%H-%M')}.json.gz"
        tmp_dir = tempfile.mkdtemp(prefix="bck_")
        gz_path = os.path.join(tmp_dir, filename)

        total_rows = 0
        with gzip.open(gz_path, "wb", compresslevel=6) as gz:
            # Header
            header = json.dumps({
                "created": now.isoformat(),
                "version": 1
            }, ensure_ascii=False) + "\n"
            gz.write(header.encode("utf-8"))

            for table in tables:
                if table in SKIP_TABLES:
                    logger.info(f"[Backup] {table}: ПРОПУСК")
                    continue

                cur.execute(f'SELECT * FROM "{table}"')
                cols = [desc[0] for desc in cur.description] if cur.description else []

                # Пишем таблицу построчно — не держим всё в памяти
                table_header = json.dumps({"table": table, "columns": cols}) + "\n"
                gz.write(table_header.encode("utf-8"))

                row_count = 0
                while True:
                    rows = cur.fetchmany(500)  # по 500 строк за раз
                    if not rows:
                        break
                    for row in rows:
                        d = dict(row)
                        # Обрезаем огромные content
                        if table == "config_hashes" and "content" in d and d["content"] and len(str(d["content"])) > 500:
                            d["content"] = str(d["content"])[:500] + "...(truncated)"
                        line = json.dumps(d, ensure_ascii=False, default=_default) + "\n"
                        gz.write(line.encode("utf-8"))
                        row_count += 1

                total_rows += row_count
                logger.info(f"[Backup] {table}: {row_count} строк")

            # Footer
            footer = json.dumps({"total_rows": total_rows, "tables_done": True}) + "\n"
            gz.write(footer.encode("utf-8"))

        cur.close()

        # Читаем результат
        file_size = os.path.getsize(gz_path)
        logger.info(f"[Backup] Готово: {total_rows} строк, {file_size} bytes ({file_size/1024/1024:.2f}MB)")

        with open(gz_path, "rb") as f:
            data = f.read()

        # Чистим temp
        try:
            os.remove(gz_path)
            os.rmdir(tmp_dir)
        except Exception:
            pass

        return data, filename

    except Exception as e:
        logger.error(f"[Backup] Ошибка: {e}")
        return None
    finally:
        try:
            conn.close()
        except Exception:
            pass


def create_dump_bytes() -> tuple[bytes, str] | None:
    return _create_streaming_dump()


async def upload_backup(channel) -> dict:
    result = {"success": False, "filename": "", "message": ""}
    dump = create_dump_bytes()
    if not dump:
        result["message"] = "Не удалось создать дамп базы"
        return result
    data, filename = dump
    size_mb = len(data) / (1024 * 1024)
    if len(data) > 25 * 1024 * 1024:
        result["message"] = f"Дамп слишком большой ({size_mb:.1f}MB > 25MB)"
        return result
    try:
        file = discord.File(io.BytesIO(data), filename=filename)
        msg = await channel.send(
            f"☁️ **Бэкап** — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n"
            f"Размер: {size_mb:.2f}MB",
            file=file
        )
        result["success"] = True
        result["filename"] = filename
        result["message_id"] = msg.id
        result["message"] = f"Бэкап {filename} загружен ({size_mb:.2f}MB)"
        logger.info(f"[Backup] {result['message']}")
        return result
    except Exception as e:
        result["message"] = f"Ошибка загрузки: {e}"
        logger.error(f"[Backup] {result['message']}")
        return result


async def download_latest_backup(channel) -> tuple[bytes, str] | None:
    try:
        async for msg in channel.history(limit=50):
            if msg.attachments:
                att = msg.attachments[0]
                if att.filename.startswith("fearsearch_backup_") and att.filename.endswith(".json.gz"):
                    data = await att.read()
                    logger.info(f"[Backup] Скачан: {att.filename} ({len(data)} bytes)")
                    return data, att.filename
        logger.warning("[Backup] Бэкапы не найдены")
        return None
    except Exception as e:
        logger.error(f"[Backup] Ошибка скачивания: {e}")
        return None


import discord
