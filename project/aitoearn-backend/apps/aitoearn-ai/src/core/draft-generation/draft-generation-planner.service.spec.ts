import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DraftGenerationPlannerService } from './draft-generation-planner.service'

describe('draftGenerationPlannerService JSON parsing', () => {
  const service = Object.create(DraftGenerationPlannerService.prototype) as unknown as {
    parsePlannerJson: <T extends Record<string, unknown>>(text: string, schema: z.ZodType<T>) => T
    shouldUseTextJsonPlanner: (modelConfig: { name: string, channel: string }) => boolean
  }

  const schema = z.object({
    title: z.string(),
    topics: z.array(z.string()),
  })

  it('parses markdown fenced JSON responses', () => {
    const result = service.parsePlannerJson('```json\n{"title":"Draft","topics":["ai"]}\n```', schema)

    expect(result).toEqual({ title: 'Draft', topics: ['ai'] })
  })

  it('extracts JSON object from Claude-style prose', () => {
    const result = service.parsePlannerJson('Here is the JSON:\n{"title":"Draft","topics":["ai"]}\nThanks.', schema)

    expect(result).toEqual({ title: 'Draft', topics: ['ai'] })
  })

  it('uses text JSON planner for Claude over OpenAI-compatible channel', () => {
    expect(service.shouldUseTextJsonPlanner({ name: 'claude-opus-4-6', channel: 'openai' })).toBe(true)
    expect(service.shouldUseTextJsonPlanner({ name: 'gpt-5.5', channel: 'openai' })).toBe(false)
  })
})
