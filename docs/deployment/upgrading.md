# Upgrading Zerostash

The dashboard shows your version at the bottom of the sidebar. When a newer [release](https://github.com/jammutkarsh/zerostash/releases) is out, it also shows an **Update available** notice.

## Update your server

1. Open your fork on GitHub.
2. Click **Sync fork → Update branch**.

Cloudflare rebuilds your fork, applies any database changes, then deploys. Your bookmarks and your secret stay as they are.

## Update the extension

Chrome updates the extension from the Chrome Web Store on its own. On Firefox, download `zerostash-firefox.xpi` from the [latest release](https://github.com/jammutkarsh/zerostash/releases/latest) and load it the same way as before ([step 5 of the deploy guide](./workers.md#5-install-the-browser-extension)). Extension 1.1 needs server 1.1 or newer; its settings page says so if your server is older.

## From 0.x to 1.x

1.0 is a rewrite: it speaks Karakeep's API and starts a new database. A 0.x database can't be upgraded in place.

1. Save what you want to keep (the 0.x dashboard has no export; copy your links, or run `npx wrangler d1 export zerostash --remote --output backup.sql`).
2. In the Cloudflare dashboard, delete the `zerostash` Worker (if it's a consumer of the `zerostash-jobs` queue, remove it from the queue's consumers first), then delete the `zerostash` D1 database.
3. Sync your fork, then follow the [deploy guide](./workers.md) from step 1. The queue is reused.
4. Update the Zerostash extension to 1.1 and enter your server and secret again.
