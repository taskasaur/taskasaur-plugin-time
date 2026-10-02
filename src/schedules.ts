import { createHash, randomUUID } from "node:crypto";
import { Repository } from "@taskasaur/server-host";
import type { Principal, ResourceRecord } from "@taskasaur/platform/plugin-sdk";
import type { Value } from "@taskasaur/platform/field-types";
import { CoreError, invariant } from "@taskasaur/platform/core/errors";
export function stableUuid(key: string) {
  const hash = createHash("sha256").update(key).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export async function createOnce(
  repo: Repository,
  principal: Principal,
  collection: string,
  pluginId: string,
  key: string,
  data: Record<string, Value>,
) {
  const id = stableUuid(principal.workspaceId + ":" + key);
  return repo.db.transaction(async (tx) => {
    await tx.query(
      "SELECT id FROM taskasaur.workspaces WHERE id=$1 FOR UPDATE",
      [principal.workspaceId],
    );
    const store = new Repository(tx),
      existing = await tx.query(
        "SELECT id FROM taskasaur.resources WHERE id=$1",
        [id],
      );
    if (existing.rows.length) return;
    return store.mutate(principal, {
      id: randomUUID(),
      resourceId: id,
      collection,
      pluginId,
      operation: "put",
      baseRevision: 0,
      createdAt: new Date().toISOString(),
      data,
    });
  });
}
export async function processSchedules(
  repo: Repository,
  workspaceId: string,
  now = Date.now(),
) {
  const rows = await repo.db.query<{
    id: string;
    owner_id: string;
    collection: string;
    created_at: Date;
    through: Date | null;
  }>(
    "SELECT r.id,r.owner_id,r.collection,r.created_at,c.through FROM taskasaur.resources r JOIN taskasaur.plugins p ON p.workspace_id=r.workspace_id AND p.id=r.plugin_id AND p.enabled LEFT JOIN taskasaur.scheduler_cursors c ON c.resource_id=r.id WHERE r.workspace_id=$1 AND r.deleted_at IS NULL AND r.collection = 'time'",
    [workspaceId],
  );
  for (const row of rows.rows) {
    const actor: Principal = {
      workspaceId,
      userId: row.owner_id,
      pluginId: row.collection,
      permissions: [],
    };
    try {
      const record = await repo.get(actor, row.id);
      if (row.collection === "time") {
        if (
          record.data.ended_at ||
          record.data.paused_at ||
          !record.data.target_seconds
        )
          continue;
        const due =
          Date.parse(String(record.data.started_at)) +
          Number(record.data.paused_ms ?? 0) +
          Number(record.data.target_seconds) * 1000;
        if (due > now) continue;
        await repo.db.transaction(async (tx) => {
          await tx.query(
            "SELECT id FROM taskasaur.workspaces WHERE id=$1 FOR UPDATE",
            [workspaceId],
          );
          const store = new Repository(tx),
            fresh = await store.get(actor, row.id);
          if (fresh.data.ended_at || fresh.data.paused_at) return;
          await store.mutate(actor, {
            id: randomUUID(),
            resourceId: row.id,
            pluginId: "time",
            collection: "time",
            operation: "put",
            baseRevision: fresh.revision,
            createdAt: new Date(now).toISOString(),
            data: { ...fresh.data, ended_at: new Date(due).toISOString() },
          });
          await createOnce(
            store,
            actor,
            "notifications",
            "notifications",
            `timer:${row.id}`,
            {
              title:
                fresh.data.kind === "break"
                  ? "Break finished"
                  : "Focus session finished",
              body: String(fresh.data.title),
              resource_id: row.id,
              dedupe_key: `timer:${row.id}`,
            },
          );
        });
        continue;
      }
    } catch (error) {
      // A bad configuration affects this schedule, not unrelated timers and jobs.
      await repo.db.query(
        "INSERT INTO taskasaur.scheduler_cursors(resource_id,error) VALUES($1,$2) ON CONFLICT(resource_id) DO UPDATE SET error=EXCLUDED.error",
        [
          row.id,
          error instanceof CoreError
            ? `${error.kind}: ${error.message}`
            : "Schedule failed",
        ],
      );
    }
  }
}
