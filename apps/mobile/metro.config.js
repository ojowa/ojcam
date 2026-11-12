const { getDefaultConfig, mergeConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

const root = path.resolve(__dirname, "..", "..");

config.watchFolders = [
  ...(config.watchFolders || []),
  path.join(root, "packages"),
];

config.resolver = {
  ...config.resolver,
  extraNodeModules: {
    ...config.resolver.extraNodeModules,
    "@ojowacam/protocol": path.join(root, "packages/protocol"),
  },
};

module.exports = config;
