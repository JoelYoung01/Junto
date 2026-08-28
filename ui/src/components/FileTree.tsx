import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  FileAudio,
  FileImage,
  FileVideo,
  Folder,
} from "lucide-react";

import { ProjectEntry } from "@/api";
import { Button } from "@/components/ui/button";

interface TreeNode {
  name: string;
  relativePath: string;
  entryKind: "directory" | "file";
  mediaKind?: "video" | "image" | "audio";
  children: TreeNode[];
}

function buildTree(entries: ProjectEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const nodeMap = new Map<string, TreeNode>();

  const sorted = [...entries].sort((a, b) => a.relative_path.localeCompare(b.relative_path));

  for (const entry of sorted) {
    const node: TreeNode = {
      name: entry.name,
      relativePath: entry.relative_path,
      entryKind: entry.entry_kind,
      mediaKind: entry.media_kind ?? undefined,
      children: [],
    };
    nodeMap.set(entry.relative_path, node);

    const slash = entry.relative_path.lastIndexOf("/");
    const parentPath = slash >= 0 ? entry.relative_path.slice(0, slash) : "";

    if (parentPath === "") {
      root.push(node);
    } else {
      const parent = nodeMap.get(parentPath);
      if (parent) {
        parent.children.push(node);
      } else {
        root.push(node);
      }
    }
  }

  return root;
}

function collectDirectoryPaths(nodes: TreeNode[]): Set<string> {
  const paths = new Set<string>();
  function walk(items: TreeNode[]) {
    for (const node of items) {
      if (node.entryKind === "directory") {
        paths.add(node.relativePath);
        walk(node.children);
      }
    }
  }
  walk(nodes);
  return paths;
}

function EntryIcon({ node }: { node: TreeNode }) {
  if (node.entryKind === "directory") {
    return <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />;
  }
  switch (node.mediaKind) {
    case "video":
      return <FileVideo className="h-3.5 w-3.5 shrink-0 text-blue-400" />;
    case "image":
      return <FileImage className="h-3.5 w-3.5 shrink-0 text-emerald-400" />;
    case "audio":
      return <FileAudio className="h-3.5 w-3.5 shrink-0 text-orange-400" />;
    default:
      return <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  }
}

interface FileTreeProps {
  entries: ProjectEntry[];
  onAddMedia: (relativePath: string, mediaKind: "video" | "image" | "audio") => void;
  onMediaPointerDown?: (
    relativePath: string,
    mediaKind: "video" | "image" | "audio",
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
}

function TreeNodeRow({
  node,
  depth,
  expanded,
  onToggle,
  onAddMedia,
  onMediaPointerDown,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onAddMedia: (relativePath: string, mediaKind: "video" | "image" | "audio") => void;
  onMediaPointerDown?: (
    relativePath: string,
    mediaKind: "video" | "image" | "audio",
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
}) {
  const isDir = node.entryKind === "directory";
  const isExpanded = isDir && expanded.has(node.relativePath);
  const isMedia = node.entryKind === "file" && node.mediaKind;

  return (
    <>
      <div
        className="group flex items-center gap-1 rounded-md py-0.5 pr-1 text-sm hover:bg-muted/40"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {isDir ? (
          <button
            type="button"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-muted"
            onClick={() => onToggle(node.relativePath)}
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className="inline-block h-5 w-5 shrink-0" />
        )}

        <div
          className={`flex min-w-0 flex-1 items-center gap-1.5 ${isMedia ? "cursor-grab active:cursor-grabbing" : ""}`}
          onPointerDown={
            isMedia
              ? (e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  onMediaPointerDown?.(node.relativePath, node.mediaKind!, e);
                }
              : undefined
          }
        >
          <EntryIcon node={node} />
          <span className="truncate" title={node.relativePath}>
            {node.name}
          </span>
        </div>

        {isMedia && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-1.5 opacity-0 group-hover:opacity-100"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onAddMedia(node.relativePath, node.mediaKind!);
            }}
          >
            Add
          </Button>
        )}
      </div>

      {isDir &&
        isExpanded &&
        node.children.map((child) => (
          <TreeNodeRow
            key={child.relativePath}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onAddMedia={onAddMedia}
            onMediaPointerDown={onMediaPointerDown}
          />
        ))}
    </>
  );
}

export function FileTree({ entries, onAddMedia, onMediaPointerDown }: FileTreeProps) {
  const tree = useMemo(() => buildTree(entries), [entries]);
  const [expanded, setExpanded] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (tree.length === 0) return;
    setExpanded((prev) => {
      if (prev && prev.size > 0) return prev;
      return collectDirectoryPaths(tree);
    });
  }, [tree]);

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Project folder is empty.</p>;
  }

  if (!expanded) {
    return null;
  }

  return (
    <div className="space-y-0.5">
      {tree.map((node) => (
        <TreeNodeRow
          key={node.relativePath}
          node={node}
          depth={0}
          expanded={expanded}
          onToggle={toggle}
          onAddMedia={onAddMedia}
          onMediaPointerDown={onMediaPointerDown}
        />
      ))}
    </div>
  );
}
