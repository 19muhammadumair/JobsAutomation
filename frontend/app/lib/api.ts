const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface Job {
  job_id: string;
  title: string;
  company: string;
  salary: string;
  contract: string;
  location: string;
  deadline: string;
  link: string;
  scraped_at: string;
  source: string;
}

export interface JobsResponse {
  jobs: Job[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface Stats {
  total_jobs: number;
  indeed_jobs: number;
  linkedin_jobs: number;
  cities: string[];
  contract_types: string[];
}

export interface WhatsAppStatus {
  connected: boolean;
  chat_id: string;
  state: string;
}

export interface WhatsAppGroup {
  id: string;
  name: string;
}

export interface WhatsAppQR {
  qr: string | null;
  state: string;
}

export interface ScrapeResult {
  status: string;
  message: string;
  new_jobs: number;
}

export interface JobFilters {
  page?: number;
  per_page?: number;
  source?: string;
  city?: string;
  contract?: string;
  search?: string;
  sort?: string;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

export function fetchJobs(filters: JobFilters = {}): Promise<JobsResponse> {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.per_page) params.set("per_page", String(filters.per_page));
  if (filters.source) params.set("source", filters.source);
  if (filters.city) params.set("city", filters.city);
  if (filters.contract) params.set("contract", filters.contract);
  if (filters.search) params.set("search", filters.search);
  if (filters.sort) params.set("sort", filters.sort);
  const qs = params.toString();
  return apiFetch<JobsResponse>(`/api/jobs${qs ? `?${qs}` : ""}`);
}

export function fetchStats(): Promise<Stats> {
  return apiFetch<Stats>("/api/stats");
}

export function triggerScrape(body: {
  source: string;
  query?: string;
  location?: string;
  radius?: number;
  max_pages?: number;
  max_jobs?: number;
}): Promise<ScrapeResult> {
  return apiFetch<ScrapeResult>("/api/scrape", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchWhatsAppStatus(): Promise<WhatsAppStatus> {
  return apiFetch<WhatsAppStatus>("/api/whatsapp/status");
}

export function fetchWhatsAppGroups(): Promise<WhatsAppGroup[]> {
  return apiFetch<WhatsAppGroup[]>("/api/whatsapp/groups");
}

export function fetchWhatsAppQR(): Promise<WhatsAppQR> {
  return apiFetch<WhatsAppQR>("/api/whatsapp/qr");
}

export function connectWhatsApp(chatId: string): Promise<{ status: string; chat_id: string }> {
  return apiFetch("/api/whatsapp/connect", {
    method: "POST",
    body: JSON.stringify({ chat_id: chatId }),
  });
}

export function deleteJob(jobId: string): Promise<{ status: string }> {
  return apiFetch(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
}
