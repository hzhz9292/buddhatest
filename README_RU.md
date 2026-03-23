# Buddha Chat — liquid glass UI patch

Это фронтово-подтянутый архив Buddha Chat на базе рабочей версии.
Внутри:
- server.js
- package.json
- public/
- data/db.json
- uploads/.gitkeep

Запуск на Render:
Build Command:
rm -rf node_modules package-lock.json && npm install --include=dev --no-audit --no-fund

Start Command:
node server.js

Environment Variables:
NODE_VERSION=20
SESSION_SECRET=длинная_случайная_строка
