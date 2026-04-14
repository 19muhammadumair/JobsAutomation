"use client";

import { useState } from "react";
import { triggerScrape, ScrapeResult } from "../lib/api";

const UK_CITIES = [
  "Leeds", "London", "Manchester", "Birmingham", "Liverpool",
  "Sheffield", "Bristol", "Newcastle", "Nottingham", "Leicester",
  "Edinburgh", "Glasgow", "Cardiff", "Belfast", "Bradford",
  "Coventry", "Southampton", "Derby", "Plymouth", "Wolverhampton",
  "Reading", "Oxford", "Cambridge", "York", "Huddersfield",
  "Wakefield", "Halifax", "Barnsley", "Doncaster", "Rotherham",
];

const JOB_TYPES = [
  { value: "", label: "All Types" },
  { value: "parttime", label: "Part Time" },
  { value: "fulltime", label: "Full Time" },
  { value: "contract", label: "Contract" },
  { value: "temporary", label: "Temporary" },
  { value: "internship", label: "Internship" },
];

const DISTANCE_OPTIONS = [5, 10, 15, 25, 50, 100];
const LIMIT_OPTIONS = [5, 10, 15, 25, 50];

export default function ScrapeControl({ onComplete }: { onComplete?: (scrapeTimestamp: string) => void }) {
  const [source, setSource] = useState("both");
  const [role, setRole] = useState("");
  const [jobType, setJobType] = useState("");
  const [location, setLocation] = useState("Leeds");
  const [distance, setDistance] = useState(25);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  const handleGetJobs = async () => {
    setLoading(true);
    setResult(null);
    setError("");
    // Record timestamp before scraping so we can filter "last fetched"
    const scrapeTimestamp = new Date().toISOString();
    try {
      // Build query: combine job type + role
      const parts: string[] = [];
      if (jobType) parts.push(jobType === "parttime" ? "part time" : jobType === "fulltime" ? "full time" : jobType);
      if (role.trim()) parts.push(role.trim());
      const query = parts.join(" ") || "part time";

      const res = await triggerScrape({
        source,
        query,
        location,
        radius: distance,
        max_jobs: limit,
        job_type: jobType,
      });
      setResult(res);
      onComplete?.(scrapeTimestamp);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to get jobs");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full"
      >
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Get Jobs
        </h2>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-4 space-y-3">
          {/* Source selector */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Source</label>
            <div className="flex gap-2">
              {[
                { value: "both", label: "Both" },
                { value: "indeed", label: "Indeed" },
                { value: "linkedin", label: "LinkedIn" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSource(opt.value)}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    source === opt.value
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Role (free text) */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. marketing, developer, barista..."
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          {/* Job Type dropdown */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Job Type</label>
            <select
              value={jobType}
              onChange={(e) => setJobType(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              {JOB_TYPES.map((jt) => (
                <option key={jt.value} value={jt.value}>
                  {jt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Location dropdown */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              {UK_CITIES.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          </div>

          {/* Distance */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Distance (miles)</label>
            <div className="flex gap-1.5">
              {DISTANCE_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDistance(d)}
                  className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    distance === d
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Limit */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Jobs Limit</label>
            <div className="flex gap-1.5">
              {LIMIT_OPTIONS.map((l) => (
                <button
                  key={l}
                  onClick={() => setLimit(l)}
                  className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    limit === l
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Get Jobs button */}
          <button
            onClick={handleGetJobs}
            disabled={loading}
            className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Getting Jobs...
              </>
            ) : (
              "Get Jobs"
            )}
          </button>

          {/* Result */}
          {result && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-800">
              <p className="font-medium">{result.new_jobs} new jobs found</p>
              <p className="text-xs text-green-600 mt-0.5">{result.message}</p>
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
