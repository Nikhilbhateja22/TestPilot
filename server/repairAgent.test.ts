import { describe, expect, it, vi } from 'vitest'
import { createSampleRecording } from '../src/data/sampleRecording'
import { parseRecording } from '../src/lib/recorder'
import type { JourneyRunResult } from './runner'
import { runRepairAgent } from './repairAgent'

const runResult = (status: 'passed' | 'failed', output: string): JourneyRunResult => ({
  id: status === 'passed' ? 'pass-run' : 'fail-run',
  status,
  executionMode: 'live',
  durationMs: 100,
  completedSteps: status === 'passed' ? 8 : 2,
  totalSteps: 8,
  output,
  artifacts: [],
})

describe('runRepairAgent', () => {
  it('repairs a failed locator from recorded evidence and retries once', async () => {
    const recording = parseRecording(createSampleRecording('http://localhost:5173'))
    const failedStep = recording.steps[2]
    const execute = vi
      .fn()
      .mockResolvedValueOnce(
        runResult('failed', `TimeoutError: locator.click timed out\n › ${failedStep.title}\n waiting for getByRole`),
      )
      .mockResolvedValueOnce(runResult('passed', '1 passed'))

    const result = await runRepairAgent(recording, '', execute)

    expect(result.status).toBe('recovered')
    expect(result.attempts).toHaveLength(2)
    expect(result.diagnosis).toMatchObject({
      category: 'locator-drift',
      failedStepId: failedStep.id,
      decision: 'repair-and-retry',
    })
    expect(result.patch?.before.kind).toBe('role')
    expect(result.patch?.after).toMatchObject({ kind: 'test-id', value: 'add-camera' })
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls[1][0].steps[2].locator).toMatchObject({
      kind: 'test-id',
      value: 'add-camera',
    })
  })

  it('stops after one attempt when no safe fallback exists', async () => {
    const recording = parseRecording({
      title: 'No fallback',
      executionMode: 'live',
      steps: [
        { type: 'navigate', url: 'https://example.test' },
        { type: 'click', selectors: [['#only-selector']] },
      ],
    })
    const failedStep = recording.steps[1]
    const execute = vi.fn().mockResolvedValue(
      runResult('failed', `TimeoutError\n › ${failedStep.title}\n waiting for locator`),
    )

    const result = await runRepairAgent(recording, '', execute)

    expect(result.status).toBe('failed')
    expect(result.attempts).toHaveLength(1)
    expect(result.patch).toBeUndefined()
    expect(execute).toHaveBeenCalledTimes(1)
  })
})