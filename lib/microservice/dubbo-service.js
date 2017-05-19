'use strict';
const hessian = require('hessian.js');
const loadbalance = require('loadbalance');
const zc = require('./zookeeper-children');
const dubboConnect = require('./dubbo-connect');
const log = require('./../../logs/index').logger("dubbo-service");

const typeRef = {
  boolean: 'Z', int: 'I', short: 'S',
  long: 'J', double: 'D', float: 'F'
};

module.exports = (config) => new DubboService(config);

class DubboService {
  constructor({path, version, dubboVersion, group, zookeeper}) {
    this.path = path;
    this.version = version;
    this.dubboVersion = dubboVersion;
    this.attachments = {
      $class: 'java.util.HashMap',
      $: {
        interface: path,
        version: version,
        group: group,
        path: path,
        timeout: '60000'
      }
    };
    this.timestamp = null;
    this.engine = null;
    zc.connect(zookeeper);
  }

  execute(method, args) {
    return new Promise((resolve, reject) => {
      zc.getService('/dubbo/' + this.path + '/providers', this.version)
        .then(([servicesList, updateTimestamp]) => {
          if (this.timestamp !== updateTimestamp) {
            // 如果zookeeper注册服务有更新，则重新生成负载均衡
            this.timestamp = updateTimestamp;
            this.engine = new loadbalance.RoundRobinEngine(servicesList);
          }

          var service = this.engine.pick();
          if (service) {
            if (service.methods.indexOf(',' + method + ',') > -1) {
              var buffer = composeBuffer(method, args, this.path, this.version, this.dubboVersion, this.attachments);
              // 发送请求数据，并返回Promise，有下面的then处理接收
              return dubboConnect.sendRequest(service, buffer); // call service
            } else {
              // 没有找到方法
              log.warn('Can\'t find the method: %s, pls check it!', method);
              reject('Can\'t find the method.');
            }
          } else {
            // 没有找到符合版本的服务
            log.error('Can\'t find the service: %s[version %s], pls check it!',
              this.config.path, this.config.version);
            reject('Can\'t find the service.');
          }
        })
        .then(([resBuffer, sequence]) => {
          // 处理dubbo发回的响应数据
          log.trace('Response[%d] head', sequence, resBuffer.slice(0, 16));
          resolve(decomposeBuffer(resBuffer));
        })
        .catch(err => {
          if (err.stack) {
            // 系统错误
            log.fatal(err.stack);
            reject(err.message);
          } else {
            // 自定义的错误
            reject(err);
          }
        });
    });
  }
}

/**
 * 拼装请求包，不包含head数据部分，head由dubbo-connect中的函数完成
 * @param method {String}
 * @param args {Array<String>} 请求传参
 * @param path {String} 请求服务路径
 * @param version {String} 请求服务版本
 * @param dubboVersion {String} Dubbo版本，拼装包用，其他地方都没有用到
 * @param attachments {Object} 数据格式要求携带，其他地方没用到
 * @returns {Buffer} hessian协议格式
 */
var composeBuffer = (method, args, path, version, dubboVersion, attachments) => {
  var types = '';
  for (var arg of args) {
    var type = arg['$class'];
    types += type && ~type.indexOf('.')
      ? 'L' + type.replace(/\./g, '/') + ';'
      : typeRef[type];
  }

  var encoder = new hessian.EncoderV2();
  encoder.write(dubboVersion);
  encoder.write(path);
  encoder.write(version);
  encoder.write(method);
  encoder.write(types);
  if (args && args.length) {
    for (var arg of args) {
      encoder.write(arg);
    }
  }
  encoder.write(attachments);
  encoder = encoder.byteBuffer._bytes.slice(0, encoder.byteBuffer._offset);
  return encoder;
};

/**
 * 解析dubbo响应数据，返回JSON
 * @param buffer {Buffer}
 * @returns {JSON}
 */
var decomposeBuffer = (buffer) => {
  var ret;
  if (buffer[3] !== 20) {
    ret = buffer.slice(18, buffer.length - 1).toString(); // error捕获
    throw ret;
  }
  if (buffer[15] === 3 && buffer.length < 20) { // 判断是否没有返回值
    ret = 'void return';
    return ret;
  }

  try {
    var offset = buffer[16] === 145 ? 17 : 18; // 判断传入参数是否有误
    var buf = new hessian.DecoderV2(buffer.slice(offset, buffer.length));

    ret = buf.read();
    if (ret instanceof Error || offset === 18) {
      throw ret;
    }

  } catch (err) {
    throw err
  }
  return ret;
};
