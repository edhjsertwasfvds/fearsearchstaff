# Fear Project Players Viewer

Локальный веб-инструмент для просмотра игроков серверов Fear Project, проверки банов (VAC/Yooma/Suspicious), работы с whitelist и базовой авторизации через Discord OAuth.

## Требования

- Node.js 18+
- npm 9+

> **Нет Node.js?** См. [LOCALHOST.md](LOCALHOST.md) — пошаговая настройка для Windows.

## Быстрый старт

1. Установите Node.js с https://nodejs.org/ (LTS), перезапустите терминал.

2. Установите зависимости:

```bash
npm install
```

3. Создайте `.env` в корне проекта (есть `.env.example` как шаблон).

Минимальная конфигурация для localhost:

```env
PORT=3000
NODE_ENV=development
DEFAULT_USERS=admin:admin123:5
```

4. Запустите проект:

```bash
npm start
```

Или дважды кликните `start.bat` (Windows) — скрипт проверит Node.js, установит зависимости и запустит сервер.

Приложение: **http://localhost:3000**  
Вход: логин `admin`, пароль `admin123` (если указан в DEFAULT_USERS).

## Скрипты

- `npm run dev` — запуск сервера для локальной разработки
- `npm start` — запуск сервера (production-style)
- `npm run check-deploy` — проверка готовности файлов к деплою
- `npm run smoke` — автономный smoke-тест HTTP + WebSocket (поднимает сервер на `3101`)

## Локальный smoke-тест

Быстрый вариант (рекомендуется):

```bash
npm run smoke
```

Ручной вариант после запуска сервера:

1. Главная страница открывается:  
   `GET http://localhost:3000/`
2. Данные игроков и статистика приходят по **WebSocket** (типы сообщений: `get_stats`, `get_vac_bans`, `get_yooma_bans`, `get_all_players` и т.д.).
3. Whitelist endpoint отвечает JSON:  
   `GET http://localhost:3000/api/whitelist`
4. Логи действий отвечают JSON:  
   `GET http://localhost:3000/api/logs`

## Структура проекта

- `src/server.js` — HTTP + WebSocket сервер, API и раздача статики
- `src/auth.js` — сессии и проверка доступа
- `src/database.js` — SQLite и операции с whitelist/логами/комментариями
- `public/` — frontend (HTML/CSS/JS)
- `data/` — локальная SQLite база
- `.github/workflows/deploy.yml` — CI/CD workflow

## Деплой на Railway

Для SQLite в Railway лучше использовать **Volume** (постоянный том).

1. Открой Railway → сервис → **Volumes / New Volume**
2. Mount path: `/app/data`
3. Сохрани и сделай redeploy

После этого приложение автоматически подхватит `RAILWAY_VOLUME_MOUNT_PATH` и будет хранить базу в `/app/data/fear-data.db`.

> **Важно:** `DATABASE_PATH` в Railway обычно не нужен при использовании Volume.

### PostgreSQL (панель + поиск стаффа BDD, одна переменная)

Нужен только **`DATABASE_URL`** (тот же URL, что у [VibeCodingBdd](https://github.com/VibeCodingMeta/VibeCodingBdd) — одна база: `admins` / `profiles` и таблицы `panel_*`).

1. Подключи **Postgres** в Railway.
2. В сервисе веб-панели: **`DATABASE_URL`** = `${{ Postgres.DATABASE_URL }}`.
3. На новой базе выполни миграцию **`db/panel.sql`** из репозитория BDD (в этом проекте лежит копия: `VibeCodingBdd/db/panel.sql` — перенеси в свой Bdd и закоммить). При первом старте панель тоже создаст таблицы, если их ещё нет.
4. Volume под SQLite не обязателен.

Подробности — в `.env.example`.

### Если видишь SIGTERM / npm error command failed

1. **Проверь Volume**: mount path `/app/data` должен быть подключён к сервису.
2. **Если ошибки доступа к файлам** — добавь `RAILWAY_RUN_UID=0`.
3. **Проверь логи** — ошибка может быть от старого контейнера при redeploy. Прокрути выше в Deploy Logs.
4. **Start Command:** если не задан, Railway запускает `npm start`. Можно явно указать `node src/server.js`.

## Важные заметки

- Без `STEAM_API_KEY` приложение запускается, но части функционала Steam будут отключены.
- Токены и секреты не коммитьте в репозиторий.
- SQLite подходит для локальной разработки; для горизонтального scaling лучше внешний storage.
