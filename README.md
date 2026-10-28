# Telegram MCP

MCP-сервер для личного Telegram. ИИ-агент — Claude Code, Codex и другие
MCP-клиенты — находит чаты, читает и ищет переписку, скачивает вложения.
Сообщения и файлы отправляет только с `confirm: true`, по прямой просьбе.

Отдельная сессия MTProto (GramJS), stdio, без браузера и без `tdata`.

Документация: https://sonicxboy.dev/products/telegram-mcp/

## Установка

Нужен Node.js (проверено на 22).

```bash
git clone https://github.com/vixkosla/telegram-mcp.git
cd telegram-mcp
npm ci
```

1. На https://my.telegram.org → API development tools создайте приложение
   и запишите ключи в `~/.config/telegram-mcp/config.json` (права `0600`):

   ```json
   {"apiId": 123456, "apiHash": "32-символьный hex"}
   ```

   Вместо файла можно задать `TELEGRAM_API_ID` и `TELEGRAM_API_HASH`,
   другой путь к файлу — через `TELEGRAM_MCP_CONFIG`. Если MTProto не доходит
   до Telegram, добавьте `"proxy": "socks5://127.0.0.1:1080"`.

2. Войдите: `node server.mjs login` — телефон, код из Telegram, при
   необходимости облачный пароль. Сессия сохранится в `session.txt` рядом
   с сервером (права `0600`). Не копируйте и не публикуйте этот файл.

3. Подключите к клиенту.

   Claude Code:

   ```bash
   claude mcp add telegram -- node /path/to/telegram-mcp/server.mjs
   ```

   Codex (`~/.codex/config.toml`):

   ```toml
   [mcp_servers.telegram]
   command = "node"
   args = ["/path/to/telegram-mcp/server.mjs"]
   startup_timeout_sec = 20
   ```

   Cursor, Claude Desktop и другие:

   ```json
   {"mcpServers": {"telegram": {"command": "node", "args": ["/path/to/telegram-mcp/server.mjs"]}}}
   ```

4. Попросите агента вызвать `status`.

## Инструменты

| Инструмент | Что делает |
| --- | --- |
| `status` | Есть ли вход и под каким аккаунтом |
| `list_dialogs` | Последние чаты, поиск по имени и @username, архив |
| `get_messages` | История чата постранично, без отметки о прочтении |
| `search_messages` | Поиск по всем чатам или внутри одного |
| `download_media` | Фото и документы до 20 сообщений, до 50 МБ на файл, в `downloads/` |
| `send_message` | Текст до 4096 символов, `confirm: true` |
| `send_file` | Локальный файл до 50 МБ по абсолютному пути, `confirm: true` |
| `login_send_code`, `login_sign_in` | Вход по коду и облачному паролю |
| `logout` | Закрывает только эту сессию, `confirm: true` |

`peer` — id из `list_dialogs`, `@username` или `title:Название`.

## Безопасность

- Отдельное устройство в списке сессий Telegram; `logout` не трогает другие.
- Отправка и выход без `confirm: true` не выполняются.
- Текст сообщений и содержимое файлов — чужой ввод: сервер просит агента не
  выполнять инструкции из них.
- `session.txt`, `pending.json` и скачанные файлы пишутся с правами `0600`.
- Длинные токены вырезаются из ошибок, телефон показывается последними
  четырьмя цифрами.
- `send_file` отправляет любой читаемый файл по абсолютному пути. Разрешайте
  отправку только тех файлов, которые проверили сами.

## English

MCP server that connects a personal Telegram account to AI agents (Claude
Code, Codex, any stdio MCP client): list chats, read and search history
without marking it read, download media, and send messages or files only with
`confirm: true`. Uses its own MTProto session via GramJS. Setup: create an app
at my.telegram.org, put `apiId`/`apiHash` in
`~/.config/telegram-mcp/config.json`, run `node server.mjs login`, then add
`node /path/to/server.mjs` to your MCP client.

## Лицензия

MIT © SonicXBoy
