import { z } from "zod";
import { invariant, CoreError } from "@taskasaur/platform/core/errors";
import type { Value } from "@taskasaur/platform/field-types";
import type { Principal } from "@taskasaur/platform/plugin-sdk";
import {
  Repository,
  CredentialBroker,
  FileService,
  DeviceService,
  JobService,
  routerFor,
} from "@taskasaur/server-host";
import { processSchedules } from "./schedules";

export function createBackend(core: any) {
  return {
    async tick({
      repo,
      workspaceId,
    }: {
      repo: Repository;
      workspaceId: string;
    }) {
      await processSchedules(repo, workspaceId);
    },
    async beforeMutation({
      repo,
      principal,
      mutation,
      data,
      schema,
    }: import("@taskasaur/server-host").MutationHook) {
      const tx = repo.db;
      if (schema.id === "time" && !data.ended_at) {
        const active = await tx.query(
          "SELECT r.id FROM taskasaur.resources r JOIN taskasaur.p_time p ON p.id=r.id WHERE r.workspace_id=$1 AND r.owner_id=$2 AND r.deleted_at IS NULL AND p.ended_at IS NULL AND r.id<>$3",
          [principal.workspaceId, principal.userId, mutation.resourceId],
        );
        invariant(
          !active.rows.length,
          "TIMER_ALREADY_RUNNING",
          "Stop the active timer before starting another",
        );
      }
    },
  };
}
export default {
  async activate(context: any) {
    const core = context.services.require("core.server");
    const backend = createBackend(core) as {
      activate?: (context: any) => Promise<unknown>;
    };
    return backend.activate?.(context);
  },
};

export { processSchedules } from "./schedules";
