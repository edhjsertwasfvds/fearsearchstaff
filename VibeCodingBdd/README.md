# VibeCodingBdd (mirror)

Скопируй содержимое `db/` в репозиторий [VibeCodingMeta/VibeCodingBdd](https://github.com/VibeCodingMeta/VibeCodingBdd): после `init.sql` выполни **`db/panel.sql`** на той же базе — таблицы `panel_*` для веб-панели (пользователи, сессии, whitelist).

В сервисе панели достаточно одной переменной **`DATABASE_URL`** на этот же Postgres.
