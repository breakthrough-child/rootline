#!/usr/bin/env bash
# Regenerates the sample source files in fixtures/files. Everything here is FICTIONAL:
# the account, the organisation, the reference number and the signatory do not exist.
# Requires ImageMagick (convert) and LibreOffice (soffice).
set -euo pipefail
cd "$(dirname "$0")/../fixtures/files"

# 1) Screenshot of a post from a clearly fictional account.
convert -size 900x560 xc:white \
  -fill '#d9d9d9' -draw "circle 70,80 70,40" \
  -fill '#0f1419' -font DejaVu-Sans-Bold -pointsize 28 -annotate +130+75 'Kemi Reports' \
  -fill '#536471' -font DejaVu-Sans -pointsize 24 -annotate +130+110 '@kemi_reports_247' \
  -fill '#0f1419' -font DejaVu-Sans -pointsize 27 -interline-spacing 8 -annotate +50+180 \
'URGENT! Men are offering free perfume samples at filling
stations in Lagos and Abuja. You smell it and you faint,
then they kidnap you. 2,000 women missing this month.
Police have confirmed. Forward to every woman you know!' \
  -fill '#536471' -pointsize 22 -annotate +50+420 '9:14 PM · Oct 3, 2026' \
  -fill '#536471' -pointsize 22 -annotate +50+480 '12.4K Reposts   31K Likes' \
  -fill '#1d9bf0' -pointsize 18 -annotate +50+530 'FICTIONAL ACCOUNT - Rootline demo fixture' \
  screenshot-kemi-reports.png

# 2) A fake-looking circular from a clearly fictional organisation.
cat > circular-focr.html <<'HTML'
<html><body style="font-family:DejaVu Serif">
<p style="text-align:center"><b>FEDERAL OFFICE OF CIVIC READINESS</b><br/>(fictional organisation — Rootline demo fixture)</p>
<p>Ref: FOCR/CIR/2026/117<br/>Date: 9th October 2026</p>
<p><b>CIRCULAR TO ALL HEADS OF SCHOOLS AND PARENTS</b></p>
<p>Following the outbreak of Lassa variant X, all schools nationwide will close for three weeks from Monday 12th October 2026.</p>
<p>Parents are advised to keep their children at home and avoid public gatherings until further notice.</p>
<p>Schools that remain open will be sanctioned. Forward this circular to all parents.</p>
<p>Signed,<br/>Mr. T. Okafor-Bello<br/>Director General (fictional)</p>
</body></html>
HTML
soffice --headless --convert-to pdf circular-focr.html >/dev/null 2>&1
soffice --headless --convert-to docx:"MS Word 2007 XML" circular-focr.html >/dev/null 2>&1
rm -f circular-focr.html

# 3) A scanned (image-only) version of the circular, for the OCR path.
convert -density 110 circular-focr.pdf[0] -flatten -colorspace Gray -rotate 0.4 -background white -quality 80 scanned-page.jpg
convert scanned-page.jpg -page A4 scanned-circular.pdf
rm -f scanned-page.jpg

# 4) Text forwards used by the demo fixtures (real, widely-circulated rumors, paraphrased as they typically arrive).
cat > forward-perfume.txt <<'TXT'
Please be careful ladies!!! Some men are standing at filling stations and malls giving women free perfume samples. Once you smell it you will faint and they will kidnap you and harvest your organs. Many women have gone missing. Please share this with every woman you know. Don't take anything from strangers!
TXT
cat > forward-martinelli.txt <<'TXT'
WARNING! If you receive a video called MARTINELLI do not open it. It is a virus that will hack your phone and nothing can stop it, even if it comes from a friend. This has been confirmed by CNN and BBC. Please pass this to everyone in your contact list.
TXT
ls -la
