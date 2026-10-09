import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { hostname } from "node:os";

export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // the URL is printed as well
  }
}

const PAGE = (msg: string) =>
  `<!doctype html><html><body style="font-family:system-ui;padding:3rem;text-align:center"><h2>${msg}</h2><p>You can close this tab and return to the terminal.</p></body></html>`;

/**
 * Opens the Hub's /cli/authorize page and waits for it to redirect back to a loopback server
 * with a freshly minted API token.
 */
export async function browserLogin(
  hubUrl: string,
  opts: { timeoutMs?: number; onUrl?: (url: string) => void; open?: (url: string) => void } = {},
): Promise<{ token: string; login: string }> {
  const state = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const token = url.searchParams.get("token");
      if (url.searchParams.get("state") !== state || !token) {
        res.writeHead(400, { "content-type": "text/html" }).end(PAGE("Login failed: state mismatch."));
        return;
      }
      res.writeHead(200, { "content-type": "text/html" }).end(PAGE("hub CLI is logged in."));
      finish(() => resolve({ token, login: url.searchParams.get("login") ?? "" }));
    });
    const timer = setTimeout(() => finish(() => reject(new Error("Timed out waiting for browser login."))), opts.timeoutMs ?? 5 * 60_000);
    function finish(cb: () => void) {
      clearTimeout(timer);
      server.close();
      server.closeAllConnections?.();
      cb();
    }
    server.on("error", (err) => finish(() => reject(err)));
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const authorize = new URL("/cli/authorize", hubUrl);
      authorize.searchParams.set("callback", `http://127.0.0.1:${port}/callback`);
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("name", hostname());
      opts.onUrl?.(authorize.toString());
      (opts.open ?? openBrowser)(authorize.toString());
    });
  });
}
