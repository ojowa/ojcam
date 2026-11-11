const { getDefaultConfig } = require('@react-native/metro-config');

const {
  getSentryExpoConfig
} = require("@sentry/react-native/metro");

module.exports = (async () => {
  const config = await getSentryExpoConfig(__dirname);
  return config;
})();