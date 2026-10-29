"use client";
import { useEffect, useRef, useState } from "react";
import { latestSaveQueue } from "@/lib/latest-save-queue";
type Checks = Partial<Record<"photo" | "headline" | "about" | "connections" | "experiences" | "education" | "followLinkedarmy" | "engagedPost" | "thanksMessage" | "sessionsOut" | "noRememberedPw" | "gologinRemoved" | "phoneRemoved", boolean>>;
export function useQcChecks(id: string, server: Checks | null) {
  const [checks, setChecks] = useState<Checks>(server || {});
  const current = useRef(checks);
  const [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  const previousServer = useRef(JSON.stringify(server));
  const queue = useRef<ReturnType<typeof latestSaveQueue<Checks>> | null>(null);
  if (!queue.current) queue.current = latestSaveQueue<Checks>(async qcChecks => {
    const response = await fetch(`/api/admin/ambassadors/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qcChecks }) });
    if (!response.ok) throw new Error("Save failed");
  }, (active, failure) => { setSaving(active); setError(failure); });
  useEffect(() => {
    const next = JSON.stringify(server);
    if (!queue.current!.isPending() && next !== previousServer.current) { current.current = server || {}; setChecks(current.current); }
    previousServer.current = next;
  }, [server]);
  return { checks, saving, error, retry: () => queue.current!.retry(), toggle: (key: keyof Checks, checked: boolean) => {
    current.current = { ...current.current, [key]: checked }; setChecks(current.current); queue.current!.push(current.current);
  } };
}
