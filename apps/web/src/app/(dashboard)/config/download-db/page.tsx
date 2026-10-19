"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Database, Download } from "lucide-react";
import { api, apiDownload } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { AdminOnly, ErrorState, LoadingBlock, PageHeader } from "@/components/crm/ui";

export default function DownloadDbPage() {
  return <AdminOnly><DownloadDb /></AdminOnly>;
}

function DownloadDb() {
  const [busy, setBusy] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery({ queryKey: ["exports"], queryFn: () => api<Array<{ key: string; label: string }>>("/exports") });

  const download = async (key: string) => {
    setBusy(key);
    try {
      await apiDownload(`/exports/${key}`, `${key}.csv`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page space-y-5">
      <PageHeader title="Download DB" subtitle="Export any table as CSV (opens in Excel / Google Sheets). Passwords are never included." />
      {isError ? <ErrorState /> : isLoading || !data ? <LoadingBlock /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.map((t) => (
            <div key={t.key} className="card p-5 flex items-center gap-3">
              <div className="icon-chip size-10 icon-chip-blue rounded-xl"><Database className="size-5" /></div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold">{t.label}</p>
                <p className="text-xs text-muted-foreground font-mono">{t.key}.csv</p>
              </div>
              <Button size="sm" variant="outline" disabled={busy === t.key} onClick={() => download(t.key)}>
                <Download className="size-3.5" />{busy === t.key ? "…" : "CSV"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
