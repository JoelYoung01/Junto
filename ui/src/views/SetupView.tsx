import { useEffect, useRef, useState } from "react";
import { Copy, FolderOpen, FolderPlus, Plug } from "lucide-react";

import { api, copyText, invokeErrorMessage, mcpConfigSnippet, pickDirectory } from "@/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";

interface SetupViewProps {
  onComplete: () => void;
  onOpenProject: () => void;
}

type HealthStatus = "checking" | "connected" | "unreachable";

export function SetupView({ onComplete, onOpenProject }: SetupViewProps) {
  const [mcpUrl, setMcpUrl] = useState("");
  const [healthStatus, setHealthStatus] = useState<HealthStatus>("checking");
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [copied, setCopied] = useState<"cursor" | "opencode" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pathRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    async function pollHealth() {
      try {
        const connected = await api.checkMcpHealth();
        if (!cancelled) {
          setHealthStatus(connected ? "connected" : "unreachable");
          setLastChecked(new Date());
        }
      } catch {
        if (!cancelled) {
          setHealthStatus("unreachable");
          setLastChecked(new Date());
        }
      }
    }

    void api
      .getMcpInfo()
      .then((info) => {
        if (cancelled) return;
        setMcpUrl(info.url);
        void pollHealth();
        timer = window.setInterval(() => {
          void pollHealth();
        }, 5000);
      })
      .catch((err) => {
        if (!cancelled) {
          setHealthStatus("unreachable");
          setError(invokeErrorMessage(err));
        }
      });

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, []);

  async function finishSetup() {
    setBusy(true);
    setError(null);
    try {
      await api.completeSetup();
      onComplete();
    } catch (err) {
      setError(invokeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyMcpConfig(client: "cursor" | "opencode") {
    try {
      await copyText(mcpConfigSnippet(mcpUrl, client));
      setCopied(client);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      setError(invokeErrorMessage(err));
    }
  }

  async function openExistingProject(fromDialog: boolean) {
    setBusy(true);
    setError(null);
    try {
      const selected = fromDialog
        ? await pickDirectory("Open existing Junto project")
        : pathRef.current?.value.trim() || null;
      if (!selected) {
        setBusy(false);
        return;
      }
      if (!fromDialog && pathRef.current) {
        pathRef.current.value = selected;
      }
      await api.completeSetup();
      await api.openProject(selected);
      onOpenProject();
    } catch (err) {
      setError(invokeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const healthLabel =
    healthStatus === "connected"
      ? "Connected"
      : healthStatus === "unreachable"
        ? "Unreachable"
        : "Checking…";

  const healthClass =
    healthStatus === "connected"
      ? "text-emerald-400"
      : healthStatus === "unreachable"
        ? "text-red-400"
        : "text-muted-foreground";

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Welcome to Junto</CardTitle>
          <CardDescription>
            A filesystem-first video tool for personal projects. Set up your workspace, optionally
            connect an agent, then create your first project.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Plug className="h-4 w-4" />
              Connect your agent (optional)
            </div>
            <p className="text-sm text-muted-foreground">
              Junto exposes a standard MCP Streamable HTTP server. Paste the config for your agent
              below, restart the agent session, then open a project in Junto before using tools.
            </p>
            <p className={`text-sm ${healthClass}`}>
              MCP status: {healthLabel}
              {lastChecked ? ` · last checked ${lastChecked.toLocaleTimeString()}` : ""}
            </p>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Cursor · Claude Code</p>
              <p className="text-xs text-muted-foreground">
                Add to <code className="text-foreground">.cursor/mcp.json</code> or your Claude MCP
                settings.
              </p>
              <pre className="overflow-auto rounded-lg border bg-muted/30 p-3 text-xs">
                {mcpConfigSnippet(mcpUrl, "cursor")}
              </pre>
              <Button variant="outline" size="sm" onClick={() => void copyMcpConfig("cursor")}>
                <Copy className="h-4 w-4" />
                {copied === "cursor" ? "Copied" : "Copy Cursor config"}
              </Button>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">OpenCode</p>
              <p className="text-xs text-muted-foreground">
                Add to <code className="text-foreground">opencode.json</code> or{" "}
                <code className="text-foreground">opencode.jsonc</code>. Uses{" "}
                <code className="text-foreground">codemode: false</code> so tools are exposed
                directly. MCP requests log to the Junto dev console.
              </p>
              <pre className="overflow-auto rounded-lg border bg-muted/30 p-3 text-xs">
                {mcpConfigSnippet(mcpUrl, "opencode")}
              </pre>
              <Button variant="outline" size="sm" onClick={() => void copyMcpConfig("opencode")}>
                <Copy className="h-4 w-4" />
                {copied === "opencode" ? "Copied" : "Copy OpenCode config"}
              </Button>
            </div>
          </section>

          <Separator />

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FolderPlus className="h-4 w-4" />
              Ready to edit
            </div>
            <p className="text-sm text-muted-foreground">
              When you continue, you can create a new project folder or open an existing one.
            </p>
            <div className="space-y-2">
              <Label htmlFor="existing-project-path">Open an existing project</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="existing-project-path"
                  ref={pathRef}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Browse for a folder or paste a path"
                  defaultValue=""
                  disabled={busy}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void openExistingProject(true)}
                >
                  <FolderOpen className="h-4 w-4" />
                  Browse
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void openExistingProject(false)}
              >
                Open path
              </Button>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
          </section>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button disabled={busy} onClick={() => void finishSetup()}>
            Create new project
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
