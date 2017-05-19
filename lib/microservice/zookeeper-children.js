'use strict';
const net = require('net');
const url = require('url');
const zookeeper = require('node-zookeeper-client');
const qs = require('querystring');
const _ = require('lodash');
const log = require('./../../logs/index').logger("zookeeper-children");

const pathMapper = new Map();
var client;
var hasCreateConnect = false;

class Service {
  /**
   *
   * @param host {String}
   * @param port {int}
   * @param methods {String}
   * @param version {String}
     */
  constructor(host, port, methods, version) {
    this.host = host;
    this.port = port;
    this.methods = ',' +methods+ ',';
    this.version = version;
  }
}

/**
 * 创建zookeeper连接
 * @param host {String}
 * @param sessionTimeout {int}
 * @param spinDelay {int}
 * @param retries {int}
 */
exports.connect = ({host, sessionTimeout = 30000, spinDelay = 1000, retries = 5}) => {
  if (hasCreateConnect) {
    return;
  }
  client = zookeeper.createClient(host, {
    sessionTimeout: sessionTimeout,
    spinDelay: spinDelay,
    retries: retries
  });

  var intervalID = setTimeout(() => {
    log.fatal('zookeeper server not found');
  }, 10000);
  client.connect();
  client
    .once('connected', function connect() {
      log.info('\x1b[32m%s %s\x1b[0m', host, 'Yeah zookeeper connected!');
      clearTimeout(intervalID);
    })
    .on('state', state => {
      log.debug('Zookeeper state: \'%s\'.', state.name);
    });
  hasCreateConnect = true;
};

/**
 * 找到符合版本的服务
 * @param path <String>
 * @param version <String>
 * @returns {Promise}
 */
exports.getService = (path, version) => {
  return new Promise((resolve, reject) => {
    if (pathMapper.has(path)) {
      var list = pathMapper.get(path);
      var specServicesList = _.filter(list.servicesList, {version});
      resolve([specServicesList, list.updateTimestamp]);  // Array<Service>, timestamp
    } else {
      getChildren(path, version, resolve, reject);
    }
  })
};

/**
 * 得到、监听并缓存服务
 * @param path {String} 待请求的zookeeper路径
 * @param version {String} 在dubbo中的服务版本
 * @param resolve {Function}
 * @param reject {Function}
 */
var getChildren = (path, version, resolve, reject) => {
  client.getChildren(path,
    function (event) {
      log.info('Got watcher event from zookeeper: %s', event);
      getChildren(path);
    },
    function (error, children) {
      if (error) {
        log.fatal('Failed to get children of %s due to: %j.', path, error);
        reject('zookeeper get children error');
      } else {
        var servicesList = parseServiceList(children);
        pathMapper.set(path, {
          servicesList,
          updateTimestamp: new Date().getTime()
        });
        if (resolve) {
          resolve([
            _.filter(servicesList, {version}),
            pathMapper.get(path).updateTimestamp
          ]);
        }
      }
    }
  );
};

/**
 * 提取zookeeper提供者中主机名、端口、方法、版本
 * @param children {Array<String>}
 * @returns {Array<Service>}
 */
var parseServiceList = (children) => {
  var servicesList = [];
  for (var child of children) {
    var hash = qs.parse(decodeURIComponent(child));
    var {hostname, port} = url.parse(Object.keys(hash)[0]);
    servicesList.push(new Service(
      hostname, port, hash.methods, hash.version));
  }
  return servicesList;
};
