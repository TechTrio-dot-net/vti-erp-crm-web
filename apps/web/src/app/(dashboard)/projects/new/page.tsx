"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft } from "lucide-react";
import { WorkflowStepPicker } from "@/components/projects/Workflow";

type Client = { id: string; companyName: string };

export default function NewProjectPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");
  const [teamMembers, setTeamMembers] = useState<string[]>([]);
  const [workflow, setWorkflow] = useState<string[]>(["shoot", "video_edit"]);

  const { data: clients } = useQuery({
    queryKey: ["clients"],
    queryFn: () => api<Client[]>("/clients"),
  });

  // Any internal staff member can be on a project team
  const { data: users } = useQuery({
    queryKey: ["users", "directory"],
    queryFn: () => api<Array<{ id: string; name: string; initials?: string; role: string }>>("/users/directory"),
  });

  const team = users ?? [];

  const createMutation = useMutation({
    mutationFn: (body: object) => api("/projects", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      router.push("/projects");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      projectName: name,
      clientId: clientId || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      description: description || undefined,
      teamMembers,
      workflow,
    });
  };

  const toggleMember = (id: string) => {
    setTeamMembers((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/projects">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">New project</h1>
          <p className="text-muted-foreground mt-1">Create a new project and assign team members</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Project details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="name">Project name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Website Redesign"
                required
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="client">Client *</Label>
              <select
                id="client"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                required
                className="mt-1.5 w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select client</option>
                {clients?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.companyName}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="start">Start date</Label>
                <Input
                  id="start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="end">End date</Label>
                <Input
                  id="end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="mt-1.5"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="desc">Description</Label>
              <textarea
                id="desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Project scope and goals..."
                rows={4}
                className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <Label>Follow-up steps</Label>
              <div className="mt-2"><WorkflowStepPicker value={workflow} onChange={setWorkflow} /></div>
            </div>
            <div>
              <Label>Team members</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {team.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggleMember(u.id)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      teamMembers.includes(u.id)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted hover:bg-muted/80"
                    }`}
                  >
                    {u.name}
                    <span className="ml-1 text-[10px] opacity-70">{u.role.replace(/_/g, " ").toLowerCase()}</span>
                  </button>
                ))}
              </div>
            </div>
            {createMutation.isError && (
              <p className="text-sm text-destructive">
                {createMutation.error instanceof Error
                  ? createMutation.error.message
                  : "Failed to create project"}
              </p>
            )}
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create project"}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href="/projects">Cancel</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
