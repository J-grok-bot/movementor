# Daily puzzles: wrong move -> Try again, Hint, clean solve, Analyze, Show solution, backlog after a date change,
# nav dot, no scroll jumps. Desktop (Chromium) + iPhone 13 (WebKit). Writes docs/screenshot-puzzle*.png (mobile).
# usage: python3 scripts/puzzles-test.py [baseUrl]
import sys, os, json, subprocess
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "docs") + os.sep
fails = []
def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: fails.append(msg)

def wrong_move(fen, sol):
    return subprocess.check_output(["node", os.path.join(ROOT, "scripts/puzzle-helper.mjs"), fen, sol], cwd=ROOT).decode().strip()

def phase(m): return m.get_attribute("[data-testid=puzzle]", "data-phase")
def wait_phase(m, *ph, timeout=8000):
    sel = ",".join(f"[data-testid=puzzle][data-phase={p}]" for p in ph)
    m.wait_for_selector(sel, timeout=timeout)

def tap(m, sq, mobile):
    el = m.locator(f"#puzzle-board [data-square={sq}], [data-testid=puzzle-board] [data-square={sq}]").first
    el.tap() if mobile else el.click()

def play(m, uci, mobile):
    tap(m, uci[:2], mobile); m.wait_for_timeout(80); tap(m, uci[2:4], mobile)
    if len(uci) > 4:
        m.wait_for_timeout(200); m.locator(f"[data-promo={uci[4]}], [data-testid=promo-{uci[4]}]").first.click()

def current(m, bundle):
    pid = m.get_attribute("[data-testid=puzzle]", "data-id")
    for lvl in ("easy", "hard"):
        for r in bundle[lvl]:
            if r[0] == pid: return {"id": pid, "fen": r[1], "moves": r[2].split(), "rating": r[3]}

def solve(m, pz, mobile):
    for i in range(1, len(pz["moves"]), 2):
        wait_phase(m, "playing"); m.wait_for_timeout(150)
        play(m, pz["moves"][i], mobile)
    wait_phase(m, "solved", "completed")

def run(m, mobile, label):
    errs = []; m.on("pageerror", lambda e: errs.append(str(e)))
    m.goto(BASE + "/puzzles", wait_until="networkidle")
    m.evaluate("localStorage.removeItem('movementor-puzzles')"); m.reload(wait_until="networkidle")
    bundle = m.evaluate("fetch('/puzzles.json').then(r=>r.json())")
    check(len(bundle["easy"]) > 500 and len(bundle["hard"]) > 500, f"[{label}] bundle {len(bundle['easy'])}+{len(bundle['hard'])}")
    wait_phase(m, "playing")
    check(m.locator("[data-testid=puzzle-dot]").count() == 1, f"[{label}] nav dot shows for unsolved puzzles")
    check(m.locator("[data-testid=today-chip]").count() == 2, f"[{label}] two daily puzzles")
    pz = current(m, bundle)
    stm = m.get_attribute("[data-testid=puzzle]", "data-fen").split()[1]
    orient = m.get_attribute("[data-testid=puzzle]", "data-orientation")
    check((stm == "w") == (orient == "white"), f"[{label}] board oriented to solver ({orient}), setup move applied")
    if mobile: m.screenshot(path=OUT + "screenshot-puzzle.png")
    m.evaluate("window.scrollTo(0, 120)"); m.wait_for_timeout(100)
    y0 = m.evaluate("scrollY"); top0 = m.evaluate("document.querySelector('[data-testid=puzzle-board]').getBoundingClientRect().top")
    # hint
    m.click("[data-testid=hint]"); m.wait_for_timeout(100)
    frm = pz["moves"][1][:2]
    st = m.locator(f"[data-testid=puzzle-board] [data-square={frm}]").first.evaluate("e => (e.getAttribute('style')||'') + (e.parentElement.getAttribute('style')||'') + e.innerHTML")
    check("56, 189, 248" in st or "56,189,248" in st or "#38bdf8" in st, f"[{label}] hint highlights {frm}")
    # wrong move
    fen = m.get_attribute("[data-testid=puzzle]", "data-fen")
    w = wrong_move(fen, pz["moves"][1])
    play(m, w, mobile); m.wait_for_timeout(150)
    check("Try again" in m.inner_text("[data-testid=puzzle-feedback]"), f"[{label}] wrong move {w} -> Try again")
    m.wait_for_timeout(800)
    check(m.get_attribute("[data-testid=puzzle]", "data-fen") == fen and phase(m) == "playing", f"[{label}] wrong move reverted, still playing")
    check(m.locator("[data-testid=today-chip][data-status=failed]").count() == 1, f"[{label}] failed attempt recorded")
    solve(m, pz, mobile)
    check(phase(m) == "completed", f"[{label}] finishing with mistakes stays unsolved")
    m.click("[data-testid=retry]"); m.wait_for_timeout(100); solve(m, pz, mobile)
    check(phase(m) == "solved", f"[{label}] clean retry solves")
    info = m.inner_text("[data-testid=puzzle-info]")
    check(f"Rating {pz['rating']}" in info and m.locator("[data-testid=puzzle-themes] span").count() > 0, f"[{label}] rating + themes shown")
    check(abs(m.evaluate("scrollY") - y0) < 2, f"[{label}] no scroll jump during play ({y0} -> {m.evaluate('scrollY')})")
    top1 = m.evaluate("document.querySelector('[data-testid=puzzle-board]').getBoundingClientRect().top")
    check(abs(top1 - top0) < 2, f"[{label}] board didn't move ({top0} -> {top1})")
    if mobile:
        m.evaluate("window.scrollTo(0,0)"); m.wait_for_timeout(200); m.screenshot(path=OUT + "screenshot-puzzle-solved.png")
    m.click("[data-testid=analyze]")
    m.wait_for_timeout(300)
    check(m.get_attribute("[data-testid=puzzle]", "data-fen") == fen, f"[{label}] analyze starts at the puzzle position")
    m.wait_for_function("() => /[0-9M]/.test(document.querySelector('[data-testid=puzzle-eval]')?.textContent||'') && (document.querySelector('[data-testid=puzzle-line]')?.textContent||'').length > 2", timeout=30000)
    check(len(m.inner_text("[data-testid=puzzle-line]").strip()) > 1, f"[{label}] analyze shows eval {m.inner_text('[data-testid=puzzle-eval]')} + line")
    # second puzzle: show solution
    chips = m.locator("[data-testid=today-chip]")
    other = 1 if chips.nth(0).get_attribute("data-status") == "solved" else 0
    chips.nth(other).click(); wait_phase(m, "playing")
    m.click("[data-testid=show-solution]"); m.wait_for_timeout(300)
    check(phase(m) == "revealed", f"[{label}] show solution")
    m.wait_for_timeout(3500)
    check(m.locator("[data-testid=today-chip][data-status=failed]").count() == 1, f"[{label}] show solution counts as not solved")
    check(m.locator("[data-testid=puzzle-dot]").count() == 1, f"[{label}] dot still shown (1 unsolved)")
    # simulate the day changing: the browser clock jumps to tomorrow, localStorage is kept
    yesterday = m.evaluate("(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})()")
    m.clock.install(time=m.evaluate("Date.now()") / 1000 + 86400)
    m.reload(wait_until="networkidle"); wait_phase(m, "playing")
    check(m.inner_text("[data-testid=backlog-count]") == "1", f"[{label}] backlog keeps yesterday's unsolved puzzle: {m.inner_text('[data-testid=backlog-count]')}")
    check(m.get_attribute("[data-testid=backlog-item]", "data-date") == yesterday, f"[{label}] backlog item dated {yesterday}")
    check(m.locator("[data-testid=today-chip][data-status=new]").count() == 2, f"[{label}] two fresh puzzles for the new day")
    check(m.locator("[data-testid=puzzle-dot]").count() == 1, f"[{label}] dot shown after the day changes")
    m.click("[data-testid=backlog-item]"); wait_phase(m, "playing")
    solve(m, current(m, bundle), mobile)
    check(phase(m) == "solved", f"[{label}] backlog puzzle solved")
    m.wait_for_timeout(200)
    check(m.inner_text("[data-testid=backlog-count]") == "0", f"[{label}] solved puzzle leaves the backlog")
    overflow = m.evaluate("document.documentElement.scrollWidth - innerWidth")
    check(overflow <= 0, f"[{label}] no horizontal overflow ({overflow})")
    check(not errs, f"[{label}] no page errors {errs[:2]}")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    run(b.new_context(viewport={"width": 1280, "height": 900}).new_page(), False, "desktop"); b.close()
    try:
        w = p.webkit.launch(); engine = "webkit"
    except Exception:  # WebKit needs host libs; fall back to Chromium with iPhone 13 emulation (touch, 390x844, DPR 3)
        w = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"]); engine = "chromium"
    dev = {k: v for k, v in p.devices["iPhone 13"].items() if k != "default_browser_type"}
    dev["viewport"] = {"width": 390, "height": 844}
    print("mobile engine:", engine)
    run(w.new_context(**dev).new_page(), True, "mobile"); w.close()
print("RESULT:", "PASS" if not fails else f"FAIL ({len(fails)})")
