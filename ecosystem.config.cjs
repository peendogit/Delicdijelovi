module.exports = {
  apps: [{
    name: 'delic-dijelovi',
    script: 'server/index.js',
    node_args: '--no-warnings',
    cwd: __dirname,
    max_memory_restart: '600M',
    env: { NODE_ENV: 'production' },
  }],
};
