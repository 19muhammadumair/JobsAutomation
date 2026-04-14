"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  WhatsAppStatus,
  WhatsAppGroup,
  fetchWhatsAppStatus,
  fetchWhatsAppGroups,
  fetchWhatsAppQR,
  connectWhatsApp,
  disconnectWhatsApp,
} from "../lib/api";

export default function WhatsAppPanel() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollStatus = useCallback(async () => {
    try {
      const s = await fetchWhatsAppStatus();
      setStatus(s);

      if (s.state === "qr") {
        try {
          const qrRes = await fetchWhatsAppQR();
          setQrDataUrl(qrRes.qr);
        } catch {
          setQrDataUrl(null);
        }
      } else {
        setQrDataUrl(null);
      }

      if (s.connected && groups.length === 0) {
        try {
          const g = await fetchWhatsAppGroups();
          if (g.length > 0) setGroups(g);
        } catch {
          // ignore
        }
      }
    } catch {
      setStatus({ connected: false, chat_id: "", state: "offline" });
      setQrDataUrl(null);
    }
  }, [groups.length]);

  const state = status?.state || "offline";

  useEffect(() => {
    pollStatus();
    // Only poll when not ready — stop once connected
    if (state !== "ready") {
      pollRef.current = setInterval(pollStatus, 3000);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [pollStatus, state]);

  const loadGroups = async () => {
    setLoading(true);
    setError("");
    try {
      const g = await fetchWhatsAppGroups();
      if (g.length === 0) {
        setError("No groups found. Make sure WhatsApp service is running and connected.");
      } else {
        setGroups(g);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load groups");
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async (chatId: string) => {
    setError("");
    setSuccess("");
    try {
      await connectWhatsApp(chatId);
      setStatus((prev) => (prev ? { ...prev, chat_id: chatId } : prev));
      setSuccess("Connected! Job alerts will be sent to this group.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to connect");
    }
  };

  const stateLabel: Record<string, string> = {
    offline: "Service Offline",
    initializing: "Starting up...",
    qr: "Scan QR Code",
    authenticated: "Authenticating...",
    ready: "Connected",
    disconnected: "Disconnected",
    unknown: "Checking...",
  };

  const stateColor: Record<string, string> = {
    offline: "bg-red-400",
    initializing: "bg-yellow-400 animate-pulse",
    qr: "bg-yellow-400 animate-pulse",
    authenticated: "bg-blue-400 animate-pulse",
    ready: "bg-green-500 animate-pulse",
    disconnected: "bg-red-400",
    unknown: "bg-gray-400",
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
        <svg className="w-4 h-4 text-green-500" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
        WhatsApp
      </h2>

      {/* Status indicator */}
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2 h-2 rounded-full ${stateColor[state] || "bg-gray-400"}`} />
        <span className="text-sm text-gray-600">{stateLabel[state] || state}</span>
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>
      )}
      {success && (
        <p className="text-xs text-green-600 bg-green-50 rounded-lg px-3 py-2 mb-3">{success}</p>
      )}

      {/* OFFLINE: setup instructions */}
      {state === "offline" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
          <p className="text-xs font-semibold text-amber-800 mb-2">How to start</p>
          <ol className="text-xs text-amber-700 space-y-1.5 list-decimal list-inside">
            <li>Open a terminal in the project root</li>
            <li>Run: <code className="bg-amber-100 px-1 py-0.5 rounded text-[11px] font-mono">node whatsapp_service.js</code></li>
            <li>The QR code will appear here automatically</li>
          </ol>
        </div>
      )}

      {/* INITIALIZING */}
      {state === "initializing" && (
        <div className="flex flex-col items-center py-4 text-gray-500">
          <svg className="animate-spin w-6 h-6 mb-2" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-xs">WhatsApp service is starting up...</p>
        </div>
      )}

      {/* QR CODE */}
      {state === "qr" && (
        <div className="flex flex-col items-center mb-3">
          {qrDataUrl ? (
            <>
              <div className="bg-white border-2 border-green-200 rounded-xl p-2 mb-3 shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt="WhatsApp QR Code" width={220} height={220} className="rounded-lg" />
              </div>
              <p className="text-xs text-gray-600 text-center font-medium mb-1">Scan with WhatsApp to connect</p>
              <p className="text-[11px] text-gray-400 text-center">
                WhatsApp → Settings → Linked Devices → Link a Device
              </p>
            </>
          ) : (
            <div className="py-4">
              <svg className="animate-spin w-6 h-6 text-gray-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <p className="text-xs text-gray-400 text-center">Loading QR code...</p>
            </div>
          )}
        </div>
      )}

      {/* AUTHENTICATED */}
      {state === "authenticated" && (
        <div className="flex flex-col items-center py-4 text-blue-600">
          <svg className="animate-spin w-6 h-6 mb-2" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-xs">Authenticated! Loading WhatsApp...</p>
        </div>
      )}

      {/* READY: group selection */}
      {state === "ready" && (
        <>
          {status?.chat_id && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-3">
              <svg className="w-3.5 h-3.5 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-xs text-green-700 truncate" title={status.chat_id}>
                Alerts: <strong>{groups.find((g) => g.id === status.chat_id)?.name || status.chat_id}</strong>
              </p>
            </div>
          )}

          {groups.length === 0 ? (
            <button
              onClick={loadGroups}
              disabled={loading}
              className="w-full px-3 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:bg-green-300 rounded-lg transition-colors"
            >
              {loading ? "Loading groups..." : "Load WhatsApp Groups"}
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-600">Select a group for job alerts:</p>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {groups.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => handleConnect(g.id)}
                    className={`w-full text-left px-3 py-2 text-sm rounded-lg border transition-colors flex items-center gap-2 ${
                      status?.chat_id === g.id
                        ? "bg-green-50 border-green-300 text-green-800"
                        : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {status?.chat_id === g.id && (
                      <svg className="w-3.5 h-3.5 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    <span className="truncate">{g.name}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={loadGroups}
                disabled={loading}
                className="w-full px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                {loading ? "Refreshing..." : "↻ Refresh group list"}
              </button>
              <button
                onClick={async () => {
                  setError("");
                  setSuccess("");
                  try {
                    await disconnectWhatsApp();
                    setStatus({ connected: false, chat_id: "", state: "initializing" });
                    setGroups([]);
                    setQrDataUrl(null);
                  } catch (e: unknown) {
                    setError(e instanceof Error ? e.message : "Failed to disconnect");
                  }
                }}
                className="w-full px-3 py-2 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
              >
                Disconnect WhatsApp
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
