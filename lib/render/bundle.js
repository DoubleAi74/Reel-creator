import path from "node:path";

import { bundle } from "@remotion/bundler";

function getBundleCache() {
  if (!globalThis.__reelCreatorBundleCache) {
    globalThis.__reelCreatorBundleCache = {
      promise: null,
    };
  }

  return globalThis.__reelCreatorBundleCache;
}

function withWorkspaceAlias(configuration) {
  return {
    ...configuration,
    resolve: {
      ...configuration.resolve,
      alias: {
        ...(configuration.resolve?.alias ?? {}),
        "@": process.cwd(),
      },
    },
  };
}

export function getRemotionServeUrl() {
  const cache = getBundleCache();

  if (!cache.promise) {
    cache.promise = bundle({
      entryPoint: path.join(process.cwd(), "remotion/register.js"),
      webpackOverride: withWorkspaceAlias,
    });
  }

  return cache.promise;
}
