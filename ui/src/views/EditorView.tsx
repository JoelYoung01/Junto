import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { PlayheadOverlay } from "@/components/PlayheadOverlay";
import { TimelineRuler } from "@/components/TimelineRuler";
import { applyTrackHeightDelta, trackContentEl, trackLaneHeight, TrackLane } from "@/components/TrackLane";
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
import { useTimelineInteractions } from "@/hooks/useTimelineInteractions";
import { pathBasename } from "@/lib/paths";
import { beginPointerDrag } from "@/lib/pointerDrag";
import {
  clipIdsInChronologicalRange,
  clipIdsOnTrack,
  toggleClipInSelection,
} from "@/lib/clipSelection";
import {
  TRACK_GAP,
  TRACK_LABEL_WIDTH,
  maxClipDurationOnTrack,
  planClipGroupMove,
  snapClipStart,
  timeFromTrackContentX,
  timelineCanvasWidthPx,
  timelineContentWidthPx,
} from "@/lib/timelineLayout";

interface EditorViewProps {
  onNewProject: () => void;
}

interface MediaDragState {
  sourcePath: string;
  mediaKind: "video" | "image" | "audio";
  duration: number;
}

interface DropPreviewState {
  ghosts: { trackId: string; start: number; duration: number }[];
  /** Present while dragging timeline clips (single or multi). */
  placements?: { clipId: string; trackId: string; start: number }[];
}

function trackLaneAtPoint(clientX: number, clientY: number): HTMLElement | null {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return null;
  return (el as HTMLElement).closest("[data-track-id]") as HTMLElement | null;
}

function mediaCompatibleWithTrack(
  mediaKind: "video" | "image" | "audio",
  trackKind: "video" | "audio",
): boolean {
  return (
    (trackKind === "audio" && mediaKind === "audio") ||
    (trackKind === "video" && mediaKind !== "audio")
  );
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
  const [draggingClipIds, setDraggingClipIds] = useState<string[]>([]);
  const [trackHeights, setTrackHeights] = useState<Record<string, number>>({});
  const [resizingTracks, setResizingTracks] = useState(false);
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewFrame | null>(null);
  const [trimIn, setTrimIn] = useState("");
  const [trimDuration, setTrimDuration] = useState("");
  const [photoDefaultDuration, setPhotoDefaultDuration] = useState("3");
  const [scrubbing, setScrubbing] = useState(false);
  const [mediaDrag, setMediaDrag] = useState<MediaDragState | null>(null);
  const [dropPreview, setDropPreview] = useState<DropPreviewState | null>(null);
  const [dragCursor, setDragCursor] = useState<{ x: number; y: number } | null>(null);
  const playRaf = useRef<number | null>(null);
  const playheadRef = useRef(0);
  const durationRef = useRef(10);
  const previewBlobUrl = useRef<string | null>(null);
  const paintedPreviewGen = useRef(0);
  const playingRef = useRef(false);
  const scrubbingRef = useRef(false);
  const draggingClipRef = useRef(false);
  const resizingTracksRef = useRef(false);
  const mediaDragRef = useRef<MediaDragState | null>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const photoDefaultRef = useRef(3);
  const durationCacheRef = useRef<Map<string, number>>(new Map());
  const mediaDragGen = useRef(0);
  const paintPlayheadRef = useRef<(seconds: number) => void>(() => {});
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const selectedClipIdsRef = useRef<string[]>([]);
  const selectionAnchorIdRef = useRef<string | null>(null);
  const activeTrackIdRef = useRef<string | null>(null);

  const togglePlay = useCallback(() => {
    if (playingRef.current) {
      setPlaying(false);
      return;
    }

    // If already at the end, restart from 0 instead of immediately pausing.
    const duration = durationRef.current;
    if (duration > 0 && playheadRef.current >= duration - 1e-3) {
      playheadRef.current = 0;
      paintPlayheadRef.current(0);
      setTimeline((prev) => (prev ? { ...prev, playhead: 0 } : prev));
      void api.setPlayhead(0).catch(() => {});
      void api.setPreviewTarget(0, 360, false).catch(() => {});
    }

    setPlaying(true);
  }, []);

  const setPlayheadPosition = useCallback(async (position: number) => {
    const clamped = Math.max(0, Math.min(durationRef.current, position));
    playheadRef.current = clamped;
    paintPlayheadRef.current(clamped);
    setTimeline((prev) => (prev ? { ...prev, playhead: clamped } : prev));
    void api.setPreviewTarget(clamped, 360, true).catch(() => {});
    try {
      await api.setPlayhead(clamped);
    } catch {
      /* keep local playhead while seeking */
    }
  }, []);

  const interactions = useTimelineInteractions({
    enabled: timeline != null,
    getPlayhead: () => playheadRef.current,
    getDuration: () => durationRef.current,
    setPlayhead: setPlayheadPosition,
    isPlaying: () => playingRef.current,
    togglePlay,
    setScrubbing,
    getBusy: () => ({
      scrubbing: scrubbingRef.current,
      draggingClip: draggingClipRef.current,
      resizingTracks: resizingTracksRef.current,
    }),
  });

  const {
    pixelsPerSecond,
    ppsRef,
    scrollRef: timelineScrollRef,
    canvasRef: timelineCanvasRef,
    playheadOverlayRef,
    paintPlayheadDom,
    followPlayheadInView,
    markUserGesture: markUserTimelineGesture,
    onTimelineScroll,
    withProgrammaticScroll,
    scrollTimeRangeIntoView: scrollDropPreviewIntoView,
    onRulerPointerDown,
    onPlayheadHandlePointerDown,
    onPlayheadFocus,
    onPlayheadBlur,
  } = interactions;

  useEffect(() => {
    paintPlayheadRef.current = paintPlayheadDom;
  }, [paintPlayheadDom]);

  const revokePreviewBlob = useCallback(() => {
    if (previewBlobUrl.current) {
      URL.revokeObjectURL(previewBlobUrl.current);
      previewBlobUrl.current = null;
    }
  }, []);

  const pushPreviewTarget = useCallback((playhead: number, isScrubbing: boolean, _isPlaying: boolean) => {
    void api.setPreviewTarget(playhead, 360, isScrubbing).catch(() => {});
  }, []);

  useEffect(() => {
    mediaDragRef.current = mediaDrag;
  }, [mediaDrag]);

  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  useEffect(() => {
    const n = Number(photoDefaultDuration);
    if (Number.isFinite(n) && n > 0) photoDefaultRef.current = n;
  }, [photoDefaultDuration]);

  const clearMediaDrag = useCallback(() => {
    mediaDragGen.current += 1;
    mediaDragRef.current = null;
    setMediaDrag(null);
    setDropPreview(null);
    setDragCursor(null);
  }, []);

  const updateDropPreviewForTrack = useCallback(
    (track: Track, clientX: number, contentEl: HTMLElement) => {
      const drag = mediaDragRef.current;
      const state = timelineRef.current;
      if (!drag || !state) {
        setDropPreview(null);
        return;
      }

      const compatible = mediaCompatibleWithTrack(drag.mediaKind, track.kind);
      if (!compatible) {
        setDropPreview(null);
        return;
      }

      const desired = timeFromTrackContentX(
        clientX,
        contentEl.getBoundingClientRect().left,
        ppsRef.current,
      );
      const clipsOnTrack = state.clips.filter((c) => c.track_id === track.id);
      const start = snapClipStart(clipsOnTrack, desired, drag.duration);

      setDropPreview({
        ghosts: [{ trackId: track.id, start, duration: drag.duration }],
      });
      scrollDropPreviewIntoView(start, drag.duration);

      const scroller = timelineScrollRef.current;
      const row = contentEl.closest("[data-track-id]") as HTMLElement | null;
      if (scroller && row) {
        const sRect = scroller.getBoundingClientRect();
        const rRect = row.getBoundingClientRect();
        if (rRect.bottom > sRect.bottom - 8) {
          withProgrammaticScroll(() => {
            scroller.scrollTop += rRect.bottom - sRect.bottom + 16;
          });
        } else if (rRect.top < sRect.top + 8) {
          withProgrammaticScroll(() => {
            scroller.scrollTop -= sRect.top - rRect.top + 16;
          });
        }
      }
    },
    [ppsRef, scrollDropPreviewIntoView, timelineScrollRef, withProgrammaticScroll],
  );

  const beginMediaDragSession = useCallback(
    (relativePath: string, mediaKind: "video" | "image" | "audio") => {
      const gen = ++mediaDragGen.current;
      const cached = durationCacheRef.current.get(relativePath);
      const fallback =
        mediaKind === "image" ? photoDefaultRef.current : cached ?? 5;
      const initial: MediaDragState = {
        sourcePath: relativePath,
        mediaKind,
        duration: fallback,
      };
      mediaDragRef.current = initial;
      setMediaDrag(initial);
      setDropPreview(null);
      setPlaying(false);

      void api
        .getMediaDuration(relativePath)
        .then((duration) => {
          if (mediaDragGen.current !== gen) return;
          durationCacheRef.current.set(relativePath, duration);
          const next = { sourcePath: relativePath, mediaKind, duration };
          mediaDragRef.current = next;
          setMediaDrag(next);
          setDropPreview((prev) => {
            if (!prev?.ghosts.length) return prev;
            const state = timelineRef.current;
            if (!state) {
              return {
                ghosts: prev.ghosts.map((g) => ({ ...g, duration })),
              };
            }
            const ghost = prev.ghosts[0]!;
            const clipsOnTrack = state.clips.filter((c) => c.track_id === ghost.trackId);
            const start = snapClipStart(clipsOnTrack, ghost.start, duration);
            scrollDropPreviewIntoView(start, duration);
            return {
              ghosts: [{ trackId: ghost.trackId, start, duration }],
            };
          });
        })
        .catch(() => {
          /* keep fallback duration for preview */
        });
    },
    [scrollDropPreviewIntoView],
  );

  const updateDropPreviewAtPoint = useCallback(
    (clientX: number, clientY: number) => {
      const lane = trackLaneAtPoint(clientX, clientY);
      const trackId = lane?.dataset.trackId;
      const state = timelineRef.current;
      if (!lane || !trackId || !state) {
        setDropPreview(null);
        return;
      }
      const track = state.tracks.find((t) => t.id === trackId);
      const content = trackContentEl(lane);
      if (!track || !content) {
        setDropPreview(null);
        return;
      }
      updateDropPreviewForTrack(track, clientX, content);
    },
    [updateDropPreviewForTrack],
  );

  const commitMediaDropAtPoint = useCallback(
    async (clientX: number, clientY: number) => {
      const drag = mediaDragRef.current;
      const state = timelineRef.current;
      if (!drag || !state) return;

      const lane = trackLaneAtPoint(clientX, clientY);
      const trackId = lane?.dataset.trackId;
      const track = trackId ? state.tracks.find((t) => t.id === trackId) : null;
      if (!lane || !track) return;

      if (!mediaCompatibleWithTrack(drag.mediaKind, track.kind)) {
        setError(`Cannot place ${drag.mediaKind} media on a ${track.kind} track.`);
        return;
      }

      const content = trackContentEl(lane);
      const contentLeft =
        content?.getBoundingClientRect().left ?? lane.getBoundingClientRect().left;
      const desired = timeFromTrackContentX(clientX, contentLeft, ppsRef.current);
      const clipsOnTrack = state.clips.filter((c) => c.track_id === track.id);
      const start = snapClipStart(clipsOnTrack, desired, drag.duration);

      try {
        await api.addClipToTimeline(track.id, drag.sourcePath, start);
        await refreshRef.current();
        setError(null);
      } catch (err) {
        setError(invokeErrorMessage(err));
      }
    },
    [ppsRef],
  );

  const onMediaPointerDown = useCallback(
    (
      relativePath: string,
      mediaKind: "video" | "image" | "audio",
      event: React.PointerEvent<HTMLDivElement>,
    ) => {
      beginMediaDragSession(relativePath, mediaKind);
      beginPointerDrag(event.nativeEvent, {
        onMove: (moveEvent, { dragging }) => {
          if (!dragging) return;
          setDragCursor({ x: moveEvent.clientX, y: moveEvent.clientY });
          updateDropPreviewAtPoint(moveEvent.clientX, moveEvent.clientY);
        },
        onEnd: (upEvent, { dragging }) => {
          if (dragging) {
            void commitMediaDropAtPoint(upEvent.clientX, upEvent.clientY).finally(() => {
              clearMediaDrag();
            });
          } else {
            clearMediaDrag();
          }
        },
        onCancel: () => clearMediaDrag(),
      });
    },
    [
      beginMediaDragSession,
      clearMediaDrag,
      commitMediaDropAtPoint,
      updateDropPreviewAtPoint,
    ],
  );

  const clearClipDrag = useCallback(() => {
    setDraggingClipIds([]);
    setDropPreview(null);
    setDragCursor(null);
  }, []);

  const updateClipMovePreview = useCallback(
    (
      primary: Clip,
      moving: Clip[],
      grabOffsetPx: number,
      clientX: number,
      clientY: number,
    ): { clipId: string; trackId: string; start: number }[] | null => {
      const lane = trackLaneAtPoint(clientX, clientY);
      const trackId = lane?.dataset.trackId;
      const state = timelineRef.current;
      if (!lane || !trackId || !state) {
        setDropPreview(null);
        return null;
      }
      const track = state.tracks.find((t) => t.id === trackId);
      const content = trackContentEl(lane);
      if (!track || !content) {
        setDropPreview(null);
        return null;
      }

      const contentLeft = content.getBoundingClientRect().left;
      const desiredPrimaryStart = timeFromTrackContentX(
        clientX - grabOffsetPx,
        contentLeft,
        ppsRef.current,
      );

      const placements = planClipGroupMove({
        moving,
        primaryId: primary.id,
        desiredPrimaryStart,
        primaryDestTrackId: track.id,
        tracks: state.tracks,
        allClips: state.clips,
        mediaCompatible: mediaCompatibleWithTrack,
      });

      if (!placements) {
        setDropPreview(null);
        return null;
      }

      setDropPreview({
        ghosts: placements.map((p) => ({
          trackId: p.trackId,
          start: p.start,
          duration: p.duration,
        })),
        placements: placements.map((p) => ({
          clipId: p.clipId,
          trackId: p.trackId,
          start: p.start,
        })),
      });

      const spanStart = Math.min(...placements.map((p) => p.start));
      const spanEnd = Math.max(...placements.map((p) => p.start + p.duration));
      scrollDropPreviewIntoView(spanStart, spanEnd - spanStart);

      const scroller = timelineScrollRef.current;
      const row = content.closest("[data-track-id]") as HTMLElement | null;
      if (scroller && row) {
        const sRect = scroller.getBoundingClientRect();
        const rRect = row.getBoundingClientRect();
        if (rRect.bottom > sRect.bottom - 8) {
          withProgrammaticScroll(() => {
            scroller.scrollTop += rRect.bottom - sRect.bottom + 16;
          });
        } else if (rRect.top < sRect.top + 8) {
          withProgrammaticScroll(() => {
            scroller.scrollTop -= sRect.top - rRect.top + 16;
          });
        }
      }

      return placements.map((p) => ({
        clipId: p.clipId,
        trackId: p.trackId,
        start: p.start,
      }));
    },
    [ppsRef, scrollDropPreviewIntoView, timelineScrollRef, withProgrammaticScroll],
  );

  const onClipMovePointerDown = useCallback(
    (clip: Clip, event: React.PointerEvent<HTMLDivElement>) => {
      const sourceLane = (event.currentTarget as HTMLElement).closest(
        "[data-track-id]",
      ) as HTMLElement | null;
      const content = sourceLane ? trackContentEl(sourceLane) : null;
      const contentLeft =
        content?.getBoundingClientRect().left ??
        sourceLane?.getBoundingClientRect().left ??
        0;
      const clipLeftPx = contentLeft + clip.start * ppsRef.current;
      const grabOffsetPx = event.clientX - clipLeftPx;

      const state = timelineRef.current;
      const selected = selectedClipIdsRef.current;
      const movingIds = selected.includes(clip.id) ? selected : [clip.id];
      const moving =
        state?.clips.filter((c) => movingIds.includes(c.id)) ?? [clip];

      setDraggingClipIds(moving.map((c) => c.id));
      setPlaying(false);
      setDropPreview(null);

      beginPointerDrag(event.nativeEvent, {
        onMove: (moveEvent, { dragging }) => {
          if (!dragging) return;
          setDragCursor({ x: moveEvent.clientX, y: moveEvent.clientY });
          updateClipMovePreview(
            clip,
            moving,
            grabOffsetPx,
            moveEvent.clientX,
            moveEvent.clientY,
          );
        },
        onEnd: (upEvent, { dragging }) => {
          if (!dragging) {
            // Click without drag on an already-multi-selected clip → focus that clip only.
            if (moving.length > 1) {
              selectedClipIdsRef.current = [clip.id];
              setSelectedClipIds([clip.id]);
              setSelectionAnchorId(clip.id);
              selectionAnchorIdRef.current = clip.id;
            }
            clearClipDrag();
            return;
          }
          const placed = updateClipMovePreview(
            clip,
            moving,
            grabOffsetPx,
            upEvent.clientX,
            upEvent.clientY,
          );
          if (!placed) {
            setError("Drop on a compatible track to move the selection.");
            clearClipDrag();
            return;
          }
          void (async () => {
            try {
              await api.moveTimelineClips(
                placed.map((p) => ({
                  clipId: p.clipId,
                  start: p.start,
                  trackId: p.trackId,
                })),
              );
              await refreshRef.current();
              setError(null);
            } catch (err) {
              setError(invokeErrorMessage(err));
              await refreshRef.current();
            } finally {
              clearClipDrag();
            }
          })();
        },
        onCancel: () => clearClipDrag(),
      });
    },
    [clearClipDrag, ppsRef, updateClipMovePreview],
  );

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

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

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
    const unlistenPreview = api.onPreviewFrame((frame) => {
      // Latest-wins: ignore frames older than what we've already painted.
      if (frame.generation < paintedPreviewGen.current) return;
      paintedPreviewGen.current = frame.generation;

      const raw =
        frame.jpeg instanceof Uint8Array ? frame.jpeg : new Uint8Array(frame.jpeg);
      if (raw.byteLength === 0 || !frame.source_path) {
        revokePreviewBlob();
        setPreview(null);
        return;
      }

      const bytes = new Uint8Array(raw.byteLength);
      bytes.set(raw);
      const blob = new Blob([bytes.buffer], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      revokePreviewBlob();
      previewBlobUrl.current = url;
      setPreview({
        data_url: url,
        source_path: frame.source_path,
        media_kind: frame.media_kind,
        playhead: frame.playhead,
        generation: frame.generation,
      });
    });
    const unlistenOsDrop = api.onOsFileDrop((paths, position) => {
      void (async () => {
        if (paths.length === 0) return;
        try {
          const imported: string[] = [];
          for (const path of paths) {
            const rels = await api.importFootage(path);
            imported.push(...rels);
          }
          await refresh();
          setError(null);

          if (!position || imported.length === 0) return;
          const lane = trackLaneAtPoint(position.x, position.y);
          const trackId = lane?.dataset.trackId;
          const state = timelineRef.current;
          const track = trackId && state ? state.tracks.find((t) => t.id === trackId) : null;
          if (!lane || !track || !state) return;

          const sourcePath = imported[0]!;
          const kind =
            (await api.listProjectEntries())
              .find((e) => e.relative_path === sourcePath)
              ?.media_kind ?? null;
          if (kind && !mediaCompatibleWithTrack(kind, track.kind)) {
            setError(`Imported ${kind} media, but drop target is a ${track.kind} track.`);
            return;
          }

          const content = trackContentEl(lane);
          const contentLeft =
            content?.getBoundingClientRect().left ?? lane.getBoundingClientRect().left;
          const duration =
            kind === "image"
              ? photoDefaultRef.current
              : await api.getMediaDuration(sourcePath).catch(() => 5);
          const desired = timeFromTrackContentX(position.x, contentLeft, ppsRef.current);
          const clipsOnTrack = state.clips.filter((c) => c.track_id === track.id);
          const start = snapClipStart(clipsOnTrack, desired, duration);
          await api.addClipToTimeline(track.id, sourcePath, start);
          await refresh();
        } catch (err) {
          setError(invokeErrorMessage(err));
        }
      })();
    });
    return () => {
      void unlistenExport.then((unlisten) => unlisten());
      void unlistenFootage.then((unlisten) => unlisten());
      void unlistenPreview.then((unlisten) => unlisten());
      void unlistenOsDrop.then((unlisten) => unlisten());
      revokePreviewBlob();
    };
  }, [refresh, loadPhotoDefault, revokePreviewBlob, ppsRef]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    scrubbingRef.current = scrubbing;
  }, [scrubbing]);

  useEffect(() => {
    draggingClipRef.current = draggingClipIds.length > 0;
  }, [draggingClipIds]);

  useEffect(() => {
    resizingTracksRef.current = resizingTracks;
  }, [resizingTracks]);

  useEffect(() => {
    if (!playing) return;

    let lastTs = performance.now();
    let lastBackendSync = 0;
    let lastReactSync = 0;

    const tick = (now: number) => {
      // Clamp large gaps (background tab) so the playhead doesn't jump wildly.
      const dt = Math.min(0.05, Math.max(0, (now - lastTs) / 1000));
      lastTs = now;

      // While the user is dragging the playhead, hold the clock but keep
      // `playing` true so release continues from the new position.
      if (scrubbingRef.current) {
        playRaf.current = requestAnimationFrame(tick);
        return;
      }

      const next = Math.min(durationRef.current, playheadRef.current + dt);
      playheadRef.current = next;

      // Frontend-owned display clock: paint via DOM every frame for smoothness.
      paintPlayheadDom(next);
      followPlayheadInView(next);
      pushPreviewTarget(next, false, true);

      // Throttle React + backend — they are soft sync, not the visual authority.
      if (now - lastReactSync >= 100) {
        lastReactSync = now;
        setTimeline((prev) => (prev ? { ...prev, playhead: next } : prev));
      }
      if (now - lastBackendSync >= 100) {
        lastBackendSync = now;
        void api.setPlayhead(next);
      }

      if (next >= durationRef.current) {
        void api.setPlayhead(next);
        setTimeline((prev) => (prev ? { ...prev, playhead: next } : prev));
        setPlaying(false);
        playRaf.current = null;
        return;
      }

      playRaf.current = requestAnimationFrame(tick);
    };

    playRaf.current = requestAnimationFrame(tick);
    return () => {
      if (playRaf.current !== null) {
        cancelAnimationFrame(playRaf.current);
        playRaf.current = null;
      }
    };
  }, [playing, pushPreviewTarget, paintPlayheadDom, followPlayheadInView]);

  const duration = useMemo(() => {
    if (!timeline) return 10;
    const fromClips = Math.max(
      10,
      ...timeline.clips.map((clip) => clip.start + clip.duration),
    );
    if (dropPreview?.ghosts.length) {
      const ghostEnd = Math.max(
        ...dropPreview.ghosts.map((g) => g.start + g.duration),
      );
      return Math.max(fromClips, ghostEnd + 1);
    }
    return fromClips;
  }, [timeline, dropPreview]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  // When React owns the playhead (paused / scrubbing), keep DOM in sync.
  useLayoutEffect(() => {
    if (!timeline || playing) return;
    paintPlayheadDom(timeline.playhead);
  }, [timeline, playing, paintPlayheadDom]);

  const selectedClipIdsSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);
  const draggingClipIdsSet = useMemo(() => new Set(draggingClipIds), [draggingClipIds]);

  useEffect(() => {
    selectedClipIdsRef.current = selectedClipIds;
  }, [selectedClipIds]);

  useEffect(() => {
    selectionAnchorIdRef.current = selectionAnchorId;
  }, [selectionAnchorId]);

  const clearClipSelection = useCallback(() => {
    selectedClipIdsRef.current = [];
    selectionAnchorIdRef.current = null;
    setSelectedClipIds([]);
    setSelectionAnchorId(null);
  }, []);

  const removeClipsById = useCallback(
    async (clipIds: string[]) => {
      const ids = [...new Set(clipIds.filter(Boolean))];
      if (ids.length === 0) return;

      try {
        await api.removeTimelineClips(ids);
        await refresh();
        const removed = new Set(ids);
        setSelectedClipIds((prev) => {
          const next = prev.filter((id) => !removed.has(id));
          selectedClipIdsRef.current = next;
          return next;
        });
        setSelectionAnchorId((prev) => {
          const next = prev && removed.has(prev) ? null : prev;
          selectionAnchorIdRef.current = next;
          return next;
        });
        setError(null);
      } catch (err) {
        setError(invokeErrorMessage(err));
        await refresh();
      }
    },
    [refresh],
  );

  const onSelectClip = useCallback(
    (clipId: string, event: React.PointerEvent) => {
      const state = timelineRef.current;
      if (!state) return;

      const clip = state.clips.find((c) => c.id === clipId);
      if (clip) activeTrackIdRef.current = clip.track_id;

      const additive = event.ctrlKey || event.metaKey;
      const range = event.shiftKey;

      if (range) {
        const anchor =
          selectionAnchorIdRef.current ??
          selectedClipIdsRef.current[selectedClipIdsRef.current.length - 1] ??
          clipId;
        const rangeIds = clipIdsInChronologicalRange(
          state.clips,
          state.tracks,
          anchor,
          clipId,
        );
        if (additive) {
          const next = new Set(selectedClipIdsRef.current);
          for (const id of rangeIds) next.add(id);
          const ids = [...next];
          selectedClipIdsRef.current = ids;
          setSelectedClipIds(ids);
        } else {
          selectedClipIdsRef.current = rangeIds;
          setSelectedClipIds(rangeIds);
        }
        if (!selectionAnchorIdRef.current) {
          selectionAnchorIdRef.current = anchor;
          setSelectionAnchorId(anchor);
        }
        return;
      }

      if (additive) {
        const ids = toggleClipInSelection(selectedClipIdsRef.current, clipId);
        selectedClipIdsRef.current = ids;
        selectionAnchorIdRef.current = clipId;
        setSelectedClipIds(ids);
        setSelectionAnchorId(clipId);
        return;
      }

      // Plain press on an already-selected clip keeps the multi-selection so a
      // following drag can move the whole group. Collapse happens on click (no drag).
      if (selectedClipIdsRef.current.includes(clipId)) {
        selectionAnchorIdRef.current = clipId;
        setSelectionAnchorId(clipId);
        return;
      }

      selectedClipIdsRef.current = [clipId];
      selectionAnchorIdRef.current = clipId;
      setSelectedClipIds([clipId]);
      setSelectionAnchorId(clipId);
    },
    [],
  );

  // Ctrl/Cmd+A → select all clips on the active track (not the whole app).
  useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable ||
        Boolean(target.closest('[role="dialog"]'))
      );
    }

    function resolveActiveTrackId(state: Timeline): string | null {
      const anchorId = selectionAnchorIdRef.current;
      if (anchorId) {
        const anchor = state.clips.find((c) => c.id === anchorId);
        if (anchor) return anchor.track_id;
      }
      for (const id of selectedClipIdsRef.current) {
        const clip = state.clips.find((c) => c.id === id);
        if (clip) return clip.track_id;
      }
      return activeTrackIdRef.current;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;

      // Delete / Backspace → remove selected clip(s).
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        const ids = selectedClipIdsRef.current;
        if (ids.length === 0) return;
        event.preventDefault();
        void removeClipsById(ids);
        return;
      }

      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() !== "a") return;
      if (event.altKey) return;

      const state = timelineRef.current;
      if (!state) return;

      const trackId = resolveActiveTrackId(state);
      if (!trackId) return;

      const ids = clipIdsOnTrack(state.clips, trackId);
      if (ids.length === 0) return;

      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      activeTrackIdRef.current = trackId;
      setSelectedClipIds(ids);
      setSelectionAnchorId(ids[0] ?? null);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [removeClipsById]);

  const selectedClip = useMemo(() => {
    if (selectedClipIds.length !== 1 || !timeline) return null;
    return timeline.clips.find((clip) => clip.id === selectedClipIds[0]) ?? null;
  }, [timeline, selectedClipIds]);

  const selectedClipCount = selectedClipIds.length;
  const previewOutW = exportSettings?.width ?? 1920;
  const previewOutH = exportSettings?.height || 1080;

  const maxSelectedDuration = useMemo(() => {
    if (!selectedClip || !timeline) return null;
    return maxClipDurationOnTrack(selectedClip, timeline.clips);
  }, [selectedClip, timeline]);

  const selectedClipRef = useRef<Clip | null>(null);
  useEffect(() => {
    selectedClipRef.current = selectedClip;
  }, [selectedClip]);

  useEffect(() => {
    if (!selectedClip) {
      setTrimIn("");
      setTrimDuration("");
      return;
    }
    setTrimIn(String(selectedClip.source_offset));
    setTrimDuration(String(selectedClip.duration));
  }, [selectedClip?.id, selectedClip?.source_offset, selectedClip?.duration]);

  const applyTrimValues = useCallback(
    async (inStr: string, durStr: string, opts?: { reportInvalid?: boolean }) => {
      const clip = selectedClipRef.current;
      if (!clip) return false;

      let sourceOffset = Number(inStr);
      let nextDuration = Number(durStr);
      if (!Number.isFinite(sourceOffset) || sourceOffset < 0) {
        if (opts?.reportInvalid) setError("In (source offset) must be a non-negative number.");
        return false;
      }
      if (!Number.isFinite(nextDuration) || nextDuration <= 0) {
        if (opts?.reportInvalid) setError("Duration must be greater than zero.");
        return false;
      }

      const timelineClips = timelineRef.current?.clips ?? [];
      const maxDuration = maxClipDurationOnTrack(clip, timelineClips);
      if (maxDuration != null && nextDuration > maxDuration + 1e-9) {
        nextDuration = maxDuration;
        setTrimDuration(String(maxDuration));
      }

      if (sourceOffset === clip.source_offset && nextDuration === clip.duration) {
        return true;
      }

      try {
        try {
          await api.trimTimelineClip(clip.id, sourceOffset, nextDuration);
        } catch (trimErr) {
          if (sourceOffset !== clip.source_offset) throw trimErr;
          await api.setTimelineClipDuration(clip.id, nextDuration);
        }
        await refresh();
        setError(null);
        return true;
      } catch (err) {
        setError(invokeErrorMessage(err));
        return false;
      }
    },
    [refresh],
  );

  // Live-sync clip trim fields on every valid change (local IPC — no need to throttle).
  useEffect(() => {
    if (!selectedClip) return;
    const sourceOffset = Number(trimIn);
    let nextDuration = Number(trimDuration);
    if (!Number.isFinite(sourceOffset) || sourceOffset < 0) return;
    if (!Number.isFinite(nextDuration) || nextDuration <= 0) return;

    if (maxSelectedDuration != null && nextDuration > maxSelectedDuration + 1e-9) {
      nextDuration = maxSelectedDuration;
      setTrimDuration(String(maxSelectedDuration));
      return;
    }

    if (
      sourceOffset === selectedClip.source_offset &&
      nextDuration === selectedClip.duration
    ) {
      return;
    }

    void applyTrimValues(trimIn, String(nextDuration));
  }, [trimIn, trimDuration, selectedClip, maxSelectedDuration, applyTrimValues]);

  useEffect(() => {
    if (!timeline) return;
    setSelectedClipIds((prev) => {
      const next = prev.filter((id) => timeline.clips.some((c) => c.id === id));
      return next.length === prev.length ? prev : next;
    });
    setSelectionAnchorId((prev) =>
      prev && timeline.clips.some((c) => c.id === prev) ? prev : null,
    );
  }, [timeline]);

  useEffect(() => {
    if (!timeline) return;
    // Keep the session aimed at the current playhead when not driven by rAF
    // (pause seeks, clip edits, initial load).
    if (!playing) {
      pushPreviewTarget(timeline.playhead, scrubbing, false);
    }
  }, [timeline?.playhead, playing, scrubbing, timeline, pushPreviewTarget]);

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
      {mediaDrag && dragCursor && (
        <div
          className="pointer-events-none fixed z-[100] max-w-[14rem] truncate rounded-md border bg-popover px-2 py-1 text-xs shadow-md"
          style={{ left: dragCursor.x + 12, top: dragCursor.y + 12 }}
        >
          {pathBasename(mediaDrag.sourcePath)}
        </div>
      )}
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

      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)] overflow-hidden">
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
          <ScrollArea className="h-[calc(100%-7.5rem)] pr-3">
            <FileTree
              entries={projectEntries}
              onAddMedia={(relativePath, mediaKind) =>
                void addMediaToTimeline(relativePath, mediaKind)
              }
              onMediaPointerDown={onMediaPointerDown}
            />
          </ScrollArea>
          <div className="mt-3 space-y-2 border-t pt-3">
            <Label htmlFor="photo-default" className="text-xs text-muted-foreground">
              Photo default (s)
            </Label>
            <div className="flex items-center gap-2">
              <input
                id="photo-default"
                type="number"
                min={0.1}
                step={0.1}
                className="h-8 w-full rounded-md border bg-background px-2 text-sm"
                value={photoDefaultDuration}
                onChange={(e) => setPhotoDefaultDuration(e.target.value)}
                onBlur={() => void applyPhotoDefaultDuration()}
              />
              <Button size="sm" variant="outline" onClick={() => void applyPhotoDefaultDuration()}>
                Set
              </Button>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <section className="flex min-h-0 flex-1 flex-col border-b bg-muted/60 p-4">
            <div className="mb-3 flex shrink-0 items-center gap-2">
              <Button size="icon" variant="outline" onClick={() => togglePlay()}>
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <span className="text-sm text-muted-foreground">
                {timeline.playhead.toFixed(1)}s / {duration.toFixed(1)}s
              </span>
              {selectedClip ? (
                <>
                  <Separator orientation="vertical" className="mx-1 h-5" />
                  <span className="truncate text-sm font-medium">
                    {pathBasename(selectedClip.source_path)}
                  </span>
                  <span className="shrink-0 text-xs capitalize text-muted-foreground">
                    {selectedClip.media_kind}
                  </span>
                </>
              ) : selectedClipCount > 1 ? (
                <>
                  <Separator orientation="vertical" className="mx-1 h-5" />
                  <span className="text-sm text-muted-foreground">
                    {selectedClipCount} clips selected
                  </span>
                </>
              ) : null}
              <div className="ml-auto flex shrink-0 items-end gap-2">
                {selectedClip && selectedClip.media_kind !== "image" && (
                  <div className="space-y-0.5">
                    <Label htmlFor="trim-in" className="text-[10px]">
                      In
                    </Label>
                    <input
                      id="trim-in"
                      type="number"
                      min={0}
                      step={0.1}
                      className="h-8 w-20 rounded-md border bg-background px-2 text-sm"
                      value={trimIn}
                      onChange={(e) => setTrimIn(e.target.value)}
                      onBlur={() =>
                        void applyTrimValues(trimIn, trimDuration, { reportInvalid: true })
                      }
                    />
                  </div>
                )}
                {selectedClip && (
                  <div className="space-y-0.5">
                    <Label htmlFor="trim-duration" className="text-[10px]">
                      Duration
                    </Label>
                    <input
                      id="trim-duration"
                      type="number"
                      min={0.1}
                      max={maxSelectedDuration ?? undefined}
                      step={0.1}
                      className="h-8 w-20 rounded-md border bg-background px-2 text-sm"
                      value={trimDuration}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const n = Number(raw);
                        if (
                          maxSelectedDuration != null &&
                          Number.isFinite(n) &&
                          n > maxSelectedDuration
                        ) {
                          setTrimDuration(String(maxSelectedDuration));
                          return;
                        }
                        setTrimDuration(raw);
                      }}
                      onBlur={() =>
                        void applyTrimValues(trimIn, trimDuration, { reportInvalid: true })
                      }
                    />
                  </div>
                )}
                <span className="self-center text-sm text-muted-foreground">
                  {previewOutW}×{previewOutH}
                </span>
              </div>
            </div>

            <div
              className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
              style={{ containerType: "size" }}
            >
              <div
                className="relative overflow-hidden bg-black"
                style={{
                  aspectRatio: `${previewOutW} / ${previewOutH}`,
                  width: `min(100cqw, calc(100cqh * ${previewOutW} / ${previewOutH}))`,
                  height: `min(100cqh, calc(100cqw * ${previewOutH} / ${previewOutW}))`,
                }}
              >
                {preview?.data_url ? (
                  <img
                    src={preview.data_url}
                    alt="Preview frame"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center px-3">
                    <p className="text-center text-sm text-muted-foreground">
                      {timeline.clips.some((c) => c.media_kind !== "audio")
                        ? `No visual clip at ${timeline.playhead.toFixed(1)}s`
                        : "Add a video or image clip to preview"}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section
            ref={timelineScrollRef}
            className="min-h-0 flex-1 select-none overflow-auto overscroll-contain py-4 pr-4 pl-0"
            onScroll={onTimelineScroll}
            onPointerDown={markUserTimelineGesture}
          >
            <div
              ref={timelineCanvasRef}
              className="relative"
              style={{ width: timelineCanvasWidthPx(duration, pixelsPerSecond) }}
              onClick={() => clearClipSelection()}
            >
              <div
                className="mb-1 grid items-end"
                style={{
                  gridTemplateColumns: `${TRACK_LABEL_WIDTH}px ${timelineContentWidthPx(duration, pixelsPerSecond)}px`,
                  columnGap: TRACK_GAP,
                }}
              >
                <div className="sticky left-0 z-10 relative self-stretch pl-4">
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-0 -right-3 bg-gradient-to-r from-background from-40% via-background/85 to-transparent"
                  />
                </div>
                <TimelineRuler
                  duration={duration}
                  pixelsPerSecond={pixelsPerSecond}
                  onPointerDown={onRulerPointerDown}
                />
              </div>

              {timeline.tracks.map((track) => (
                <TrackLane
                  key={track.id}
                  track={track}
                  clips={timeline.clips.filter((clip) => clip.track_id === track.id)}
                  timelineDuration={duration}
                  pixelsPerSecond={pixelsPerSecond}
                  laneHeight={trackLaneHeight(trackHeights, track.id)}
                  selectedClipIds={selectedClipIdsSet}
                  draggingClipIds={draggingClipIdsSet}
                  dropGhosts={
                    dropPreview
                      ? dropPreview.ghosts.filter((g) => g.trackId === track.id)
                      : []
                  }
                  onResize={(trackId, deltaY) =>
                    setTrackHeights((prev) => applyTrackHeightDelta(prev, trackId, deltaY))
                  }
                  onResizeStart={() => setResizingTracks(true)}
                  onResizeEnd={() => setResizingTracks(false)}
                  onSelectClip={onSelectClip}
                  onClipMovePointerDown={onClipMovePointerDown}
                  onRemoveClip={(clipId) => void removeClipsById([clipId])}
                />
              ))}

              <PlayheadOverlay
                ref={playheadOverlayRef}
                playhead={timeline.playhead}
                onPointerDown={onPlayheadHandlePointerDown}
                onFocus={onPlayheadFocus}
                onBlur={onPlayheadBlur}
              />
            </div>
          </section>
        </main>
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
