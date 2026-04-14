"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Job,
  Stats,
  JobsResponse,
  fetchJobs,
  fetchStats,
  JobFilters,
} from "./lib/api";
import JobCard from "./components/JobCard";
import Filters from "./components/Filters";
import WhatsAppPanel from "./components/WhatsAppPanel";
import ScrapeControl from "./components/ScrapeControl";

export default function Home() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  const handleDelete = (id: string) => {
    setJobs((prev) => prev.filter((j) => j.job_id !== id));
    setTotal((prev) => prev - 1);
    loadStats();
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

  const refreshAll = () => {
    loadJobs();
    loadStats();
  };

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
              onClick={refreshAll}
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
            <ScrapeControl onComplete={refreshAll} />
            <WhatsAppPanel />
          </aside>

          {/* Main content */}
          <main className="flex-1 min-w-0">
            {/* Results header */}
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-600">
                {loading ? "Loading..." : `${total} job${total !== 1 ? "s" : ""} found`}
              </p>
              {totalPages > 1 && (
                <p className="text-sm text-gray-400">
                  Page {page} of {totalPages}
                </p>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
                <p className="text-sm text-red-700">{error}</p>
                <p className="text-xs text-red-500 mt-1">
                  Make sure the FastAPI backend is running on port 8000.
                </p>
              </div>
            )}

            {/* Job grid */}
            {!loading && jobs.length === 0 && !error ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                <p className="text-gray-500 font-medium">No jobs found</p>
                <p className="text-sm text-gray-400 mt-1">
                  Try changing your filters or run a scrape.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {jobs.map((job) => (
                  <JobCard key={job.job_id} job={job} onDelete={handleDelete} />
                ))}
              </div>
            )}

            {/* Loading skeleton */}
            {loading && (
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

            {/* Pagination */}
            {totalPages > 1 && (
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
