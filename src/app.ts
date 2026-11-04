import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { EXAMPLES, example } from "./examples.js";
import { isAddress } from "./domain/decode.js";
import { InspectorError } from "./domain/errors.js";
import { inspectWallet } from "./services/inspect.js";
const input = z.strictObject({
  wallet: z.string().trim().refine(isAddress),
  network: z.enum(["mainnet", "devnet"]),
});
export interface AppOptions {
  inspect?: typeof inspectWallet;
  assetRoot?: string;
  maxLookupsPerMinute?: number;
  now?: () => number;
}
export function createApp(options: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
      strictTransportSecurity: false,
    }),
  );
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const host = req.headers.host ?? "";
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/.test(host)) {
      res.status(421).json({
        error: {
          code: "INVALID_HOST",
          message: "Use the local loopback dashboard address.",
        },
      });
      return;
    }
    const origin = req.headers.origin;
    let sameOrigin = true;
    if (origin) {
      try {
        sameOrigin =
          new URL(origin).origin === new URL("http://" + host).origin;
      } catch {
        sameOrigin = false;
      }
    }
    if (
      !sameOrigin ||
      ["cross-site", "same-site"].includes(
        req.headers["sec-fetch-site"] as string,
      )
    ) {
      res.status(403).json({
        error: {
          code: "CROSS_ORIGIN_BLOCKED",
          message: "Requests must originate from this local dashboard.",
        },
      });
      return;
    }
    next();
  });
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "delegate-inspector", version: "0.1.0" });
  });
  app.get("/api/examples", (_req, res) => {
    res.json({ examples: EXAMPLES });
  });
  app.get("/api/examples/:id", async (req, res) => {
    const report = await example(req.params.id);
    if (!report) {
      res.status(404).json({
        error: {
          code: "EXAMPLE_NOT_FOUND",
          message: "Choose an available offline example.",
        },
      });
      return;
    }
    res.json(report);
  });
  let active = 0;
  let lookups: number[] = [];
  app.post(
    "/api/inspections",
    (req, res, next) => {
      if (!req.is("application/json")) {
        res.status(415).json({
          error: { code: "JSON_REQUIRED", message: "Send application/json." },
        });
        return;
      }
      next();
    },
    express.json({ limit: "2kb", strict: true }),
    async (req, res) => {
      const parsed = input.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: "INVALID_INPUT",
            message:
              "Enter a public Solana address and choose Mainnet or Devnet. Do not send private keys or RPC URLs.",
          },
        });
        return;
      }
      const now = (options.now ?? Date.now)();
      lookups = lookups.filter((t) => now - t < 60000);
      if (
        active >= 2 ||
        lookups.length >= (options.maxLookupsPerMinute ?? 20)
      ) {
        res.setHeader("Retry-After", "60");
        res.status(429).json({
          error: {
            code: "LOCAL_RATE_LIMIT",
            message: "Too many local lookups. Wait a moment and retry.",
          },
        });
        return;
      }
      active++;
      lookups.push(now);
      try {
        res.json(
          await (options.inspect ?? inspectWallet)(
            parsed.data.wallet,
            parsed.data.network,
          ),
        );
      } finally {
        active--;
      }
    },
  );
  app.all("/api/inspections", (_req, res) => {
    res.setHeader("Allow", "POST");
    res.status(405).json({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Use POST for a live inspection.",
      },
    });
  });
  const root =
    options.assetRoot ?? fileURLToPath(new URL("./public/", import.meta.url));
  app.use(
    express.static(root, {
      dotfiles: "deny",
      index: "index.html",
      fallthrough: true,
    }),
  );
  app.use((_req, res) => {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Page or endpoint not found." },
    });
  });
  const errorHandler: ErrorRequestHandler = (
    error: unknown,
    _req,
    res,
    _next,
  ) => {
    if (error instanceof InspectorError) {
      res
        .status(error.status)
        .json({ error: { code: error.code, message: error.message } });
      return;
    }
    const kind =
      error && typeof error === "object" && "type" in error
        ? error.type
        : undefined;
    if (kind === "entity.too.large") {
      res.status(413).json({
        error: {
          code: "BODY_TOO_LARGE",
          message: "Request exceeded the 2 KiB local limit.",
        },
      });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({
        error: { code: "INVALID_JSON", message: "Send a valid JSON object." },
      });
      return;
    }
    res.status(500).json({
      error: {
        code: "INSPECTION_FAILED",
        message:
          "The local inspection failed. Retry or use an offline example.",
      },
    });
  };
  app.use(errorHandler);
  return app;
}
