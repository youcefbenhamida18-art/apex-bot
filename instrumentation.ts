export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.ENGINE_AUTOSTART === "false") return;
  try {
    const { db } = await import("@/db");
    const { engineState } = await import("@/db/schema");
    const rows = await db.select().from(engineState).limit(1);
    const wasRunning = rows[0]?.running ?? false;
    const lastSignalAt = Number((rows[0]?.state as { lastSignalAt?: number } | null)?.lastSignalAt ?? 0);
    const shouldStart = wasRunning || process.env.ENGINE_AUTOSTART !== "false";
    if (!shouldStart) return;
    const { startEngine } = await import("@/lib/engine-service");
    // A fresh boot fires the immediate BOOT trade; a restart within 10 min of the
    // last signal resumes quietly and waits for the next hourly slot.
    await startEngine({ skipBoot: Date.now() - lastSignalAt < 10 * 60 * 1000 });
    console.log("[apex] engine resumed at boot");
  } catch (e) {
    console.error("[apex] instrumentation autostart skipped:", (e as Error).message);
  }
}
