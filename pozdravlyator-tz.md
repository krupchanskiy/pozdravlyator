# ТЗ: Сервис персонализированных поздравлений «ПоздравлятOR»

## Что это

Веб-приложение + Telegram-бот для генерации поздравлений, которые звучат как написанные самим пользователем, а не роботом.

## Главная идея

Система учится стилю конкретного пользователя:
- Вытаскивает его реальные поздравления из Telegram
- Позволяет добавить примеры вручную (из WhatsApp, SMS, почты)
- Пользователь размечает примеры: «эталон» / «ок» / «пропустить»
- Собирает фидбек по каждой генерации
- Учится на правках пользователя

---

## Стек технологий

- **База данных:** Supabase (PostgreSQL + Auth + Realtime)
- **Бэкенд:** Python + FastAPI
- **Фронтенд:** React
- **Telegram-бот:** aiogram (для бота) + Telethon (для импорта через MTProto)
- **LLM:** Claude API
- **Авторизация:** Telegram Login Widget

---

## Схема базы данных (Supabase)

### users

```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique not null,
  telegram_username text,
  name text,
  notification_time time default '09:00',
  notify_whom text default 'obligatory_only' check (notify_whom in ('all', 'obligatory_only')),
  created_at timestamptz default now()
);
```

### user_style_settings

```sql
create table user_style_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  emoji_usage text check (emoji_usage in ('often', 'sometimes', 'never')),
  brackets_instead_emoji boolean default false,
  exclamation_marks text check (exclamation_marks in ('many', 'one_at_end', 'avoid')),
  capitalization text check (capitalization in ('correct', 'often_lowercase')),
  greeting_length text check (greeting_length in ('short', 'medium', 'long')),
  created_at timestamptz default now()
);
```

### contacts

```sql
create table contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  name text not null,
  gender text check (gender in ('male', 'female', 'unknown')) default 'unknown',
  telegram_username text,
  relationship_type text check (relationship_type in ('friend', 'colleague', 'client', 'relative', 'acquaintance')),
  closeness int check (closeness between 1 and 5),
  formality text check (formality in ('ty', 'vy')) default 'ty',
  is_obligatory boolean default false,
  context text,
  language text default 'ru' check (language in ('ru', 'en')),
  created_at timestamptz default now()
);
```

### events

```sql
create table events (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references contacts(id) on delete cascade,
  event_type text not null check (event_type in ('birthday', 'anniversary')),
  event_date date not null,
  description text,
  created_at timestamptz default now()
);
```

### greetings_sent

```sql
create table greetings_sent (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references contacts(id) on delete cascade,
  event_type text not null,
  sent_date date not null,
  text text not null,
  created_at timestamptz default now()
);
```

### user_greeting_examples

```sql
create table user_greeting_examples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  source text check (source in ('telegram', 'manual')) default 'manual',
  original_date date,
  text text not null,
  relationship_type text check (relationship_type in ('friend', 'colleague', 'client', 'relative', 'acquaintance')),
  rating text check (rating in ('etalon', 'ok', 'skip')) default 'ok',
  created_at timestamptz default now()
);
```

### generation_feedback

```sql
create table generation_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  contact_id uuid references contacts(id) on delete cascade,
  event_type text not null,
  generated_text text not null,
  feedback text check (feedback in ('good', 'bad', 'selected')),
  bad_reason text check (bad_reason in ('too_formal', 'too_informal', 'too_long', 'too_short', 'not_my_style')),
  bad_comment text,
  edited_text text,
  user_own_variant text,
  created_at timestamptz default now()
);
```

### contact_categories

```sql
create table contact_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz default now()
);
```

### contact_category_links

```sql
create table contact_category_links (
  contact_id uuid references contacts(id) on delete cascade,
  category_id uuid references contact_categories(id) on delete cascade,
  primary key (contact_id, category_id)
);
```

Примеры категорий: «Прихожане храма», «Хоккейная команда», «Однокурсники», «Соседи по даче».

---

## API endpoints (FastAPI)

### Auth

```
POST /auth/telegram - авторизация через Telegram Login Widget
GET  /auth/me       - текущий пользователь
```

### Users

```
GET   /users/me       - профиль
PATCH /users/me       - обновить настройки (notification_time, notify_whom)
GET   /users/me/style - настройки стиля
PUT   /users/me/style - обновить настройки стиля
```

### Contacts

```
GET    /contacts     - список контактов (с фильтрами: relationship_type, is_obligatory)
POST   /contacts     - создать контакт
GET    /contacts/{id} - получить контакт
PATCH  /contacts/{id} - обновить контакт
DELETE /contacts/{id} - удалить контакт
```

### Events

```
GET    /events/upcoming      - ближайшие события (включая массовые праздники)
POST   /contacts/{id}/events - добавить событие контакту
PATCH  /events/{id}          - обновить событие
DELETE /events/{id}          - удалить событие
```

### Import

```
POST /import/telegram/auth      - начать авторизацию Telegram (номер телефона)
POST /import/telegram/code      - подтвердить код
GET  /import/telegram/contacts  - получить контакты из Telegram
POST /import/telegram/contacts  - импортировать выбранные контакты
GET  /import/telegram/greetings - получить найденные поздравления
POST /import/telegram/greetings - сохранить с разметкой (etalon/ok/skip)

POST /import/google/auth     - начать OAuth
GET  /import/google/callback - callback
GET  /import/google/contacts - получить контакты
POST /import/google/contacts - импортировать выбранные
```

### Greeting Examples

```
GET    /examples      - все примеры пользователя
POST   /examples      - добавить пример вручную
POST   /examples/bulk - добавить несколько (потом разметить)
PATCH  /examples/{id} - обновить разметку
DELETE /examples/{id} - удалить
```

### Generation

```
POST /generate          - сгенерировать поздравление
  body: { 
    contact_id, 
    event_type,
    custom_prompt?: "упомяни что мы вместе были в походе, стиль свободнее, 2-3 абзаца"
  }
  response: { variants: [{ id, text }, ...] }

POST /generate/feedback - отправить фидбек
  body: { generation_id, variant_index, feedback, bad_reason?, bad_comment?, edited_text? }

POST /generate/own-variant - сохранить свой вариант
  body: { contact_id, event_type, text }

POST /generate/send - отметить как отправленное
  body: { contact_id, event_type, text }
```

### Mass holidays

```
GET  /mass-holidays/upcoming         - ближайшие массовые праздники
GET  /mass-holidays/{type}/contacts  - контакты для праздника (type: new_year, march_8, feb_23)
POST /mass-holidays/{type}/generate  - сгенерировать для выбранных
  body: { contact_ids: [...] }
```

### Categories

```
GET    /categories              - список категорий пользователя
POST   /categories              - создать категорию
PATCH  /categories/{id}         - переименовать / обновить описание
DELETE /categories/{id}         - удалить категорию

POST   /contacts/{id}/categories      - добавить контакт в категории
  body: { category_ids: [...] }
DELETE /contacts/{id}/categories/{category_id} - убрать контакт из категории
```

---

## Telegram-бот (aiogram)

### Команды

- `/start` — привязка аккаунта, ссылка на веб
- `/upcoming` — ближайшие события
- `/settings` — ссылка на настройки в вебе

### Напоминания (ежедневная джоба)

Каждый день в `notification_time` пользователя:

1. Найти события на сегодня
2. Отфильтровать по `notify_whom` (все или только обязательные)
3. Отправить напоминание:

```
🎂 Сегодня день рождения

Имя Фамилия (@username)
Друг • Близость: 5/5 • ⭐ Обязательный
Обращение: на «ты»

«вместе учились, любит горы, недавно родился сын»

[🎁 Сгенерировать поздравление]
```

### Генерация через бота

По нажатию кнопки «Сгенерировать»:

1. Спросить про дополнительные пожелания:
   ```
   Хотите добавить пожелания к генерации?
   
   Например: «упомяни поход», «сделай короче», «более тёплый тон»
   
   [💬 Да, напишу] [⏭️ Пропустить]
   ```

2. Если «Да» — ждём текст от пользователя

3. Вызвать `/generate` (с custom_prompt если был)

4. Показать 3 варианта с inline-кнопками:
   - 👍 / 👎 / 📋 Копировать — под каждым

5. Дополнительные кнопки:
   - 🔄 Другие варианты
   - ✏️ Написать свой

При 👎 — спросить причину (inline-кнопки с вариантами).

При «Написать свой» — попросить отправить текст, сохранить как `user_own_variant`.

---

## Импорт из Telegram (Telethon)

### Авторизация

```python
client = TelegramClient('session', api_id, api_hash)
await client.send_code_request(phone)
await client.sign_in(phone, code)
```

### Получение контактов

```python
contacts = await client.get_contacts()
for user in contacts:
    # user.first_name, user.last_name, user.username, user.birthday
```

### Поиск поздравлений

```python
keywords = ['поздравляю', 'с днём рождения', 'с др', 'с днюхой', 
            'с новым годом', 'с 8 марта', 'с 23 февраля', 'с годовщиной']

async for dialog in client.iter_dialogs():
    async for message in client.iter_messages(dialog, limit=500):
        if message.out and any(kw in message.text.lower() for kw in keywords):
            # Сохранить: message.text, message.date, dialog.entity
```

---

## Импорт из Google Contacts

### OAuth

- Scopes: `https://www.googleapis.com/auth/contacts.readonly`

### People API

```
GET https://people.googleapis.com/v1/people/me/connections
    ?personFields=names,birthdays,genders
```

---

## Генерация поздравлений (Claude API)

### Промпт

```
Сгенерируй 3 варианта поздравления.

ПОЛУЧАТЕЛЬ:
- Имя: {name}
- Пол: {gender}
- Отношения: {relationship_type}
- Категории: {categories} (например: «Прихожане храма», «Хоккейная команда»)
- Близость: {closeness}/5
- Обращение: на «{formality}»
- Контекст: {context}
- Событие: {event_type} {event_description}
- Язык: {language}

СТИЛЬ ОТПРАВИТЕЛЯ:

Эталонные примеры (ориентируйся на них):
{etalon_examples}

Обычные примеры:
{ok_examples}

Настройки стиля:
- Эмодзи: {emoji_usage}
- Скобки вместо эмодзи: {brackets_instead_emoji}
- Восклицательные знаки: {exclamation_marks}
- Заглавные буквы: {capitalization}
- Длина: {greeting_length}

Примеры правок (что генерировали → что отправил):
{edit_examples}

Фидбек «плохо» с причинами:
{bad_feedback}

НЕ ПОВТОРЯТЬ (уже отправлялось этому человеку):
{previous_greetings}

ДОПОЛНИТЕЛЬНЫЕ ПОЖЕЛАНИЯ ОТ ПОЛЬЗОВАТЕЛЯ:
{custom_prompt}
(например: «упомяни что мы вместе были в походе, стиль свободнее, 2-3 абзаца»)

ТРЕБОВАНИЯ:
- Пиши так, как писал бы этот конкретный человек
- Не копируй эталоны дословно, но используй их стиль
- Учитывай близость и тип отношений
- Соблюдай ты/Вы
- Если есть дополнительные пожелания — обязательно учти их
- Три варианта разной длины, но все в едином стиле пользователя
```

---

## Веб-интерфейс (React)

### Страницы

1. **Авторизация** — Telegram Login Widget
2. **Онбординг**:
   - Импорт контактов (Telegram / Google / пропустить)
   - Модерация найденных поздравлений
   - Мини-опрос по стилю (если мало примеров)
3. **Главная** — список ближайших событий
4. **Контакты** — список, фильтры (по типу отношений, категории, обязательные), добавление
5. **Карточка контакта** — редактирование, события, категории, история
6. **Категории** — создание, редактирование, просмотр контактов в категории
7. **Генерация** — модалка с вариантами и фидбеком
8. **Массовые праздники** — выбор получателей (можно фильтровать по категории), генерация
9. **Мои примеры** — управление примерами стиля
10. **Настройки** — время уведомлений, кого уведомлять

### Компоненты генерации

```jsx
// Форма перед генерацией
<GenerationForm>
  <TextArea 
    label="💬 Дополнительные пожелания (опционально)"
    placeholder="упомяни что мы вместе были в походе, стиль свободнее, 2-3 абзаца"
  />
  <Button>🎁 Сгенерировать</Button>
</GenerationForm>

// Карточка варианта
<VariantCard>
  <Text>{variant.text}</Text>
  <Actions>
    <Button onClick={onGood}>👍</Button>
    <Button onClick={onBad}>👎</Button>
    <Button onClick={onCopy}>📋 Копировать</Button>
  </Actions>
</VariantCard>

// Модалка «почему плохо»
<BadFeedbackModal>
  <RadioGroup>
    <Radio value="too_formal">Слишком формально</Radio>
    <Radio value="too_informal">Слишком фамильярно</Radio>
    <Radio value="too_long">Слишком длинно</Radio>
    <Radio value="too_short">Слишком коротко</Radio>
    <Radio value="not_my_style">Не мой стиль</Radio>
  </RadioGroup>
  <TextArea placeholder="Комментарий (опционально)" />
  <Button>Отправить</Button>
</BadFeedbackModal>

// Редактирование перед копированием
<EditBeforeCopyModal>
  <TextArea value={text} onChange={...} />
  <Button>Копировать и сохранить</Button>
</EditBeforeCopyModal>

// Свой вариант
<OwnVariantModal>
  <Text>Напишите как вы бы поздравили. Мы учимся на ваших примерах!</Text>
  <TextArea />
  <Button>Сохранить и копировать</Button>
</OwnVariantModal>
```

### Добавление примеров вручную

```jsx
// Один пример
<AddExampleForm>
  <TextArea label="Текст поздравления" />
  <Select label="Кому было" options={contacts} optional />
  <Select label="Тип отношений" options={relationshipTypes} />
  <RadioGroup label="Оценка">
    <Radio value="etalon">⭐ Эталон</Radio>
    <Radio value="ok">✓ Нормальный пример</Radio>
  </RadioGroup>
  <Button>Добавить</Button>
</AddExampleForm>

// Массовое добавление
<BulkAddExamples>
  <TextArea label="Вставьте поздравления, каждое с новой строки" />
  <Button>Далее — разметить</Button>
</BulkAddExamples>
```

---

## Структура проекта

```
/backend
  /app
    /api
      /routes
        auth.py
        users.py
        contacts.py
        categories.py
        events.py
        import_telegram.py
        import_google.py
        examples.py
        generation.py
        mass_holidays.py
    /core
      config.py
      security.py
    /services
      telegram_import.py
      google_import.py
      claude_generation.py
      greeting_search.py
    /models
      schemas.py
    main.py
  requirements.txt

/bot
  /handlers
    start.py
    upcoming.py
    generation.py
    feedback.py
  /services
    notifications.py
  main.py
  requirements.txt

/frontend
  /src
    /components
      /auth
      /contacts
      /categories
      /events
      /generation
      /examples
      /onboarding
    /pages
    /hooks
    /api
    /store
  package.json

/supabase
  /migrations
    001_initial_schema.sql
```

---

## Порядок разработки

### Фаза 1: Основа

1. Supabase: создать проект, применить миграции
2. Backend: настроить FastAPI, подключить Supabase
3. Auth: Telegram Login Widget
4. CRUD: contacts, events

### Фаза 2: Импорт

5. Telegram импорт контактов (Telethon)
6. Telegram поиск поздравлений
7. Модерация поздравлений (etalon/ok/skip)
8. Ручное добавление примеров

### Фаза 3: Генерация

9. Интеграция Claude API
10. Промпт с учётом стиля
11. Фидбек и обучение

### Фаза 4: Бот

12. Базовый бот (aiogram)
13. Напоминания (scheduler)
14. Генерация через бота

### Фаза 5: Веб

15. React: авторизация, онбординг
16. Главная, контакты, события
17. Генерация с фидбеком
18. Массовые праздники

### Фаза 6: Дополнительно

19. Google Contacts импорт
20. Полировка UI

---

## Переменные окружения

```
# Supabase
SUPABASE_URL=
SUPABASE_KEY=
SUPABASE_SERVICE_KEY=

# Telegram Bot
TELEGRAM_BOT_TOKEN=

# Telegram MTProto (для импорта)
TELEGRAM_API_ID=
TELEGRAM_API_HASH=

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Claude
ANTHROPIC_API_KEY=
```

---

## Массовые праздники

### Типы

| Праздник | Дата | Кому |
|----------|------|------|
| Новый год | 31 декабря | Всем |
| 8 марта | 8 марта | Женщинам (gender = 'female') |
| 23 февраля | 23 февраля | Мужчинам (gender = 'male') |

### Логика

1. За несколько дней до праздника показать экран «Массовые праздники»
2. Пользователь выбирает кому из подходящих контактов поздравить
3. Генерация персонализированных поздравлений для каждого выбранного
4. В день праздника — напоминание в боте с готовыми поздравлениями

---

## Модерация поздравлений из Telegram

### UI

```
┌─────────────────────────────────────────────┐
│ 🔍 Нашли 47 ваших поздравлений              │
│                                             │
│ Отметьте какие использовать для обучения:   │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ 👤 Вася Пупкин • друг • 15 марта 2024       │
│                                             │
│ «Серый, с днюхой! Чтоб всё было чётко,      │
│ здоровья и бабла)) Давай скоро увидимся»    │
│                                             │
│ [⭐ Эталон] [✓ Ок] [✗ Пропустить]           │
└─────────────────────────────────────────────┘

Итого: 12 ⭐ эталонных • 28 ✓ нормальных • 7 ✗ пропущено

[Готово]
```

### Три категории

| Оценка | Значение | Как используем |
|--------|----------|----------------|
| ⭐ Эталон | «Вот так и надо писать» | Высший приоритет в промпте |
| ✓ Ок | Нормальное | Используем для понимания стиля |
| ✗ Пропустить | Не нравится | Игнорируем |

---

## Добавление примеров вручную

### UI — один пример

```
┌─────────────────────────────────────────────┐
│ Добавить своё поздравление                  │
│                                             │
│ Текст:                                      │
│ ┌─────────────────────────────────────────┐ │
│ │ Машуль, с днём рождения! Ты самая       │ │
│ │ крутая, желаю тебе...                   │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ Кому было (опционально):                    │
│ [выбор контакта или ввод имени]             │
│                                             │
│ Тип отношений:                              │
│ ○ Близкий друг  ○ Друг  ○ Коллега          │
│ ○ Родственник   ○ Знакомый  ○ Клиент       │
│                                             │
│ Это:                                        │
│ ○ ⭐ Эталон — вот так и надо писать         │
│ ○ ✓ Нормальный пример                       │
│                                             │
│ [Добавить]                                  │
└─────────────────────────────────────────────┘
```

### UI — массовое добавление

```
┌─────────────────────────────────────────────┐
│ Добавить несколько поздравлений             │
│                                             │
│ Вставьте свои поздравления, каждое с новой  │
│ строки. Потом разметите их по одному.       │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ Серый, с днюхой! Здоровья и бабла))     │ │
│ │                                         │ │
│ │ Иван Петрович, поздравляю с днём        │ │
│ │ рождения! Успехов в работе.             │ │
│ │                                         │ │
│ │ Мам, с 8 марта! Ты лучшая ❤️            │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ [Далее — разметить каждое]                  │
└─────────────────────────────────────────────┘
```

---

## Фидбек при генерации

### UI

```
┌─────────────────────────────────────────────┐
│ Вариант 1:                                  │
│ «Серёга, поздравляю! Желаю чтобы...»        │
│                                             │
│ [👍 Хорошо] [👎 Плохо] [📋 Копировать]       │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Вариант 2:                                  │
│ «С днём рождения! Пусть этот год...»        │
│                                             │
│ [👍 Хорошо] [👎 Плохо] [📋 Копировать]       │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Вариант 3:                                  │
│ «Поздравляю с ДР! Всех благ!»               │
│                                             │
│ [👍 Хорошо] [👎 Плохо] [📋 Копировать]       │
└─────────────────────────────────────────────┘

[✏️ Написать свой вариант]
[🔄 Ещё варианты]
```

### При нажатии «Плохо»

```
┌─────────────────────────────────────────────┐
│ Что не так с этим вариантом?                │
│                                             │
│ ○ Слишком формально                         │
│ ○ Слишком фамильярно                        │
│ ○ Слишком длинно                            │
│ ○ Слишком коротко                           │
│ ○ Не мой стиль                              │
│                                             │
│ Комментарий (опционально):                  │
│ ┌─────────────────────────────────────────┐ │
│ │                                         │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ [Отправить]                                 │
└─────────────────────────────────────────────┘
```

### При нажатии «Написать свой»

```
┌─────────────────────────────────────────────┐
│ Напишите как вы бы поздравили этого         │
│ человека. Мы учимся на ваших примерах!      │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │                                         │ │
│ │                                         │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ [Сохранить и копировать]                    │
└─────────────────────────────────────────────┘
```

---

## Мини-опрос по стилю

Показывается при онбординге, если мало примеров поздравлений.

```
┌─────────────────────────────────────────────┐
│ Расскажите о своём стиле письма             │
│                                             │
│ Эмодзи в сообщениях:                        │
│ ○ Часто  ○ Иногда  ○ Никогда                │
│                                             │
│ Скобки )) вместо эмодзи:                    │
│ ○ Да  ○ Нет                                 │
│                                             │
│ Восклицательные знаки:                      │
│ ○ Много!!! ○ Один в конце! ○ Избегаю        │
│                                             │
│ Заглавные буквы:                            │
│ ○ Всегда правильно  ○ Часто с маленькой     │
│                                             │
│ Длина поздравлений:                         │
│ ○ Коротко  ○ Средне  ○ Развёрнуто           │
│                                             │
│ [Сохранить]                                 │
└─────────────────────────────────────────────┘
```
