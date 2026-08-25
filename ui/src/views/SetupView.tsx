import { useEffect, useState } from "react";
import { Copy, FolderPlus, Plug } from "lucide-react";

import { api, copyText, mcpBundleInstructions } from "@/api";
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

export function SetupView({ onComplete, onOpenProject }: SetupViewProps) {
  const [mcpUrl, setMcpUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void api.getMcpInfo().then((info) => setMcpUrl(info.url));
  }, []);

  async function finishSetup() {
    await api.completeSetup();
    onComplete();
  }

  async function copyMcpConfig() {
    await copyText(mcpBundleInstructions(mcpUrl));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

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
              Connection status is not verified yet.
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
          </section>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button variant="secondary" onClick={() => void onOpenProject()}>
            Open existing project
          </Button>
          <Button onClick={() => void finishSetup()}>Continue</Button>
        </CardFooter>
      </Card>
    </div>
  );
}
