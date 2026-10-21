// Shared constants + helpers for renter profile-change requests (Renter Dashboard v3).
// LinkedIn restricts accounts that change too much at once, so renters request edits and the
// LV team applies them gradually — about one change every two days.

export type ProfileChangeFieldKey =
  | "banner"
  | "headline"
  | "about"
  | "experience"
  | "location"
  | "other";

export const PROFILE_CHANGE_FIELD_KEYS: ProfileChangeFieldKey[] = [
  "banner",
  "headline",
  "about",
  "experience",
  "location",
  "other",
];

// Chip label shown in the modal + the "Requested" list.
export const FIELD_LABEL: Record<ProfileChangeFieldKey, string> = {
  banner: "Banner",
  headline: "Headline",
  about: "About",
  experience: "Experience",
  location: "Location",
  other: "Something else",
};

// Per-field text limits (characters). Banner/experience aren't plain text.
export const FIELD_MAX: Partial<Record<ProfileChangeFieldKey, number>> = {
  headline: 220,
  about: 2600,
  location: 100,
  other: 1000,
};

// Changes are spaced this many days apart; the first lands 2 days after the last pending one
// (or tomorrow if nothing is pending).
export const CHANGE_SPACING_DAYS = 2;

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface ExperiencePayload {
  action: "add" | "edit" | "remove";
  title: string;
  company: string;
  startMonth?: number | null; // 1-12
  startYear?: number | null;
  endMonth?: number | null;
  endYear?: number | null;
  isCurrent?: boolean;
  location?: string | null;
  description?: string | null;
}

// "Jan 2024 – Present" / "Mar 2021 – Dec 2023" (empty for a remove or an incomplete range).
export function experienceRange(e: ExperiencePayload): string {
  if (e.action === "remove") return "";
  if (!e.startMonth || !e.startYear) return "";
  const start = `${MONTHS[e.startMonth - 1]} ${e.startYear}`;
  const end = e.isCurrent ? "Present" : e.endMonth && e.endYear ? `${MONTHS[e.endMonth - 1]} ${e.endYear}` : "";
  return end ? `${start} – ${end}` : start;
}

// Detail text for the "Requested" row: text value, file name, or the experience summary.
export function requestDetail(req: {
  field: ProfileChangeFieldKey;
  value?: string | null;
  fileUrl?: string | null;
  experience?: ExperiencePayload | null;
}): string {
  if (req.field === "banner") {
    if (!req.fileUrl) return "Image upload";
    try {
      const name = decodeURIComponent(new URL(req.fileUrl).pathname.split("/").pop() || "");
      return name || "Image upload";
    } catch {
      return "Image upload";
    }
  }
  if (req.field === "experience" && req.experience) {
    const e = req.experience;
    const actionLabel = e.action === "add" ? "Add" : e.action === "edit" ? "Edit" : "Remove";
    const where = [e.title, e.company].filter(Boolean).join(" at ");
    const range = experienceRange(e);
    return `${actionLabel}: ${where}${range ? ` · ${range}` : ""}`;
  }
  return (req.value || "").trim();
}

// Is one submitted change complete enough to accept? (Mirrors the modal's validity rule.)
export function isChangeValid(c: {
  field: ProfileChangeFieldKey;
  value?: string | null;
  fileUrl?: string | null;
  experience?: ExperiencePayload | null;
}): boolean {
  switch (c.field) {
    case "banner":
      return !!c.fileUrl;
    case "experience": {
      const e = c.experience;
      if (!e || !e.title?.trim() || !e.company?.trim()) return false;
      if (e.action === "remove") return true;
      if (!e.startMonth || !e.startYear) return false;
      return !!e.isCurrent || !!(e.endMonth && e.endYear);
    }
    default:
      return !!c.value && c.value.trim().length > 0;
  }
}

// Next planned date: 2 days after the latest pending (future) planned date on this rental,
// or tomorrow if nothing is pending. `fromDates` are the existing pending plannedFor values.
export function firstPlannedFrom(fromDates: Date[], now = new Date()): Date {
  const start = new Date(now);
  start.setHours(12, 0, 0, 0); // noon, so DST / timezone rounding never drifts the shown day
  const future = fromDates.filter((d) => d.getTime() > now.getTime());
  if (future.length === 0) {
    const tomorrow = new Date(start);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  }
  const last = new Date(Math.max(...future.map((d) => d.getTime())));
  last.setHours(12, 0, 0, 0);
  last.setDate(last.getDate() + CHANGE_SPACING_DAYS);
  return last;
}
