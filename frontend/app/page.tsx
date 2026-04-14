"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Job,
  Stats,
  JobsResponse,
  fetchJobs,
  fetchStats,
  bulkDeleteJobs,
  deleteAllJobs,
  JobFilters,
} from "./lib/api";
import JobCard from "./components/JobCard";
import Filters from "./components/Filters";
import WhatsAppPanel from "./components/WhatsAppPanel";
import ScrapeControl from "./components/ScrapeControl";

type Tab = "all" | "last";

export default function Home() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Tabs
  const [activeTab, setActiveTab] = useState<Tab>("all");

  // Last fetched
  const [lastScrapeAt, setLastScrapeAt] = useState<string | null>(null);
  const [lastFetchedJobs, setLastFetchedJobs] = useState<Job[]>([]);
  const [lastFetchedTotal, setLastFetchedTotal] = useState(0);

  // Selection
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());

  // Filters
  const [source, setSource] = useState("");
  const [city, setCity] = useState("");
  const [contract, setContract] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");

  // Debounce search
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [search]);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const filters: JobFilters = { page, per_page: 24, sort };
      if (source) filters.source = source;
      if (city) filters.city = city;
      if (contract) filters.contract = contract;
      if (debouncedSearch) filters.search = debouncedSearch;
      const data: JobsResponse = await fetchJobs(filters);
      setJobs(data.jobs);
      setTotal(data.total);
      setTotalPages(data.total_pages);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, [page, source, city, contract, debouncedSearch, sort]);

  const loadLastFetched = useCallback(async () => {
    if (!lastScrapeAt) return;
    try {
      const data = await fetchJobs({ after: lastScrapeAt, per_page: 100, sort: "newest" });
      setLastFetchedJobs(data.jobs);
      setLastFetchedTotal(data.total);
    } catch {
      // ignore
    }
  }, [lastScrapeAt]);

  const loadStats = useCallback(async () => {
    try {
      setStats(await fetchStats());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    loadLastFetched();
  }, [loadLastFetched]);

  const handleDelete = (id: string) => {
    setJobs((prev) => prev.filter((j) => j.job_id !== id));
    setLastFetchedJobs((prev) => prev.filter((j) => j.job_id !== id));
    setTotal((prev) => prev - 1);
    setSelectedJobs((prev) => { const next = new Set(prev); next.delete(id); return next; });
    loadStats();
  };

  const handleSelect = (id: string, checked: boolean) => {
    setSelectedJobs((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedJobs.size === displayJobs.length) {
      setSelectedJobs(new Set());
    } else {
      setSelectedJobs(new Set(displayJobs.map((j) => j.job_id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedJobs.size === 0) return;
    try {
      await bulkDeleteJobs(Array.from(selectedJobs));
      setJobs((prev) => prev.filter((j) => !selectedJobs.has(j.job_id)));
      setLastFetchedJobs((prev) => prev.filter((j) => !selectedJobs.has(j.job_id)));
      setTotal((prev) => prev - selectedJobs.size);
      setSelectedJobs(new Set());
      loadStats();
    } catch { /* ignore */ }
  };

  const handleDeleteAll = async () => {
    if (!confirm("Delete ALL jobs? This cannot be undone.")) return;
    try {
      await deleteAllJobs();
      setJobs([]);
      setLastFetchedJobs([]);
      setTotal(0);
      setLastFetchedTotal(0);
      setSelectedJobs(new Set());
      loadStats();
    } catch { /* ignore */ }
  };

  const resetFilters = () => {
    setSource("");
    setCity("");
    setContract("");
    setSearch("");
    setSort("newest");
    setPage(1);
  };

  const handleSourceChange = (v: string) => { setSource(v); setPage(1); };
  const handleCityChange = (v: string) => { setCity(v); setPage(1); };
  const handleContractChange = (v: string) => { setContract(v); setPage(1); };
  const handleSortChange = (v: string) => { setSort(v); setPage(1); };

  const handleScrapeComplete = (scrapeTimestamp: string) => {
    setLastScrapeAt(scrapeTimestamp);
    setActiveTab("last");
    loadJobs();
    loadStats();
  };

  // Which jobs to display based on active tab
  const displayJobs = activeTab === "last" ? lastFetchedJobs : jobs;
  const displayTotal = activeTab === "last" ? lastFetchedTotal : total;
  const showPagination = activeTab === "all" && totalPages > 1;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Job Automation</h1>
              <p className="text-sm text-gray-500">
                {stats
                  ? `${stats.total_jobs} jobs · ${stats.indeed_jobs} Indeed · ${stats.linkedin_jobs} LinkedIn`
                  : "Loading..."}
              </p>
            </div>
            <button
              onClick={() => { loadJobs(); loadStats(); }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar */}
          <aside className="lg:w-72 shrink-0 space-y-4">
            <Filters
              stats={stats}
              source={source}
              city={city}
              contract={contract}
              search={search}
              sort={sort}
              onSourceChange={handleSourceChange}
              onCityChange={handleCityChange}
              onContractChange={handleContractChange}
              onSearchChange={setSearch}
              onSortChange={handleSortChange}
              onReset={resetFilters}
            />
            <ScrapeControl onComplete={handleScrapeComplete} />
            <WhatsAppPanel />
          </aside>

          {/* Main content */}
          <main className="flex-1 min-w-0">
            {/* Tabs */}
            <div className="flex items-center gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
              <button
                onClick={() => setActiveTab("all")}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === "all"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                All Jobs
                <span className="ml-1.5 text-xs text-gray-400">({total})</span>
              </button>
              <button
                onClick={() => setActiveTab("last")}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === "last"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Last Fetched
                {lastScrapeAt && (
                  <span className="ml-1.5 text-xs text-gray-400">({lastFetchedTotal})</span>
                )}
              </button>
            </div>

            {/* Selection toolbar */}
            {displayJobs.length > 0 && (
              <div className="flex items-center gap-3 mb-4 bg-white border border-gray-200 rounded-lg px-4 py-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={displayJobs.length > 0 && selectedJobs.size === displayJobs.length}
                    onChange={handleSelectAll}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-600">
                    {selectedJobs.size > 0 ? `${selectedJobs.size} selected` : "Select all"}
                  </span>
                </label>
                {selectedJobs.size > 0 && (
                  <button
                    onClick={handleBulkDelete}
                    className="ml-2 px-3 py-1 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 transition-colors"
                  >
                    Delete Selected
                  </button>
                )}
                <button
                  onClick={handleDeleteAll}
                  className="ml-auto px-3 py-1 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 transition-colors"
                >
                  Delete All
                </button>
              </div>
            )}

            {/* Results header */}
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-600">
                {loading && activeTab === "all"
                  ? "Loading..."
                  : activeTab === "last" && !lastScrapeAt
                    ? "Fetch jobs to see them here"
                    : `${displayTotal} job${displayTotal !== 1 ? "s" : ""} ${activeTab === "last" ? "from last fetch" : "found"}`}
              </p>
              {showPagination && (
                <p className="text-sm text-gray-400">
                  Page {page} of {totalPages}
                </p>
              )}
            </div>

            {/* Error */}
            {error && activeTab === "all" && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
                <p className="text-sm text-red-700">{error}</p>
                <p className="text-xs text-red-500 mt-1">
                  Make sure the FastAPI backend is running on port 8000.
                </p>
              </div>
            )}

            {/* Empty state */}
            {!loading && displayJobs.length === 0 && !error ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                <p className="text-gray-500 font-medium">
                  {activeTab === "last" ? "No jobs fetched yet" : "No jobs found"}
                </p>
                <p className="text-sm text-gray-400 mt-1">
                  {activeTab === "last"
                    ? "Use \"Get Jobs\" to fetch new jobs — they'll appear here."
                    : "Try changing your filters or fetch new jobs."}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {displayJobs.map((job) => (
                  <JobCard
                    key={job.job_id}
                    job={job}
                    onDelete={handleDelete}
                    selected={selectedJobs.has(job.job_id)}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            )}

            {/* Loading skeleton */}
            {loading && activeTab === "all" && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse"
                  >
                    <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
                    <div className="h-3 bg-gray-100 rounded w-1/2 mb-4" />
                    <div className="flex gap-2 mb-3">
                      <div className="h-5 bg-gray-100 rounded w-20" />
                      <div className="h-5 bg-gray-100 rounded w-16" />
                    </div>
                    <div className="h-3 bg-gray-100 rounded w-1/3" />
                  </div>
                ))}
              </div>
            )}

            {/* Pagination (All Jobs tab only) */}
            {showPagination && (
              <div className="flex items-center justify-center gap-2 mt-6">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 7) {
                    pageNum = i + 1;
                  } else if (page <= 4) {
                    pageNum = i + 1;
                  } else if (page >= totalPages - 3) {
                    pageNum = totalPages - 6 + i;
                  } else {
                    pageNum = page - 3 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`w-9 h-9 text-sm font-medium rounded-lg transition-colors ${
                        page === pageNum
                          ? "bg-blue-600 text-white"
                          : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
