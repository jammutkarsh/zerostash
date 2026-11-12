# Upgrading Zerostash

The dashboard shows your version at the bottom of the sidebar. When a newer [release](https://github.com/jammutkarsh/zerostash/releases) is out, it also shows an **Update available** notice.

## Update your server

1. Open your fork on GitHub.
2. Click **Sync fork → Update branch**.

Cloudflare rebuilds your fork, applies any database changes, then deploys. Your bookmarks and your secret stay as they are.

## Update the extension

Download the new extension from the [latest release](https://github.com/jammutkarsh/zerostash/releases/latest) and load it the same way as before ([step 5 of the deploy guide](./workers.md#5-install-the-browser-extension)). For Chrome, unzip the new version into the same folder as before, then click the reload button on `chrome://extensions`. Keeping the same folder keeps your settings.
