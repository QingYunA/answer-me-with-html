// The renderer reads process.cwd() only as a default folder for local files and process.env only for the user's home
// folder; site/build.mjs injects this object so the browser bundle has no Node global.
export const process = Object.freeze({ cwd: () => '/', env: Object.freeze({}), platform: 'browser' });
