# Поздравлятор

Сервис персонализированных поздравлений в стиле самого пользователя + напоминалка в Telegram.
ТЗ — [pozdravlyator-tz.md](pozdravlyator-tz.md).

## Стек

- **БД / бэкенд:** Supabase (Postgres) — таблицы в общем проекте PanditJi с префиксом `pzd_`
- **Auth:** Telegram Login Widget (бот `@panditjiji_bot`)
- **Backend logic:** Supabase Edge Functions (Deno/TypeScript)
- **Frontend:** React + TypeScript + Vite (папка `web/`)
- **LLM:** Claude Sonnet 5 (Anthropic)

## Структура

```
supabase/
  migrations/            SQL-миграции (0001 — схема + RLS, 0002 — nullable timezone)
  functions/
    telegram-auth/       Edge Function: проверка подписи Telegram, выпуск сессии
  config.toml
web/                     Frontend (Vite React TS)
  src/
    lib/supabase.ts      Клиент Supabase
    components/          TelegramLogin
    screens/             MainScreen
```

## Локальный запуск фронтенда

```bash
cd web
cp .env.example .env    # заполнить publishable-ключ и т.д.
npm install
npm run dev             # http://localhost:5173
```

> Telegram Login Widget работает только на домене, прописанном боту через
> `@BotFather` → `/setdomain`, и требует HTTPS. На `localhost` кнопка входа
> не отрисуется — нужен задеплоенный домен.

## Секреты (никогда не коммитятся)

- `TELEGRAM_BOT_TOKEN` — задаётся как секрет edge-функции:
  `supabase secrets set TELEGRAM_BOT_TOKEN=... --project-ref intcymsjpbkyrflfcwzf`
- `ANTHROPIC_API_KEY` — понадобится на этапе генерации (этап 4).
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` — инжектятся платформой в edge-функции.

## Статус разработки

Ведётся по разделу 18 ТЗ. Текущий этап: **1 — База данных и авторизация**.
