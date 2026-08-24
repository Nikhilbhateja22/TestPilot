import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSampleRecording } from '../src/data/sampleRecording'
import { parseRecording } from '../src/lib/recorder'
import { app } from './index'
import { calculateDemoDuration } from './runner'

describe('TestPilot API', () => {
  let server: Server
  let origin: string

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address() as AddressInfo
    origin = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })

  it('reports runner readiness', async () => {
    const response = await fetch(`${origin}/api/health`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'ready', runner: 'playwright' })
  })

  it('streams a generated project archive', async () => {
    const recording = parseRecording(createSampleRecording('http://127.0.0.1:5173'))
    const response = await fetch(`${origin}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recording }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/zip')
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(500)
  })

  it('rejects unsafe navigation protocols', async () => {
    const recording = parseRecording(createSampleRecording())
    recording.steps[1].url = 'file:///C:/private.txt'
    const response = await fetch(`${origin}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recording }),
    })

    expect(response.status).toBe(400)
  })

  it('runs marked demo recordings deterministically with step output', async () => {
    const recording = parseRecording({
      ...createSampleRecording('https://example.test'),
      executionMode: 'demo',
    })
    const response = await fetch(`${origin}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recording,
        secret: '',
        options: { trace: false, screenshot: false, video: false },
      }),
    })
    const result = await response.json() as {
      status: string
      executionMode: string
      completedSteps: number
      totalSteps: number
      output: string
    }

    expect(response.status).toBe(200)
    expect(result).toMatchObject({
      status: 'passed',
      executionMode: 'demo',
      completedSteps: recording.steps.length,
      totalSteps: recording.steps.length,
    })
    expect(result.output).toContain('TESTPILOT DEMO SIMULATION')
    expect(result.output).toContain('[RUN ] Step 01/08 - Configuring browser viewport 1440 x 900...')
    expect(result.output).toContain('[PASS] Step 01/08 - Configured browser viewport 1440 x 900')
    expect(result.output).toContain('[PASS] Step 03/08 - Clicked Add Trail Camera to cart')
    expect(result.output).toContain('RESULT: PASSED (8/8 steps in')
  })

  it('scales portfolio timing with complexity and caps it below one minute', () => {
    const smallJourney = calculateDemoDuration(5, 100)
    const mediumJourney = calculateDemoDuration(15, 300)
    const largeJourney = calculateDemoDuration(50, 1_000)

    expect(smallJourney).toBeLessThan(mediumJourney)
    expect(mediumJourney).toBeLessThan(55_000)
    expect(largeJourney).toBe(55_000)
  })

  it('rejects non-local Agent Lab targets', async () => {
    const response = await fetch(`${origin}/api/agent/repair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin: 'https://example.com' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      message: 'Agent Lab only runs against the local mutation target.',
    })
  })
})