import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as archiverModule from 'archiver'
import cors from 'cors'
import express from 'express'
import { ZodError } from 'zod'
import { createLocatorRepairScenario } from '../src/data/agentScenario'
import { generateProject } from '../src/lib/generator'
import { parseRecording } from '../src/lib/recorder'
import { parseRecordingPayload, parseRunPayload } from './recordingSchema'
import { runRepairAgent } from './repairAgent'
import { runJourney, runsDirectory } from './runner'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const distDirectory = path.join(projectRoot, 'dist')
const port = Number(process.env.PORT ?? 8787)

type ZipArchiveInstance = {
  on: (event: 'error', listener: (error: Error) => void) => void
  pipe: (destination: NodeJS.WritableStream) => void
  append: (source: string | Buffer, data: { name: string }) => void
  finalize: () => Promise<void>
}

const ZipArchive = (
  archiverModule as unknown as {
    ZipArchive: new (options: { zlib: { level: number } }) => ZipArchiveInstance
  }
).ZipArchive

export const app = express()
app.disable('x-powered-by')
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        callback(null, true)
        return
      }
      callback(new Error('TestPilot only accepts requests from a local origin.'))
    },
  }),
)
app.use(express.json({ limit: '1mb' }))
app.use('/artifacts', express.static(runsDirectory, { dotfiles: 'deny', index: false }))

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ready', runner: 'playwright', version: 1 })
})

app.post('/api/export', async (request, response, next) => {
  try {
    const recording = parseRecordingPayload(request.body?.recording)
    const project = generateProject(recording)
    response.attachment(`${project.name}.zip`)
    response.type('application/zip')
    const archive = new ZipArchive({ zlib: { level: 9 } })
    archive.on('error', next)
    archive.pipe(response)
    project.files.forEach((file) => archive.append(file.content, { name: file.path }))
    await archive.finalize()
  } catch (error) {
    next(error)
  }
})

app.post('/api/runs', async (request, response, next) => {
  try {
    const payload = parseRunPayload(request.body)
    response.json(await runJourney(payload.recording, payload.secret, payload.options))
  } catch (error) {
    next(error)
  }
})

app.post('/api/agent/repair', async (request, response, next) => {
  try {
    const origin = typeof request.body?.origin === 'string'
      ? new URL(request.body.origin)
      : new URL('http://localhost:5173')
    if (!['localhost', '127.0.0.1'].includes(origin.hostname)) {
      response.status(400).json({ message: 'Agent Lab only runs against the local mutation target.' })
      return
    }
    const recording = parseRecording(createLocatorRepairScenario(origin.origin))
    response.json(await runRepairAgent(recording))
  } catch (error) {
    next(error)
  }
})

if (existsSync(distDirectory)) {
  app.use(express.static(distDirectory, { index: false }))
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path.startsWith('/api/')) {
      next()
      return
    }
    response.sendFile(path.join(distDirectory, 'index.html'))
  })
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    response.status(400).json({ message: error.issues[0]?.message ?? 'Invalid request payload.' })
    return
  }
  const message = error instanceof Error ? error.message : 'Unexpected server error.'
  console.error('[TestPilot API]', message)
  if (!response.headersSent) response.status(500).json({ message })
})

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, '127.0.0.1', () => {
    console.log(`TestPilot API ready at http://127.0.0.1:${port}`)
  })
}