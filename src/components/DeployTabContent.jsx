import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Download, Check, Rocket, FileCode2, FileText, ChevronDown, ChevronUp, X, GitBranch, Loader2, AlertCircle, ExternalLink, CheckCircle2, Lock, Eye, EyeOff, RefreshCw, Info } from "lucide-react";
import { buildJobSpec, FLAT_FILE_PLATFORMS } from "@/components/JobSpecExport";
import { getAllTemplates, getDefaultTemplateId, fillTemplate } from "@/components/DagTemplates";
import { dataflow } from "@/api/client";
import { toYaml } from "@/utils/toYaml";

function ArtifactCard({ title, filename, icon: Icon, content }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = (e) => {
    e.stopPropagation();
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <Icon className="w-4 h-4 text-slate-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          <p className="text-xs text-slate-400 font-mono truncate">{filename}</p>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={handleCopy}>
            {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={handleDownload}>
            <Download className="w-3 h-3" />
          </Button>
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </div>
      {expanded && (
        <div className="bg-slate-950 overflow-hidden">
          <pre className="p-4 text-xs text-emerald-300 font-mono whitespace-pre overflow-auto max-h-64 leading-relaxed">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}

function GitLabIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 014.82 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0118.6 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.51L23 13.45a.84.84 0 01-.35.94z" />
    </svg>
  );
}

function StatusBadge({ connected, label }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
      connected ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} />
      {label}
    </span>
  );
}

export default function DeployTabContent({ formData, connections, onDeploySuccess, onSavePipeline, onDeployStatusChange, editingJob }) {
  const sourceConn = connections.find(c => c.id === formData.source_connection_id);
  const sourcePlatform = sourceConn?.platform || "";

  const [customTemplates, setCustomTemplates] = useState([]);

  const [commitBranch, setCommitBranch] = useState("main");
  const [commitMsg, setCommitMsg] = useState("");

  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState(null);
  const [deployError, setDeployError] = useState(null);

  const [glConfig, setGlConfig] = useState(null);
  const [glUsername, setGlUsername] = useState("");
  const [glPassword, setGlPassword] = useState("");
  const [glStatus, setGlStatus] = useState(null);
  const [glAuthenticating, setGlAuthenticating] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    dataflow.entities.DagTemplate.list().then(res => {
      if (Array.isArray(res)) setCustomTemplates(res);
    }).catch(() => {});
    fetch("/api/gitlab/config").then(r => r.json()).then(setGlConfig).catch(() => setGlConfig({ configured: false }));
  }, []);

  const selectedTemplateId = formData.dag_template_id || getDefaultTemplateId(sourcePlatform);

  const nameClean = (formData.name || "pipeline").replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
  const dagFilename = `${nameClean}-airflow-dag.yaml`;
  const specFilename = `${nameClean}-pipelinespec.yaml`;
  const repoPath = `specs/${nameClean}/`;

  const spec = buildJobSpec({ id: formData.id || "(unsaved)", ...formData, dq_rules: formData.dq_rules || {} }, connections);
  const cleanSpec = JSON.parse(JSON.stringify(spec));
  const specContent = `# DataFlow Pipeline Spec — ${formData.name || "untitled"}\n` + toYaml(cleanSpec);

  const airflowDagYaml = fillTemplate(selectedTemplateId, formData, connections, customTemplates);
  const allTemplates = getAllTemplates(customTemplates);
  const selectedTmpl = allTemplates.find(t => t.id === selectedTemplateId);

  const defaultCommitMsg = editingJob
    ? `Update pipeline: ${formData.name}`
    : `Add pipeline: ${formData.name}`;

  const filePayload = [
    { path: `${repoPath}${dagFilename}`, content: airflowDagYaml },
    { path: `${repoPath}${specFilename}`, content: specContent },
  ];

  const handleGitLabAuth = async () => {
    if (!glUsername || !glPassword) return;
    setGlAuthenticating(true);
    setGlStatus(null);
    try {
      const res = await fetch("/api/gitlab/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: glUsername, password: glPassword }),
      });
      const data = await res.json();
      setGlStatus(data);
    } catch (err) {
      setGlStatus({ connected: false, error: err.message });
    } finally {
      setGlAuthenticating(false);
    }
  };

  const handleDeploy = async () => {
    setDeploying(true);
    setDeployResult(null);
    setDeployError(null);
    if (onDeployStatusChange) onDeployStatusChange("deploying");
    try {
      if (onSavePipeline) {
        await onSavePipeline();
      }

      const res = await fetch("/api/gitlab/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: glUsername,
          password: glPassword,
          branch: commitBranch || "main",
          commitMessage: commitMsg || defaultCommitMsg,
          files: filePayload,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Commit failed");
      }
      setDeployResult({ ...data, provider: "gitlab" });
      if (onDeploySuccess) onDeploySuccess(data);
    } catch (err) {
      setDeployError(err.message);
      if (onDeployStatusChange) onDeployStatusChange("error");
    } finally {
      setDeploying(false);
    }
  };

  const canDeploy = glStatus?.connected && glUsername && glPassword;

  return (
    <div className="space-y-4">

      {/* Artifacts */}
      <div>
        <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">Deployment Artifacts</Label>
        <div className="space-y-2">
          <ArtifactCard
            title={`Airflow DAG (YAML) — ${selectedTmpl?.name || "Template"}`}
            filename={dagFilename}
            icon={FileCode2}
            content={airflowDagYaml}
          />
          <ArtifactCard
            title="Pipeline Spec (YAML)"
            filename={specFilename}
            icon={FileText}
            content={specContent}
          />
        </div>
        <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-1">
          <Info className="w-3 h-3 shrink-0" />
          Filenames auto-generated from pipeline name: <code className="font-mono text-slate-500">{nameClean}</code>
        </p>
      </div>

      {/* Git Provider Header */}
      <div>
        <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">Git Provider</Label>
        <div className="flex gap-2">
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border bg-orange-600 text-white border-orange-600">
            <GitLabIcon className="w-4 h-4" />
            GitLab
          </div>
        </div>
      </div>

      {/* GitLab settings */}
      <div className="rounded-lg border border-orange-200 bg-orange-50/50 px-4 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold text-orange-700 uppercase tracking-wide">GitLab Repository & Authentication</Label>
          {glStatus && (
            <StatusBadge connected={glStatus.connected} label={glStatus.connected ? `Authenticated as ${glStatus.login}` : "Not authenticated"} />
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-orange-700 block mb-1">GitLab URL</label>
            <Input value={glConfig?.url || ""} readOnly className="font-mono text-sm bg-orange-50 text-orange-800" placeholder="Set GITLAB_URL env var" />
          </div>
          <div>
            <label className="text-xs font-medium text-orange-700 block mb-1">Project Path</label>
            <Input value={glConfig?.project || ""} readOnly className="font-mono text-sm bg-orange-50 text-orange-800" placeholder="Set GITLAB_PROJECT env var" />
          </div>
        </div>
        {!glConfig?.configured && (
          <p className="text-xs text-amber-600 flex items-center gap-1">
            <Info className="w-3 h-3" /> Set GITLAB_URL and GITLAB_PROJECT environment variables to configure.
          </p>
        )}
        <div className="border-t border-orange-200 pt-3 space-y-2">
          <div className="flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-orange-700" />
            <p className="text-xs font-semibold text-orange-800">LDAP Credentials</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-orange-700 block mb-1">Username</label>
              <Input type="text" value={glUsername} onChange={e => { setGlUsername(e.target.value); setGlStatus(null); }} className="font-mono text-sm" placeholder="LDAP username" autoComplete="username" />
            </div>
            <div>
              <label className="text-xs font-medium text-orange-700 block mb-1">Password</label>
              <div className="relative">
                <Input type={showPassword ? "text" : "password"} value={glPassword} onChange={e => { setGlPassword(e.target.value); setGlStatus(null); }} className="font-mono text-sm pr-9" placeholder="LDAP password" autoComplete="current-password" />
                <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-orange-400 hover:text-orange-600" tabIndex={-1}>
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" disabled={!glUsername || !glPassword || glAuthenticating || !glConfig?.configured} onClick={handleGitLabAuth} className="h-7 px-3 text-xs bg-orange-600 hover:bg-orange-700 text-white">
              {glAuthenticating ? (<><Loader2 className="w-3 h-3 animate-spin mr-1" /> Authenticating...</>) : "Authenticate"}
            </Button>
            {glStatus && !glStatus.connected && (
              <span className="text-xs font-medium text-red-500">{glStatus.error || "Authentication failed"}</span>
            )}
          </div>
          <p className="text-xs text-orange-500">Credentials are used only for this commit and are never stored.</p>
        </div>
      </div>

      {/* Branch + Commit Message */}
      <div className="rounded-lg border border-slate-200 p-4 space-y-3">
        <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Git Commit Settings</Label>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Branch</label>
            <Input value={commitBranch} onChange={e => setCommitBranch(e.target.value)} className="font-mono text-sm" placeholder="main" />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-medium text-slate-600 block mb-1">Commit Message</label>
            <Input value={commitMsg} onChange={e => setCommitMsg(e.target.value)} className="text-sm" placeholder={defaultCommitMsg} />
          </div>
        </div>
        <div className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
          <GitBranch className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="text-xs text-slate-500">Files will be committed to:</span>
          <code className="text-xs font-mono text-[#0060AF] font-semibold">{repoPath}</code>
        </div>
      </div>

      {/* Deploy result */}
      {deployResult && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <p className="text-sm font-semibold text-emerald-800">Committed successfully to GitLab</p>
          </div>
          <div className="space-y-1 text-xs text-emerald-700">
            <p><span className="font-medium">Branch:</span> <code className="bg-emerald-100 px-1 rounded">{deployResult.branch}</code></p>
            <p><span className="font-medium">SHA:</span> <code className="bg-emerald-100 px-1 rounded font-mono">{(deployResult.short_sha || deployResult.sha || "").substring(0, 10)}</code></p>
            {deployResult.author && (
              <p><span className="font-medium">Author:</span> {deployResult.author}</p>
            )}
            <p><span className="font-medium">Files:</span></p>
            <ul className="ml-4 space-y-0.5">
              {deployResult.files?.map(f => (
                <li key={f} className="font-mono text-emerald-600">{f}</li>
              ))}
            </ul>
          </div>
          {deployResult.url && (
            <a href={deployResult.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-[#0060AF] hover:underline mt-1">
              <ExternalLink className="w-3.5 h-3.5" />
              View commit on GitLab
            </a>
          )}
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-emerald-200">
            <Rocket className="w-4 h-4 text-blue-700 shrink-0" />
            <p className="text-xs text-blue-700">CI/CD pipeline will auto-trigger to validate and deploy the DAG to your Airflow environment.</p>
          </div>
        </div>
      )}

      {deployError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-red-800">Commit failed</p>
              <p className="text-xs text-red-600 mt-0.5">{deployError}</p>
            </div>
          </div>
        </div>
      )}

      {/* Deploy button */}
      {!deployResult && (
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={deploying || !canDeploy}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeploy(); }}
            className="gap-1.5 bg-[#0060AF] hover:bg-[#004d8c] text-white"
          >
            {deploying ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Committing...</>
            ) : (
              <><Rocket className="w-4 h-4" /> Validate & Deploy</>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
