import { z } from 'zod'
import type { GenerationOptions } from '../src/lib/generator'
import type { ParsedRecording } from '../src/lib/recorder'

const locatorSchema = z.object({
  kind: z.enum(['role', 'label', 'text', 'test-id', 'css', 'xpath', 'none']),
  raw: z.string().max(4096),
  value: z.string().max(4096),
  role: z.string().max(80).optional(),
  score: z.number().int().min(0).max(100),
})

const normalizedStepSchema = z.object({
  id: z.string().min(1).max(80),
  index: z.number().int().min(0).max(999),
  sourceType: z.string().min(1).max(80),
  kind: z.enum(['navigate', 'click', 'fill', 'press', 'assert', 'scroll', 'viewport', 'unsupported']),
  title: z.string().min(1).max(240),
  detail: z.string().max(4096),
  supported: z.boolean(),
  locator: locatorSchema,
  alternatives: z.array(locatorSchema).max(20),
  value: z.string().max(4096).optional(),
  isSensitive: z.boolean(),
  url: z.string().max(4096).optional(),
  key: z.string().max(80).optional(),
  coordinates: z.object({ x: z.number().finite(), y: z.number().finite() }).optional(),
  viewport: z
    .object({
      width: z.number().int().min(320).max(7680),
      height: z.number().int().min(240).max(4320),
    })
    .optional(),
})

const parsedRecordingSchema = z
  .object({
    title: z.string().min(1).max(160),
    executionMode: z.enum(['live', 'demo']).default('demo'),
    startUrl: z.string().max(4096),
    hostname: z.string().max(255),
    steps: z.array(normalizedStepSchema).min(1).max(100),
    supportedCount: z.number().int().nonnegative(),
    unsupportedCount: z.number().int().nonnegative(),
    averageLocatorScore: z.number().int().min(0).max(100),
  })
  .superRefine((recording, context) => {
    recording.steps.forEach((step, index) => {
      if (step.kind !== 'navigate') return
      try {
        const url = new URL(step.url ?? '')
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol')
      } catch {
        context.addIssue({
          code: 'custom',
          path: ['steps', index, 'url'],
          message: 'Navigation steps must use an HTTP or HTTPS URL.',
        })
      }
    })
  })

const generationOptionsSchema = z.object({
  trace: z.boolean(),
  screenshot: z.boolean(),
  video: z.boolean(),
  testTimeoutMs: z.number().int().min(1_000).max(300_000).optional(),
  expectTimeoutMs: z.number().int().min(1_000).max(300_000).optional(),
  actionTimeoutMs: z.number().int().min(1_000).max(300_000).optional(),
  navigationTimeoutMs: z.number().int().min(1_000).max(300_000).optional(),
})

const runPayloadSchema = z.object({
  recording: parsedRecordingSchema,
  secret: z.string().max(512).default(''),
  options: generationOptionsSchema,
})

export const parseRecordingPayload = (input: unknown): ParsedRecording => {
  const parsed = parsedRecordingSchema.parse(input)
  const supportedCount = parsed.steps.filter((step) => step.supported).length
  const scores = parsed.steps.map((step) => step.locator.score).filter((score) => score > 0)

  return {
    ...parsed,
    supportedCount,
    unsupportedCount: parsed.steps.length - supportedCount,
    averageLocatorScore: scores.length
      ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length)
      : 0,
  } as ParsedRecording
}

export const parseRunPayload = (
  input: unknown,
): { recording: ParsedRecording; secret: string; options: GenerationOptions } => {
  const parsed = runPayloadSchema.parse(input)
  return {
    recording: parseRecordingPayload(parsed.recording),
    secret: parsed.secret,
    options: parsed.options,
  }
}