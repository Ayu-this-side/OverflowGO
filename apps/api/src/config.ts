import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { AppConfig } from '@overflowgo/shared';

const AppConfigSchema = z.object({
  geofenceRadiusKm: z.number().positive(),
  geofenceExpandedRadiusKm: z.number().positive(),
  offerTimeoutSeconds: z.number().int().positive(),
  taskSlaMinutes: z.number().int().positive(),
  duplicateMergeRadiusMeters: z.number().positive(),
  driverProximityNoRewardMeters: z.number().positive(),
  driverHeartbeatSeconds: z.number().int().positive(),
  driverStaleAfterSeconds: z.number().int().positive(),
  afterPhotoMaxDistanceMeters: z.number().positive(),
  aiOverflowThreshold: z.number().min(0).max(1),
  aiGarbageThreshold: z.number().min(0).max(1),
  aiBinThreshold: z.number().min(0).max(1),
  aiVerifyMaxOverflowConf: z.number().min(0).max(1),
  aiVerifyMaxGarbageConf: z.number().min(0).max(1),
  rewardPerExtraJob: z.number().nonnegative(),
  rewardDailyCapPerDriver: z.number().nonnegative(),
  photoRetentionDaysAfterClose: z.number().int().positive(),
  skipOfferIfRouteDueWithinMinutes: z.number().int().nonnegative(),
  timezone: z.string().min(1),
  acceptanceScorePenalty: z.number().min(0).max(1),
  dumpYard: z.object({
    name: z.string().min(1),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  corsOrigins: z.array(z.string().min(1)).min(1),
});

let cached: AppConfig | null = null;

function configCandidates(): string[] {
  const candidates: string[] = [];
  if (process.env.APP_CONFIG_PATH) {
    candidates.push(resolve(process.cwd(), process.env.APP_CONFIG_PATH));
  }
  candidates.push(resolve(process.cwd(), 'config/app.config.json'));
  candidates.push(resolve(process.cwd(), '../../config/app.config.json'));
  return candidates;
}

export function loadConfig(): AppConfig {
  if (cached) return cached;

  const path = configCandidates().find((candidate) => existsSync(candidate));
  if (!path) {
    throw new Error(
      `Could not find app.config.json. Tried:\n${configCandidates().join('\n')}`,
    );
  }

  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  const parsed = AppConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid app config at ${path}:\n${parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')}`);
  }

  cached = parsed.data;
  return cached;
}

export function resetConfigCacheForTests(): void {
  cached = null;
}
