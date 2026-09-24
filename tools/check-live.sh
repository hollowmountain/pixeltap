#!/usr/bin/env bash
# Проверка живого сайта после выкладки. Ничего не меняет, только читает.
#   tools/check-live.sh [https://pixeltapi.ru]
set -uo pipefail
H="${1:-https://pixeltapi.ru}"
H="${H%/}"
HOST="${H#https://}"
C="curl -s --max-time 15"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
ok=0; bad=0
pass() { printf '  ok    %s\n' "$1"; ok=$((ok+1)); }
fail() { printf '  FAIL  %s\n' "$1"; bad=$((bad+1)); }

echo "== главная и заголовки"
hdr=$($C -I "$H/")
echo "$hdr" | head -1 | grep -q ' 200' && pass "главная 200" || fail "главная не 200"
for h in strict-transport-security content-security-policy x-frame-options x-content-type-options referrer-policy permissions-policy; do
  echo "$hdr" | grep -qi "^$h:" && pass "$h" || fail "нет заголовка $h (mod_headers?)"
done
echo "$hdr" | grep -qi "frame-ancestors 'none'" && pass "CSP запрещает встраивание" || fail "в CSP нет frame-ancestors"

echo "== редиректы (должен быть один прыжок на https://$HOST/)"
for u in "http://$HOST/" "https://www.$HOST/" "http://www.$HOST/x" "$H/lanolin" "$H/privacy" "$H/index.html" "$H/lanolin/index.html"; do
  loc=$($C -I "$u" | awk 'tolower($1)=="location:"{print $2}' | tr -d '\r')
  case "$loc" in https://$HOST/*) pass "$u → $loc";; *) fail "$u → ${loc:-нет редиректа}";; esac
done

echo "== служебное не отдаётся (ждём 404/403)"
for p in .git/config .git/HEAD .gitignore .env env.txt README.md DESIGN.md PRODUCT.md DEPLOY.md \
         tools/build.py tools/site-config.json data/catalog.json data/private/catalog-full.json art/ site/ htaccess.tpl img/manifest.json; do
  c=$($C -o /dev/null -w '%{http_code}' "$H/$p")
  case "$c" in 404|403) pass "$p $c";; *) fail "$p отдаёт $c";; esac
done
c=$($C -o /dev/null -w '%{http_code}' "$H/img/"); case "$c" in 404|403) pass "листинг /img/ закрыт";; *) fail "листинг /img/: $c";; esac

echo "== страницы"
for p in lanolin/ privacy/ robots.txt sitemap.xml site.webmanifest favicon.ico img/og.jpg; do
  c=$($C -o /dev/null -w '%{http_code}' "$H/$p"); [ "$c" = 200 ] && pass "$p" || fail "$p → $c"
done
$C "$H/nope-$$" -o "$TMP" -w '%{http_code}' | grep -q 404 && grep -q "Такой страницы" "$TMP" && pass "своя 404" || fail "404 не своя"
for p in lanolin/ nope-$$; do
  $C -I "$H/$p" | grep -qi "^content-security-policy:.*frame-ancestors" && pass "CSP на /$p" || fail "нет CSP на /$p"
done

echo "== сертификат"
echo | openssl s_client -connect "$HOST:443" -servername "$HOST" 2>/dev/null | openssl x509 -noout -ext subjectAltName 2>/dev/null | grep -q "$HOST" \
  && pass "сертификат на $HOST" || fail "сертификат не на $HOST"

echo
echo "итого: ok $ok, fail $bad"
[ "$bad" -eq 0 ]
