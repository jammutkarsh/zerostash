-- Links still needing a preview: retried by the server (pending) and offered to the Zerostash
-- extension, which fetches them from the user's browser (failure, not yet tried there).
-- Replaces bookmarks_crawl_todo, which covered pending only.
CREATE INDEX bookmarks_preview_todo ON bookmarks (created_at) WHERE crawl_status IN ('pending', 'failure');
DROP INDEX bookmarks_crawl_todo;

-- AI work queued but not finished. Saves send the queue message in the background, so the
-- cron re-queues any whose message was lost; this keeps that check a range scan.
CREATE INDEX bookmarks_ai_pending ON bookmarks (updated_at) WHERE tagging_status = 'pending' OR summarization_status = 'pending';
