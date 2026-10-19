"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, FolderKanban, CheckSquare, FileText, Building2 } from "lucide-react";

type SearchResult = {
  projects: Array<{ id: string; projectName: string; clientId?: { companyName: string } }>;
  tasks: Array<{ id: string; title: string; projectId?: { projectName: string }; status?: string }>;
  files: Array<{ id: string; filename: string; projectId?: { projectName: string } }>;
  clients: Array<{ id: string; companyName: string; contactEmail?: string }>;
};

const STATUS_BADGE: Record<string, string> = {
  TODO: "badge-gray", IN_PROGRESS: "badge-blue", DONE: "badge-green", BLOCKED: "badge-red",
};

export default function SearchPage() {
  const [query, setQuery]           = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["search", searchTerm],
    queryFn: () => api<SearchResult>(`/search?q=${encodeURIComponent(searchTerm)}`),
    enabled: searchTerm.length >= 2,
  });

  const hasResults = data && (data.projects?.length || data.tasks?.length || data.files?.length || data.clients?.length);
  const totalResults = (data?.projects?.length ?? 0) + (data?.tasks?.length ?? 0) +
    (data?.files?.length ?? 0) + (data?.clients?.length ?? 0);

  return (
    <div className="page space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Search</h1>
          <p className="page-subtitle">Search across projects, tasks, files, and clients</p>
        </div>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); setSearchTerm(query.trim()); }} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects, tasks, clients, files…"
            className="pl-9 h-10"
          />
        </div>
        <Button type="submit" className="h-10">Search</Button>
      </form>

      {isLoading && (
        <div className="flex items-center justify-center gap-3 text-muted-foreground py-12">
          <div className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Searching…</span>
        </div>
      )}

      {searchTerm.length >= 2 && !isLoading && !hasResults && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon"><Search className="size-6 text-muted-foreground" /></div>
            <p className="font-semibold">No results found</p>
            <p className="text-sm text-muted-foreground mt-1">No matches for &ldquo;{searchTerm}&rdquo;</p>
          </div>
        </div>
      )}

      {hasResults && (
        <>
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">{totalResults} result{totalResults !== 1 ? "s" : ""} for</p>
            <span className="badge badge-blue">{searchTerm}</span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {(data!.projects?.length ?? 0) > 0 && (
              <div className="card">
                <div className="flex items-center gap-2 px-5 py-4 border-b border-border/50">
                  <div className="icon-chip size-7 icon-chip-blue rounded-lg">
                    <FolderKanban className="size-3.5" />
                  </div>
                  <p className="font-semibold text-[14px]">Projects</p>
                  <span className="badge badge-gray ml-auto">{data!.projects.length}</span>
                </div>
                <div className="divide-y divide-border/50">
                  {data!.projects.map((p) => (
                    <Link
                      key={p.id}
                      href={`/projects/${p.id}`}
                      className="flex items-center justify-between px-5 py-3 hover:bg-muted/20 transition-colors group"
                    >
                      <span className="font-medium text-sm group-hover:text-primary-text transition-colors">{p.projectName}</span>
                      {p.clientId && (
                        <span className="text-xs text-muted-foreground">
                          {(p.clientId as { companyName?: string }).companyName}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {(data!.tasks?.length ?? 0) > 0 && (
              <div className="card">
                <div className="flex items-center gap-2 px-5 py-4 border-b border-border/50">
                  <div className="icon-chip size-7 icon-chip-green rounded-lg">
                    <CheckSquare className="size-3.5" />
                  </div>
                  <p className="font-semibold text-[14px]">Tasks</p>
                  <span className="badge badge-gray ml-auto">{data!.tasks.length}</span>
                </div>
                <div className="divide-y divide-border/50">
                  {data!.tasks.map((t) => (
                    <Link
                      key={t.id}
                      href={`/tasks?task=${t.id}`}
                      className="flex items-center justify-between px-5 py-3 hover:bg-muted/20 transition-colors group"
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-sm group-hover:text-primary-text transition-colors block truncate">{t.title}</span>
                        {t.projectId && (
                          <span className="text-xs text-muted-foreground truncate">
                            {(t.projectId as { projectName?: string }).projectName}
                          </span>
                        )}
                      </div>
                      {t.status && (
                        <span className={`badge ${STATUS_BADGE[t.status] || "badge-gray"} ml-2 shrink-0`}>
                          {t.status.replace("_", " ")}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {(data!.clients?.length ?? 0) > 0 && (
              <div className="card">
                <div className="flex items-center gap-2 px-5 py-4 border-b border-border/50">
                  <div className="icon-chip size-7 icon-chip-amber rounded-lg">
                    <Building2 className="size-3.5" />
                  </div>
                  <p className="font-semibold text-[14px]">Clients</p>
                  <span className="badge badge-gray ml-auto">{data!.clients.length}</span>
                </div>
                <div className="divide-y divide-border/50">
                  {data!.clients.map((c) => (
                    <Link
                      key={c.id}
                      href="/clients"
                      className="flex items-center justify-between px-5 py-3 hover:bg-muted/20 transition-colors group"
                    >
                      <span className="font-medium text-sm group-hover:text-primary-text transition-colors">{c.companyName}</span>
                      {c.contactEmail && (
                        <span className="text-xs text-muted-foreground">{c.contactEmail}</span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {(data!.files?.length ?? 0) > 0 && (
              <div className="card">
                <div className="flex items-center gap-2 px-5 py-4 border-b border-border/50">
                  <div className="icon-chip size-7 icon-chip-sky rounded-lg">
                    <FileText className="size-3.5" />
                  </div>
                  <p className="font-semibold text-[14px]">Files</p>
                  <span className="badge badge-gray ml-auto">{data!.files.length}</span>
                </div>
                <div className="divide-y divide-border/50">
                  {data!.files.map((f) => (
                    <div key={f.id} className="flex items-center justify-between px-5 py-3">
                      <span className="font-medium text-sm">{(f as { filename?: string }).filename}</span>
                      {f.projectId && (
                        <span className="text-xs text-muted-foreground">
                          {(f.projectId as { projectName?: string }).projectName}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {!searchTerm && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon"><Search className="size-6 text-muted-foreground" /></div>
            <p className="font-semibold">Start searching</p>
            <p className="text-sm text-muted-foreground mt-1">Type at least 2 characters to search</p>
          </div>
        </div>
      )}
    </div>
  );
}
