import type { AiPrediction } from '@overflowgo/shared';
import { z } from 'zod';
import { AiServiceUnavailableError } from '../errors';

const DetectionSchema = z.object({
  class: z.string(),
  conf: z.number(),
  box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});

const PredictionSchema = z.object({
  overflow_conf: z.number(),
  bin_conf: z.number(),
  garbage_conf: z.number(),
  detections: z.array(DetectionSchema).default([]),
});

export interface AiClient {
  predict(image: Buffer, mimeType: string): Promise<AiPrediction>;
}

export interface AiClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export function createAiClient(options: AiClientOptions = {}): AiClient {
  const baseUrl = (options.baseUrl ?? process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8000').replace(
    /\/+$/,
    '',
  );
  const timeoutMs = options.timeoutMs ?? Number(process.env.AI_SERVICE_TIMEOUT_MS ?? 5000);

  return {
    async predict(image, mimeType) {
      const form = new FormData();
      form.append(
        'image',
        new Blob([new Uint8Array(image)], { type: mimeType }),
        'photo.jpg',
      );

      let response: Response;
      try {
        response = await fetch(`${baseUrl}/predict`, {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new AiServiceUnavailableError(
          `AI service unreachable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (!response.ok) {
        throw new AiServiceUnavailableError(`AI service returned HTTP ${response.status}`);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new AiServiceUnavailableError('AI service returned invalid JSON');
      }

      const parsed = PredictionSchema.safeParse(payload);
      if (!parsed.success) {
        throw new AiServiceUnavailableError('AI service returned an unexpected response shape');
      }
      return parsed.data;
    },
  };
}
