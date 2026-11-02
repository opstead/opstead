# Bringing it under the operator's watch

The contract is what an app serves; this page is the other side: what the operator is told so it
looks. The operator reads one apps file (JSON, kept on the machine it runs on, never in a repo: it
holds tokens) and its own env file. Everything that depends on someone else's product is a
**plugin**, chosen by a field in the apps file or by settings in the env file. Plugins come with the
operator; nothing is installed. Its settings page lists every plugin, what uses it and which settings
it still lacks, so look there (or in its start-up log) after a change.

Never put a token's value in chat, a commit or a report: name the variable and let the owner set it.

## Which entry

| What it is | Where it goes | Plugin chosen by |
|---|---|---|
| An app with the contract | `apps[]` | its machine's `os` (for its `services`) |
| A computer | `machines[]` | `os`, `network`, `tunnel`/`edge` |
| A process with no contract (a daemon, a container) | `machines[].services`, `machines[].probes` | the machine's `os` |
| A website hosted elsewhere | `sites[]` | `provider` |
| Where notices go | env file | the channel's settings |
| Who may open the operator's page | env file | `OPS_LOGIN` |

## An app

```json
{ "name": "<same as the health reply's app>", "url": "http://127.0.0.1:<port>",
  "token": "<its OPS_TOKEN>", "machine": "<machine name>",
  "services": ["<service name>"], "jobs": [{ "name": "<job>", "every": "1h", "grace": "30m" }] }
```

`services` are names the machine's host plugin understands; `jobs` must match the heartbeat paths
and the manifest's `job` fields.

## A machine

```json
{ "name": "box", "os": "linux", "exporter": "<address>:9100", "network": "tailscale",
  "services": ["docker.service"], "tunnel": "<tunnel name>", "tunnel_metrics": "<address>:<port>" }
```

- `os` picks the host plugin: `macos` (services are launchd labels, asked directly on the machine
  the operator runs on), `linux` (systemd units, read from node_exporter's systemd collector: run it
  with `--collector.systemd`). Another OS needs a new host plugin; say so instead of guessing.
- A container is `docker:<container>` in `services`, on any OS; it is asked of Docker (`DOCKER_HOST`,
  the local socket by default) on the machine the operator runs on only.
- `exporter`: node_exporter, reachable from the operator's machine. Without it only what the machine
  serves itself can be watched.
- `network` picks the private-network plugin (`tailscale`): up, and every other machine reachable.
- `tunnel`: the tunnel this machine runs at its edge provider, so public names lead to its ports;
  `tunnel_metrics`: the connector's metrics address (its live connections). `edge` names the provider
  when there is more than one.
- Only the machine the operator runs on has `"local": true`.

## A website

```json
{ "name": "example.com", "provider": "cloudflare", "zone": "example.com",
  "hosts": [{ "id": "home", "url": "https://example.com", "expect": { "status": 200 } }] }
```

- `provider` picks the edge plugin. `cloudflare` adds deployments, the zone's 5xx, the offline rule,
  every DNS name in the zone (names nobody declares are reported) and tunnel routes; it needs
  `CLOUDFLARE_API_TOKEN` in the env file, read-only (Zone, DNS, Analytics, Pages, Tunnel read). `http`
  or no provider: the hosts are only probed from outside (status, body, speed, certificate, DNS).
- A name that should be listed but not opened (behind a login, someone else's) gets `"watch": false`
  and a `note`.

## Notices and login (env file)

- Notice channels; every channel whose settings are present gets every notice:
  - `ntfy`: `NTFY_URL` (and `NTFY_TOKEN`, `NTFY_TOPIC_URGENT|DAILY|INFO`); approvals are buttons.
  - `telegram`: `TELEGRAM_BOT_TOKEN` (from @BotFather) and `TELEGRAM_CHAT_ID`; an approval button opens
    a page that asks before it acts.
  - `webhook`: `NOTIFY_WEBHOOK_URL` (and `NOTIFY_WEBHOOK_TOKEN`): each notice POSTed as JSON.
- Login, by `OPS_LOGIN`; a missing setting refuses everyone:
  - `cloudflare-access` (the default): `ACCESS_TEAM` and `ACCESS_AUD`.
  - `header`: a sign-in proxy in front (Authelia, oauth2-proxy, Authentik, Tailscale serve, Caddy or
    Traefik forward auth) passes the user in `LOGIN_HEADER` (default `Remote-User`); believed only from
    the addresses in `LOGIN_TRUSTED` (the proxy's, or a range like `172.16.0.0/12`), and only for the
    names in `LOGIN_ALLOW` when that is set.
  - `password`: one owner, no proxy: `OPS_PASSWORD_HASH` from `npm run password` (the password itself
    is never stored). A session lasts 30 days; changing the password ends every session.
  - `none`: only for a page nothing else can reach.
  Ask the owner which they have; never choose `none` for a page others can reach, and never put a
  password in the env file, only the hash, which the owner makes with `npm run password`.

## After the change

Restart the operator the way its deployment does, then check: the settings page shows the plugin as
in use with nothing missing, and the new app, machine or site appears on the map with its checks
`ok` or with a problem you can explain. Report what was added and anything the owner still has to
set (a token, a node_exporter flag, a login rule).
