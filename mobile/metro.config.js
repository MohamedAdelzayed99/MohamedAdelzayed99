// Monorepo: Expo auto-detects workspaces. The dashboard workspace may hoist a different
// React patch version to the repo root, so always resolve react / react-dom from this app
// to keep a single React copy in the bundle.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const pinned = ["react", "react-dom"];
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const root = moduleName.split("/")[0];
  if (pinned.includes(root)) {
    const local = path.join(__dirname, "node_modules", root);
    try {
      require.resolve(path.join(local, "package.json"));
      return context.resolveRequest({ ...context, originModulePath: path.join(__dirname, "index.js") }, moduleName, platform);
    } catch {}
  }
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};
module.exports = config;
