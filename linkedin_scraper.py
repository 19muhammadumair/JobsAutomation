#!/usr/bin/env python3
"""
LinkedIn UK Job Scraper with WhatsApp Notifications
=====================================================
Scrapes LinkedIn's public job search for part-time/full-time jobs.
Deduplicates via the same SQLite database as the Indeed scraper.
Sends new listings to WhatsApp via whatsapp-web.js service.

Usage:
    python linkedin_scraper.py                        # Default: "part time" in Leeds
    python linkedin_scraper.py --loop                 # Run continuously every hour
    python linkedin_scraper.py --query "warehouse"    # Custom query
    python linkedin_scraper.py --location "Manchester"
    python linkedin_scraper.py --time-range week      # day, week, month, any
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
DEFAULT_DISTANCE = 25       # miles
DEFAULT_TIME_RANGE = "day"  # day, week, month, any
DEFAULT_JOB_TYPE = ""       # F=Full-time, P=Part-time, C=Contract, T=Temporary, etc.

# --- WhatsApp via whatsapp-web.js ---
WA_SERVICE_URL = os.getenv("WA_SERVICE_URL", "http://localhost:3001")
WHATSAPP_CHAT_ID = os.getenv("WHATSAPP_CHAT_ID", "")

# --- Residential Proxies ---
RAW_PROXIES = os.getenv("PROXY_LIST", "")

# --- Paths (shared DB with Indeed scraper) ---
DB_PATH = os.getenv("DB_PATH", os.path.join(os.path.dirname(__file__), "jobs.db"))
LOG_PATH = os.getenv("LOG_PATH", os.path.join(os.path.dirname(__file__), "scraper.log"))

# --- Timing ---
SLEEP_MIN = 5
SLEEP_MAX = 10
LOOP_INTERVAL = 3600  # 1 hour

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
    return proxies


PROXIES = _parse_proxies(RAW_PROXIES)


def _get_proxy() -> dict | None:
    if not PROXIES:
        return None
    return random.choice(PROXIES)


# ---------------------------------------------------------------------------
# Database helpers (shared schema with Indeed scraper)
# ---------------------------------------------------------------------------


def init_db(db_path: str) -> sqlite3.Connection:
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
# LinkedIn scraping
# ---------------------------------------------------------------------------

# LinkedIn public job search (no login required)
BASE_URL = "https://www.linkedin.com/jobs/search"
JOB_URL_TEMPLATE = "https://www.linkedin.com/jobs/view/{job_id}"

HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "max-age=0",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "DNT": "1",
}

# LinkedIn's f_TPR (time posted range) values
TIME_RANGE_MAP = {
    "day": "r86400",       # last 24 hours
    "week": "r604800",     # last 7 days
    "month": "r2592000",   # last 30 days
    "any": "",             # all time
}

# LinkedIn's f_JT (job type) values
JOB_TYPE_MAP = {
    "fulltime": "F",
    "parttime": "P",
    "contract": "C",
    "temporary": "T",
    "internship": "I",
    "volunteer": "V",
    "": "",
}

# LinkedIn's geoId for UK locations (we use location keywords instead)
# distance values: 10, 25, 50, 75, 100


def build_linkedin_url(query: str, location: str, distance: int,
                       time_range: str, job_type: str = "",
                       start: int = 0) -> str:
    """Construct a LinkedIn public job search URL."""
    params = {
        "keywords": query,
        "location": location,
        "distance": distance,
        "sortBy": "DD",       # Date Descending (most recent first)
        "start": start,
        "position": 1,
        "pageNum": 0,
    }

    # Time range filter
    tpr = TIME_RANGE_MAP.get(time_range, "")
    if tpr:
        params["f_TPR"] = tpr

    # Job type filter
    jt = JOB_TYPE_MAP.get(job_type, job_type)
    if jt:
        params["f_JT"] = jt

    return f"{BASE_URL}?{urlencode(params, quote_via=quote_plus)}"


def fetch_page(url: str) -> str | None:
    """Fetch a page using curl_cffi impersonating Chrome."""
    proxy = _get_proxy()
    try:
        resp = cffi_requests.get(
            url,
            headers=HEADERS,
            impersonate="chrome120",
            proxies=proxy,
            timeout=30,
            allow_redirects=True,
        )
        if resp.status_code == 200:
            return resp.text
        logger.warning("HTTP %d for %s", resp.status_code, url)
        return None
    except Exception:
        logger.exception("Request failed for %s", url)
        return None


def _extract_text(element, default: str = "N/A") -> str:
    if element:
        return element.get_text(strip=True)
    return default


def parse_linkedin_jobs(html: str) -> list[dict]:
    """Parse job listings from LinkedIn's public search results page."""
    soup = BeautifulSoup(html, "html.parser")
    jobs: list[dict] = []

    # LinkedIn public search uses <ul class="jobs-search__results-list">
    # Each job card is a <li> containing a <div class="base-card">
    cards = soup.find_all("div", class_=re.compile(r"base-card"))
    if not cards:
        # Fallback: try finding job cards by data attribute
        cards = soup.find_all("div", class_=re.compile(r"job-search-card"))

    for card in cards:
        # --- Job ID ---
        # LinkedIn job IDs are in data-entity-urn="urn:li:jobPosting:XXXXXXXXXX"
        entity_urn = card.get("data-entity-urn", "")
        job_id = ""
        if entity_urn:
            m = re.search(r"(\d+)$", entity_urn)
            if m:
                job_id = f"li_{m.group(1)}"  # prefix to avoid collision with Indeed IDs
        if not job_id:
            # Try extracting from the job link href
            link_el = card.find("a", class_=re.compile(r"base-card__full-link"))
            if not link_el:
                link_el = card.find("a", href=re.compile(r"/jobs/view/"))
            if link_el:
                href = link_el.get("href", "")
                m = re.search(r"/jobs/view/(\d+)", href)
                if m:
                    job_id = f"li_{m.group(1)}"
        if not job_id:
            continue

        numeric_id = job_id.replace("li_", "")

        # --- Title ---
        title_el = (
            card.find("h3", class_=re.compile(r"base-search-card__title"))
            or card.find("span", class_=re.compile(r"sr-only"))
        )
        title = _extract_text(title_el)

        # --- Company ---
        company_el = (
            card.find("h4", class_=re.compile(r"base-search-card__subtitle"))
            or card.find("a", class_=re.compile(r"hidden-nested-link"))
        )
        company = _extract_text(company_el)

        # --- Location ---
        loc_el = card.find("span", class_=re.compile(r"job-search-card__location"))
        location = _extract_text(loc_el)

        # --- Salary ---
        sal_el = card.find("span", class_=re.compile(r"job-search-card__salary-info"))
        salary = _extract_text(sal_el, default="Not listed")

        # --- Contract type / job type ---
        # LinkedIn sometimes shows this in a badge or metadata
        contract = "N/A"
        badge_el = card.find("span", class_=re.compile(r"job-search-card__job-type"))
        if badge_el:
            contract = _extract_text(badge_el)
        else:
            # Check listing metadata
            meta_items = card.find_all("li", class_=re.compile(r"base-search-card__metadata"))
            for mi in meta_items:
                text = mi.get_text(strip=True).lower()
                if any(kw in text for kw in ("full-time", "part-time", "contract",
                                              "temporary", "internship")):
                    contract = mi.get_text(strip=True)
                    break

        # --- Posted date ---
        time_el = card.find("time", class_=re.compile(r"job-search-card__listdate"))
        if not time_el:
            time_el = card.find("time")
        deadline = ""
        if time_el:
            deadline = time_el.get("datetime", "") or _extract_text(time_el)
        if not deadline:
            deadline = "N/A"

        # --- Link ---
        link = JOB_URL_TEMPLATE.format(job_id=numeric_id)

        jobs.append({
            "job_id": job_id,
            "title": title,
            "company": company,
            "salary": salary,
            "contract": contract,
            "location": location,
            "deadline": deadline,
            "link": link,
        })

    return jobs


def fetch_job_details(job: dict) -> dict:
    """Fetch the LinkedIn job detail page to extract salary and employment type."""
    url = job["link"]
    html = fetch_page(url)
    if not html:
        return job

    soup = BeautifulSoup(html, "html.parser")

    # --- Salary from detail page ---
    if job["salary"] == "Not listed":
        sal_el = soup.find("div", class_=re.compile(r"salary compensation__salary"))
        if not sal_el:
            sal_el = soup.find("div", class_=re.compile(r"compensation__salary-range"))
        if sal_el:
            job["salary"] = sal_el.get_text(strip=True)
            # Clean up "Base pay range" prefix
            job["salary"] = re.sub(r"^Base pay range", "", job["salary"]).strip()

    # --- Employment type from job criteria ---
    if job["contract"] == "N/A":
        for li in soup.find_all("li", class_=re.compile(r"description__job-criteria-item")):
            header = li.find("h3")
            value = li.find("span")
            if header and value:
                label = header.get_text(strip=True).lower()
                if "employment type" in label:
                    job["contract"] = value.get_text(strip=True)
                    break

    return job


def scrape_linkedin(query: str, location: str, distance: int,
                    time_range: str, job_type: str = "",
                    max_pages: int = 5,
                    max_jobs: int = 0) -> list[dict]:
    """Scrape multiple pages of LinkedIn job results."""
    all_jobs: list[dict] = []
    for page in range(max_pages):
        start = page * 25  # LinkedIn uses 25 results per page
        url = build_linkedin_url(query, location, distance, time_range, job_type, start)
        logger.info("Fetching page %d: %s", page + 1, url)

        html = fetch_page(url)
        if not html:
            logger.warning("Empty response on page %d – stopping pagination", page + 1)
            break

        jobs = parse_linkedin_jobs(html)
        if not jobs:
            logger.info("No jobs found on page %d – end of results", page + 1)
            break

        all_jobs.extend(jobs)
        logger.info("Parsed %d jobs from page %d", len(jobs), page + 1)

        # Polite delay between pages
        delay = random.uniform(SLEEP_MIN, SLEEP_MAX)
        logger.debug("Sleeping %.1fs before next page", delay)
        time.sleep(delay)

    # Deduplicate within a single run
    seen: set[str] = set()
    unique: list[dict] = []
    for j in all_jobs:
        if j["job_id"] not in seen:
            seen.add(j["job_id"])
            unique.append(j)

    # Apply max_jobs limit if set
    if max_jobs > 0:
        unique = unique[:max_jobs]

    return unique


# ---------------------------------------------------------------------------
# WhatsApp notification via whatsapp-web.js service
# ---------------------------------------------------------------------------


def send_whatsapp(message: str) -> bool:
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
        logger.exception("Failed to send WhatsApp message. Is the service running?")
        return False


def format_job_message(job: dict) -> str:
    return (
        f"🚨 Part Time JOB ALERT\n"
        f"\n"
        f"Role: {job['title']}\n"
        f"Company: {job['company']}\n"
        f"Location: {job['location']}\n"
        f"Contract Type: {job['contract']}\n"
        f"Type: Job whilst study\n"
        f"\n"
        f"👉 DEADLINE to apply:\n"
        f"{job['deadline']}\n"
        f"\n"
        f"🔗 Apply here:\n"
        f"{job['link']}"
    )


def notify_new_jobs(new_jobs: list[dict]) -> None:
    if not new_jobs:
        return
    for job in new_jobs:
        message = format_job_message(job)
        send_whatsapp(message)
        time.sleep(2)


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------


def run_once(query: str, location: str, distance: int,
             time_range: str, job_type: str, max_pages: int,
             max_jobs: int = 0) -> int:
    logger.info(
        "Starting LinkedIn scrape: query=%r location=%r distance=%d time_range=%r",
        query, location, distance, time_range,
    )

    conn = init_db(DB_PATH)
    try:
        jobs = scrape_linkedin(query, location, distance, time_range, job_type, max_pages, max_jobs)
        logger.info("Total unique jobs scraped: %d", len(jobs))

        new_jobs: list[dict] = []
        for job in jobs:
            if not job_exists(conn, job["job_id"]):
                new_jobs.append(job)
            else:
                logger.debug("SKIP (dup): %s [%s]", job["title"], job["job_id"])

        # Enrich only NEW jobs with salary/contract from detail pages
        if new_jobs:
            logger.info("Enriching %d new jobs from detail pages...", len(new_jobs))
            enriched = 0
            for i, job in enumerate(new_jobs):
                if job["salary"] == "Not listed" or job["contract"] == "N/A":
                    logger.info("Fetching details [%d/%d]: %s", i + 1, len(new_jobs), job["title"])
                    fetch_job_details(job)
                    if job["salary"] != "Not listed" or job["contract"] != "N/A":
                        enriched += 1
                    time.sleep(random.uniform(2, 4))
            logger.info("Enriched %d/%d jobs with salary/contract", enriched, len(new_jobs))

        for job in new_jobs:
            insert_job(conn, job)
            logger.info("NEW: %s @ %s [%s]", job["title"], job["company"], job["job_id"])

        logger.info("New jobs this cycle: %d", len(new_jobs))
        notify_new_jobs(new_jobs)
        return len(new_jobs)
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="LinkedIn UK Job Scraper")
    parser.add_argument("--query", "-q", default=DEFAULT_QUERY, help="Search query")
    parser.add_argument("--location", "-l", default=DEFAULT_LOCATION, help="City / location")
    parser.add_argument("--distance", "-d", type=int, default=DEFAULT_DISTANCE,
                        help="Distance in miles (10, 25, 50, 75, 100)")
    parser.add_argument("--time-range", "-t", default=DEFAULT_TIME_RANGE,
                        choices=["day", "week", "month", "any"],
                        help="Time range: day (24h), week, month, any")
    parser.add_argument("--job-type", "-jt", default=DEFAULT_JOB_TYPE,
                        help="Job type: parttime, fulltime, contract, temporary, internship")
    parser.add_argument("--max-pages", "-p", type=int, default=5, help="Max pages to scrape")
    parser.add_argument("--max-jobs", "-mj", type=int, default=0,
                        help="Max jobs to process (0 = unlimited)")
    parser.add_argument("--loop", action="store_true",
                        help="Run continuously every hour")
    args = parser.parse_args()

    if args.loop:
        logger.info("Running in loop mode (interval=%ds)", LOOP_INTERVAL)
        while True:
            try:
                run_once(args.query, args.location, args.distance,
                         args.time_range, args.job_type, args.max_pages,
                         args.max_jobs)
            except Exception:
                logger.exception("Unhandled error in scrape cycle")
            logger.info("Sleeping %ds until next cycle...", LOOP_INTERVAL)
            time.sleep(LOOP_INTERVAL)
    else:
        run_once(args.query, args.location, args.distance,
                 args.time_range, args.job_type, args.max_pages,
                 args.max_jobs)


if __name__ == "__main__":
    main()
