import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { generateTasks } from "@/lib/admin-tasks";

function errorResponse(error: unknown) {
  if (error instanceof Error && (error.message === "Forbidden" || error.message === "Unauthorized")) {
    return NextResponse.json({ error: error.message }, { status: error.message === "Forbidden" ? 403 : 401 });
  }
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

// GET — the live To-do worklist, each derived task merged with its human state
// (claim / assignee / done) and the list of admins a task can be assigned to.
export async function GET(req: NextRequest) {
  try {
    const me = await requireAdmin();
    const includeTest = req.nextUrl.searchParams.get("includeTest") === "1";

    const derived = await generateTasks({ includeTest });
    const keys = derived.map((t) => t.taskKey);
    const [overrides, admins] = await Promise.all([
      prisma.adminTask.findMany({
        where: { taskKey: { in: keys } },
        include: { claimedBy: { select: { id: true, fullName: true } } },
      }),
      prisma.user.findMany({
        where: { role: "admin", ...(includeTest ? {} : { isTest: false }) },
        select: { id: true, fullName: true },
        orderBy: { fullName: "asc" },
      }),
    ]);
    const byKey = new Map(overrides.map((o) => [o.taskKey, o]));

    const tasks = derived
      .map((t) => {
        const o = byKey.get(t.taskKey);
        return {
          ...t,
          status: o?.status ?? "open",
          claimedBy: o?.claimedBy ? { id: o.claimedBy.id, name: o.claimedBy.fullName } : null,
        };
      })
      .filter((t) => t.status !== "done"); // "clears when done"

    const counts = {
      all: tasks.length,
      unclaimed: tasks.filter((t) => t.status === "open").length,
      mine: tasks.filter((t) => t.claimedBy?.id === me.id).length,
    };

    return NextResponse.json({
      tasks,
      me: { id: me.id, name: me.fullName },
      admins: admins.map((a) => ({ id: a.id, name: a.fullName })),
      counts,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// POST — claim / unclaim / assign / done. Body: { taskKey, action, assigneeId? }
export async function POST(req: NextRequest) {
  try {
    const me = await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const taskKey = typeof body.taskKey === "string" ? body.taskKey : "";
    const action = typeof body.action === "string" ? body.action : "";
    if (!taskKey) return NextResponse.json({ error: "taskKey required" }, { status: 400 });

    let data: Record<string, unknown>;
    if (action === "claim") {
      data = { status: "claimed", claimedById: me.id, claimedAt: new Date(), doneAt: null };
    } else if (action === "unclaim") {
      data = { status: "open", claimedById: null, claimedAt: null, doneAt: null };
    } else if (action === "assign") {
      if (!body.assigneeId) return NextResponse.json({ error: "assigneeId required" }, { status: 400 });
      data = { status: "claimed", claimedById: String(body.assigneeId), claimedAt: new Date(), doneAt: null };
    } else if (action === "done") {
      data = { status: "done", doneAt: new Date() };
    } else {
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }

    await prisma.adminTask.upsert({
      where: { taskKey },
      update: data,
      create: { taskKey, ...data },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
