import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, DragEvent } from 'react'
import {
  Activity,
  Braces,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CloudUpload,
  Code2,
  Copy,
  Download,
  Eye,
  FileCode2,
  FileJson2,
  Gauge,
  Import,
  Keyboard,
  LayoutDashboard,
  LoaderCircle,
  LocateFixed,
  Moon,
  MousePointer2,
  Navigation,
  PanelLeft,
  Play,
  Radar,
  RefreshCcw,
  ScrollText,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  TerminalSquare,
  TestTube2,
  WandSparkles,
  UploadCloud,
  X,
} from 'lucide-react'
import { DemoStore } from './components/DemoStore'
import { createSampleRecording } from './data/sampleRecording'
import { generateProject } from './lib/generator'
import type { GeneratedFile } from './lib/generator'
import { parseRecording, RecorderParseError } from './lib/recorder'
import type { LocatorCandidate, NormalizedStep, ParsedRecording, StepKind } from './lib/recorder'
import './Studio.css'

type WorkspaceView = 'blueprint' | 'code' | 'runs' | 'agent'
type Theme = 'light' | 'dark'
type RunnerState = 'idle' | 'running' | 'passed' | 'failed'

type RunResult = {
  id: string
  status: 'passed' | 'failed'
  executionMode: 'live' | 'demo'
  durationMs: number
  completedSteps: number
  totalSteps: number
  output: string
  error?: string
  artifacts: { name: string; url: string; type: string }[]
}

type AgentRunResult = {
  status: 'recovered' | 'failed' | 'passed'
  recovered: boolean
  attempts: {
    number: number
    status: 'passed' | 'failed'
    durationMs: number
    completedSteps: number
    totalSteps: number
    evidence: string
    runId: string
  }[]
  diagnosis?: {
    category: 'locator-drift'
    rootCause: string
    failedStepTitle: string
    confidence: number
    decision: 'repair-and-retry'
  }
  patch?: {
    before: LocatorCandidate
    after: LocatorCandidate
    rationale: string
  }
  finalRun: RunResult
}

const stepIcons: Record<StepKind, typeof Navigation> = {
  navigate: Navigation,
  click: MousePointer2,
  fill: Keyboard,
  press: TerminalSquare,
  assert: Eye,
  scroll: ScrollText,
  viewport: PanelLeft,
  unsupported: CircleAlert,
}

const viewItems: { id: WorkspaceView; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'blueprint', label: 'Blueprint', icon: LayoutDashboard },
  { id: 'code', label: 'Generated code', icon: Code2 },
  { id: 'runs', label: 'Test runs', icon: Activity },
  { id: 'agent', label: 'Agent Lab', icon: WandSparkles },
]

const formatDuration = (durationMs: number): string =>
  durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(1)} s`

const recalculateLocatorScore = (steps: NormalizedStep[]): number => {
  const scores = steps.map((step) => step.locator.score).filter((score) => score > 0)
  return scores.length
    ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length)
    : 0
}

function App() {
  if (window.location.pathname === '/demo-store') return <DemoStore />
  return <TestPilotStudio />
}

function TestPilotStudio() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const initialRecording = parseRecording(createSampleRecording(window.location.origin))
  const [recording, setRecording] = useState<ParsedRecording>(initialRecording)
  const [activeStepId, setActiveStepId] = useState(initialRecording.steps[2]?.id ?? initialRecording.steps[0].id)
  const [view, setView] = useState<WorkspaceView>('blueprint')
  const [activeFilePath, setActiveFilePath] = useState('tests/checkout-clearance.spec.ts')
  const [theme, setTheme] = useState<Theme>(() =>
    window.localStorage.getItem('testpilot-theme') === 'dark' ? 'dark' : 'light',
  )
  const [isDragging, setIsDragging] = useState(false)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [runnerOnline, setRunnerOnline] = useState(false)
  const [runnerState, setRunnerState] = useState<RunnerState>('idle')
  const [runResult, setRunResult] = useState<RunResult | null>(null)
  const [agentState, setAgentState] = useState<'idle' | 'running' | 'complete' | 'failed'>('idle')
  const [agentResult, setAgentResult] = useState<AgentRunResult | null>(null)
  const [secret, setSecret] = useState('portfolio-demo')
  const [runOptions, setRunOptions] = useState({ trace: true, screenshot: true, video: false })

  const project = generateProject(recording)
  const activeStep = recording.steps.find((step) => step.id === activeStepId) ?? recording.steps[0]
  const activeFile = project.files.find((file) => file.path === activeFilePath) ?? project.files[0]
  const filteredSteps = recording.steps.filter((step) =>
    `${step.title} ${step.detail}`.toLowerCase().includes(query.toLowerCase()),
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('testpilot-theme', theme)
  }, [theme])

  useEffect(() => {
    let cancelled = false
    const checkRunner = async () => {
      try {
        const response = await fetch('/api/health', { cache: 'no-store' })
        if (!cancelled) setRunnerOnline(response.ok)
      } catch {
        if (!cancelled) setRunnerOnline(false)
      }
    }
    void checkRunner()
    const interval = window.setInterval(() => void checkRunner(), 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  const loadRecording = (input: unknown) => {
    try {
      const parsed = parseRecording(input)
      const generated = generateProject(parsed)
      setRecording(parsed)
      setActiveStepId(parsed.steps[0].id)
      setActiveFilePath(generated.files[0].path)
      setRunResult(null)
      setRunnerState('idle')
      setView('blueprint')
      setNotice(null)
    } catch (error) {
      setNotice(error instanceof RecorderParseError ? error.message : 'TestPilot could not read this recording.')
    }
  }

  const importFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.json')) {
      setNotice('Choose a Chrome Recorder JSON file.')
      return
    }
    try {
      loadRecording(JSON.parse(await file.text()) as unknown)
    } catch {
      setNotice('The selected file is not valid JSON.')
    }
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) void importFile(file)
    event.target.value = ''
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) void importFile(file)
  }

  const chooseLocator = (candidate: LocatorCandidate) => {
    setRecording((current) => {
      const steps = current.steps.map((step) =>
        step.id === activeStep.id ? { ...step, locator: candidate } : step,
      )
      return { ...current, steps, averageLocatorScore: recalculateLocatorScore(steps) }
    })
  }

  const updateValue = (value: string) => {
    setRecording((current) => ({
      ...current,
      steps: current.steps.map((step) =>
        step.id === activeStep.id ? { ...step, value, detail: value || 'Empty value' } : step,
      ),
    }))
  }

  const copyActiveFile = async () => {
    await navigator.clipboard.writeText(activeFile.content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const downloadProject = async () => {
    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recording }),
      })
      if (!response.ok) throw new Error('Export failed')
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `${project.name}.zip`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      setNotice('The local export service is offline. Start TestPilot with npm run dev.')
    }
  }

  const runJourney = async () => {
    setView('runs')
    setRunnerState('running')
    setRunResult(null)
    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recording, secret, options: runOptions }),
      })
      const result = (await response.json()) as RunResult & { message?: string }
      if (!response.ok) throw new Error(result.message ?? 'The runner could not start.')
      setRunnerOnline(true)
      setRunResult(result)
      setRunnerState(result.status)
    } catch (error) {
      setRunnerOnline(false)
      setRunnerState('failed')
      setRunResult({
        id: 'offline',
        status: 'failed',
        executionMode: recording.executionMode,
        durationMs: 0,
        completedSteps: 0,
        totalSteps: recording.steps.length,
        output: '',
        error: error instanceof Error ? error.message : 'The local runner is unavailable.',
        artifacts: [],
      })
    }
  }

  const runAgentLab = async () => {
    setView('agent')
    setAgentState('running')
    setAgentResult(null)
    try {
      const response = await fetch('/api/agent/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: window.location.origin }),
      })
      const result = (await response.json()) as AgentRunResult & { message?: string }
      if (!response.ok) throw new Error(result.message ?? 'Agent Lab could not start.')
      setRunnerOnline(true)
      setAgentResult(result)
      setAgentState(result.status === 'failed' ? 'failed' : 'complete')
    } catch (error) {
      setRunnerOnline(false)
      setAgentState('failed')
      setNotice(error instanceof Error ? error.message : 'Agent Lab is unavailable.')
    }
  }

  return (
    <div className="app-shell" onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      <input ref={fileInputRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={handleFileChange} />

      <aside className="app-rail" aria-label="Primary navigation">
        <button className="brand-mark" type="button" title="TestPilot home" aria-label="TestPilot home"><Radar aria-hidden="true" /></button>
        <nav className="rail-nav">
          {viewItems.map((item) => {
            const Icon = item.icon
            return <button key={item.id} type="button" className={view === item.id ? 'rail-button is-active' : 'rail-button'} onClick={() => setView(item.id)} title={item.label} aria-label={item.label}><Icon aria-hidden="true" /></button>
          })}
        </nav>
        <div className="rail-footer">
          <button className="rail-button" type="button" onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')} title={`Use ${theme === 'light' ? 'dark' : 'light'} theme`} aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} theme`}>
            {theme === 'light' ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
          </button>
          <span className="profile-chip" title="Local workspace">NB</span>
        </div>
      </aside>

      <main className="studio-shell">
        <header className="topbar">
          <div className="product-lockup"><span className="product-name">TESTPILOT</span><span className="product-edition">STUDIO / 01</span></div>
          <div className="view-switcher" aria-label="Workspace view">
            {viewItems.map((item) => <button key={item.id} type="button" className={view === item.id ? 'view-tab is-active' : 'view-tab'} onClick={() => setView(item.id)}>{item.label}</button>)}
          </div>
          <div className="topbar-actions">
            <span className={runnerOnline ? 'runner-state is-online' : 'runner-state'}><span className="status-pulse" />{runnerOnline ? 'Runner online' : 'Runner offline'}</span>
            <button className="icon-button" type="button" onClick={() => fileInputRef.current?.click()} title="Import Recorder JSON" aria-label="Import Recorder JSON"><Import aria-hidden="true" /></button>
            <button className="run-button" type="button" onClick={() => void runJourney()} disabled={runnerState === 'running'}>{runnerState === 'running' ? <LoaderCircle className="spin" aria-hidden="true" /> : <Play fill="currentColor" aria-hidden="true" />}{recording.executionMode === 'demo' ? 'Run demo' : 'Run journey'}</button>
          </div>
        </header>

        {notice && <div className="notice-bar" role="alert"><CircleAlert aria-hidden="true" /><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message"><X aria-hidden="true" /></button></div>}

        <section className="mission-header">
          <div className="mission-title">
            <div className="eyebrow"><span>FLIGHT PLAN</span><b>TP–001</b></div>
            <h1>{recording.title}</h1>
            <div className="mission-meta"><span><LocateFixed aria-hidden="true" /> {recording.hostname}</span><span><FileJson2 aria-hidden="true" /> Chrome Recorder</span><span><ShieldCheck aria-hidden="true" /> Secrets protected</span>{recording.executionMode === 'demo' && <span><Sparkles aria-hidden="true" /> Demo simulation</span>}</div>
          </div>
          <div className="telemetry-strip">
            <Telemetry label="Commands" value={String(recording.steps.length).padStart(2, '0')} detail="normalized" />
            <Telemetry label="Coverage" value={`${Math.round((recording.supportedCount / recording.steps.length) * 100)}%`} detail="commands ready" />
            <Telemetry label="Locator signal" value={`${recording.averageLocatorScore}`} detail="quality score" accent />
            <Telemetry label="Generated" value={`${project.lineCount}`} detail="lines of code" />
          </div>
        </section>

        {view === 'blueprint' && <BlueprintView recording={recording} activeStep={activeStep} filteredSteps={filteredSteps} query={query} secret={secret} runOptions={runOptions} onQueryChange={setQuery} onStepSelect={setActiveStepId} onLocatorSelect={chooseLocator} onValueChange={updateValue} onSecretChange={setSecret} onRunOptionsChange={setRunOptions} onImport={() => fileInputRef.current?.click()} onReset={() => loadRecording(createSampleRecording(window.location.origin))} />}
        {view === 'code' && <CodeView files={project.files} activeFile={activeFile} copied={copied} onFileSelect={setActiveFilePath} onCopy={() => void copyActiveFile()} onDownload={() => void downloadProject()} />}
        {view === 'runs' && <RunsView state={runnerState} result={runResult} stepCount={recording.steps.length} executionMode={recording.executionMode} runnerOnline={runnerOnline} onRun={() => void runJourney()} />}
        {view === 'agent' && <AgentLab state={agentState} result={agentResult} onRun={() => void runAgentLab()} />}
      </main>

      {isDragging && <div className="drop-overlay" onDragLeave={() => setIsDragging(false)}><div className="drop-target"><UploadCloud aria-hidden="true" /><strong>Release recording</strong><span>JSON payload detected</span></div></div>}
    </div>
  )
}

function Telemetry({ label, value, detail, accent = false }: { label: string; value: string; detail: string; accent?: boolean }) {
  return <div className={accent ? 'telemetry-item is-accent' : 'telemetry-item'}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
}

function BlueprintView({ recording, activeStep, filteredSteps, query, secret, runOptions, onQueryChange, onStepSelect, onLocatorSelect, onValueChange, onSecretChange, onRunOptionsChange, onImport, onReset }: {
  recording: ParsedRecording
  activeStep: NormalizedStep
  filteredSteps: NormalizedStep[]
  query: string
  secret: string
  runOptions: { trace: boolean; screenshot: boolean; video: boolean }
  onQueryChange: (value: string) => void
  onStepSelect: (id: string) => void
  onLocatorSelect: (candidate: LocatorCandidate) => void
  onValueChange: (value: string) => void
  onSecretChange: (value: string) => void
  onRunOptionsChange: (value: { trace: boolean; screenshot: boolean; video: boolean }) => void
  onImport: () => void
  onReset: () => void
}) {
  const ActiveIcon = stepIcons[activeStep.kind]
  return (
    <section className="workspace-grid blueprint-view">
      <aside className="step-browser">
        <div className="panel-heading"><div><span>JOURNEY</span><strong>{recording.steps.length} commands</strong></div><button type="button" className="tiny-button" onClick={onReset} title="Reload sample" aria-label="Reload sample"><RefreshCcw aria-hidden="true" /></button></div>
        <label className="search-field"><Search aria-hidden="true" /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Filter commands" /><kbd>⌘K</kbd></label>
        <div className="step-list">
          {filteredSteps.map((step) => {
            const Icon = stepIcons[step.kind]
            return <button key={step.id} type="button" className={activeStep.id === step.id ? 'step-list-item is-active' : 'step-list-item'} onClick={() => onStepSelect(step.id)}><span className="step-list-index">{String(step.index + 1).padStart(2, '0')}</span><span className={`step-icon kind-${step.kind}`}><Icon aria-hidden="true" /></span><span className="step-list-copy"><strong>{step.title}</strong><small>{step.detail}</small></span><ChevronRight aria-hidden="true" /></button>
          })}
        </div>
        <button className="import-zone" type="button" onClick={onImport}><CloudUpload aria-hidden="true" /><span><strong>Import another journey</strong><small>Chrome Recorder JSON</small></span></button>
      </aside>

      <section className="sequence-board">
        <div className="panel-heading board-heading"><div><span>EXECUTION MAP</span><strong>Sequential playback</strong></div><div className="signal-legend"><i /><span>Ready for generation</span></div></div>
        <div className="sequence-scroll">
          <div className="runway-axis" aria-hidden="true"><span>START</span><i /><span>ASSERT</span></div>
          <div className="sequence-list">
            {recording.steps.map((step, position) => {
              const Icon = stepIcons[step.kind]
              const delayStyle = { '--reveal-delay': `${position * 36}ms` } as CSSProperties
              return <button key={step.id} type="button" style={delayStyle} className={activeStep.id === step.id ? 'sequence-step is-active' : 'sequence-step'} onClick={() => onStepSelect(step.id)}><span className="sequence-number">{String(step.index + 1).padStart(2, '0')}</span><span className="sequence-node"><Icon aria-hidden="true" /></span><span className="sequence-copy"><strong>{step.title}</strong><small>{step.detail}</small></span><span className={`quality-pill quality-${step.locator.score >= 90 ? 'high' : step.locator.score >= 60 ? 'medium' : 'low'}`}>{step.locator.kind === 'none' ? step.kind : step.locator.kind}</span>{step.supported ? <Check className="step-ready" aria-label="Ready" /> : <CircleAlert className="step-warning" aria-label="Needs review" />}</button>
            })}
          </div>
        </div>
      </section>

      <aside className="inspector-panel">
        <div className="panel-heading"><div><span>INSPECTOR</span><strong>Command {String(activeStep.index + 1).padStart(2, '0')}</strong></div><Settings2 aria-hidden="true" /></div>
        <div className="inspector-scroll">
          <section className="inspector-section step-summary"><span className={`step-icon kind-${activeStep.kind}`}><ActiveIcon aria-hidden="true" /></span><div><span>{activeStep.kind.toUpperCase()}</span><h2>{activeStep.title}</h2></div></section>
          {activeStep.locator.kind !== 'none' && <section className="inspector-section"><div className="section-label"><span>Locator signal</span><b>{activeStep.locator.score}/100</b></div><div className="signal-meter"><i style={{ width: `${activeStep.locator.score}%` }} /></div><code className="locator-code">{activeStep.locator.raw}</code>{activeStep.alternatives.length > 1 && <div className="locator-options">{activeStep.alternatives.map((candidate) => <button key={candidate.raw} type="button" className={candidate.raw === activeStep.locator.raw ? 'locator-option is-active' : 'locator-option'} onClick={() => onLocatorSelect(candidate)}><span>{candidate.kind}</span><code>{candidate.raw}</code><b>{candidate.score}</b></button>)}</div>}</section>}
          {activeStep.kind === 'fill' && <section className="inspector-section"><label className="field-label" htmlFor="step-value">Input value</label>{activeStep.isSensitive ? <div className="protected-field"><ShieldCheck aria-hidden="true" /><span>Mapped to TESTPILOT_SECRET</span></div> : <input id="step-value" className="text-field" value={activeStep.value ?? ''} onChange={(event) => onValueChange(event.target.value)} />}</section>}
          <section className="inspector-section">
            <div className="section-label"><span>Run profile</span><b>LOCAL</b></div>
            <label className="field-label" htmlFor="secret-value">Protected test value</label>
            <input id="secret-value" className="text-field" type="password" value={secret} onChange={(event) => onSecretChange(event.target.value)} />
            <div className="toggle-stack">{([['trace', 'Capture trace'], ['screenshot', 'Failure screenshot'], ['video', 'Record video']] as const).map(([key, label]) => <label className="toggle-row" key={key}><span>{label}</span><input type="checkbox" checked={runOptions[key]} onChange={(event) => onRunOptionsChange({ ...runOptions, [key]: event.target.checked })} /><i aria-hidden="true" /></label>)}</div>
          </section>
        </div>
      </aside>
    </section>
  )
}

function CodeView({ files, activeFile, copied, onFileSelect, onCopy, onDownload }: { files: GeneratedFile[]; activeFile: GeneratedFile; copied: boolean; onFileSelect: (path: string) => void; onCopy: () => void; onDownload: () => void }) {
  return (
    <section className="code-workspace">
      <aside className="file-browser"><div className="panel-heading"><div><span>PROJECT</span><strong>Generated files</strong></div><Braces aria-hidden="true" /></div><div className="file-tree">{files.map((file) => <button key={file.path} type="button" className={file.path === activeFile.path ? 'file-row is-active' : 'file-row'} onClick={() => onFileSelect(file.path)}>{file.language === 'typescript' ? <FileCode2 aria-hidden="true" /> : <FileJson2 aria-hidden="true" />}<span>{file.path}</span></button>)}</div><div className="generation-note"><Sparkles aria-hidden="true" /><span><strong>Deterministic build</strong><small>No model-generated selectors</small></span></div></aside>
      <section className="code-panel"><div className="code-toolbar"><div><span className="file-dot" /><strong>{activeFile.path}</strong><small>{activeFile.content.split('\n').length} lines</small></div><div><button className="icon-button" type="button" onClick={onCopy} title="Copy file" aria-label="Copy file">{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</button><button className="download-button" type="button" onClick={onDownload}><Download aria-hidden="true" /> Export project</button></div></div><div className="code-scroll">{activeFile.content.split('\n').map((line, index) => <div className="code-line" key={`${index}-${line}`}><span>{String(index + 1).padStart(2, '0')}</span><code>{line || ' '}</code></div>)}</div></section>
    </section>
  )
}

function RunsView({ state, result, stepCount, executionMode, runnerOnline, onRun }: { state: RunnerState; result: RunResult | null; stepCount: number; executionMode: 'live' | 'demo'; runnerOnline: boolean; onRun: () => void }) {
  const isDemo = executionMode === 'demo'
  return (
    <section className="runs-workspace">
      <div className={`run-radar state-${state}`}><div className="radar-grid"><i /><i /><i /><span /></div><div className="radar-core">{state === 'running' ? <LoaderCircle className="spin" aria-hidden="true" /> : state === 'passed' ? <CheckCircle2 aria-hidden="true" /> : state === 'failed' ? <CircleAlert aria-hidden="true" /> : <TestTube2 aria-hidden="true" />}</div></div>
      <div className="run-primary"><span className="run-kicker">{isDemo ? 'DEMO SIMULATION' : 'LOCAL EXECUTION'}</span><h2>{state === 'running' ? 'Journey in flight' : state === 'passed' ? 'All checks cleared' : state === 'failed' ? 'Journey interrupted' : 'Ready on runway'}</h2><p>{state === 'running' ? (isDemo ? 'TestPilot is replaying the normalized steps without external browser calls.' : 'Chromium is replaying the normalized command sequence.') : result?.error ?? `${stepCount} commands ready for ${isDemo ? 'deterministic simulation' : 'Chromium'}.`}</p>{state !== 'running' && <button className="run-button large" type="button" onClick={onRun}><Play fill="currentColor" aria-hidden="true" /> {result ? 'Run again' : isDemo ? 'Start demo' : 'Start test run'}</button>}</div>
      <div className="run-telemetry"><div><span>Status</span><strong className={`status-${state}`}>{state.toUpperCase()}</strong></div><div><span>Mode</span><strong>{isDemo ? 'DEMO' : runnerOnline ? 'LIVE' : 'OFFLINE'}</strong></div><div><span>Duration</span><strong>{result ? formatDuration(result.durationMs) : '—'}</strong></div><div><span>Steps</span><strong>{result ? `${result.completedSteps}/${result.totalSteps}` : `0/${stepCount}`}</strong></div></div>
      {result && <section className="run-output"><div className="panel-heading"><div><span>CONSOLE</span><strong>Execution output</strong></div><TerminalSquare aria-hidden="true" /></div><pre>{result.output || result.error || 'No console output was returned.'}</pre>{result.artifacts.length > 0 && <div className="artifact-row">{result.artifacts.map((artifact) => <a key={artifact.url} href={artifact.url} target="_blank" rel="noreferrer"><Gauge aria-hidden="true" />{artifact.name}</a>)}</div>}</section>}
    </section>
  )
}

function AgentLab({ state, result, onRun }: { state: 'idle' | 'running' | 'complete' | 'failed'; result: AgentRunResult | null; onRun: () => void }) {
  const recovered = result?.status === 'recovered'
  return (
    <section className="agent-workspace">
      <header className="agent-header">
        <div>
          <span className="run-kicker">BOUNDED REPAIR AGENT</span>
          <h2>{recovered ? 'Failure recovered' : state === 'running' ? 'Agent investigating' : state === 'failed' ? 'Repair stopped safely' : 'Locator Mutation Lab'}</h2>
          <p>A controlled UI mutation breaks the recorded role locator. The agent runs Playwright, gathers evidence, selects a recorded fallback, patches the locator, and verifies one retry.</p>
        </div>
        <button className="run-button large" type="button" onClick={onRun} disabled={state === 'running'}>
          {state === 'running' ? <LoaderCircle className="spin" aria-hidden="true" /> : <WandSparkles aria-hidden="true" />}
          {state === 'running' ? 'Agent running' : result ? 'Run lab again' : 'Start Agent Lab'}
        </button>
      </header>

      <div className="agent-policy">
        <span><ShieldCheck aria-hidden="true" /><b>Mutation</b> Locator drift only</span>
        <span><RefreshCcw aria-hidden="true" /><b>Retry budget</b> Maximum 1</span>
        <span><LocateFixed aria-hidden="true" /><b>Target</b> Local sandbox only</span>
        <span><Braces aria-hidden="true" /><b>Patch scope</b> Recorded locators</span>
      </div>

      {!result && state !== 'running' && (
        <div className="agent-empty">
          <div className="mutation-preview"><code>getByRole('button', {'{'} name: 'Add Trail Camera to cart' {'}'})</code><span>UI mutation changes the accessible name</span></div>
          <ChevronRight aria-hidden="true" />
          <div className="mutation-preview is-fallback"><code>getByTestId('add-camera')</code><span>Recorded fallback remains available</span></div>
        </div>
      )}

      {state === 'running' && (
        <div className="agent-running"><div className="agent-orbit"><WandSparkles aria-hidden="true" /></div><strong>Executing the failure-repair loop</strong><span>Attempt 1 → evidence → patch → attempt 2</span></div>
      )}

      {result && (
        <div className="agent-results">
          <section className="attempt-timeline">
            <div className="panel-heading"><div><span>ATTEMPTS</span><strong>Execution timeline</strong></div><Activity aria-hidden="true" /></div>
            {result.attempts.map((attempt) => (
              <article className={`attempt-row is-${attempt.status}`} key={attempt.number}>
                <span className="attempt-number">0{attempt.number}</span>
                <span className="attempt-status">{attempt.status === 'passed' ? <CheckCircle2 aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}</span>
                <div><strong>{attempt.status === 'passed' ? 'Verification passed' : 'Initial execution failed'}</strong><small>{attempt.evidence}</small></div>
                <div className="attempt-metric"><b>{formatDuration(attempt.durationMs)}</b><span>{attempt.completedSteps}/{attempt.totalSteps} steps</span></div>
              </article>
            ))}
          </section>

          <section className="agent-diagnosis">
            <div className="panel-heading"><div><span>DIAGNOSIS</span><strong>Evidence-backed decision</strong></div><Sparkles aria-hidden="true" /></div>
            {result.diagnosis ? <div className="diagnosis-body"><div className="confidence-ring"><strong>{Math.round(result.diagnosis.confidence * 100)}%</strong><span>confidence</span></div><div><span className="diagnosis-tag">{result.diagnosis.category}</span><h3>{result.diagnosis.failedStepTitle}</h3><p>{result.diagnosis.rootCause}</p><b>{result.diagnosis.decision}</b></div></div> : <div className="diagnosis-body"><p>No repair was required.</p></div>}
          </section>

          {result.patch && (
            <section className="agent-patch">
              <div className="panel-heading"><div><span>PATCH</span><strong>Approved repair boundary</strong></div><Code2 aria-hidden="true" /></div>
              <div className="diff-block"><div className="diff-line is-removed"><span>−</span><code>{result.patch.before.raw}</code></div><div className="diff-line is-added"><span>+</span><code>{result.patch.after.raw}</code></div></div>
              <p>{result.patch.rationale}</p>
            </section>
          )}
        </div>
      )}
    </section>
  )
}

export default App
