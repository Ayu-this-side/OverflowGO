-- Store the perceptual hash of each after photo. The completion service uses it
-- to reject an after photo that was already used for another job, so a driver
-- cannot recycle one clean-bin photo to close several tickets.

ALTER TABLE completions ADD COLUMN IF NOT EXISTS photo_hash text;

CREATE INDEX IF NOT EXISTS completions_photo_hash_idx
  ON completions (photo_hash)
  WHERE photo_hash IS NOT NULL;
