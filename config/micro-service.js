module.exports = {
  dubboVersion:'2.5.3',
  version: '1.0.0-SNAPSHOT', // gss service version
  group:'',
  zookeeper: {
    host: '127.0.0.1:2181', // zookeeper url
    sessionTimeout: 30000,
    spinDelay: 1000,
    retries: 5
  }
};
