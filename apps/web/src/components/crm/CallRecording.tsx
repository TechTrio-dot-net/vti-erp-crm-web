"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, FileAudio, Loader2, RotateCw } from "lucide-react";
import { api, authedFetch } from "@/lib/api";
import { fmtDateTime, isCrmAdmin } from "@/lib/crm";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type RecordingInfo = {
  callId: string;
  recording: {
    id: string; status: "uploading" | "uploaded" | "transcribing" | "transcribed" | "failed"; hasAudio: boolean; fileName: string | null;
    sizeBytes: number | null; transcript: string | null; language: string | null; summary: string | null; error: string | null; transcribedAt: string | null;
  } | null;
  externalUrl: string | null;
  audioUrl: string | null;
  transcriptionEnabled: boolean;
};

const STATUS_BADGE: Record<string, { label: string; badge: string }> = {
  transcribed: { label: "Transcript", badge: "badge-green" },
  uploaded: { label: "Transcribing…", badge: "badge-amber" },
  transcribing: { label: "Transcribing…", badge: "badge-amber" },
  failed: { label: "Recording", badge: "badge-red" },
  // The file may be in storage with the phone's confirmation missing; opening it checks and finishes it
  uploading: { label: "Recording", badge: "badge-amber" },
};

/** "Transcript" / "Recording" button for a call; opens the player, summary and transcript */
export function RecordingButton({ callId, status, recordingUrl }: { callId: string; status: string | null; recordingUrl?: string | null }) {
  const [open, setOpen] = useState(false);
  const meta = status ? STATUS_BADGE[status] : null;
  if (!meta) {
    // A company-line recording that hasn't been picked up for transcription
    return recordingUrl ? <a href={recordingUrl} target="_blank" rel="noreferrer" className="text-primary-text text-sm hover:underline">Recording</a> : null;
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`badge ${meta.badge} inline-flex items-center gap-1 hover:opacity-80`} title="Play the recording and read the transcript">
        <FileAudio className="size-3" />{meta.label}
      </button>
      {open && <RecordingDialog callId={callId} onClose={() => setOpen(false)} />}
    </>
  );
}

function RecordingDialog({ callId, onClose }: { callId: string; onClose: () => void }) {
  const role = useAuthStore((s) => s.user?.role);
  const queryClient = useQueryClient();
  const info = useQuery({
    queryKey: ["crm", "recording", callId],
    queryFn: () => api<RecordingInfo>(`/calls/${callId}/recording`),
    // Keep checking while the transcript is being made
    refetchInterval: (q) => (["uploaded", "transcribing"].includes(q.state.data?.recording?.status ?? "") ? 5000 : false),
  });
  const rec = info.data?.recording;

  // With R2 the player gets a signed link; otherwise <audio> can't send the sign-in token, so the file is
  // fetched and played from memory
  const served = !!info.data?.audioUrl;
  // The first signed link is kept: each refresh while transcribing signs a new one, which would restart the player
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  if (!signedUrl && info.data?.audioUrl) setSignedUrl(info.data.audioUrl);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioUrl = signedUrl ?? info.data?.audioUrl ?? blobUrl;
  useEffect(() => {
    if (!rec?.hasAudio || served) return;
    let url: string | null = null;
    let cancelled = false;
    authedFetch(`/calls/${callId}/recording/audio`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load the recording");
        const blob = await res.blob();
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      })
      .catch((e: Error) => !cancelled && setAudioError(e.message));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [callId, rec?.hasAudio, served]);

  const retranscribe = useMutation({
    mutationFn: () => api<{ ok: boolean; status: string; error: string | null }>(`/calls/${callId}/recording/transcribe`, { method: "POST", body: "{}" }),
    onSuccess: (r) => {
      if (r.ok) toast.success("Transcribed");
      else toast.error(r.error || "Transcription failed");
      queryClient.invalidateQueries({ queryKey: ["crm"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copy = () => {
    if (!rec?.transcript) return;
    navigator.clipboard.writeText(rec.transcript).then(() => toast.success("Transcript copied"), () => toast.error("Could not copy"));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Call recording</DialogTitle>
        </DialogHeader>
        {info.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading…</div>
        ) : info.isError || !info.data ? (
          <p className="text-sm text-red-600">{(info.error as Error)?.message ?? "Could not load the recording"}</p>
        ) : !rec ? (
          info.data.externalUrl
            ? <a href={info.data.externalUrl} target="_blank" rel="noreferrer" className="text-primary-text hover:underline text-sm">Open the recording</a>
            : <p className="text-sm text-muted-foreground">No recording for this call.</p>
        ) : (
          <div className="space-y-4">
            {rec.hasAudio && (
              audioError ? <p className="text-sm text-red-600">{audioError}</p>
                : audioUrl ? <audio controls preload="metadata" src={audioUrl} className="w-full" onError={() => setAudioError("This recording could not be played")} />
                : <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading audio…</div>
            )}

            {rec.status === "uploading" && (
              <p className="text-sm text-muted-foreground">The phone hasn&apos;t finished uploading this recording yet. It will appear here once it arrives.</p>
            )}
            {(rec.status === "uploaded" || rec.status === "transcribing") && (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                {info.data.transcriptionEnabled
                  ? <><Loader2 className="size-4 animate-spin" />Converting speech to text — this takes about a minute.</>
                  : "Speech to text is not set up yet (TRANSCRIBE_API_KEY), so this recording has no transcript."}
                {rec.error && <span className="text-amber-700">Last try: {rec.error}</span>}
              </p>
            )}
            {rec.status === "failed" && <p className="text-sm text-red-600">Transcription failed: {rec.error}</p>}

            {rec.summary && (
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="section-label text-muted-foreground mb-1">Summary</p>
                <div className="text-sm whitespace-pre-wrap">{rec.summary}</div>
              </div>
            )}

            {rec.status === "transcribed" && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="section-label text-muted-foreground">
                    Transcript{rec.language && <span className="normal-case font-normal"> · {rec.language}</span>}
                    {rec.transcribedAt && <span className="normal-case font-normal"> · {fmtDateTime(rec.transcribedAt)}</span>}
                  </p>
                  {rec.transcript && <Button size="sm" variant="ghost" className="h-7" onClick={copy}><Copy className="size-3.5" />Copy</Button>}
                </div>
                <div className="rounded-lg border p-3 text-sm whitespace-pre-wrap max-h-80 overflow-y-auto leading-relaxed">
                  {rec.transcript || <span className="text-muted-foreground">No speech was recognised in this recording.</span>}
                </div>
              </div>
            )}

            {isCrmAdmin(role) && info.data.transcriptionEnabled && (rec.status === "failed" || rec.status === "transcribed") && (
              <Button size="sm" variant="outline" disabled={retranscribe.isPending} onClick={() => retranscribe.mutate()}>
                {retranscribe.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
                {rec.status === "failed" ? "Try again" : "Transcribe again"}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
