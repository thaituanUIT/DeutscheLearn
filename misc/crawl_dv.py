"""
Crawler cho deutsch-vorbereitung.com (Lesen / Hoeren / Schreiben ... Uebungen)
Xuat ra 2 file CSV:
  - <out>_questions.csv : moi dong = 1 cau hoi
  - <out>_exercises.csv : moi dong = 1 bai tap (text doc hieu)

Vi du:
  python crawl_dv.py --url https://deutsch-vorbereitung.com/lesen-a1-goethe-uebungen-6-pruefung-1.html \
                     --out goethe_a1_lesen --with-answers --delay 1.5

Options:
  --teil N        chi crawl 1 Teil cu the (vi du --teil 2) hoac nhieu (--teil 1,3)
  --list-teile    liet ke cac Teil co tren trang + so bai, roi thoat
  --with-answers  gui POST 1 lan/bai de server danh dau dap an dung (them 1 request/bai)
  --limit N       chi crawl N bai dau (de test)
  --delay S       nghi giua cac request (mac dinh 1.0s) - dung ha thap qua, ton trong server
"""

import argparse
import csv
import re
import sys
import time
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE = "https://deutsch-vorbereitung.com/"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept-Language": "de-DE,de;q=0.9",
}


def get_soup(session, url, data=None, retries=3, delay=1.0):
    """GET (hoac POST neu co data) + parse. Co retry don gian."""
    for attempt in range(retries):
        try:
            if data is None:
                r = session.get(url, timeout=30)
            else:
                r = session.post(url, data=data, timeout=30)
            r.raise_for_status()
            r.encoding = r.apparent_encoding or "utf-8"
            return BeautifulSoup(r.text, "html.parser")
        except requests.RequestException as e:
            if attempt == retries - 1:
                print(f"  [!] loi {url}: {e}", file=sys.stderr)
                return None
            time.sleep(delay * (attempt + 2))
    return None


# ---------------------------------------------------------------- index page
def parse_index(soup):
    """
    Lay danh sach bai tap tu trang index.
    Cau truc: <h3>A1 Goethe Lesen Teil 1</h3> ... cac link uebung-XXXX.html
    Tra ve list dict: teil, nr, title, url
    """
    items = []
    current_teil = ""
    # duyet tuan tu toan bo the trong body de biet link nao thuoc Teil nao
    for tag in soup.find_all(["h2", "h3", "h4", "a"]):
        if tag.name in ("h2", "h3", "h4"):
            txt = tag.get_text(" ", strip=True)
            m = re.search(r"Teil\s*(\d+)", txt)
            if m:
                current_teil = m.group(1)
            continue

        href = tag.get("href", "")
        if not re.search(r"uebung-\d+\.html", href):
            continue

        url = urljoin(BASE, href)
        title = tag.get_text(" ", strip=True)

        # so thu tu "Übung 1.5" nam o the anh em phia truoc
        nr = ""
        parent = (tag.find_parent(class_="listening-list__box")
                  or tag.find_parent(["li", "td", "div"]))
        if parent:
            m = re.search(r"Übung\s*([\d.]+)", parent.get_text(" ", strip=True))
            if m:
                nr = m.group(1).rstrip(".")

        items.append({"teil": current_teil, "nr": nr, "title": title, "url": url})

    # bo trung lap, giu thu tu
    seen, out = set(), []
    for it in items:
        if it["url"] in seen:
            continue
        seen.add(it["url"])
        out.append(it)
    return out


# ------------------------------------------------------------- exercise page
def _clean(el):
    if el is None:
        return ""
    txt = el.get_text("\n", strip=True)
    return re.sub(r"\n{2,}", "\n", txt).strip()


def parse_exercise(soup, url):
    """Parse 1 trang uebung-XXXX.html -> (exercise_dict, [question_dict,...])"""
    section = soup.select_one("section.listening-german") or soup

    h1 = section.find("h1")
    title = _clean(h1)

    # ty le lam dung
    stats = ""
    dot = section.select_one("span.dot")
    if dot:
        stats = _clean(dot)

    boxes = section.select("div.box_border.back__width")
    text_box = next((b for b in boxes if not b.find("form")), None)
    reading_text = _clean(text_box)

    # anh trong bai (Teil 3 hay la bien bao / thong bao)
    images = []
    scope = text_box or section
    for img in scope.find_all("img"):
        src = img.get("src") or ""
        if src and "logo" not in src and "icon" not in src:
            images.append(urljoin(BASE, src))

    ex_id = ""
    m = re.search(r"uebung-(\d+)", url)
    if m:
        ex_id = m.group(1)

    exercise = {
        "exercise_id": ex_id,
        "title": title,
        "url": url,
        "stats": stats,
        "text": reading_text,
        "images": " | ".join(images),
    }

    questions = []
    for idx, block in enumerate(section.select("div.list__"), start=1):
        label_el = block.select_one("p.label")
        question = _clean(label_el)

        explanation = _clean(block.select_one("div.inputmodal__content"))

        opts, correct, qid = [], "", ""
        for span in block.select("span.input__box"):
            inp = span.find("input")
            if not inp:
                continue
            label = inp.get("aria-label") or _clean(span)
            val = inp.get("value", "")
            qid = inp.get("name", qid)
            classes = span.get("class", [])
            opts.append({"label": label, "value": val})
            if "green" in classes:          # server danh dau dap an dung
                correct = label

        questions.append({
            "exercise_id": ex_id,
            "q_index": idx,
            "q_id": re.sub(r"^antwort", "", qid),
            "question": question,
            "options": " | ".join(o["label"] for o in opts),
            "option_values": " | ".join(o["value"] for o in opts),
            "correct_answer": correct,
            "explanation": explanation,
        })

    return exercise, questions


def fetch_answers(session, url, questions, delay):
    """
    Gui POST 1 lan voi lua chon dau tien cua moi cau.
    Server tra ve HTML co class 'green' o dap an dung -> parse lai.
    """
    payload = {"submit": "1"}
    for q in questions:
        vals = q["option_values"].split(" | ")
        if vals and vals[0]:
            payload[f"antwort{q['q_id']}"] = vals[0]
    if len(payload) == 1:
        return questions

    time.sleep(delay)
    soup = get_soup(session, url, data=payload, delay=delay)
    if soup is None:
        return questions

    _, checked = parse_exercise(soup, url)
    by_idx = {q["q_index"]: q for q in checked}
    for q in questions:
        c = by_idx.get(q["q_index"])
        if c and c["correct_answer"]:
            q["correct_answer"] = c["correct_answer"]
    return questions


# --------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True, help="URL trang index (danh sach bai tap)")
    ap.add_argument("--out", default="output", help="prefix ten file CSV")
    ap.add_argument("--delay", type=float, default=1.0, help="giay nghi giua cac request")
    ap.add_argument("--limit", type=int, default=0, help="chi crawl N bai dau (0 = tat ca)")
    ap.add_argument("--teil", default="",
                    help="chi crawl Teil cu the. Vi du: --teil 2  hoac  --teil 1,3")
    ap.add_argument("--list-teile", action="store_true",
                    help="chi liet ke cac Teil co tren trang roi thoat (khong crawl)")
    ap.add_argument("--with-answers", action="store_true",
                    help="lay them dap an dung (them 1 POST moi bai)")
    args = ap.parse_args()

    wanted = {t.strip() for t in args.teil.split(",") if t.strip()}

    session = requests.Session()
    session.headers.update(HEADERS)

    print(f"[*] Doc trang index: {args.url}")
    idx_soup = get_soup(session, args.url, delay=args.delay)
    if idx_soup is None:
        sys.exit("Khong tai duoc trang index.")

    items = parse_index(idx_soup)

    # thong ke so bai theo tung Teil
    counts = {}
    for it in items:
        counts[it["teil"] or "?"] = counts.get(it["teil"] or "?", 0) + 1
    summary = ", ".join(f"Teil {k}: {v} bai" for k, v in sorted(counts.items()))
    print(f"[*] Trang nay co -> {summary}")

    if args.list_teile:
        return

    if wanted:
        unknown = wanted - set(counts)
        if unknown:
            print(f"[!] Khong co Teil: {', '.join(sorted(unknown))}", file=sys.stderr)
        items = [it for it in items if it["teil"] in wanted]
        if not items:
            sys.exit("Khong co bai nao khop --teil.")
        print(f"[*] Loc theo Teil {','.join(sorted(wanted))}")

    if args.limit:
        items = items[:args.limit]
    print(f"[*] Se crawl {len(items)} bai tap")

    all_ex, all_q = [], []
    for i, it in enumerate(items, start=1):
        print(f"[{i}/{len(items)}] Teil {it['teil']} - {it['title']}")
        time.sleep(args.delay)
        soup = get_soup(session, it["url"], delay=args.delay)
        if soup is None:
            continue

        ex, qs = parse_exercise(soup, it["url"])
        ex["teil"] = it["teil"]
        ex["nr"] = it["nr"]
        if not ex["title"]:
            ex["title"] = it["title"]

        if args.with_answers and qs:
            qs = fetch_answers(session, it["url"], qs, args.delay)

        for q in qs:
            q["teil"] = it["teil"]
            q["nr"] = it["nr"]
            q["exercise_title"] = ex["title"]
            q["url"] = it["url"]

        all_ex.append(ex)
        all_q.extend(qs)

    suffix = "_teil" + "-".join(sorted(wanted)) if wanted else ""
    ex_file = f"{args.out}{suffix}_exercises.csv"
    q_file = f"{args.out}{suffix}_questions.csv"

    ex_cols = ["exercise_id", "teil", "nr", "title", "url", "stats", "text", "images"]
    q_cols = ["exercise_id", "teil", "nr", "exercise_title", "q_index", "q_id",
              "question", "options", "option_values", "correct_answer",
              "explanation", "url"]

    with open(ex_file, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=ex_cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(all_ex)

    with open(q_file, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=q_cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(all_q)

    print(f"\n[OK] {len(all_ex)} bai  -> {ex_file}")
    print(f"[OK] {len(all_q)} cau hoi -> {q_file}")


if __name__ == "__main__":
    main()
