#!/usr/bin/env python3
"""
Indeed UK Job Scraper with WhatsApp Notifications
==================================================
Scrapes Indeed UK for part-time/full-time jobs within a specified city and radius.
Deduplicates via SQLite. Sends new listings to WhatsApp via Twilio.

Usage:
    python indeed_scraper.py                  # Run once (default: part+time in Leeds, 25mi)
    python indeed_scraper.py --loop           # Run continuously every hour
    python indeed_scraper.py --query "nurse"  # Custom search query
    python indeed_scraper.py --location "Manchester" --radius 15
    python indeed_scraper.py --fromage 7      # Jobs from last 7 days (1 = 24h, 7 = 1 week)
"""

import os
import re
import sys
import json
import time
import random
import sqlite3
import logging
import argparse
from datetime import datetime, timezone
from urllib.parse import urlencode, quote_plus

from curl_cffi import requests as cffi_requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

load_dotenv()

# --- Search parameters (overridable via CLI) ---
DEFAULT_QUERY = "part time"
DEFAULT_LOCATION = "Leeds"
DEFAULT_RADIUS = 25        # miles
DEFAULT_FROMAGE = 1        # 1 = last 24 hours, 7 = last week
DEFAULT_JOB_TYPE = ""      # e.g. "parttime", "fulltime", or "" for all

# --- WhatsApp via whatsapp-web.js (self-hosted, open-source) ---
# Start the service:  node whatsapp_service.js
# Scan the QR code in the terminal on first run.
WA_SERVICE_URL = os.getenv("WA_SERVICE_URL", "http://localhost:3001")
#
# WHATSAPP_CHAT_ID — individual or group:
#   Individual : 447751988524@c.us        (country code + number, no +)
#   Group      : 120363012345678901@g.us   (group ID ending in @g.us)
#
# To find your group chat ID run:  python indeed_scraper.py --list-groups
#
WHATSAPP_CHAT_ID = os.getenv("WHATSAPP_CHAT_ID", "")

# --- Residential Proxies (rotate per request) ---
# Format in .env:  PROXY_LIST=host:port:user:pass,host2:port2:user2:pass2
RAW_PROXIES = os.getenv("PROXY_LIST", "")

# --- Paths ---
DB_PATH = os.getenv("DB_PATH", os.path.join(os.path.dirname(__file__), "jobs.db"))
LOG_PATH = os.getenv("LOG_PATH", os.path.join(os.path.dirname(__file__), "scraper.log"))

# --- Timing ---
SLEEP_MIN = 5   # seconds between page loads
SLEEP_MAX = 10
LOOP_INTERVAL = 3600  # 1 hour in seconds

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_PATH),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Proxy helpers
# ---------------------------------------------------------------------------


def _parse_proxies(raw: str) -> list[dict]:
    """Parse comma-separated proxy list into curl_cffi-compatible dicts."""
    proxies = []
    if not raw.strip():
        return proxies
    for entry in raw.split(","):
        parts = entry.strip().split(":")
        if len(parts) == 4:
            host, port, user, passwd = parts
            url = f"http://{user}:{passwd}@{host}:{port}"
            proxies.append({"http": url, "https": url})
        elif len(parts) == 2:
            host, port = parts
            url = f"http://{host}:{port}"
            proxies.append({"http": url, "https": url})
        else:
            logger.warning("Skipping malformed proxy entry: %s", entry)
    return proxies


PROXIES = _parse_proxies(RAW_PROXIES)


def _get_proxy() -> dict | None:
    """Return a random proxy dict or None if no proxies configured."""
    if not PROXIES:
        return None
    return random.choice(PROXIES)


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------


def init_db(db_path: str) -> sqlite3.Connection:
    """Create the jobs table if it doesn't exist and return a connection."""
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS jobs (
            job_id      TEXT PRIMARY KEY,
            title       TEXT,
            company     TEXT,
            salary      TEXT,
            contract    TEXT,
            location    TEXT,
            deadline    TEXT,
            link        TEXT,
            scraped_at  TEXT
        )
    """)
    conn.commit()
    return conn


def job_exists(conn: sqlite3.Connection, job_id: str) -> bool:
    row = conn.execute("SELECT 1 FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
    return row is not None


def insert_job(conn: sqlite3.Connection, job: dict) -> None:
    conn.execute(
        """INSERT OR IGNORE INTO jobs
           (job_id, title, company, salary, contract, location, deadline, link, scraped_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            job["job_id"],
            job["title"],
            job["company"],
            job["salary"],
            job["contract"],
            job["location"],
            job["deadline"],
            job["link"],
            datetime.now(timezone.utc).isoformat(),
        ),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Scraping
# ---------------------------------------------------------------------------

BASE_URL = "https://uk.indeed.com/jobs"
JOB_URL_TEMPLATE = "https://uk.indeed.com/viewjob?jk={job_id}"

HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://uk.indeed.com/",
    "DNT": "1",
}


def build_url(query: str, location: str, radius: int, fromage: int,
              job_type: str = "", start: int = 0) -> str:
    """Construct a Indeed UK search URL with the given parameters."""
    params = {
        "q": query,
        "l": location,
        "radius": radius,
        "fromage": fromage,
        "sort": "date",
        "start": start,
    }
    if job_type:
        params["jt"] = job_type
    return f"{BASE_URL}?{urlencode(params, quote_via=quote_plus)}"


def fetch_page(url: str) -> str | None:
    """Fetch a page using curl_cffi impersonating Chrome."""
    proxy = _get_proxy()
    try:
        resp = cffi_requests.get(
            url,
            headers=HEADERS,
            impersonate="chrome",
            proxies=proxy,
            timeout=30,
        )
        if resp.status_code == 200:
            return resp.text
        logger.warning("HTTP %d for %s", resp.status_code, url)
        return None
    except Exception:
        logger.exception("Request failed for %s", url)
        return None


def _extract_text(element, default: str = "N/A") -> str:
    """Safely extract stripped text from a BS4 element."""
    if element:
        return element.get_text(strip=True)
    return default


def parse_jobs(html: str) -> list[dict]:
    """Parse job cards from an Indeed search results page."""
    soup = BeautifulSoup(html, "html.parser")
    jobs: list[dict] = []

    # ----- Strategy 1: Extract from embedded JSON (mosaic-provider-jobcards) -----
    script_tag = soup.find("script", id="mosaic-provider-jobcards")
    if script_tag and script_tag.string:
        try:
            data = json.loads(script_tag.string)
            results = (
                data.get("metaData", {})
                .get("mosaicProviderJobCardsModel", {})
                .get("results", [])
            )
            for r in results:
                jk = r.get("jobkey") or r.get("jk", "")
                if not jk:
                    continue
                jobs.append({
                    "job_id": jk,
                    "title": r.get("displayTitle") or r.get("title", "N/A"),
                    "company": r.get("company", "N/A"),
                    "salary": r.get("formattedSalary")
                              or r.get("salarySnippet", {}).get("text", "Not listed"),
                    "contract": r.get("jobType", "N/A")
                                if isinstance(r.get("jobType"), str)
                                else ", ".join(r.get("jobTypes", [])) or "N/A",
                    "location": r.get("formattedLocation", "N/A"),
                    "deadline": r.get("formattedRelativeDate", "N/A"),
                    "link": JOB_URL_TEMPLATE.format(job_id=jk),
                })
            if jobs:
                return jobs
        except (json.JSONDecodeError, KeyError):
            logger.debug("JSON extraction failed, falling back to HTML parsing")

    # ----- Strategy 2: HTML card parsing -----
    cards = soup.select('div.job_seen_beacon, div[data-jk], td.resultContent')
    if not cards:
        # broader fallback
        cards = soup.find_all("a", attrs={"data-jk": True})

    for card in cards:
        # --- Job Key ---
        jk = card.get("data-jk", "")
        if not jk:
            jk_el = card.find(attrs={"data-jk": True})
            jk = jk_el["data-jk"] if jk_el else ""
        if not jk:
            link_el = card.find("a", href=re.compile(r"jk=([a-f0-9]+)", re.I))
            if link_el:
                m = re.search(r"jk=([a-f0-9]+)", link_el["href"], re.I)
                if m:
                    jk = m.group(1)
        if not jk:
            continue

        # --- Title ---
        title_el = (
            card.find("h2", class_=re.compile(r"jobTitle"))
            or card.find("a", class_=re.compile(r"jcs-JobTitle"))
            or card.find("span", attrs={"title": True})
        )
        title = _extract_text(title_el)
        if title == "N/A" and title_el and title_el.get("title"):
            title = title_el["title"]

        # --- Company ---
        company_el = (
            card.find("span", attrs={"data-testid": "company-name"})
            or card.find("span", class_=re.compile(r"company"))
        )
        company = _extract_text(company_el)

        # --- Location ---
        loc_el = (
            card.find("div", attrs={"data-testid": "text-location"})
            or card.find("div", class_=re.compile(r"companyLocation"))
        )
        location = _extract_text(loc_el)

        # --- Salary ---
        # Salary lives in <li class="salary-snippet-container ...">
        salary = "Not listed"
        sal_li = card.find("li", class_=re.compile(r"salary-snippet-container"))
        if sal_li:
            salary = _extract_text(sal_li)
        else:
            # Fallback: look for data-testid containing "salary"
            sal_el = card.find(attrs={"data-testid": re.compile(r"salary", re.I)})
            if sal_el:
                salary = _extract_text(sal_el)

        # --- Contract type ---
        # Contract type (Part-time, Full-time, etc.) is in <li> items inside
        # the jobMetaDataGroup <ul>, excluding the salary-snippet-container.
        contract = "N/A"
        CONTRACT_KEYWORDS = (
            "full-time", "part-time", "contract", "temporary",
            "permanent", "apprenticeship", "fixed term", "zero hours",
        )
        meta_group = card.find("div", class_=re.compile(r"jobMetaDataGroup"))
        if meta_group:
            for li in meta_group.find_all("li"):
                # Skip the salary li
                li_classes = " ".join(li.get("class", []))
                if "salary-snippet-container" in li_classes:
                    continue
                text = li.get_text(strip=True)
                if any(kw in text.lower() for kw in CONTRACT_KEYWORDS):
                    contract = text
                    break

        # --- Deadline / posted date ---
        date_el = card.find("span", class_=re.compile(r"date"))
        deadline = _extract_text(date_el)

        jobs.append({
            "job_id": jk,
            "title": title,
            "company": company,
            "salary": salary,
            "contract": contract,
            "location": location,
            "deadline": deadline,
            "link": JOB_URL_TEMPLATE.format(job_id=jk),
        })

    return jobs


def scrape_indeed(query: str, location: str, radius: int,
                  fromage: int, job_type: str = "",
                  max_pages: int = 5) -> list[dict]:
    """Scrape multiple pages of Indeed results."""
    all_jobs: list[dict] = []
    for page in range(max_pages):
        start = page * 10
        url = build_url(query, location, radius, fromage, job_type, start)
        logger.info("Fetching page %d: %s", page + 1, url)

        html = fetch_page(url)
        if not html:
            logger.warning("Empty response on page %d – stopping pagination", page + 1)
            break

        jobs = parse_jobs(html)
        if not jobs:
            logger.info("No jobs found on page %d – end of results", page + 1)
            break

        all_jobs.extend(jobs)
        logger.info("Parsed %d jobs from page %d", len(jobs), page + 1)

        # Polite delay between pages
        delay = random.uniform(SLEEP_MIN, SLEEP_MAX)
        logger.debug("Sleeping %.1fs before next page", delay)
        time.sleep(delay)

    # Deduplicate within a single run (same jk can appear on adjacent pages)
    seen: set[str] = set()
    unique: list[dict] = []
    for j in all_jobs:
        if j["job_id"] not in seen:
            seen.add(j["job_id"])
            unique.append(j)
    return unique


# ---------------------------------------------------------------------------
# WhatsApp notification via whatsapp-web.js service
# ---------------------------------------------------------------------------


def send_whatsapp(message: str) -> bool:
    """Send a WhatsApp message via the local whatsapp-web.js service."""
    if not WHATSAPP_CHAT_ID:
        logger.warning("WHATSAPP_CHAT_ID not set – skipping WhatsApp send")
        return False

    url = f"{WA_SERVICE_URL}/send"
    payload = {
        "chatId": WHATSAPP_CHAT_ID,
        "text": message,
    }
    try:
        resp = cffi_requests.post(
            url,
            json=payload,
            impersonate="chrome",
            timeout=30,
        )
        if resp.status_code == 200:
            logger.info("WhatsApp message sent successfully")
            return True
        logger.warning("WhatsApp service HTTP %d: %s", resp.status_code, resp.text[:300])
        return False
    except Exception:
        logger.exception("Failed to send WhatsApp message. Is the service running? (node whatsapp_service.js)")
        return False


def list_groups() -> None:
    """Print all WhatsApp groups and their chat IDs."""
    url = f"{WA_SERVICE_URL}/groups"
    try:
        resp = cffi_requests.get(url, impersonate="chrome", timeout=30)
        if resp.status_code == 503:
            print("ERROR: WhatsApp client not ready. Scan the QR code first.")
            print("Run:  node whatsapp_service.js")
            sys.exit(1)
        if resp.status_code != 200:
            print(f"ERROR: WhatsApp service returned HTTP {resp.status_code}")
            sys.exit(1)
        groups = resp.json()
        if not groups:
            print("No groups found. Make sure your WhatsApp has groups.")
            return
        print(f"\nFound {len(groups)} group(s):\n")
        for g in groups:
            name = g.get("name") or g.get("id")
            chat_id = g.get("id", "")
            print(f"  {name:40s}  →  {chat_id}")
        print("\nCopy the chat ID (ending in @g.us) into WHATSAPP_CHAT_ID in your .env")
    except Exception as e:
        print(f"ERROR: Could not connect to WhatsApp service at {WA_SERVICE_URL}: {e}")
        print("Start it:  node whatsapp_service.js")
        sys.exit(1)


def format_job_message(job: dict) -> str:
    """Format a single job dict into a readable WhatsApp message."""
    return (
        f"🚨 *New Job Alert*\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"📌 *Title:* {job['title']}\n"
        f"🏢 *Company:* {job['company']}\n"
        f"💰 *Salary:* {job['salary']}\n"
        f"📋 *Contract:* {job['contract']}\n"
        f"📍 *Location:* {job['location']}\n"
        f"⏰ *Posted:* {job['deadline']}\n"
        f"🔗 *Link:* {job['link']}\n"
        f"━━━━━━━━━━━━━━━━━━"
    )


def notify_new_jobs(new_jobs: list[dict]) -> None:
    """Send WhatsApp messages for new jobs, batching to stay under limits."""
    if not new_jobs:
        return

    # Twilio WhatsApp messages have a 1600-char limit.
    # Send in batches of up to 3 jobs per message.
    BATCH_SIZE = 3
    for i in range(0, len(new_jobs), BATCH_SIZE):
        batch = new_jobs[i : i + BATCH_SIZE]
        header = f"📢 *Indeed Job Alerts* ({len(batch)} new)\n\n"
        body = "\n\n".join(format_job_message(j) for j in batch)
        message = header + body

        # Truncate if still too long
        if len(message) > 1550:
            message = message[:1547] + "..."

        send_whatsapp(message)
        time.sleep(2)  # small delay between messages


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------


def run_once(query: str, location: str, radius: int,
             fromage: int, job_type: str, max_pages: int) -> int:
    """Execute one scraping cycle. Returns count of new jobs found."""
    logger.info(
        "Starting scrape: query=%r location=%r radius=%d fromage=%d",
        query, location, radius, fromage,
    )

    conn = init_db(DB_PATH)
    try:
        jobs = scrape_indeed(query, location, radius, fromage, job_type, max_pages)
        logger.info("Total unique jobs scraped: %d", len(jobs))

        new_jobs: list[dict] = []
        for job in jobs:
            if not job_exists(conn, job["job_id"]):
                insert_job(conn, job)
                new_jobs.append(job)
                logger.info("NEW: %s @ %s [%s]", job["title"], job["company"], job["job_id"])
            else:
                logger.debug("SKIP (dup): %s [%s]", job["title"], job["job_id"])

        logger.info("New jobs this cycle: %d", len(new_jobs))
        notify_new_jobs(new_jobs)
        return len(new_jobs)
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Indeed UK Job Scraper")
    parser.add_argument("--query", "-q", default=DEFAULT_QUERY, help="Search query")
    parser.add_argument("--location", "-l", default=DEFAULT_LOCATION, help="City / location")
    parser.add_argument("--radius", "-r", type=int, default=DEFAULT_RADIUS, help="Radius in miles")
    parser.add_argument("--fromage", "-f", type=int, default=DEFAULT_FROMAGE,
                        help="Max job age in days (1=24h, 7=1 week)")
    parser.add_argument("--job-type", "-jt", default=DEFAULT_JOB_TYPE,
                        help="Job type filter (parttime, fulltime, contract, etc.)")
    parser.add_argument("--max-pages", "-p", type=int, default=5, help="Max pages to scrape")
    parser.add_argument("--loop", action="store_true",
                        help="Run continuously every hour")
    parser.add_argument("--list-groups", action="store_true",
                        help="Print WhatsApp groups and their chat IDs, then exit")
    args = parser.parse_args()

    if args.list_groups:
        list_groups()
        return

    if args.loop:
        logger.info("Running in loop mode (interval=%ds)", LOOP_INTERVAL)
        while True:
            try:
                run_once(args.query, args.location, args.radius,
                         args.fromage, args.job_type, args.max_pages)
            except Exception:
                logger.exception("Unhandled error in scrape cycle")
            logger.info("Sleeping %ds until next cycle...", LOOP_INTERVAL)
            time.sleep(LOOP_INTERVAL)
    else:
        run_once(args.query, args.location, args.radius,
                 args.fromage, args.job_type, args.max_pages)


if __name__ == "__main__":
    main()
