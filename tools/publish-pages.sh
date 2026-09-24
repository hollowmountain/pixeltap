#!/bin/sh
# Предпросмотр сайта на GitHub Pages: https://hollowmountain.github.io/pixeltap/
#
#   tools/publish-pages.sh          собрать и показать, что уйдёт
#   tools/publish-pages.sh --go     собрать и выложить
#
# Собирает dist-pages/ (build.py --pages: адреса с /pixeltap/, страницы
# закрыты от поисковиков) и кладёт его единственным коммитом в ветку
# gh-pages. История этой ветки намеренно не копится: там результат сборки,
# а не исходник, и 13 МБ картинок на каждый запуск раздули бы репозиторий.
# Исходники живут в обычных ветках.
#
# В настройках репозитория: Settings → Pages → Deploy from a branch →
# gh-pages, / (root).
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

REMOTE=$(git remote get-url origin)
case "$REMOTE" in
  git@github-hollow:hollowmountain/pixeltap.git|git@github.com:hollowmountain/pixeltap.git|https://github.com/hollowmountain/pixeltap.git) ;;
  *) echo "origin не похож на репозиторий сайта: $REMOTE" >&2; exit 1 ;;
esac

python3 tools/build.py --pages

SRC=$(git rev-parse --short HEAD)
[ -n "$(git status --porcelain)" ] && SRC="$SRC с незакоммиченными правками"
NAME=$(git config user.name || true)
MAIL=$(git config user.email || true)
[ -n "$NAME" ] && [ -n "$MAIL" ] || { echo "в репозитории не задан git user.name/user.email" >&2; exit 1; }

if [ "${1:-}" != "--go" ]; then
  echo "пробный запуск: в gh-pages уйдёт $(find dist-pages -type f | wc -l | tr -d ' ') файлов из сборки $SRC"
  echo "выложить: tools/publish-pages.sh --go"
  exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp -R dist-pages/. "$TMP/"
touch "$TMP/.nojekyll"   # без него Pages прогоняет файлы через Jekyll

cd "$TMP"
git init -q -b gh-pages
git add -A
git -c user.name="$NAME" -c user.email="$MAIL" commit -q -m "Предпросмотр сайта из $SRC"
git push -q -f "$REMOTE" gh-pages:gh-pages
echo "выложено: https://hollowmountain.github.io/pixeltap/ (Pages обновляется за минуту-две)"
