import { z } from 'zod'

export const modelMessageSchema = z.object({
  role: z.string().default('assistant'),
  content: z.string().nullish(),
  refusal: z.string().nullish(),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        function: z.object({ name: z.string(), arguments: z.string() })
      })
    )
    .optional(),
  tool_call_id: z.string().optional()
})

export type ModelMessage = z.infer<typeof modelMessageSchema>

export const modelResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullish(),
        message: modelMessageSchema.optional()
      })
    )
    .optional()
})

export const researchResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().nullish(),
        url: z.string().url(),
        highlights: z.array(z.string()).nullish()
      })
    )
    .optional()
})
