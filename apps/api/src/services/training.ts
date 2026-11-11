import type { AiPrediction, AppConfig } from '@overflowgo/shared';
import { query } from '../db/pool';
import { deleteTrainingPhoto, saveTrainingPhoto } from './storage';

/**
 * Optional Phase 5 collection: keep only uncertain photos (between the
 * configured confidence bounds), cap the set and never let a failure break a
 * citizen report.
 */
export async function maybeSaveTrainingSample(
  buffer: Buffer,
  prediction: AiPrediction,
  config: AppConfig,
): Promise<void> {
  if (!config.retrainingCollection) return;

  const uncertainty = Math.max(
    prediction.overflow_conf ?? 0,
    prediction.garbage_conf ?? 0,
  );
  if (
    uncertainty < config.retrainingConfMin ||
    uncertainty > config.retrainingConfMax
  ) {
    return;
  }

  try {
    const count = await query<{ count: string }>(
      'SELECT count(*)::text AS count FROM retraining_samples',
    );
    if (Number(count.rows[0]?.count ?? 0) >= config.retrainingMaxSamples) {
      const oldest = await query<{ photo_path: string }>(
        `DELETE FROM retraining_samples
          WHERE id = (
            SELECT id FROM retraining_samples ORDER BY created_at ASC LIMIT 1
          )
          RETURNING photo_path`,
      );
      if (oldest.rows[0]) {
        await deleteTrainingPhoto(oldest.rows[0].photo_path).catch(
          () => undefined,
        );
      }
    }

    const photoPath = await saveTrainingPhoto(buffer);
    await query(
      `INSERT INTO retraining_samples
         (photo_path, overflow_conf, garbage_conf, bin_conf)
       VALUES ($1, $2, $3, $4)`,
      [
        photoPath,
        prediction.overflow_conf ?? 0,
        prediction.garbage_conf ?? 0,
        prediction.bin_conf ?? 0,
      ],
    );
  } catch (error) {
    console.error('[training] sample save failed:', error);
  }
}
