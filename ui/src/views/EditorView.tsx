import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Plus } from "lucide-react";

import {
  api,
  Clip,
  ExportProgress,
  ExportSettings,
  invokeErrorMessage,
  PreviewFrame,
  ScannedMediaFile,
  Timeline,
  Track,
} from "@/api";
import { TimelineClip } from "@/components/TimelineClip";
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

const PIXELS_PER_SECOND = 80;

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
  const [media, setMedia] = useState<ScannedMediaFile[]>([]);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [playing, setPlaying] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSettings, setExportSettings] = useState<ExportSettings | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
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
    const [current, files, state, settings] = await Promise.all([
      api.getCurrentProject(),
      api.listMedia(),
      api.getTimeline(),
      api.getExportSettings(),
    ]);
    if (current) setProject({ name: current.name, root: current.root });
    setMedia(files);
    setTimeline(state);
    setExportSettings(settings);
    if (state) playheadRef.current = state.playhead;
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
    const unlistenPromise = api.onExportProgress((progress) => setExportProgress(progress));
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
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
    const width = playing ? 320 : 640;
    const delay = playing ? 50 : 0;
    const handle = window.setTimeout(() => {
      void api
        .getPreviewFrame(playhead, width)
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

    const file = media.find((m) => m.relative_path === sourcePath);
    if (file) {
      const compatible =
        (track.kind === "audio" && file.media_kind === "audio") ||
        (track.kind === "video" && file.media_kind !== "audio");
      if (!compatible) {
        setError(`Cannot place ${file.media_kind} media on a ${track.kind} track.`);
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

  async function addMediaToTimeline(file: ScannedMediaFile) {
    if (!timeline) return;
    const preferredKind = file.media_kind === "audio" ? "audio" : "video";
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
      await api.addClipToTimeline(track.id, file.relative_path, start);
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
            <div className="space-y-2">
              {media.map((file) => (
                <div
                  key={file.relative_path}
                  className="rounded-md border border-transparent px-2 py-2 text-sm hover:border-border hover:bg-muted/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className="min-w-0 cursor-grab"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", file.relative_path)}
                    >
                      <p className="truncate font-medium">{file.relative_path.split("/").pop()}</p>
                      <p className="text-xs capitalize text-muted-foreground">{file.media_kind}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 px-2"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void addMediaToTimeline(file);
                      }}
                    >
                      Add
                    </Button>
                  </div>
                </div>
              ))}
              {media.length === 0 && (
                <p className="text-sm text-muted-foreground">No media in Raw Footage yet.</p>
              )}
            </div>
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

          <ScrollArea className="min-h-0 flex-1">
            <div
              style={{ width: duration * PIXELS_PER_SECOND + 120 }}
              onClick={() => setSelectedClipId(null)}
            >
              {timeline.tracks.map((track) => (
                <div key={track.id} className="mb-3 grid grid-cols-[110px_1fr] items-center gap-3">
                  <div className="text-sm text-muted-foreground">
                    {track.name}
                    <span className="ml-1 text-[10px] uppercase opacity-70">{track.kind}</span>
                  </div>
                  <div
                    data-track-id={track.id}
                    data-track-kind={track.kind}
                    className="relative h-16 rounded-lg border bg-muted/20"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => void handleDropOnTrack(track, e)}
                  >
                    {timeline.clips
                      .filter((clip) => clip.track_id === track.id)
                      .map((clip) => (
                        <TimelineClip
                          key={clip.id}
                          clip={clip}
                          selected={clip.id === selectedClipId}
                          onSelect={() => setSelectedClipId(clip.id)}
                          onDragStart={() => setDraggingClipId(clip.id)}
                          onDragEnd={(e) => void onClipDragEnd(clip, e)}
                          onRemove={() =>
                            void api
                              .removeTimelineClip(clip.id)
                              .then(refresh)
                              .then(() => {
                                if (selectedClipId === clip.id) setSelectedClipId(null);
                              })
                              .catch((err) => setError(invokeErrorMessage(err)))
                          }
                        />
                      ))}
                    <div
                      className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-rose-500"
                      style={{ left: timeline.playhead * PIXELS_PER_SECOND }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </main>

        <aside className="min-h-0 overflow-auto border-l p-4">
          <h2 className="mb-3 text-sm font-medium">Preview</h2>
          <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border bg-black">
            {preview?.data_url ? (
              <img
                src={preview.data_url}
                alt={preview.source_path.split("/").pop() ?? "preview"}
                className="h-full w-full object-contain"
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
              {preview?.source_path ? ` · ${preview.source_path.split("/").pop()}` : ""}
            </div>
          </div>

          <Separator className="my-4" />

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Clip</h3>
            {selectedClip ? (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="truncate font-medium">
                    {selectedClip.source_path.split("/").pop()}
                  </p>
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
