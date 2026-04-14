"""
FastAPI Backend for Job Automation Platform
============================================
Serves job data from SQLite, triggers scrapers, manages WhatsApp connection.
"""

import os
import re
import sqlite3
import subprocess
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

DB_PATH = os.getenv("DB_PATH", os.path.join(os.path.dirname(__file__), "..", "jobs.db"))
WA_SERVICE_URL = os.getenv("WA_SERVICE_URL", "http://localhost:3001")


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
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
    conn.execute("""
        CREATE TABLE IF NOT EXISTS scrape_config (
            id          INTEGER PRIMARY KEY CHECK (id = 1),
            query       TEXT DEFAULT 'part time',
            location    TEXT DEFAULT 'Leeds',
            radius      INTEGER DEFAULT 25,
            sources     TEXT DEFAULT 'indeed,linkedin',
            updated_at  TEXT
        )
    """)
    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class Job(BaseModel):
    job_id: str
    title: str
    company: str
    salary: str
    contract: str
    location: str
    deadline: str
    link: str
    scraped_at: str
    source: str


class JobsResponse(BaseModel):
    jobs: list[Job]
    total: int
    page: int
    per_page: int
    total_pages: int


class ScrapeRequest(BaseModel):
    source: str  # "indeed", "linkedin", or "both"
    query: str = "part time"
    location: str = "Leeds"
    radius: int = 25
    max_pages: int = 1
    max_jobs: int = 0


class ScrapeStatus(BaseModel):
    status: str
    message: str
    new_jobs: int = 0


class WhatsAppStatus(BaseModel):
    connected: bool
    chat_id: str


class WhatsAppConnect(BaseModel):
    chat_id: str


class StatsResponse(BaseModel):
    total_jobs: int
    indeed_jobs: int
    linkedin_jobs: int
    cities: list[str]
    contract_types: list[str]


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure DB exists on startup
    conn = get_db()
    conn.close()
    yield


app = FastAPI(title="Job Automation API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _determine_source(job_id: str) -> str:
    if job_id.startswith("li_"):
        return "linkedin"
    return "indeed"


def _normalize_city(location: str) -> str:
    """Extract the main city name from a location string."""
    if not location:
        return "Unknown"
    # Remove postcodes, country suffixes
    city = location.split(",")[0].strip()
    city = re.sub(r"\s+[A-Z]{1,2}\d.*$", "", city)  # remove UK postcodes
    return city if city else "Unknown"


# ---------------------------------------------------------------------------
# Routes: Jobs
# ---------------------------------------------------------------------------

@app.get("/api/jobs", response_model=JobsResponse)
def list_jobs(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    source: Optional[str] = Query(None, description="indeed or linkedin"),
    city: Optional[str] = Query(None),
    contract: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort: str = Query("newest", description="newest or oldest"),
):
    conn = get_db()
    try:
        conditions = []
        params = []

        if source == "indeed":
            conditions.append("job_id NOT LIKE 'li_%'")
        elif source == "linkedin":
            conditions.append("job_id LIKE 'li_%'")

        if city:
            conditions.append("location LIKE ?")
            params.append(f"%{city}%")

        if contract:
            conditions.append("LOWER(contract) LIKE ?")
            params.append(f"%{contract.lower()}%")

        if search:
            conditions.append("(LOWER(title) LIKE ? OR LOWER(company) LIKE ?)")
            params.extend([f"%{search.lower()}%", f"%{search.lower()}%"])

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        order = "DESC" if sort == "newest" else "ASC"

        # Count
        count_row = conn.execute(f"SELECT COUNT(*) FROM jobs {where}", params).fetchone()
        total = count_row[0]

        # Paginate
        offset = (page - 1) * per_page
        rows = conn.execute(
            f"SELECT * FROM jobs {where} ORDER BY scraped_at {order} LIMIT ? OFFSET ?",
            params + [per_page, offset],
        ).fetchall()

        jobs = [
            Job(
                **dict(row),
                source=_determine_source(row["job_id"]),
            )
            for row in rows
        ]

        total_pages = max(1, (total + per_page - 1) // per_page)

        return JobsResponse(
            jobs=jobs,
            total=total,
            page=page,
            per_page=per_page,
            total_pages=total_pages,
        )
    finally:
        conn.close()


@app.get("/api/stats", response_model=StatsResponse)
def get_stats():
    conn = get_db()
    try:
        total = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
        indeed = conn.execute("SELECT COUNT(*) FROM jobs WHERE job_id NOT LIKE 'li_%'").fetchone()[0]
        linkedin = conn.execute("SELECT COUNT(*) FROM jobs WHERE job_id LIKE 'li_%'").fetchone()[0]

        # Distinct cities
        loc_rows = conn.execute("SELECT DISTINCT location FROM jobs WHERE location != 'N/A'").fetchall()
        cities = sorted(set(_normalize_city(r[0]) for r in loc_rows if r[0]))
        cities = [c for c in cities if c != "Unknown"]

        # Distinct contract types
        ct_rows = conn.execute(
            "SELECT DISTINCT contract FROM jobs WHERE contract != 'N/A' AND contract != ''"
        ).fetchall()
        contract_types = sorted(set(r[0] for r in ct_rows if r[0]))

        return StatsResponse(
            total_jobs=total,
            indeed_jobs=indeed,
            linkedin_jobs=linkedin,
            cities=cities,
            contract_types=contract_types,
        )
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Routes: Scraping
# ---------------------------------------------------------------------------

@app.post("/api/scrape", response_model=ScrapeStatus)
def trigger_scrape(req: ScrapeRequest):
    """Trigger a scraping run for Indeed and/or LinkedIn."""
    project_dir = os.path.join(os.path.dirname(__file__), "..")
    venv_python = os.path.join(project_dir, "venv", "bin", "python")
    if not os.path.exists(venv_python):
        venv_python = sys.executable

    total_new = 0
    messages = []

    if req.source in ("indeed", "both"):
        try:
            cmd = [
                venv_python, os.path.join(project_dir, "indeed_scraper.py"),
                "--query", req.query,
                "--location", req.location,
                "--radius", str(req.radius),
                "--max-pages", str(req.max_pages),
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300, cwd=project_dir)
            # Parse new jobs count from output
            for line in result.stdout.split("\n"):
                if "New jobs this cycle:" in line:
                    n = int(line.split(":")[-1].strip())
                    total_new += n
                    messages.append(f"Indeed: {n} new jobs")
                    break
            else:
                messages.append("Indeed: scrape completed")
        except subprocess.TimeoutExpired:
            messages.append("Indeed: timed out")
        except Exception as e:
            messages.append(f"Indeed: error - {str(e)[:100]}")

    if req.source in ("linkedin", "both"):
        try:
            cmd = [
                venv_python, os.path.join(project_dir, "linkedin_scraper.py"),
                "--query", req.query,
                "--location", req.location,
                "--distance", str(req.radius),
                "--max-pages", str(req.max_pages),
            ]
            if req.max_jobs > 0:
                cmd.extend(["--max-jobs", str(req.max_jobs)])
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=600, cwd=project_dir)
            for line in result.stdout.split("\n"):
                if "New jobs this cycle:" in line:
                    n = int(line.split(":")[-1].strip())
                    total_new += n
                    messages.append(f"LinkedIn: {n} new jobs")
                    break
            else:
                messages.append("LinkedIn: scrape completed")
        except subprocess.TimeoutExpired:
            messages.append("LinkedIn: timed out")
        except Exception as e:
            messages.append(f"LinkedIn: error - {str(e)[:100]}")

    return ScrapeStatus(
        status="completed",
        message="; ".join(messages),
        new_jobs=total_new,
    )


# ---------------------------------------------------------------------------
# Routes: WhatsApp
# ---------------------------------------------------------------------------

@app.get("/api/whatsapp/status", response_model=WhatsAppStatus)
def whatsapp_status():
    """Check if WhatsApp service is connected."""
    import httpx
    chat_id = os.getenv("WHATSAPP_CHAT_ID", "")
    try:
        resp = httpx.get(f"{WA_SERVICE_URL}/status", timeout=5)
        data = resp.json()
        return WhatsAppStatus(connected=data.get("ready", False), chat_id=chat_id)
    except Exception:
        return WhatsAppStatus(connected=False, chat_id=chat_id)


@app.get("/api/whatsapp/groups")
def whatsapp_groups():
    """List available WhatsApp groups."""
    import httpx
    try:
        resp = httpx.get(f"{WA_SERVICE_URL}/groups", timeout=15)
        if resp.status_code == 503:
            raise HTTPException(503, "WhatsApp not ready. Scan QR code first.")
        return resp.json()
    except httpx.ConnectError:
        raise HTTPException(503, "WhatsApp service not running. Start: node whatsapp_service.js")


@app.post("/api/whatsapp/connect")
def whatsapp_connect(req: WhatsAppConnect):
    """Save the WhatsApp chat ID to .env."""
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if not os.path.exists(env_path):
        raise HTTPException(404, ".env file not found")

    content = open(env_path).read()
    if "WHATSAPP_CHAT_ID=" in content:
        content = re.sub(r"WHATSAPP_CHAT_ID=.*", f"WHATSAPP_CHAT_ID={req.chat_id}", content)
    else:
        content += f"\nWHATSAPP_CHAT_ID={req.chat_id}\n"

    with open(env_path, "w") as f:
        f.write(content)

    # Update runtime env
    os.environ["WHATSAPP_CHAT_ID"] = req.chat_id

    return {"status": "ok", "chat_id": req.chat_id}


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: str):
    conn = get_db()
    try:
        conn.execute("DELETE FROM jobs WHERE job_id = ?", (job_id,))
        conn.commit()
        return {"status": "deleted", "job_id": job_id}
    finally:
        conn.close()
