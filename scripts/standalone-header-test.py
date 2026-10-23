# iOS home-screen (standalone) header: emulate display-mode: standalone + a 47px top safe-area inset at 390x844 and
# check the status-bar cover is present, opaque, above the header, and doesn't overlap the nav tabs (no blur/scrim
# layer over them, no transforms on the tabs). Screenshots the header of every tab to docs/screenshot-standalone-header.png.
# usage: python3 scripts/standalone-header-test.py [baseUrl]
import sys, os
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs") + os.sep
fails = []
def check(c, msg):
    print(("PASS " if c else "FAIL ") + msg)
    if not c: fails.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    dev = {k: v for k, v in p.devices["iPhone 13"].items() if k != "default_browser_type"}
    m = b.new_context(**dev).new_page()
    cdp = m.context.new_cdp_session(m)
    # Chromium can't emulate display-mode via CDP; iOS exposes navigator.standalone in home-screen apps, which the
    # layout's inline script also reads.
    m.add_init_script("Object.defineProperty(navigator, 'standalone', { get: () => true })")
    try:
        cdp.send("Emulation.setSafeAreaInsetsOverride", {"insets": {"top": 47, "bottom": 34}})
        inset = 47
    except Exception as e:
        print("note: safe-area override unsupported:", e); inset = 0
    shots = []
    for path in ["/", "/openings", "/puzzles", "/analyze"]:
        m.goto(BASE + path, wait_until="networkidle"); m.wait_for_selector("[data-testid=nav-analyze]")
        info = m.evaluate("""() => {
          const c = document.querySelector('[data-testid=status-bar-cover]'), cs = getComputedStyle(c), r = c.getBoundingClientRect();
          const nav = document.querySelector('[data-testid=nav-review]').closest('nav') || document.querySelector('[data-testid=nav-review]').parentElement;
          const n = nav.getBoundingClientRect();
          let el = document.querySelector('[data-testid=nav-review]'), bad = [];
          while (el && el !== document.body) { const s = getComputedStyle(el);
            if ((s.transform !== 'none') || s.filter !== 'none' || s.backdropFilter !== 'none' && s.backdropFilter || s.willChange !== 'auto') bad.push(el.tagName + ':' + s.transform + '/' + s.filter + '/' + s.willChange);
            el = el.parentElement; }
          const hit = document.elementFromPoint(n.left + 10, n.top + n.height / 2);
          return { display: cs.display, h: r.height, bg: cs.backgroundColor, navTop: n.top, navRight: n.right, w: innerWidth, bad, hitInNav: nav.contains(hit) };
        }""")
        check(info["display"] == "block" and info["h"] >= max(6, inset) - 0.5 and "0, 0, 0, 0" not in info["bg"], f"{path}: opaque status-bar cover {info['h']:.0f}px {info['bg']}")
        check(info["navTop"] >= info["h"], f"{path}: nav (top {info['navTop']:.0f}) starts below the cover ({info['h']:.0f})")
        check(info["hitInNav"], f"{path}: nothing layered over the tabs")
        check(not info["bad"], f"{path}: no transform/filter/will-change on the tabs or ancestors {info['bad']}")
        check(info["navRight"] <= info["w"], f"{path}: 4 tabs fit ({info['navRight']:.0f} <= {info['w']})")
        f = f"/tmp/standalone-{path.strip('/') or 'review'}.png"; m.screenshot(path=f, clip={"x": 0, "y": 0, "width": 390, "height": 110}); shots.append(f)
    # normal browser tab: no cover
    m2 = b.new_context(**dev).new_page(); m2.goto(BASE + "/analyze", wait_until="networkidle")
    check(m2.evaluate("getComputedStyle(document.querySelector('[data-testid=status-bar-cover]')).display") == "none", "browser tab: no cover")
    b.close()
from PIL import Image
ims = [Image.open(f) for f in shots]
out = Image.new("RGB", (ims[0].width, sum(i.height for i in ims) + 6 * (len(ims) - 1)), "#ffffff")
y = 0
for i in ims: out.paste(i, (0, y)); y += i.height + 6
out.save(OUT + "screenshot-standalone-header.png")
print("RESULT:", "PASS" if not fails else f"FAIL ({len(fails)})")
sys.exit(1 if fails else 0)
