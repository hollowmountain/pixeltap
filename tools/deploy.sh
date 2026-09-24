#!/usr/bin/env bash
# Выкладка dist/ на хостинг Timeweb по SSH (rsync).
#
#   PT_SSH=логин@хост PT_PATH=/home/c/логин/pixeltapi.ru/public_html tools/deploy.sh        — показать, что изменится
#   PT_SSH=логин@хост PT_PATH=/home/c/логин/pixeltapi.ru/public_html tools/deploy.sh --go   — выложить
#
# Доступы в репозиторий не пишутся: логин, хост и путь — только в
# переменных окружения. Вход — по SSH-ключу (панель Timeweb → SSH).
#
# Защита от ошибки в пути: rsync запускается с --delete, то есть удаляет
# в папке на сервере всё, чего нет в dist/. Поэтому путь обязан содержать
# «pixeltapi» и заканчиваться на public_html — иначе скрипт откажется,
# чтобы случайно не снести соседний сайт на том же аккаунте.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${PT_SSH:?укажите PT_SSH=логин@хост}"
: "${PT_PATH:?укажите PT_PATH=/…/pixeltapi.ru/public_html}"

# Путь — строго папка сайта pixeltapi.ru, без «..» и лишних сегментов.
if [[ "$PT_PATH" == *..* ]] || ! [[ "$PT_PATH" =~ ^/home/[a-z0-9]/[A-Za-z0-9_-]+/pixeltapi\.ru/public_html/?$ ]]; then
  echo "Отказ: путь «$PT_PATH» не похож на /home/<буква>/<логин>/pixeltapi.ru/public_html" >&2
  exit 2
fi

python3 tools/build.py --release

DRY="--dry-run"
[ "${1:-}" = "--go" ] && DRY=""

# -c: сравнение по содержимому, а не по времени — после сборки у всех
# файлов новое время, и без -c rsync гонял бы всё заново.
# --max-delete: если путь всё же не тот, rsync остановится, не успев
# снести чужой сайт. Файлы проверки Let's Encrypt и подтверждения
# Вебмастера/Search Console на сервере не трогаем.
rsync -rlcvz --delete --max-delete=150 $DRY \
  --exclude '.DS_Store' \
  --filter 'P /.well-known/acme-challenge/' \
  --filter 'P /yandex_*.html' \
  --filter 'P /google*.html' \
  dist/ "$PT_SSH:${PT_PATH%/}/"

if [ -n "$DRY" ]; then
  echo
  echo "Это был пробный прогон. Выложить: tools/deploy.sh --go"
else
  echo
  echo "Выложено. Проверка: tools/check-live.sh"
fi
