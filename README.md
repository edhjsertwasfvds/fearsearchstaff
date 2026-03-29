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

Для SQLite в Railway теперь используется только `DATABASE_PATH`.

1. Открой Railway → сервис → **Variables**
2. Добавь переменную `DATABASE_PATH`
3. Для Linux задай путь, например: `/app/data/fear-data.db`
4. Сохрани и сделай redeploy

> **Важно:** не используй `RAILWAY_VOLUME_MOUNT_PATH` в логике приложения — путь к БД задаётся явно через `DATABASE_PATH`.

### Если видишь SIGTERM / npm error command failed

1. **Проверь `DATABASE_PATH`** — путь должен существовать и быть доступен на запись.
2. **Проверь логи** — ошибка может быть от старого контейнера при redeploy. Прокрути выше в Deploy Logs.
3. **Start Command:** если не задан, Railway запускает `npm start`. Можно явно указать `node src/server.js`.

## Важные заметки

- Без `STEAM_API_KEY` приложение запускается, но части функционала Steam будут отключены.
- Токены и секреты не коммитьте в репозиторий.
- SQLite подходит для локальной разработки; для горизонтального scaling лучше внешний storage.
