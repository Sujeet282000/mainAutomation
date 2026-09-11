// Express 4 does not catch rejected promises from async route handlers: the
// rejection is swallowed, the request never receives a response, and the
// client hangs forever. This patch wraps every handler registered on any
// Router so async rejections are forwarded to the error middleware instead.
//
// Express 4 quirk: `Router()` instances inherit from the Router factory
// function itself (`setPrototypeOf(router, proto)` in express/lib/router),
// NOT from `Router.prototype`. We therefore patch the actual prototype of a
// freshly created instance so the patch lands inside the real chain.
//
// Must be imported BEFORE any module that registers routes (import order =
// module evaluation order), e.g. as the first import of apps/api/src/index.ts.
import { Router } from "express";

type Next = (err?: unknown) => void;
type Handler = (...args: unknown[]) => unknown;

function wrapAsync(fn: Handler): Handler {
  // Error middleware is detected by arity (4 args): pass it through untouched.
  if (fn.length >= 4) return fn;
  return function wrapped(this: unknown, ...args: unknown[]) {
    const [req, res, next] = args as [unknown, unknown, Next];
    try {
      const out = fn.call(this, req, res, next);
      if (out && typeof (out as Promise<unknown>).catch === "function") {
        return (out as Promise<unknown>).catch(next);
      }
      return out;
    } catch (err) {
      return next(err);
    }
  };
}

const methods = ["get", "post", "put", "patch", "delete", "all", "use"] as const;

export function patchExpressRouters(): void {
  // The prototype that real router instances actually inherit from.
  const createRouter = Router as unknown as () => { __asyncPatchedAll?: boolean } & Record<string, Handler & { __asyncPatched?: boolean }>;
  const proto = Object.getPrototypeOf(createRouter());
  if (!proto || proto.__asyncPatchedAll) return;
  for (const method of methods) {
    const original = proto[method];
    if (!original || original.__asyncPatched) continue;
    const patched = function patched(this: unknown, ...args: unknown[]) {
      // Wrap only handler arguments (skip path strings/regexps/routers).
      return original.apply(this, args.map((a) => (typeof a === "function" ? wrapAsync(a as Handler) : a)));
    } as Handler & { __asyncPatched?: boolean };
    patched.__asyncPatched = true;
    proto[method] = patched;
  }
  proto.__asyncPatchedAll = true;
}

declare module "express-serve-static-core" {
  interface IRouter {
    __asyncPatchedAll?: boolean;
  }
}

declare module "express" {
  interface IRouter {
    __asyncPatchedAll?: boolean;
  }
}

patchExpressRouters();
