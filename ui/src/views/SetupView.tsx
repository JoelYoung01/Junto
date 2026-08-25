import { useEffect, useRef, useState } from "react";
import { Copy, FolderPlus, Plug } from "lucide-react";

import { api, copyText, invokeErrorMessage, mcpBundleInstructions, pickDirectory } from "@/api";
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

interface SetupViewProps {
  onComplete: () => void;
  onOpenProject: () => void;
}

type HealthStatus = "checking" | "connected" | "unreachable";

export function SetupView({ onComplete, onOpenProject }: SetupViewProps) {
  const [mcpUrl, setMcpUrl] = useState("");
  const [healthUrl, setHealthUrl] = useState("");
  const [healthStatus, setHealthStatus] = useState<HealthStatus>("checking");
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pathRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    async function pollHealth(url: string) {
      try {
        const response = await fetch(url, { method: "GET", cache: "no-store" });
        if (!cancelled) {
          setHealthStatus(response.ok ? "connected" : "unreachable");
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
        setHealthUrl(info.health_url);
        void pollHealth(info.health_url);
        timer = window.setInterval(() => {
          void pollHealth(info.health_url);
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

  async function copyMcpConfig() {
    try {
      await copyText(mcpBundleInstructions(mcpUrl));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
              Copy this MCP configuration into Cursor, Claude Code, or another MCP-capable agent.
            </p>
            <p className={`text-sm ${healthClass}`}>
              MCP status: {healthLabel}
              {lastChecked
                ? ` · last checked ${lastChecked.toLocaleTimeString()}`
                : healthUrl
                  ? ""
                  : " · waiting for health URL"}
            </p>
            <pre className="overflow-auto rounded-lg border bg-muted/30 p-3 text-xs">
              {mcpBundleInstructions(mcpUrl)}
            </pre>
            <Button variant="outline" onClick={() => void copyMcpConfig()}>
              <Copy className="h-4 w-4" />
              {copied ? "Copied" : "Copy MCP config"}
            </Button>
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
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                ref={pathRef}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="/path/to/existing/project"
                defaultValue=""
                disabled={busy}
              />
              <Button
                variant="secondary"
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
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void openExistingProject(true)}
          >
            Open existing project
          </Button>
          <Button disabled={busy} onClick={() => void finishSetup()}>
            Continue
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
