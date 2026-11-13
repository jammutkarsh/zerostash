# Upgrading Zerostash

The dashboard shows your version at the bottom of the sidebar. When a newer [release](https://github.com/jammutkarsh/zerostash/releases) is out, it also shows an **Update available** notice.

## Update your server

1. Open your fork on GitHub.
2. Click **Sync fork → Update branch**.

Cloudflare rebuilds your fork, applies any database changes, then deploys. Your bookmarks and your secret stay as they are.

## From 0.x to 1.0

1.0 is a rewrite: it speaks Karakeep's API, drops the Zerostash browser extension (use Karakeep's), and starts a new database. A 0.x database can't be upgraded in place.

1. Save what you want to keep (the 0.x dashboard has no export; copy your links, or run `npx wrangler d1 export zerostash --remote --output backup.sql`).
2. In the Cloudflare dashboard, delete the `zerostash` Worker (if it's a consumer of the `zerostash-jobs` queue, remove it from the queue's consumers first), then delete the `zerostash` D1 database.
3. Sync your fork, then follow the [deploy guide](./workers.md) from step 1. The queue is reused.
4. Uninstall the Zerostash extension and connect Karakeep's ([step 5](./workers.md#5-connect-karakeeps-apps)).
