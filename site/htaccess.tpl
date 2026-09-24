# =====================================================================
#  {{host}} — .htaccess для виртуального хостинга Timeweb
#  (nginx спереди, Apache сзади). Собирается tools/build.py.
#
#  ПРОЧТИ ПЕРЕД ПРАВКОЙ
#  1. Файлы со «статичными» расширениями nginx отдаёт САМ, этот файл к ним
#     не применяется: jpg png webp svg css js txt woff2 ico и др.
#     Значит, заголовки ниже получают HTML, JSON, XML, avif и редиректы,
#     а запреты ниже НЕ закрывают случайно залитые .txt/.js.
#     Защита от утечки — заливать только dist/ (белый список сборки).
#  2. Статику nginx кеширует на год. Сборка ставит ?v=<хэш> на каждую
#     ссылку, поэтому новая версия файла всегда приходит заново.
#  3. После каждой правки — проверка из DEPLOY.md (раздел «Проверка»).
# =====================================================================

AddDefaultCharset utf-8
DirectoryIndex index.html

# Без листинга каталогов и без угадывания файлов по имени.
# Если сайт после заливки отдаёт 500 — хостинг не разрешает Options:
# закомментируйте строку и проверьте, что /img/ не показывает список.
Options -Indexes -MultiViews

ErrorDocument 404 /404.html
ErrorDocument 403 /404.html

<IfModule mod_mime.c>
  AddType image/avif                 .avif
  AddType application/manifest+json  .webmanifest
  AddType application/json           .json
  AddType application/xml            .xml
  AddType font/woff2                 .woff2
  AddCharset utf-8 .html .json .xml .webmanifest
</IfModule>

<IfModule mod_rewrite.c>
  RewriteEngine On

  # 0. Проверку Let's Encrypt не трогаем.
  RewriteRule ^\.well-known/acme-challenge/ - [L]

  # 1. Служебное — как будто его нет.
  RewriteCond %{REQUEST_URI} !^/\.well-known/
  RewriteRule (^|/)\. - [R=404,L]
  RewriteRule ^(tools|site|art|data|node_modules|dist)(/|$) - [R=404,L,NC]
  RewriteRule \.(md|mjs|cjs|ts|py|pyc|sh|bat|ps1|log|bak|orig|old|swp|tmp|env|key|pem|crt|sql|ini|conf|cfg|lock|map|yml|yaml|tpl)$ - [R=404,L,NC]

  # 2. Один адрес: https://{{host}}, одним прыжком.
  RewriteCond %{HTTP_HOST} !^{{host_re}}$ [NC]
  RewriteRule ^ https://{{host}}%{REQUEST_URI} [R=301,L]
  # TLS снимает nginx и сообщает Apache заголовком X-HTTPS: 1 (справка
  # Timeweb); %{HTTPS} здесь всегда off. Если получится бесконечный
  # редирект — закомментируйте три строки ниже и включите «Перенаправлять
  # на HTTPS» в панели Timeweb.
  RewriteCond %{HTTP:X-HTTPS} !^1$
  RewriteCond %{HTTP:X-Forwarded-Proto} !^https$ [NC]
  RewriteRule ^ https://{{host}}%{REQUEST_URI} [R=301,L]

  # 3. Папка без слэша → со слэшем, сразу на https. Сам Apache (mod_dir)
  #    добавил бы слэш с http://: TLS снимает nginx, и Apache думает, что
  #    соединение открытое. Поэтому DirectorySlash выключен ниже.
  RewriteCond %{REQUEST_FILENAME} -d
  RewriteRule ^(.*[^/])$ https://{{host}}/$1/ [R=301,L]

  # 4. /index.html → / (без дублей для поисковиков), тоже сразу на https.
  RewriteCond %{THE_REQUEST} \s/+(.*/)?index\.html[\s?] [NC]
  RewriteRule ^(.*/)?index\.html$ https://{{host}}/$1 [R=301,L]
</IfModule>

<IfModule mod_dir.c>
  DirectorySlash Off
</IfModule>

<IfModule mod_headers.c>
  # HSTS: на запуске 5 минут; через неделю без проблем — 604800,
  # ещё через две — 31536000. includeSubDomains и preload не ставить.
  Header always set Strict-Transport-Security "max-age=300"

  Header always set Content-Security-Policy "{{csp_header}}"
  Header always set X-Content-Type-Options "nosniff"
  Header always set X-Frame-Options "DENY"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set Cross-Origin-Opener-Policy "same-origin"
  Header always set Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()"
  Header always unset X-Powered-By

  # Страницы — всегда сверяться с сервером (ETag → 304).
  <FilesMatch "\.(html|json|xml|webmanifest)$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
  # avif отдаёт Apache — у него адрес с версией, кешировать на год.
  <FilesMatch "\.avif$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
</IfModule>
