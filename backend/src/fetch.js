const fetchFn = global.fetch
  ? global.fetch.bind(global)
  : (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

module.exports = fetchFn;
