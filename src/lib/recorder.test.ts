import { describe, expect, it } from 'vitest'
import { createSampleRecording } from '../data/sampleRecording'
import { parseRecording, RecorderParseError } from './recorder'

describe('parseRecording', () => {
  it('normalizes a Chrome Recorder journey and scores its locators', () => {
    const recording = parseRecording(createSampleRecording('http://127.0.0.1:4173'))

    expect(recording.title).toBe('Checkout clearance')
    expect(recording.executionMode).toBe('live')
    expect(recording.startUrl).toBe('http://127.0.0.1:4173/demo-store')
    expect(recording.steps).toHaveLength(8)
    expect(recording.unsupportedCount).toBe(0)
    expect(recording.averageLocatorScore).toBeGreaterThan(80)
    expect(recording.steps[2].locator).toMatchObject({ kind: 'role', role: 'button' })
  })

  it('redacts values entered into sensitive fields', () => {
    const recording = parseRecording(createSampleRecording())
    const passwordStep = recording.steps.find((step) => step.isSensitive)

    expect(passwordStep?.value).toBe('{{TESTPILOT_SECRET}}')
    expect(passwordStep?.detail).toBe('Protected environment value')
  })

  it('reports malformed input with a domain error', () => {
    expect(() => parseRecording({ title: 'Broken', steps: [] })).toThrow(RecorderParseError)
  })

  it('defaults imported Recorder JSON to deterministic demo mode', () => {
    const recording = parseRecording({
      title: 'Imported journey',
      steps: [{ type: 'navigate', url: 'https://example.test' }],
    })

    expect(recording.executionMode).toBe('demo')
  })

  it('prefers semantic text over a generated search-result ID', () => {
    const recording = parseRecording({
      title: 'Search result',
      steps: [
        {
          type: 'click',
          selectors: [
            [
              'aria/Urban Ladder Urban Ladder https://www.urbanladder.com',
              'aria/Urban Ladder',
            ],
            ['#_GIyFarCBIKKVseMPhPTmmA4_68'],
          ],
        },
      ],
    })

    expect(recording.steps[0].locator).toMatchObject({ kind: 'text', value: 'Urban Ladder' })
  })

  it('maps Recorder image roles to Playwright img roles', () => {
    const recording = parseRecording({
      title: 'Product image',
      steps: [
        {
          type: 'click',
          selectors: [
            ['aria/Yura Solid Wood And Cane Bar Trolley (Danish Walnut Finish)[role="image"]'],
          ],
        },
      ],
    })

    expect(recording.steps[0].locator).toMatchObject({ kind: 'role', role: 'img' })
  })
})