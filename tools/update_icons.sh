#!/usr/bin/env bash
# Rebuilds javascript/fonts/material-symbols-rounded.woff2 with only the icons the
# extension uses. Run from the extension root after adding a new icon:
#   tools/update_icons.sh
#
# Icons are found as the text of elements with class "material-symbols-rounded", as
# icon('name') / iconName: 'name' calls, and in the ICONS list below (names that are
# only built at runtime).
set -euo pipefail

ICONS="check_circle warning error help folder folder_open description close delete edit_note spellcheck casino content_copy"

found=$(
  {
    grep -ohE 'material-symbols-rounded[^>]*>[a-z0-9_]+<' scripts/prompt_lab/ui/*.py javascript/*.js | sed -E 's/.*>([a-z0-9_]+)<$/\1/'
    grep -ohE "icon\('[a-z0-9_]+'" javascript/*.js | sed -E "s/.*'([a-z0-9_]+)'/\1/"
    grep -ohE "iconName(: | = )'[a-z0-9_]+'" javascript/*.js | sed -E "s/.*'([a-z0-9_]+)'/\1/"
    tr ' ' '\n' <<<"$ICONS"
  } | sort -u
)
names=$(paste -sd, - <<<"$found")
echo "Icons: $names"

css=$(curl -fsSL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0,0&icon_names=${names}")
url=$(grep -oE 'https://fonts\.gstatic\.com[^)]+' <<<"$css" | head -1)
[ -n "$url" ] || { echo "Could not find the font URL in the Google Fonts response" >&2; exit 1; }

curl -fsSL "$url" -o javascript/fonts/material-symbols-rounded.woff2
echo "Wrote javascript/fonts/material-symbols-rounded.woff2 ($(wc -c < javascript/fonts/material-symbols-rounded.woff2) bytes)"

# The font is referenced from CSS, so give its URL a version that changes with the file.
hash=$(cksum < javascript/fonts/material-symbols-rounded.woff2 | cut -d' ' -f1)
sed -i.bak -E "s#(fonts/material-symbols-rounded\.woff2)(\?v=[0-9]+)?#\1?v=${hash}#" javascript/spl_common.css
rm -f javascript/spl_common.css.bak
