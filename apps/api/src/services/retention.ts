import type { AppConfig } from '@overflowgo/shared';
import { query } from '../db/pool';
import {
  deleteCompletionPhoto,
  deleteReportPhoto,
  deleteTrainingPhoto,
} from './storage';

export interface RetentionResult {
  reportPhotos: number;
  completionPhotos: number;
  trainingSamples: number;
}

export interface RetentionService {
  run(now?: Date): Promise<RetentionResult>;
}

/**
 * Deletes photo files once their ticket has been completed for longer than
 * `photoRetentionDaysAfterClose`. The database rows stay for reporting; only the
 * file path is cleared. Optional training samples have their own retention.
 */
export function createRetentionService({
  config,
}: {
  config: AppConfig;
}): RetentionService {
  return {
    async run(now = new Date()): Promise<RetentionResult> {
      const cutoff = new Date(
        now.getTime() - config.photoRetentionDaysAfterClose * 24 * 60 * 60 * 1000,
      );

      const tickets = await query<{ id: string }>(
        `SELECT id
           FROM tickets
          WHERE status = 'completed'
            AND completed_at IS NOT NULL
            AND completed_at < $1`,
        [cutoff],
      );

      let reportPhotos = 0;
      let completionPhotos = 0;

      if (tickets.rows.length > 0) {
        const ids = tickets.rows.map((row) => row.id);

        const reports = await query<{ photo_path: string }>(
          `WITH old AS (
             SELECT id, photo_path
               FROM reports
              WHERE ticket_id = ANY($1::uuid[])
                AND photo_path IS NOT NULL
              FOR UPDATE
           ), cleared AS (
             UPDATE reports r
                SET photo_path = NULL
               FROM old
              WHERE r.id = old.id
             RETURNING old.photo_path
           )
           SELECT photo_path FROM cleared`,
          [ids],
        );
        for (const row of reports.rows) {
          await deleteReportPhoto(row.photo_path).catch(() => undefined);
          reportPhotos += 1;
        }

        const completions = await query<{ after_photo_path: string }>(
          `WITH old AS (
             SELECT id, after_photo_path
               FROM completions
              WHERE ticket_id = ANY($1::uuid[])
                AND after_photo_path IS NOT NULL
              FOR UPDATE
           ), cleared AS (
             UPDATE completions c
                SET after_photo_path = NULL
               FROM old
              WHERE c.id = old.id
             RETURNING old.after_photo_path
           )
           SELECT after_photo_path FROM cleared`,
          [ids],
        );
        for (const row of completions.rows) {
          await deleteCompletionPhoto(row.after_photo_path).catch(
            () => undefined,
          );
          completionPhotos += 1;
        }
      }

      let trainingSamples = 0;
      const trainingCutoff = new Date(
        now.getTime() - config.retrainingRetentionDays * 24 * 60 * 60 * 1000,
      );
      const staleTraining = await query<{ photo_path: string }>(
        `DELETE FROM retraining_samples
          WHERE created_at < $1
          RETURNING photo_path`,
        [trainingCutoff],
      );
      const excessTraining = await query<{ photo_path: string }>(
        `DELETE FROM retraining_samples
          WHERE id IN (
            SELECT id FROM retraining_samples
             ORDER BY created_at DESC
            OFFSET $1
          )
          RETURNING photo_path`,
        [config.retrainingMaxSamples],
      );
      for (const row of [...staleTraining.rows, ...excessTraining.rows]) {
        await deleteTrainingPhoto(row.photo_path).catch(() => undefined);
        trainingSamples += 1;
      }

      return { reportPhotos, completionPhotos, trainingSamples };
    },
  };
}
