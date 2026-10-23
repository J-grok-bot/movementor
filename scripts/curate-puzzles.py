# Curate a compact daily-puzzle set from the Lichess puzzle database (CC0).
# Download: https://database.lichess.org/lichess_db_puzzle.csv.zst (multi-GB uncompressed; not shipped).
# usage: python3 scripts/curate-puzzles.py /path/to/lichess_db_puzzle.csv.zst public/puzzles.json
# Columns: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
import csv, io, json, math, random, subprocess, sys
from collections import defaultdict

SRC, OUT = sys.argv[1], sys.argv[2]
PER_BAND = 215            # puzzles per 100-point rating band -> 7 bands per level
EASY, HARD = (800, 1500), (1500, 2200)
# themes that describe length/source/result rather than the tactic
META = {"short", "long", "veryLong", "oneMove", "master", "masterVsMaster", "superGM", "crushing", "advantage",
        "equality", "opening", "middlegame", "endgame", "mate", "kingsideAttack", "queensideAttack", "defensiveMove",
        "quietMove", "playerGame"}
DROP = {"master", "masterVsMaster", "superGM", "playerGame", "short", "long", "veryLong", "oneMove"}  # not shown
MATE_CAP = 0.3  # at most 30% mating puzzles per band so tactics stay varied

cands = defaultdict(list)  # band -> rows
p = subprocess.Popen(["zstd", "-dc", SRC], stdout=subprocess.PIPE)
rd = csv.reader(io.TextIOWrapper(p.stdout, encoding="utf-8"))
next(rd)
total = 0
for r in rd:
    total += 1
    pid, fen, moves, rating, rd_, pop, plays, themes = r[:8]
    rating, rd_, pop, plays = int(rating), int(rd_), int(pop), int(plays)
    if not (EASY[0] <= rating < HARD[1]) or rd_ > 80 or pop < 92 or plays < 3000:
        continue
    n = len(moves.split())
    if n < 2 or n > 8:  # 1-4 solver moves
        continue
    th = themes.split()
    tactic = [t for t in th if t not in META and not t.startswith("mateIn")]
    mates = [t for t in th if t.startswith("mateIn")]
    primary = tactic[0] if tactic else (mates[0] if mates else (th[0] if th else "misc"))
    score = pop * math.log10(plays)
    cands[rating // 100].append((score, primary, pid, fen, moves, rating, " ".join(t for t in th if t not in DROP)))
p.wait()

def pick(band):
    by = defaultdict(list)
    for c in sorted(cands[band], reverse=True):
        by[c[1]].append(c)
    order = sorted(by, key=lambda t: -len(by[t]))
    out, i, mates = [], 0, 0
    while len(out) < PER_BAND and any(by.values()):
        t = order[i % len(order)]; i += 1
        while by[t]:
            c = by[t].pop(0)
            is_mate = "mate" in c[6].split()
            if is_mate and mates >= MATE_CAP * PER_BAND:
                continue
            mates += is_mate
            out.append(c)
            break
    return out

rng = random.Random(20261022)
res = {}
for name, (lo, hi) in (("easy", EASY), ("hard", HARD)):
    rows = [c for b in range(lo // 100, hi // 100) for c in pick(b)]
    rng.shuffle(rows)
    res[name] = [[c[2], c[3], c[4], c[5], c[6]] for c in rows]
bundle = {"source": "Lichess puzzle database (CC0), https://database.lichess.org/#puzzles", **res}
with open(OUT, "w") as f:
    json.dump(bundle, f, separators=(",", ":"))
themes = defaultdict(int)
for k in ("easy", "hard"):
    for r in res[k]:
        for t in r[4].split(): themes[t] += 1
mate = sum("mate" in r[4].split() for k in ("easy", "hard") for r in res[k])
print(f"mate share {mate / (len(res['easy']) + len(res['hard'])):.0%}")
print(f"scanned {total} puzzles; candidates {sum(map(len, cands.values()))}; easy {len(res['easy'])} hard {len(res['hard'])}")
print("top themes:", sorted(themes.items(), key=lambda x: -x[1])[:25])
