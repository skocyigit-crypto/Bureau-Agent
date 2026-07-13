# Alternatif kurulum — Docker olmadan

Bu klasör, Docker kullanmak istemeyenler için **doğrudan sunucuya kurulum** dosyalarını içerir:
- `setup.sh` — Ubuntu/Debian sunucusunda Node, pnpm, Postgres, nginx, PM2 kurar
- `nginx.conf` — Caddy yerine nginx ile reverse proxy
- `ecosystem.config.js` — PM2 ile process yönetimi (Docker yerine)

> **Not:** Önerilen yol Docker Compose'tur (bkz. `MIGRATION.md` ana rehberi). Bu klasördeki dosyalar yalnızca Docker'ın seçenek olmadığı durumlar için saklanmıştır.

## Hızlı kullanım
```bash
# 1. Sunucu hazırlığı
sudo bash deploy/non-docker/setup.sh

# 2. Postgres'e şema
DATABASE_URL=postgresql://... npx --package drizzle-kit drizzle-kit push --config=lib/db/drizzle.config.ts

# 3. Build
pnpm install --frozen-lockfile
pnpm build

# 4. PM2 ile başlat
pm2 start deploy/non-docker/ecosystem.config.js
pm2 save && pm2 startup

# 5. Nginx
sudo cp deploy/non-docker/nginx.conf /etc/nginx/sites-available/agentdebureau
sudo ln -s /etc/nginx/sites-available/agentdebureau /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 6. HTTPS (certbot)
sudo certbot --nginx -d app.sirketim.fr
```

Detay için her dosyanın başındaki yorumlara bakın.
