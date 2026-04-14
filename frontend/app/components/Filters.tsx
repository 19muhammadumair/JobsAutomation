"use client";

import { Stats } from "../lib/api";

interface FiltersProps {
  stats: Stats | null;
  source: string;
  city: string;
  contract: string;
  search: string;
  sort: string;
  onSourceChange: (v: string) => void;
  onCityChange: (v: string) => void;
  onContractChange: (v: string) => void;
  onSearchChange: (v: string) => void;
  onSortChange: (v: string) => void;
  onReset: () => void;
}

export default function Filters({
  stats,
  source,
  city,
  contract,
  search,
  sort,
  onSourceChange,
  onCityChange,
  onContractChange,
  onSearchChange,
  onSortChange,
  onReset,
}: FiltersProps) {
  const hasFilters = source || city || contract || search;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Filters</h2>
        {hasFilters && (
          <button
            onClick={onReset}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="space-y-4">
        {/* Search */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Search</label>
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Job title or company..."
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>

        {/* Source */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Source</label>
          <div className="flex gap-2">
            {[
              { value: "", label: "All" },
              { value: "indeed", label: "Indeed" },
              { value: "linkedin", label: "LinkedIn" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => onSourceChange(opt.value)}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  source === opt.value
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                }`}
              >
                {opt.label}
                {opt.value === "" && stats ? ` (${stats.total_jobs})` : ""}
                {opt.value === "indeed" && stats ? ` (${stats.indeed_jobs})` : ""}
                {opt.value === "linkedin" && stats ? ` (${stats.linkedin_jobs})` : ""}
              </button>
            ))}
          </div>
        </div>

        {/* City */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">City</label>
          <select
            value={city}
            onChange={(e) => onCityChange(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
          >
            <option value="">All cities</option>
            {stats?.cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Contract Type */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Contract Type</label>
          <select
            value={contract}
            onChange={(e) => onContractChange(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
          >
            <option value="">All types</option>
            {stats?.contract_types.map((ct) => (
              <option key={ct} value={ct}>
                {ct}
              </option>
            ))}
          </select>
        </div>

        {/* Sort */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Sort by</label>
          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
      </div>
    </div>
  );
}
