# Indeed UK Job Scraper

Automated scraper for Indeed UK that finds new job listings and sends alerts via WhatsApp.

## Features

- **TLS stealth**: Uses `curl_cffi` impersonating Chrome to bypass fingerprinting
- **Deduplication**: SQLite database tracks seen job IDs — no duplicate alerts
- **WhatsApp alerts**: New jobs are sent to your phone via Twilio
- **Proxy rotation**: Supports residential proxy rotation (host:port:user:pass)
- **Configurable**: Search query, location, radius, job age — all adjustable via CLI flags
- **Robust**: Try/except blocks, random delays (5-10s) between pages, logging to file

---

## Quick Start

### 1. Clone & install

```bash
cd /home/dev/Desktop/projects/umair/jobsautomation
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
nano .env   # Fill in your real Twilio + proxy credentials
```

#### Twilio WhatsApp setup

1. Sign up at [twilio.com](https://www.twilio.com/)
2. Activate the **WhatsApp Sandbox** in the Twilio Console
3. Send the join code from your phone to the sandbox number
4. Copy the credentials into `.env`:
   - `TWILIO_ACCOUNT_SID` — from Console dashboard
   - `TWILIO_AUTH_TOKEN` — from Console dashboard
   - `TWILIO_WHATSAPP_FROM` — the sandbox number, e.g. `whatsapp:+14155238886`
   - `WHATSAPP_TO` — your number, e.g. `whatsapp:+447712345678`

### 3. Run manually

```bash
# Default: "part time" in Leeds, 25mi radius, last 24 hours
python indeed_scraper.py

# Custom search
python indeed_scraper.py --query "warehouse" --location "Manchester" --radius 15

# Jobs from last 7 days instead of 24 hours
python indeed_scraper.py --fromage 7

# Full-time only
python indeed_scraper.py --job-type fulltime

# Continuous mode — runs every hour
python indeed_scraper.py --loop
```

### 4. CLI options

| Flag | Default | Description |
|------|---------|-------------|
| `--query`, `-q` | `part time` | Search keywords |
| `--location`, `-l` | `Leeds` | City in the UK |
| `--radius`, `-r` | `25` | Radius in miles |
| `--fromage`, `-f` | `1` | Max job age in days (1 = 24h, 7 = week) |
| `--job-type`, `-jt` | *(all)* | `parttime`, `fulltime`, `contract`, `temporary` |
| `--max-pages`, `-p` | `5` | Max result pages to scrape |
| `--loop` | off | Run continuously every hour |

---

## Cron Job Setup (Linux Server)

### Option A — Run every hour (recommended)

```bash
crontab -e
```

Add this line:

```cron
0 * * * * cd /home/dev/Desktop/projects/umair/jobsautomation && /home/dev/Desktop/projects/umair/jobsautomation/venv/bin/python indeed_scraper.py >> /var/log/indeed_scraper_cron.log 2>&1
```

This runs the scraper **at minute 0 of every hour**.

### Option B — Run every 24 hours (once a day at 8 AM)

```cron
0 8 * * * cd /home/dev/Desktop/projects/umair/jobsautomation && /home/dev/Desktop/projects/umair/jobsautomation/venv/bin/python indeed_scraper.py --fromage 1 >> /var/log/indeed_scraper_cron.log 2>&1
```

### Option C — Run every 24 hours, scan last 7 days

```cron
0 8 * * * cd /home/dev/Desktop/projects/umair/jobsautomation && /home/dev/Desktop/projects/umair/jobsautomation/venv/bin/python indeed_scraper.py --fromage 7 >> /var/log/indeed_scraper_cron.log 2>&1
```

### Verify cron is working

```bash
# List your cron jobs
crontab -l

# Check cron logs
tail -f /var/log/indeed_scraper_cron.log

# Check the app log
tail -f /home/dev/Desktop/projects/umair/jobsautomation/scraper.log
```

### Cron tips

- Always use **absolute paths** in cron (to the venv python binary and the script).
- The `cd` before the python command ensures `.env` and `jobs.db` resolve correctly.
- Redirect both stdout and stderr (`>> file 2>&1`) so you can debug failures.

---

## Project Structure

```
jobsautomation/
├── indeed_scraper.py    # Main scraper script
├── requirements.txt     # Python dependencies
├── .env.example         # Template for environment variables
├── .env                 # Your actual credentials (git-ignored)
├── .gitignore
├── jobs.db              # SQLite database (auto-created on first run)
├── scraper.log          # Log file (auto-created)
└── README.md
```

---

## How It Works

1. **Build URL** → Constructs Indeed search URL with your query, location, radius, age filter, sorted by date.
2. **Fetch** → `curl_cffi` makes the request impersonating Chrome, rotating through proxies.
3. **Parse** → Tries JSON extraction first (`mosaic-provider-jobcards` script tag), falls back to HTML parsing. Extracts the `jk` (Job Key) as the unique identifier.
4. **Deduplicate** → Checks each `jk` against the SQLite database. Only new jobs proceed.
5. **Store** → Inserts new jobs into the database.
6. **Notify** → Formats job details and sends via Twilio WhatsApp API (batched, 3 per message).
7. **Repeat** → Sleeps 5-10 seconds between pages. If `--loop`, waits 1 hour then repeats.

---

## Proxy Configuration

Add residential proxies to `.env` as a comma-separated list:

```
PROXY_LIST=us1.proxy.com:8080:myuser:mypass,us2.proxy.com:8080:myuser:mypass
```

The scraper randomly picks one proxy per request. If no proxies are configured, it connects directly.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| No jobs found | Indeed may have changed HTML structure. Check `scraper.log` for HTTP status codes. Try running with `--fromage 7` for a wider window. |
| 403 / blocked | Add residential proxies. Increase `SLEEP_MIN`/`SLEEP_MAX` in the script. |
| WhatsApp not received | Verify `.env` credentials. Check Twilio dashboard for message logs. Make sure you joined the sandbox from your phone. |
| `ModuleNotFoundError` | Make sure you activated the venv: `source venv/bin/activate` |
