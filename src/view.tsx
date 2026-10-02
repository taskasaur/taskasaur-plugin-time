"use client";
import { useEffect, useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Play,
  Square,
  Download,
  Upload,
  Check,
  AlarmClock,
} from "lucide-react";
import type { AppRuntime } from "@taskasaur/plugin-host";
import { RecordTable } from "@taskasaur/ui/record-table";
import { Button } from "@taskasaur/ui/primitives/button";
import { Input } from "@taskasaur/ui/primitives/input";
import {
  calendarExport,
  calendarImport,
  importedReminders,
} from "@taskasaur/platform/core/calendar";
import { calendarOccurrences } from "@taskasaur/platform/core/calendar-values";
import { field } from "@taskasaur/platform/field-types";
import { FieldInput } from "@taskasaur/ui/fields";
import type { ResourceRecord } from "@taskasaur/platform/plugin-sdk";
export function TimeView({ runtime }: { runtime: AppRuntime }) {
  const rows =
    useLiveQuery(() => runtime.collection("time").list(), [runtime]) ?? [];
  const running = rows.find((row) => !row.data.ended_at),
    [title, setTitle] = useState(""),
    [kind, setKind] = useState("work"),
    [minutes, setMinutes] = useState(25),
    [tick, setTick] = useState(Date.now()),
    [error, setError] = useState("");
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = running
    ? Math.max(
        0,
        Math.floor(
          ((running.data.paused_at
            ? Date.parse(String(running.data.paused_at))
            : tick) -
            Date.parse(String(running.data.started_at)) -
            Number(running.data.paused_ms ?? "0")) /
            1000,
        ),
      )
    : 0;
  const duration = `${Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((seconds / 60) % 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  async function toggle() {
    try {
      const store = runtime.collection("time");
      if (running)
        await store.put(
          {
            ...running.data,
            ended_at: new Date().toISOString(),
            paused_at: null,
            paused_ms: String(
              Number(running.data.paused_ms ?? "0") +
                (running.data.paused_at
                  ? Date.now() - Date.parse(String(running.data.paused_at))
                  : 0),
            ),
          },
          running.id,
        );
      else
        await store.put({
          title: title || "Untitled activity",
          started_at: new Date().toISOString(),
          kind,
          target_seconds: kind === "work" ? null : minutes * 60,
        });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function pause() {
    if (!running) return;
    const paused = running.data.paused_at;
    await runtime.collection("time").put(
      {
        ...running.data,
        paused_at: paused ? null : new Date().toISOString(),
        paused_ms: String(
          Number(running.data.paused_ms ?? "0") +
            (paused ? Date.now() - Date.parse(String(paused)) : 0),
        ),
      },
      running.id,
    );
  }
  useEffect(() => {
    if (
      !running ||
      running.data.paused_at ||
      !running.data.target_seconds ||
      seconds < Number(running.data.target_seconds)
    )
      return;
    void (async () => {
      await toggle();
      await runtime.collection("notifications").put({
        title:
          running.data.kind === "break"
            ? "Break finished"
            : "Focus session finished",
        body: String(running.data.title),
        resource_id: running.id,
        dedupe_key: `timer:${running.id}`,
      });
      if ("Notification" in window && Notification.permission === "granted")
        new Notification("Timer finished", {
          body: String(running.data.title),
        });
    })().catch((e) => setError(e.message));
  }, [running?.id, seconds]);
  return (
    <div className="space-y-6">
      <div className="timer-card">
        <div>
          <p className="text-sm text-muted-foreground">
            {running ? String(running.data.title) : "Ready to track"}
          </p>
          <p className="text-4xl font-mono tracking-tight mt-2">{duration}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!running && (
            <>
              <select
                className="core-select"
                aria-label="Timer kind"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="work">Track time</option>
                <option value="focus">Focus</option>
                <option value="break">Break</option>
              </select>
              {kind !== "work" && (
                <label className="text-sm">
                  Minutes
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                  />
                </label>
              )}
            </>
          )}
          <Input
            aria-label="Activity name"
            placeholder="What are you working on?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={Boolean(running)}
          />
          <Button onClick={() => void toggle()}>
            {running ? <Square size={16} /> : <Play size={16} />}{" "}
            {running ? "Stop" : "Start"}
          </Button>
          {running && (
            <Button
              variant="outline"
              onClick={() => void pause().catch((e) => setError(e.message))}
            >
              {running.data.paused_at ? "Resume" : "Pause"}
            </Button>
          )}
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      <RecordTable runtime={runtime} collection="time" />
    </div>
  );
}
