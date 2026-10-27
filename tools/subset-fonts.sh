#!/usr/bin/env bash
# Rebuilds src/fonts/*.woff2 from the variable fonts on Google Fonts.
# Needs Python with fonttools and brotli: python3 -m pip install fonttools brotli
# Usage: tools/subset-fonts.sh [workdir]
set -euo pipefail
cd "$(dirname "$0")/.."
out="$PWD/src/fonts"
work="${1:-$(mktemp -d)}"
cd "$work"

base=https://raw.githubusercontent.com/google/fonts/main/ofl
curl -sSfL -o serif.ttf "$base/sourceserif4/SourceSerif4%5Bopsz%2Cwght%5D.ttf"
curl -sSfL -o serif-italic.ttf "$base/sourceserif4/SourceSerif4-Italic%5Bopsz%2Cwght%5D.ttf"
curl -sSfL -o sans.ttf "$base/sourcesans3/SourceSans3%5Bwght%5D.ttf"

# Latin, Greek, typographic punctuation, super/subscript digits, arrows, and the math signs prose uses.
text="U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+0160-0161,U+0178,U+017D-017E,U+0192,U+02C6,U+02DA,U+02DC,U+0391-03A9,U+03B1-03C9,U+03D1,U+03D5,U+03F5,U+2002-2014,U+2018-201E,U+2020-2022,U+2026,U+2030,U+2032-2033,U+2039-203A,U+2044,U+2070-209F,U+20AC,U+2103,U+2116,U+2122,U+2190-21FF,U+21D2,U+21D4,U+2202,U+2206,U+2208,U+2211-221E,U+2220,U+2227-222B,U+2248,U+2260-2265,U+22C5,U+2713"
features="kern,liga,ccmp,locl,mark,mkmk,smcp,c2sc,onum,lnum,tnum,pnum,frac,numr,dnom,sups,subs,case"
subset() { python3 -m fontTools.subset "$1" --unicodes="$2" --layout-features="$3" --flavor=woff2 --output-file="$4" --no-hinting --desubroutinize; }

python3 -m fontTools.varLib.instancer serif.ttf opsz=18 wght=400:700 -o st.ttf -q
python3 -m fontTools.varLib.instancer serif-italic.ttf opsz=18 wght=400:600 -o si.ttf -q
python3 -m fontTools.varLib.instancer serif.ttf opsz=48 wght=560 -o sd.ttf -q
python3 -m fontTools.varLib.instancer sans.ttf wght=400:650 -o ss.ttf -q
subset st.ttf "$text" "$features" "$out/serif-text.woff2"
subset si.ttf "$text" "$features" "$out/serif-text-italic.woff2"
subset sd.ttf "U+0020-007E,U+00A0-00FF,U+2013-2014,U+2018-201D,U+2026" "kern,liga,ccmp,locl,mark,mkmk,lnum,case" "$out/serif-display.woff2"
subset ss.ttf "$text" "$features" "$out/sans.woff2"
ls -l "$out"/*.woff2
