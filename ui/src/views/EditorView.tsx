import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Plus } from "lucide-react";

import {
  api,
  Clip,
  ExportProgress,
  ExportSettings,
  invokeErrorMessage,
  PreviewFrame,
  ProjectEntry,
  Timeline,
  Track,
} from "@/api";
import { FileTree } from "@/components/FileTree";
import { applyTrackHeightDelta, trackLaneHeight, TrackLane } from "@/components/TrackLane";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { pathBasename } from "@/lib/paths";
import { PIXELS_PER_SECOND } from "@/lib/timelineLayout";

interface EditorViewProps {
  onNewProject: () => void;
}

function trackLaneAtPoint(clientX: number, clientY: number): HTMLElement | null {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return null;
  return (el as HTMLElement).closest("[data-track-id]") as HTMLElement | null;
}

export function EditorView({ onNewProject }: EditorViewProps) {
  const [project, setProject] = useState<{ name: string; root: string } | null>(null);
  const [projectEntries, setProjectEntries] = useState<ProjectEntry[]>([]);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [playing, setPlaying] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSettings, setExportSettings] = useState<ExportSettings | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
  const [trackHeights, setTrackHeights] = useState<Record<string, number>>({});
  const [resizingTracks, setResizingTracks] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewFrame | null>(null);
  const [trimIn, setTrimIn] = useState("");
  const [trimDuration, setTrimDuration] = useState("");
  const [photoDefaultDuration, setPhotoDefaultDuration] = useState("3");
  const playTimer = useRef<number | null>(null);
  const playheadRef = useRef(0);
  const durationRef = useRef(10);
  const previewRequest = useRef(0);

  const refresh = useCallback(async () => {
    const [current, state, settings] = await Promise.all([
      api.getCurrentProject(),
      api.getTimeline(),
      api.getExportSettings(),
    ]);
    if (current) setProject({ name: current.name, root: current.root });
    setTimeline(state);
    setExportSettings(settings);
    if (state) playheadRef.current = state.playhead;

    try {
      const files = await api.listProjectEntries();
      setProjectEntries(files);
    } catch (err) {
      setError(invokeErrorMessage(err));
    }
  }, []);

  const loadPhotoDefault = useCallback(async () => {
    try {
      const value = await api.getPhotoDefaultDuration();
      setPhotoDefaultDuration(String(value));
    } catch {
      /* optional command — keep local default */
    }
  }, []);

  useEffect(() => {
    void refresh();
    void loadPhotoDefault();
    const unlistenExport = api.onExportProgress((progress) => setExportProgress(progress));
    const unlistenFootage = api.onRawFootageChanged(() => {
      void api.listProjectEntries().then(setProjectEntries).catch(() => {});
    });
    return () => {
      void unlistenExport.then((unlisten) => unlisten());
      void unlistenFootage.then((unlisten) => unlisten());
    };
  }, [refresh, loadPhotoDefault]);

  useEffect(() => {
    if (!playing) return;
    playTimer.current = window.setInterval(() => {
      const next = Math.min(durationRef.current, playheadRef.current + 0.1);
      playheadRef.current = next;
      void api.setPlayhead(next).then(() => {
        setTimeline((prev) => (prev ? { ...prev, playhead: next } : prev));
      });
      if (next >= durationRef.current) {
        setPlaying(false);
      }
    }, 100);
    return () => {
      if (playTimer.current) window.clearInterval(playTimer.current);
    };
  }, [playing]);

  const duration = useMemo(() => {
    if (!timeline) return 10;
    return Math.max(10, ...timeline.clips.map((clip) => clip.start + clip.duration));
  }, [timeline]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  const selectedClip = useMemo(
    () => timeline?.clips.find((clip) => clip.id === selectedClipId) ?? null,
    [timeline, selectedClipId],
  );

  useEffect(() => {
    if (!selectedClip) {
      setTrimIn("");
      setTrimDuration("");
      return;
    }
    setTrimIn(String(selectedClip.source_offset));
    setTrimDuration(String(selectedClip.duration));
  }, [selectedClip?.id, selectedClip?.source_offset, selectedClip?.duration]);

  useEffect(() => {
    if (!timeline) return;
    if (selectedClipId && !timeline.clips.some((c) => c.id === selectedClipId)) {
      setSelectedClipId(null);
    }
  }, [timeline, selectedClipId]);

  useEffect(() => {
    if (!timeline) return;
    const playhead = timeline.playhead;
    const requestId = ++previewRequest.current;
    const maxHeight = playing ? 180 : 360;
    const delay = playing ? 50 : 0;
    const handle = window.setTimeout(() => {
      void api
        .getPreviewFrame(playhead, maxHeight)
        .then((frame) => {
          if (requestId === previewRequest.current) {
            setPreview(frame);
          }
        })
        .catch(() => {
          /* keep last good frame while seeking */
        });
    }, delay);
    return () => window.clearTimeout(handle);
  }, [timeline?.playhead, playing, timeline]);

  async function handleDropOnTrack(track: Track, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const sourcePath = event.dataTransfer.getData("text/plain");
    if (!sourcePath || !timeline) return;

    const entry = projectEntries.find(
      (e) => e.relative_path === sourcePath && e.entry_kind === "file" && e.media_kind,
    );
    if (entry?.media_kind) {
      const compatible =
        (track.kind === "audio" && entry.media_kind === "audio") ||
        (track.kind === "video" && entry.media_kind !== "audio");
      if (!compatible) {
        setError(`Cannot place ${entry.media_kind} media on a ${track.kind} track.`);
        return;
      }
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const start = Math.max(0, x / PIXELS_PER_SECOND);

    try {
      await api.addClipToTimeline(track.id, sourcePath, start);
      await refresh();
      setError(null);
    } catch (err) {
      setError(invokeErrorMessage(err));
    }
  }

  async function onClipDragEnd(clip: Clip, event: React.MouseEvent<HTMLDivElement>) {
    if (!draggingClipId) return;
    const lane =
      trackLaneAtPoint(event.clientX, event.clientY) ??
      ((event.currentTarget.parentElement as HTMLElement | null)?.closest(
        "[data-track-id]",
      ) as HTMLElement | null);
    if (!lane) {
      setDraggingClipId(null);
      return;
    }
    const trackId = lane.dataset.trackId;
    const rect = lane.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const start = Math.max(0, x / PIXELS_PER_SECOND);
    const movedTrack = trackId && trackId !== clip.track_id ? trackId : undefined;
    try {
      await api.moveTimelineClip(clip.id, start, movedTrack);
      await refresh();
      setError(null);
    } catch (err) {
      setError(invokeErrorMessage(err));
      await refresh();
    } finally {
      setDraggingClipId(null);
    }
  }

  async function togglePlay() {
    if (!timeline) return;
    if (playing) {
      setPlaying(false);
      return;
    }
    setPlaying(true);
  }

  async function scrub(event: React.MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    const position = Math.max(0, Math.min(duration, ratio * duration));
    playheadRef.current = position;
    await api.setPlayhead(position);
    setTimeline((prev) => (prev ? { ...prev, playhead: position } : prev));
  }

  async function addMediaToTimeline(relativePath: string, mediaKind: "video" | "image" | "audio") {
    if (!timeline) return;
    const preferredKind = mediaKind === "audio" ? "audio" : "video";
    const track =
      timeline.tracks.find((t) => t.kind === preferredKind) ?? timeline.tracks[0];
    if (!track) {
      setError("No timeline track available.");
      return;
    }
    const clipsOnTrack = timeline.clips.filter((clip) => clip.track_id === track.id);
    const start = clipsOnTrack.reduce(
      (max, clip) => Math.max(max, clip.start + clip.duration),
      0,
    );
    try {
      await api.addClipToTimeline(track.id, relativePath, start);
      await refresh();
      setError(null);
    } catch (err) {
      setError(invokeErrorMessage(err));
    }
  }

  async function addTrack(kind: "video" | "audio") {
    try {
      await api.addTrack(kind);
      await refresh();
      setError(null);
    } catch (err) {
      setError(invokeErrorMessage(err));
    }
  }

  async function applyTrim() {
    if (!selectedClip) return;
    const sourceOffset = Number(trimIn);
    const nextDuration = Number(trimDuration);
    if (!Number.isFinite(sourceOffset) || sourceOffset < 0) {
      setError("In (source offset) must be a non-negative number.");
      return;
    }
    if (!Number.isFinite(nextDuration) || nextDuration <= 0) {
      setError("Duration must be greater than zero.");
      return;
    }
    if (
      sourceOffset === selectedClip.source_offset &&
      nextDuration === selectedClip.duration
    ) {
      return;
    }
    try {
      try {
        await api.trimTimelineClip(selectedClip.id, sourceOffset, nextDuration);
      } catch (trimErr) {
        if (sourceOffset !== selectedClip.source_offset) {
          throw trimErr;
        }
        await api.setTimelineClipDuration(selectedClip.id, nextDuration);
      }
      await refresh();
      setError(null);
    } catch (err) {
      setError(invokeErrorMessage(err));
    }
  }

  async function applyPhotoDefaultDuration() {
    const value = Number(photoDefaultDuration);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Photo default duration must be greater than zero.");
      return;
    }
    try {
      await api.setPhotoDefaultDuration(value);
      setError(null);
    } catch (err) {
      setError(invokeErrorMessage(err));
    }
  }

  async function startExport() {
    if (exportProgress && !exportProgress.done && !exportProgress.error) {
      return;
    }
    setExportProgress({ done: false, progress: 0, message: "Starting export..." });
    try {
      await api.startExport();
    } catch (err) {
      setExportProgress({
        done: true,
        progress: 0,
        message: "Export failed",
        error: invokeErrorMessage(err),
      });
    }
  }

  if (!timeline || !project) {
    return (
      <div className="grid min-h-screen place-items-center text-muted-foreground">
        Loading editor…
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{project.name}</h1>
          <p className="truncate text-xs text-muted-foreground">{project.root}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={onNewProject}>
            New project
          </Button>
          <Button
            onClick={() => {
              setExportProgress(null);
              setExportOpen(true);
            }}
          >
            Export
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_300px] overflow-hidden">
        <aside className="min-h-0 overflow-hidden border-r p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">Filesystem</h2>
            <div className="flex shrink-0 flex-col gap-1">
              <Button size="sm" variant="outline" onClick={() => void addTrack("video")}>
                <Plus className="h-3 w-3" />
                Video track
              </Button>
              <Button size="sm" variant="outline" onClick={() => void addTrack("audio")}>
                <Plus className="h-3 w-3" />
                Audio track
              </Button>
            </div>
          </div>
          <ScrollArea className="h-[calc(100%-4.5rem)] pr-3">
            <FileTree
              entries={projectEntries}
              onAddMedia={(relativePath, mediaKind) =>
                void addMediaToTimeline(relativePath, mediaKind)
              }
            />
          </ScrollArea>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden p-4">
          <div className="mb-4 flex items-center gap-2">
            <Button size="icon" variant="outline" onClick={() => void togglePlay()}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <span className="text-sm text-muted-foreground">
              {timeline.playhead.toFixed(1)}s / {duration.toFixed(1)}s
            </span>
          </div>

          <div
            className="relative mb-4 h-3 cursor-pointer rounded-full bg-muted"
            onClick={(e) => void scrub(e)}
          >
            <div
              className="absolute top-0 h-full rounded-full bg-primary"
              style={{ width: `${(timeline.playhead / duration) * 100}%` }}
            />
          </div>

          <div className={`min-h-0 flex-1 overflow-auto overscroll-contain ${resizingTracks ? "select-none" : ""}`}>
            <div
              style={{ width: duration * PIXELS_PER_SECOND + 120 }}
              onClick={() => setSelectedClipId(null)}
            >
              {timeline.tracks.map((track) => (
                <TrackLane
                  key={track.id}
                  track={track}
                  clips={timeline.clips.filter((clip) => clip.track_id === track.id)}
                  laneHeight={trackLaneHeight(trackHeights, track.id)}
                  playhead={timeline.playhead}
                  selectedClipId={selectedClipId}
                  onResize={(trackId, deltaY) =>
                    setTrackHeights((prev) => applyTrackHeightDelta(prev, trackId, deltaY))
                  }
                  onResizeStart={() => setResizingTracks(true)}
                  onResizeEnd={() => setResizingTracks(false)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => void handleDropOnTrack(track, e)}
                  onSelectClip={setSelectedClipId}
                  onClipDragStart={setDraggingClipId}
                  onClipDragEnd={(clip, e) => void onClipDragEnd(clip, e)}
                  onRemoveClip={(clipId) =>
                    void api
                      .removeTimelineClip(clipId)
                      .then(refresh)
                      .then(() => {
                        if (selectedClipId === clipId) setSelectedClipId(null);
                      })
                      .catch((err) => setError(invokeErrorMessage(err)))
                  }
                />
              ))}
            </div>
          </div>
        </main>

        <aside className="min-h-0 overflow-auto border-l p-4">
          <h2 className="mb-3 text-sm font-medium">Preview</h2>
          <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border bg-black">
            {preview?.data_url ? (
              <img
                src={preview.data_url}
                alt="Preview frame"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <p className="px-3 text-center text-sm text-muted-foreground">
                {timeline.clips.some((c) => c.media_kind !== "audio")
                  ? `No visual clip at ${timeline.playhead.toFixed(1)}s`
                  : "Add a video or image clip to preview"}
              </p>
            )}
            <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white">
              {timeline.playhead.toFixed(1)}s
            </div>
          </div>

          <Separator className="my-4" />

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Clip</h3>
            {selectedClip ? (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="truncate font-medium">{pathBasename(selectedClip.source_path)}</p>
                  <p className="text-xs capitalize text-muted-foreground">
                    {selectedClip.media_kind} · start {selectedClip.start.toFixed(2)}s
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="trim-in">In (source offset)</Label>
                    <input
                      id="trim-in"
                      type="number"
                      min={0}
                      step={0.1}
                      className="h-9 w-full rounded-md border bg-background px-2"
                      value={trimIn}
                      onChange={(e) => setTrimIn(e.target.value)}
                      onBlur={() => void applyTrim()}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="trim-duration">Duration</Label>
                    <input
                      id="trim-duration"
                      type="number"
                      min={0.1}
                      step={0.1}
                      className="h-9 w-full rounded-md border bg-background px-2"
                      value={trimDuration}
                      onChange={(e) => setTrimDuration(e.target.value)}
                      onBlur={() => void applyTrim()}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  source_offset {selectedClip.source_offset.toFixed(2)}s · duration{" "}
                  {selectedClip.duration.toFixed(2)}s
                </p>
                <Button size="sm" variant="secondary" onClick={() => void applyTrim()}>
                  Apply trim
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Select a timeline clip to trim.</p>
            )}
          </div>

          <Separator className="my-4" />

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Photo default duration</h3>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="photo-default">Seconds</Label>
                <input
                  id="photo-default"
                  type="number"
                  min={0.1}
                  step={0.1}
                  className="h-9 w-full rounded-md border bg-background px-2"
                  value={photoDefaultDuration}
                  onChange={(e) => setPhotoDefaultDuration(e.target.value)}
                  onBlur={() => void applyPhotoDefaultDuration()}
                />
              </div>
              <Button size="sm" variant="outline" onClick={() => void applyPhotoDefaultDuration()}>
                Set
              </Button>
            </div>
          </div>

          <Separator className="my-4" />
          <p className="text-xs text-muted-foreground">
            Drag files from the filesystem into a track. Drop clips onto another track to move them.
            Clips cannot overlap on the same track.
          </p>
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </aside>
      </div>

      <Dialog
        open={exportOpen}
        onOpenChange={(open) => {
          setExportOpen(open);
          if (open) setExportProgress(null);
        }}
      >
        <DialogContent
          onPointerDownOutside={(e) => {
            if (exportProgress && !exportProgress.done) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (exportProgress && !exportProgress.done) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Export video</DialogTitle>
            <DialogDescription>
              Junto uses sensible defaults. Your export will be saved to the project outputs folder.
            </DialogDescription>
          </DialogHeader>

          {exportSettings && (
            <div className="space-y-3 text-sm">
              <p>
                {exportSettings.width}×{exportSettings.height} · {exportSettings.fps} fps ·{" "}
                {exportSettings.video_codec.toUpperCase()} / {exportSettings.audio_codec.toUpperCase()}
              </p>
              <Button variant="ghost" onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? "Hide advanced options" : "Advanced options"}
              </Button>
              {showAdvanced && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Width</Label>
                    <input
                      type="number"
                      className="h-9 w-full rounded-md border bg-background px-2"
                      value={exportSettings.width}
                      onChange={(e) =>
                        setExportSettings({ ...exportSettings, width: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Height</Label>
                    <input
                      type="number"
                      className="h-9 w-full rounded-md border bg-background px-2"
                      value={exportSettings.height}
                      onChange={(e) =>
                        setExportSettings({ ...exportSettings, height: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>CRF</Label>
                    <input
                      type="number"
                      className="h-9 w-full rounded-md border bg-background px-2"
                      value={exportSettings.crf}
                      onChange={(e) =>
                        setExportSettings({ ...exportSettings, crf: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>FPS</Label>
                    <input
                      type="number"
                      className="h-9 w-full rounded-md border bg-background px-2"
                      value={exportSettings.fps}
                      onChange={(e) =>
                        setExportSettings({ ...exportSettings, fps: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {exportProgress && (
            <div className="space-y-2">
              <Progress value={exportProgress.progress * 100} />
              <p className="text-sm text-muted-foreground">{exportProgress.message}</p>
              {exportProgress.output_path && (
                <p className="text-xs text-emerald-400">{exportProgress.output_path}</p>
              )}
              {exportProgress.error && <p className="text-sm text-red-400">{exportProgress.error}</p>}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void (async () => {
                  try {
                    if (exportSettings) {
                      await api.updateExportSettings(exportSettings);
                    }
                    await startExport();
                  } catch (err) {
                    setExportProgress({
                      done: true,
                      progress: 0,
                      message: "Export failed",
                      error: invokeErrorMessage(err),
                    });
                  }
                })();
              }}
              disabled={exportProgress !== null && !exportProgress.done && !exportProgress.error}
            >
              Export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
