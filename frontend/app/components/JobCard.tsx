"use client";

import { Job, deleteJob } from "../lib/api";

const SOURCE_COLORS: Record<string, string> = {
  indeed: "bg-blue-600",
  linkedin: "bg-sky-700",
};

export default function JobCard({
  job,
  onDelete,
  selected,
  onSelect,
}: {
  job: Job;
  onDelete?: (id: string) => void;
  selected?: boolean;
  onSelect?: (id: string, checked: boolean) => void;
}) {
  const badge = SOURCE_COLORS[job.source] || "bg-gray-500";

  return (
    <div className={`bg-white rounded-xl shadow-sm border p-5 flex flex-col gap-3 hover:shadow-md transition-shadow ${
      selected ? "border-blue-400 ring-2 ring-blue-100" : "border-gray-200"
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        {onSelect && (
          <input
            type="checkbox"
            checked={!!selected}
            onChange={(e) => onSelect(job.job_id, e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 shrink-0 cursor-pointer"
          />
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 text-base leading-tight truncate">
            {job.title}
          </h3>
          <p className="text-sm text-gray-600 mt-0.5 truncate">{job.company}</p>
        </div>
        <span
          className={`${badge} text-white text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full shrink-0`}
        >
          {job.source}
        </span>
      </div>

      {/* Details */}
      <div className="flex flex-wrap gap-2 text-xs">
        {job.location && job.location !== "N/A" && (
          <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 px-2 py-1 rounded-md">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {job.location}
          </span>
        )}
        {job.contract && job.contract !== "N/A" && (
          <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 px-2 py-1 rounded-md">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {job.contract}
          </span>
        )}
        {job.salary && job.salary !== "N/A" && (
          <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 px-2 py-1 rounded-md">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
            </svg>
            {job.salary}
          </span>
        )}
      </div>

      {/* Deadline */}
      {job.deadline && job.deadline !== "N/A" && (
        <p className="text-xs text-gray-500">
          <span className="font-medium">Deadline:</span> {job.deadline}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-gray-100">
        <a
          href={job.link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800"
        >
          Apply
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-gray-400">
            {new Date(job.scraped_at).toLocaleDateString()}
          </span>
          {onDelete && (
            <button
              onClick={async () => {
                await deleteJob(job.job_id);
                onDelete(job.job_id);
              }}
              className="text-gray-400 hover:text-red-500 transition-colors"
              title="Remove job"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
