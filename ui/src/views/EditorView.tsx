import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FolderPlus,
  Pause,
  Play,
  Plus,
  Trash2,
} from "lucide-react";

import {
  api,
  Clip,
  ExportProgress,
  ExportSettings,
  ScannedMediaFile,
  Timeline,
  Track,
} from "@/api";
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
  const [error, setError] = useState<string | null>(null);
  const playTimer = useRef<number | null>(null);

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
  }, []);

  useEffect(() => {
    void refresh();
    const unlistenPromise = api.onExportProgress((progress) => setExportProgress(progress));
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [refresh]);

  useEffect(() => {
    if (!playing || !timeline) return;
    playTimer.current = window.setInterval(() => {
      void api.setPlayhead(timeline.playhead + 0.1).then(() => void refresh());
    }, 100);
    return () => {
      if (playTimer.current) window.clearInterval(playTimer.current);
    };
  }, [playing, timeline, refresh]);

  const duration = useMemo(() => {
    if (!timeline) return 10;
    return Math.max(10, ...timeline.clips.map((clip) => clip.start + clip.duration));
  }, [timeline]);

  async function handleDropOnTrack(track: Track, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const sourcePath = event.dataTransfer.getData("text/plain");
    if (!sourcePath || !timeline) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const start = Math.max(0, x / PIXELS_PER_SECOND);

    try {
      await api.addClipToTimeline(track.id, sourcePath, start);
      await refresh();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onClipDragEnd(clip: Clip, event: React.MouseEvent<HTMLDivElement>) {
    if (!draggingClipId) return;
    const lane = (event.currentTarget.parentElement as HTMLDivElement) ?? event.currentTarget;
    const rect = lane.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const start = Math.max(0, x / PIXELS_PER_SECOND);
    try {
      await api.moveTimelineClip(clip.id, start);
      await refresh();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
    const x = event.clientX - rect.left;
    const position = Math.max(0, Math.min(duration, x / PIXELS_PER_SECOND));
    await api.setPlayhead(position);
    await refresh();
  }

  async function startExport() {
    setExportProgress({ done: false, progress: 0, message: "Starting export..." });
    await api.startExport();
  }

  if (!timeline || !project) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading editor…</div>;
  }

  return (
    <div className="grid min-h-screen grid-rows-[auto_1fr_auto]">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">{project.name}</h1>
          <p className="text-xs text-muted-foreground">{project.root}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onNewProject}>
            <FolderPlus className="h-4 w-4" />
            New project
          </Button>
          <Button onClick={() => setExportOpen(true)}>
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[260px_1fr_320px]">
        <aside className="border-r p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">Filesystem</h2>
            <Button size="sm" variant="outline" onClick={() => void api.addTrack("video").then(refresh)}>
              <Plus className="h-3 w-3" />
              Track
            </Button>
          </div>
          <ScrollArea className="h-[calc(100vh-220px)] pr-3">
            <div className="space-y-2">
              {media.map((file) => (
                <div
                  key={file.relative_path}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", file.relative_path)}
                  className="cursor-grab rounded-md border border-transparent px-2 py-2 text-sm hover:border-border hover:bg-muted/40"
                >
                  <p className="truncate font-medium">{file.relative_path.split("/").pop()}</p>
                  <p className="text-xs capitalize text-muted-foreground">{file.media_kind}</p>
                </div>
              ))}
              {media.length === 0 && (
                <p className="text-sm text-muted-foreground">No media in Raw Footage yet.</p>
              )}
            </div>
          </ScrollArea>
        </aside>

        <main className="flex min-h-0 flex-col p-4">
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

          <ScrollArea className="flex-1">
            <div style={{ width: duration * PIXELS_PER_SECOND + 120 }}>
              {timeline.tracks.map((track) => (
                <div key={track.id} className="mb-3 grid grid-cols-[110px_1fr] items-center gap-3">
                  <div className="text-sm text-muted-foreground">{track.name}</div>
                  <div
                    className="relative h-16 rounded-lg border bg-muted/20"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => void handleDropOnTrack(track, e)}
                  >
                    {timeline.clips
                      .filter((clip) => clip.track_id === track.id)
                      .map((clip) => (
                        <div
                          key={clip.id}
                          className={`absolute top-2 flex h-12 items-center rounded-md px-2 text-xs text-white ${
                            clip.media_kind === "audio"
                              ? "bg-amber-600"
                              : clip.media_kind === "image"
                                ? "bg-emerald-600"
                                : "bg-blue-600"
                          }`}
                          style={{
                            left: clip.start * PIXELS_PER_SECOND,
                            width: clip.duration * PIXELS_PER_SECOND,
                          }}
                          draggable
                          onDragStart={() => setDraggingClipId(clip.id)}
                          onDragEnd={(e) => void onClipDragEnd(clip, e)}
                        >
                          <span className="truncate">{clip.source_path.split("/").pop()}</span>
                          <button
                            className="ml-auto rounded p-1 hover:bg-black/20"
                            onClick={() => void api.removeTimelineClip(clip.id).then(refresh)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    <div
                      className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-rose-500"
                      style={{ left: timeline.playhead * PIXELS_PER_SECOND }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </main>

        <aside className="border-l p-4">
          <h2 className="mb-3 text-sm font-medium">Preview</h2>
          <div className="flex aspect-video items-center justify-center rounded-lg border bg-black/40 text-sm text-muted-foreground">
            Preview at {timeline.playhead.toFixed(1)}s
          </div>
          <Separator className="my-4" />
          <p className="text-xs text-muted-foreground">
            Drag files from the filesystem into a track. Clips cannot overlap on the same track.
          </p>
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </aside>
      </div>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent>
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
              onClick={async () => {
                if (exportSettings) await api.updateExportSettings(exportSettings);
                await startExport();
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
