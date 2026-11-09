-- Reports can now be accepted because the detector saw garbage, loose waste,
-- an overflowing bin, or simply a garbage bin. Record the actual trigger.
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_ai_trigger_check;

ALTER TABLE reports
  ADD CONSTRAINT reports_ai_trigger_check
  CHECK (ai_trigger IN ('overflow', 'garbage', 'garbage_bin', 'both'));
