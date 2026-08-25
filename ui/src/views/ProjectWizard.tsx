import { useMemo, useState } from "react";
import { FolderOpen, Import } from "lucide-react";

import {
  api,
  DirectoryScan,
  pickDirectory,
  pickFootageSource,
  ProjectSummary,
} from "@/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";

interface ProjectWizardProps {
  onComplete: () => void;
  onCancel: () => void;
}

type WizardStep = "pick" | "review" | "import" | "done";

export function ProjectWizard({ onComplete, onCancel }: ProjectWizardProps) {
  const [step, setStep] = useState<WizardStep>("pick");
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [manualPath, setManualPath] = useState("");
  const [manualImportPath, setManualImportPath] = useState("");
  const [scan, setScan] = useState<DirectoryScan | null>(null);
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mediaOutsideRaw = useMemo(
    () =>
      scan?.media_files.filter((file) => !file.relative_path.startsWith("Raw Footage/")) ?? [],
    [scan],
  );

  async function useProjectFolder(selected: string) {
    setError(null);
    setProjectPath(selected);
    setProjectName(selected.split(/[/\\]/).pop() ?? "Untitled Project");
    const result = await api.scanDirectory(selected);
    setScan(result);
    setStep("review");
  }

  async function chooseProjectFolder() {
    setError(null);
    try {
      const selected = await pickDirectory("Choose project folder");
      if (!selected) return;
      await useProjectFolder(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function useManualProjectPath() {
    const selected = manualPath.trim();
    if (!selected) return;
    setBusy(true);
    try {
      await useProjectFolder(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function createProject(andImport: boolean) {
    if (!projectPath) return;
    setBusy(true);
    setError(null);
    try {
      let project: ProjectSummary;
      try {
        project = await api.openProject(projectPath);
      } catch {
        project = await api.createProject(projectPath, projectName || "Untitled Project");
      }

      if (andImport && mediaOutsideRaw.length > 0) {
        await api.consolidateFootage();
      }

      if (scan?.kind === "empty" || scan?.kind === "has_non_media_only") {
        setSummary(project);
        setStep("import");
        return;
      }

      setSummary(project);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function importFromPath(source: string) {
    setBusy(true);
    setError(null);
    try {
      await api.importFootage(source);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function importFootage() {
    setBusy(true);
    setError(null);
    try {
      const source = await pickFootageSource("Choose raw footage folder");
      if (!source) {
        setBusy(false);
        return;
      }
      await importFromPath(source);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>New project</CardTitle>
          <CardDescription>
            Choose a folder on your computer. Junto will organize raw footage inside it and keep
            project metadata in the same directory.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "pick" && (
            <div className="space-y-4">
              <Button onClick={() => void chooseProjectFolder()}>
                <FolderOpen className="h-4 w-4" />
                Select project folder
              </Button>
              <div className="space-y-2">
                <Label htmlFor="manual-project-path">Or paste a folder path</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    id="manual-project-path"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder="/path/to/project"
                    value={manualPath}
                    onChange={(e) => setManualPath(e.target.value)}
                    disabled={busy}
                  />
                  <Button
                    variant="secondary"
                    disabled={busy || !manualPath.trim()}
                    onClick={() => void useManualProjectPath()}
                  >
                    Use path
                  </Button>
                </div>
              </div>
            </div>
          )}

          {step === "review" && scan && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/20 p-4 text-sm">
                <p className="font-medium">{projectPath}</p>
                <p className="mt-2 text-muted-foreground">
                  {scan.kind === "empty" && "This folder is empty. Junto will create a Raw Footage directory."}
                  {scan.kind === "has_media_outside_raw_footage" &&
                    `Found ${mediaOutsideRaw.length} media file(s) outside Raw Footage.`}
                  {scan.kind === "has_media_in_raw_footage" &&
                    "Media already exists in Raw Footage. Ready to open."}
                  {scan.kind === "has_non_media_only" &&
                    "No media detected yet. You can import footage next."}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="project-name">Project name</Label>
                <input
                  id="project-name"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                />
              </div>

              {scan.kind === "has_media_outside_raw_footage" ? (
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={() => void createProject(true)}>
                    Yes, use this folder and move media into Raw Footage
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => setStep("pick")}>
                    Choose a different folder
                  </Button>
                </div>
              ) : (
                <Button disabled={busy} onClick={() => void createProject(false)}>
                  Continue
                </Button>
              )}
            </div>
          )}

          {step === "import" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Your project folder is ready. Choose where your raw footage lives and Junto will copy
                it into <code className="rounded bg-muted px-1 py-0.5">Raw Footage/</code>.
              </p>
              <Button disabled={busy} onClick={() => void importFootage()}>
                <Import className="h-4 w-4" />
                Choose raw footage folder
              </Button>
              <div className="space-y-2">
                <Label htmlFor="manual-import-path">Or paste a footage folder path</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    id="manual-import-path"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder="/path/to/footage"
                    value={manualImportPath}
                    onChange={(e) => setManualImportPath(e.target.value)}
                    disabled={busy}
                  />
                  <Button
                    variant="secondary"
                    disabled={busy || !manualImportPath.trim()}
                    onClick={() => void importFromPath(manualImportPath.trim())}
                  >
                    Import path
                  </Button>
                </div>
              </div>
              <Button variant="ghost" disabled={busy} onClick={() => setStep("done")}>
                Skip for now
              </Button>
            </div>
          )}

          {step === "done" && summary && (
            <div className="space-y-2 rounded-lg border bg-muted/20 p-4 text-sm">
              <p className="font-medium">Project ready</p>
              <p className="text-muted-foreground">{summary.root}</p>
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
        </CardContent>
        <CardFooter className="justify-between">
          <Button variant="ghost" onClick={onCancel}>
            Back
          </Button>
          {step === "done" && (
            <Button onClick={onComplete}>Open editor</Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
