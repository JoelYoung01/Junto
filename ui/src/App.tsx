import { useEffect, useState } from "react";

import { api } from "@/api";
import { EditorView } from "@/views/EditorView";
import { ProjectWizard } from "@/views/ProjectWizard";
import { SetupView } from "@/views/SetupView";

type Screen = "loading" | "setup" | "wizard" | "editor";

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");

  useEffect(() => {
    void (async () => {
      const config = await api.getAppConfig();
      if (!config.setup_complete) {
        setScreen("setup");
        return;
      }
      let project = await api.getCurrentProject();
      if (!project && config.last_project) {
        try {
          project = await api.openProject(config.last_project);
        } catch {
          // Last project may have been moved or deleted — fall through to wizard.
        }
      }
      setScreen(project ? "editor" : "wizard");
    })();
  }, []);

  if (screen === "loading") {
    return (
      <div className="grid min-h-screen place-items-center text-muted-foreground">Loading Junto…</div>
    );
  }

  if (screen === "setup") {
    return (
      <SetupView
        onComplete={() => setScreen("wizard")}
        onOpenProject={() => setScreen("editor")}
      />
    );
  }

  if (screen === "wizard") {
    return (
      <ProjectWizard
        onComplete={() => setScreen("editor")}
        onCancel={() => setScreen("setup")}
      />
    );
  }

  return (
    <EditorView
      onNewProject={() => setScreen("wizard")}
    />
  );
}
