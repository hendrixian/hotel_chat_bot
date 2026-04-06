const fetchFn = global.fetch
  ? global.fetch.bind(global)
  : (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

const DEFAULT_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 20000);

function withTimeout(promise, controller, timeoutMs) {
  if (!timeoutMs || Number.isNaN(timeoutMs)) {
    return promise;
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return promise.finally(() => clearTimeout(timer));
}

module.exports = (url, options = {}) => {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  const fetchOptions = {
    ...options,
    signal: controller.signal
  };

  return withTimeout(fetchFn(url, fetchOptions), controller, timeoutMs);
};
