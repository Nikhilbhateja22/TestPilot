import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runJourney } from '../server/runner'
import { parseRecording } from '../src/lib/recorder'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const fixturePath = path.join(projectRoot, 'examples', 'urban-ladder-cart-recording.json')
const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as unknown
const recording = parseRecording(fixture)

if (recording.executionMode !== 'demo') {
  throw new Error('The portfolio fixture must explicitly use demo execution mode.')
}

const result = await runJourney(recording, '', {
  trace: false,
  screenshot: false,
  video: false,
})

if (result.status !== 'passed') process.exitCode = 1